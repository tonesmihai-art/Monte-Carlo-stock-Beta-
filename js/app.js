// ─────────────────────────────────────────────────────
//  APP.JS — Orchestrare principala (slim)
//  Responsabil doar de: init, runSimulation, event listeners
// ─────────────────────────────────────────────────────

import { calcParams, simulate, calcStats, percentilesPerDay,
         adjustParams, NUM_SIMS, estimateGARCH, estimateNu } from './montecarlo.js';
import { analyzeSentiment, fetchSectorData, fetchVIX }        from './sentiment.js';
import { drawPriceHistory, drawSentiment, destroyAll, destroyPeriodCharts } from './charts.js';
import { fetchStockData, fetchImpliedVolatility, blendSigma }  from './api.js';
import { $, fmt, setStatus, showSection,
         setPillColor, renderSectorBadge, renderPeriod }       from './ui.js';
import { loadIstoric, saveIstoric, loadWatchlist,
         saveToWatchlist, WATCHLIST_KEY }                      from './storage.js';
import { initValuarePanel, generateQualityComment,
         YAHOO_TO_VAL_SECTOR, getLastAIScore, getLastValResult } from './valuation.js';
import { captureChartsForWatchlist, renderWatchlist,
         exportWatchlistHTML, importWatchlistFiles }           from './watchlist.js';

// ── Service Worker ────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Mapping cheie internă → nume afișat în badge ─────
const VAL_SECTOR_DISPLAY = {
  tech:         'Technology',
  energy:       'Energy',
  utilitati:    'Utilities',
  healthcare:   'Healthcare',
  banci:        'Financial Services',
  asigurari:    'Insurance',
  materiale:    'Basic Materials',
  auto:         'Auto / Industrials',
  conglomerate: 'Industrials',
  consum:       'Consumer',
  reit:         'Real Estate',
  shipping:     'Shipping / Transport',
  tutun:        'Consumer Defensive',
};

// ── State global ─────────────────────────────────────
let currentResult      = null;
let _lastVixData       = null;
let _lastSectorWeights = null;

// ── Istoric simulari ──────────────────────────────────

function renderIstoric() {
  const istoric   = loadIstoric();
  const container = $('history-container');
  const list      = $('history-list');
  if (!container || !list) return;
  if (istoric.length === 0) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  list.innerHTML = '';
  istoric.forEach(item => {
    const btn          = document.createElement('button');
    btn.className      = 'example-chip';
    btn.title          = `Simulat la: ${item.timestamp}`;
    btn.textContent    = `${item.ticker} (${item.pret})`;
    btn.dataset.ticker = item.ticker;
    btn.addEventListener('click', () => {
      $('ticker-input').value = item.ticker;
      runSimulation();
    });
    list.appendChild(btn);
  });
}

// ── Simulare principala ───────────────────────────────
async function runSimulation() {
  const ticker      = $('ticker-input').value.trim().toUpperCase();
  const doSentiment = $('toggle-sentiment').checked;
  if (!ticker) { setStatus('Introdu un ticker.', 'error'); return; }

  destroyAll();
  $('results-section').style.display   = 'none';
  $('sentiment-section').style.display = 'none';
  const sectorBadgeEl = $('sector-badge');
  if (sectorBadgeEl) sectorBadgeEl.style.display = 'none';
  const valPanel = $('valuation-panel');
  if (valPanel) {
    valPanel.style.display = 'none';
    ['eps','fcf','shares','assets','cash','debt'].forEach(id => {
      const el = $(`val-${id}`);
      if (el) el.value = '';
    });
    const statusEl = $('val-fetch-status');
    if (statusEl) statusEl.textContent = '';
    const commentEl = $('val-fundamental-comment');
    if (commentEl) { commentEl.innerHTML = ''; commentEl.style.display = 'none'; }
  }
  $('run-btn').disabled    = true;
  $('run-btn').textContent = 'Se ruleaza...';

  try {
    // ── 1. Date istorice ─────────────────────────────
    setStatus(`Descarc date pentru ${ticker}...`);
    const stock = await fetchStockData(ticker);
    const { closes, dates, volumes, currentPrice, currency, name, fundamentals } = stock;
    $('stock-name').textContent   = name;
    $('stock-price').textContent  = `${currency} ${fmt(currentPrice)}`;
    $('stock-ticker').textContent = ticker;
    drawPriceHistory('price-chart', dates.slice(-60), closes.slice(-60), ticker);

    // ── 2. Parametri GBM + GARCH(1,1) ───────────────
    setStatus('Calculez parametri GBM + GARCH(1,1)...');
    const { drift, sigma, mean50, deviationPct, volumeTrend, garch, nu } = calcParams(closes, volumes);

    const sigmaStaticPct = (sigma * 100).toFixed(3);
    const volAnualPct    = sigma * Math.sqrt(252) * 100;

    // ── Pills individuale cu culori dinamice ──────────
    setPillColor('pill-sigma', sigma < 0.01 ? 'green' : sigma < 0.02 ? 'yellow' : 'red');
    $('info-sigma').textContent = `${sigmaStaticPct}%/zi`;

    if (garch) {
      const sigmaGarchPct = (garch.sigma0 * 100).toFixed(3);
      const garchRegime   = garch.sigma0 > garch.sigmaLR * 1.15 ? 'red'
                          : garch.sigma0 < garch.sigmaLR * 0.85 ? 'green' : 'yellow';
      setPillColor('pill-garch', garchRegime);
      $('info-garch').textContent = `${sigmaGarchPct}%/zi ${{ red:'🔴', green:'🟢', yellow:'🟡' }[garchRegime]}`;
      const persColor = garch.persistence < 0.85 ? 'green' : garch.persistence < 0.95 ? 'yellow' : 'red';
      setPillColor('pill-pers', persColor);
      $('info-pers').textContent = `${(garch.persistence * 100).toFixed(1)}%`;
    } else {
      setPillColor('pill-garch', 'gray'); $('info-garch').textContent = 'N/A';
      setPillColor('pill-pers',  'gray'); $('info-pers').textContent  = 'N/A';
    }

    const nuColor = nu < 5 ? 'red' : nu < 8 ? 'orange' : nu < 20 ? 'yellow' : 'green';
    const nuLabel = nu >= 29 ? `ν=${nu} normal`
                  : nu >= 10 ? `ν=${nu} medii`
                  : nu >= 5  ? `ν=${nu} groase`
                  :            `ν=${nu} f.groase`;
    setPillColor('pill-nu', nuColor);
    $('info-nu').textContent = nuLabel;

    setPillColor('pill-vol', volAnualPct < 20 ? 'green' : volAnualPct < 40 ? 'yellow' : 'red');
    $('info-vol').textContent = `${volAnualPct.toFixed(1)}%/an`;

    setPillColor('pill-drift', drift > 0.0001 ? 'green' : drift < -0.0001 ? 'red' : 'gray');
    $('info-drift').textContent = `${drift >= 0 ? '+' : ''}${(drift * 100).toFixed(4)}%/zi`;

    const absDev = Math.abs(deviationPct);
    setPillColor('pill-ma60', absDev < 5 ? 'green' : absDev < 15 ? 'yellow' : 'red');
    $('info-ma50').textContent = `${mean50 != null ? mean50.toFixed(2) : '—'} (${deviationPct >= 0 ? '+' : ''}${deviationPct.toFixed(1)}%)`;

    const vtDetail = volumeTrend?.detail ?? '';
    setPillColor('pill-voltren',
      vtDetail === 'bullish' ? 'green' : vtDetail === 'bearish' ? 'red' :
      vtDetail.includes('bullish') ? 'yellow' : vtDetail.includes('bearish') ? 'orange' : 'gray');
    $('info-voltren').textContent = volumeTrend?.label ?? '—';

    // ── 2b. IV + Sector + VIX in paralel ────────────
    setStatus('Caut IV, sector si VIX in paralel...');
    let ivData        = null;
    let sectorWeights = null;
    let vixData       = { vix: null, vixLabel: 'N/A', vixImpact: 0 };
    {
      const [ivResult, sectorResult, vixResult] = await Promise.allSettled([
        fetchImpliedVolatility(ticker, currentPrice, msg => setStatus(msg)),
        fetchSectorData(ticker),
        fetchVIX(),
      ]);
      if (ivResult.status === 'fulfilled')     ivData        = ivResult.value;
      if (sectorResult.status === 'fulfilled') sectorWeights = sectorResult.value.weights;
      if (vixResult.status === 'fulfilled')    vixData       = vixResult.value;
      _lastVixData = vixData;
      if (sectorResult.status === 'fulfilled') {
        _lastSectorWeights = sectorResult.value.weights;
        initValuarePanel(currentPrice, currency, sectorResult.value.sector, ticker, fundamentals,
                         { deviationPct, drift, sigma, mean50 });
        const valKey = $('val-sector')?.value || 'tech';
        renderSectorBadge(VAL_SECTOR_DISPLAY[valKey] || valKey,
                          sectorResult.value.industry, vixData, sectorResult.value.weights);
      } else {
        initValuarePanel(currentPrice, currency, null, ticker, fundamentals,
                         { deviationPct, drift, sigma, mean50 });
      }
    }

    // ── Fallback: IV estimat din VIX ─────────────────
    let ivEstimated = false;
    if (!ivData) {
      setStatus('IV: calculez estimat din VIX + caracteristici actiune...');
      try {
        const vixVal = vixData?.vix
          ?? (await Promise.race([fetchVIX(), new Promise(r => setTimeout(() => r(null), 4000))]))?.vix;
        if (vixVal && vixVal > 0) {
          const sigmaAnnual   = sigma * Math.sqrt(252);
          const vixDaily      = (vixVal / 100) / Math.sqrt(252);
          const sigmaVsMarket = sigma / Math.max(vixDaily, 0.0001);
          const ivPremium     = sigmaVsMarket < 0.8  ? 1.05 : sigmaVsMarket < 1.2 ? 1.10
                              : sigmaVsMarket < 1.8  ? 1.15 : sigmaVsMarket < 2.5 ? 1.22 : 1.32;
          const garchPersAdj  = garch
            ? Math.max(0.85, Math.min(1.20, 1 + (garch.persistence - 0.85) * 0.6)) : 1.0;
          const tailAdj       = nu < 5 ? 1.18 : nu < 8 ? 1.09 : nu < 15 ? 1.04 : 1.0;
          const ivEstAnnual   = sigmaAnnual * (vixVal / 20) * ivPremium * garchPersAdj * tailAdj;
          const ivEstDaily    = ivEstAnnual / Math.sqrt(252);
          const baseSkew      = Math.max(0, (vixVal - 15) * 0.006);
          const skewAdj       = Math.min(2.0, Math.max(0.4, sigmaVsMarket * 0.75));
          ivData = {
            ivAnnual: ivEstAnnual, ivDaily: ivEstDaily,
            atmStrike: null, daysToExp: 30,
            skewData: { skew: baseSkew * skewAdj, putIV: null, callIV: null,
                        putStrike: null, callStrike: null },
          };
          ivEstimated = true;
        }
      } catch (_) {}
    }

    if (ivData) {
      const ivAnnPct = (ivData.ivAnnual * 100).toFixed(1);
      const ivRatio  = ivData.ivDaily / sigma;
      setPillColor('pill-iv', ivRatio < 0.85 ? 'green' : ivRatio < 1.20 ? 'yellow' : 'red');
      $('info-iv').textContent = ivEstimated
        ? `~${ivAnnPct}%/an est.`
        : `${ivAnnPct}%/an · ${ivData.daysToExp}z`;
    } else {
      setPillColor('pill-iv', 'gray');
      $('info-iv').textContent = 'N/A';
    }

    // ── Put/Call Skew → ajustare drift ───────────────
    let skewDriftAdj = 0;
    if (ivData?.skewData) {
      const { skew }       = ivData.skewData;
      const NEUTRAL_SKEW   = 0.07;
      const sigmaAnnual    = sigma * Math.sqrt(252);
      const normalizedSkew = (skew - NEUTRAL_SKEW) / Math.max(sigmaAnnual, 0.15);
      skewDriftAdj = -Math.tanh(normalizedSkew * 1.5) * 0.00025;

      const skewPct   = (skew * 100).toFixed(1);
      const skewColor = skew < 0 ? 'green' : skew < 0.08 ? 'yellow' : skew < 0.15 ? 'orange' : 'red';
      setPillColor('pill-skew', skewColor);
      $('info-skew').textContent = ivEstimated
        ? `~${skew >= 0 ? '+' : ''}${skewPct}% est.`
        : `${skew >= 0 ? '+' : ''}${skewPct}%`;
    } else {
      setPillColor('pill-skew', 'gray');
      $('info-skew').textContent = 'N/A';
    }

    // ── Comentariu calitativ ─────────────────────────
    const qComment = generateQualityComment({
      sigma, volAnualPct, nu, garch, drift, deviationPct, volumeTrend, ivData, ivEstimated,
    });
    const qEl = $('quality-comment');
    if (qEl) { qEl.innerHTML = qComment; qEl.style.display = 'block'; }

    let sigmaAdjRatio = null;

    // ── 4. Sentiment AI ──────────────────────────────
    let sentimentData = null;
    let driftAdj = null, sigmaAdj = null, meanRevStrength = 0;

    if (doSentiment) {
      setStatus('Analizez sentiment (Yahoo + Reuters + Google News)...');
      try {
        sentimentData = await analyzeSentiment(ticker, name, msg => setStatus(msg));
        if (sentimentData.sectorWeights) sectorWeights = sentimentData.sectorWeights;
        if (sentimentData.vix?.vix)      vixData       = sentimentData.vix;

        const scores = Object.values(sentimentData.factori).map(f => f.scor);
        const adj    = adjustParams(drift, sigma, scores, sectorWeights,
                                    vixData.vixImpact, deviationPct, volumeTrend?.score ?? 0);
        driftAdj        = adj.driftAdj;
        sigmaAdj        = adj.sigmaAdj;
        meanRevStrength = adj.meanRevStrength ?? 0;
        if (sigmaAdj != null && sigma > 0) sigmaAdjRatio = sigmaAdj / sigma;

        $('sent-global').textContent = `${sentimentData.sentimentGlobal >= 0 ? '+' : ''}${sentimentData.sentimentGlobal.toFixed(3)}`;
        $('sent-global').style.color = sentimentData.sentimentGlobal > 0.1 ? '#66bb6a'
                                     : sentimentData.sentimentGlobal < -0.1 ? '#ef5350' : '#ffee58';
        $('sent-conclusion').textContent = sentimentData.concluzie;
        {
          const s  = sentimentData.surse;
          const ts = sentimentData.tierStats;
          const brut = s.yahoo + s.reuters + s.google + s.seekingAlpha + s.euronews;
          $('sent-sources').textContent =
            `Yahoo: ${s.yahoo} | AP/CNBC: ${s.reuters} | Google: ${s.google} | SA: ${s.seekingAlpha} | EN: ${s.euronews}` +
            `  ·  ${brut} brut → ${sentimentData.totalBrut} unice` +
            `  ·  Filtrat: T1:${ts.t1} T2:${ts.t2} T3:${ts.t3} zgomot:${ts.t4}` +
            `  →  ${sentimentData.totalStiri} stiri folosite in calcul`;
        }

        drawSentiment('sentiment-chart', sentimentData);
        $('sentiment-section').style.display = 'block';

        const detailsHtml = Object.entries(sentimentData.factori).map(([key, f]) => `
          <div class="factor-card ${f.impact}">
            <div class="factor-header">
              <span class="factor-label">${f.label}</span>
              <span class="factor-score">${f.scor >= 0 ? '+' : ''}${f.scor.toFixed(3)}</span>
              <span class="factor-impact impact-${f.impact}">${f.impact.toUpperCase()}</span>
              <span style="font-size:10px;color:#888;margin-left:4px">pond. ${f.weight}x</span>
            </div>
            <div class="factor-count">${f.count} stiri analizate</div>
            ${f.stiri.slice(0, 3).map(s =>
              `<div class="factor-news" style="color:${s.score > 0.05 ? '#a5d6a7' : s.score < -0.05 ? '#ef9a9a' : '#888'}">
                 ${s.sursa}: ${s.titlu.slice(0, 90)}${s.titlu.length > 90 ? '...' : ''}
               </div>`
            ).join('')}
          </div>`).join('');
        $('factors-detail').innerHTML = detailsHtml;

      } catch (e) {
        console.warn('Sentiment error:', e);
        setStatus('Sentiment indisponibil — continuam fara.', 'warn');
      }
    }

    // ── 5. Monte Carlo ────────────────────────────────
    const PERIODS    = [30, 90, 180, 360];
    const PERC_STEP  = { 30: 1, 90: 2, 180: 3, 360: 5 };
    const periodResults = {};

    for (const days of PERIODS) {
      setStatus(`Simulez ${days} zile (${NUM_SIMS.toLocaleString()} scenarii)...`);
      await new Promise(r => setTimeout(r, 0));

      const sigmaBlended    = blendSigma(sigma, ivData?.ivDaily, days);
      const sigmaAdjBlended = sigmaAdjRatio != null ? sigmaBlended * sigmaAdjRatio : null;
      const driftSkewed     = drift    + skewDriftAdj;
      const driftAdjSkewed  = driftAdj != null ? driftAdj + skewDriftAdj : null;

      const step      = PERC_STEP[days];
      const matrix    = simulate(currentPrice, driftSkewed, sigmaBlended, days, null, null, meanRevStrength, mean50, garch, nu);
      const matrixAdj = driftAdjSkewed != null
        ? simulate(currentPrice, driftSkewed, sigmaBlended, days, driftAdjSkewed, sigmaAdjBlended, meanRevStrength, mean50, garch, nu)
        : null;

      periodResults[days] = {
        days,
        stats:    calcStats(matrix, days, currentPrice),
        statsAdj: matrixAdj ? calcStats(matrixAdj, days, currentPrice) : null,
        percs:    percentilesPerDay(matrix, days, [10, 50, 90], step),
        percsAdj: matrixAdj ? percentilesPerDay(matrixAdj, days, [10, 50, 90], step) : null,
        currentPrice, currency, ticker,
      };
    }

    currentResult = { stock, periodResults, sentimentData, drift, sigma, driftAdj, sigmaAdj, garch, nu };

    // ── 6. Salveaza istoric ───────────────────────────
    saveIstoric(ticker, `${currency} ${fmt(currentPrice)}`);
    renderIstoric();

    // ── Buton Adauga la urmarit ───────────────────────
    const saveBtn = $('save-watchlist-btn');
    if (saveBtn) {
      saveBtn.style.display = 'inline-block';
      saveBtn.textContent   = '📌 Adaugă la urmărit';
      saveBtn.onclick = async () => {
        saveBtn.textContent = '⏳ Se captează graficele...';
        saveBtn.disabled    = true;
        try {
          const charts = await captureChartsForWatchlist(periodResults, currentPrice, ticker);
          const pills  = [];
          [['pill-sigma','info-sigma'],['pill-iv','info-iv'],['pill-skew','info-skew'],
           ['pill-garch','info-garch'],['pill-nu','info-nu'],['pill-vol','info-vol'],
           ['pill-pers','info-pers'],['pill-drift','info-drift'],
           ['pill-ma60','info-ma50'],['pill-voltren','info-voltren'],
          ].forEach(([pid, vid]) => {
            const label = document.querySelector(`#${pid} .tip-wrap`)?.childNodes[0]?.textContent?.trim() || pid;
            const val   = $(vid)?.textContent || '—';
            pills.push(`${label} ${val}`);
          });

          // ── Date fundamentale din panelul de valuare ──
          const getValNum = id => { const v = parseFloat($(`val-${id}`)?.value); return isNaN(v) ? null : v; };
          const valFundamentals = {
            sector:      $('val-sector')?.value || null,
            eps:         getValNum('eps'),
            pe:          getValNum('pe'),
            fcf:         getValNum('fcf'),
            growth:      getValNum('growth'),
            wacc:        getValNum('wacc'),
            tgr:         getValNum('tgr'),
            assets:      getValNum('assets'),
            cash:        getValNum('cash'),
            debt:        getValNum('debt'),
            shares:      getValNum('shares'),
            dividend:    getValNum('dividend'),
            ltv:         getValNum('ltv'),
            occupancy:   getValNum('occupancy'),
            // ── Rezultat calculat (val. ponderată + marjă) ──
            ...(() => { const vr = getLastValResult(); return vr ? {
              weightedValue:  vr.weightedValue,
              marginOfSafety: vr.marginOfSafety,
            } : {}; })(),
            resultsHTML:        $('val-results-grid')?.innerHTML          || '',
            fundamentalComment: $('val-fundamental-comment')?.innerHTML  || '',
            // ── Scor AI ──────────────────────────────────
            ...(() => { const ai = getLastAIScore(); return ai ? {
              aiTotal: ai.total, aiVerdict: ai.verdict,
              aiFundScore: ai.fundScore, aiTechScore: ai.techScore,
              aiConfidence: ai.confidence,
            } : {}; })(),
          };

          // ── Statistici Monte Carlo per perioada ───────
          const periodStats = {};
          for (const d of [30, 90, 180, 360]) {
            const pd = periodResults[d];
            if (!pd?.stats) continue;
            const s = pd.stats, sa = pd.statsAdj;
            periodStats[d] = {
              mean:       s.mean,    median:     s.median,
              p90:        s.p90,     p10:        s.p10,
              max:        s.max,     min:        s.min,
              probProfit: s.probProfit,
              probGain10: s.probGain10,
              probLoss10: s.probLoss10,
              adjMean: sa?.mean ?? null,
              adjP90:  sa?.p90  ?? null,
              adjP10:  sa?.p10  ?? null,
            };
          }

          const now = new Date();
          saveToWatchlist({
            ticker, name: name || ticker,
            price: fmt(currentPrice), currentPrice,
            currency,
            date:    now.toLocaleDateString('ro-RO',  { day:'2-digit', month:'short', year:'numeric' }),
            time:    now.toLocaleTimeString('ro-RO',  { hour:'2-digit', minute:'2-digit' }),
            pills,
            comment:         $('quality-comment')?.innerHTML || '',
            charts,
            valFundamentals,
            periodStats,
          });
          renderWatchlist();
          saveBtn.textContent = '✓ Salvat!';
          setTimeout(() => { saveBtn.textContent = '📌 Adaugă la urmărit'; }, 2500);
        } catch (err) {
          console.error('Watchlist save error:', err);
          saveBtn.textContent = `⚠ ${err.message || 'Eroare'}`;
          setTimeout(() => { saveBtn.textContent = '📌 Adaugă la urmărit'; }, 3500);
        } finally {
          saveBtn.disabled = false;
        }
      };
    }

    // ── 7. Randare rezultate ──────────────────────────
    setStatus('');
    $('results-section').style.display = 'flex';
    const tabsEl = $('period-tabs');
    tabsEl.innerHTML = '';
    PERIODS.forEach((days, i) => {
      const btn       = document.createElement('button');
      btn.className   = `tab-btn ${i === 0 ? 'active' : ''}`;
      btn.textContent = `${days} zile`;
      btn.onclick     = () => {
        tabsEl.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        destroyPeriodCharts();
        renderPeriod(periodResults[days]);
      };
      tabsEl.appendChild(btn);
    });
    renderPeriod(periodResults[30]);
    showSection('sim-section');

  } catch (err) {
    setStatus(`Eroare: ${err.message}`, 'error');
    console.error(err);
  } finally {
    $('run-btn').disabled    = false;
    $('run-btn').textContent = 'Ruleaza simularea';
  }
}

// ── Event listeners ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderIstoric();
  renderWatchlist();
  $('run-btn').addEventListener('click', runSimulation);
  $('ticker-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') runSimulation();
  });
  $('export-watchlist-btn')?.addEventListener('click', exportWatchlistHTML);
  $('import-watchlist-btn')?.addEventListener('click', () => {
    $('import-watchlist-input')?.click();
  });
  $('import-watchlist-input')?.addEventListener('change', e => {
    importWatchlistFiles(e.target.files);
    e.target.value = '';
  });
  $('clear-watchlist-btn')?.addEventListener('click', () => {
    if (confirm('Ștergi toată lista de urmărit?')) {
      localStorage.removeItem(WATCHLIST_KEY);
      renderWatchlist();
    }
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });
  document.querySelectorAll('.example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('ticker-input').value = chip.dataset.ticker;
    });
  });

  // ── Sync badge la schimbarea manuala a sectorului ────
  $('val-sector')?.addEventListener('change', () => {
    const valKey = $('val-sector').value;
    renderSectorBadge(VAL_SECTOR_DISPLAY[valKey] || valKey,
                      null, _lastVixData, _lastSectorWeights);
  });
});
