// facturacion.js — vista específica de facturación

'use strict';

import { DB, isFacturadoCompleto, getFechaFacturadaBase } from './state.js';
import { escapeHtml, escapeAttr } from './utils.js';

function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

function pct(n, d) {
  return d ? ((n / d) * 100).toFixed(1) + '%' : '0.0%';
}

function card(title, value, sub = '', tone = '#1B4F8A') {
  return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(title)}</div>
    <div style="font-size:30px;font-weight:800;color:${tone};margin-top:6px">${escapeHtml(String(value))}</div>
    ${sub ? `<div style="font-size:12px;color:#94a3b8;margin-top:4px">${escapeHtml(sub)}</div>` : ''}
  </div>`;
}

export function renderFacturacion() {
  const view = document.getElementById('factView');
  if (!view) return;

  const factRows = DB.rows.filter(p => isFacturadoCompleto(p.estadoFac));
  const monthKeys = Array.from(new Set(factRows.map(p => monthKey(getFechaFacturadaBase(p))).filter(Boolean))).sort().reverse();

  const selectedEl = document.getElementById('factMonth');
  let selected = selectedEl?.value || monthKeys[0] || '';
  if (selected && !monthKeys.includes(selected)) selected = monthKeys[0] || '';

  const monthRows = selected ? factRows.filter(p => monthKey(getFechaFacturadaBase(p)) === selected) : factRows;
  const total = monthRows.length;
  const conSutura = monthRows.filter(p => !!p.extraSutura).length;
  const conInyeccion = monthRows.filter(p => !!p.extraInyeccion).length;
  const conVitrectomia = monthRows.filter(p => !!p.extraVitrectomia).length;
  const conExtras = monthRows.filter(p => p.extraSutura || p.extraInyeccion || p.extraVitrectomia).length;

  const byClinica = {};
  monthRows.forEach(p => {
    const c = p.clinica || 'Sin clínica';
    byClinica[c] ||= { total: 0, sutura: 0, inyeccion: 0, vitrectomia: 0 };
    byClinica[c].total++;
    if (p.extraSutura) byClinica[c].sutura++;
    if (p.extraInyeccion) byClinica[c].inyeccion++;
    if (p.extraVitrectomia) byClinica[c].vitrectomia++;
  });

  const detailRows = monthRows
    .slice()
    .sort((a, b) => String(getFechaFacturadaBase(b)).localeCompare(String(getFechaFacturadaBase(a))))
    .slice(0, 40);

  view.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:end;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <div style="font-size:20px;font-weight:800;color:#1e293b">Seguimiento de facturación</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">Corte por fecha facturada. En registros viejos sin fecha facturada se usa la mejor fecha disponible.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:12px;color:#475569;font-weight:700">Mes</label>
        <select id="factMonth" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;min-width:220px">
          ${monthKeys.length ? monthKeys.map(k => `<option value="${escapeAttr(k)}" ${k === selected ? 'selected' : ''}>${escapeHtml(monthLabel(k))}</option>`).join('') : '<option value="">Sin datos</option>'}
        </select>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
      ${card('Facturadas del mes', total, selected ? monthLabel(selected) : 'Sin filtro', '#7c3aed')}
      ${card('Con adicionales', conExtras, pct(conExtras, total) + ' del total', '#0d9488')}
      ${card('Vitrectomía', conVitrectomia, pct(conVitrectomia, total) + ' del total', '#dc2626')}
      ${card('Sutura', conSutura, pct(conSutura, total) + ' del total', '#ea580c')}
      ${card('Inyección', conInyeccion, pct(conInyeccion, total) + ' del total', '#2563eb')}
    </div>

    <div style="display:grid;grid-template-columns:1.2fr .8fr;gap:12px">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#1e293b">Detalle reciente del mes</div>
        <div style="max-height:420px;overflow:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr>
              <th style="padding:8px 10px;background:#f8fafc;text-align:left">Fecha fact.</th>
              <th style="padding:8px 10px;background:#f8fafc;text-align:left">Paciente</th>
              <th style="padding:8px 10px;background:#f8fafc;text-align:left">Clínica</th>
              <th style="padding:8px 10px;background:#f8fafc;text-align:left">Adicionales</th>
            </tr></thead>
            <tbody>
              ${detailRows.length ? detailRows.map(p => `<tr style="border-top:1px solid #f1f5f9">
                <td style="padding:8px 10px">${escapeHtml(getFechaFacturadaBase(p) || '—')}</td>
                <td style="padding:8px 10px"><strong>${escapeHtml(p.nombre || '—')}</strong><div style="font-size:11px;color:#94a3b8">DNI ${escapeHtml(p.dni || '—')}</div></td>
                <td style="padding:8px 10px">${escapeHtml(p.clinica || '—')}</td>
                <td style="padding:8px 10px">${escapeHtml([p.extraVitrectomia ? 'Vitrectomía' : '', p.extraSutura ? 'Sutura' : '', p.extraInyeccion ? 'Inyección' : ''].filter(Boolean).join(' + ') || '—')}</td>
              </tr>`).join('') : `<tr><td colspan="4" style="padding:20px;text-align:center;color:#94a3b8">No hay cirugías facturadas en este mes.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px">
        <div style="font-weight:700;color:#1e293b;margin-bottom:10px">Resumen por clínica</div>
        ${Object.keys(byClinica).length ? Object.entries(byClinica).sort((a,b)=>b[1].total-a[1].total).map(([cli, v]) => `
          <div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:13px"><strong>${escapeHtml(cli)}</strong><span>${v.total} facturadas</span></div>
            <div style="display:grid;grid-template-columns:1fr auto;gap:6px;font-size:12px;color:#64748b;margin-top:8px">
              <span>Vitrectomía</span><span>${v.vitrectomia} · ${pct(v.vitrectomia, v.total)}</span>
              <span>Sutura</span><span>${v.sutura} · ${pct(v.sutura, v.total)}</span>
              <span>Inyección</span><span>${v.inyeccion} · ${pct(v.inyeccion, v.total)}</span>
            </div>
          </div>`).join('') : '<div style="padding:14px 0;color:#94a3b8">Sin datos para mostrar.</div>'}
      </div>
    </div>`;

  document.getElementById('factMonth')?.addEventListener('change', () => renderFacturacion(), { once: true });
}
