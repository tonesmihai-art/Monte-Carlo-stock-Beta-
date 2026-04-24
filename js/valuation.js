// ─────────────────────────────────────────────────────
//  VALUATION.JS — Evaluare fundamentala (PE, FCF, NAV, DCF)
//                 + comentariu calitativ GBM
// ─────────────────────────────────────────────────────

import { $, fmt, setPillColor } from './ui.js';
import { fetchValuationFundamentals } from './api.js';

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
};

export const YAHOO_TO_VAL_SECTOR = {
  'Technology':             'tech',
  'Communication Services': 'tech',
  'Energy':                 'energy',
  'Utilities':              'utilitati',
  'Financial Services':     'asigurari',
  'Insurance':              'asigurari',
  'Real Estate':            'reit',
  'Industrials':            'conglomerate',
  'Healthcare':             'conglomerate',
  'Basic Materials':        'conglomerate',
  'Consumer Defensive':     'consum',
  'Consumer Cyclical':      'consum',
};

// ── Calcul valuare — 4 metode ─────────────────────────

function calcValuare({ eps, pe, fcf, growth, wacc, tgr, assets, cash, debt, shares, sector }) {
  const w = VAL_SECTOR_WEIGHTS[sector] || VAL_SECTOR_WEIGHTS.tech;

  const valEPS = (eps > 0 && pe > 0) ? eps * pe : null;
  const valFCF = (fcf > 0 && pe > 0) ? fcf * pe : null;
  const valNAV = (assets != null && cash != null && debt != null && shares > 0)
    ? (assets + cash - debt) / shares
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
  const curPrice  = priceEl ? parseFloat(priceEl.dataset.price)   : 0;
  const currency  = priceEl ? (priceEl.dataset.currency || 'USD') : 'USD';
  const sym       = currency === 'USD' ? '$' : currency + ' ';

  const inputs = {
    eps: getNum('eps'), pe: getNum('pe'), fcf: getNum('fcf'),
    growth: getNum('growth'), wacc: getNum('wacc'), tgr: getNum('tgr'),
    assets: getNum('assets'), cash: getNum('cash'), debt: getNum('debt'),
    shares: getNum('shares'),
    dividend:  getNum('dividend'),
    ltv:       getNum('ltv'),
    occupancy: getNum('occupancy'),
  };

  // Calculeaza si afiseaza dividend yield automat
  const priceForYield = curPrice || 0;
  const yieldEl = $('val-div-yield');
  const yieldCalcEl = $('val-div-yield-calc');
  if (inputs.dividend > 0 && priceForYield > 0) {
    const yieldPct = (inputs.dividend / priceForYield) * 100;
    if (yieldEl) yieldEl.value = yieldPct.toFixed(2);
    if (yieldCalcEl) yieldCalcEl.textContent = `(${yieldPct.toFixed(2)}%)`;
  } else {
    if (yieldEl) yieldEl.value = '';
    if (yieldCalcEl) yieldCalcEl.textContent = '';
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
  const formulaNAV = inputs.assets != null && inputs.cash != null && inputs.debt != null && inputs.shares > 0
    ? `(Active ${sym}${fmtN(inputs.assets,0)}M + Cash ${sym}${fmtN(inputs.cash,0)}M − Datorii ${sym}${fmtN(inputs.debt,0)}M) ÷ ${fmtN(inputs.shares,0)}M acț = ${fv(valNAV)}`
    : 'Necesita active, cash, datorii, acțiuni';
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

  // ── Comentariu calitativ fundamental + tehnic ────────
  const commentEl = ensureFundComment();
  if (commentEl) {
    const margin = (weighted != null && curPrice > 0)
      ? (weighted - curPrice) / curPrice * 100
      : null;
    commentEl.innerHTML = generateFundamentalComment(weighted, curPrice, margin, sym);
    commentEl.style.display = 'block';
  }

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
    ${(() => {
      const hasDiv = inputs.dividend && inputs.dividend > 0;
      const yieldPct = hasDiv && priceForYield > 0 ? (inputs.dividend / priceForYield * 100) : null;
      const dyColor  = !yieldPct      ? '#888'
                     : yieldPct < 2   ? '#ffee58'
                     : yieldPct < 6   ? '#66bb6a'
                     : yieldPct < 10  ? '#ffa726'
                     :                  '#ef5350';
      const dyLabel  = !yieldPct      ? ''
                     : yieldPct < 2   ? 'Redus'
                     : yieldPct < 6   ? 'Atractiv'
                     : yieldPct < 10  ? 'Ridicat — verifică sustenabilitatea'
                     :                  'Excesiv — posibil yield trap';
      if (!hasDiv) {
        return `<div class="val-method-card" style="opacity:0.45;border-color:rgba(136,136,136,0.18);background:rgba(136,136,136,0.04);">
          <div class="vm-label" style="color:rgba(255,255,255,0.35);">Dividend Info</div>
          <div class="vm-val" style="color:rgba(255,255,255,0.28);font-size:13px;">Fără dividend</div>
          <div class="vm-weight" style="color:rgba(255,255,255,0.18);">—</div>
        </div>`;
      }
      return `<div class="val-method-card" style="border-color:${dyColor}33;background:${dyColor}06;">
        <div class="vm-label">Dividend Info</div>
        <div class="vm-val" style="color:${dyColor}">${sym}${fmt(inputs.dividend)}<span style="font-size:10px;">/acț</span></div>
        ${yieldPct ? `<div style="font-size:10px;color:${dyColor};margin-top:3px;font-weight:600">${yieldPct.toFixed(2)}% yield — ${dyLabel}</div>` : ''}
        <div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:2px;">Dividend anual / acțiune</div>
      </div>`;
    })()}`;
}

// ── Validare AI prin proxy ────────────────────────────

const MY_PROXY_VAL = 'https://monte-carlo-proxy.onrender.com';

export async function validateFundamentalsAI(ticker, sector, currency, currentPrice) {
  const getNum = id => { const v = parseFloat($(`val-${id}`)?.value); return isNaN(v) ? null : v; };
  const fields = {
    eps:       getNum('eps'),
    pe:        getNum('pe'),
    fcf:       getNum('fcf'),
    growth:    getNum('growth'),
    wacc:      getNum('wacc'),
    assets:    getNum('assets'),
    cash:      getNum('cash'),
    debt:      getNum('debt'),
    shares:    getNum('shares'),
    ltv:       getNum('ltv'),
    occupancy: getNum('occupancy'),
    dividend:  getNum('dividend'),
  };

  const resp = await fetch(`${MY_PROXY_VAL}/validate-fundamentals`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ticker, sector, currency, currentPrice, fields }),
  });
  if (!resp.ok) throw new Error(`Proxy error ${resp.status}`);
  return resp.json();
}

// ── Aplica corectiile AI si afiseaza panelul de diff ──

// Stocheaza ultimul rezultat AI pentru butonul de aplicare
let _lastAIResult = null;
let _lastAICurrency = null;

export function applyAIValidation(result, currency) {
  _lastAIResult   = result;
  _lastAICurrency = currency;

  const sym    = currency === 'USD' ? '$' : currency + ' ';
  const getNum = id => { const v = parseFloat($(`val-${id}`)?.value); return isNaN(v) ? null : v; };
  const fmtV   = (v, id) => {
    const dec = ['assets','cash','debt','shares'].includes(id) ? 0
              : ['growth','wacc','tgr','ltv','occupancy'].includes(id) ? 1 : 2;
    return v != null ? v.toFixed(dec) : '—';
  };

  const LABELS = {
    eps:'EPS', pe:'P/E', fcf:'FCF/acț', growth:'Creștere %',
    wacc:'WACC %', assets:'Active M', cash:'Cash M', debt:'Datorii M',
    ltv:'LTV %', dividend:'Dividend', shares:'Acțiuni M',
  };

  const corrections = result.corrections || {};
  const rows = Object.entries(corrections)
    .filter(([, v]) => v != null)
    .map(([id, corrected]) => {
      const original = getNum(id);
      return { id, label: LABELS[id] || id, original, corrected };
    });

  const isValid = result.valid !== false;
  const hasCorr = rows.length > 0;
  const vcColor = isValid && !hasCorr ? '#66bb6a' : hasCorr ? '#ffa726' : '#ef5350';
  const vcIcon  = isValid && !hasCorr ? '✔' : hasCorr ? '⚠' : '✘';

  const diffRows = rows.map(({ label, original, id, corrected }) => `
    <tr>
      <td style="color:rgba(255,255,255,0.45);padding:3px 8px 3px 0;font-size:10.5px;">${label}</td>
      <td style="color:#ef9a9a;text-decoration:line-through;padding:3px 8px;font-size:10.5px;white-space:nowrap;">
        ${original != null ? fmtV(original, id) : '—'}
      </td>
      <td style="color:#a5d6a7;font-weight:600;padding:3px 0;font-size:10.5px;white-space:nowrap;">
        → ${fmtV(corrected, id)}
      </td>
    </tr>`).join('');

  const issuesList = (result.issues || []).map(i =>
    `<div style="font-size:10px;color:rgba(255,167,38,0.8);margin-top:2px;">• ${i}</div>`
  ).join('');

  const applyBtnHtml = hasCorr ? `
    <button id="val-ai-apply-btn" onclick="window._applyAICorrections()"
      style="margin-top:10px;padding:5px 14px;border-radius:14px;border:1px solid rgba(255,167,38,0.5);
             background:rgba(255,167,38,0.1);color:#ffa726;font-size:10.5px;font-weight:700;
             cursor:pointer;letter-spacing:0.3px;">
      ✦ Aplică corecțiile AI
    </button>` : '';

  let el = document.getElementById('val-ai-validation');
  if (!el) {
    el = document.createElement('div');
    el.id = 'val-ai-validation';
    const grid = document.getElementById('val-results-grid');
    grid?.parentNode?.insertBefore(el, grid);
  }

  el.innerHTML = `
    <div style="margin-bottom:12px;padding:10px 13px;
                background:${vcColor}08;border:1px solid ${vcColor}33;border-radius:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-bottom:${hasCorr || issuesList ? '8px' : '0'};">
        <span style="font-size:11px;font-weight:700;color:${vcColor};">
          ${vcIcon} AI Validator — ${result.verdict || 'Verificat'}
        </span>
        <span style="font-size:9px;color:rgba(255,255,255,0.25);">claude-haiku · câmpurile rămân editabile</span>
      </div>
      ${hasCorr ? `
        <table style="border-collapse:collapse;width:auto;">
          <thead><tr>
            <th style="font-size:9px;color:rgba(255,255,255,0.3);font-weight:600;padding:0 8px 4px 0;text-align:left;">Câmp</th>
            <th style="font-size:9px;color:rgba(255,255,255,0.3);font-weight:600;padding:0 8px 4px;text-align:left;">Inițial (Yahoo)</th>
            <th style="font-size:9px;color:rgba(255,255,255,0.3);font-weight:600;padding:0 0 4px;text-align:left;">Sugerat AI</th>
          </tr></thead>
          <tbody>${diffRows}</tbody>
        </table>
        ${applyBtnHtml}` : '<div style="font-size:10.5px;color:rgba(255,255,255,0.4);">Toate valorile par corecte.</div>'}
      ${issuesList}
    </div>`;
}

// Aplica efectiv corectiile AI in campuri — pastreaza editabilitatea
window._applyAICorrections = function () {
  if (!_lastAIResult) return;
  const corrections = _lastAIResult.corrections || {};
  Object.entries(corrections).forEach(([id, corrected]) => {
    if (corrected == null) return;
    const dec = ['assets','cash','debt','shares'].includes(id) ? 0
              : ['growth','wacc','tgr','ltv','occupancy'].includes(id) ? 1 : 2;
    setValInput(id, corrected, dec);
  });
  // Feedback vizual pe buton
  const btn = document.getElementById('val-ai-apply-btn');
  if (btn) {
    btn.textContent = '✓ Aplicat — poți modifica în continuare';
    btn.style.color = '#a5d6a7';
    btn.style.borderColor = 'rgba(102,187,106,0.5)';
    btn.style.background  = 'rgba(102,187,106,0.08)';
    btn.disabled = true;
  }
  updateValuare();
};

// ── Handler buton Validare AI (apelat din HTML onclick) ──
window._runAIValidation = async function () {
  const btn = document.getElementById('val-ai-validate-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Validare AI...'; }

  const _sector   = $('val-sector')?.value || 'tech';
  const _priceEl  = $('val-current-price');
  const _price    = _priceEl ? parseFloat(_priceEl.dataset.price) : 0;
  const _currency = _priceEl ? (_priceEl.dataset.currency || 'USD') : 'USD';
  const _ticker   = document.getElementById('stock-ticker')?.textContent?.trim() || '';

  try {
    const result = await validateFundamentalsAI(_ticker, _sector, _currency, _price);
    applyAIValidation(result, _currency);
  } catch (err) {
    console.warn('[AI validation]', err.message);
    let el = document.getElementById('val-ai-validation');
    if (!el) { el = document.createElement('div'); el.id = 'val-ai-validation';
      document.getElementById('val-results-grid')?.parentNode?.insertBefore(el, document.getElementById('val-results-grid')); }
    el.innerHTML = `<div style="padding:8px 12px;border:1px solid rgba(239,83,80,0.3);border-radius:8px;
      font-size:10.5px;color:rgba(239,83,80,0.7);">⚠ AI validator indisponibil — ${err.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Validare AI'; }
  }
};

window.toggleValuare = function () {
  const content = $('val-content');
  const icon    = $('val-toggle-icon');
  if (!content || !icon) return;
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : 'block';
  icon.textContent = isOpen ? '▼ Extinde' : '▲ Restrânge';
};

// ── Context tehnic (MA60, drift, sigma) ──────────────
let _techCtx = {};

// ── Scor AI 0-100 (fundamental 60% + tehnic 40%) ─────
let _lastAIScore = null;
export function getLastAIScore() { return _lastAIScore; }

function calcAIScore(margin, deviationPct) {
  // Fund score din marja de siguranta fundamentala
  let fundScore = 50; // neutral daca nu avem date
  if (margin != null) {
    if      (margin > 30)  fundScore = 88;
    else if (margin > 20)  fundScore = 75;
    else if (margin > 10)  fundScore = 62;
    else if (margin > 0)   fundScore = 50;
    else if (margin > -10) fundScore = 37;
    else if (margin > -20) fundScore = 25;
    else                   fundScore = 12;
  }
  // Tech score din deviatia fata de MA60 (negativ = sub MA = bun)
  let techScore = 50; // neutral daca nu avem date
  if (deviationPct != null) {
    if      (deviationPct < -15) techScore = 90;
    else if (deviationPct <  -5) techScore = 72;
    else if (deviationPct <   5) techScore = 50;
    else if (deviationPct <  15) techScore = 30;
    else                         techScore = 12;
  }
  const total      = Math.round(fundScore * 0.6 + techScore * 0.4);
  const verdict    = total >= 70 ? 'BUY' : total >= 45 ? 'HOLD' : 'AVOID';
  const confidence = (total >= 75 || total <= 30) ? 'Ridicată' : 'Moderată';
  return { fundScore, techScore, total, verdict, confidence };
}

// ── Comentariu calitativ fundamental + tehnic ─────────

function ensureFundComment() {
  let el = document.getElementById('val-fundamental-comment');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'val-fundamental-comment';
  el.style.display = 'none';
  // Insereaza dupa val-results-grid (sau la finalul val-content)
  const grid = document.getElementById('val-results-grid');
  if (grid?.parentNode) grid.parentNode.appendChild(el);
  else document.getElementById('val-content')?.appendChild(el);
  return el;
}

function generateFundamentalComment(weighted, curPrice, margin, sym) {
  const { deviationPct, drift, sigma, mean50 } = _techCtx;
  const hasTech = deviationPct != null;

  // ── Scor AI ──────────────────────────────────────────
  const ai = calcAIScore(margin, hasTech ? deviationPct : null);
  _lastAIScore = ai;
  const vc = ai.verdict === 'BUY' ? '#66bb6a' : ai.verdict === 'HOLD' ? '#ffee58' : '#ef5350';
  const scoreBadgeHtml = `
    <div style="display:flex;align-items:center;gap:14px;padding:10px 14px;margin-bottom:10px;
                background:${vc}0f;border:1px solid ${vc}33;border-radius:10px;">
      <div style="text-align:center;min-width:52px;">
        <div style="font-size:30px;font-weight:800;color:${vc};line-height:1">${ai.total}</div>
        <div style="font-size:9px;color:rgba(255,255,255,0.35);letter-spacing:0.5px">/100</div>
      </div>
      <div>
        <div style="font-size:17px;font-weight:800;color:${vc};letter-spacing:1.5px">${ai.verdict}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:2px">Conf. ${ai.confidence}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.32);margin-top:1px">Fund ${ai.fundScore}/100 · Tehnic ${ai.techScore}/100</div>
      </div>
    </div>`;

  // ── Verdict fundamental ──────────────────────────────
  let fundLabel, fundColor, fundAdvice;
  if (weighted == null || curPrice <= 0) {
    fundLabel  = 'Valuare insuficientă';
    fundColor  = 'rgba(255,255,255,0.4)';
    fundAdvice = 'Completează câmpurile EPS/FCF/WACC pentru a calcula valuarea intrinsecă.';
  } else if (margin > 20) {
    fundLabel  = '✔ Subapreciată — potențial de creștere';
    fundColor  = '#66bb6a';
    fundAdvice = `Prețul curent (${sym}${curPrice.toFixed(2)}) este cu <strong style="color:#66bb6a">${margin.toFixed(1)}%</strong> sub valoarea fundamentală estimată (${sym}${weighted.toFixed(2)}). Compania pare <em>subapreciată</em> — un candidat solid dacă fundamentele sunt stabile.`;
  } else if (margin > 0) {
    fundLabel  = '≈ Corect evaluată';
    fundColor  = '#ffee58';
    fundAdvice = `Prețul curent (${sym}${curPrice.toFixed(2)}) este aproape de valoarea fundamentală estimată (${sym}${weighted.toFixed(2)}). Marja de siguranță este redusă (${margin.toFixed(1)}%) — intrarea depinde în mare măsură de timing-ul tehnic.`;
  } else {
    fundLabel  = '✘ Supraevaluată — risc la prețul curent';
    fundColor  = '#ef5350';
    fundAdvice = `Prețul curent (${sym}${curPrice.toFixed(2)}) depășește cu <strong style="color:#ef5350">${Math.abs(margin).toFixed(1)}%</strong> valoarea fundamentală estimată (${sym}${weighted.toFixed(2)}). Riscul de corecție este ridicat dacă așteptările de creștere nu se materializează.`;
  }

  // ── Timing tehnic ────────────────────────────────────
  let techHtml = '';
  if (hasTech) {
    const dev   = deviationPct;
    const sigAnn = (sigma ?? 0) * Math.sqrt(252) * 100;
    let techLabel, techColor, techAdvice;

    if (dev < -15) {
      techLabel  = '📉 Preț mult sub MA60 — zonă de acumulare';
      techColor  = '#66bb6a';
      techAdvice = `Prețul se află cu <strong style="color:#66bb6a">${Math.abs(dev).toFixed(1)}%</strong> sub media mobilă pe 60 de zile — semnal de <em>oversold</em>. Statistic, aceasta este o fereastră favorabilă de intrare pentru investitorii pe termen mediu/lung.`;
    } else if (dev < -5) {
      techLabel  = '📊 Preț ușor sub MA60 — condiții favorabile';
      techColor  = '#a5d6a7';
      techAdvice = `Prețul este cu ${Math.abs(dev).toFixed(1)}% sub MA60 — ușor corectat față de medie. Condiții tehnice favorabile pentru o intrare incrementală.`;
    } else if (dev <= 5) {
      techLabel  = '➡ Preț la MA60 — neutral tehnic';
      techColor  = '#ffee58';
      techAdvice = `Prețul se tranzacționează în jurul mediei mobile pe 60 de zile (±${Math.abs(dev).toFixed(1)}%). Nu există un semnal tehnic clar — intrarea e posibilă, dar fără avantaj de pricing față de tendința medie.`;
    } else if (dev <= 15) {
      techLabel  = '📈 Preț ușor peste MA60 — urmărește o corecție';
      techColor  = '#ffa726';
      techAdvice = `Prețul este cu ${dev.toFixed(1)}% peste MA60. Momentul tehnic nu e optim pentru o intrare nouă — ideal ar fi să aștepți o retragere spre medie sau spre un suport tehnic clar.`;
    } else {
      techLabel  = '🔺 Preț extins peste MA60 — evită intrarea acum';
      techColor  = '#ef5350';
      techAdvice = `Prețul este cu <strong style="color:#ef5350">${dev.toFixed(1)}%</strong> peste MA60 — extins tehnic. Intrarea acum crește riscul de a cumpăra la vârf local. Strategia recomandată: <em>așteaptă o corecție semnificativă</em>.`;
    }

    // ── Pret de intrare sugerat ──────────────────────────
    let entryPriceHtml = '';
    if (curPrice > 0 && mean50 != null && mean50 > 0) {
      const entryMA     = mean50;                          // MA60 = entry tehnic ideal
      const entryFund   = weighted != null ? Math.min(weighted * 0.97, curPrice * 0.93) : null; // -3% sub fundamental
      const bestEntry   = entryFund != null
        ? Math.min(entryMA, entryFund)
        : entryMA;
      const discountPct = ((curPrice - bestEntry) / curPrice * 100).toFixed(1);
      if (bestEntry < curPrice) {
        entryPriceHtml = `
          <div class="vfc-entry-box">
            <strong>🎯 Preț țintă de intrare</strong>
            Zona favorabilă: <span style="color:#66bb6a;font-weight:700">${sym}${bestEntry.toFixed(2)}</span>
            ${entryFund != null ? ` &nbsp;·&nbsp; MA60: ${sym}${entryMA.toFixed(2)} &nbsp;·&nbsp; −3% sub fundamental: ${sym}${entryFund.toFixed(2)}` : `&nbsp;·&nbsp; (MA60)`}
            <span style="color:#ffa726"> ≈ −${discountPct}% față de prețul actual</span>
          </div>`;
      }
    }

    techHtml = `
      <div class="vfc-row" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.07)">
        <span style="color:${techColor};font-weight:600">${techLabel}</span><br>
        <span style="color:rgba(255,255,255,0.75)">${techAdvice}</span>
        ${entryPriceHtml}
      </div>
      <div class="vfc-row" style="margin-top:6px;font-size:10px;color:rgba(255,255,255,0.4)">
        Strategie: alegi compania după <em>fundamentale</em>, intri tehnic când prețul e jos — MA60 deviere ${dev >= 0 ? '+' : ''}${dev.toFixed(1)}% · vol ${sigAnn.toFixed(0)}%/an
      </div>`;
  }

  return `
    ${scoreBadgeHtml}
    <div class="vfc-title">📋 Analiză Fundamentală + Timing Tehnic</div>
    <div class="vfc-row">
      <span style="color:${fundColor};font-weight:600">${fundLabel}</span>
    </div>
    <div class="vfc-row" style="color:rgba(255,255,255,0.8)">${fundAdvice}</div>
    ${techHtml}`;
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

// ── Initializeaza panelul + fetch date fundamentale ───

export function initValuarePanel(currentPrice, currency, yahooSector, ticker, metaFundamentals = {}, technicalCtx = {}) {
  _techCtx = technicalCtx;
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

  if (yahooSector && YAHOO_TO_VAL_SECTOR[yahooSector]) {
    const sel = $('val-sector');
    if (sel) sel.value = YAHOO_TO_VAL_SECTOR[yahooSector];
  }

  if (!panel.dataset.listenersAttached) {
    ['sector','eps','pe','fcf','growth','wacc','tgr','assets','cash','debt','shares','ltv','occupancy','dividend'].forEach(id => {
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
    statusEl.textContent = `✔ EPS + P/E din chart API · se descarcă FCF, cash, datorii...`;
    statusEl.style.color = 'rgba(102,187,106,0.55)';
  } else {
    statusEl.textContent = '⏳ Se descarcă date fundamentale...';
    statusEl.style.color = 'rgba(255,255,255,0.4)';
  }
  updateValuare();

  if (!ticker) return;
  fetchValuationFundamentals(ticker).then(d => {
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
    setValInput('debt',   d.debt,        0);
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

    // Arata butonul de validare AI dupa ce datele sunt incarcate
    const aiBtnEl = $('val-ai-validate-btn');
    if (aiBtnEl) aiBtnEl.style.display = 'inline-flex';
  }).catch(err => {
    const msg = metaPopulated > 0
      ? '⚠ FCF/cash/datorii indisponibile — completează manual'
      : '⚠ Date fundamentale indisponibile — completează manual';
    statusEl.textContent = msg;
    statusEl.style.color = 'rgba(255,167,38,0.6)';
    console.warn('Val fetch error:', err);
  });
}

// ── Comentariu calitativ bazat pe toti coeficientii ───

export function generateQualityComment({ sigma, volAnualPct, nu, garch, drift, deviationPct, volumeTrend, ivData, ivEstimated }) {
  const parts = [];

  // ── 1. Profil de risc ────────────────────────────────
  const riskLabel = volAnualPct < 15 ? 'foarte scazut'
                  : volAnualPct < 25 ? 'scazut'
                  : volAnualPct < 40 ? 'mediu'
                  : volAnualPct < 65 ? 'ridicat'
                  :                    'speculativ';
  const tailNote  = nu < 5  ? ', cozi f. groase — crash-uri posibile'
                  : nu < 8  ? ', cozi groase — risc de socuri extreme'
                  : nu < 15 ? ', cozi moderate'
                  :            '';
  const riskColor = volAnualPct < 25 ? '#66bb6a' : volAnualPct < 45 ? '#ffee58' : '#ef5350';
  parts.push(`<span style="color:${riskColor};font-weight:600;">Risc ${riskLabel}</span> · Vol ${volAnualPct.toFixed(0)}%/an${tailNote}.`);

  // ── 2. Regim GARCH ───────────────────────────────────
  if (garch) {
    const ratio    = garch.sigma0 / garch.sigmaLR;
    const regime   = ratio < 0.80 ? 'Piata calma — volatilitate sub medie istorica'
                   : ratio < 1.10 ? 'Volatilitate in regim normal'
                   : ratio < 1.40 ? 'Piata agitata — volatilitate peste medie'
                   :                'Regim de stres — volatilitate ridicata';
    const persNote = garch.persistence > 0.95 ? ', clustere de risc persistente (reversia e lenta)'
                   : garch.persistence > 0.90 ? ', volatilitate moderat persistenta'
                   : '';
    parts.push(`${regime}${persNote}.`);
  }

  // ── 3. Trend pret + volum ────────────────────────────
  const driftStr = drift > 0.0003  ? 'drift pozitiv puternic'
                 : drift > 0.0001  ? 'drift pozitiv'
                 : drift < -0.0003 ? 'drift negativ puternic'
                 : drift < -0.0001 ? 'drift negativ'
                 :                   'drift neutru';
  const maStr    = deviationPct > 12  ? `pret cu ${deviationPct.toFixed(0)}% peste MA60`
                 : deviationPct < -12 ? `pret cu ${Math.abs(deviationPct).toFixed(0)}% sub MA60`
                 :                      'pret aproape de MA60';
  const vtDetail = volumeTrend?.detail ?? '';
  const vtStr    = vtDetail === 'bullish'       ? ', volum confirma cresterea'
                 : vtDetail === 'bearish'       ? ', volum confirma scaderea'
                 : vtDetail.includes('bullish') ? ', divergenta bullish la volum'
                 : vtDetail.includes('bearish') ? ', divergenta bearish la volum'
                 :                                '';
  parts.push(`Tendinta: ${driftStr}, ${maStr}${vtStr}.`);

  // ── 4. Semnalul optiunilor / IV ──────────────────────
  if (ivData) {
    const ivRatio  = ivData.ivDaily / sigma;
    const ivStr    = ivRatio < 0.85 ? 'Piata nu anticipeaza miscari majore (IV redus)'
                   : ivRatio < 1.20 ? 'Risc anticipat in linie cu trecutul'
                   : ivRatio < 1.60 ? 'Piata pretinde miscare importanta (IV ridicat)'
                   :                  'Tensiune maxima — eveniment major posibil';
    const skew     = ivData.skewData?.skew;
    const skewStr  = skew == null    ? ''
                   : skew > 0.15     ? ', put-uri scumpe — teama puternica de scadere'
                   : skew > 0.07     ? ', skew normal bearish'
                   : skew < 0        ? ', call-uri mai scumpe — sentiment bullish in optiuni'
                   :                   ', skew echilibrat';
    const estStr   = ivEstimated ? ' <span style="opacity:0.5">(estimat din VIX)</span>' : '';
    parts.push(`${ivStr}${skewStr}${estStr}.`);
  }

  return parts.join('<br>');
}
