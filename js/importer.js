// importer.js — Importación masiva de JSON a Firestore

'use strict';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getFirestore, collection, doc, setDoc, getDocs, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDtOdvEPZ0jBvqjY3CbZA_KTbdeaczR7MA',
  authDomain: 'cirugias-we.firebaseapp.com',
  projectId: 'cirugias-we',
  storageBucket: 'cirugias-we.firebasestorage.app',
  messagingSenderId: '182450401429',
  appId: '1:182450401429:web:635209c8a74f42bf71ab9c',
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const col  = collection(db, 'cirugias');

const logEl = document.getElementById('log');
const prog  = document.getElementById('prog');

function log(msg) {
  if (!logEl) return;
  logEl.textContent += msg + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

function sanitize(row) {
  const out = { ...row };
  const now = new Date().toISOString();
  out.id = String(out.id || Date.now());
  if (!out.createdAt) out.createdAt = now;
  out.updatedAt = now;
  for (const k of Object.keys(out)) if (out[k] === undefined) out[k] = null;
  return out;
}

// ── Escape helper para la tabla de preview ────────────────────────────────
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// ── Estado de sesión ──────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (!user) log('⚠ Abrí esta página después de iniciar sesión en la app principal.');
  else log('✓ Sesión detectada: ' + (user.email || user.uid));
});

// ── Carga de archivo JSON ─────────────────────────────────────────────────
let parsedRows = [];

const fileInput = document.getElementById('fileJSON');
if (fileInput) {
  fileInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const infoEl = document.getElementById('jsonInfo');
    if (infoEl) infoEl.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      parsedRows = Array.isArray(data) ? data : (data.rows || []);
      log(`✓ JSON cargado: ${parsedRows.length} registros`);
      const btn = document.getElementById('btnImportJSON');
      if (btn) btn.disabled = parsedRows.length === 0;
      renderPreview(parsedRows);
    } catch (err) {
      log(`✗ Error al leer el archivo: ${err.message}`);
    }
  });
}

function renderPreview(rows) {
  const container = document.getElementById('preview');
  if (!container) return;
  const sample = rows.slice(0, 5);
  const keys = ['id', 'nombre', 'dni', 'obraSocial', 'ojo', 'lio', 'fechaCir', 'estadoCir', 'estadoFac'];
  container.innerHTML = `
    <table>
      <thead><tr>${keys.map(k => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead>
      <tbody>${sample.map(r =>
        `<tr>${keys.map(k => `<td>${escapeHtml(String(r[k] ?? '—'))}</td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table>
    <p style="color:#64748b;font-size:12px">Mostrando ${sample.length} de ${rows.length}</p>`;
}

// ── Importar ──────────────────────────────────────────────────────────────
const btnImport = document.getElementById('btnImportJSON');
if (btnImport) {
  btnImport.addEventListener('click', async () => {
    if (!parsedRows.length) return;
    if (!confirm(`¿Importar ${parsedRows.length} registros a Firestore?`)) return;
    if (prog) { prog.style.display = 'block'; prog.value = 0; }
    let ok = 0, err = 0;
    log(`\n─── Importando ${parsedRows.length} registros ───`);
    const CHUNK = 20;
    for (let i = 0; i < parsedRows.length; i += CHUNK) {
      const batch = parsedRows.slice(i, i + CHUNK);
      try {
        await Promise.all(batch.map(row => {
          const s = sanitize(row);
          return setDoc(doc(col, s.id), { ...s, _srv: serverTimestamp() }, { merge: true });
        }));
        ok += batch.length;
      } catch (e) {
        err += batch.length;
        log(`✗ Error en lote ${i}: ${e.message}`);
      }
      if (prog) prog.value = Math.round(((i + CHUNK) / parsedRows.length) * 100);
      log(`  ${Math.min(i + CHUNK, parsedRows.length)} / ${parsedRows.length}`);
      await new Promise(r => setTimeout(r, 80));
    }
    if (prog) prog.value = 100;
    log(`\n✅ Listo: ${ok} OK, ${err} errores`);
  });
}

// ── Contar registros ──────────────────────────────────────────────────────
const btnContar = document.getElementById('btnContarFirestore');
if (btnContar) {
  btnContar.addEventListener('click', async () => {
    log('\n─── Contando registros en Firestore ───');
    try {
      const snap = await getDocs(col);
      log(`✓ ${snap.docs.length} documentos en la colección 'cirugias'`);
    } catch (e) {
      log(`✗ Error: ${e.message}`);
    }
  });
}

// ── Limpiar Firestore ─────────────────────────────────────────────────────
const btnLimpiar = document.getElementById('btnLimpiarFirestore');
if (btnLimpiar) {
  btnLimpiar.addEventListener('click', async () => {
    if (!confirm('⚠ ¿Eliminar TODOS los documentos de Firestore? No se puede deshacer.')) return;
    log('\n─── Limpiando Firestore ───');
    try {
      const snap = await getDocs(col);
      let n = 0;
      const CHUNK = 20;
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += CHUNK) {
        await Promise.all(docs.slice(i, i + CHUNK).map(d => deleteDoc(d.ref)));
        n += Math.min(CHUNK, docs.length - i);
        log(`  Eliminados ${n}/${docs.length}…`);
      }
      log(`✅ Firestore limpiado (${docs.length} documentos)`);
    } catch (e) {
      log(`✗ Error: ${e.message}`);
    }
  });
}

log('Firebase conectado. Listo para importar.');
