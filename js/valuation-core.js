// ─────────────────────────────────────────────────────
//  VALUATION-CORE.JS — Config sectoare, calcul valuare (4 metode), UI panel
// ─────────────────────────────────────────────────────

import { $, fmt, setPillColor }          from './ui.js';
import { fetchValuationFundamentals }     from './api.js';
import {
  generateFundamentalComment,
  ensureFundComment,
  setTechCtx,
  setLastValResult,
  bumpValFetchGen,
  getValFetchGen,
} from './valuation-scores.js';

// ── Ponderi per sector ────────────────────────────────

const VAL_SECTOR_WEIGHTS = {
  tutun:        { eps: 0.30, fcf: 0.30, nav: 0.10, dcf: 0.30 },
  energy:       { eps: 0.15, fcf: 0.35, nav: 0.10, dcf: 0.40 },
  utilitati:    { eps: 0.20, fcf: 0.25, nav: 0.15, dcf: 0.40 },
  asigurari:    { eps: 0.35, fcf: 0.20, nav: 0.30, dcf: 0.15 },
  conglomerate: { eps: 0.25, fcf: 0.25, nav: 0.20, dcf: 0.30 },
  consum:       { eps: 0.25, fcf: 0.25, nav: 0.15, dcf: 0.35 },
  tech:         { eps: 0.20, fcf: 0.15, nav: 0.10, dcf: 0.55 },
  reit:         { eps: 0.10, fcf: 0.35, nav: 0.40, dcf: 0.15 },
  shipping:     { eps: 0.20, fcf: 0.35, nav: 0.15, dcf: 0.30 },
  // ── Sectoare noi ─────────────────────────────────────
  healthcare:   { eps: 0.30, fcf: 0.20, nav: 0.05, dcf: 0.45 }, // Farma/sanatate: DCF + EPS dominante, book value irelevant
  banci:        { eps: 0.35, fcf: 0.05, nav: 0.50, dcf: 0.10 }, // Banci: P/Book dominant, FCF neaplicabil
  materiale:    { eps: 0.20, fcf: 0.30, nav: 0.25, dcf: 0.25 }, // Miniere/materiale: asset-heavy + ciclic
  auto:         { eps: 0.20, fcf: 0.25, nav: 0.25, dcf: 0.30 }, // Auto: capex masiv, ciclic, toate metodele relevante
};

export const YAHOO_TO_VAL_SECTOR = {
  'Technology':             'tech',
  'Communication Services': 'tech',
  'Energy':                 'energy',
  'Utilities':              'utilitati',
  'Financial Services':     'banci',
  'Insurance':              'asigurari',
  'Real Estate':            'reit',
  'Industrials':            'conglomerate',
  'Healthcare':             'healthcare',
  'Basic Materials':        'materiale',
  'Consumer Defensive':     'consum',
  'Consumer Cyclical':      'consum',
  // ── Mapari suplimentare Yahoo ─────────────────────────
  'Consumer Discretionary': 'consum',
  'Auto Manufacturers':     'auto',
  'Automobiles':            'auto',
};

// ── Calcul valuare — 4 metode ─────────────────────────

function calcValuare({ eps, pe, fcf, growth, wacc, tgr, assets, cash, totalLiabilities, shares, sector }) {
  const w = VAL_SECTOR_WEIGHTS[sector] || VAL_SECTOR_WEIGHTS.tech;

  const valEPS = (eps > 0 && pe > 0) ? eps * pe : null;
  const valFCF = (fcf > 0 && pe > 0) ? fcf * pe : null;
  // NAV = (Active totale − Pasive totale) / Acțiuni = Book Value per Share
  const valNAV = (assets != null && totalLiabilities != null && shares > 0)
    ? (assets - totalLiabilities) / shares
    : null;

  let valDCF = null;
  let growthCapped = false;
  if (fcf > 0 && growth != null && wacc != null && tgr != null && wacc > tgr) {
    // Cap growth la 35% maxim — rate peste 35% distorsioneaza masiv DCF-ul
    const rawG = growth / 100;
    const g    = Math.min(rawG, 0.35);
    if (rawG > 0.35) growthCapped = true;
    const r = wacc / 100, t = tgr / 100;
    let dcfSum = 0;
    for (let n = 1; n <= 10; n++) {
      dcfSum += (fcf * Math.pow(1 + g, n)) / Math.pow(1 + r, n);
    }
    const fcf10      = fcf * Math.pow(1 + g, 10);
    const terminalPV = (fcf10 * (1 + t) / (r - t)) / Math.pow(1 + r, 10);
    valDCF = dcfSum + terminalPV;
  }

  const methods = [
    { val: valEPS, w: w.eps }, { val: valFCF, w: w.fcf },
    { val: valNAV, w: w.nav }, { val: valDCF, w: w.dcf },
  ];
  const avail = methods.filter(m => m.val != null && isFinite(m.val));
  let weighted = null;
  if (avail.length > 0) {
    const totalW = avail.reduce((s, m) => s + m.w, 0);
    weighted = avail.reduce((s, m) => s + m.val * m.w / totalW, 0);
  }
  return { valEPS, valFCF, valNAV, valDCF, weighted, w, growthCapped };
}

// ── Actualizeaza UI dupa orice modificare input ───────

export function updateValuare() {
  const getNum = id => {
    const v = parseFloat($(`val-${id}`)?.value);
    return isNaN(v) ? null : v;
  };
  const sector    = $('val-sector')?.value || 'tech';
  const priceEl   = $('val-current-price');
  const rawPrice  = priceEl ? parseFloat(priceEl.dataset.price)   : 0;
  const currency  = priceEl ? (priceEl.dataset.currency || 'USD') : 'USD';
  const isGBp     = currency === 'GBp';
  const curPrice  = isGBp ? rawPrice / 100 : rawPrice;   // GBp pence → GBP lire
  const sym       = isGBp ? 'GBP ' : (currency === 'USD' ? '$' : currency + ' ');

  const inputs = {
    eps: getNum('eps'), pe: getNum('pe'), fcf: getNum('fcf'),
    growth: getNum('growth'), wacc: getNum('wacc'), tgr: getNum('tgr'),
    assets: getNum('assets'), cash: getNum('cash'),
    totalLiabilities: getNum('totalLiabilities'),
    shares: getNum('shares'),
    dividend:  getNum('dividend'),
    ltv:       getNum('ltv'),
    occupancy: getNum('occupancy'),
  };

  // ── Nota explicativa REIT + FCF negativ ──────────────
  const isReit = sector === 'reit';
  let fcfNoteEl = document.getElementById('val-fcf-reit-note');
  if (!fcfNoteEl) {
    fcfNoteEl = document.createElement('div');
    fcfNoteEl.id = 'val-fcf-reit-note';
    fcfNoteEl.style.cssText = 'font-size:10px;color:#ffee58;background:rgba(255,238,88,0.07);border-left:2px solid #ffee58;padding:5px 10px;margin:4px 0 6px 0;border-radius:0 4px 4px 0;line-height:1.5;display:none;';
    // Insereaza dupa randul cu sector/EPS (parintele input-ului sector)
    const sectorRow = $('val-sector')?.closest('.val-input-group')?.parentElement;
    if (sectorRow?.parentElement) sectorRow.parentElement.insertBefore(fcfNoteEl, sectorRow.nextSibling);
  }
  if (fcfNoteEl) {
    if (isReit && inputs.fcf != null && inputs.fcf < 0) {
      fcfNoteEl.textContent = '⚠ FCF negativ la REIT: capex-ul depășește cash-ul operațional — normal în faza de expansiune/investiții. NAV și dividendul sunt indicatorii relevanți, nu FCF-ul.';
      fcfNoteEl.style.display = 'block';
    } else {
      fcfNoteEl.style.display = 'none';
    }
  }

  // ── Rată Ocupare: vizibil pt REIT, fade 0.45 altfel ──
  const occupancyGroup = document.getElementById('val-occupancy-group');
  if (occupancyGroup) {
    occupancyGroup.style.opacity      = isReit ? '1' : '0.45';
    occupancyGroup.style.pointerEvents = isReit ? 'auto' : 'none';
  }

  // Calculeaza si afiseaza dividend yield automat
  const priceForYield = curPrice || 0;
  const yieldEl = $('val-div-yield');
  if (inputs.dividend > 0 && priceForYield > 0) {
    const yieldPct = (inputs.dividend / priceForYield) * 100;
    if (yieldEl) yieldEl.value = yieldPct.toFixed(2);
  } else {
    if (yieldEl) yieldEl.value = '';
  }

  const { valEPS, valFCF, valNAV, valDCF, valDDM, weighted, w, growthCapped } = calcValuare({ ...inputs, sector });

  function fv(v) { return v != null ? `${sym}${v.toFixed(2)}` : '—'; }

  // ── Formule pentru fiecare metoda ────────────────────
  const fmtN = (v, d=2) => v != null ? v.toFixed(d) : '—';
  const formulaEPS = inputs.eps > 0 && inputs.pe > 0
    ? `EPS ${sym}${fmtN(inputs.eps)} × P/E ${fmtN(inputs.pe,1)} = ${fv(valEPS)}`
    : 'Necesita EPS si P/E';
  const formulaFCF = inputs.fcf > 0 && inputs.pe > 0
    ? `FCF/acț ${sym}${fmtN(inputs.fcf)} × P/E ${fmtN(inputs.pe,1)} = ${fv(valFCF)}`
    : 'Necesita FCF si P/E';
  const formulaNAV = inputs.assets != null && inputs.totalLiabilities != null && inputs.shares > 0
    ? `(Active ${sym}${fmtN(inputs.assets,0)}M − Pasive totale ${sym}${fmtN(inputs.totalLiabilities,0)}M) ÷ ${fmtN(inputs.shares,0)}M acț = ${fv(valNAV)}`
    : 'Necesita active totale, pasive totale, acțiuni';
  const gUsed = inputs.growth != null ? Math.min(inputs.growth, 35) : null;
  const formulaDCF = inputs.fcf > 0 && inputs.growth != null && inputs.wacc != null && inputs.tgr != null
    ? `FCF ${sym}${fmtN(inputs.fcf)} × (1+${fmtN(gUsed,1)}%)^n / (1+${fmtN(inputs.wacc,1)}%)^n, 10 ani + val. terminală (TGR ${fmtN(inputs.tgr,1)}%)`
      + (growthCapped ? ` ⚠ creștere limitată la 35% (input: ${fmtN(inputs.growth,1)}%)` : '')
    : 'Necesita FCF, creștere, WACC, rată terminală';

  function card(label, val, formula, weight) {
    return `
      <div class="val-method-card" title="${formula.replace(/"/g,"'")}">
        <div class="vm-label">${label}</div>
        <div class="vm-val">${fv(val)}</div>
        <div class="vm-formula">${formula}</div>
        <div class="vm-weight">Pondere ${(weight * 100).toFixed(0)}%</div>
      </div>`;
  }

  let marginHtml = '';
  if (weighted != null && curPrice > 0) {
    const margin = (weighted - curPrice) / curPrice * 100;
    const color  = margin > 20 ? '#66bb6a' : margin > 0 ? '#ffee58' : '#ef5350';
    const label  = margin > 20 ? '✔ Subapreciat' : margin > 0 ? '≈ Corect evaluat' : '✘ Supraevaluat';
    marginHtml = `
      <div class="val-margin-card" style="background:${color}18;border:1px solid ${color}44;">
        <div class="vm-label" style="color:${color}99;">Marja siguranta</div>
        <div class="vm-val"   style="color:${color};">${margin >= 0 ? '+' : ''}${margin.toFixed(1)}%</div>
        <div class="vm-weight" style="color:${color}77;">${label}</div>
      </div>`;
  }

  const grid = $('val-results-grid');
  if (!grid) return;

  // ── Salveaza rezultatul curent pentru watchlist ───────
  const marginOfSafety = (weighted != null && curPrice > 0)
    ? (weighted - curPrice) / curPrice * 100
    : null;
  setLastValResult({ weightedValue: weighted, marginOfSafety });

  // Notifica app.js sa salveze imediat marja in DB (independent de AI)
  window.dispatchEvent(new CustomEvent('marginUpdated', {
    detail: { marginSafety: marginOfSafety }
  }));

  // ── Comentariu calitativ fundamental + tehnic ────────
  const commentEl = ensureFundComment();
  if (commentEl) {
    const margin = marginOfSafety;
    const _divYieldForScore = (inputs.dividend > 0 && priceForYield > 0)
      ? (inputs.dividend / priceForYield * 100) : null;
    commentEl.innerHTML = generateFundamentalComment(weighted, curPrice, margin, sym, _divYieldForScore);
    commentEl.style.display = 'block';
  }

  // ── Card dividend — calculat o singura data ──────────
  const _hasDiv   = inputs.dividend != null && inputs.dividend > 0;
  const _yieldPct = _hasDiv && priceForYield > 0 ? (inputs.dividend / priceForYield * 100) : null;
  const _dyColor  = !_yieldPct     ? '#888'
                  : _yieldPct < 2  ? '#ffee58'
                  : _yieldPct < 6  ? '#66bb6a'
                  : _yieldPct < 10 ? '#ffa726'
                  :                   '#ef5350';
  const _dyLabel  = !_yieldPct     ? ''
                  : _yieldPct < 2  ? 'Redus'
                  : _yieldPct < 6  ? 'Atractiv'
                  : _yieldPct < 10 ? 'Ridicat — verifică sustenabilitatea'
                  :                   'Excesiv — posibil yield trap';
  const dividendCardHtml = _hasDiv
    ? `<div class="val-method-card" style="border-color:${_dyColor}33;background:${_dyColor}06;">
        <div class="vm-label">Dividend Info</div>
        <div class="vm-val" style="color:${_dyColor}">${sym}${fmt(inputs.dividend)}<span style="font-size:10px;">/acț</span></div>
        ${_yieldPct ? `<div style="font-size:10px;color:${_dyColor};margin-top:3px;font-weight:600">${_yieldPct.toFixed(2)}% yield — ${_dyLabel}</div>` : ''}
        <div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:2px;">Dividend anual / acțiune</div>
      </div>`
    : `<div class="val-method-card" style="opacity:0.45;border-color:rgba(136,136,136,0.18);background:rgba(136,136,136,0.04);">
        <div class="vm-label" style="color:rgba(255,255,255,0.35);">Dividend Info</div>
        <div class="vm-val" style="color:rgba(255,255,255,0.28);font-size:13px;">Fără dividend</div>
        <div class="vm-weight" style="color:rgba(255,255,255,0.18);">—</div>
      </div>`;

  grid.innerHTML = `
    ${card('Val. PE',  valEPS, formulaEPS, w.eps)}
    ${card('Val. FCF', valFCF, formulaFCF, w.fcf)}
    ${card('Val. NAV', valNAV, formulaNAV, w.nav)}
    ${card('Val. DCF', valDCF, formulaDCF, w.dcf)}
    <div class="val-weighted-card">
      <div class="vm-label">Val. Medie Ponderată</div>
      <div class="vm-val">${fv(weighted)}</div>
      <div class="vm-weight">Preț curent: ${sym}${curPrice > 0 ? curPrice.toFixed(2) : '—'}</div>
    </div>
    ${marginHtml}
    ${dividendCardHtml}
    ${(() => {
      // ── Card Rată Ocupare ─────────────────────────────
      const isReit   = sector === 'reit';
      const occ      = inputs.occupancy;
      const hasOcc   = occ != null && occ > 0;
      const occColor = !hasOcc    ? 'rgba(79,195,247,0.6)'
                     : occ >= 92 ? '#66bb6a'
                     : occ >= 80 ? '#ffee58'
                     : occ >= 65 ? '#ffa726'
                     :              '#ef5350';
      const occLabel = !hasOcc    ? ''
                     : occ >= 92 ? 'Excelent'
                     : occ >= 80 ? 'Bun'
                     : occ >= 65 ? 'Moderat — urmărește tendința'
                     :              'Scăzut — risc venituri';
      const fadeStyle = isReit ? '' : 'opacity:0.45;';
      const occCard = !hasOcc
        ? `<div class="val-method-card" style="${fadeStyle}border-color:rgba(79,195,247,0.18);background:rgba(79,195,247,0.03);">
            <div class="vm-label" style="color:rgba(79,195,247,0.5);">Rată Ocupare</div>
            <div class="vm-val" style="color:rgba(255,255,255,0.28);font-size:13px;">${isReit ? 'Lipsă' : '—'}</div>
            <div class="vm-weight" style="color:rgba(255,255,255,0.18);">% spații închiriate / total</div>
          </div>`
        : `<div class="val-method-card" style="${fadeStyle}border-color:${occColor}33;background:${occColor}08;">
            <div class="vm-label" style="color:${occColor}cc;">Rată Ocupare</div>
            <div class="vm-val" style="color:${occColor}">${occ.toFixed(1)}<span style="font-size:11px;">%</span></div>
            <div style="font-size:10px;color:${occColor};margin-top:3px;font-weight:600">${occLabel}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:2px;">% spații închiriate / total</div>
          </div>`;

      // ── Card LTV ─────────────────────────────────────
      const ltv    = isReit ? inputs.ltv : null;
      const hasLtv = ltv != null && ltv > 0;
      const ltvColor = !hasLtv    ? 'rgba(79,195,247,0.6)'
                     : ltv < 30  ? '#66bb6a'
                     : ltv < 45  ? '#a5d6a7'
                     : ltv < 55  ? '#ffee58'
                     : ltv < 65  ? '#ffa726'
                     :              '#ef5350';
      const ltvLabel = !hasLtv    ? ''
                     : ltv < 30  ? 'Conservator — risc scăzut'
                     : ltv < 45  ? 'Sănătos — nivel optim'
                     : ltv < 55  ? 'Moderat — monitorizează'
                     : ltv < 65  ? 'Ridicat — presiune financiară'
                     :              'Periculos — risc refinanțare';
      const ltvCard = !hasLtv
        ? `<div class="val-method-card" style="${fadeStyle}border-color:rgba(79,195,247,0.18);background:rgba(79,195,247,0.03);">
            <div class="vm-label" style="color:rgba(79,195,247,0.5);">LTV <span style="font-size:8px;opacity:0.6;">(Loan-to-Value)</span></div>
            <div class="vm-val" style="color:rgba(255,255,255,0.28);font-size:13px;">${isReit ? 'Lipsă' : '—'}</div>
            <div class="vm-weight" style="color:rgba(255,255,255,0.18);">Datorii / Active totale</div>
          </div>`
        : `<div class="val-method-card" style="${fadeStyle}border-color:${ltvColor}33;background:${ltvColor}08;">
            <div class="vm-label" style="color:${ltvColor}cc;">LTV <span style="font-size:8px;opacity:0.7;">(Loan-to-Value)</span></div>
            <div class="vm-val" style="color:${ltvColor}">${ltv.toFixed(1)}<span style="font-size:11px;">%</span></div>
            <div style="font-size:10px;color:${ltvColor};margin-top:3px;font-weight:600">${ltvLabel}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:2px;">Datorii / Active totale</div>
          </div>`;

      return occCard + ltvCard;
    })()}`;
}

// ── Seteaza un input + flash verde ────────────────────

export function setValInput(id, value, decimals = 2) {
  const el = $(`val-${id}`);
  if (!el || value == null || !isFinite(value)) return;
  el.value = parseFloat(value.toFixed(decimals));
  el.style.borderColor = 'rgba(102,187,106,0.7)';
  setTimeout(() => { el.style.borderColor = ''; }, 1200);
}

function ensureValStatus() {
  let el = $('val-fetch-status');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'val-fetch-status';
  el.style.cssText = 'font-size:10px;margin-top:6px;letter-spacing:0.3px;';
  const header = document.querySelector('#valuation-panel .val-header');
  if (header) header.after(el);
  else $('valuation-panel')?.appendChild(el);
  return el;
}

// ── Citeste toate valorile curente din inputuri (pentru salvare in DB) ──

export function getCurrentValInputs() {
  const gn = id => { const v = parseFloat($(`val-${id}`)?.value); return isNaN(v) ? null : v; };
  return {
    sector:    $('val-sector')?.value    ?? null,
    price:     parseFloat($('val-current-price')?.dataset.price)  || null,
    currency:  $('val-current-price')?.dataset.currency           || null,
    eps:       gn('eps'),
    pe:        gn('pe'),
    fcf:       gn('fcf'),
    growth:    gn('growth'),
    wacc:      gn('wacc'),
    tgr:       gn('tgr'),
    assets:    gn('assets'),
    cash:      gn('cash'),
    totalLiabilities: gn('totalLiabilities'),
    shares:    gn('shares'),
    ltv:       gn('ltv'),
    occupancy: gn('occupancy'),
    dividend:  gn('dividend'),
  };
}

// ── Initializeaza panelul + fetch date fundamentale ───

export function initValuarePanel(currentPrice, currency, yahooSector, ticker, metaFundamentals = {}, technicalCtx = {}) {
  setTechCtx(technicalCtx);
  const panel = $('valuation-panel');
  if (!panel) return;

  let priceEl = $('val-current-price');
  if (!priceEl) {
    priceEl = document.createElement('span');
    priceEl.id = 'val-current-price';
    priceEl.style.display = 'none';
    panel.appendChild(priceEl);
  }
  priceEl.dataset.price    = currentPrice;
  priceEl.dataset.currency = currency || 'USD';

  // Populeaza si val-current-price pentru AI validator
  const valPriceEl = $('val-current-price');
  if (valPriceEl) {
    valPriceEl.dataset.price    = currentPrice;
    valPriceEl.dataset.currency = currency || 'USD';
  }

  // ── Curata campurile la fiecare ticker nou ────────────
  ['dividend', 'ltv', 'occupancy'].forEach(id => {
    const el = $(`val-${id}`);
    if (el) { el.value = ''; el.style.borderColor = ''; }
  });
  ['eps','pe','fcf','assets','cash','totalLiabilities','shares','growth'].forEach(id => {
    const el = $(`val-${id}`);
    if (el) { el.value = ''; el.style.borderColor = ''; }
  });
  // Restaureaza defaulturi pentru campurile care nu vin din Yahoo
  const waccEl = $('val-wacc'); if (waccEl && !waccEl.value) waccEl.value = '9';
  const tgrEl  = $('val-tgr');  if (tgrEl  && !tgrEl.value)  tgrEl.value  = '2.5';
  // Curata panelul AI Validator de la ticker-ul anterior
  const aiValEl = document.getElementById('val-ai-validation');
  if (aiValEl) aiValEl.innerHTML = '';
  const aiBtn = document.getElementById('val-ai-validate-btn');
  if (aiBtn) { aiBtn.style.display = 'none'; aiBtn.disabled = false; aiBtn.textContent = '◆ Claude'; }
  const geminiBtn = document.getElementById('val-gemini-validate-btn');
  if (geminiBtn) { geminiBtn.style.display = 'none'; geminiBtn.disabled = false; geminiBtn.textContent = '✦ Gemini'; }

  if (yahooSector && YAHOO_TO_VAL_SECTOR[yahooSector]) {
    const sel = $('val-sector');
    if (sel) sel.value = YAHOO_TO_VAL_SECTOR[yahooSector];
  }

  if (!panel.dataset.listenersAttached) {
    ['sector','eps','pe','fcf','growth','wacc','tgr','assets','cash','totalLiabilities','shares','ltv','occupancy','dividend'].forEach(id => {
      const el = $(`val-${id}`);
      el?.addEventListener('input',  updateValuare);
      el?.addEventListener('change', updateValuare);
    });
    panel.dataset.listenersAttached = '1';
  }

  panel.style.display = 'block';

  const statusEl = ensureValStatus();
  let metaPopulated = 0;
  if (metaFundamentals.eps    != null) { setValInput('eps',    metaFundamentals.eps,    2); metaPopulated++; }
  if (metaFundamentals.pe     != null) { setValInput('pe',     metaFundamentals.pe,     1); metaPopulated++; }
  if (metaFundamentals.shares != null) { setValInput('shares', metaFundamentals.shares, 0); metaPopulated++; }

  if (metaPopulated > 0) {
    statusEl.textContent = `✔ EPS + P/E din chart API · se descarcă FCF, active, pasive totale...`;
    statusEl.style.color = 'rgba(102,187,106,0.55)';
  } else {
    statusEl.textContent = '⏳ Se descarcă date fundamentale...';
    statusEl.style.color = 'rgba(255,255,255,0.4)';
  }
  updateValuare();

  // Butoane AI — vizibile dar faded in timpul fetch-ului
  ['val-ai-validate-btn', 'val-gemini-validate-btn'].forEach(id => {
    const b = $(id);
    if (b) { b.style.display = 'inline-flex'; b.style.opacity = '0.45'; b.style.pointerEvents = 'none'; }
  });

  if (!ticker) return;
  const _myValGen = bumpValFetchGen(); // capturam generatia inainte de fetch async
  fetchValuationFundamentals(ticker).then(d => {
    // Fetch stale — o simulare noua a pornit intre timp, ignoram datele
    if (_myValGen !== getValFetchGen()) return;
    if (metaFundamentals.eps == null) setValInput('eps', d.eps, 2);
    if (metaFundamentals.shares == null) setValInput('shares', d.shares, 0);
    // FCF/acțiune: direct din SEC/Yahoo; fallback calcul din fcfTotal + shares deja in input
    let fcfPS = d.fcfPerShare;
    if (fcfPS == null && d.fcfTotal != null) {
      const sharesVal = parseFloat($('val-shares')?.value);
      if (sharesVal > 0) fcfPS = d.fcfTotal / sharesVal;  // ($M) / (M shares) = $/share
    }
    setValInput('fcf', fcfPS, 2);
    setValInput('assets', d.totalAssets, 0);
    setValInput('cash',   d.cash,        0);
    setValInput('totalLiabilities', d.totalLiabilities, 0);
    setValInput('growth', d.growth,      1);
    if (d.dividendRate != null) setValInput('dividend', d.dividendRate, 2);
    if (d.ltv          != null) setValInput('ltv',       d.ltv,        1);

    // PE: din Yahoo quote; daca lipseste, calculeaza din pret/EPS
    if (metaFundamentals.pe == null) {
      const peVal = d.pe ?? (() => {
        const curPrice = parseFloat($('val-current-price')?.dataset.price);
        const epsVal   = parseFloat($('val-eps')?.value);
        return (epsVal > 0 && curPrice > 0) ? curPrice / epsVal : null;
      })();
      setValInput('pe', peVal, 1);
    }

    // Afiseaza sursa per camp
    const s = d.sources || {};
    const srcGroups = {};
    Object.entries(s).forEach(([field, src]) => {
      if (!src) return;
      if (!srcGroups[src]) srcGroups[src] = [];
      srcGroups[src].push(field);
    });
    const srcStr = Object.entries(srcGroups)
      .map(([src, fields]) => `${src}: ${fields.join(', ')}`)
      .join(' · ');
    statusEl.textContent = `✔ ${srcStr || 'Date disponibile'} · WACC, TGR — completează manual`;
    statusEl.style.color = 'rgba(102,187,106,0.65)';
    updateValuare();

    // Activeaza ambele butoane AI dupa ce datele sunt incarcate
    ['val-ai-validate-btn', 'val-gemini-validate-btn'].forEach(id => {
      const b = $(id);
      if (b) { b.style.opacity = '1'; b.style.pointerEvents = 'auto'; }
    });
  }).catch(err => {
    const msg = metaPopulated > 0
      ? '⚠ FCF/active/pasive totale indisponibile — completează manual'
      : '⚠ Date fundamentale indisponibile — completează manual';
    statusEl.textContent = msg;
    statusEl.style.color = 'rgba(255,167,38,0.6)';
    console.warn('Val fetch error:', err);
    // Activeaza ambele butoane si in caz de eroare
    ['val-ai-validate-btn', 'val-gemini-validate-btn'].forEach(id => {
      const b = $(id);
      if (b) { b.style.opacity = '1'; b.style.pointerEvents = 'auto'; }
    });
  });
}
