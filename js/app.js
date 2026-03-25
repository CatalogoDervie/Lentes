// app.js — Punto de entrada. Inicialización, eventos y acciones del usuario.

'use strict';

import { toast, hoyISO, nowTag, downloadTextFile, idbSet, idbGet, fdInput, escapeAttr, cleanDigits } from './utils.js';
import {
  DB, setDB, selId, setSelId, sortCol, setSortCol, sortDir, setSortDir,
  currentTab, setCurrentTab, quickFilter, setQuickFilter as _setQuickFilter,
  hideFinalizadasSinAccion, setHideFinalizadasSinAccion,
  SETTINGS, ALERT_SILENCES, findRow, normalizeId,
  estado, alertas, secondEyeMissing, isFacturadoCompleto, getDioptria,
  silenciarAlerta, reactivarAlerta, backupDiario, normalizarData, validarFila, filtered
} from './state.js';
import {
  render, renderTabla, renderStats, renderAlerts, refreshSidePanel,
  openSide, closeSide, forceUnlockUI, renderWorkdayPanel, updateStickyMetrics,
  toggleKpis, restoreKpisPref, MAIN_TABLE_COLUMNS
} from './render.js';
import {
  save, deleteFromServer, showSyncBadge, loadFromServer, sincronizarAhora,
  ensureFirestoreRealtimeSync, activateFirestoreIfReady, repararCache, configurarURL
} from './firebase-ui.js';
import { probarConexion, connectorStartJob, connectorPollJob, renderJobStatus } from './connector.js';
import { abrirModalRecetas, cerrarModalRecetas, generarRecetasDesdeModal } from './recetas.js';

// ── Exposición global para compatibilidad con HTML legacy ────────────────
// (necesario mientras los botones del HTML usan onclick=)
Object.assign(window, {
  probarConexion,
  sincronizarAhora,
  repararCache,
  configurarURL,
  toggleKpis,
  exportarListos,
  exportarBackupJSON,
  importarBackupJSON,
  exportarFiltradoExcel,
  exportarCirugiasDelDia,
  abrirLentessModal,
  cerrarLentessModal,
  abrirStockModal,
  closeStockModal,
  cargarStockLente,
  closeExport,
  abrirModalRecetas,
  cerrarModalRecetas,
  generarRecetasDesdeModal,
  copyExcel,
  downloadExcelListos,
  descargarScriptLentess,
  nuevoModal,
  closeSide,
  goBackSecondary,
  toggleAlerts: () => document.getElementById('alertsPanel')?.classList.toggle('open'),
  setTab,
  setQuickFilter,
  clearTopFilters,
  sortBy,
  configurarAlertas,
  silenciarAlerta: (key) => { silenciarAlerta(key); render(); },
  reactivarAlerta: (key) => { reactivarAlerta(key); render(); },
  marcarSolLenteHoy,
  marcarLenteLlegoHoy,
  programarCirugia,
  marcarCirugiaRealizada,
  marcarFacturadaHoy,
  duplicarPaciente,
  eliminar,
  openSide,
  // Inline editing (llamado desde tabla)
  inlineEdit,
  inlineEditDate,
  inlineEditSel,
  commitInline,
  rowClick,
  rowCheck,
});


let sideDraft = null;
let sideDirty = false;
function markSideDirty(v = true) {
  sideDirty = v;
  const hint = document.getElementById('sideDirtyHint');
  if (hint) hint.style.display = v ? 'inline' : 'none';
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function initSideDraft(id) { const row = findRow(id); sideDraft = row ? clone(row) : null; markSideDirty(false); }
async function saveSideDraft(id) {
  if (!sideDraft || normalizeId(sideDraft.id) !== normalizeId(id)) return;
  const p = findRow(id); if (!p) return;
  Object.assign(p, clone(sideDraft));
  validarFila(p);
  await save(p);
  markSideDirty(false);
  render();
  openSide(id);
  toast('✓ Cambios guardados');
}
function cancelSideDraft(id) {
  markSideDirty(false);
  openSide(id);
  toast('Cambios descartados');
}
// ── Tabs ──────────────────────────────────────────────────────────────────
function setTab(tab, el) {
  setCurrentTab(tab);
  document.querySelectorAll('.tablink').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  ['tabView', 'kanView', 'calView', 'statsView', 'factView', 'waView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const tabMap = { tabla: 'tabView', kanban: 'kanView', calendario: 'calView', estadisticas: 'statsView', facturacion: 'factView', whatsapp: 'waView' };
  const target = document.getElementById(tabMap[tab]);
  if (target) target.style.display = 'block';
  render();
}

// ── Quick filter ──────────────────────────────────────────────────────────
function setQuickFilter(f, el) {
  _setQuickFilter(f);
  document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  render();
}

// ── Limpiar filtros ───────────────────────────────────────────────────────
function clearTopFilters() {
  const els = ['q', 'fCli', 'fEst', 'fOS'];
  els.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const sil = document.getElementById('showSilenced');
  if (sil) sil.checked = false;
  const hideFin = document.getElementById('hideFinalizadasSinAccion');
  if (hideFin) {
    hideFin.checked = false;
    setHideFinalizadasSinAccion(false);
  }
  const first = document.querySelector('#quickFilters .qf-btn');
  setQuickFilter('TODOS', first);
}

// ── Ordenar tabla ─────────────────────────────────────────────────────────
function sortBy(col) {
  if (sortCol === col) setSortDir(-sortDir);
  else { setSortCol(col); setSortDir(1); }
  render();
}

// ── Nuevo paciente ────────────────────────────────────────────────────────
async function nuevoModal() {
  const nid = String(DB.nid++);
  const newRow = {
    id: nid, clinica: 'CDU', nombre: '', dni: '', fnac: '', tel: '', dir: '',
    obraSocial: 'PAMI', afiliado: '', ojos: '2 ojos', ojo: 'OI', dioptria: '',
    fechaSolLente: '', fechaLlegaLente: '', recepLente: '', extraSutura: false, extraInyeccion: false, extraVitrectomia: false,
    fechaCir: '', hora: '', estadoCir: '', estadoFac: '', fechaFacturada: '',
    fechaCarga: hoyISO(), notas: ''
  };
  DB.rows.push(newRow);
  await save(newRow);
  render();
  openSide(nid);
  toast('Nuevo paciente creado — completá los datos');
}

// ── Eliminar paciente ─────────────────────────────────────────────────────
async function eliminar(id) {
  const p = findRow(id);
  const nombre = p?.nombre || `ID ${id}`;
  if (!confirm(`¿Eliminar a "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
  const sid = normalizeId(id);
  DB.rows = DB.rows.filter(x => normalizeId(x.id) !== sid);
  await deleteFromServer(sid);
  await save(null);
  closeSide();
  render();
  toast('Paciente eliminado');
}

// ── Actualizar campo de un paciente (desde panel lateral) ─────────────────
async function upd(id, field, val) {
  const p = findRow(id);
  if (!p) return;
  p[field] = val;
  validarFila(p);
  try {
    await save(p);
    renderStats();
    renderAlerts();
    renderTabla();
    if (normalizeId(selId) === normalizeId(id)) refreshSidePanel(p);
    toast('✓ Guardado');
  } catch (err) {
    console.error('Error guardando campo:', err);
    toast('⚠ Error al guardar');
  } finally {
    forceUnlockUI();
  }
}

// ── Duplicar paciente (segundo ojo) ───────────────────────────────────────
async function duplicarPaciente(id) {
  const orig = findRow(id);
  if (!orig) return;
  const otroOjo = orig.ojo === 'OD' ? 'OI' : 'OD';
  const yaExiste = DB.rows.some(x => x.id !== orig.id && String(x.dni || '').trim() === String(orig.dni || '').trim() && x.ojo === otroOjo);
  if (yaExiste) { toast(`Ya existe episodio para ${otroOjo}`); return; }
  const copia = { ...orig };
  orig.ojos = '2 ojos';
  copia.id = String(DB.nid++);
  copia.ojo = otroOjo;
  copia.ojos = '2 ojos';
  copia.fechaSolLente = '';
  copia.fechaLlegaLente = '';
  copia.recepLente = '';
  copia.fechaCir = '';
  copia.estadoCir = '';
  copia.estadoFac = '';
  copia.notas = `Copia de ${orig.nombre} — ${orig.ojo} → ${copia.ojo}`;
  DB.rows.push(copia);
  await save(copia);
  render();
  closeSide();
  setTimeout(() => openSide(copia.id), 100);
  toast(`✓ Duplicado para ojo ${copia.ojo}`);
}

// ── Acciones rápidas ──────────────────────────────────────────────────────
async function marcarSolLenteHoy(id) {
  const p = findRow(id); if (!p) return;
  p.fechaSolLente = hoyISO();
  await save(p); render(); openSide(id);
  toast('✓ Sol. lente marcada hoy');
}

async function marcarLenteLlegoHoy(id) {
  const p = findRow(id); if (!p) return;
  p.fechaLlegaLente = hoyISO();
  await save(p); render(); openSide(id);
  toast('✓ Lente llegó hoy');
}

async function programarCirugia(id) {
  const fecha = prompt('Fecha de cirugía (YYYY-MM-DD):');
  if (!fecha) return;
  const p = findRow(id); if (!p) return;
  p.fechaCir = fecha;
  await save(p); render(); openSide(id);
  toast('✓ Cirugía programada');
}

async function marcarCirugiaRealizada(id) {
  const p = findRow(id); if (!p) return;
  p.estadoCir = 'Realizada';
  if (!p.fechaCir) p.fechaCir = hoyISO();
  await save(p); render(); openSide(id);
  toast('✓ Cirugía marcada como realizada');
}

async function marcarFacturadaHoy(id) {
  const p = findRow(id); if (!p) return;
  p.estadoFac = 'FACTURADA';
  p.fechaFacturada = hoyISO();
  await save(p); render(); openSide(id);
  toast('✓ Marcada como facturada');
}

// ── Inline editing ────────────────────────────────────────────────────────
function inlineEdit(e, id, field) {
  e.stopPropagation();
  const td = e.currentTarget;
  const p = findRow(id);
  if (!p) return;
  td.classList.add('editing');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = p[field] || '';
  input.autofocus = true;
  input.addEventListener('blur', ev => commitInline(ev, id, field));
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') ev.target.blur();
    if (ev.key === 'Escape') { ev.target.dataset.cancel = '1'; ev.target.blur(); }
  });
  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
}

function inlineEditDate(e, id, field) {
  e.stopPropagation();
  const td = e.currentTarget;
  const p = findRow(id);
  if (!p) return;
  td.classList.add('editing');
  const input = document.createElement('input');
  input.type = 'date';
  input.value = fdInput(p[field]);
  input.autofocus = true;
  input.addEventListener('blur', ev => commitInline(ev, id, field));
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') ev.target.blur();
    if (ev.key === 'Escape') { ev.target.dataset.cancel = '1'; ev.target.blur(); }
  });
  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
}

function inlineEditSel(e, id, field, opts) {
  e.stopPropagation();
  const td = e.currentTarget;
  const p = findRow(id);
  if (!p) return;
  td.classList.add('editing');
  const sel = document.createElement('select');
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o || '—';
    if (p[field] === o) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('blur', ev => commitInline(ev, id, field));
  sel.addEventListener('change', () => sel.blur());
  td.innerHTML = '';
  td.appendChild(sel);
  sel.focus();
}

async function commitInline(e, id, field) {
  const el = e.target;
  if (el.dataset.cancel) { render(); forceUnlockUI(); return; }
  const val = el.value;
  const p = findRow(id);
  if (!p) { render(); forceUnlockUI(); return; }
  p[field] = val;
  if (field === 'estadoFac') {
    if (String(val || '').toUpperCase() === 'FACTURADA' && !p.fechaFacturada) p.fechaFacturada = hoyISO();
    if (!val) p.fechaFacturada = '';
  }
  try {
    await save(p);
    render();
    toast('✓ Guardado');
  } catch (err) {
    console.error('Error guardando inline:', err);
    toast('⚠ Error al guardar');
    render();
  } finally {
    forceUnlockUI();
  }
}

// ── Row click / checkbox ──────────────────────────────────────────────────
function rowClick(e, id) {
  if (e.target.type === 'checkbox') return;
  const nid = normalizeId(id);
  if (selId === nid) { closeSide(); return; }
  if (sideDirty && normalizeId(selId) !== normalizeId(nid) && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) return;
  setSelId(nid);
  render();
  openSide(nid);
}

function rowCheck(e, id) {
  e.stopPropagation();
  const nid = normalizeId(id);
  if (e.target.checked) { if (sideDirty && normalizeId(selId) !== normalizeId(nid) && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) { e.target.checked = false; return; } setSelId(nid); openSide(nid); }
  else { setSelId(null); closeSide(); }
  render();
}

// ── Exportaciones ─────────────────────────────────────────────────────────
async function exportarBackupJSON() {
  const data = JSON.stringify(DB, null, 2);
  downloadTextFile(`cirugias_backup_${nowTag()}.json`, data, 'application/json');
  toast('✓ Backup descargado');
}

async function importarBackupJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const rows = Array.isArray(data) ? data : (data.rows || []);
      if (!rows.length) { toast('⚠ El archivo no tiene filas válidas'); return; }
      if (!confirm(`¿Importar ${rows.length} pacientes?\n\nSe AGREGARÁN a los existentes.`)) return;
      rows.forEach(r => {
        r.id = String(r.id || Date.now());
        if (!DB.rows.find(x => x.id === r.id)) DB.rows.push(r);
      });
      await save(null);
      normalizarData();
      render();
      toast(`✓ Importados ${rows.length} pacientes`);
    } catch (err) {
      console.error(err);
      toast('⚠ Error al importar JSON: ' + err.message);
    }
  };
  input.click();
}

function exportarFiltradoExcel() {
  import('./state.js').then(({ filtered }) => {
    const rows = filtered();
    const cols = ['nombre', 'dni', 'fnac', 'tel', 'obraSocial', 'afiliado', 'clinica', 'ojo', 'dioptria', 'fechaSolLente', 'fechaLlegaLente', 'fechaCir', 'estadoCir', 'estadoFac', 'fechaFacturada', 'extraSutura', 'extraInyeccion', 'extraVitrectomia', 'notas'];
    const header = cols.join('\t');
    const body = rows.map(p => cols.map(c => String(p[c] || '')).join('\t')).join('\n');
    downloadTextFile(`cirugias_${nowTag()}.tsv`, header + '\n' + body, 'text/tab-separated-values');
    toast('✓ Vista exportada (TSV)');
  });
}

function exportarListos() {
  import('./state.js').then(({ DB: db, estado: est }) => {
    const listos = db.rows.filter(p => est(p) === 'PEDIR LENTE');
    if (!listos.length) { toast('No hay pacientes listos para pedir lente'); return; }
    const cols = ['nombre', 'dni', 'obraSocial', 'afiliado', 'clinica', 'ojo', 'dioptria'];
    const header = cols.join('\t');
    const body = listos.map(p => cols.map(c => String(p[c] || '')).join('\t')).join('\n');
    downloadTextFile(`listos_pedir_${nowTag()}.tsv`, header + '\n' + body, 'text/tab-separated-values');
    toast(`✓ Exportados ${listos.length} pacientes listos`);
  });
}

function exportarCirugiasDelDia() {
  import('./state.js').then(({ DB: db, estado: est }) => {
    const hoy = hoyISO();
    const hoyRows = db.rows.filter(p => p.fechaCir === hoy);
    if (!hoyRows.length) { toast('No hay cirugías hoy'); return; }
    const cols = ['nombre', 'dni', 'tel', 'obraSocial', 'ojo', 'dioptria', 'hora'];
    const header = cols.join('\t');
    const body = hoyRows.map(p => cols.map(c => String(p[c] || '')).join('\t')).join('\n');
    downloadTextFile(`cx_dia_${hoy}.tsv`, header + '\n' + body, 'text/tab-separated-values');
    toast(`✓ Exportadas ${hoyRows.length} cirugías del día`);
  });
}

// ── Modales ───────────────────────────────────────────────────────────────
function cerrarLentessModal() {
  const modal = document.getElementById('lentessModal');
  if (modal) modal.style.display = 'none';
}
function abrirStockModal() {
  renderStockModal();
  const modal = document.getElementById('stockModal');
  if (modal) modal.style.display = 'flex';
}
function closeStockModal() {
  const modal = document.getElementById('stockModal');
  if (modal) modal.style.display = 'none';
}
function closeExport() {
  const modal = document.getElementById('exportModal');
  if (modal) modal.style.display = 'none';
}
function goBackSecondary() {
  if (window.history.length > 1) window.history.back();
  else { closeSide(); closeExport(); closeStockModal(); }
}


// ── Configurar alertas ────────────────────────────────────────────────────
function configurarAlertas() {
  const dias = prompt(
    'Días para alertas (separados por coma):\n' +
    `Aviso: ${SETTINGS.WARN_DAYS}, Crítico: ${SETTINGS.CRIT_DAYS}`,
    `${SETTINGS.WARN_DAYS},${SETTINGS.CRIT_DAYS}`
  );
  if (!dias) return;
  const [w, c] = dias.split(',').map(n => parseInt(n.trim(), 10));
  if (w > 0) SETTINGS.WARN_DAYS = w;
  if (c > 0) SETTINGS.CRIT_DAYS = c;
  import('./state.js').then(({ saveSettings }) => { saveSettings(); render(); });
  toast('✓ Umbrales de alertas actualizados');
}

// ── Delegación de eventos ─────────────────────────────────────────────────
function initEventDelegation() {
  // Tabla: click en fila
  document.getElementById('tbody')?.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-row-click]');
    if (tr) {
      const id = tr.dataset.rowClick;
      if (e.target.type === 'checkbox') return;
      const nid = normalizeId(id);
      if (selId === nid) { closeSide(); return; }
      if (sideDirty && normalizeId(selId) !== normalizeId(nid) && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) return;
      setSelId(nid);
      render();
      openSide(nid);
    }
    // Checkbox
    const cbx = e.target.closest('.cbx');
    if (cbx) {
      e.stopPropagation();
      const id = cbx.dataset.rowId;
      if (!id) return;
      const nid = normalizeId(id);
      if (cbx.checked) { if (sideDirty && normalizeId(selId) !== normalizeId(nid) && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) { cbx.checked = false; return; } setSelId(nid); openSide(nid); }
      else { setSelId(null); closeSide(); }
      render();
    }
  });

  // Tabla: doble clic para editar inline
  document.getElementById('tbody')?.addEventListener('dblclick', e => {
    const td = e.target.closest('td');
    if (!td) return;
    if (td.dataset.inlineEdit) {
      inlineEdit(e, td.dataset.inlineEdit, td.dataset.field);
    } else if (td.dataset.inlineDate) {
      inlineEditDate(e, td.dataset.inlineDate, td.dataset.field);
    } else if (td.dataset.inlineSel) {
      const opts = td.dataset.opts.split('|');
      inlineEditSel(e, td.dataset.inlineSel, td.dataset.field, opts);
    }
  });

  // Tabla: sort headers
  document.getElementById('mainThead')?.addEventListener('click', e => {
    const div = e.target.closest('[data-sort]');
    if (div) sortBy(div.dataset.sort);
  });

  // Panel lateral: cambio en inputs/selects
  document.getElementById('sideBody')?.addEventListener('change', e => {
    const el = e.target;
    const id = el.dataset.rowId;
    const field = el.dataset.field;
    if (!id || !field) return;
    if (!sideDraft || normalizeId(sideDraft.id) !== normalizeId(id)) initSideDraft(id);
    sideDraft[field] = el.type === 'checkbox' ? !!el.checked : el.value;
    if (field === 'estadoFac') {
      if (String(sideDraft.estadoFac || '').toUpperCase() === 'FACTURADA' && !sideDraft.fechaFacturada) sideDraft.fechaFacturada = hoyISO();
      if (!sideDraft.estadoFac) sideDraft.fechaFacturada = '';
      const ff = document.querySelector(`#sideBody [data-row-id="${CSS.escape(id)}"][data-field="fechaFacturada"]`);
      if (ff) ff.value = sideDraft.fechaFacturada || '';
    }
    if (field === 'fechaCir' && !sideDraft.fechaCir) {
      sideDraft.hora = '';
      const hf = document.querySelector(`#sideBody [data-row-id="${CSS.escape(id)}"][data-field="hora"]`);
      if (hf) hf.value = '';
    }
    validarFila(sideDraft);
    markSideDirty(true);
  });

  // Panel lateral: silenciar alerta y borrar campos puntuales
  document.getElementById('sideBody')?.addEventListener('click', e => {
    const item = e.target.closest('[data-sil-key]');
    if (item) { silenciarAlerta(item.dataset.silKey); render(); return; }
    const clearBtn = e.target.closest('[data-clear-field]');
    if (!clearBtn) return;
    const id = clearBtn.dataset.rowId;
    const field = clearBtn.dataset.clearField;
    if (!id || !field) return;
    if (!sideDraft || normalizeId(sideDraft.id) !== normalizeId(id)) initSideDraft(id);
    sideDraft[field] = '';
    const input = document.querySelector(`#sideBody [data-row-id="${CSS.escape(id)}"][data-field="${CSS.escape(field)}"]`);
    if (input) input.value = '';
    validarFila(sideDraft);
    markSideDirty(true);
  });

  // Panel lateral (foot): acciones rápidas y eliminar
  document.getElementById('sideFoot')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-qa-action]');
    if (!btn) return;
    const id = btn.dataset.qaId;
    const action = btn.dataset.qaAction;
    if (action === 'solLenteHoy') await marcarSolLenteHoy(id);
    else if (action === 'lenteLlegoHoy') await marcarLenteLlegoHoy(id);
    else if (action === 'programarCirugia') await programarCirugia(id);
    else if (action === 'cirugiaRealizada') await marcarCirugiaRealizada(id);
    else if (action === 'facturadaHoy') await marcarFacturadaHoy(id);
    else if (action === 'guardarCambios') await saveSideDraft(id);
    else if (action === 'cancelarCambios') cancelSideDraft(id);
    else if (action === 'duplicar') await duplicarPaciente(id);
    else if (action === 'eliminar') await eliminar(id);
  });

  // Panel alertas: abrir paciente
  document.getElementById('alertsList')?.addEventListener('click', e => {
    const row = e.target.closest('[data-open-side]');
    if (row && !e.target.closest('.ar-sil-btn')) openSide(row.dataset.openSide);
    const silBtn = e.target.closest('.ar-sil-btn');
    if (silBtn) {
      e.stopPropagation();
      const key = silBtn.dataset.alertKey;
      const wasSilenced = silBtn.dataset.silenced === '1';
      if (wasSilenced) reactivarAlerta(key);
      else silenciarAlerta(key);
      render();
    }
  });

  // Kanban: abrir paciente
  document.getElementById('kanView')?.addEventListener('click', e => {
    const card = e.target.closest('[data-open-side]');
    if (card) openSide(card.dataset.openSide);
  });

  // Panel de trabajo del día
  document.getElementById('workdayBlocks')?.addEventListener('click', e => {
    const block = e.target.closest('[data-wdp-action]');
    if (!block) return;
    const action = block.dataset.wdpAction;
    if (action === 'urgHoy') {
      document.getElementById('fEst').value = 'FECHA PROGRAMADA';
      document.getElementById('q').value = '';
      render();
    } else if (action === 'lenteDem') {
      const btn = [...document.querySelectorAll('#quickFilters .qf-btn')].find(b => b.textContent === 'PEDIR LENTE');
      if (btn) setQuickFilter('PEDIR LENTE', btn);
    } else if (action === 'proxSinLente') {
      const btn = [...document.querySelectorAll('#quickFilters .qf-btn')].find(b => b.textContent === 'FECHA PROGRAMADA');
      if (btn) setQuickFilter('FECHA PROGRAMADA', btn);
    } else if (action === 'sinFact') {
      document.getElementById('fEst').value = 'REALIZADA';
      const btn = [...document.querySelectorAll('#quickFilters .qf-btn')].find(b => b.textContent === 'TODOS');
      if (btn) setQuickFilter('TODOS', btn);
      render();
    } else if (action === 'criticas') {
      document.getElementById('alertsPanel')?.classList.add('open');
      import('./render.js').then(({ setAlertFilter }) => {
        setAlertFilter('criticas', document.getElementById('af-criticas'));
      });
    }
  });

  // Overlay cierra panel
  document.getElementById('sideOverlay')?.addEventListener('click', () => { if (sideDirty && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) return; closeSide(); });
  document.getElementById('btnSideBack')?.addEventListener('click', () => { if (sideDirty && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) return; closeSide(); });

  // Filtros
  document.getElementById('q')?.addEventListener('input', () => {
    clearTimeout(window._filterTimer);
    window._filterTimer = setTimeout(render, 180);
  });
  ['fCli', 'fEst', 'fOS', 'showSilenced', 'hideFinalizadasSinAccion'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (id === 'hideFinalizadasSinAccion') {
        setHideFinalizadasSinAccion(!!document.getElementById('hideFinalizadasSinAccion')?.checked);
      }
      render();
      const saved = {
        fCli: document.getElementById('fCli')?.value || '',
        fEst: document.getElementById('fEst')?.value || '',
        fOS: document.getElementById('fOS')?.value || '',
        showSilenced: document.getElementById('showSilenced')?.checked || false
      };
      localStorage.setItem('cirugias_saved_filters', JSON.stringify(saved));
    });
  });

  // Quick filter buttons
  document.getElementById('quickFilters')?.addEventListener('click', e => {
    const btn = e.target.closest('.qf-btn');
    if (btn) setQuickFilter(btn.dataset.qf || btn.textContent.trim(), btn);
  });

  // Alert filter buttons
  document.querySelector('.alerts-filters')?.addEventListener('click', e => {
    const btn = e.target.closest('.af-btn');
    if (btn) {
      const id = btn.id.replace('af-', '');
      import('./render.js').then(({ setAlertFilter }) => setAlertFilter(id, btn));
    }
  });

  // Tab buttons
  document.querySelector('.tabrow')?.addEventListener('click', e => {
    const btn = e.target.closest('.tablink');
    if (!btn) return;
    const tab = btn.dataset.tab || 'tabla';
    setTab(tab, btn);
  });



  // Botones de cabecera y modales
  document.getElementById('connectorBadge')?.addEventListener('click', probarConexion);
  document.getElementById('btnNuevo')?.addEventListener('click', nuevoModal);
  document.getElementById('btnSync')?.addEventListener('click', sincronizarAhora);
  document.getElementById('btnLentess')?.addEventListener('click', abrirLentessModal);
  document.getElementById('toggleKpisBtn')?.addEventListener('click', toggleKpis);
  document.getElementById('btnConfigurarURL')?.addEventListener('click', configurarURL);
  document.getElementById('btnExportarListos')?.addEventListener('click', exportarListos);
  document.getElementById('btnExportarDia')?.addEventListener('click', exportarCirugiasDelDia);
  document.getElementById('btnStock')?.addEventListener('click', abrirStockModal);
  document.getElementById('btnExportarVista')?.addEventListener('click', exportarFiltradoExcel);
  document.getElementById('btnBackup')?.addEventListener('click', exportarBackupJSON);
  document.getElementById('btnImportar')?.addEventListener('click', importarBackupJSON);
  document.getElementById('btnReparar')?.addEventListener('click', repararCache);
  document.getElementById('btnConfigAlertas')?.addEventListener('click', configurarAlertas);
  document.getElementById('btnLimpiarFiltros')?.addEventListener('click', clearTopFilters);
  document.getElementById('alertsToggle')?.addEventListener('click', () => document.getElementById('alertsPanel')?.classList.toggle('open'));
  document.getElementById('btnCloseAlerts')?.addEventListener('click', () => document.getElementById('alertsPanel')?.classList.remove('open'));
  document.getElementById('btnCloseStock')?.addEventListener('click', closeStockModal);
  document.getElementById('btnCloseStock2')?.addEventListener('click', closeStockModal);
  document.getElementById('btnCloseLentess')?.addEventListener('click', cerrarLentessModal);
  document.getElementById('btnCloseRecetas')?.addEventListener('click', cerrarModalRecetas);
  document.getElementById('btnCloseRecetas2')?.addEventListener('click', cerrarModalRecetas);
  document.getElementById('btnCloseLentess2')?.addEventListener('click', cerrarLentessModal);
  document.getElementById('btnCloseExport')?.addEventListener('click', closeExport);
  document.getElementById('btnCloseExport2')?.addEventListener('click', closeExport);
  document.getElementById('btnCopyExcel')?.addEventListener('click', copyExcel);
  document.getElementById('btnDownloadListos')?.addEventListener('click', downloadExcelListos);
  document.getElementById('exportModal')?.addEventListener('click', e => { if (e.target.id === 'exportModal') closeExport(); });
  document.getElementById('stockModal')?.addEventListener('click', e => { if (e.target.id === 'stockModal') closeStockModal(); });
  document.getElementById('lentessModal')?.addEventListener('click', e => { if (e.target.id === 'lentessModal') cerrarLentessModal(); });
  document.getElementById('recetasModal')?.addEventListener('click', e => { if (e.target.id === 'recetasModal') cerrarModalRecetas(); });

  // Resize
  window.addEventListener('resize', updateStickyMetrics);
}



function toExcelFile(filename, headers, rows) {
  const table = `<table><thead><tr>${headers.map(h => `<th>${String(h ?? '')}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${String(v ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html = `<html><head><meta charset="utf-8"></head><body>${table}</body></html>`;
  const b = new Blob([html], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = filename;
  a.click();
}

function buildTSVListos() {
  const listos = DB.rows.filter(p => estado(p) === 'PEDIR LENTE');
  return 'clinica\tnombre\tdni\tobra_social\tafiliado\tojo\tdioptria\n' +
    listos.map(p => [p.clinica, p.nombre, p.dni, p.obraSocial, p.afiliado || '', p.ojo, getDioptria(p)].join('\t')).join('\n');
}

function copyExcel() {
  navigator.clipboard.writeText(buildTSVListos()).then(() => toast('Datos copiados (TSV para Excel)'));
}

function downloadExcelListos() {
  const listos = DB.rows.filter(p => estado(p) === 'PEDIR LENTE');
  toExcelFile('listos_lente.xls', ['Clínica','Nombre','DNI','O. Social','N° Afiliado','Ojo','Dioptría'], listos.map(p => [p.clinica, p.nombre, p.dni, p.obraSocial, p.afiliado || '', p.ojo, getDioptria(p)]));
  toast('Excel descargado');
}

function renderStockModal() {
  DB.lensStock = DB.lensStock || [];
  const rows = [...DB.lensStock].sort((a, b) => (a.model || '').localeCompare(b.model || '') || String(a.dioptria || '').localeCompare(String(b.dioptria || '')));
  const body = document.getElementById('stockBody');
  if (!body) return;
  body.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn primary" id="btnAddStockInline">+ Cargar stock</button></div>
    ${rows.length ? `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>${['Modelo','Dioptría','Stock','Estado'].map(h => `<th style="padding:7px 10px;background:#f1f5f9;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e2e8f0">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(x => `<tr>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${x.model || ''}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${x.dioptria || ''}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${x.stock || 0}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;color:${(x.stock || 0) <= 1 ? '#dc2626' : '#059669'}">${(x.stock || 0) <= 1 ? 'CRÍTICO' : 'OK'}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div class="empty" style="padding:20px">Sin stock cargado.</div>'}`;
  document.getElementById('btnAddStockInline')?.addEventListener('click', cargarStockLente);
}

function cargarStockLente() {
  const model = prompt('Modelo de lente:'); if (!model) return;
  const dioptria = prompt('Dioptría:'); if (!dioptria) return;
  const stock = parseInt(prompt('Stock a cargar:', '1') || '0', 10);
  DB.lensStock = DB.lensStock || [];
  let it = DB.lensStock.find(x => x.model === model && x.dioptria === dioptria);
  if (!it) { it = { model, dioptria, stock: 0 }; DB.lensStock.push(it); }
  it.stock += Math.max(stock, 0);
  localStorage.setItem('cirugias_cache', JSON.stringify(DB));
  idbSet('cirugias_cache', DB);
  renderStockModal();
  render();
  toast('Stock actualizado');
}

function getFilteredRowsForLentess() {
  return filtered().filter(p =>
    String(p.obraSocial || '').trim().toUpperCase() === 'PAMI' &&
    estado(p) === 'PEDIR LENTE' &&
    cleanDigits(p.afiliado || '').length >= 8 &&
    String(p.ojo || '').trim() &&
    String(getDioptria(p) || '').trim()
  );
}

function buildLentessPayload(rows) {
  return rows.map(p => ({
    sourceId: p.id,
    nombre: String(p.nombre || '').trim(),
    afiliado: cleanDigits(p.afiliado || ''),
    ojo: String(p.ojo || '').trim().toUpperCase(),
    lio: String(getDioptria(p) || '').trim(),
    clinica: p.clinica || ''
  }));
}

let LENTESS_CTX = { sourceRows: [], validRows: [] };
const LENTESS_CREDS_KEY = 'pami_lentess_creds';
let LENTESS_RUNNING = false;

function getPamiLentessCreds() {
  try { return JSON.parse(localStorage.getItem(LENTESS_CREDS_KEY) || '{}') || {}; } catch (_) { return {}; }
}

function abrirLentessModal() {
  const sourceRows = filtered();
  const validRows = buildLentessPayload(getFilteredRowsForLentess());
  if (!validRows.length) { toast('Sin pacientes válidos para Lentess en el filtro actual'); return; }
  const creds = getPamiLentessCreds();
  LENTESS_CTX = { sourceRows, validRows };
  const body = document.getElementById('lentessBody');
  if (!body) return;
  body.innerHTML = `
    <div id="lentessJobStatus" style="font-size:12px;color:#64748b;margin-bottom:8px">Listo para ejecutar en conector local.</div>
    <p style="font-size:12px;color:#6b7280;margin-bottom:8px">Filtradas: <b>${sourceRows.length}</b> · Válidas Lentess: <b>${validRows.length}</b></p>
    <label style="font-size:12px;display:block;margin:0 0 10px">Fecha solicitud a registrar
      <input id="lentessFechaSol" class="input" type="date" value="${hoyISO()}" style="width:220px;margin-top:4px">
    </label>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:0 0 10px">
      <label style="font-size:12px">Usuario PAMI
        <input id="lentessUser" class="input" type="text" value="${escapeAttr(creds.user || '')}" style="width:100%;margin-top:4px">
      </label>
      <label style="font-size:12px">Contraseña PAMI
        <input id="lentessPass" class="input" type="password" value="${escapeAttr(creds.pass || '')}" style="width:100%;margin-top:4px">
      </label>
    </div>
    <label style="font-size:12px;display:inline-flex;gap:6px;align-items:center;margin-bottom:10px">
      <input id="lentessRemember" type="checkbox" ${(creds.user || creds.pass) ? 'checked' : ''}> guardar credenciales en este navegador
    </label>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>${['Nombre','Afiliado','Ojo','Lio/Dioptría','Clínica'].map(h => `<th style="padding:7px 10px;background:#f1f5f9;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e2e8f0">${h}</th>`).join('')}</tr></thead>
      <tbody>${validRows.map(p => `<tr>${[p.nombre,p.afiliado,p.ojo,p.lio,p.clinica].map(v => `<td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${escapeAttr(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn primary" id="btnRunLentess">▶ Ejecutar Lentess</button>
    </div>`;
  document.getElementById('btnRunLentess')?.addEventListener('click', descargarScriptLentess);
  const modal = document.getElementById('lentessModal');
  if (modal) modal.style.display = 'flex';
}

function lentessGuardarCreds() {
  const remember = !!document.getElementById('lentessRemember')?.checked;
  const user = String(document.getElementById('lentessUser')?.value || '').trim();
  const pass = String(document.getElementById('lentessPass')?.value || '').trim();
  if (!remember) { localStorage.removeItem(LENTESS_CREDS_KEY); return { user, pass }; }
  localStorage.setItem(LENTESS_CREDS_KEY, JSON.stringify({ user, pass }));
  return { user, pass };
}

function descargarScriptLentess() {
  if (LENTESS_RUNNING) return;
  const rows = LENTESS_CTX.validRows || [];
  if (!rows.length) { toast('Sin pacientes válidos para Lentess'); return; }
  const cfg = lentessGuardarCreds();
  if (!cfg.user || !cfg.pass) { toast('Completar usuario y contraseña PAMI'); return; }
  const fechaSol = String(document.getElementById('lentessFechaSol')?.value || '').trim() || hoyISO();
  const payload = { credenciales: { user: cfg.user, pass: cfg.pass }, pacientes: rows.map(r => ({ afiliado: r.afiliado, ojo: r.ojo, lio: r.lio })) };
  const runBtn = document.getElementById('btnRunLentess');
  LENTESS_RUNNING = true;
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = '⏳ Ejecutando Lentess...'; }
  renderJobStatus('lentessJobStatus', 'run', '⏳ Verificando conector...');
  connectorStartJob('lentess', payload)
    .then(jobId => {
      toast('✅ Lentess: proceso iniciado');
      renderJobStatus('lentessJobStatus', 'run', `⚙️ Procesando solicitudes... (job ${String(jobId).slice(0, 8)})`);
      return connectorPollJob(jobId, s => {
        const label = s._label || `⚙️ ${s.status || 'en curso'}`;
        renderJobStatus('lentessJobStatus', 'run', label);
      });
    })
    .then(() => {
      rows.forEach(r => {
        const row = findRow(r.sourceId);
        if (row) row.fechaSolLente = fechaSol;
      });
      return Promise.all(rows.map(r => {
        const row = findRow(r.sourceId);
        return row ? save(row) : Promise.resolve();
      }));
    })
    .then(() => {
      toast('✅ Lentess completado correctamente');
      renderJobStatus('lentessJobStatus', 'ok', '✅ Todas las solicitudes guardadas y fecha de solicitud aplicada.');
      render();
    })
    .catch(err => {
      const msg = String(err?.message || 'Error de ejecución');
      toast('❌ ' + msg);
      renderJobStatus('lentessJobStatus', /no detectado|no está corriendo|iniciar/i.test(msg) ? 'off' : 'err', `❌ ${msg}`);
    })
    .finally(() => {
      LENTESS_RUNNING = false;
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = '▶ Ejecutar Lentess'; }
    });
}

// ── Restaurar filtros guardados ───────────────────────────────────────────
function restoreFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem('cirugias_saved_filters') || '{}');
    ['fCli', 'fEst', 'fOS'].forEach(id => {
      if (saved[id] !== undefined) {
        const el = document.getElementById(id);
        if (el) el.value = saved[id];
      }
    });
    if (saved.showSilenced !== undefined) {
      const el = document.getElementById('showSilenced');
      if (el) el.checked = !!saved.showSilenced;
    }
    const hf = document.getElementById('hideFinalizadasSinAccion');
    if (hf) hf.checked = hideFinalizadasSinAccion;
  } catch (_) { }
}

// ── Punto de entrada: arranca la app ─────────────────────────────────────
window.__appStarted = false;
window.startOriginalApp = async function () {
  if (window.__appStarted) return;
  window.__appStarted = true;

  // 1. Escuchar evento de Firestore
  window.addEventListener('firestoreReady', activateFirestoreIfReady);

  // 2. Cargar caché local inmediatamente
  try {
    const cached = localStorage.getItem('cirugias_cache') || await idbGet('cirugias_cache');
    if (cached) {
      const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      if (parsed && Array.isArray(parsed.rows)) {
        setDB(parsed);
        showSyncBadge('⟳ Cargando desde caché...', 'blue');
      }
    }
  } catch (e) { console.warn('[Init] error leyendo caché:', e.message); }

  // 3. Normalizar y renderizar con datos locales
  normalizarData();
  backupDiario();
  restoreKpisPref();
  restoreFilters();
  initEventDelegation();
  updateStickyMetrics();
  render();

  // 4. Conectar Firestore en paralelo
  if (window.firestoreConnector) {
    activateFirestoreIfReady();
  } else {
    showSyncBadge('⟳ Esperando Firebase...', 'blue');
    setTimeout(async () => {
      if (!window.__firestoreEnabled) {
        await loadFromServer();
        normalizarData();
        render();
      }
    }, 6000);
  }
};
  window.addEventListener('side:opened', e => initSideDraft(e.detail.id));
  window.addEventListener('side:closed', () => { sideDraft = null; markSideDirty(false); });
