// ─────────────────────────────────────────────────────
//  COMPARE.JS — UI sectiune Comparatii simulari salvate
// ─────────────────────────────────────────────────────

import { listSimulations, loadSimulation, deleteSimulation,
         exportDB, importDB, listTickers, initDB } from './db.js';
import { $ } from './ui.js';

let _charts = [];

function destroyCharts() {
  _charts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _charts = [];
}

// ── Format data ───────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ro-RO', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) + ' ' + d.toLocaleTimeString('ro-RO', {
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: '2-digit' });
}

// ── Culorile pentru simulari diferite ────────────────

const PALETTE = [
  { p50: '#ffee58', p10: '#ef9a9a', p90: '#a5d6a7' },
  { p50: '#4fc3f7', p10: '#ce93d8', p90: '#80cbc4' },
  { p50: '#ff8a65', p10: '#f48fb1', p90: '#c5e1a5' },
  { p50: '#b39ddb', p10: '#ff8a80', p90: '#69f0ae' },
];

// ── Render lista simulari ─────────────────────────────

export function renderCompareList(ticker = '') {
  const listEl = $('compare-list');
  if (!listEl) return;

  const sims = listSimulations(ticker.trim().toUpperCase() || null);

  if (sims.length === 0) {
    listEl.innerHTML = `
      <div style="color:rgba(255,255,255,0.25);text-align:center;padding:40px 20px;font-size:13px">
        ${ticker
          ? `Nicio simulare salvată pentru <strong style="color:#4fc3f7">${ticker.toUpperCase()}</strong>.`
          : 'Nicio simulare salvată încă.<br>Rulează o simulare și va fi salvată automat.'}
      </div>`;
    return;
  }

  // Grupare pe ticker
  const grouped = {};
  sims.forEach(s => {
    if (!grouped[s.ticker]) grouped[s.ticker] = [];
    grouped[s.ticker].push(s);
  });

  listEl.innerHTML = Object.entries(grouped).map(([tick, rows]) => `
    <div style="margin-bottom:8px">
      <div style="color:#4fc3f7;font-size:11px;font-weight:600;
                  padding:4px 8px;background:rgba(79,195,247,0.08);
                  border-radius:4px;margin-bottom:4px">
        ${tick} — ${rows[0].name ?? ''}
      </div>
      ${rows.map(s => `
        <div class="compare-row" style="display:flex;align-items:center;
             gap:10px;padding:7px 8px;border-radius:6px;margin-bottom:2px;
             background:rgba(255,255,255,0.03);
             border:1px solid rgba(255,255,255,0.06)">
          <input type="checkbox" class="compare-chk" data-id="${s.id}"
                 style="width:15px;height:15px;cursor:pointer;flex-shrink:0;
                        accent-color:#4fc3f7">
          <div style="flex:1;min-width:0">
            <span style="color:#e0e0ff;font-weight:500">
              ${s.currency} ${s.price?.toFixed(2) ?? '—'}
            </span>
            <span style="color:#555577;font-size:11px;margin-left:10px">
              ${fmtDate(s.simulated_at)}
            </span>
            ${s.sent_global != null ? `
              <span style="font-size:10px;margin-left:8px;
                color:${s.sent_global > 0.05 ? '#66bb6a' : s.sent_global < -0.05 ? '#ef5350' : '#888'}">
                sent ${s.sent_global >= 0 ? '+' : ''}${s.sent_global.toFixed(3)}
              </span>` : ''}
            ${s.vol_trend ? `
              <span style="font-size:10px;color:#888;margin-left:6px">${s.vol_trend}</span>` : ''}
          </div>
          <button class="compare-del-btn" data-id="${s.id}"
                  title="Șterge simularea"
                  style="background:none;border:none;color:#555;cursor:pointer;
                         font-size:15px;padding:2px 6px;flex-shrink:0;
                         transition:color .15s"
                  onmouseover="this.style.color='#ef5350'"
                  onmouseout="this.style.color='#555'">✕</button>
        </div>
      `).join('')}
    </div>
  `).join('');

  // Event listeners stergere
  listEl.querySelectorAll('.compare-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm('Ștergi această simulare din baza de date?')) {
        deleteSimulation(parseInt(btn.dataset.id));
        renderCompareList(ticker);
      }
    });
  });
}

// ── Grafic overlay comparatie ─────────────────────────

function drawCompareChart(canvasId, datasets, basePrice) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const maxLen = Math.max(...datasets.map(d => d.p50?.length ?? 0));

  const chartDatasets = [];

  // Linie pret de referinta
  chartDatasets.push({
    label:       'Preț referință',
    data:        Array(maxLen).fill(basePrice),
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderDash:  [4, 4],
    pointRadius: 0,
    fill:        false,
    order:       99,
  });

  datasets.forEach((d, i) => {
    const col   = PALETTE[i % PALETTE.length];
    const label = `${d.ticker} ${fmtDateShort(d.simulated_at)}`;
    chartDatasets.push(
      {
        label:       `${label} P90`,
        data:        d.p90,
        borderColor: col.p90,
        borderWidth: 1.2,
        pointRadius: 0,
        fill:        false,
        tension:     0.3,
        borderDash:  [3, 3],
      },
      {
        label:       `${label} P50`,
        data:        d.p50,
        borderColor: col.p50,
        borderWidth: 2,
        pointRadius: 0,
        fill:        false,
        tension:     0.3,
      },
      {
        label:       `${label} P10`,
        data:        d.p10,
        borderColor: col.p10,
        borderWidth: 1.2,
        pointRadius: 0,
        fill:        false,
        tension:     0.3,
        borderDash:  [3, 3],
      },
    );
  });

  const chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels:   Array.from({ length: maxLen }, (_, i) => i),
      datasets: chartDatasets,
    },
    options: {
      animation:           false,
      responsive:          true,
      maintainAspectRatio: false,
      interaction:         { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#aaa', font: { size: 10 }, boxWidth: 14, padding: 8 },
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2) ?? '—'}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#555577', maxTicksLimit: 8, font: { size: 10 } },
          grid:  { color: 'rgba(255,255,255,0.04)' },
          title: { display: true, text: 'Zile', color: '#666', font: { size: 10 } },
        },
        y: {
          ticks: {
            color:    '#555577',
            font:     { size: 10 },
            callback: v => v.toFixed(0),
          },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
      },
    },
  });

  _charts.push(chart);
}

// ── Tabel comparativ stats ────────────────────────────

function buildStatsTable(validSims, availPeriods) {
  return `
    <div style="overflow-x:auto;margin-bottom:20px">
      <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:500px">
        <thead>
          <tr style="color:#888;border-bottom:1px solid rgba(255,255,255,0.1)">
            <th style="text-align:left;padding:7px 8px;white-space:nowrap">Simulare</th>
            <th style="padding:7px 8px;text-align:right">Preț bază</th>
            ${availPeriods.map(d => `
              <th style="padding:7px 4px;text-align:center" colspan="3">
                ${d}z · P10 / P50 / P90
              </th>
            `).join('')}
            <th style="padding:7px 8px;text-align:center">%Profit<br><span style="font-size:9px;color:#555">30z</span></th>
          </tr>
        </thead>
        <tbody>
          ${validSims.map((s, i) => {
            const col = PALETTE[i % PALETTE.length];
            return `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
                <td style="padding:7px 8px;white-space:nowrap">
                  <span style="color:${col.p50};font-weight:600">${s.sim.ticker}</span><br>
                  <span style="color:#555;font-size:10px">${fmtDateShort(s.sim.simulated_at)}</span>
                </td>
                <td style="padding:7px 8px;text-align:right;color:#e0e0ff">
                  ${s.sim.currency} ${s.sim.price?.toFixed(2) ?? '—'}
                </td>
                ${availPeriods.map(d => {
                  const p = s.periods[d];
                  if (!p) return `<td colspan="3" style="text-align:center;color:#333">—</td>`;
                  return `
                    <td style="padding:5px 4px;text-align:center;color:#ef9a9a">
                      ${p.stats.p10?.toFixed(2) ?? '—'}
                    </td>
                    <td style="padding:5px 4px;text-align:center;
                               color:${col.p50};font-weight:600">
                      ${p.stats.median?.toFixed(2) ?? '—'}
                    </td>
                    <td style="padding:5px 4px;text-align:center;color:#a5d6a7">
                      ${p.stats.p90?.toFixed(2) ?? '—'}
                    </td>
                  `;
                }).join('')}
                <td style="padding:7px 8px;text-align:center;
                           color:${(s.periods[30]?.stats.probProfit ?? 0) > 0.5 ? '#66bb6a' : '#ef5350'};
                           font-weight:600">
                  ${((s.periods[30]?.stats.probProfit ?? 0) * 100).toFixed(1)}%
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ── Ruleaza comparatia ────────────────────────────────

export function runComparison() {
  const checked = [...document.querySelectorAll('.compare-chk:checked')];
  const resultEl = $('compare-result');
  if (!resultEl) return;

  if (checked.length < 2) {
    resultEl.innerHTML = `
      <div style="color:#ff8a65;text-align:center;padding:20px;font-size:13px">
        ⚠ Selectează cel puțin 2 simulări pentru comparație.
      </div>`;
    return;
  }
  if (checked.length > 4) {
    resultEl.innerHTML = `
      <div style="color:#ff8a65;text-align:center;padding:20px;font-size:13px">
        ⚠ Maxim 4 simulări simultan.
      </div>`;
    return;
  }

  destroyCharts();
  resultEl.innerHTML = `<div style="color:#aaa;text-align:center;padding:20px">Se încarcă...</div>`;

  const validSims = checked
    .map(chk => loadSimulation(parseInt(chk.dataset.id)))
    .filter(Boolean);

  if (!validSims.length) {
    resultEl.innerHTML = `<div style="color:#ef5350;padding:20px">Eroare la încărcare.</div>`;
    return;
  }

  const periods      = [30, 90, 180, 360];
  const availPeriods = periods.filter(d =>
    validSims.some(s => s.periods[d]?.stats)
  );
  const availPercsP  = periods.filter(d =>
    validSims.some(s => s.periods[d]?.percs)
  );

  // ── Tabel + grafice ─────────────────────────────
  const chartsHtml = availPercsP.map(days => `
    <div style="margin-bottom:24px">
      <div style="color:#888;font-size:11px;text-transform:uppercase;
                  letter-spacing:.06em;margin-bottom:8px">
        Traiectorii ${days} zile
      </div>
      <div style="height:230px;position:relative">
        <canvas id="compare-chart-${days}"></canvas>
      </div>
    </div>
  `).join('');

  resultEl.innerHTML =
    buildStatsTable(validSims, availPeriods) +
    (chartsHtml
      ? `<div style="margin-top:8px">${chartsHtml}</div>`
      : '<div style="color:#555;font-size:12px">Traiectoriile nu sunt disponibile pentru simulările selectate.</div>');

  // ── Deseneaza graficele ─────────────────────────
  const basePrice = validSims[0].sim.price;

  availPercsP.forEach(days => {
    const datasets = validSims
      .map(s => {
        const pd = s.periods[days];
        if (!pd?.percs) return null;
        // cheile pot fi string sau number dupa JSON.parse
        const p10 = pd.percs['10'] ?? pd.percs[10];
        const p50 = pd.percs['50'] ?? pd.percs[50];
        const p90 = pd.percs['90'] ?? pd.percs[90];
        if (!p50) return null;
        return {
          ticker:       s.sim.ticker,
          simulated_at: s.sim.simulated_at,
          p10, p50, p90,
        };
      })
      .filter(Boolean);

    if (datasets.length) {
      drawCompareChart(`compare-chart-${days}`, datasets, basePrice);
    }
  });
}

// ── Init sectiune ─────────────────────────────────────

export async function initCompareSection() {
  // Asigura DB initializat
  try { await initDB(); } catch (e) { console.warn('DB init:', e); }

  const searchEl    = $('compare-search');
  const searchBtn   = $('compare-search-btn');
  const compareBtn  = $('compare-run-btn');
  const exportBtn   = $('compare-export-btn');
  const importBtn   = $('compare-import-btn');
  const importInput = $('compare-import-input');

  if (searchBtn) {
    searchBtn.addEventListener('click', () =>
      renderCompareList(searchEl?.value ?? '')
    );
  }
  if (searchEl) {
    searchEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') renderCompareList(searchEl.value);
    });
  }
  if (compareBtn) {
    compareBtn.addEventListener('click', runComparison);
  }
  if (exportBtn) {
    exportBtn.addEventListener('click', exportDB);
  }
  if (importBtn) {
    importBtn.addEventListener('click', () => importInput?.click());
  }
  if (importInput) {
    importInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await importDB(file);
        renderCompareList(searchEl?.value ?? '');
        alert('Baza de date importată cu succes!');
      } catch (err) {
        alert(`Eroare import: ${err.message}`);
      }
      e.target.value = '';
    });
  }

  // Afiseaza toate simulările la deschidere
  renderCompareList('');
}
