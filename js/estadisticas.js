// estadisticas.js — Dashboard narrativo y dinámico

'use strict';

import { escapeHtml, escapeAttr } from './utils.js';
import {
  DB, estado, alertas, filtered, isFacturadoCompleto, getFechaFacturadaBase
} from './state.js';
import { openSide } from './render.js';

const C = {
  navy: '#1d4f91',
  teal: '#0f766e',
  green: '#15803d',
  amber: '#b45309',
  red: '#dc2626',
  violet: '#7c3aed',
  sky: '#0369a1',
  slate: '#64748b',
  bg: '#f8fafc',
};

const STAGE_ORDER = [
  'PEDIR LENTE',
  'ESPERANDO LENTE',
  'LLEGÓ LENTE - PROGRAMAR CIRUGÍA',
  'FECHA PROGRAMADA',
  'REALIZADA',
  'FACTURADA',
  'FINALIZADO',
];

let statsMonth = '';

function toMonthKey(v) {
  const s = String(v || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : '';
}

function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

function shortMonthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit' }).format(new Date(y, m - 1, 1));
}

function percent(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

function card(title, value, sub, tone = 'navy') {
  const color = C[tone] || C.navy;
  return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;box-shadow:0 6px 18px rgba(15,23,42,.04)">
    <div style="font-size:11px;font-weight:800;letter-spacing:.04em;color:${color};text-transform:uppercase">${escapeHtml(title)}</div>
    <div style="margin-top:8px;font-size:32px;font-weight:900;line-height:1;color:#0f172a">${escapeHtml(String(value))}</div>
    <div style="margin-top:8px;font-size:12px;color:#64748b">${escapeHtml(sub || '')}</div>
  </div>`;
}

function story(title, body, tone = 'navy') {
  const color = C[tone] || C.navy;
  return `<div style="background:linear-gradient(180deg,#fff,${tone === 'red' ? '#fff5f5' : '#f8fbff'});border:1px solid #e2e8f0;border-left:6px solid ${color};border-radius:18px;padding:16px 18px;box-shadow:0 6px 18px rgba(15,23,42,.04)">
    <div style="font-size:12px;font-weight:800;color:${color};margin-bottom:6px">${escapeHtml(title)}</div>
    <div style="font-size:13px;line-height:1.5;color:#334155">${escapeHtml(body)}</div>
  </div>`;
}

function section(title, subtitle = '', controls = '') {
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:22px 0 12px;flex-wrap:wrap">
    <div>
      <div style="font-size:18px;font-weight:900;color:#0f172a">${escapeHtml(title)}</div>
      ${subtitle ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    ${controls}
  </div>`;
}

function chartCard(title, subtitle, id, h = 220) {
  return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;box-shadow:0 6px 18px rgba(15,23,42,.04)">
    <div style="font-size:13px;font-weight:800;color:#0f172a">${escapeHtml(title)}</div>
    ${subtitle ? `<div style="font-size:11px;color:#64748b;margin-top:2px;margin-bottom:10px">${escapeHtml(subtitle)}</div>` : '<div style="height:12px"></div>'}
    <canvas id="${escapeAttr(id)}" height="${h}"></canvas>
  </div>`;
}

function createChart(id, config) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  if (el._chart) { try { el._chart.destroy(); } catch (_) {} }
  el._chart = new window.Chart(el.getContext('2d'), config);
}

function baseRowsForStats() {
  const active = filtered();
  return Array.isArray(active) && active.length ? active : DB.rows;
}

function firstDate(...vals) {
  return vals.find(v => String(v || '').trim()) || '';
}

function rowPeriodKey(r) {
  return toMonthKey(firstDate(getFechaFacturadaBase(r), r.fechaCir, r.fechaLlegaLente, r.fechaSolLente));
}

function getMonthOptions(rows) {
  const keys = new Set();
  rows.forEach(r => {
    const k = rowPeriodKey(r);
    if (k) keys.add(k);
  });
  return Array.from(keys).sort().reverse();
}

function gridlessAxis(extra = {}) {
  return { grid: { display: false, drawBorder: false }, ...extra };
}

export function renderEstadisticas() {
  const view = document.getElementById('statsView');
  if (!view) return;

  const baseRows = baseRowsForStats();
  const monthOptions = getMonthOptions(baseRows);
  if (statsMonth && !monthOptions.includes(statsMonth)) statsMonth = '';
  const rows = statsMonth ? baseRows.filter(r => rowPeriodKey(r) === statsMonth) : baseRows;

  const uniquePatients = new Set(rows.map(r => String(r.dni || '').trim()).filter(Boolean)).size;
  const stageCounts = Object.fromEntries(STAGE_ORDER.map(s => [s, 0]));
  let facturadaFalta = 0;
  let redAlerts = 0;
  let allAlerts = 0;
  const clinicCount = {};
  const clinicAlerts = {};
  const lensWait = [];
  const arrivalToSurgery = [];
  const topRows = [];

  rows.forEach(r => {
    const st = estado(r);
    if (stageCounts[st] != null) stageCounts[st] += 1;
    if (st.startsWith('FINALIZADA | FALTA OJO')) facturadaFalta += 1;
    const cli = r.clinica || 'Sin clínica';
    clinicCount[cli] = (clinicCount[cli] || 0) + 1;
    const ars = alertas(r);
    allAlerts += ars.length;
    redAlerts += ars.filter(a => a.severity === 'red').length;
    clinicAlerts[cli] = (clinicAlerts[cli] || 0) + ars.length;
    if (r.fechaSolLente && r.fechaLlegaLente) {
      const a = new Date(r.fechaSolLente), b = new Date(r.fechaLlegaLente);
      const d = Math.round((b - a) / 86400000);
      if (d >= 0 && d < 365) lensWait.push(d);
    }
    if (r.fechaLlegaLente && r.fechaCir) {
      const a = new Date(r.fechaLlegaLente), b = new Date(r.fechaCir);
      const d = Math.round((b - a) / 86400000);
      if (d >= 0 && d < 365) arrivalToSurgery.push(d);
    }
    if (ars.length) {
      const worst = [...ars].sort((x, y) => y.days - x.days)[0];
      topRows.push({ row: r, alert: worst, stage: st });
    }
  });

  const facturadas = rows.filter(r => isFacturadoCompleto(r.estadoFac));
  const currentBottleneck = [
    ['Esperando lente', stageCounts['ESPERANDO LENTE']],
    ['Programar cirugía', stageCounts['LLEGÓ LENTE - PROGRAMAR CIRUGÍA']],
    ['Falta facturar', stageCounts['REALIZADA']],
  ].sort((a, b) => b[1] - a[1])[0] || ['—', 0];
  const clinicMostAlerts = Object.entries(clinicAlerts).sort((a, b) => b[1] - a[1])[0] || ['—', 0];

  const allMonthKeys = new Set();
  baseRows.forEach(r => {
    [r.fechaSolLente, r.fechaLlegaLente, r.fechaCir, getFechaFacturadaBase(r), rowPeriodKey(r)].forEach(v => {
      const k = toMonthKey(v);
      if (k) allMonthKeys.add(k);
    });
  });
  const monthKeys = Array.from(allMonthKeys).sort().slice(-8);
  const monthly = monthKeys.map(k => ({
    key: k,
    solicitadas: baseRows.filter(r => toMonthKey(r.fechaSolLente) === k).length,
    programadas: baseRows.filter(r => toMonthKey(r.fechaCir) === k).length,
    facturadas: baseRows.filter(r => toMonthKey(getFechaFacturadaBase(r)) === k).length,
  }));

  const clinicKeys = Object.keys(clinicCount).sort((a, b) => clinicCount[b] - clinicCount[a]);
  const additionalCounts = {
    Sutura: facturadas.filter(r => r.extraSutura).length,
    Inyección: facturadas.filter(r => r.extraInyeccion).length,
    Vitrectomía: facturadas.filter(r => r.extraVitrectomia).length,
  };

  const avgLensWait = lensWait.length ? Math.round(lensWait.reduce((a, b) => a + b, 0) / lensWait.length) : 0;
  const avgArrivalToSurgery = arrivalToSurgery.length ? Math.round(arrivalToSurgery.reduce((a, b) => a + b, 0) / arrivalToSurgery.length) : 0;

  topRows.sort((a, b) => (b.alert?.days || 0) - (a.alert?.days || 0));
  const top = topRows.slice(0, 10);
  const monthControl = `
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#475569;font-weight:700">
      Período
      <select id="statsMonthFilter" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;min-width:180px">
        <option value="">Todos los meses</option>
        ${monthOptions.map(k => `<option value="${escapeAttr(k)}" ${k === statsMonth ? 'selected' : ''}>${escapeHtml(monthLabel(k))}</option>`).join('')}
      </select>
    </label>`;
  const subtitle = statsMonth
    ? `Lectura del proceso para ${monthLabel(statsMonth)}. El período usa la fecha más avanzada disponible en cada caso.`
    : 'La vista se recalcula según los filtros activos, para que leas el proceso como una historia de punta a punta.';

  const html = `
    ${section('Dashboard operativo', subtitle, monthControl)}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
      ${card('Pacientes en vista', uniquePatients, `${rows.length} episodios quirúrgicos`, 'navy')}
      ${card('Facturadas', facturadas.length, `${percent(facturadas.length, rows.length)}% del total visible`, 'green')}
      ${card('Realizadas sin facturar', stageCounts['REALIZADA'], 'Pacientes listos para cerrar', 'amber')}
      ${card('Alertas críticas', redAlerts, `${allAlerts} alertas activas`, 'red')}
    </div>

    <div style="display:grid;grid-template-columns:1.2fr .8fr .8fr;gap:12px;margin-top:14px">
      ${story('Qué está pasando hoy', rows.length ? `La mayor concentración del trabajo está en “${currentBottleneck[0]}”, con ${currentBottleneck[1]} casos. Esto te marca el cuello de botella actual del flujo.` : 'No hay datos visibles con los filtros actuales.', 'navy')}
      ${story('Dónde mirar primero', clinicMostAlerts[1] ? `${clinicMostAlerts[0]} concentra ${clinicMostAlerts[1]} alertas. Conviene revisar esa clínica antes de cerrar el día.` : 'No hay alertas activas en la vista actual.', clinicMostAlerts[1] ? 'red' : 'green')}
      ${story('Tiempos medios', `Lente: ${avgLensWait || 0} días. Llegada a cirugía: ${avgArrivalToSurgery || 0} días.`, 'teal')}
    </div>

    ${section('Lectura del flujo', 'El tablero muestra en qué tramo está cada episodio y cómo se mueve mes a mes.')}
    <div style="display:grid;grid-template-columns:1.15fr .85fr;gap:12px">
      ${chartCard('Embudo operativo actual', 'Desde pedir lente hasta facturar.', 'chartStages', 220)}
      ${chartCard('Distribución por clínica', 'Participación de la vista actual.', 'chartClinics', 220)}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
      ${chartCard('Ritmo mensual', 'Solicitudes, programaciones y facturación en los últimos meses disponibles.', 'chartTrend', 220)}
      ${chartCard('Adicionales sobre facturadas', 'Qué peso tienen las prácticas complementarias.', 'chartExtras', 220)}
    </div>

    ${section('Pacientes para mover hoy', 'Ordenados por la alerta más demorada para que la pantalla cuente qué resolver primero.')}
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 6px 18px rgba(15,23,42,.04)">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr>
            <th style="padding:10px 12px;background:#f8fafc;text-align:left;color:#64748b;font-size:11px">Paciente</th>
            <th style="padding:10px 12px;background:#f8fafc;text-align:left;color:#64748b;font-size:11px">Clínica</th>
            <th style="padding:10px 12px;background:#f8fafc;text-align:left;color:#64748b;font-size:11px">Estado</th>
            <th style="padding:10px 12px;background:#f8fafc;text-align:left;color:#64748b;font-size:11px">Alerta</th>
            <th style="padding:10px 12px;background:#f8fafc;text-align:center;color:#64748b;font-size:11px">Días</th>
          </tr>
        </thead>
        <tbody>
          ${top.length ? top.map(({ row, alert, stage }) => `
            <tr data-open-side="${escapeAttr(row.id)}" style="cursor:pointer;border-top:1px solid #f1f5f9">
              <td style="padding:10px 12px"><strong>${escapeHtml(row.nombre || '—')}</strong><div style="font-size:11px;color:#94a3b8">DNI ${escapeHtml(row.dni || '—')}</div></td>
              <td style="padding:10px 12px">${escapeHtml(row.clinica || '—')}</td>
              <td style="padding:10px 12px">${escapeHtml(stage)}</td>
              <td style="padding:10px 12px;color:${alert?.severity === 'red' ? C.red : C.amber}">${escapeHtml(alert?.msg || '—')}</td>
              <td style="padding:10px 12px;text-align:center;font-weight:900;color:${alert?.severity === 'red' ? C.red : C.amber}">${escapeHtml(String(alert?.days ?? '—'))}</td>
            </tr>`).join('') : `
            <tr><td colspan="5" style="padding:18px;text-align:center;color:#64748b">Sin alertas para contar en la vista actual.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  view.innerHTML = html;
  view.onclick = e => {
    const tr = e.target.closest('[data-open-side]');
    if (tr) openSide(tr.dataset.openSide);
  };
  const monthSel = document.getElementById('statsMonthFilter');
  if (monthSel) {
    monthSel.addEventListener('change', ev => {
      statsMonth = ev.target.value || '';
      renderEstadisticas();
    });
  }

  Chart.defaults.font.family = "'DM Sans', sans-serif";
  Chart.defaults.color = '#475569';
  Chart.defaults.plugins.legend.labels.boxWidth = 12;

  createChart('chartStages', {
    type: 'bar',
    data: {
      labels: ['Listo p/ pedir', 'Esperando lente', 'Programar', 'Programada', 'Falta facturar', 'Facturada', '2º ojo'],
      datasets: [{
        data: [
          stageCounts['PEDIR LENTE'],
          stageCounts['ESPERANDO LENTE'],
          stageCounts['LLEGÓ LENTE - PROGRAMAR CIRUGÍA'],
          stageCounts['FECHA PROGRAMADA'],
          stageCounts['REALIZADA'],
          stageCounts['FINALIZADO'],
          facturadaFalta,
        ],
        backgroundColor: ['#c7d2fe', '#93c5fd', '#67e8f9', '#86efac', '#fcd34d', '#86efac', '#ddd6fe'],
        borderRadius: 10,
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: gridlessAxis({ beginAtZero: true, ticks: { precision: 0 } }), y: gridlessAxis() }
    }
  });

  createChart('chartClinics', {
    type: 'doughnut',
    data: {
      labels: clinicKeys,
      datasets: [{
        data: clinicKeys.map(k => clinicCount[k]),
        backgroundColor: ['#1d4f91', '#0f766e', '#7c3aed', '#b45309', '#dc2626'],
        borderWidth: 2,
        borderColor: '#fff',
      }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw}` } }
      },
      cutout: '62%'
    }
  });

  createChart('chartTrend', {
    type: 'bar',
    data: {
      labels: monthKeys.map(shortMonthLabel),
      datasets: [
        { label: 'Solicitadas', data: monthly.map(x => x.solicitadas), backgroundColor: '#93c5fd', borderRadius: 6 },
        { label: 'Programadas', data: monthly.map(x => x.programadas), backgroundColor: '#86efac', borderRadius: 6 },
        { label: 'Facturadas', data: monthly.map(x => x.facturadas), backgroundColor: '#c4b5fd', borderRadius: 6 },
      ]
    },
    options: {
      plugins: { legend: { position: 'bottom' } },
      scales: { x: gridlessAxis(), y: gridlessAxis({ beginAtZero: true, ticks: { precision: 0 } }) }
    }
  });

  createChart('chartExtras', {
    type: 'bar',
    data: {
      labels: Object.keys(additionalCounts),
      datasets: [{
        label: '% sobre facturadas',
        data: Object.values(additionalCounts).map(v => percent(v, facturadas.length)),
        backgroundColor: ['#60a5fa', '#f59e0b', '#8b5cf6'],
        borderRadius: 8,
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.raw}% (${Object.values(additionalCounts)[ctx.dataIndex]} casos)` } }
      },
      scales: { x: gridlessAxis(), y: gridlessAxis({ beginAtZero: true, max: 100, ticks: { callback: v => `${v}%` } }) }
    }
  });
}
