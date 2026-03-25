// render.js — Funciones de render: tabla, panel lateral, alertas, kanban, calendario

'use strict';

import { escapeHtml, escapeAttr, jsq, fd, fdInput, toast } from './utils.js';
import {
  DB, selId, setSelId, sortCol, sortDir, setSortCol, setSortDir,
  currentTab, SETTINGS, ALERT_SILENCES,
  estado, alertas, proximaAccion, filtered, duplicateNewestIds,
  secondEyeMissing, isFacturadoCompleto, getDioptria, clinicaClass, practicasExtrasTexto, getEstadoCirCalculado, getFechaFacturadaBase,
  bc, estadoLabelCanon, estadoLabelNorm, normalizeId, findRow,
  validarFila, silenciarAlerta, reactivarAlerta, isSilenced,
  backupDiario
} from './state.js';
import { hoyISO, diffDays, toDateOnly } from './utils.js';

// ── Columnas de la tabla principal ────────────────────────────────────────
export const MAIN_TABLE_COLUMNS = [
  { key: 'check', label: '', width: '36px', thClass: 'th-check', sortable: false },
  { key: 'nombre', label: '#&nbsp; Nombre', width: '17%', sortable: true, sortKey: 'nombre' },
  { key: 'dni', label: 'DNI', width: '7%', sortable: true, sortKey: 'dni' },
  { key: 'clinica', label: 'Clínica', width: '5%' },
  { key: 'osocial', label: 'O.Social', width: '6%' },
  { key: 'ojo', label: 'Ojo', width: '4%' },
  { key: 'dioptria', label: 'Dioptría', width: '6%' },
  { key: 'solLente', label: 'Pedir lente', width: '7%', sortable: true, sortKey: 'fechaSolLente' },
  { key: 'llego', label: 'Lente llegó', width: '7%', sortable: true, sortKey: 'fechaLlegaLente' },
  { key: 'fechaCir', label: 'Fecha cirugía', width: '8%', sortable: true, sortKey: 'fechaCir' },
  { key: 'adicionales', label: 'Adicionales', width: '9%' },
  { key: 'estadoActual', label: 'Estado actual', width: '14%' },
  { key: 'proximaAccion', label: 'Próxima acción', width: '190px' },
];

// ── Render principal ──────────────────────────────────────────────────────
export function render() {
  refreshEstadoFilterOptions();
  renderStats();
  renderAlerts();
  renderWorkdayPanel();
  if (currentTab === 'tabla') renderTabla();
  else if (currentTab === 'kanban') renderKanban();
  else if (currentTab === 'calendario') renderCalendario();
  else if (currentTab === 'estadisticas') renderEstadisticasLazy();
  else if (currentTab === 'facturacion') renderFacturacionLazy();
  else renderWhatsAppTab();
}

// ── Opciones del selector de estado ──────────────────────────────────────
export function refreshEstadoFilterOptions() {
  const sel = document.getElementById('fEst');
  if (!sel) return;
  const current = sel.value || '';
  const map = new Map();
  DB.rows.forEach(r => {
    const st = estadoLabelCanon(estado(r));
    const key = estadoLabelNorm(st);
    if (key && !map.has(key)) map.set(key, st);
  });
  const pref = [
    'PEDIR LENTE',
    'ESPERANDO LENTE',
    'LLEGÓ LENTE - PROGRAMAR CIRUGÍA',
    'FECHA PROGRAMADA',
    'REALIZADA',
    'FACTURADA',
    'FINALIZADA | FALTA OJO DERECHO',
    'FINALIZADA | FALTA OJO IZQUIERDO',
    'FINALIZADO',
    'DEVOLVER LENTE',
  ];
  const ordered = [
    ...pref.filter(st => Array.from(map.values()).some(v => estadoLabelNorm(v) === estadoLabelNorm(st))),
    ...Array.from(map.values()).filter(v => !pref.some(st => estadoLabelNorm(st) === estadoLabelNorm(v))).sort((a, b) => a.localeCompare(b, 'es')),
  ];
  sel.innerHTML = '<option value="">Todos los estados</option>' +
    ordered.map(st => `<option value="${escapeAttr(st)}">${escapeHtml(st)}</option>`).join('');
  if (current && ordered.some(st => estadoLabelNorm(st) === estadoLabelNorm(current))) {
    const found = ordered.find(st => estadoLabelNorm(st) === estadoLabelNorm(current));
    if (found) sel.value = found;
  }
}

// ── KPIs / Estadísticas rápidas ───────────────────────────────────────────
export function renderStats() {
  const all = DB.rows;
  let nalerts = 0, nprog = 0, nreal = 0, nCDU = 0, nGchu = 0, nFact = 0, nCrit = 0;
  all.forEach(p => {
    const ars = alertas(p);
    nalerts += ars.length;
    nCrit += ars.filter(a => a.severity === 'red').length;
    const e = estado(p);
    if (e === 'FECHA PROGRAMADA') nprog++;
    if (e === 'REALIZADA' || e === 'FACTURADA' || e === 'FINALIZADO') nreal++;
    if (isFacturadoCompleto(p.estadoFac)) nFact++;
    if (p.clinica === 'CDU') nCDU++;
    if (p.clinica === 'Gualeguaychú') nGchu++;
  });
  const statsbar = document.getElementById('statsbar');
  if (!statsbar) return;
  statsbar.innerHTML = `
    <div class="stat"><div class="stat-n">👥 ${new Set(all.map(x => String(x.dni || '').trim()).filter(Boolean)).size}</div><div class="stat-l">Pacientes</div></div>
    <div class="stat"><div class="stat-n">🗂 ${all.length}</div><div class="stat-l">Cirugías</div></div>
    <div class="stat"><div class="stat-n">📅 ${nprog}</div><div class="stat-l">Programadas</div></div>
    <div class="stat"><div class="stat-n">✅ ${nreal}</div><div class="stat-l">Realizadas</div></div>
    <div class="stat"><div class="stat-n">💳 ${nFact}</div><div class="stat-l">Facturadas</div></div>
    <div class="stat"><div class="stat-n">⚠️ ${nalerts}</div><div class="stat-l">Alertas</div></div>
    <div class="stat"><div class="stat-n">🚨 ${nCrit}</div><div class="stat-l">Críticas</div></div>
    <div class="stat"><div class="stat-n">🏥 ${nCDU}</div><div class="stat-l">CDU</div></div>
    <div class="stat"><div class="stat-n">🏥 ${nGchu}</div><div class="stat-l">Gualeguaychú</div></div>`;
  const alertsCount = document.getElementById('alertsCount');
  const alertsToggle = document.getElementById('alertsToggle');
  if (alertsCount) alertsCount.textContent = nalerts;
  if (alertsToggle) alertsToggle.classList.toggle('has-alerts', nalerts > 0);
}

// ── Panel alertas ─────────────────────────────────────────────────────────
let _alertFilter = 'TODAS';

export function setAlertFilter(f, el) {
  _alertFilter = f;
  document.querySelectorAll('.af-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderAlerts();
}

function alertActionText(type) {
  const map = {
    devolver: '↩ Devolver lente al proveedor',
    not_scheduled: '📅 Programar fecha de cirugía',
    lens_not_requested: '📋 Pedir lente urgente',
    lens_delayed: '📞 Llamar al proveedor',
    no_schedule_after_arrival: '📅 Asignar fecha de cirugía',
    scheduled_no_lens: '🚨 Gestionar lente urgente',
    billing_pending: '💰 Ingresar a facturación',
    second_surgery_missing: '👁 Programar segundo ojo',
  };
  return map[type] || 'Ver paciente';
}

export function toggleAlerts() {
  document.getElementById('alertsPanel').classList.toggle('open');
}

export function renderAlerts() {
  const showSilenced = !!document.getElementById('showSilenced')?.checked;
  const withAlerts = DB.rows.map(p => ({ p, alerts: alertas(p) })).filter(x => x.alerts.length > 0);
  let flat = withAlerts.flatMap(x =>
    x.alerts.filter(a => showSilenced || !isSilenced(a)).map(a => ({ p: x.p, a }))
  );
  if (_alertFilter === 'criticas') flat = flat.filter(({ a }) => a.severity === 'red');
  else if (_alertFilter !== 'TODAS') flat = flat.filter(({ a }) => a.type === _alertFilter);
  flat.sort((x, y) => {
    const sev = { red: 0, orange: 1, yellow: 2, neutral: 3 };
    return (sev[x.a.severity] ?? 3) - (sev[y.a.severity] ?? 3);
  });
  const titleEl = document.getElementById('alertsTitle');
  if (titleEl) titleEl.textContent = `⚠ ${flat.length} alertas`;
  const sevColor = { red: '#dc2626', orange: '#ea580c', yellow: '#a16207', neutral: '#6b7280' };
  const sevBg = { red: '#fef2f2', orange: '#fff7ed', yellow: '#fefce8', neutral: '#f8fafc' };
  const listEl = document.getElementById('alertsList');
  if (!listEl) return;
  listEl.innerHTML = flat.length ? flat.map(({ p, a }) => `
    <div class="alert-row" style="background:${sevBg[a.severity] || '#f8fafc'}" data-open-side="${escapeAttr(p.id)}">
      <div>
        <div class="ar-name">${escapeHtml(p.nombre || '—')} <span style="font-size:10px;color:#9ca3af;font-weight:400">· ${escapeHtml(p.clinica)}</span></div>
        <div style="font-size:11px;color:${sevColor[a.severity] || '#6b7280'};font-weight:700;margin-top:2px">${escapeHtml(a.msg)}</div>
        <div class="ar-action">${escapeHtml(alertActionText(a.type))}</div>
      </div>
      <button class="ar-sil-btn" data-alert-key="${escapeAttr(a.key)}" data-silenced="${isSilenced(a) ? '1' : '0'}" title="${isSilenced(a) ? 'Reactivar' : 'Silenciar'}">${isSilenced(a) ? '↺' : '✕'}</button>
    </div>`).join('') :
    '<div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">Sin alertas en esta categoría ✓</div>';
}

// ── Panel "Trabajo del día" ───────────────────────────────────────────────
export function renderWorkdayPanel() {
  const hoy = hoyISO();
  const all = DB.rows;
  const urgHoy = all.filter(p => p.fechaCir === hoy && estado(p) === 'FECHA PROGRAMADA');
  const blocks = [
    { icon: '🗓', label: 'Cirugías hoy', n: urgHoy.length, color: '#dc2626', bg: '#fef2f2', action: 'urgHoy' },
  ].filter(b => b.n > 0);
  const container = document.getElementById('workdayBlocks');
  if (!container) return;
  if (!blocks.length) {
    container.innerHTML = '<div style="grid-column:1/-1;padding:10px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;color:#065f46;font-size:12px;font-weight:600">✅ Todo al día — sin pendientes urgentes</div>';
  } else {
    container.innerHTML = blocks.map(b => `
      <div class="wdp-block" data-wdp-action="${b.action}" style="background:${b.bg};border-color:${b.color}44">
        <div class="wdp-icon">${b.icon}</div>
        <div><div class="wdp-n" style="color:${b.color}">${b.n}</div><div class="wdp-l">${b.label}</div></div>
      </div>`).join('');
  }
  const panel = document.getElementById('workdayPanel');
  if (panel) panel.style.display = currentTab === 'tabla' ? 'block' : 'none';
}

// ── Tabla principal ───────────────────────────────────────────────────────
export function renderMainTableHeader() {
  const colgroup = document.getElementById('mainColgroup');
  const thead = document.getElementById('mainThead');
  if (!colgroup || !thead) return;
  colgroup.innerHTML = MAIN_TABLE_COLUMNS.map(c => `<col style="width:${c.width}">`).join('');
  thead.innerHTML = `<tr>${MAIN_TABLE_COLUMNS.map(c => {
    const label = c.sortable ? `${c.label} ↕` : c.label;
    const cls = c.thClass ? ` class="${c.thClass}"` : '';
    const sortAttr = c.sortable ? ` data-sort="${c.sortKey || c.key}"` : '';
    return `<th${cls}><div class="th-inner"${sortAttr}>${label}</div></th>`;
  }).join('')}</tr>`;
  const chkWrap = thead.querySelector('th.th-check .th-inner');
  if (chkWrap) {
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = 'chkAll';
    chkWrap.innerHTML = '';
    chkWrap.appendChild(chk);
    chk.addEventListener('change', () => {
      if (!chk.checked) { setSelId(null); closeSide(); render(); }
    });
  }
}

function facBadgeCls(fac) {
  const f = (fac || '').toUpperCase();
  if (f === 'FACTURADA') return 'b7';
  return 'b7';
}

export function renderTabla() {
  renderMainTableHeader();
  const rows = filtered();
  const dupIds = duplicateNewestIds();
  const tbody = document.getElementById('tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${MAIN_TABLE_COLUMNS.length}"><div class="empty">No hay pacientes con esos filtros.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((p, i) => {
    const e = estado(p);
    const sel = normalizeId(p.id) === normalizeId(selId);
    const dup = dupIds.has(p.id);
    const rowAlerts = alertas(p);
    const topA = rowAlerts.find(a => a.severity === 'red') || rowAlerts.find(a => a.severity === 'orange') || rowAlerts[0];
    const alertDot = topA ? `<span title="${escapeAttr(topA.msg)}" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${topA.severity === 'red' ? '#dc2626' : topA.severity === 'orange' ? '#f97316' : '#f59e0b'};margin-left:5px;flex-shrink:0"></span>` : '';
    const pa = proximaAccion(p);
    const rowCells = {
      check: `<td class="th-check" data-label="Selección"><div class="cell" style="justify-content:center"><input type="checkbox" class="cbx" data-row-id="${escapeAttr(p.id)}" ${sel ? 'checked' : ''}></div></td>`,
      nombre: `<td data-label="Nombre"><div class="cell" title="${escapeAttr(p.nombre || '—')}"><span style="color:#9ca3af;margin-right:6px;font-size:10px">${i + 1}</span>${escapeHtml(p.nombre || '—')}${alertDot}</div></td>`,
      dni: `<td data-label="DNI"><div class="cell" style="color:#6b7280" title="${escapeAttr(p.dni || '—')}">${escapeHtml(p.dni || '—')}</div></td>`,
      clinica: `<td data-label="Clínica"><div class="cell" title="${escapeAttr(p.clinica || '—')}"><span class="${clinicaClass(p.clinica)}">${escapeHtml(p.clinica)}</span></div></td>`,
      osocial: `<td data-label="O.Social"><div class="cell" title="${escapeAttr(p.obraSocial || '—')}">${escapeHtml(p.obraSocial || '—')}</div></td>`,
      ojo: `<td data-label="Ojo"><div class="cell"><strong>${escapeHtml(p.ojo || '—')}</strong></div></td>`,
      dioptria: `<td class="editable" data-label="Dioptría" data-inline-edit="${escapeAttr(p.id)}" data-field="dioptria" title="Doble clic para editar"><div class="cell" title="${escapeAttr(getDioptria(p) || '—')}">${escapeHtml(getDioptria(p) || '—')}</div></td>`,
      solLente: `<td class="editable" data-label="Sol.Lente." data-inline-date="${escapeAttr(p.id)}" data-field="fechaSolLente" title="Doble clic para editar"><div class="cell" title="${escapeAttr(fd(p.fechaSolLente))}">${escapeHtml(fd(p.fechaSolLente))}</div></td>`,
      llego: `<td class="editable" data-label="Llegó." data-inline-date="${escapeAttr(p.id)}" data-field="fechaLlegaLente" title="Doble clic para editar"><div class="cell" style="color:${p.fechaLlegaLente ? '#059669' : 'inherit'}" title="${escapeAttr(fd(p.fechaLlegaLente))}">${escapeHtml(fd(p.fechaLlegaLente))}</div></td>`,
      fechaCir: `<td class="editable" data-label="Fecha.Cir" data-inline-date="${escapeAttr(p.id)}" data-field="fechaCir" title="Doble clic para editar"><div class="cell" title="${escapeAttr(fd(p.fechaCir))}">${escapeHtml(fd(p.fechaCir))}</div></td>`,
      adicionales: `<td data-label="Adicionales"><div class="cell">${practicasExtrasTexto(p) ? `<span class="badge b-extra">${escapeHtml(practicasExtrasTexto(p))}</span>` : '—'}</div></td>`,
      estadoActual: `<td data-label="Estado actual"><div class="cell" title="${escapeAttr(e)}"><span class="badge ${bc(e)}">${escapeHtml(e.length > 28 ? e.substring(0, 26) + '…' : e)}</span></div></td>`,
      proximaAccion: `<td data-label="Próxima acción"><div class="cell"><span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;color:${pa.color};background:${pa.bg};white-space:nowrap">${pa.icon} ${escapeHtml(pa.label)}</span></div></td>`,
    };
    const tds = MAIN_TABLE_COLUMNS.map(c => rowCells[c.key]).join('');
    const hasCritRow = rowAlerts.some(a => a.severity === 'red');
    const hasWarnRow = rowAlerts.some(a => a.severity === 'orange' || a.severity === 'yellow');
    const rowSevCls = hasCritRow ? 'row-crit' : hasWarnRow ? 'row-warn' : (e === 'FINALIZADO' ? 'row-ok' : '');
    return `<tr class="${sel ? 'selected' : ''} ${dup ? 'dup-error' : ''} ${rowSevCls}" data-row-click="${escapeAttr(p.id)}">${tds}</tr>`;
  }).join('');
}

// ── Kanban ────────────────────────────────────────────────────────────────
const KANCOLS = [
  { key: 'FALTA DIOPTRÍA', label: 'Falta dioptría' },
  { key: 'PEDIR LENTE', label: 'Pedir lente' },
  { key: 'ESPERANDO LENTE', label: 'Esperando lente' },
  { key: 'LLEGÓ LENTE - PROGRAMAR CIRUGÍA', label: 'Programar cirugía' },
  { key: 'FECHA PROGRAMADA', label: 'Fecha programada' },
  { key: 'REALIZADA', label: 'Realizada' },
  { key: 'FACTURADA', label: 'Facturada' },
  { key: 'FINALIZADO', label: 'Finalizado' },
];

export function renderKanban() {
  const data = filtered();
  const kanView = document.getElementById('kanView');
  if (!kanView) return;
  kanView.innerHTML = `<div class="kanban">${KANCOLS.map(col => {
    const cards = data.filter(p => estado(p) === col.key);
    return `<div class="kancol">
      <div class="kancol-h"><span>${escapeHtml(col.label)}</span><span class="kancol-n">${cards.length}</span></div>
      <div>${cards.length ? cards.map(p => {
      const als = alertas(p);
      return `<div class="kancard" data-open-side="${escapeAttr(p.id)}">
            <div class="kancard-name">${escapeHtml(p.nombre || '—')}</div>
            <div class="kancard-meta">
              <span>${escapeHtml(p.ojo || '')}</span>
              <span class="${clinicaClass(p.clinica)}" style="border-radius:4px;padding:1px 5px">${escapeHtml(p.clinica)}</span>
            </div>
            ${als.length ? `<div class="kancard-alert">⚠ ${escapeHtml(als[0].msg || '')}</div>` : ''}
          </div>`;
    }).join('') : '<div style="color:#9ca3af;font-size:11px;font-style:italic;padding:4px">Sin pacientes</div>'}
      </div>
    </div>`;
  }).join('')}</div>`;
}

// ── Calendario ────────────────────────────────────────────────────────────
export function renderCalendario() {
  const rows = filtered().filter(p => p.fechaCir);
  const by = {};
  rows.forEach(p => {
    const k = p.fechaCir;
    if (!by[k]) by[k] = [];
    by[k].push(p);
  });
  const dias = Object.keys(by).sort();
  const calView = document.getElementById('calView');
  if (!calView) return;
  calView.innerHTML = dias.map(d => {
    const items = by[d].slice().sort((a, b) => String(a.hora || '').localeCompare(String(b.hora || '')));
    return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="font-weight:700;color:#1e40af;margin-bottom:6px">${escapeHtml(fd(d))}</div>
      <ul style="padding-left:18px">${items.map(p => {
        const extras = practicasExtrasTexto(p);
        const detail = extras ? ` (${extras})` : '';
        const hora = p.hora ? ` · ${escapeHtml(p.hora)}` : '';
        return `<li style="margin:3px 0">${escapeHtml(p.nombre || '—')} ${escapeHtml(p.ojo || '')}${escapeHtml(detail)}${hora}</li>`;
      }).join('')}</ul>
    </div>`;
  }).join('') || '<div class="empty">No hay cirugías programadas.</div>';
}

// ── Panel lateral ─────────────────────────────────────────────────────────
export function openSide(id) {
  setSelId(id);
  const p = findRow(id);
  if (!p) return;
  const e = estado(p);
  const als = alertas(p);
  const sideNameEl = document.getElementById('sideName');
  const sideSubEl = document.getElementById('sideSub');
  if (sideNameEl) sideNameEl.textContent = p.nombre || '—';
  if (sideSubEl) sideSubEl.textContent = `DNI ${p.dni} · ${p.clinica} · ${p.obraSocial}`;
  const bcl = bc(e);
  const bcMap = { b0: '#fee2e2', b1: '#ffedd5', b2: '#fef9c3', b3: '#dbeafe', b4: '#ede9fe', b5: '#d1fae5', b6: '#dcfce7', b7: '#bbf7d0', b8: '#fce7f3', b9: '#fef3c7' };
  const tcMap = { b0: '#991b1b', b1: '#9a3412', b2: '#854d0e', b3: '#1e40af', b4: '#5b21b6', b5: '#065f46', b6: '#14532d', b7: '#14532d', b8: '#9d174d', b9: '#78350f' };

  // Validaciones
  const validaciones = [];
  const dupCheck = DB.rows.filter(x => x.id !== p.id && String(x.dni || '').trim() === String(p.dni || '').trim() && x.ojo === p.ojo);
  if (dupCheck.length) validaciones.push({ level: 'error', msg: `⚠ Posible duplicado: ${dupCheck.map(x => `#${escapeHtml(String(x.id))} ${escapeHtml(x.nombre || '')}`).join(', ')}` });
  if (p.fechaCir && !p.fechaLlegaLente) validaciones.push({ level: 'warning', msg: '📦 Cirugía programada pero lente no llegó aún' });
  if (isFacturadoCompleto(p.estadoFac) && (p.estadoCir || '').toUpperCase() !== 'REALIZADA') validaciones.push({ level: 'warning', msg: '💰 Facturada fuerza cirugía realizada — revisar fechas' });
  if (p.fechaSolLente && p.fechaLlegaLente && p.fechaLlegaLente < p.fechaSolLente) validaciones.push({ level: 'error', msg: '📅 Fecha llegada lente anterior a la solicitud — revisar' });
  if (p.fechaCir && p.fechaLlegaLente && p.fechaCir < p.fechaLlegaLente) validaciones.push({ level: 'warning', msg: '📅 Fecha cirugía anterior a llegada del lente — verificar' });

  const sideBody = document.getElementById('sideBody');
  if (sideBody) {
    sideBody.innerHTML = `
      <div class="estado-calc" style="background:${bcMap[bcl] || '#f1f5f9'};color:${tcMap[bcl] || '#374151'}">${escapeHtml(e)}</div>
      ${als.length ? `<div class="alertas-box">${als.map(a => `
        <div class="alerta-item" data-sil-key="${escapeAttr(a.key)}" style="cursor:pointer">⚠ ${escapeHtml(a.msg)} <span style='float:right;font-size:10px;color:#9ca3af'>silenciar ✕</span></div>`).join('')}</div>` : ''}
      <div class="sgroup">
        <div class="sgroup-title">Datos del paciente</div>
        <div class="srow"><label>Nombre</label><input type="text" data-field="nombre" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.nombre || '')}"></div>
        <div class="srow"><label>DNI</label><input type="text" data-field="dni" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.dni || '')}"></div>
        <div class="srow"><label>Fecha Nac.</label><input type="date" data-field="fnac" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fnac))}"></div>
        <div class="srow"><label>Teléfono</label><input type="text" data-field="tel" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.tel || '')}"></div>
        <div class="srow"><label>Dirección</label><input type="text" data-field="dir" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.dir || '')}"></div>
        <div class="srow"><label>Clínica</label><select data-field="clinica" data-row-id="${escapeAttr(id)}">
          <option ${p.clinica === 'CDU' ? 'selected' : ''}>CDU</option>
          <option value="Gualeguaychú" ${p.clinica === 'Gualeguaychú' ? 'selected' : ''}>Gualeguaychú</option>
        </select></div>
        <div class="srow"><label>Obra Social</label><select data-field="obraSocial" data-row-id="${escapeAttr(id)}">
          <option ${p.obraSocial === 'PAMI' ? 'selected' : ''}>PAMI</option>
          <option ${p.obraSocial === 'OSER' ? 'selected' : ''}>OSER</option>
          <option ${p.obraSocial === 'PARTICULAR' ? 'selected' : ''}>PARTICULAR</option>
        </select></div>
        <div class="srow"><label>N° Afiliado</label><input type="text" data-field="afiliado" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.afiliado || '')}"></div>
      </div>
      <div class="sgroup">
        <div class="sgroup-title">Cirugía</div>
        <div class="srow"><label>Ojos a operar</label><select data-field="ojos" data-row-id="${escapeAttr(id)}">
          <option ${p.ojos === '2 ojos' ? 'selected' : ''}>2 ojos</option>
          <option ${p.ojos === '1 ojo' ? 'selected' : ''}>1 ojo</option>
        </select></div>
        <div class="srow"><label>Ojo</label><select data-field="ojo" data-row-id="${escapeAttr(id)}">
          <option ${p.ojo === 'OI' ? 'selected' : ''}>OI</option>
          <option ${p.ojo === 'OD' ? 'selected' : ''}>OD</option>
        </select></div>
        <div class="srow"><label>Dioptría</label><input type="text" data-field="dioptria" data-row-id="${escapeAttr(id)}" value="${escapeAttr(getDioptria(p) || '')}"></div>
        <div class="srow"><label>Modelo lente</label><input type="text" placeholder="Ej: Estándar / Especial" data-field="model" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.model || '')}"></div>
        <div class="srow"><label>Precio especial</label><input type="number" min="0" data-field="precioEspecial" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.precioEspecial || '')}"></div>
      </div>
      <div class="sgroup">
        <div class="sgroup-title">🔑 Lente y Fechas</div>
        <div class="srow"><label>📅 Fecha sol. lente</label><input type="date" data-field="fechaSolLente" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fechaSolLente))}"></div>
        <div class="srow"><label>📦 Fecha llegada lente</label><input type="date" data-field="fechaLlegaLente" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fechaLlegaLente))}"></div>
        <div class="srow"><label>Recepción lente</label><select data-field="recepLente" data-row-id="${escapeAttr(id)}">
          <option value="" ${!p.recepLente ? 'selected' : ''}>—</option>
          <option ${p.recepLente === 'Correcta' ? 'selected' : ''}>Correcta</option>
          <option ${p.recepLente === 'Devolver' ? 'selected' : ''}>Devolver</option>
        </select></div>
        <div class="srow"><label>📅 Fecha cirugía</label><input type="date" data-field="fechaCir" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fechaCir))}"></div>
        <div class="srow"><label>🕒 Hora cirugía</label><div style="display:flex;gap:6px;align-items:center;flex:1"><input type="time" data-field="hora" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.hora || '')}" style="flex:1"><button type="button" class="btn" data-clear-field="hora" data-row-id="${escapeAttr(id)}" style="padding:5px 8px">Borrar</button></div></div>
        <div class="srow"><label>Estado cirugía</label><select data-field="estadoCir" data-row-id="${escapeAttr(id)}">
          <option value="" ${!p.estadoCir ? 'selected' : ''}>No</option>
          <option value="Realizada" ${(p.estadoCir || '') === 'Realizada' ? 'selected' : ''}>Sí</option>
        </select></div>
        <div class="srow"><label>💰 Facturada</label><select data-field="estadoFac" data-row-id="${escapeAttr(id)}">
          <option value="" ${!p.estadoFac ? 'selected' : ''}>No</option>
          <option value="FACTURADA" ${String(p.estadoFac || '').toUpperCase() === 'FACTURADA' ? 'selected' : ''}>Sí</option>
        </select></div>
        <div class="srow"><label>📅 Fecha facturada</label><input type="date" data-field="fechaFacturada" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fechaFacturada || ''))}"></div>
        <div class="srow"><label>Prácticas adicionales</label><div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px">
          <label><input type="checkbox" data-field="extraSutura" data-row-id="${escapeAttr(id)}" ${p.extraSutura ? 'checked' : ''}> Sutura</label>
          <label><input type="checkbox" data-field="extraInyeccion" data-row-id="${escapeAttr(id)}" ${p.extraInyeccion ? 'checked' : ''}> Inyección</label>
          <label><input type="checkbox" data-field="extraVitrectomia" data-row-id="${escapeAttr(id)}" ${p.extraVitrectomia ? 'checked' : ''}> Vitrectomía</label>
        </div></div>
      </div>
      <div class="sgroup">
        <div class="sgroup-title">Notas</div>
        <div class="srow"><textarea rows="2" data-field="notas" data-row-id="${escapeAttr(id)}" style="flex:1;padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-family:inherit;font-size:12px;resize:vertical">${escapeHtml(p.notas || '')}</textarea></div>
      </div>`;
  }

  // Footer con acciones rápidas
  const st = estado(p);
  const fac = (p.estadoFac || '').toUpperCase();
  const qaButtons = [];
  if (!p.fechaSolLente && st !== 'FINALIZADO') qaButtons.push(`<button class="qa-btn" data-qa-action="solLenteHoy" data-qa-id="${escapeAttr(id)}">📋 Sol. lente hoy</button>`);
  if (p.fechaSolLente && !p.fechaLlegaLente) qaButtons.push(`<button class="qa-btn green" data-qa-action="lenteLlegoHoy" data-qa-id="${escapeAttr(id)}">📦 Lente llegó hoy</button>`);
  if (p.fechaLlegaLente && !p.fechaCir) qaButtons.push(`<button class="qa-btn" data-qa-action="programarCirugia" data-qa-id="${escapeAttr(id)}">📅 Programar cirugía</button>`);
  const estCirCalc = getEstadoCirCalculado(p);
  if (p.fechaCir && estCirCalc !== 'Realizada') qaButtons.push(`<button class="qa-btn green" data-qa-action="cirugiaRealizada" data-qa-id="${escapeAttr(id)}">✅ Cirugía realizada</button>`);
  if (estCirCalc === 'Realizada' && !isFacturadoCompleto(fac)) qaButtons.push(`<button class="qa-btn orange" data-qa-action="facturadaHoy" data-qa-id="${escapeAttr(id)}">💰 Facturada hoy</button>`);
  if (p.ojos === '2 ojos' && secondEyeMissing(p)) qaButtons.push(`<button class="qa-btn violet" data-qa-action="duplicar" data-qa-id="${escapeAttr(id)}">⧉ Duplicar → ${escapeHtml(secondEyeMissing(p))}</button>`);

  const sideFoot = document.getElementById('sideFoot');
  if (sideFoot) {
    sideFoot.innerHTML = `
      ${validaciones.map(v => `<div class="val-${v.level}">${v.msg}</div>`).join('')}
      ${qaButtons.length ? `<div class="quick-actions-bar">${qaButtons.join('')}</div>` : ''}
      <div style="padding:10px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span id="sideDirtyHint" style="font-size:11px;color:#b45309;display:none">● Cambios sin guardar</span>
        <button class="btn primary" data-qa-action="guardarCambios" data-qa-id="${escapeAttr(id)}">Guardar cambios</button>
        <button class="btn" data-qa-action="cancelarCambios" data-qa-id="${escapeAttr(id)}">Cancelar</button>
        <button class="btn" data-qa-action="duplicar" data-qa-id="${escapeAttr(id)}">⧉ Duplicar ojo</button>
        <button class="btn" data-qa-action="eliminar" data-qa-id="${escapeAttr(id)}" style="margin-left:auto;border-color:#fca5a5;color:#dc2626">🗑 Eliminar</button>
      </div>`;
  }

  document.getElementById('sidePanel')?.classList.add('open');
  const overlay = document.getElementById('sideOverlay');
  if (overlay) overlay.style.display = 'block';
  window.dispatchEvent(new CustomEvent('side:opened', { detail: { id } }));
}

export function closeSide() {
  document.getElementById('sidePanel')?.classList.remove('open');
  const overlay = document.getElementById('sideOverlay');
  if (overlay) overlay.style.display = 'none';
  setSelId(null);
  window.dispatchEvent(new CustomEvent('side:closed'));
  document.body.style.pointerEvents = 'auto';
  document.body.style.overflow = 'auto';
  render();
}

export function forceUnlockUI() {
  const overlay = document.getElementById('sideOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.pointerEvents = 'auto';
  document.body.style.overflow = 'auto';
  document.querySelectorAll('.editing').forEach(el => el.classList.remove('editing'));
}

// ── Refresh parcial del panel lateral (sin reconstruir) ───────────────────
export function refreshSidePanel(p) {
  const e = estado(p);
  const als = alertas(p);
  const bcl = bc(e);
  const bcMap = { b0: '#fee2e2', b1: '#ffedd5', b2: '#fef9c3', b3: '#dbeafe', b4: '#ede9fe', b5: '#d1fae5', b6: '#dcfce7', b7: '#bbf7d0', b8: '#fce7f3', b9: '#fef3c7' };
  const tcMap = { b0: '#991b1b', b1: '#9a3412', b2: '#854d0e', b3: '#1e40af', b4: '#5b21b6', b5: '#065f46', b6: '#14532d', b7: '#14532d', b8: '#9d174d', b9: '#78350f' };
  const ec = document.querySelector('.estado-calc');
  if (ec) { ec.style.background = bcMap[bcl] || '#f1f5f9'; ec.style.color = tcMap[bcl] || '#374151'; ec.textContent = e; }
  const ab = document.querySelector('.alertas-box');
  if (ab) ab.innerHTML = als.map(a => `<div class="alerta-item" data-sil-key="${escapeAttr(a.key)}" style="cursor:pointer">⚠ ${escapeHtml(a.msg)} <span style='float:right;font-size:10px;color:#9ca3af'>silenciar ✕</span></div>`).join('');
  const sn = document.getElementById('sideName');
  const ss = document.getElementById('sideSub');
  if (sn) sn.textContent = p.nombre || '—';
  if (ss) ss.textContent = `DNI ${p.dni} · ${p.clinica} · ${p.obraSocial}`;
}

// ── Estadísticas (lazy — carga Chart.js si es necesario) ──────────────────
export function renderEstadisticasLazy() {
  if (!window.Chart) {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload = () => renderEstadisticasLazy();
    document.head.appendChild(s);
    const sv = document.getElementById('statsView');
    if (sv) sv.innerHTML = '<div style="text-align:center;padding:80px;color:#64748b;font-size:14px">⏳ Cargando dashboard…</div>';
    return;
  }
  import('./estadisticas.js').then(m => m.renderEstadisticas()).catch(e => console.error('[stats]', e));
}

export function renderFacturacionLazy() {
  import('./facturacion.js').then(m => m.renderFacturacion()).catch(e => {
    console.error('[facturacion]', e);
    const el = document.getElementById('factView');
    if (el) el.innerHTML = '<div class="empty">No se pudo cargar la vista de facturación</div>';
  });
}

// ── WhatsApp tab (stub que carga el módulo pesado) ─────────────────────────
export function renderWhatsAppTab() {
  import('./whatsapp.js').then(m => m.renderWhatsApp()).catch(e => {
    const el = document.getElementById('waView');
    if (el) el.innerHTML = '<div class="empty">Módulo WhatsApp no disponible</div>';
  });
}

// ── Sidebar KPIs ─────────────────────────────────────────────────────────
export function toggleKpis() {
  const box = document.getElementById('statsbar');
  const btn = document.getElementById('toggleKpisBtn');
  if (!box || !btn) return;
  const hidden = box.classList.toggle('hidden');
  btn.textContent = hidden ? 'Mostrar KPIs' : 'Ocultar KPIs';
  btn.setAttribute('aria-label', hidden ? 'Mostrar KPIs' : 'Ocultar KPIs');
  localStorage.setItem('cirugias_hide_kpis', hidden ? '1' : '0');
  updateStickyMetrics();
}

export function restoreKpisPref() {
  const hide = localStorage.getItem('cirugias_hide_kpis') === '1';
  const box = document.getElementById('statsbar');
  const btn = document.getElementById('toggleKpisBtn');
  if (!box || !btn) return;
  box.classList.toggle('hidden', hide);
  btn.textContent = hide ? 'Mostrar KPIs' : 'Ocultar KPIs';
  btn.setAttribute('aria-label', hide ? 'Mostrar KPIs' : 'Ocultar KPIs');
}

export function updateStickyMetrics() {
  const h = document.querySelector('header');
  const fb = document.querySelector('.filterbar');
  const headerH = h ? Math.ceil(h.getBoundingClientRect().height) : 120;
  document.body.style.setProperty('--header-h', `${headerH}px`);
}
