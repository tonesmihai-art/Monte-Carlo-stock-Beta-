// ─────────────────────────────────────────────────────
//  API.JS — Fetch date: Yahoo Finance, Nasdaq IV, SEC EDGAR
// ─────────────────────────────────────────────────────

// ── Helper: extrage numar indiferent daca Yahoo da plain value sau {raw,fmt} ──
function _metaNum(v) {
  if (v == null) return null;
  if (typeof v === 'object') return (v.raw != null && isFinite(v.raw)) ? v.raw : null;
  return isFinite(v) ? v : null;
}

// ── Yahoo Finance via CORS proxy (cu fallback MY_PROXY) ──
export async function fetchStockData(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;

  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ...(MY_PROXY ? [`${MY_PROXY}/proxy?url=${encodeURIComponent(url)}`] : []),
  ];

  let data = null;
  let lastErr = null;
  for (const px of proxies) {
    try {
      const r = await fetch(px, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) { lastErr = new Error(`HTTP ${r.status}`); continue; }
      const json = await r.json();
      if (json?.chart?.result?.[0]) { data = json; break; }
    } catch (e) { lastErr = e; }
  }
  if (!data) throw lastErr ?? new Error('Date indisponibile pentru ' + ticker);

  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Ticker invalid sau date indisponibile');
  const closes     = result.indicators.quote[0].close.filter(Boolean);
  const volumes    = result.indicators.quote[0].volume || [];
  const timestamps = result.timestamp;
  const dates      = timestamps.map(ts =>
    new Date(ts * 1000).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })
  ).filter((_, i) => result.indicators.quote[0].close[i] != null);
  const meta = result.meta;

  const sharesRaw = meta.sharesOutstanding ?? null;
  const epsRaw    = meta.epsTrailingTwelveMonths ?? null;
  const peRaw     = meta.trailingPE ?? meta.forwardPE ?? null;
  const sharesNum = _metaNum(sharesRaw);   // Yahoo poate returna {raw,fmt} — trebuie _metaNum
  const fundamentals = {
    eps:    _metaNum(epsRaw),
    pe:     _metaNum(peRaw),
    shares: sharesNum != null ? sharesNum / 1e6 : null,
  };

  return {
    closes, dates, volumes,
    currentPrice: closes[closes.length - 1],
    ticker:       meta.symbol,
    currency:     meta.currency || 'USD',
    name:         meta.longName || meta.shortName || ticker,
    fundamentals,
  };
}

// ── Volatilitate implicita din optiuni + Put/Call Skew ─
export async function fetchImpliedVolatility(ticker, currentPrice, onProgress) {
  const isUS = !ticker.includes('.') && !ticker.includes('-');

  function parseNasdaqIV(str) {
    if (!str || str === '--' || str === 'N/A') return null;
    const n = parseFloat(str.replace('%', '').replace(',', ''));
    if (isNaN(n) || n <= 0 || n > 500) return null;
    return n / 100;
  }
  function parseStrike(str) {
    if (!str) return null;
    return parseFloat(str.replace('$', '').replace(',', ''));
  }

  // ── Nasdaq API (ticker US fara proxy) ────────────────
  if (isUS) {
    try {
      const NBASE = 'https://api.nasdaq.com/api/quote';
      onProgress?.(`IV: incerc Nasdaq pentru ${ticker}...`);

      const listUrls = [
        `${NBASE}/${ticker}/option-chain?assetclass=stocks&type=all&limit=1`,
        `https://corsproxy.io/?${encodeURIComponent(`${NBASE}/${ticker}/option-chain?assetclass=stocks&type=all&limit=1`)}`,
      ];
      let expiryList = null;
      for (const u of listUrls) {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) continue;
          const d = await r.json();
          const list = d?.data?.expiryList;
          if (list?.length) { expiryList = list; break; }
        } catch (_) {}
      }

      if (expiryList?.length) {
        const now      = Date.now();
        const target30 = now + 30 * 86400000;
        const valid    = expiryList.filter(d => new Date(d).getTime() > now + 7 * 86400000);

        if (valid.length) {
          const nearestExp = valid.reduce((a, b) =>
            Math.abs(new Date(b) - target30) < Math.abs(new Date(a) - target30) ? b : a
          );
          const daysToExp = Math.round((new Date(nearestExp) - now) / 86400000);

          onProgress?.(`IV: Nasdaq — expirare ${nearestExp} (${daysToExp}z), descarc lantul...`);
          const chainUrls = [
            `${NBASE}/${ticker}/option-chain?assetclass=stocks&expirydate=${nearestExp}&type=all&money=all&limit=100`,
            `https://corsproxy.io/?${encodeURIComponent(`${NBASE}/${ticker}/option-chain?assetclass=stocks&expirydate=${nearestExp}&type=all&money=all&limit=100`)}`,
          ];
          let rows = null;
          for (const u of chainUrls) {
            try {
              const r = await fetch(u, { signal: AbortSignal.timeout(9000) });
              if (!r.ok) continue;
              const d = await r.json();
              const r2 = d?.data?.table?.rows;
              if (r2?.length) { rows = r2; break; }
            } catch (_) {}
          }

          if (rows?.length) {
            const atmRow = rows.reduce((best, row) => {
              const s = parseStrike(row.strike);
              if (!s) return best;
              const d = Math.abs(s - currentPrice);
              return !best || d < best.d ? { row, d, s } : best;
            }, null);

            if (atmRow) {
              const ivs = [parseNasdaqIV(atmRow.row.c_IV), parseNasdaqIV(atmRow.row.p_IV)]
                .filter(v => v != null && v > 0.01 && v < 5);

              if (ivs.length) {
                const ivAnnual  = ivs.reduce((a, b) => a + b, 0) / ivs.length;
                const ivDaily   = ivAnnual / Math.sqrt(252);
                const atmStrike = atmRow.s;

                const putTarget  = currentPrice * 0.93;
                const callTarget = currentPrice * 1.07;
                const otmPutRows  = rows.filter(r => { const s = parseStrike(r.strike); return s && s < currentPrice * 0.98 && s > currentPrice * 0.70; });
                const otmCallRows = rows.filter(r => { const s = parseStrike(r.strike); return s && s > currentPrice * 1.02 && s < currentPrice * 1.30; });

                let skewData = null;
                if (otmPutRows.length && otmCallRows.length) {
                  const otmPutRow  = otmPutRows.reduce((b, r)  => { const s = parseStrike(r.strike); return !b || Math.abs(s - putTarget)  < Math.abs(parseStrike(b.strike) - putTarget)  ? r : b; }, null);
                  const otmCallRow = otmCallRows.reduce((b, r) => { const s = parseStrike(r.strike); return !b || Math.abs(s - callTarget) < Math.abs(parseStrike(b.strike) - callTarget) ? r : b; }, null);
                  const piv = parseNasdaqIV(otmPutRow?.p_IV);
                  const civ = parseNasdaqIV(otmCallRow?.c_IV);
                  if (piv && civ) {
                    skewData = {
                      skew: piv - civ, putIV: piv, callIV: civ,
                      putStrike:  parseStrike(otmPutRow?.strike),
                      callStrike: parseStrike(otmCallRow?.strike),
                    };
                  }
                }
                onProgress?.(`IV: Nasdaq ✓ — IV ${(ivAnnual*100).toFixed(1)}%/an, skew ${skewData ? (skewData.skew*100).toFixed(1)+'%' : 'N/A'}`);
                return { ivAnnual, ivDaily, atmStrike, daysToExp, skewData };
              }
            }
          }
        }
      }
    } catch (e) { console.warn('Nasdaq IV fail:', e.message); }
    onProgress?.(`IV: Nasdaq indisponibil, incerc Yahoo Finance...`);
  }

  // ── Yahoo Finance v7 fallback ─────────────────────
  async function tryYahoo(path) {
    const hosts   = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com'];
    const mkProxy = [
      u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    ];
    for (const h of hosts) for (const mk of mkProxy) {
      try {
        const r = await fetch(mk(`${h}${path}`), { signal: AbortSignal.timeout(9000) });
        if (!r.ok) continue;
        const j = await r.json();
        if (j?.optionChain?.result?.[0]) return j;
      } catch (_) {}
    }
    return null;
  }

  try {
    onProgress?.(`IV: incerc Yahoo Finance v7 (4 proxy-uri)...`);
    const data = await tryYahoo(`/v7/finance/options/${ticker}`);
    if (!data) { onProgress?.(`IV: Yahoo indisponibil — voi estima din VIX`); return null; }
    const result = data.optionChain.result[0];
    const now    = Date.now() / 1000;
    const t30    = now + 30 * 86400;
    const expDates = (result.expirationDates || []).filter(d => d > now + 7 * 86400);
    if (!expDates.length) return null;
    const nearestExp = expDates.reduce((a, b) => Math.abs(b - t30) < Math.abs(a - t30) ? b : a);

    const data2 = await tryYahoo(`/v7/finance/options/${ticker}?date=${nearestExp}`);
    if (!data2) return null;
    const opts = data2?.optionChain?.result?.[0]?.options?.[0];
    if (!opts) return null;

    const calls = (opts.calls || []).filter(c => c.impliedVolatility > 0.01 && c.impliedVolatility < 5);
    const puts  = (opts.puts  || []).filter(p => p.impliedVolatility > 0.01 && p.impliedVolatility < 5);
    if (!calls.length && !puts.length) return null;

    const allStrikes = [...new Set([...calls.map(c => c.strike), ...puts.map(p => p.strike)])].sort((a, b) => a - b);
    const atmStrike  = allStrikes.reduce((a, b) => Math.abs(b - currentPrice) < Math.abs(a - currentPrice) ? b : a);
    const atmCall = calls.find(c => c.strike === atmStrike);
    const atmPut  = puts.find(p  => p.strike === atmStrike);
    const ivs = [atmCall?.impliedVolatility, atmPut?.impliedVolatility].filter(v => v > 0.01 && v < 5);
    if (!ivs.length) return null;

    const ivAnnual  = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    const ivDaily   = ivAnnual / Math.sqrt(252);
    const daysToExp = Math.round((nearestExp - now) / 86400);

    const putTarget  = currentPrice * 0.93;
    const callTarget = currentPrice * 1.07;
    const otmPuts  = puts.filter(p  => p.strike < currentPrice * 0.98 && p.strike > currentPrice * 0.70);
    const otmCalls = calls.filter(c => c.strike > currentPrice * 1.02 && c.strike < currentPrice * 1.30);
    let skewData = null;
    if (otmPuts.length && otmCalls.length) {
      const otmPut  = otmPuts.reduce((a, b)  => Math.abs(b.strike - putTarget)  < Math.abs(a.strike - putTarget)  ? b : a);
      const otmCall = otmCalls.reduce((a, b) => Math.abs(b.strike - callTarget) < Math.abs(a.strike - callTarget) ? b : a);
      if (otmPut?.impliedVolatility > 0.01 && otmCall?.impliedVolatility > 0.01) {
        skewData = {
          skew: otmPut.impliedVolatility - otmCall.impliedVolatility,
          putIV: otmPut.impliedVolatility, callIV: otmCall.impliedVolatility,
          putStrike: otmPut.strike, callStrike: otmCall.strike,
        };
      }
    }
    onProgress?.(`IV: Yahoo ✓ — IV ${(ivAnnual*100).toFixed(1)}%/an, skew ${skewData ? (skewData.skew*100).toFixed(1)+'%' : 'N/A'}`);
    return { ivAnnual, ivDaily, atmStrike, daysToExp, skewData };
  } catch (e) {
    console.warn('Yahoo IV fetch error:', e);
    onProgress?.(`IV: Yahoo eroare — voi estima din VIX`);
    return null;
  }
}

// ── Combina sigma istorica cu IV dupa orizontul de timp ──
// IV conteaza mult pe termen scurt (30z), scade spre orizonturi lungi
export function blendSigma(sigmaHist, ivDaily, days) {
  if (!ivDaily || ivDaily <= 0) return sigmaHist;
  const ivWeight = Math.max(0.10, Math.min(0.70, 30 / days));
  return ivWeight * ivDaily + (1 - ivWeight) * sigmaHist;
}

// ─────────────────────────────────────────────────────
//  FINNHUB — date fundamentale complete, CORS nativ, fara proxy
//  Obtine cheia gratuita de pe https://finnhub.io/dashboard
// ─────────────────────────────────────────────────────

//const FMP_KEY     = 'U6KIewb4btX6jwjbChgY49mZxVHI30mG';   // ← pune cheia FMP (https://financialmodelingprep.com/developer/docs) — tier gratuit 250 req/zi

// ── Proxy Python propriu (Render.com) — fallback final, fara CORS ──
// Dupa deploy pe Render, inlocuieste URL-ul de mai jos cu cel real
// ex: 'https://monte-carlo-proxy.onrender.com'
const MY_PROXY = 'https://monte-carlo-proxy.onrender.com';   // ← pune URL-ul dupa deploy

// ── Finnhub via proxy Render (cheia ramane pe server) ─
async function _fetchFinnhub(ticker) {
  if (!MY_PROXY) return {};
  try {
    const r = await fetch(
      `${MY_PROXY}/finnhub/${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (!r.ok) return {};
    const d = await r.json();

    const toM = v => (v != null && isFinite(v)) ? v : null;
    return {
      eps:         d.eps         ?? null,
      pe:          d.pe          ?? null,
      fcfPerShare: d.fcfPerShare ?? null,
      growth:      d.growth      ?? null,
      shares:      d.shares      ?? null,
      totalAssets:      toM(d.totalAssets),
      totalLiabilities: toM(d.totalLiabilities),
      cash:             toM(d.cash),
      debt:             toM(d.debt),
    };
  } catch (_) { return {}; }
}

// ── Sector via proxy Render (yfinance server-side) ───────
// ── IV real din optiuni Yahoo — prin proxy Render (fara CORS) ──
export async function fetchProxyIV(ticker, currentPrice) {
  if (!MY_PROXY) return null;
  try {
    const r = await fetch(
      `${MY_PROXY}/iv/${encodeURIComponent(ticker)}?price=${currentPrice}`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.ivAnnual || d.ivAnnual <= 0 || d.ivAnnual > 5) return null;
    return {
      ivAnnual:  d.ivAnnual,
      ivDaily:   d.ivDaily,
      atmStrike: d.atmStrike ?? null,
      daysToExp: d.daysToExp ?? 30,
      skewData:  d.skewData  ?? null,
    };
  } catch (_) { return null; }
}

export async function fetchProxySector(ticker) {
  if (!MY_PROXY) return null;
  try {
    const r = await fetch(
      `${MY_PROXY}/sector/${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const p = await r.json();
    if (!p?.sector) return null;
    return { sector: p.sector, industry: p.industry || p.sector };
  } catch (_) {
    return null;
  }
}

// ── Sector din Finnhub — prin proxy Render (cheia ramane pe server) ─
export async function fetchFinnhubSector(ticker) {
  if (!MY_PROXY) return null;
  try {
    const r = await fetch(
      `${MY_PROXY}/finnhub/${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(9000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.sector && !d?.industry) return null;
    return { sector: d.sector || 'Unknown', industry: d.industry || d.sector };
  } catch (_) { return null; }
}




// ── Heston calibrated params via proxy Render ─────────
export async function fetchHestonCalibrated(ticker, currentPrice, onProgress) {
  if (!MY_PROXY) return null;
  try {
    onProgress?.(`Heston: calibrez parametri pe suprafata IV (poate dura 15-25s)...`);
    const r = await fetch(
      `${MY_PROXY}/heston-calibrate/${encodeURIComponent(ticker)}?price=${currentPrice}`,
      { signal: AbortSignal.timeout(35000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.v0 || !d?.kappa || !d?.theta || !d?.xi) return null;
    onProgress?.(
      `Heston calibrat ✓ — RMSE ${(d.rmse * 100).toFixed(2)}%, ${d.nPoints} puncte IV, ${d.nExpiries} expirari`
    );
    return d;   // { v0, kappa, theta, xi, rho, rmse, nPoints, nExpiries, convergence }
  } catch (e) {
    console.warn('[Heston calibrate] esuat:', e.message);
    return null;
  }
}

// ── Fetch robustez ────────────────────────────────────

async function _yGet(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal:  ctrl.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : r.text();
  } finally { clearTimeout(tid); }
}

const _YPX = [
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

// Returneaza lista de proxy-uri — include MY_PROXY doar daca e setat
function _getProxies() {
  return MY_PROXY
    ? [..._YPX, u => `${MY_PROXY}/proxy?url=${encodeURIComponent(u)}`]
    : _YPX;
}

async function _robustGet(url, ms = 10000) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(tid);
      if (r.ok) {
        const ct = r.headers.get('content-type') || '';
        return ct.includes('json') ? r.json() : r.text();
      }
    } finally { clearTimeout(tid); }
  } catch (_) {}
  for (const px of _getProxies()) {
    try {
      const j = await _yGet(px(url), Math.min(ms, 8000));
      if (j != null) return j;
    } catch (_) {}
  }
  throw new Error(`Fetch esuat: ${url.split('/').slice(-1)[0]}`);
}

// ── SEC EDGAR — date bilant din rapoarte 10-K ─────────

let _secTickerCache = null;

async function _secCIK(ticker) {
  const clean = ticker.split('.')[0].split('-')[0].toUpperCase();
  if (!_secTickerCache) {
    try {
      const s = localStorage.getItem('_sec_tk');
      if (s) {
        const { ts, d } = JSON.parse(s);
        if (Date.now() - ts < 86_400_000) _secTickerCache = d;
      }
    } catch (_) {}
  }
  if (!_secTickerCache) {
    const raw = await _robustGet('https://www.sec.gov/files/company_tickers.json', 18000);
    _secTickerCache = raw;
    try { localStorage.setItem('_sec_tk', JSON.stringify({ ts: Date.now(), d: raw })); } catch (_) {}
  }
  const entry = Object.values(_secTickerCache).find(c => c.ticker?.toUpperCase() === clean);
  return entry ? String(entry.cik_str).padStart(10, '0') : null;
}

function _secLatest(json, unit = 'USD') {
  const arr = json?.units?.[unit];
  if (!arr) return null;
  // prefer annual (10-K/20-F); fallback la trimestrial (10-Q) daca nu exista anual
  const annual = arr
    .filter(d => d.val != null && /^(10-K|20-F)/.test(d.form))
    .sort((a, b) => new Date(b.end) - new Date(a.end))[0]?.val;
  if (annual != null) return annual;
  return arr
    .filter(d => d.val != null && /^10-Q/.test(d.form))
    .sort((a, b) => new Date(b.end) - new Date(a.end))[0]?.val ?? null;
}

async function _fetchSEC(ticker) {
  const cik = await _secCIK(ticker);
  if (!cik) throw new Error(`${ticker} nu e in SEC`);

  async function getConcept(name, altName, unit = 'USD', altNamespace = null) {
    const urls = [
      `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${name}.json`,
      altName && `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${altName}.json`,
      altName && altNamespace
        && `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${altNamespace}/${altName}.json`,
      `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/ifrs-full/${name}.json`,
    ].filter(Boolean);

    for (const url of urls) {
      try {
        const json = await _robustGet(url, 12000);
        const val  = _secLatest(json, unit);
        if (val != null) return val;
      } catch (_) {}
    }
    return null;
  }

  const [assets, liabilities, cash, debt, opCF, capex, sharesN, epsDiluted, epsBasic] = await Promise.all([
    getConcept('Assets', null),
    getConcept('Liabilities', null),
    getConcept('CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents'),
    getConcept('LongTermDebt', 'LongTermDebtNoncurrent'),
    getConcept('NetCashProvidedByUsedInOperatingActivities', 'CashFlowsFromUsedInOperatingActivities'),
    getConcept('PaymentsToAcquirePropertyPlantAndEquipment',
               'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'),
    getConcept('CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding', 'shares', 'dei'),
    getConcept('EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare', 'USD/shares'),
    getConcept('EarningsPerShareBasic',   'IncomeLossFromContinuingOperationsPerBasicShare',   'USD/shares'),
  ]);

  const rawShares = sharesN ?? null;
  const fcf  = opCF != null ? opCF - (capex ?? 0) : null;
  const eps  = epsDiluted ?? epsBasic ?? null;
  return {
    totalAssets:      assets      != null ? assets      / 1e6 : null,
    totalLiabilities: liabilities != null ? liabilities / 1e6 : null,
    cash:             cash        != null ? cash        / 1e6 : null,
    debt:             debt        != null ? debt        / 1e6 : null,
    shares:           rawShares   != null ? rawShares   / 1e6 : null,
    fcfTotal:         fcf         != null ? fcf         / 1e6 : null,
    fcfPerShare:      (fcf != null && rawShares > 0) ? fcf / rawShares : null,
    eps,
  };
}

// ── Helper: Yahoo returneaza uneori {raw,fmt} chiar si cu formatted=false ──
function _yv(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v.raw ?? null;
  return typeof v === 'number' ? v : null;
}

// ── Yahoo quoteSummary — date fundamentale complete ───
async function _fetchYahooFundamentals(ticker) {
  const modules = 'financialData,defaultKeyStatistics,summaryDetail,balanceSheetHistory,balanceSheetHistoryQuarterly';
  const summaryUrls = [
    `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${ticker}?modules=${modules}&formatted=false`,
    `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${ticker}?modules=${modules}&formatted=false`,
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}&formatted=false`,
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}&formatted=false`,
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}`,
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}`,
  ];
  if (MY_PROXY) {
    const proxyUrl = `${MY_PROXY}/proxy?url=${encodeURIComponent(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}&formatted=false`
    )}`;
    try {
      const json = await _yGet(proxyUrl, 12000);
      if (typeof json === 'object') {
        const r = json?.quoteSummary?.result?.[0];
        if (r) {
          const fd = r.financialData || {}, ks = r.defaultKeyStatistics || {}, sd = r.summaryDetail || {};
          const bs  = r.balanceSheetHistory?.balanceSheetStatements?.[0] || {};
          const bsQ = r.balanceSheetHistoryQuarterly?.balanceSheetStatements?.[0] || {};
          const sharesRaw = _yv(ks.sharesOutstanding);
          const fcfTotal  = _yv(fd.freeCashflow);
          const totalAssetsRaw = _yv(fd.totalAssets) ?? _yv(bs.totalAssets) ?? _yv(bsQ.totalAssets);
          let totalLiabRaw   = _yv(fd.totalLiabilities)
                          ?? _yv(bs.totalLiabilitiesNetMinorityInterest)
                          ?? _yv(bsQ.totalLiabilitiesNetMinorityInterest)
                          ?? _yv(bs.totalLiab)
                          ?? _yv(bsQ.totalLiab);

          // Fallback: fetch dedicat balance sheet dacă proxy nu l-a injectat (pre-redeploy)
          if (totalLiabRaw == null && MY_PROXY) {
            try {
              const bsUrl = `${MY_PROXY}/proxy?url=${encodeURIComponent(
                `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=balanceSheetHistory,balanceSheetHistoryQuarterly&formatted=false`
              )}`;
              const bsJ = await _yGet(bsUrl, 6000);
              const bsR = bsJ?.quoteSummary?.result?.[0];
              if (bsR) {
                const bsF  = bsR.balanceSheetHistory?.balanceSheetStatements?.[0] || {};
                const bsQF = bsR.balanceSheetHistoryQuarterly?.balanceSheetStatements?.[0] || {};
                totalLiabRaw = _yv(bsF.totalLiabilitiesNetMinorityInterest)
                            ?? _yv(bsF.totalLiab)
                            ?? _yv(bsQF.totalLiabilitiesNetMinorityInterest)
                            ?? _yv(bsQF.totalLiab);
                // Dacă proxy (redeployed) a injectat deja în fd
                if (totalLiabRaw == null && bsR.financialData?.totalLiabilities)
                  totalLiabRaw = _yv(bsR.financialData.totalLiabilities);
              }
            } catch (_) {}
          }
          const eps    = _yv(ks.trailingEps);
          const pe     = _yv(sd.trailingPE) ?? _yv(sd.forwardPE) ?? _yv(ks.trailingPE) ?? null;
          const growth = _yv(fd.earningsGrowth)      != null ? _yv(fd.earningsGrowth)      * 100
                       : _yv(fd.revenueGrowth)       != null ? _yv(fd.revenueGrowth)       * 100
                       : _yv(ks.earningsQuarterlyGrowth) != null ? _yv(ks.earningsQuarterlyGrowth) * 100 : null;
          const dividendRate  = _yv(sd.dividendRate)  ?? null;
          const dividendYield = _yv(sd.dividendYield) != null ? _yv(sd.dividendYield) * 100 : null;
          const _debtV   = _yv(fd.totalDebt);
          const ltv = (_debtV != null && totalAssetsRaw > 0) ? (_debtV / totalAssetsRaw) * 100 : null;
          console.log(`[Proxy] ${ticker} — eps=${eps} pe=${pe} fcf=${fcfTotal} shares=${sharesRaw} totalAssets=${totalAssetsRaw} totalLiab=${totalLiabRaw}`,
            'ks.trailingEps=', ks.trailingEps, 'sd.trailingPE=', sd.trailingPE);
          if (eps != null || pe != null || fcfTotal != null) {
            return {
              eps, pe, growth,
              dividendRate, dividendYield, ltv,
              shares:           sharesRaw      != null ? sharesRaw      / 1e6 : null,
              fcfPerShare:      (fcfTotal != null && sharesRaw > 0) ? fcfTotal / sharesRaw : null,
              cash:             _yv(fd.totalCash)   != null ? _yv(fd.totalCash)   / 1e6 : null,
              debt:             _yv(fd.totalDebt)   != null ? _yv(fd.totalDebt)   / 1e6 : null,
              totalAssets:      totalAssetsRaw      != null ? totalAssetsRaw      / 1e6 : null,
              totalLiabilities: totalLiabRaw        != null ? totalLiabRaw        / 1e6 : null,
            };
          }
        }
      }
    } catch (e) { console.warn('[Proxy fast-path error]', e); }
  }

  for (const url of summaryUrls) {
    for (const px of _getProxies()) {
      try {
        const json = await _yGet(px(url), 3000);
        if (typeof json !== 'object') continue;
        const r = json?.quoteSummary?.result?.[0];
        if (!r) continue;
        const fd  = r.financialData        || {};
        const ks  = r.defaultKeyStatistics || {};
        const sd  = r.summaryDetail        || {};
        const bs  = r.balanceSheetHistory?.balanceSheetStatements?.[0] || {};
        const bsQ = r.balanceSheetHistoryQuarterly?.balanceSheetStatements?.[0] || {};

        const sharesRaw = _yv(ks.sharesOutstanding);
        const fcfTotal  = _yv(fd.freeCashflow);
        const fcfPS     = (fcfTotal != null && sharesRaw > 0) ? fcfTotal / sharesRaw : null;

        const eps    = _yv(ks.trailingEps);
        const pe     = _yv(sd.trailingPE) ?? _yv(sd.forwardPE) ?? _yv(ks.trailingPE) ?? null;
        const growth = _yv(fd.earningsGrowth)      != null ? _yv(fd.earningsGrowth)      * 100
                     : _yv(fd.revenueGrowth)       != null ? _yv(fd.revenueGrowth)       * 100
                     : _yv(ks.earningsQuarterlyGrowth) != null ? _yv(ks.earningsQuarterlyGrowth) * 100 : null;
        const dividendRate  = _yv(sd.dividendRate)  ?? null;
        const dividendYield = _yv(sd.dividendYield) != null ? _yv(sd.dividendYield) * 100 : null;
        const _dV  = _yv(fd.totalDebt);
        const _aV  = _yv(fd.totalAssets) ?? _yv(bs.totalAssets) ?? _yv(bsQ.totalAssets);
        const _lV  = _yv(fd.totalLiabilities)
                  ?? _yv(bs.totalLiabilitiesNetMinorityInterest)
                  ?? _yv(bs.totalLiab)
                  ?? _yv(bsQ.totalLiabilitiesNetMinorityInterest)
                  ?? _yv(bsQ.totalLiab);
        const ltv  = (_dV != null && _aV > 0) ? (_dV / _aV) * 100 : null;

        if (eps != null || pe != null || fcfTotal != null) {
          return {
            eps, pe, growth,
            dividendRate, dividendYield, ltv,
            shares:           sharesRaw != null ? sharesRaw / 1e6 : null,
            fcfPerShare:      fcfPS,
            cash:             _yv(fd.totalCash) != null ? _yv(fd.totalCash) / 1e6 : null,
            debt:             _yv(fd.totalDebt) != null ? _yv(fd.totalDebt) / 1e6 : null,
            totalAssets:      _aV              != null ? _aV              / 1e6 : null,
            totalLiabilities: _lV              != null ? _lV              / 1e6 : null,
          };
        }
      } catch (_) {}
    }
  }

  // Pas 2: fallback — endpoint quote v7/v8 (mai sarac, fara FCF/cash/debt)
  const quoteUrls = [
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&formatted=false`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&formatted=false`,
    `https://query2.finance.yahoo.com/v8/finance/quote?symbols=${ticker}`,
    `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${ticker}`,
  ];
  for (const url of quoteUrls) {
    for (const px of _getProxies()) {
      try {
        const json = await _yGet(px(url), 4000);
        if (typeof json !== 'object') continue;
        const q = json?.quoteResponse?.result?.[0];
        if (!q) continue;
        const sharesQ   = _yv(q.sharesOutstanding) ?? _yv(q.impliedSharesOutstanding) ?? null;
        const divRateQ  = _yv(q.trailingAnnualDividendRate) ?? _yv(q.dividendRate) ?? null;
        const divYieldQ = _yv(q.trailingAnnualDividendYield) != null
                        ? _yv(q.trailingAnnualDividendYield) * 100
                        : _yv(q.dividendYield) != null ? _yv(q.dividendYield) * 100 : null;
        return {
          eps:          _yv(q.epsTrailingTwelveMonths) ?? _yv(q.trailingEps) ?? null,
          pe:           _yv(q.trailingPE) ?? null,
          growth:       _yv(q.earningsGrowth) != null ? _yv(q.earningsGrowth) * 100
                      : _yv(q.revenueGrowth)  != null ? _yv(q.revenueGrowth)  * 100 : null,
          shares:       sharesQ   != null ? sharesQ / 1e6 : null,
          dividendRate: divRateQ,
          dividendYield: divYieldQ,
        };
      } catch (_) {}
    }
  }
  return {};
}

// ── Yahoo Timeseries — fallback pentru totalAssets EU ──
// Endpoint diferit fata de quoteSummary, returneaza date anuale istorice
// (finance.yahoo.com/quote/COV.PA/balance-sheet/ foloseste exact asta)
async function _fetchYahooTimeseries(ticker) {
  const now    = Math.floor(Date.now() / 1000);
  const period = 1577836800; // 2020-01-01
  const types  = 'annualTotalAssets,annualTotalLiabilitiesNetMinorityInterest,annualTotalDebt,annualCashAndCashEquivalents,annualFreeCashFlow';
  const tsUrl  = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${ticker}` +
                 `?type=${types}&period1=${period}&period2=${now}&lang=en-US`;

  const tryUrl = async (url) => {
    try {
      const json = await _yGet(url, 8000);
      if (typeof json !== 'object') return null;
      const results = json?.timeseries?.result;
      if (!Array.isArray(results)) return null;

      const getLatest = (type) => {
        // Structura 1: fiecare result are campul `type` (ex: {type:'annualTotalAssets', annualTotalAssets:[...]})
        const r = results.find(x => x.type === type);
        if (r) {
          const arr = r[type];
          if (Array.isArray(arr) && arr.length) {
            const last = arr[arr.length - 1];
            return last?.reportedValue?.raw ?? last?.value?.raw ?? null;
          }
        }
        // Structura 2: toate tipurile intr-un singur obiect (flat), fara camp `type`
        for (const obj of results) {
          const arr = obj[type];
          if (Array.isArray(arr) && arr.length) {
            const last = arr[arr.length - 1];
            return last?.reportedValue?.raw ?? last?.value?.raw ?? null;
          }
        }
        return null;
      };

      const assets      = getLatest('annualTotalAssets');
      const liabilities = getLatest('annualTotalLiabilitiesNetMinorityInterest');
      const debt        = getLatest('annualTotalDebt');
      const cash        = getLatest('annualCashAndCashEquivalents');
      const fcfRaw      = getLatest('annualFreeCashFlow');

      if (assets == null && debt == null) return null;
      const tsResult = {
        totalAssets:      assets      != null ? assets      / 1e6 : null,
        totalLiabilities: liabilities != null ? liabilities / 1e6 : null,
        debt:             debt        != null ? debt        / 1e6 : null,
        cash:             cash        != null ? cash        / 1e6 : null,
        fcfTotal:         fcfRaw      != null ? fcfRaw      / 1e6 : null,
      };
      console.log(`[Timeseries] ${ticker} — totalAssets=${tsResult.totalAssets} totalLiab=${tsResult.totalLiabilities} debt=${tsResult.debt} cash=${tsResult.cash} fcf=${tsResult.fcfTotal}`);
      return tsResult;
    } catch (_) { return null; }
  };

  // Incearca prin proxy Render (evita CORS), apoi direct
  if (MY_PROXY) {
    const proxyUrl = `${MY_PROXY}/proxy?url=${encodeURIComponent(tsUrl)}`;
    const r = await tryUrl(proxyUrl);
    if (r) return r;
  }
  return await tryUrl(tsUrl) ?? {};
}

// ── EPS + PE fallback din Yahoo chart meta (EU/nordic — Finnhub/quoteSummary pot fi null) ──
// Nu foloseste MY_PROXY — evita presiune suplimentara pe IP-ul Render (rate-limit Yahoo)
async function _fetchYahooChartMeta(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  for (const px of proxies) {
    try {
      const r = await fetch(px, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const json = await r.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta) continue;
      const eps = _metaNum(meta.epsTrailingTwelveMonths ?? null);
      const pe  = _metaNum(meta.trailingPE ?? meta.forwardPE ?? null);
      if (eps != null || pe != null) return { eps, pe };
    } catch { /* încearcă următorul proxy */ }
  }
  return null;
}

export async function fetchValuationFundamentals(ticker) {
  const isUS = !ticker.includes('.') && !ticker.includes('-');

  // ── Lansam toate sursele in paralel ───────────────────
  // Ordinea de prioritate: Finnhub > SEC (US only) > Yahoo
  const tasks = [
    _fetchFinnhub(ticker),
    isUS ? _fetchSEC(ticker) : Promise.resolve({}),
    _fetchYahooFundamentals(ticker),
  ];
  const [fhR, secR, quoteR] = await Promise.allSettled(tasks);

  const fh    = fhR.status    === 'fulfilled' ? fhR.value    : {};
  const sec   = secR.status   === 'fulfilled' ? secR.value   : {};
  const quote = quoteR.status === 'fulfilled' ? quoteR.value : {};

  // ── Merge: Finnhub > SEC > Yahoo (primul non-null castiga) ──
  let eps      = fh.eps    ?? sec.eps    ?? quote.eps    ?? null;
  let _epsSource = fh.eps != null ? 'Finnhub' : sec.eps != null ? 'SEC' : quote.eps != null ? 'Yahoo' : null;
  // Fallback EPS + PE: Yahoo chart meta — apelat DOAR cand eps lipseste dupa merge
  // (evita cereri inutile care agraveaza rate-limiting Yahoo pe IP-ul Render)
  let _chartMeta = null;
  if (eps == null) {
    _chartMeta = await _fetchYahooChartMeta(ticker);
  }
  if (eps == null && _chartMeta?.eps != null) {
    eps = _chartMeta.eps;
    _epsSource = 'Yahoo Chart';
    console.info(`[EPS fallback] ${ticker}: meta.epsTrailingTwelveMonths → ${eps}`);
  }
  let pe = fh.pe ?? quote.pe ?? _chartMeta?.pe ?? null;
  if (fh.pe == null && quote.pe == null && _chartMeta?.pe != null) {
    console.info(`[PE fallback] ${ticker}: meta.trailingPE/forwardPE → ${pe}`);
  }
  const shares = fh.shares ?? sec.shares ?? quote.shares ?? null;
  let growth   = fh.growth ?? quote.growth               ?? null;

  // --- PATCH: corectare growth --- //
  if (growth != null) {
    if (growth > 35)  growth = 35;   // cap rezonabil pentru DCF
    if (growth < -15) growth = 0;    // nu folosim scadere drastica
  }
  // FCF negativ → growth 0, dar DOAR dacă avem valori concrete (nu null)
  if ((fh.fcfPerShare != null && fh.fcfPerShare <= 0) ||
      (quote.fcfPerShare != null && quote.fcfPerShare <= 0)) {
    growth = 0;
  }
  // --- END PATCH --- //

  // FCF per share: Finnhub direct, sau calcul din fcfTotal SEC + shares disponibil
  let fcfPerShare = fh.fcfPerShare ?? sec.fcfPerShare ?? quote.fcfPerShare ?? null;
  if (fcfPerShare == null && sec.fcfTotal != null && shares != null && shares > 0) {
    fcfPerShare = sec.fcfTotal / shares;
  }
  // ── Sanity checks FCF ────────────────────────────────────
  const _eps = eps; // deja merge-uit, include fallback Yahoo Chart dacă a fost necesar

  // A: FCF/act prea mic față de EPS pozitiv → date aberante (ex: Enagas Yahoo)
  if (fcfPerShare != null && _eps != null && _eps > 0.5 && Math.abs(fcfPerShare) < _eps * 0.05) {
    console.warn(`[FCF sanity A] ${ticker}: fcfPerShare=${fcfPerShare?.toFixed(3)} prea mic față de EPS=${_eps} → resetat`);
    fcfPerShare = null;
  }
  // B: FCF/act prea mare față de EPS → posibil total raportat ca per-share (ex: 520M → 520)
  if (fcfPerShare != null && _eps != null && _eps > 0.5 && fcfPerShare > _eps * 20) {
    console.warn(`[FCF sanity B] ${ticker}: fcfPerShare=${fcfPerShare?.toFixed(2)} prea mare față de EPS=${_eps} (>${(_eps * 20).toFixed(2)}) → resetat`);
    fcfPerShare = null;
  }
  // C: FCF negativ extrem față de EPS → eroare de semn sau magnitudine
  if (fcfPerShare != null && _eps != null && _eps > 0.5 && fcfPerShare < -_eps * 10) {
    console.warn(`[FCF sanity C] ${ticker}: fcfPerShare=${fcfPerShare?.toFixed(2)} negativ extrem față de EPS=${_eps} → resetat`);
    fcfPerShare = null;
  }
  // D: FCF absolut implausibil (> 500) — independent de EPS, prinde cazurile cu EPS mic/negativ
  if (fcfPerShare != null && Math.abs(fcfPerShare) > 500) {
    console.warn(`[FCF sanity D] ${ticker}: |fcfPerShare|=${Math.abs(fcfPerShare).toFixed(2)} > 500 — magnitudine imposibilă → resetat`);
    fcfPerShare = null;
  }
  // E: Shares sanity — warn only (nu există fallback)
  if (shares != null && (shares < 0.01 || shares > 5_000_000)) {
    console.warn(`[Shares sanity] ${ticker}: shares=${shares}M în afara intervalului rezonabil [10K, 5T] — posibil date eronate`);
  }
  // F: EPS/PE inconsistență — warn only
  if (eps != null && pe != null && eps <= 0 && pe > 0) {
    console.warn(`[EPS/PE sanity] ${ticker}: EPS=${eps} ≤ 0 dar PE=${pe} > 0 — date inconsistente din surse diferite`);
  }

  // Bilant: Finnhub > SEC > Yahoo Timeseries > Yahoo quoteSummary
  let totalAssets      = fh.totalAssets      ?? sec.totalAssets      ?? null;
  let totalLiabilities = fh.totalLiabilities ?? sec.totalLiabilities ?? null;
  let cash             = fh.cash             ?? sec.cash  ?? quote.cash  ?? null;
  let debt             = fh.debt             ?? sec.debt  ?? quote.debt  ?? null;


  // ── Fallback Yahoo Timeseries (EU REITs — totalAssets adesea null in quoteSummary) ──
  // Apelat si cand fcfPerShare == null — Finnhub poate returna bilant fara FCF pentru stocks nordice
  let tsData = {};
  if (totalAssets == null || totalLiabilities == null || (cash == null && debt == null) || fcfPerShare == null) {
    tsData = await _fetchYahooTimeseries(ticker).catch(() => ({}));
  }
  totalAssets      = totalAssets      ?? tsData.totalAssets      ?? quote.totalAssets      ?? null;
  totalLiabilities = totalLiabilities ?? tsData.totalLiabilities ?? quote.totalLiabilities ?? null;
  cash             = cash             ?? tsData.cash             ?? null;
  debt             = debt             ?? tsData.debt             ?? null;

  // Actualizeaza fcfPerShare din timeseries daca inca lipseste
  if (fcfPerShare == null && tsData.fcfTotal != null && shares != null && shares > 0) {
    const _fcfTS = tsData.fcfTotal / shares;
    // Re-aplica sanity checks si pe valoarea calculata din timeseries (G)
    const _absTS = Math.abs(_fcfTS);
    const _tooSmall = _eps != null && _eps > 0.5 && _absTS < _eps * 0.05;
    const _tooLarge = _eps != null && _eps > 0.5 && _fcfTS > _eps * 20;
    const _negExtrem = _eps != null && _eps > 0.5 && _fcfTS < -_eps * 10;
    const _imposibil = _absTS > 500;
    if (_tooSmall || _tooLarge || _negExtrem || _imposibil) {
      console.warn(`[FCF sanity G/TS] ${ticker}: fcfPerShare calculat din timeseries=${_fcfTS?.toFixed(3)} invalid → ignorat`);
    } else {
      fcfPerShare = _fcfTS;
    }
  }

  // ── Dividend + LTV — Yahoo sursa principala ──────────
  const dividendRate  = quote.dividendRate  ?? null;
  const dividendYield = quote.dividendYield ?? null;
  const ltvCalc = (debt != null && totalAssets != null && totalAssets > 0)
    ? (debt / totalAssets) * 100 : null;
  const ltv = quote.ltv ?? ltvCalc ?? null;

  // ── Sursa per camp (pentru afisare in UI) ─────────────
  const src3 = (fhV, secV, quoteV) =>
    fhV    != null ? 'Finnhub'
  : secV   != null ? 'SEC'
  : quoteV != null ? 'Yahoo'
  : null;

  const sources = {
    eps:      _epsSource,
    pe:       fh.pe != null ? 'Finnhub' : quote.pe != null ? 'Yahoo' : _chartMeta?.pe != null ? 'Yahoo Chart' : null,
    fcf:      src3(fh.fcfPerShare, sec.fcfPerShare, quote.fcfPerShare)
              ?? (tsData.fcfTotal != null ? 'Yahoo TS' : null)
              ?? (sec.fcfTotal    != null ? 'SEC calc' : null),
    growth:   src3(fh.growth,      null,            quote.growth),
    shares:   src3(fh.shares,      sec.shares,      quote.shares),
    assets:           fh.totalAssets       != null ? 'Finnhub'
                    : sec.totalAssets      != null ? 'SEC'
                    : tsData.totalAssets   != null ? 'Yahoo TS'
                    : quote.totalAssets    != null ? 'Yahoo'
                    : null,
    totalLiabilities: fh.totalLiabilities        != null ? 'Finnhub'
                    : sec.totalLiabilities        != null ? 'SEC'
                    : tsData.totalLiabilities     != null ? 'Yahoo TS'
                    : quote.totalLiabilities      != null ? 'Yahoo'
                    : null,
    cash:             fh.cash   != null ? 'Finnhub'
                    : sec.cash  != null ? 'SEC'
                    : tsData.cash != null ? 'Yahoo TS'
                    : quote.cash  != null ? 'Yahoo'
                    : null,
    debt:             fh.debt   != null ? 'Finnhub'
                    : sec.debt  != null ? 'SEC'
                    : tsData.debt != null ? 'Yahoo TS'
                    : quote.debt  != null ? 'Yahoo'
                    : null,
    dividend: dividendRate != null ? 'Yahoo' : null,
  };

  const result = {
    eps, pe, growth, shares, fcfPerShare,
    fcfTotal:         sec.fcfTotal ?? tsData.fcfTotal ?? null,
    totalAssets, totalLiabilities, cash, debt,
    dividendRate, dividendYield, ltv,
    sources,
  };
  if (Object.values(result).filter(v => v !== result.sources).every(v => v == null)) throw new Error('Date indisponibile');
  return result;
}
