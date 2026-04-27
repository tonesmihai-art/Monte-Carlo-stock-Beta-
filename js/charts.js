// ─────────────────────────────────────────────────────
//  GRAFICE — Chart.js wrapper
// ─────────────────────────────────────────────────────

let trajChart    = null;
let histChart    = null;
let sentChart    = null;
let priceChart   = null;

const COLORS = {
  green:     '#66bb6a',
  red:       '#ef5350',
  yellow:    '#ffee58',
  blue:      '#4fc3f7',
  orange:    '#ffa726',
  white:     '#ffffff',
  gray:      '#555577',
  panel:     '#1a1a2e',
  greenAI:   '#fff9c4',
  blueAI:    '#b3e5fc',
};

// Distruge TOATE graficele (folosit la inceput de simulare noua)
function destroyAll() {
  // priceChart NU se distruge — graficul istoric ramine persistent intre tab-uri
  [trajChart, histChart, sentChart].forEach(c => c?.destroy());
  trajChart = histChart = sentChart = null;
}

// Distruge DOAR graficele de perioade (traj + hist) — folosit la schimbarea tab-urilor
// Lasa sentimentul intact!
function destroyPeriodCharts() {
  [trajChart, histChart].forEach(c => c?.destroy());
  trajChart = histChart = null;
}

// ── Grafic pret istoric ───────────────────────────────
export function drawPriceHistory(canvasId, dates, prices, ticker) {
  priceChart?.destroy();
  const ctx = document.getElementById(canvasId).getContext('2d');
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: `${ticker} — pret inchidere`,
        data: prices,
        borderColor: COLORS.blue,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        backgroundColor: 'rgba(79,195,247,0.08)',
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: COLORS.white, font: { size: 11 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          ticks: { color: COLORS.gray, maxTicksLimit: 8, font: { size: 10 } },
          grid:  { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          ticks: {
            color: COLORS.gray,
            callback: v => `$${v.toFixed(2)}`,
            font: { size: 10 },
          },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
      },
    },
  });
}

// ── Grafic traiectorii (percentile) ──────────────────
export function drawTrajectories(canvasId, percs, percAdj, days, currentPrice, ticker, ouPercs) {
  trajChart?.destroy();
  const labels = Array.from({ length: days + 1 }, (_, i) => i);
  const ctx    = document.getElementById(canvasId).getContext('2d');

  const datasets = [
    {
      label: 'P90 clasic (optimist)',
      data:  Array.from(percs[90]),
      borderColor: COLORS.green,
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    },
    {
      label: 'P50 clasic (median)',
      data:  Array.from(percs[50]),
      borderColor: COLORS.yellow,
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    },
    {
      label: 'P10 clasic (pesimist)',
      data:  Array.from(percs[10]),
      borderColor: COLORS.red,
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    },
  ];

  if (percAdj) {
    datasets.push({
      label: 'P50 AI ajustat',
      data:  Array.from(percAdj[50]),
      borderColor: COLORS.orange,
      borderWidth: 2,
      borderDash: [6, 3],
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    });
  }

  if (ouPercs) {
    datasets.push({
      label:       'P50 OU+Heston',
      data:        Array.from(ouPercs[50]),
      borderColor: 'rgba(206,147,216,0.85)',
      borderWidth: 2,
      borderDash:  [6, 3],
      pointRadius: 0,
      fill:        false,
      tension:     0.3,
    });
  }

  datasets.push({
    label: `Pret curent $${currentPrice.toFixed(2)}`,
    data:  Array(days + 1).fill(currentPrice),
    borderColor: 'rgba(255,255,255,0.4)',
    borderWidth: 1,
    borderDash: [4, 4],
    pointRadius: 0,
    fill: false,
  });

  trajChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { labels: { color: COLORS.white, font: { size: 10 }, boxWidth: 16 } },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: { label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}` },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Zile lucratoare', color: COLORS.gray },
          ticks: { color: COLORS.gray, maxTicksLimit: 10, font: { size: 10 } },
          grid:  { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          ticks: { color: COLORS.gray, callback: v => `$${v.toFixed(0)}`, font: { size: 10 } },
          grid:  { color: 'rgba(255,255,255,0.04)' },
        },
      },
    },
  });
}

// ── Histograma distributie finala ─────────────────────
export function drawHistogram(canvasId, stats, statsAdj, currentPrice, days, ouStats) {
  histChart?.destroy();
  const ctx = document.getElementById(canvasId).getContext('2d');

  // Construim bins manual — range unificat GBM + OU
  const allFinals = Array.from(stats.finals);
  const minVal    = Math.min(stats.min, ouStats?.min ?? stats.min) * 0.95;
  const maxVal    = Math.max(stats.max, ouStats?.max ?? stats.max) * 1.05;
  const nBins     = 60;
  const binSize   = (maxVal - minVal) / nBins;

  const bins      = Array(nBins).fill(0);
  const binsAdj   = Array(nBins).fill(0);
  const binsOU    = Array(nBins).fill(0);
  const labels    = [];

  for (let i = 0; i < nBins; i++) {
    labels.push((minVal + i * binSize).toFixed(0));
  }

  allFinals.forEach(v => {
    const b = Math.min(Math.floor((v - minVal) / binSize), nBins - 1);
    if (b >= 0) bins[b]++;
  });

  if (statsAdj) {
    Array.from(statsAdj.finals).forEach(v => {
      const b = Math.min(Math.floor((v - minVal) / binSize), nBins - 1);
      if (b >= 0) binsAdj[b]++;
    });
  }

  if (ouStats) {
    // Normalizam OU la aceeasi scara ca GBM (diferenta de NUM_SIMS)
    const gbmTotal = allFinals.length;
    const ouTotal  = ouStats.finals.length;
    const scale    = gbmTotal / ouTotal;
    Array.from(ouStats.finals).forEach(v => {
      const b = Math.min(Math.floor((v - minVal) / binSize), nBins - 1);
      if (b >= 0) binsOU[b] += scale;
    });
  }

  // Culori per bin: verde=profit, rosu=pierdere
  const bgColors    = labels.map(l => parseFloat(l) >= currentPrice ? COLORS.green   : COLORS.red);
  const bgColorsAdj = labels.map(l => parseFloat(l) >= currentPrice ? COLORS.greenAI : COLORS.blueAI);

  const datasets = [{
    label:           'GBM+GARCH',
    data:            bins,
    backgroundColor: bgColors,
    borderWidth:     0,
    order: 2,
  }];

  if (statsAdj) {
    datasets.push({
      label:           'AI ajustat',
      data:            binsAdj,
      backgroundColor: bgColorsAdj,
      borderWidth:     0,
      order: 3,
    });
  }

  if (ouStats) {
    datasets.push({
      label:       'OU+Heston',
      data:        binsOU,
      type:        'line',
      borderColor: 'rgba(206,147,216,0.85)',
      borderWidth: 2,
      borderDash:  [5, 3],
      pointRadius: 0,
      fill:        false,
      tension:     0.4,
      order: 1,
    });
  }

  histChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { labels: { color: COLORS.white, font: { size: 10 }, boxWidth: 14 } },
        tooltip: {
          callbacks: {
            title: ctx  => `Pret: ~$${parseFloat(ctx[0].label).toFixed(2)}`,
            label: ctx  => `${ctx.dataset.label}: ${ctx.parsed.y} simulari`,
          }
        },
        annotation: {},
      },
      scales: {
        x: {
          ticks: { color: COLORS.gray, maxTicksLimit: 8, font: { size: 9 } },
          grid:  { display: false },
          stacked: false,
        },
        y: {
          ticks: { color: COLORS.gray, font: { size: 9 } },
          grid:  { color: 'rgba(255,255,255,0.04)' },
        },
      },
    },
  });
}

// ── Grafic sentiment (bar orizontal) ─────────────────
export function drawSentiment(canvasId, sentimentData) {
  sentChart?.destroy();
  if (!sentimentData) return;

  const factors = sentimentData.factori;
  const labels  = Object.values(factors).map(f => f.label.replace(/\p{Emoji}/gu, '').trim());
  const scores  = Object.values(factors).map(f => f.scor);
  const colors  = scores.map(s => s > 0.1 ? COLORS.green : s < -0.1 ? COLORS.red : COLORS.yellow);

  const ctx = document.getElementById(canvasId).getContext('2d');
  sentChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label:           'Scor sentiment',
        data:            scores,
        backgroundColor: colors,
        borderWidth:     0,
        borderRadius:    4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const s = ctx.parsed.x;
              const impact = s > 0.1 ? 'BULLISH' : s < -0.1 ? 'BEARISH' : 'NEUTRU';
              return `${s >= 0 ? '+' : ''}${s.toFixed(3)} — ${impact}`;
            }
          }
        },
      },
      scales: {
        x: {
          min:   -1,
          max:   1,
          ticks: { color: COLORS.gray, font: { size: 10 } },
          grid:  { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          ticks: { color: COLORS.white, font: { size: 10 } },
          grid:  { display: false },
        },
      },
    },
  });
}

export { destroyAll, destroyPeriodCharts };
