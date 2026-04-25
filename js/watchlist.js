// ─────────────────────────────────────────────────────
//  WATCHLIST.JS — UI watchlist: randare, export, import,
//                 lightbox grafice, drag-and-drop reordering
// ─────────────────────────────────────────────────────

import { $, showSection } from './ui.js';
import { loadWatchlist, saveToWatchlist, WATCHLIST_KEY } from './storage.js';

// ── Captureaza graficele pentru toate perioadele ──────

export async function captureChartsForWatchlist(periodResults, currentPrice, ticker) {
  const captures = {};

  const tmpDiv = document.createElement('div');
  tmpDiv.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'width:660px',
    'opacity:0.01', 'pointer-events:none',
    'z-index:99999', 'overflow:visible',
  ].join(';');
  document.body.appendChild(tmpDiv);

  function toJpeg(canvas) {
    try {
      const bg  = document.createElement('canvas');
      bg.width  = canvas.width;
      bg.height = canvas.height;
      const ctx = bg.getContext('2d');
      ctx.fillStyle = '#0d0d1a';
      ctx.fillRect(0, 0, bg.width, bg.height);
      ctx.drawImage(canvas, 0, 0);
      return bg.toDataURL('image/jpeg', 0.82);
    } catch (e) { return null; }
  }

  try {
    for (const days of [30, 90, 180, 360]) {
      const pd = periodResults[days];
      if (!pd) continue;

      const trajC = document.createElement('canvas');
      trajC.width = 370; trajC.height = 188;
      const histC = document.createElement('canvas');
      histC.width = 270; histC.height = 188;
      tmpDiv.appendChild(trajC);
      tmpDiv.appendChild(histC);

      let chartTraj = null, chartHist = null;
      try {
        const labels = Array.from({ length: days + 1 }, (_, i) => i);
        chartTraj = new Chart(trajC.getContext('2d'), {
          type: 'line',
          data: {
            labels,
            datasets: [
              { label: 'P90', data: Array.from(pd.percs[90]), borderColor: '#66bb6a', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 },
              { label: 'P50', data: Array.from(pd.percs[50]), borderColor: '#ffee58', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 },
              { label: 'P10', data: Array.from(pd.percs[10]), borderColor: '#ef5350', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 },
              { label: `$${currentPrice.toFixed(0)}`, data: Array(days + 1).fill(currentPrice), borderColor: 'rgba(255,255,255,0.3)', borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false },
            ],
          },
          options: {
            animation: false, responsive: false, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#aaa', font: { size: 9 }, boxWidth: 12 } } },
            scales: {
              x: { ticks: { color: '#555577', maxTicksLimit: 6, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
              y: { ticks: { color: '#555577', callback: v => `$${v.toFixed(0)}`, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
            },
          },
        });

        const allFinals = Array.from(pd.stats.finals);
        const minVal    = pd.stats.min * 0.95;
        const maxVal    = pd.stats.max * 1.05;
        const nBins     = 40;
        const binSize   = (maxVal - minVal) / nBins;
        const bins      = Array(nBins).fill(0);
        allFinals.forEach(v => {
          const b = Math.min(Math.floor((v - minVal) / binSize), nBins - 1);
          if (b >= 0) bins[b]++;
        });
        chartHist = new Chart(histC.getContext('2d'), {
          type: 'bar',
          data: {
            labels: Array.from({ length: nBins }, (_, i) => (minVal + i * binSize).toFixed(0)),
            datasets: [{
              data: bins,
              backgroundColor: bins.map((_, i) =>
                (minVal + i * binSize) >= currentPrice ? 'rgba(102,187,106,0.7)' : 'rgba(239,83,80,0.7)'
              ),
              borderWidth: 0,
            }],
          },
          options: {
            animation: false, responsive: false, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: '#555577', maxTicksLimit: 5, font: { size: 8 } }, grid: { display: false } },
              y: { ticks: { color: '#555577', font: { size: 8 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
            },
          },
        });
      } catch (drawErr) {
        console.error(`Draw error ${days}d:`, drawErr);
      }

      await new Promise(r => setTimeout(r, 60));

      const tj = toJpeg(trajC);
      const hj = toJpeg(histC);
      if (tj || hj) captures[days] = { traj: tj, hist: hj };

      try { chartTraj?.destroy(); } catch (_) {}
      try { chartHist?.destroy(); } catch (_) {}
    }
  } finally {
    try { document.body.removeChild(tmpDiv); } catch (_) {}
  }

  return captures;
}

// ── HTML grafice pentru un entry ─────────────────────

export function chartsHTML(e, forExport = false) {
  if (!e.charts) return '';
  const PERIODS_LIST = [30, 90, 180, 360];
  const imgStyle = forExport
    ? 'width:48%;border-radius:6px;'
    : 'width:48%;border-radius:6px;cursor:zoom-in;';

  return `<div style="margin-top:12px;">
    <div style="font-size:10px;color:rgba(255,255,255,0.30);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">
      Traiectorii simulate · Cotatie la salvare: ${e.currency} ${e.price} · ${e.date} ${e.time || ''}
    </div>
    ${PERIODS_LIST.filter(d => e.charts[d]).map(days => `
      <div style="margin-bottom:10px;">
        <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:4px;font-weight:600;">${days} ZILE</div>
        <div style="display:flex;gap:2%;align-items:flex-start;">
          <img src="${e.charts[days].traj}" style="${imgStyle}" alt="Traj ${days}z">
          <img src="${e.charts[days].hist}" style="${imgStyle}" alt="Hist ${days}z">
        </div>
      </div>
    `).join('')}
  </div>`;
}

// ── Lightbox ──────────────────────────────────────────

function ensureLightbox() {
  let lb = $('wl-lightbox');
  if (lb) return lb;
  lb = document.createElement('div');
  lb.id = 'wl-lightbox';
  lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.90);z-index:10000;overflow-y:auto;padding:48px 16px 32px;';
  lb.innerHTML = `
    <div style="max-width:840px;margin:auto;position:relative;">
      <button id="wl-lb-close" style="position:fixed;top:14px;right:18px;background:rgba(255,255,255,0.1);
              border:1px solid rgba(255,255,255,0.2);color:#e0e0e0;border-radius:20px;
              padding:6px 16px;cursor:pointer;font-size:13px;font-weight:600;">✕ Închide</button>
      <div id="wl-lb-content"></div>
    </div>`;
  lb.addEventListener('click', e => { if (e.target === lb) lb.style.display = 'none'; });
  lb.querySelector('#wl-lb-close').addEventListener('click', () => { lb.style.display = 'none'; });
  document.body.appendChild(lb);
  return lb;
}

window.openWatchlistCharts = function (idx) {
  const list = loadWatchlist();
  const e    = list[idx];
  if (!e) return;
  const lb      = ensureLightbox();
  const content = $('wl-lb-content');
  const periods = [30, 90, 180, 360].filter(d => e.charts?.[d]);
  const cp  = e.currentPrice ?? parseFloat(e.price) ?? 0;
  const sym = e.currency === 'USD' ? '$' : (e.currency + ' ');

  const fmtN = (v, d = 2) => v != null
    ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
    : '—';
  const fmtDelta = v => (cp > 0 && v != null)
    ? ` <span style="opacity:0.55;font-size:9.5px;">(${v >= cp ? '+' : ''}${(((v - cp) / cp) * 100).toFixed(1)}%)</span>`
    : '';
  const pRow = (lbl, val, col) => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;
                padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="font-size:10px;color:rgba(255,255,255,0.42);">${lbl}</span>
      <span style="font-size:10.5px;font-weight:700;color:${col || '#e0e0e0'};">
        ${sym}${fmtN(val)}${fmtDelta(val)}</span>
    </div>`;
  const pRowPct = (lbl, val, col) => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;
                padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="font-size:10px;color:rgba(255,255,255,0.42);">${lbl}</span>
      <span style="font-size:10.5px;font-weight:700;color:${col || '#e0e0e0'};">
        ${val != null ? val.toFixed(1) + '%' : '—'}</span>
    </div>`;

  // ── Sectiune statistici per coloana ─────────────────
  const statsCol = days => {
    const s = e.periodStats?.[days];
    if (!s) return '';
    const probColor = p => p >= 70 ? '#66bb6a' : p >= 50 ? '#ffee58' : '#ef5350';
    return `
      <div style="margin-top:8px;background:rgba(0,0,0,0.30);border-radius:7px;padding:8px 10px;">
        <div style="font-size:9px;font-weight:600;color:rgba(255,255,255,0.28);letter-spacing:0.4px;
                    text-transform:uppercase;margin-bottom:4px;">Statistici — ${days} zile</div>
        ${pRow('Preț curent', cp, '#fff')}
        ${pRow('Medie',       s.mean,   '#ffee58')}
        ${pRow('P90 optimist', s.p90,   '#66bb6a')}
        ${pRow('P10 pesimist', s.p10,   '#ef5350')}
        ${pRow('Max simulat',  s.max,   '#4fc3f7')}
        ${pRow('Min simulat',  s.min,   '#4fc3f7')}
        <div style="height:3px;"></div>
        ${pRowPct('Prob. profit',   s.probProfit, probColor(s.probProfit))}
        ${pRowPct('Gain > 10%',     s.probGain10, probColor(s.probGain10))}
        ${pRowPct('Loss > 10%',     s.probLoss10, s.probLoss10 < 10 ? '#66bb6a' : '#ef5350')}
      </div>`;
  };

  // ── Sectiune valuare fundamentala ────────────────────
  const vf = e.valFundamentals;
  const hasFund = vf && (vf.eps != null || vf.pe != null || vf.fcf != null || vf.resultsHTML);
  const fundHtml = hasFund ? `
    <div style="margin-bottom:20px;padding:14px 16px;background:rgba(255,255,255,0.03);
                border:1px solid rgba(255,255,255,0.09);border-radius:10px;">
      <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.30);
                  letter-spacing:0.6px;text-transform:uppercase;margin-bottom:10px;">⚖️ Valuare Fundamentală</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 22px;font-size:12px;margin-bottom:12px;">
        ${vf.eps    != null ? `<span><span style="color:rgba(255,255,255,0.42)">EPS: </span><b>${sym}${fmtN(vf.eps)}</b></span>` : ''}
        ${vf.pe     != null ? `<span><span style="color:rgba(255,255,255,0.42)">P/E: </span><b>${fmtN(vf.pe, 1)}x</b></span>` : ''}
        ${vf.fcf    != null ? `<span><span style="color:rgba(255,255,255,0.42)">FCF/acț: </span><b>${sym}${fmtN(vf.fcf)}</b></span>` : ''}
        ${vf.growth != null ? `<span><span style="color:rgba(255,255,255,0.42)">Creștere: </span><b style="color:#ffee58">${fmtN(vf.growth, 1)}%</b></span>` : ''}
        ${vf.wacc   != null ? `<span><span style="color:rgba(255,255,255,0.42)">WACC: </span><b>${fmtN(vf.wacc, 1)}%</b></span>` : ''}
        ${vf.tgr    != null ? `<span><span style="color:rgba(255,255,255,0.42)">Rată term.: </span><b>${fmtN(vf.tgr, 1)}%</b></span>` : ''}
        ${vf.assets != null ? `<span><span style="color:rgba(255,255,255,0.42)">Active: </span><b>${fmtN(vf.assets, 0)}M</b></span>` : ''}
        ${vf.cash   != null ? `<span><span style="color:rgba(255,255,255,0.42)">Cash: </span><b>${fmtN(vf.cash, 0)}M</b></span>` : ''}
        ${vf.debt   != null ? `<span><span style="color:rgba(255,255,255,0.42)">Datorii: </span><b>${fmtN(vf.debt, 0)}M</b></span>` : ''}
        ${vf.dividend   != null ? `<span><span style="color:rgba(255,255,255,0.42)">Dividend: </span><b style="color:#a5d6a7">${sym}${fmtN(vf.dividend, 2)}/acț</b></span>` : ''}
        ${vf.occupancy  != null ? `<span><span style="color:rgba(255,255,255,0.42)">Ocupare: </span><b style="color:#4fc3f7">${fmtN(vf.occupancy, 1)}%</b></span>` : ''}
        ${vf.ltv        != null ? `<span><span style="color:rgba(255,255,255,0.42)">LTV: </span><b style="color:#ffb74d">${fmtN(vf.ltv, 1)}%</b></span>` : ''}
      </div>
      ${(() => {
        // ── Rând Valoare Țintă + Marjă Siguranță ──────────
        const wv = vf.weightedValue;
        const ms = vf.marginOfSafety;
        if (wv == null && ms == null) return '';
        const msColor = ms == null ? '#888'
                      : ms > 20   ? '#66bb6a'
                      : ms > 0    ? '#ffee58'
                      :              '#ef5350';
        const msLabel = ms == null ? ''
                      : ms > 20   ? '✔ Subapreciată'
                      : ms > 0    ? '≈ Corect evaluată'
                      :              '✘ Supraevaluată';
        return `<div style="display:flex;align-items:center;gap:18px;padding:8px 10px;margin-bottom:10px;
                            background:rgba(255,255,255,0.03);border-radius:7px;border:1px solid rgba(255,255,255,0.07);">
          ${wv != null ? `<span style="font-size:12px;"><span style="color:rgba(255,255,255,0.42)">Val. țintă: </span><b style="color:#ce93d8;font-size:13px;">${sym}${fmtN(wv, 2)}</b></span>` : ''}
          ${ms != null ? `<span style="font-size:12px;"><span style="color:rgba(255,255,255,0.42)">Marjă: </span><b style="color:${msColor};font-size:13px;">${ms >= 0 ? '+' : ''}${fmtN(ms, 1)}%</b> <span style="font-size:10px;color:${msColor}aa;">${msLabel}</span></span>` : ''}
        </div>`;
      })()}
      ${vf.resultsHTML ? `<div class="val-results-grid" style="pointer-events:none;opacity:0.92;">${vf.resultsHTML}</div>` : ''}
      ${vf.fundamentalComment ? `
        <div style="margin-top:12px;padding:12px 14px;
                    background:linear-gradient(135deg,rgba(18,18,31,0.95),rgba(26,26,46,0.95));
                    border:1px solid rgba(124,106,247,0.22);border-radius:8px;
                    font-size:11px;line-height:1.7;color:#e8e8f0;">
          ${vf.fundamentalComment}
        </div>` : ''}
    </div>` : '';

  // ── Grid 4 coloane — grafice + statistici ─────────────
  const gridHtml = periods.length ? `
    <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.28);
                letter-spacing:0.6px;text-transform:uppercase;margin-bottom:10px;">
      📊 Monte Carlo — ${e.ticker} · 10,000 simulări
    </div>
    <div style="display:grid;grid-template-columns:repeat(${periods.length},1fr);gap:10px;">
      ${periods.map(days => `
        <div>
          <div style="font-size:9.5px;font-weight:700;color:rgba(255,255,255,0.35);
                      letter-spacing:0.6px;text-transform:uppercase;
                      text-align:center;margin-bottom:5px;">${days} ZILE</div>
          <img src="${e.charts[days].traj}" style="width:100%;border-radius:6px;display:block;margin-bottom:3px;" alt="Traj ${days}z">
          <img src="${e.charts[days].hist}" style="width:100%;border-radius:6px;display:block;" alt="Hist ${days}z">
          ${statsCol(days)}
        </div>`).join('')}
    </div>` : '<div style="color:rgba(255,255,255,0.3);font-size:13px;">Nu există grafice salvate.</div>';

  // ── Badge AI pentru lightbox ─────────────────────────
  const lbAiTotal   = e.valFundamentals?.aiTotal   ?? null;
  const lbAiVerdict = e.valFundamentals?.aiVerdict ?? null;
  const lbAiFund    = e.valFundamentals?.aiFundScore ?? null;
  const lbAiTech    = e.valFundamentals?.aiTechScore ?? null;
  const lbAiConf    = e.valFundamentals?.aiConfidence ?? null;
  const lbAiColor   = lbAiVerdict === 'BUY' ? '#66bb6a' : lbAiVerdict === 'HOLD' ? '#ffee58' : lbAiVerdict === 'AVOID' ? '#ef5350' : null;
  const lbAiBadge   = lbAiTotal != null ? `
    <div style="display:inline-flex;align-items:center;gap:12px;padding:8px 16px;margin-top:8px;
                background:${lbAiColor}0f;border:1px solid ${lbAiColor}33;border-radius:10px;">
      <div style="text-align:center;">
        <div style="font-size:26px;font-weight:800;color:${lbAiColor};line-height:1">${lbAiTotal}</div>
        <div style="font-size:9px;color:rgba(255,255,255,0.35)">/100</div>
      </div>
      <div>
        <div style="font-size:15px;font-weight:800;color:${lbAiColor};letter-spacing:1px">${lbAiVerdict}</div>
        ${lbAiConf ? `<div style="font-size:10px;color:rgba(255,255,255,0.42);margin-top:1px">Conf. ${lbAiConf}</div>` : ''}
        <div style="font-size:10px;color:rgba(255,255,255,0.32);margin-top:1px">Fund ${lbAiFund}/100 · Tehnic ${lbAiTech}/100</div>
      </div>
    </div>` : '';

  content.innerHTML = `
    <div style="margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <span style="font-size:22px;font-weight:700;color:#e0e0e0;">${e.ticker}</span>
      <span style="font-size:13px;color:rgba(255,255,255,0.40);margin-left:10px;">${e.name}</span><br>
      <span style="font-size:20px;font-weight:700;color:#4fc3f7;">${e.currency} ${e.price}</span>
      <span style="font-size:13px;color:rgba(255,255,255,0.40);margin-left:14px;">${e.date}${e.time ? ' · ' + e.time : ''}</span>
      ${lbAiBadge}
    </div>
    ${fundHtml}
    ${gridHtml}`;

  lb.style.display = 'block';
  lb.scrollTop = 0;
};

// ── Randeaza lista watchlist ──────────────────────────

export function renderWatchlist() {
  const list    = loadWatchlist();
  const cards   = $('watchlist-cards');
  const empty   = $('watchlist-empty');
  const countEl = $('watchlist-count');
  if (!cards) return;

  if (list.length === 0) {
    empty.style.display = 'block';
    cards.innerHTML     = '';
    if (countEl) countEl.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  if (countEl) { countEl.textContent = list.length; countEl.style.display = 'inline'; }

  const btnBase = 'padding:4px 11px;border-radius:12px;font-size:10.5px;cursor:pointer;font-weight:600;';

  cards.innerHTML = list.map((e, idx) => {
    const hasCharts = e.charts && Object.keys(e.charts).some(k => e.charts[k]);
    const vf = e.valFundamentals;
    const aiTotal   = vf?.aiTotal   ?? null;
    const aiVerdict = vf?.aiVerdict ?? null;
    const aiFund    = vf?.aiFundScore ?? null;
    const aiTech    = vf?.aiTechScore ?? null;
    const aiColor   = aiVerdict === 'BUY' ? '#66bb6a' : aiVerdict === 'HOLD' ? '#ffee58' : aiVerdict === 'AVOID' ? '#ef5350' : null;
    const aiBadge   = aiTotal != null ? `
      <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px 3px 7px;
                   border-radius:20px;border:1px solid ${aiColor}44;background:${aiColor}12;
                   font-size:11px;font-weight:700;color:${aiColor};margin-left:8px;">
        ${aiVerdict} <span style="font-size:13px;font-weight:800">${aiTotal}</span>
        <span style="font-size:9px;font-weight:400;color:rgba(255,255,255,0.35)">/100</span>
      </span>` : '';
    return `
    <div data-idx="${idx}" draggable="true"
         style="background:rgba(255,255,255,0.03);border:1px solid ${aiColor ? aiColor + '22' : 'rgba(255,255,255,0.08)'};
                border-radius:10px;padding:14px 16px;transition:opacity 0.15s,border-color 0.15s;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span title="Trage pentru a reordona"
                style="font-size:18px;color:rgba(255,255,255,0.18);cursor:grab;user-select:none;flex-shrink:0;line-height:1.4;padding-top:1px;">⠿</span>
          <div>
            <span style="font-size:16px;font-weight:700;color:#e0e0e0;">${e.ticker}</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.45);margin-left:8px;">${e.name}</span>
            <span style="font-size:13px;color:#4fc3f7;margin-left:8px;font-weight:600;">${e.currency} ${e.price}</span>
            ${aiBadge}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${aiTotal != null ? `<span style="font-size:9.5px;color:rgba(255,255,255,0.28);">Fund ${aiFund}/100 · Teh ${aiTech}/100</span>` : ''}
          <span style="font-size:10px;color:rgba(255,255,255,0.30);">${e.date}${e.time ? ' ' + e.time : ''}</span>
          ${hasCharts ? `<button onclick="openWatchlistCharts(${idx})"
               style="${btnBase}border:1px solid rgba(79,195,247,0.35);background:rgba(79,195,247,0.08);color:#4fc3f7;">📊 Grafice</button>` : ''}
          <button onclick="removeWatchlistEntry(${idx})"
               style="${btnBase}border:1px solid rgba(239,83,80,0.3);background:transparent;color:#ef5350;">✕</button>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:5px;">
        ${(e.pills || []).map(p => `<span style="font-size:10.5px;padding:2px 8px;border-radius:12px;
             border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);
             color:rgba(255,255,255,0.65);">${p}</span>`).join('')}
      </div>
      ${e.comment ? `<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.45);line-height:1.55;">${e.comment}</div>` : ''}
      ${(() => {
        if (!vf) return '';
        const sym  = e.currency === 'USD' ? '$' : e.currency + ' ';
        const fN   = (v, d=2) => v != null ? v.toFixed(d) : null;
        const wv   = vf.weightedValue;
        const ms   = vf.marginOfSafety;
        const msC  = ms == null ? '#888' : ms > 20 ? '#66bb6a' : ms > 0 ? '#ffee58' : '#ef5350';
        const parts = [
          wv != null ? `<span style="color:rgba(255,255,255,0.38)">Val. țintă: </span><b style="color:#ce93d8">${sym}${fN(wv, 2)}</b>` : null,
          ms != null ? `<span style="color:rgba(255,255,255,0.38)">Marjă: </span><b style="color:${msC}">${ms >= 0 ? '+' : ''}${fN(ms, 1)}%</b>` : null,
          vf.dividend  != null ? `<span style="color:rgba(255,255,255,0.38)">Div: </span><b style="color:#a5d6a7">${sym}${fN(vf.dividend, 2)}</b>` : null,
          vf.occupancy != null ? `<span style="color:rgba(255,255,255,0.38)">Ocup: </span><b style="color:#4fc3f7">${fN(vf.occupancy, 1)}%</b>` : null,
          vf.ltv       != null ? `<span style="color:rgba(255,255,255,0.38)">LTV: </span><b style="color:#ffb74d">${fN(vf.ltv, 1)}%</b>` : null,
        ].filter(Boolean);
        if (!parts.length) return '';
        return `<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11px;
                            padding:5px 8px;border-radius:6px;background:rgba(255,255,255,0.025);
                            border:1px solid rgba(255,255,255,0.06);">
          ${parts.map(p => `<span>${p}</span>`).join('')}
        </div>`;
      })()}
    </div>`;
  }).join('');

  // ── Drag-and-drop reordering ──────────────────────────
  let dragSrc = null;

  Array.from(cards.children).forEach(card => {
    card.addEventListener('dragstart', ev => {
      dragSrc = card;
      ev.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { card.style.opacity = '0.35'; }, 0);
    });
    card.addEventListener('dragend', () => {
      dragSrc = null;
      Array.from(cards.children).forEach(c => { c.style.opacity = ''; c.style.borderColor = ''; });
    });
    card.addEventListener('dragover', ev => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      if (card !== dragSrc) card.style.borderColor = 'rgba(79,195,247,0.55)';
    });
    card.addEventListener('dragleave', () => { card.style.borderColor = ''; });
    card.addEventListener('drop', ev => {
      ev.preventDefault();
      if (!dragSrc || dragSrc === card) return;
      const from = parseInt(dragSrc.dataset.idx);
      const to   = parseInt(card.dataset.idx);
      const lst  = loadWatchlist();
      const [moved] = lst.splice(from, 1);
      lst.splice(to, 0, moved);
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(lst));
      renderWatchlist();
    });
  });
}

window.removeWatchlistEntry = function (idx) {
  const list = loadWatchlist();
  list.splice(idx, 1);
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  renderWatchlist();
};

// ── Export watchlist ca fisiere HTML ──────────────────

export function exportWatchlistHTML() {
  const list = loadWatchlist();
  if (!list.length) { alert('Lista e goala!'); return; }

  const CSS = `
  * { box-sizing: border-box; }
  body { font-family:'Segoe UI',sans-serif; background:#0d0d1a; color:#e0e0e0;
         padding:32px; max-width:980px; margin:auto; }
  h1   { font-size:22px; color:#4fc3f7; margin-bottom:4px; }
  .meta{ font-size:11px; color:rgba(255,255,255,0.35); margin-bottom:28px; }
  .card{ background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1);
         border-radius:10px; padding:20px 24px; margin-bottom:18px; }
  .card-header{ display:flex; justify-content:space-between; align-items:flex-start;
                flex-wrap:wrap; gap:10px; margin-bottom:12px; }
  .ticker{ font-size:22px; font-weight:700; color:#e0e0e0; margin-right:10px; }
  .name  { font-size:13px; color:rgba(255,255,255,0.45); margin-right:10px; }
  .price { font-size:22px; font-weight:700; color:#4fc3f7; }
  .date  { font-size:15px; font-weight:600; color:rgba(255,255,255,0.55);
           white-space:nowrap; text-align:right; }
  .time  { font-size:12px; color:rgba(255,255,255,0.30); display:block; margin-top:2px; }
  .pills { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:10px; }
  .pill  { font-size:10.5px; padding:2px 9px; border-radius:12px;
           border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.65); }
  .comment{ font-size:11px; color:rgba(255,255,255,0.42); line-height:1.65; margin-bottom:12px; }
  .charts-grid{ margin-top:14px; }
  .chart-period{ margin-bottom:14px; }
  .period-label{ font-size:10px; font-weight:600; color:rgba(255,255,255,0.35);
                 letter-spacing:0.5px; text-transform:uppercase; margin-bottom:5px; }
  .chart-row{ display:flex; gap:8px; }
  .chart-row img{ width:49%; border-radius:6px; display:block; }
  .val-results-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(115px,1fr)); gap:8px; margin-top:10px; }
  .val-method-card{ background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08);
                    border-radius:8px; padding:9px 11px; }
  .val-weighted-card{ background:rgba(79,195,247,0.07); border:1px solid rgba(79,195,247,0.28);
                      border-radius:8px; padding:9px 11px; }
  .val-margin-card{ border-radius:8px; padding:9px 11px; }
  .vm-label{ font-size:9px; color:rgba(255,255,255,0.32); text-transform:uppercase;
             letter-spacing:0.6px; margin-bottom:3px; }
  .vm-val  { font-size:15px; font-weight:700; color:#e0e0e0; }
  .vm-weight{ font-size:9px; color:rgba(255,255,255,0.28); margin-top:2px; }
  .vm-formula{ font-size:8.5px; color:rgba(255,255,255,0.22); margin-top:2px; line-height:1.4; }`;

  list.forEach((e, i) => {
    const expVf      = e.valFundamentals;
    const expAiTotal   = expVf?.aiTotal   ?? null;
    const expAiVerdict = expVf?.aiVerdict ?? null;
    const expAiFund    = expVf?.aiFundScore ?? null;
    const expAiTech    = expVf?.aiTechScore ?? null;
    const expAiConf    = expVf?.aiConfidence ?? null;
    const expAiColor   = expAiVerdict === 'BUY' ? '#66bb6a' : expAiVerdict === 'HOLD' ? '#ffee58' : expAiVerdict === 'AVOID' ? '#ef5350' : null;
    const expAiBadge   = expAiTotal != null ? `
      <div style="display:inline-flex;align-items:center;gap:12px;padding:8px 16px;margin-top:10px;
                  background:${expAiColor}0f;border:1px solid ${expAiColor}33;border-radius:10px;">
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:800;color:${expAiColor};line-height:1">${expAiTotal}</div>
          <div style="font-size:9px;color:rgba(255,255,255,0.35)">/100</div>
        </div>
        <div>
          <div style="font-size:16px;font-weight:800;color:${expAiColor};letter-spacing:1px">${expAiVerdict}</div>
          ${expAiConf ? `<div style="font-size:10px;color:rgba(255,255,255,0.42);margin-top:1px">Conf. ${expAiConf}</div>` : ''}
          <div style="font-size:10px;color:rgba(255,255,255,0.32);margin-top:1px">Fund ${expAiFund}/100 · Tehnic ${expAiTech}/100</div>
        </div>
      </div>` : '';

    const card = `
    <div class="card">
      <div class="card-header">
        <div>
          <span class="ticker">${e.ticker}</span>
          <span class="name">${e.name}</span><br>
          <span class="price">${e.currency} ${e.price}</span>
          ${expAiBadge}
        </div>
        <div style="text-align:right;">
          <span class="date">${e.date}</span>
          ${e.time ? `<span class="time">${e.time}</span>` : ''}
        </div>
      </div>
      <div class="pills">${(e.pills || []).map(p => `<span class="pill">${p}</span>`).join('')}</div>
      ${e.comment ? `<div class="comment">${e.comment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}</div>` : ''}
      ${(() => {
        const vf = e.valFundamentals;
        if (!vf) return '';
        const fmtN = (v, d=2) => v != null ? v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
        const sym = e.currency === 'USD' ? '$' : e.currency + ' ';
        // Linie sumar (EPS / PE / FCF / Crestere / WACC / Active / Cash / Datorii)
        const summaryParts = [
          vf.eps    != null ? `EPS: <b>${sym}${fmtN(vf.eps)}</b>`         : '',
          vf.pe     != null ? `P/E: <b>${fmtN(vf.pe,1)}x</b>`            : '',
          vf.fcf    != null ? `FCF/acț: <b>${sym}${fmtN(vf.fcf)}</b>`    : '',
          vf.growth != null ? `Creștere: <b>${fmtN(vf.growth,1)}%</b>`   : '',
          vf.wacc   != null ? `WACC: <b>${fmtN(vf.wacc,1)}%</b>`         : '',
          vf.tgr      != null ? `Rată term.: <b>${fmtN(vf.tgr,1)}%</b>`          : '',
          vf.assets   != null ? `Active: <b>${fmtN(vf.assets,0)}M</b>`             : '',
          vf.cash     != null ? `Cash: <b>${fmtN(vf.cash,0)}M</b>`                 : '',
          vf.debt     != null ? `Datorii: <b>${fmtN(vf.debt,0)}M</b>`              : '',
          vf.dividend != null ? `Dividend: <b>${sym}${fmtN(vf.dividend,2)}/acț</b>` : '',
          vf.occupancy!= null ? `Ocupare: <b>${fmtN(vf.occupancy,1)}%</b>`         : '',
          vf.ltv      != null ? `LTV: <b>${fmtN(vf.ltv,1)}%</b>`                   : '',
        ].filter(Boolean);
        const wv = vf.weightedValue;
        const ms = vf.marginOfSafety;
        const msColor = ms == null ? '#888' : ms > 20 ? '#66bb6a' : ms > 0 ? '#ffee58' : '#ef5350';
        if (!summaryParts.length && !vf.resultsHTML && wv == null) return '';
        return `<div style="margin:10px 0;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:8px;font-size:11px;">
          <div style="font-size:9.5px;font-weight:700;color:rgba(255,255,255,0.3);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">⚖️ Valuare Fundamentală</div>
          ${(wv != null || ms != null) ? `<div style="display:flex;gap:16px;margin-bottom:8px;padding:6px 8px;background:rgba(206,147,216,0.06);border-radius:6px;border:1px solid rgba(206,147,216,0.15);">
            ${wv != null ? `<span>Val. țintă: <b style="color:#ce93d8">${sym}${fmtN(wv,2)}</b></span>` : ''}
            ${ms != null ? `<span>Marjă: <b style="color:${msColor}">${ms>=0?'+':''}${fmtN(ms,1)}%</b></span>` : ''}
          </div>` : ''}
          ${summaryParts.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px 16px;color:rgba(255,255,255,0.42);margin-bottom:${vf.resultsHTML ? '10px' : '0'}">
            ${summaryParts.map(p => `<span>${p}</span>`).join('')}
          </div>` : ''}
          ${vf.resultsHTML ? `<div class="val-results-grid">${vf.resultsHTML}</div>` : ''}
        </div>`;
      })()}
      ${e.charts ? `
        <div class="charts-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
          ${[30, 90, 180, 360].filter(d => e.charts[d]).map(days => {
            const s = e.periodStats?.[days];
            const cp = e.currentPrice ?? parseFloat(e.price) ?? 0;
            const sym = e.currency === 'USD' ? '$' : e.currency + ' ';
            const fN = (v,d=2) => v!=null?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
            const delta = v => (cp>0&&v!=null)?` (${v>=cp?'+':''}${(((v-cp)/cp)*100).toFixed(1)}%)`:'';
            return `<div class="chart-period" style="background:rgba(0,0,0,0.2);border-radius:8px;padding:10px;">
              <div class="period-label">${days} ZILE</div>
              <div class="chart-row" style="margin-bottom:8px;">
                <img src="${e.charts[days].traj}" alt="Traj ${days}z">
                <img src="${e.charts[days].hist}" alt="Hist ${days}z">
              </div>
              ${s ? `<table style="width:100%;font-size:10px;border-collapse:collapse;">
                <tr><td style="color:rgba(255,255,255,0.4)">Preț curent</td><td style="text-align:right;font-weight:700">${sym}${fN(cp)}</td></tr>
                <tr><td style="color:rgba(255,255,255,0.4)">Medie</td><td style="text-align:right;color:#ffee58;font-weight:700">${sym}${fN(s.mean)}${delta(s.mean)}</td></tr>
                <tr><td style="color:rgba(255,255,255,0.4)">P90 optimist</td><td style="text-align:right;color:#66bb6a;font-weight:700">${sym}${fN(s.p90)}${delta(s.p90)}</td></tr>
                <tr><td style="color:rgba(255,255,255,0.4)">P10 pesimist</td><td style="text-align:right;color:#ef5350;font-weight:700">${sym}${fN(s.p10)}${delta(s.p10)}</td></tr>
                <tr><td style="color:rgba(255,255,255,0.4)">Prob. profit</td><td style="text-align:right;color:#66bb6a;font-weight:700">${s.probProfit?.toFixed(1)}%</td></tr>
              </table>` : ''}
            </div>`;
          }).join('')}
        </div>
      ` : ''}
    </div>`;

    const entryJson = JSON.stringify(e).replace(/<\/script>/gi, '<\\/script>');
    const html = `<!DOCTYPE html>
<html lang="ro"><head><meta charset="UTF-8">
<title>${e.ticker} — urmărit · MC.Stocks</title>
<style>${CSS}</style></head><body>
<script id="mc-data" type="application/json">${entryJson}<\/script>
<h1>📌 ${e.ticker}</h1>
<div class="meta">${e.name} · Salvat ${e.date}${e.time ? ' ' + e.time : ''} · MC.Stocks</div>
${card}
</body></html>`;

    setTimeout(() => {
      const blob = new Blob([html], { type: 'text/html' });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = `${e.ticker}-urmarit.html`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, i * 300);
  });
}

// ── Import watchlist din fisiere HTML ─────────────────

function parseWatchlistFromHTML(html, filename) {
  const jsonMatch = html.match(/<script[^>]+id="mc-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonMatch) {
    try {
      const entry = JSON.parse(jsonMatch[1].trim());
      if (entry && entry.ticker) return entry;
    } catch (_) {}
  }

  const getText = pat => { const m = html.match(pat); return m ? m[1].trim() : null; };

  const ticker =
    getText(/<h1[^>]*>.*?📌\s*([A-Z0-9.\-]+)/i) ||
    getText(/<span class="ticker">([^<]+)<\/span>/i) ||
    filename.replace(/-urmarit\.html$/i, '').replace(/\.html$/i, '').toUpperCase();
  if (!ticker) return null;

  const name      = getText(/<span class="name">([^<]+)<\/span>/i) || ticker;
  const priceRaw  = getText(/<span class="price">([^<]+)<\/span>/i) || '';
  const priceParts = priceRaw.trim().split(/\s+/);
  const currency  = priceParts.length >= 2 ? priceParts[0] : 'USD';
  const price     = priceParts.length >= 2 ? priceParts.slice(1).join(' ') : priceRaw;
  const dateRaw   = getText(/<span class="date">([^<]+)<\/span>/i) || '';
  const timeRaw   = getText(/<span class="time">([^<]+)<\/span>/i) ||
                    getText(/<span[^>]*class="time"[^>]*>([^<]+)<\/span>/i) || '';
  const dateSplit = dateRaw.split('·').map(s => s.trim());
  const date = dateSplit[0] || '';
  const time = timeRaw || dateSplit[1] || '';

  const pills = [];
  const pillRe = /<span class="pill">([^<]+)<\/span>/gi;
  let pm;
  while ((pm = pillRe.exec(html)) !== null) pills.push(pm[1].trim());

  const commentMatch = html.match(/<div class="comment">([\s\S]*?)<\/div>/i);
  const comment = commentMatch
    ? commentMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';

  const charts = {};
  const imgRe  = /<img[^>]+src="(data:image\/[^"]+)"[^>]+alt="(Traj|Hist) (\d+)z"/gi;
  let im;
  while ((im = imgRe.exec(html)) !== null) {
    const [, src, type, dStr] = im;
    const d = parseInt(dStr);
    if (!charts[d]) charts[d] = {};
    charts[d][type.toLowerCase()] = src;
  }
  const imgRe2 = /<img[^>]+alt="(Traj|Hist) (\d+)z"[^>]+src="(data:image\/[^"]+)"/gi;
  while ((im = imgRe2.exec(html)) !== null) {
    const [, type, dStr, src] = im;
    const d = parseInt(dStr);
    if (!charts[d]) charts[d] = {};
    if (!charts[d][type.toLowerCase()]) charts[d][type.toLowerCase()] = src;
  }

  return { ticker, name, price, currency, date, time, pills, comment, charts };
}

export function importWatchlistFiles(files) {
  if (!files || !files.length) return;
  let done = 0, imported = 0;

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const entry = parseWatchlistFromHTML(ev.target.result, file.name);
        if (entry && entry.ticker) {
          saveToWatchlist(entry);
          imported++;
        } else {
          console.warn('Nu s-au putut extrage date din:', file.name);
        }
      } catch (err) {
        console.error('Import error:', file.name, err);
      }
      done++;
      if (done === files.length) {
        renderWatchlist();
        if (imported > 0) showSection('watchlist-section');
      }
    };
    reader.readAsText(file);
  });
}
