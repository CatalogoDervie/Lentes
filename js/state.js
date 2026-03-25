// state.js — Estado global, lógica de negocio y cálculo de alertas

'use strict';

import { hoyISO, toDateOnly, diffDays, daysSince, parseDateOnly } from './utils.js';

// ── Estado principal ──────────────────────────────────────────────────────
export let DB = { rows: [], nid: 200 };
export let selId = null;
export let sortCol = 'nombre';
export let sortDir = 1;
export let currentTab = 'tabla';
export let isSyncing = false;
export let quickFilter = 'TODOS';
export let hideFinalizadasSinAccion = localStorage.getItem('hide_finalizadas_sin_accion') === '1';
export let FIRESTORE_ENABLED = false;
export let FIRESTORE_UNSUB = null;
export let APPS_SCRIPT_URL = localStorage.getItem('apps_script_url') || '';

export function setDB(newDB) { DB = newDB; }
export function setSelId(id) { selId = id; }
export function setSortCol(col) { sortCol = col; }
export function setSortDir(dir) { sortDir = dir; }
export function setCurrentTab(tab) { currentTab = tab; }
export function setIsSyncing(v) { isSyncing = v; }
export function setQuickFilter(v) { quickFilter = v; }
export function setHideFinalizadasSinAccion(v) {
  hideFinalizadasSinAccion = !!v;
  localStorage.setItem('hide_finalizadas_sin_accion', hideFinalizadasSinAccion ? '1' : '0');
}
export function setFirestoreEnabled(v) { FIRESTORE_ENABLED = v; }
export function setFirestoreUnsub(fn) { FIRESTORE_UNSUB = fn; }
export function setAppsScriptUrl(url) {
  APPS_SCRIPT_URL = url;
  localStorage.setItem('apps_script_url', url);
}

// ── Configuración de alertas ──────────────────────────────────────────────
export let SETTINGS = Object.assign({
  second_eye_missing_warn_days: 30,
  second_eye_missing_crit_days: 45,
  lens_arrived_not_scheduled_warn_days: 15,
  lens_arrived_not_scheduled_crit_days: 30,
  billing_not_done_warn_days: 15,
  billing_not_done_crit_days: 30,
  lens_delay_warn_days: 10,
  lens_delay_crit_days: 20
}, JSON.parse(localStorage.getItem('cirugias_settings') || '{}') || {});

export let ALERT_SILENCES = JSON.parse(localStorage.getItem('cirugias_alert_silences') || '{}');

export function saveSettings() {
  localStorage.setItem('cirugias_settings', JSON.stringify(SETTINGS));
  localStorage.setItem('cirugias_alert_silences', JSON.stringify(ALERT_SILENCES));
}

export function silenciarAlerta(key) {
  ALERT_SILENCES[key] = { silencedAt: new Date().toISOString() };
  saveSettings();
}

export function reactivarAlerta(key) {
  delete ALERT_SILENCES[key];
  saveSettings();
}

export function isSilenced(a) { return !!ALERT_SILENCES[a.key]; }

// ── ID helpers ────────────────────────────────────────────────────────────
export function normalizeId(id) { return String(id ?? ''); }

export function findRow(id) {
  const sid = normalizeId(id);
  return DB.rows.find(x => normalizeId(x.id) === sid) || null;
}

// ── Normalización de datos ────────────────────────────────────────────────
export function normalizarClinica(c) {
  if (c === 'Clínica 1' || c === 'CDU') return 'CDU';
  if (c === 'Clínica 2' || c === 'Gualeguaychu' || c === 'Gualeguaychú') return 'Gualeguaychú';
  return c || 'CDU';
}

export function getDioptria(p) { return p.dioptria || p.lio || ''; }

export function clinicaClass(c) { return c === 'CDU' ? 'bcl1' : 'bcl2'; }

function normDateField(v) {
  const dt = parseDateOnly(v);
  return dt ? dt.toISOString().slice(0, 10) : '';
}

function hasValidDate(v) {
  return !!parseDateOnly(v);
}

export function getEstadoCirCalculado(p) {
  const manual = String(p.estadoCir || '').trim().toUpperCase();
  const fc = toDateOnly(p.fechaCir);
  const today = toDateOnly(hoyISO());
  if (isFacturadoCompleto(p.estadoFac)) return 'Realizada';
  if (!fc) return '';
  if (manual === 'REALIZADA') return 'Realizada';
  if (today && today >= fc) return 'Realizada';
  return 'Programada';
}

export function normalizeEstadoCir(p) {
  const calc = getEstadoCirCalculado(p);
  return (calc === 'Programada' || calc === 'Realizada') ? calc : '';
}

export function normalizarData() {
  DB.rows.forEach(p => {
    p.id = String(p.id ?? '');
    p.clinica = normalizarClinica(p.clinica);
    if (!p.ojo) p.ojo = 'OI';
    if (!p.ojos) p.ojos = '2 ojos';
    ['fechaSolLente', 'fechaLlegaLente', 'fechaCir', 'fechaFacturada'].forEach(k => {
      p[k] = normDateField(p[k]);
    });
    if (!hasValidDate(p.fechaCir)) p.hora = '';
  });
}

// ── Lógica de duplicados ──────────────────────────────────────────────────
export function duplicateNewestIds() {
  const map = {};
  DB.rows.forEach(r => {
    const k = `${String(r.dni || '').trim()}|${r.ojo || ''}`;
    if (!map[k]) map[k] = [];
    map[k].push(r);
  });
  const dup = new Set();
  Object.values(map).forEach(arr => {
    if (arr.length > 1 && arr[0].dni) {
      arr.sort((a, b) => (b.id || 0) - (a.id || 0));
      dup.add(arr[0].id);
    }
  });
  return dup;
}

export function secondEyeMissing(p) {
  if (p.ojos !== '2 ojos') return '';
  const otro = p.ojo === 'OD' ? 'OI' : 'OD';
  const dni = String(p.dni || '').trim();
  const hasOther = DB.rows.some(x => x.id !== p.id && String(x.dni || '').trim() === dni && x.ojo === otro);
  return hasOther ? '' : otro;
}

function faltanteSegundoOjo(p) {
  if (p.ojos !== '2 ojos') return '';
  const dni = String(p.dni || '').trim();
  if (!dni) return '';
  const otro = p.ojo === 'OD' ? 'OI' : 'OD';
  const other = DB.rows.find(x => x.id !== p.id && String(x.dni || '').trim() === dni && x.ojo === otro);
  if (!other) return otro;
  return '';
}

export function isFacturadoCompleto(fac) {
  const f = (fac || '').toUpperCase();
  return f === 'FACTURADA';
}

export function practicasExtrasTexto(p) {
  const vals = [];
  if (p.extraSutura) vals.push('Sutura');
  if (p.extraInyeccion) vals.push('Inyección');
  if (p.extraVitrectomia) vals.push('Vitrectomía');
  return vals.join(' + ');
}

export function getFechaFacturadaBase(p) {
  if (p.fechaFacturada) return String(p.fechaFacturada).slice(0, 10);
  if (!isFacturadoCompleto(p.estadoFac)) return '';
  const upd = String(p.updatedAt || '').slice(0, 10);
  if (upd) return upd;
  return String(p.fechaCir || '').slice(0, 10);
}

// ── Estado calculado del paciente ─────────────────────────────────────────
export function estado(p) {
  const estCir = getEstadoCirCalculado(p);
  const tieneSol = hasValidDate(p.fechaSolLente);
  const tieneLlego = hasValidDate(p.fechaLlegaLente);
  const tieneCir = hasValidDate(p.fechaCir);
  if (p.recepLente === 'Devolver') return 'DEVOLVER LENTE';
  if (!getDioptria(p)) return 'FALTA DIOPTRÍA';
  if (!tieneSol) return 'PEDIR LENTE';
  if (!tieneLlego) return 'ESPERANDO LENTE';
  if (!tieneCir) return 'LLEGÓ LENTE - PROGRAMAR CIRUGÍA';
  const fac = (p.estadoFac || '').toUpperCase();
  if (isFacturadoCompleto(fac)) {
    const faltante = faltanteSegundoOjo(p);
    if (faltante === 'OD') return 'FINALIZADA | FALTA OJO DERECHO';
    if (faltante === 'OI') return 'FINALIZADA | FALTA OJO IZQUIERDO';
    if (p.ojos === '1 ojo' || p.ojos === '2 ojos') return 'FINALIZADO';
    return 'FACTURADA';
  }
  if (estCir === 'Realizada') return 'REALIZADA';
  return 'FECHA PROGRAMADA';
}

// ── Próxima acción sugerida ───────────────────────────────────────────────
export function proximaAccion(p) {
  const st = estado(p);
  if (st === 'FINALIZADO') return { label: 'Sin acción', color: '#9ca3af', bg: '#f1f5f9', icon: '✓' };
  if (st.startsWith('FINALIZADA | FALTA OJO')) return { label: 'Ver segundo ojo', color: '#7c3aed', bg: '#ede9fe', icon: '👁' };
  if (st === 'REALIZADA') return { label: 'Facturar', color: '#dc2626', bg: '#fee2e2', icon: '💰' };
  if (st === 'FECHA PROGRAMADA' && !p.fechaLlegaLente) {
    const dias = diffDays(new Date(p.fechaCir), toDateOnly(hoyISO()));
    if (dias !== null && dias <= 7) return { label: '⚠ Reclamar lente URGENTE', color: '#b91c1c', bg: '#fef2f2', icon: '🚨' };
    return { label: 'Reclamar lente', color: '#ea580c', bg: '#ffedd5', icon: '📦' };
  }
  if (st === 'LLEGÓ LENTE - PROGRAMAR CIRUGÍA') return { label: 'Programar cirugía', color: '#065f46', bg: '#d1fae5', icon: '📅' };
  if (st === 'ESPERANDO LENTE') {
    const d = diffDays(toDateOnly(hoyISO()), p.fechaSolLente);
    if (d !== null && d > 15) return { label: 'Reclamar lente', color: '#dc2626', bg: '#fee2e2', icon: '📞' };
    return { label: 'Esperar lente', color: '#1d4ed8', bg: '#dbeafe', icon: '⏳' };
  }
  if (st === 'FECHA PROGRAMADA') return { label: 'Confirmar paciente', color: '#065f46', bg: '#d1fae5', icon: '📞' };
  if (st === 'PEDIR LENTE') return { label: 'Pedir lente', color: '#7c3aed', bg: '#ede9fe', icon: '📋' };
  if (st === 'FALTA DIOPTRÍA') return { label: 'Cargar dioptría', color: '#dc2626', bg: '#fee2e2', icon: '⚠' };
  if (st === 'DEVOLVER LENTE') return { label: 'Devolver lente', color: '#9d174d', bg: '#fce7f3', icon: '↩' };
  return { label: 'Revisar', color: '#6b7280', bg: '#f1f5f9', icon: '?' };
}

// ── Severidad de alertas ──────────────────────────────────────────────────
export function severityByDays(days, yellowFrom = 15, redFrom = 30) {
  if (days >= redFrom) return 'red';
  if (days >= yellowFrom) return 'yellow';
  return 'neutral';
}

export function episodeIdFor(p) {
  if (p.episode_id) return p.episode_id;
  const base = (p.fechaCir || p.fechaCarga || hoyISO()).slice(0, 7);
  return `${String(p.dni || '').trim()}|${p.clinica || ''}|${base}`;
}

function mkAlert(type, p, days, baseDate, eye = 'NA', msgPrefix = '') {
  const d = Math.max(0, days || 0);
  const key = `${type}|${String(p.dni || '').trim()}|${p.clinica || ''}|${episodeIdFor(p)}|${eye || 'NA'}|${baseDate || ''}`;
  return { type, days: d, key, severity: severityByDays(d), msg: `${msgPrefix}${d} DÍAS` };
}

// ── Cálculo de alertas de un paciente ────────────────────────────────────
export function alertas(p, opts = {}) {
  const today = toDateOnly(hoyISO());
  const res = [];
  const showSilenced = !!(document.getElementById('showSilenced')?.checked);
  const st = estado(p);
  const dni = String(p.dni || '').trim();
  const ojo = String(p.ojo || '').toUpperCase() || 'NA';
  const push = (type, d, msg, yellow, red, baseKey='') => {
    if (d == null || d < yellow) return;
    res.push({ type, days: d, key: `${type}:${dni}:${ojo}:${baseKey}`, severity: severityByDays(d, yellow, red), msg });
  };

  if (p.recepLente === 'Devolver' || st === 'DEVOLVER LENTE') return [];

  if (p.fechaSolLente && !p.fechaLlegaLente) {
    const d = diffDays(today, p.fechaSolLente);
    push('lens_delayed', d, `DEMORA EN LLEGADA DE LENTE (+${d} días)`, SETTINGS.lens_delay_warn_days, SETTINGS.lens_delay_crit_days, p.fechaSolLente);
  } else if (st === 'LLEGÓ LENTE - PROGRAMAR CIRUGÍA') {
    const d = diffDays(today, p.fechaLlegaLente);
    push('no_schedule_after_arrival', d, `LENTE LLEGÓ Y FALTA PROGRAMAR (+${d} días)`, SETTINGS.lens_arrived_not_scheduled_warn_days, SETTINGS.lens_arrived_not_scheduled_crit_days, p.fechaLlegaLente);
  } else if (st === 'REALIZADA') {
    const base = p.fechaCir || p.updatedAt || hoyISO();
    const d = diffDays(today, base);
    push('billing_pending', d, `REALIZADA Y SIN FACTURAR (+${d} días)`, SETTINGS.billing_not_done_warn_days, SETTINGS.billing_not_done_crit_days, base);
  } else if (st.startsWith('FINALIZADA | FALTA OJO ')) {
    const base = p.fechaCir || p.updatedAt || hoyISO();
    const d = diffDays(today, base);
    const otro = p.ojo === 'OD' ? 'OI' : 'OD';
    const otroTxt = otro === 'OD' ? 'OJO DERECHO' : 'OJO IZQUIERDO';
    push('second_surgery_missing', d, `FINALIZADA Y FALTA ${otroTxt} (+${d} días)`, SETTINGS.second_eye_missing_warn_days, SETTINGS.second_eye_missing_crit_days, base);
  }

  if (opts.raw) return res;
  return res.filter(a => showSilenced || !isSilenced(a));
}

// ── Filtrado de filas ─────────────────────────────────────────────────────
export function filtered() {
  const q = (document.getElementById('q')?.value || '').trim().toLowerCase();
  const fCli = document.getElementById('fCli')?.value || '';
  const fEst = document.getElementById('fEst')?.value || '';
  const fOS = document.getElementById('fOS')?.value || '';

  let rows = DB.rows.filter(p => {
    if (fCli && p.clinica !== fCli) return false;
    if (fOS && p.obraSocial !== fOS) return false;
    if (q) {
      const nom = String(p.nombre || '').toLowerCase();
      const dni = String(p.dni || '').toLowerCase();
      const afi = String(p.afiliado || '').toLowerCase();
      if (!nom.includes(q) && !dni.includes(q) && !afi.includes(q)) return false;
    }
    if (fEst) {
      const estNorm = s => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
      if (estNorm(estado(p)) !== estNorm(fEst)) return false;
    }
    switch (quickFilter) {
      case 'PEDIR LENTE': if (estado(p) !== 'PEDIR LENTE') return false; break;
      case 'PROGRAMAR CIRUGIA': if (estado(p) !== 'LLEGÓ LENTE - PROGRAMAR CIRUGÍA') return false; break;
      case 'FECHA PROGRAMADA': if (estado(p) !== 'FECHA PROGRAMADA') return false; break;
      case 'REALIZADA': if (estado(p) !== 'REALIZADA') return false; break;
      case 'FALTA FACTURAR': if (estado(p) !== 'REALIZADA') return false; break;
      case 'FACTURADA': if (estado(p) !== 'FACTURADA' && estado(p) !== 'FINALIZADO') return false; break;
      case 'FACTURADA FALTA OD/OI': if (!estado(p).startsWith('FINALIZADA | FALTA OJO')) return false; break;
      case 'CON ALERTAS': if (!alertas(p).length) return false; break;
    }
    const pa = proximaAccion(p);
    if (hideFinalizadasSinAccion && estado(p) === 'FINALIZADO' && pa.label === 'Sin acción' && !alertas(p).length) return false;
    return true;
  });

  rows.sort((a, b) => {
    let va = a[sortCol] || '', vb = b[sortCol] || '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    return va < vb ? -sortDir : va > vb ? sortDir : 0;
  });

  return rows;
}

// ── Validación de fila antes de guardar ───────────────────────────────────
export function validarFila(p) {
  if (p.clinica) p.clinica = normalizarClinica(p.clinica);
  if (!p.ojos) p.ojos = '2 ojos';
  if (!p.ojo) p.ojo = 'OI';
  ['fechaSolLente', 'fechaLlegaLente', 'fechaCir', 'fechaFacturada'].forEach(k => {
    p[k] = normDateField(p[k]);
  });
  const cir = String(p.estadoCir || '').trim().toUpperCase();
  if (cir === 'REALIZADA' || cir === 'SI' || cir === 'SÍ') p.estadoCir = 'Realizada';
  else if (cir === 'PROGRAMADA') p.estadoCir = 'Programada';
  else if (!cir || cir === 'NO') p.estadoCir = '';
  else p.estadoCir = '';
  const fac = String(p.estadoFac || '').trim().toUpperCase();
  if (fac === 'FACTURADA' || fac === 'SI' || fac === 'SÍ') p.estadoFac = 'FACTURADA';
  else if (!fac || fac === 'NO') p.estadoFac = '';
  else p.estadoFac = 'FACTURADA';
  if (!isFacturadoCompleto(p.estadoFac) && p.fechaFacturada) p.fechaFacturada = '';
  if (!hasValidDate(p.fechaCir)) p.hora = '';
  if (!hasValidDate(p.fechaCir) && p.estadoCir !== 'Realizada') p.estadoCir = '';
}


// ── Badge CSS según estado ─────────────────────────────────────────────────
export function bc(e) {
  const map = {
    'FALTA DIOPTRÍA': 'b0',
    'PEDIR LENTE': 'b2',
    'ESPERANDO LENTE': 'b3',
    'LLEGÓ LENTE - PROGRAMAR CIRUGÍA': 'b4',
    'FECHA PROGRAMADA': 'b5',
    'REALIZADA': 'b6',
    'FACTURADA': 'b7',
    'FINALIZADO': 'b7',
    'DEVOLVER LENTE': 'b8',
  };
  if (map[e]) return map[e];
  if (e && e.startsWith('FINALIZADA | FALTA OJO')) return 'b9';
  return 'b3';
}

// ── Backup diario ─────────────────────────────────────────────────────────
export function backupDiario() {
  const key = `cirugias_backup_${hoyISO()}`;
  if (localStorage.getItem(key)) return;
  try {
    const data = JSON.stringify(DB);
    localStorage.setItem(key, data);
    // Limpiar backups viejos (>7 días)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cirugias_backup_')) {
        const dateStr = k.replace('cirugias_backup_', '');
        if (new Date(dateStr) < cutoff) localStorage.removeItem(k);
      }
    }
  } catch (e) { /* localStorage lleno */ }
}

// ── Estado de label normalizado ───────────────────────────────────────────
export function estadoLabelNorm(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function estadoLabelCanon(v) {
  const n = estadoLabelNorm(v);
  if (n === 'LISTO PARA PEDIR LENTE') return 'PEDIR LENTE';
  if (n === 'PROGRAMAR CIRUGIA' || n === 'LENTE LLEGO' || n === 'LENTE LLEGÓ') return 'LLEGÓ LENTE - PROGRAMAR CIRUGÍA';
  if (n === 'CIRUGIA REALIZADA - FALTA FACTURAR') return 'REALIZADA';
  if (n === 'FINALIZADO - FACTURADA') return 'FINALIZADO';
  if (n === 'FACTURADA|FALTA OD' || n === 'FACTURADA | FALTA OD') return 'FINALIZADA | FALTA OJO DERECHO';
  if (n === 'FACTURADA|FALTA OI' || n === 'FACTURADA | FALTA OI') return 'FINALIZADA | FALTA OJO IZQUIERDO';
  if (n === 'LENTE SOLICITADA') return 'ESPERANDO LENTE';
  return String(v || '').trim().replace(/\s+/g, ' ');
}

// ── isPamiRow helper ──────────────────────────────────────────────────────
export function isPamiRow(p) {
  return String(p?.obraSocial || '').trim().toUpperCase() === 'PAMI';
}
