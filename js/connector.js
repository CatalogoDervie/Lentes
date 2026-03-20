// connector.js — Conector local OPCIONAL (http://127.0.0.1:8765)
// El health-check NUNCA se ejecuta automáticamente.
// Solo se activa cuando el usuario presiona "Probar conector"
// o al lanzar una automatización manualmente.

'use strict';

const CONNECTOR_BASE = 'http://127.0.0.1:8765';
let CONNECTOR_STATUS = 'off';

const BADGE_CFG = {
  ok:  { cls: 'ok',  icon: '🟢', label: 'Conector: activo' },
  off: { cls: 'off', icon: '⚫', label: 'Conector: no detectado' },
  run: { cls: 'run', icon: '🟠', label: 'Conector: ejecutando...' },
  err: { cls: 'err', icon: '🔴', label: 'Conector: error' },
};

export function setConnectorBadge(state, msg) {
  CONNECTOR_STATUS = state;
  const el = document.getElementById('connectorBadge');
  if (!el) return;
  const cfg = BADGE_CFG[state] || BADGE_CFG.off;
  el.className = `connector-badge ${cfg.cls}`;
  el.textContent = `${cfg.icon} ${msg || cfg.label}`;
}

export function getConnectorStatus() { return CONNECTOR_STATUS; }

// ── Fetch hacia el conector local ─────────────────────────────────────────
export async function connectorFetch(path, opts = {}) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), opts.timeoutMs || 12000);
  try {
    const res = await fetch(`${CONNECTOR_BASE}${path}`, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const txt = await res.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = { raw: txt || '' }; }
    if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('abort')) {
      throw new Error('No se pudo conectar con el conector local. ¿Está abierto el Iniciar Conector del Escritorio?');
    }
    throw e;
  } finally {
    clearTimeout(tm);
  }
}

// ── Health check — solo llamar bajo demanda ───────────────────────────────
export async function connectorHealthCheck() {
  try {
    await connectorFetch('/health', { method: 'GET', headers: {}, timeoutMs: 4000 });
    if (CONNECTOR_STATUS !== 'run') setConnectorBadge('ok');
    return true;
  } catch (e) {
    if (CONNECTOR_STATUS !== 'run') setConnectorBadge('off');
    return false;
  }
}

// ── Prueba manual — llamada desde el botón de UI ──────────────────────────
export async function probarConexion() {
  setConnectorBadge('run', 'Conector: probando...');
  const ok = await connectorHealthCheck();
  if (ok) {
    import('./utils.js').then(({ toast }) => toast('✅ Conector activo en http://127.0.0.1:8765'));
  } else {
    import('./utils.js').then(({ toast }) => toast('❌ Conector no responde — ¿Abriste el Iniciar Conector del Escritorio?'));
    mostrarAyudaConector();
  }
}

function mostrarAyudaConector() {
  alert(
    'El conector local NO está corriendo.\n\n' +
    'Para iniciarlo:\n' +
    '  1. Buscá el ícono "Iniciar Conector" en tu Escritorio\n' +
    '  2. Doble clic para abrirlo\n' +
    '  3. Dejá esa ventana abierta\n' +
    '  4. Volvé a intentar la automatización'
  );
}

// ── Iniciar un job en el conector ─────────────────────────────────────────
export async function connectorStartJob(kind, payload) {
  const healthy = await connectorHealthCheck();
  if (!healthy) {
    mostrarAyudaConector();
    throw new Error('Conector local no detectado. Abrí el ícono Iniciar Conector del Escritorio e intentá de nuevo.');
  }
  setConnectorBadge('run', 'Conector: iniciando job...');
  const data = await connectorFetch(`/jobs/${kind}`, { method: 'POST', body: JSON.stringify(payload), timeoutMs: 15000 });
  const jobId = data.job_id || data.id;
  if (!jobId) throw new Error('El conector no devolvió job_id. Revisá los logs del conector.');
  return jobId;
}

// ── Polling de resultado de un job ────────────────────────────────────────
export async function connectorPollJob(jobId, onUpdate) {
  const started = Date.now();
  const maxMs = 20 * 60 * 1000;
  while (Date.now() - started < maxMs) {
    const data = await connectorFetch(`/jobs/${encodeURIComponent(jobId)}`, { method: 'GET', headers: {}, timeoutMs: 10000 });
    const st = String(data.status || '').toLowerCase();
    if (onUpdate) onUpdate(data);
    if (['completed', 'ok', 'done', 'success'].includes(st)) {
      setConnectorBadge('ok');
      return data;
    }
    if (['error', 'failed', 'cancelled'].includes(st)) {
      setConnectorBadge('err', 'Conector: terminó con error');
      throw new Error(data.error || data.detail || 'La automatización terminó con error. Revisá los logs.');
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  setConnectorBadge('err', 'Conector: tiempo agotado');
  throw new Error('La automatización tardó más de 20 minutos. Revisá Chrome y los logs.');
}

// ── Renderiza estado de un job en un contenedor ───────────────────────────
export function renderJobStatus(containerId, type, msg) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const colors = { ok: '#047857', run: '#c2410c', err: '#b91c1c', off: '#64748b', info: '#1d4ed8', warn: '#b45309' };
  el.style.color = colors[type] || colors.info;
  el.style.fontWeight = '600';
  el.textContent = msg;
}
