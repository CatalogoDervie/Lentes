// whatsapp.js — Vista funcional de WhatsApp basada en la versión operativa

'use strict';

import { DB, filtered, estado, getDioptria } from './state.js';
import { save } from './firebase-ui.js';
import { toast, idbSet, cleanDigits } from './utils.js';
import { maybeAbrirRecetasPostDocs } from './recetas.js';

let WA_ROWS = [];
let WA_ENVIADOS = 0;
let WA_ERRORES = 0;
let WA_STOP = false;
let WA_STATUS_MAP = {};
let WA_TRACKING_MAP = JSON.parse(localStorage.getItem('wa_tracking_map') || '{}');
let WA_CONFIRMED_MAP = JSON.parse(localStorage.getItem('wa_confirmed_map') || '{}');
let WA_PHONE_OVERRIDE = JSON.parse(localStorage.getItem('wa_phone_override') || '{}');
let WA_GLOBAL_DATE = localStorage.getItem('wa_global_date') || '';
let WA_PREF = {
  channel: localStorage.getItem('wa_channel') || 'desktop',
  delay: parseInt(localStorage.getItem('wa_delay_ms') || '4000', 10) || 4000,
  onlyLlego: localStorage.getItem('wa_only_llego') === '1'
};

function saveWaPrefs() {
  localStorage.setItem('wa_channel', WA_PREF.channel);
  localStorage.setItem('wa_delay_ms', String(WA_PREF.delay));
  localStorage.setItem('wa_only_llego', WA_PREF.onlyLlego ? '1' : '0');
  localStorage.setItem('wa_tracking_map', JSON.stringify(WA_TRACKING_MAP));
  localStorage.setItem('wa_confirmed_map', JSON.stringify(WA_CONFIRMED_MAP));
  localStorage.setItem('wa_phone_override', JSON.stringify(WA_PHONE_OVERRIDE));
  localStorage.setItem('wa_global_date', WA_GLOBAL_DATE || '');
}

function normalizePhone(v) {
  let n = cleanDigits(v || '');
  if (!n) return '';
  if (n.startsWith('0')) n = n.replace(/^0+/, '');
  if (n.startsWith('54')) return n;
  if (n.length >= 10) return '54' + n;
  return n;
}
function isValidPhone(v) { return cleanDigits(v).length >= 10; }
function normText(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim(); }
function waFmtTs(iso) { if (!iso) return '—'; const dt = new Date(iso); if (isNaN(dt)) return '—'; return `${dt.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})} ${dt.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}`; }
function waPatientKey(r) { return String(r.sourceId || `${r.patient_id || ''}|${r.CLINICA || ''}|${normText(r.PACIENTE || '')}`); }
function waTracking(r) { return WA_TRACKING_MAP[waPatientKey(r)] || {}; }
function waTrackingText(r) { const t = waTracking(r); const bits = []; if (t.turnoAt) bits.push(`✅ Turno enviado (${waFmtTs(t.turnoAt)})`); if (t.docsAt) bits.push(`✅ Docs enviados (${waFmtTs(t.docsAt)})`); return bits.join('<br>') || '⏳ Sin envíos'; }
function waGetSourceRow(r) { return DB.rows.find(x => String(x.id) === String(r.sourceId)) || null; }
function waGetRowPhone(r) { const over = WA_PHONE_OVERRIDE[waPatientKey(r)]; return String((over ?? r.TELEFONO ?? '')).trim(); }
function waGetRowHora(r) { const p = waGetSourceRow(r); return (p?.hora_cirugia || p?.hora || r.HORA || '').trim(); }
function waStatusText(r) { return WA_STATUS_MAP[waPatientKey(r)] || '⏳ Pendiente'; }
function waStatusClass(r) { const txt = waStatusText(r); if (txt.startsWith('❌')) return 'wa-estado err'; if (txt.startsWith('✅')) return 'wa-estado ok'; return 'wa-estado pend'; }
function waSetStatus(r, msg) { WA_STATUS_MAP[waPatientKey(r)] = msg; }
function formatFechaLarga(fechaTexto) { const d = fechaTexto ? new Date(`${fechaTexto}T12:00:00`) : null; if (!d || isNaN(d)) return String(fechaTexto || ''); const texto = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' }).format(d).replace(',', '').trim(); const p = texto.split(' '); const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); return `${cap(p[0] || '')} ${p[1] || ''} de ${cap(p[3] || p[2] || '')}`.trim(); }
function waOjoTexto(ojo) { const o = String(ojo || '').toUpperCase(); if (o.includes('OD')) return 'Derecho'; if (o.includes('OI')) return 'Izquierdo'; return ''; }
function waFromInternal() { const base = filtered(); const rows = base.map(p => ({ source:'internal', sourceId:p.id, patient_id:String(p.dni || ''), PACIENTE:p.nombre || '', TELEFONO:p.tel || '', FECHA:p.fechaCir || '', HORA:(p.hora_cirugia || p.hora || ''), OJO:p.ojo || '', ESTADO:estado(p), CLINICA:p.clinica || '' })); return WA_PREF.onlyLlego ? rows.filter(r => r.ESTADO === 'PROGRAMAR CIRUGÍA' || r.ESTADO === 'LENTE LLEGÓ') : rows; }
function waCounter() { const c = document.getElementById('waContador'); if (c) c.innerText = `Enviados: ${WA_ENVIADOS} | Errores: ${WA_ERRORES}`; }
function waResetCounters() { WA_ENVIADOS = 0; WA_ERRORES = 0; waCounter(); }
function waBuildUrl(phone, msg) { return WA_PREF.channel === 'web' ? `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}` : `whatsapp://send?phone=${phone}&text=${encodeURIComponent(msg)}`; }
function waDoOpen(phone, msg) { window.location.href = waBuildUrl(phone, msg); }
function waRenderTemplate(tpl, r, hora) { const src = waGetSourceRow(r); const ojo = (r.OJO || src?.ojo || ''); const vars = { PACIENTE:r.PACIENTE || '', FECHA_LARGA:formatFechaLarga(WA_GLOBAL_DATE), HORA:hora || '', OJO:ojo, OJO_TEXTO:waOjoTexto(ojo) }; return String(tpl || '').replace(/\{\{\s*(PACIENTE|FECHA_LARGA|HORA|OJO|OJO_TEXTO)\s*\}\}/g, (_, k) => String(vars[k] || '')); }
const WA_CONFIRM_TPL = `Buenas tardes, {{PACIENTE}}.

Desde el *Centro de Ojos Esteves* le confirmamos su cirugía en *Gualeguaychú* para el día *{{FECHA_LARGA}}* a las *{{HORA}}HS* (presentarse 30 minutos antes).

Por favor confirme si puede asistir para enviarle los preparativos y documentación de la cirugía del *ojo {{OJO_TEXTO}}*.`;
const WA_SITE_DOMAIN = 'https://centrodeojos-estevesesteves.com.ar';
const WA_APP_PUBLIC_URL = `${WA_SITE_DOMAIN}/controldecirugias/`;
const WA_DOCS_PREP_URL = `${WA_SITE_DOMAIN}/preparacion`;
const WA_DOCS_CONSENT_URL = `${WA_SITE_DOMAIN}/consentimiento`;
const WA_DOCS_TPL = `Le enviamos los documentos para la cirugía del *ojo {{OJO_TEXTO}}* programada para el *{{FECHA_LARGA}}* a las *{{HORA}}HS*.

📎 Documentos:

Preparación quirúrgica
${WA_DOCS_PREP_URL}

Consentimiento informado
${WA_DOCS_CONSENT_URL}

Por favor lea con mucha atención la preparación y lleve impreso y firmado el consentimiento el día de la cirugía.`;
function waMensajeTurno(r, hora) { return waRenderTemplate(WA_CONFIRM_TPL, r, hora); }
function waMensajeDocs(r, hora) { return waRenderTemplate(WA_DOCS_TPL, r, hora); }
function waValidateTurno(r, hora) { if (!WA_GLOBAL_DATE) return 'Seleccione Fecha de cirugía (global).'; if (!hora) return 'Falta hora del paciente.'; if (!/^\d{2}:\d{2}$/.test(hora)) return 'Hora inválida (HH:MM).'; const phone = normalizePhone(waGetRowPhone(r)); if (!isValidPhone(phone)) return 'Teléfono inválido.'; return ''; }
async function waMarkTurno(r, iso) { const key = waPatientKey(r); WA_TRACKING_MAP[key] = Object.assign({}, WA_TRACKING_MAP[key] || {}, { turnoAt: iso }); const p = waGetSourceRow(r); if (p) { p.wa_turno_enviado_at = iso; await save(p); } else { localStorage.setItem('cirugias_cache', JSON.stringify(DB)); await idbSet('cirugias_cache', DB); } saveWaPrefs(); }
async function waMarkDocs(r, iso) { const key = waPatientKey(r); WA_TRACKING_MAP[key] = Object.assign({}, WA_TRACKING_MAP[key] || {}, { docsAt: iso }); const p = waGetSourceRow(r); if (p) { p.wa_docs_enviado_at = iso; p.estadoCir = 'Programada'; p.fechaCir = WA_GLOBAL_DATE || p.fechaCir || ''; const hora = waGetRowHora(r); if (hora) { p.hora_cirugia = hora; p.hora = hora; } await save(p); } else { localStorage.setItem('cirugias_cache', JSON.stringify(DB)); await idbSet('cirugias_cache', DB); } saveWaPrefs(); }
async function waEnviarTurno(i) { const r = WA_ROWS[i]; if (!r) return false; const hora = waGetRowHora(r); const err = waValidateTurno(r, hora); if (err) { WA_ERRORES++; waSetStatus(r, `❌ ${err}`); waRender(); return false; } const phone = normalizePhone(waGetRowPhone(r)); waSetStatus(r, '✅ Turno enviado'); const iso = new Date().toISOString(); await waMarkTurno(r, iso); WA_ENVIADOS++; waRender(); waDoOpen(phone, waMensajeTurno(r, hora)); return true; }
async function waEnviarDocs(i) { const r = WA_ROWS[i]; if (!r) return false; const key = waPatientKey(r); if (!WA_CONFIRMED_MAP[key]) { WA_ERRORES++; waSetStatus(r, '❌ Marcar “Confirmó” primero'); waRender(); return false; } if (!WA_GLOBAL_DATE) { WA_ERRORES++; waSetStatus(r, '❌ Seleccione Fecha global'); waRender(); return false; } const hora = waGetRowHora(r); if (!hora || !/^\d{2}:\d{2}$/.test(hora)) { WA_ERRORES++; waSetStatus(r, '❌ Falta hora del paciente'); waRender(); return false; } const phone = normalizePhone(waGetRowPhone(r)); if (!isValidPhone(phone)) { WA_ERRORES++; waSetStatus(r, '❌ Teléfono inválido'); waRender(); return false; } const iso = new Date().toISOString(); await waMarkDocs(r, iso); waSetStatus(r, '✅ Docs enviados'); WA_ENVIADOS++; waRender(); waDoOpen(phone, waMensajeDocs(r, hora)); const src = waGetSourceRow(r); if (src) maybeAbrirRecetasPostDocs(src); return true; }
function waSavePhoneOverride(key, val) { const v = String(val || '').trim(); if (!v) delete WA_PHONE_OVERRIDE[key]; else WA_PHONE_OVERRIDE[key] = v; saveWaPrefs(); }
async function waSaveHora(r, val) { if (val && !/^\d{2}:\d{2}$/.test(val)) { waSetStatus(r, '❌ Hora inválida (HH:MM)'); waRender(); return; } const p = waGetSourceRow(r); if (!p) return; p.hora_cirugia = val || ''; p.hora = val || ''; await save(p); waSetStatus(r, '✅ Hora guardada'); }
async function waLoop(kind) { WA_STOP = false; for (let i = 0; i < WA_ROWS.length; i++) { if (WA_STOP) break; if (kind === 'turnos') await waEnviarTurno(i); else await waEnviarDocs(i); await new Promise(r => setTimeout(r, WA_PREF.delay || 4000)); } }
function waStopLoop() { WA_STOP = true; }
function waResetTracking() { if (!confirm('¿Resetear tracking WhatsApp (turno/docs/confirmados/teléfonos override)?')) return; WA_TRACKING_MAP = {}; WA_CONFIRMED_MAP = {}; WA_PHONE_OVERRIDE = {}; WA_STATUS_MAP = {}; saveWaPrefs(); waResetCounters(); waRender(); }

function waRender() { const body = document.getElementById('waTbody'); if (!body) return; WA_ROWS = waFromInternal(); body.innerHTML = ''; WA_ROWS.forEach((r, i) => { const key = waPatientKey(r); const confirmed = !!WA_CONFIRMED_MAP[key]; const tr = document.createElement('tr'); tr.innerHTML = `<td>${i + 1}</td><td style='text-align:left'>${r.PACIENTE || ''}<div style='color:#6b7280;font-size:11px'>DNI: ${r.patient_id || '—'}</div></td><td>${r.CLINICA || ''}</td><td><input class='wa-phone' data-k='${key}' value='${waGetRowPhone(r)}' placeholder='Teléfono'></td><td>${r.OJO || '—'}</td><td><input class='wa-hora' data-id='${r.sourceId || ''}' value='${waGetRowHora(r)}' type='time'></td><td>${r.ESTADO || '—'}</td><td><label style='display:flex;justify-content:center;gap:4px'><input type='checkbox' class='wa-confirm' data-k='${key}' ${confirmed ? 'checked' : ''}><span>Sí</span></label></td><td class='wa-track'>${waTrackingText(r)}</td><td><div style='display:flex;flex-direction:column;gap:6px'><button class='btn wa-turno'>📩 Confirmar turno</button><button class='btn wa-docs' ${confirmed ? '' : 'disabled'}>📎 Enviar documentos</button></div></td><td class='${waStatusClass(r)}'>${waStatusText(r)}</td>`; body.appendChild(tr); tr.querySelector('.wa-turno').onclick = () => waEnviarTurno(i); tr.querySelector('.wa-docs').onclick = () => waEnviarDocs(i); tr.querySelector('.wa-confirm').onchange = e => { WA_CONFIRMED_MAP[key] = !!e.target.checked; saveWaPrefs(); waRender(); }; const phoneInput = tr.querySelector('.wa-phone'); phoneInput.onblur = () => waSavePhoneOverride(key, phoneInput.value); phoneInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); phoneInput.blur(); } }; const horaInput = tr.querySelector('.wa-hora'); horaInput.onchange = () => waSaveHora(r, horaInput.value); }); waCounter(); }

export function renderWhatsApp() { const el = document.getElementById('waView'); if (!el) return; el.innerHTML = `<div class='wa-wrap whatsapp-confirmar'><div class='wa-topline'><h3 class='wa-title'>Confirmar cirugía - Centro de Ojos Esteves</h3><button id='waBackMain' class='btn'>← Volver a página principal</button></div><div class='wa-grid'><div class='wa-card span-6'><h4>Configuración de envío</h4><div class='wa-tools' style='margin:0'><label style='font-size:12px'>Fecha de cirugía * <input id='waGlobalDate' type='date' value='${WA_GLOBAL_DATE}'></label><label style='font-size:12px'>Demora (seg): <input id='waDelay' type='number' min='1' step='1' value='${Math.round((WA_PREF.delay || 4000) / 1000)}' style='width:70px'></label><label style='font-size:12px'><input type='checkbox' id='waOnlyLlego' ${WA_PREF.onlyLlego ? 'checked' : ''}> Solo estado: Llegó lente</label><label style='font-size:12px'><input type='radio' name='waCh' value='desktop' ${WA_PREF.channel === 'desktop' ? 'checked' : ''}> WhatsApp Desktop</label><label style='font-size:12px'><input type='radio' name='waCh' value='web' ${WA_PREF.channel === 'web' ? 'checked' : ''}> WhatsApp Web</label></div></div><div class='wa-card span-6'><h4>Acciones masivas</h4><div class='wa-actions-main' style='display:flex;gap:8px;flex-wrap:wrap'><button id='waStartTurnos' class='btn primary'>📩 Enviar turnos (filtrados)</button><button id='waStartDocs' class='btn primary'>📎 Enviar docs (confirmados)</button></div><div class='wa-actions-secondary' style='margin-top:8px'><button id='waStop' class='btn'>Detener</button><button id='waReset' class='btn'>Reset tracking</button></div></div></div><div id='waContador' style='margin:6px 0 10px;font-weight:700'>Enviados: ${WA_ENVIADOS} | Errores: ${WA_ERRORES}</div><div class='wa-meta'>Dominio público del sistema: <a href='${WA_APP_PUBLIC_URL}' target='_blank' rel='noopener noreferrer'>${WA_APP_PUBLIC_URL}</a></div><div class='wa-table-wrap'><table class='wa-table'><thead><tr><th>#</th><th>Paciente</th><th>Clínica</th><th>Teléfono</th><th>Ojo</th><th>Hora</th><th>Estado</th><th>Confirmó</th><th>Tracking</th><th>Acciones</th><th>Estado envío</th></tr></thead><tbody id='waTbody'></tbody></table></div></div>`; document.getElementById('waGlobalDate').onchange = e => { WA_GLOBAL_DATE = e.target.value || ''; saveWaPrefs(); }; document.getElementById('waDelay').onchange = e => { WA_PREF.delay = Math.max(1000, (parseInt(e.target.value || '4', 10) || 4) * 1000); saveWaPrefs(); }; document.getElementById('waOnlyLlego').onchange = e => { WA_PREF.onlyLlego = e.target.checked; saveWaPrefs(); waResetCounters(); waRender(); }; document.querySelectorAll('input[name="waCh"]').forEach(r => r.onchange = () => { WA_PREF.channel = r.value; saveWaPrefs(); }); document.getElementById('waStartTurnos').onclick = () => waLoop('turnos'); document.getElementById('waStartDocs').onclick = () => waLoop('docs'); document.getElementById('waStop').onclick = () => waStopLoop(); document.getElementById('waReset').onclick = () => waResetTracking(); document.getElementById('waBackMain').onclick = () => { document.querySelector('.tablink[data-tab="tabla"]')?.click(); }; waRender(); }
