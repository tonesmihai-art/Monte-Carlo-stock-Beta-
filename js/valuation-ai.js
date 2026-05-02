// ─────────────────────────────────────────────────────
//  VALUATION-AI.JS — Validare AI fundamentale prin proxy
//                    + modal parolă + aplicare corecții
// ─────────────────────────────────────────────────────

import { $ }                          from './ui.js';
import { setValInput, updateValuare } from './valuation-core.js';

// ── Validare AI prin proxy ────────────────────────────

const MY_PROXY_VAL = 'https://monte-carlo-proxy.onrender.com';

export async function validateFundamentalsAI(ticker, sector, currency, currentPrice, provider = 'claude') {
  const getNum = id => { const v = parseFloat($(`val-${id}`)?.value); return isNaN(v) ? null : v; };
  const fields = {
    eps:       getNum('eps'),
    pe:        getNum('pe'),
    fcf:       getNum('fcf'),
    growth:    getNum('growth'),
    wacc:      getNum('wacc'),
    assets:    getNum('assets'),
    cash:      getNum('cash'),
    totalLiabilities: getNum('totalLiabilities'),
    shares:    getNum('shares'),
    ltv:       getNum('ltv'),
    occupancy: getNum('occupancy'),
    dividend:  getNum('dividend'),
  };

  const resp = await fetch(`${MY_PROXY_VAL}/validate-fundamentals`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ticker, sector, currency, currentPrice, fields, provider }),
  });
  if (!resp.ok) {
    let detail = `Proxy error ${resp.status}`;
    try { const j = await resp.json(); detail = j.detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return resp.json();
}

// ── Aplica corectiile AI si afiseaza panelul de diff ──

// Stocheaza ultimul rezultat AI pentru butonul de aplicare
let _lastAIResult   = null;
let _lastAICurrency = null;

// Config vizual per provider
const _PROVIDER_CFG = {
  claude:  { label: 'Claude Haiku',          accent: '#4fc3f7', icon: '◆' },
  gemini:  { label: 'Gemini 2.5 Flash-Lite', accent: '#b39ddb', icon: '✦' },
};

export function applyAIValidation(result, currency) {
  // provider vine din raspunsul proxy (_provider) sau fallback 'claude'
  const provider = result._provider || 'claude';
  _lastAIResult   = result;
  _lastAICurrency = currency;

  const sym    = currency === 'USD' ? '$' : currency + ' ';
  const getNum = id => { const v = parseFloat($(`val-${id}`)?.value); return isNaN(v) ? null : v; };
  const fmtV   = (v, id) => {
    const dec = ['assets','cash','totalLiabilities','shares'].includes(id) ? 0
              : ['growth','wacc','tgr','ltv','occupancy'].includes(id) ? 1 : 2;
    const num = typeof v === 'number' ? v : parseFloat(v);
    return !isNaN(num) ? num.toFixed(dec) : '—';
  };

  const LABELS = {
    eps:'EPS', pe:'P/E', fcf:'FCF/acț', growth:'Creștere %',
    wacc:'WACC %', assets:'Active T', cash:'Cash M', totalLiabilities:'Pasive totale M',
    ltv:'LTV %', dividend:'Dividend', shares:'Acțiuni M',
  };

  const corrections = result.corrections || {};
  const rows = Object.entries(corrections)
    .filter(([, v]) => v != null)
    .map(([id, corrected]) => {
      const original = getNum(id);
      // coercim la număr — AI poate returna string ("0.42") sau număr
      const corrNum = typeof corrected === 'number' ? corrected : parseFloat(corrected);
      return { id, label: LABELS[id] || id, original, corrected: isNaN(corrNum) ? null : corrNum };
    })
    .filter(r => r.corrected != null); // elimina orice valoare non-numerica

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
        <span style="font-size:9px;color:rgba(255,255,255,0.25);">${(_PROVIDER_CFG[provider]||_PROVIDER_CFG.claude).label} · câmpurile rămân editabile</span>
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
    const dec = ['assets','cash','totalLiabilities','shares'].includes(id) ? 0
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

// ── Parola AI Validator (SHA-256 encoded) ─────────────
// Ca sa schimbi parola: calculeaza SHA-256 al noii parole si inlocuieste hash-ul de mai jos
// ex: echo -n "noua_parola" | sha256sum
const _AI_PASS_HASH = '81a83544cf93c245178cbc1620030f1123f435af867c79d87135983c52ab39d9';

async function _sha256(text) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _showPasswordModal() {
  return new Promise(resolve => {
    // Overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;`;

    overlay.innerHTML = `
      <div style="background:#12121f;border:1px solid rgba(79,195,247,0.35);border-radius:14px;
                  padding:28px 32px;width:320px;box-shadow:0 12px 40px rgba(0,0,0,0.7);">
        <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;
                    color:#4fc3f7;margin-bottom:6px;">🔒 Validare AI</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:18px;
                    letter-spacing:0.3px;">Introdu parola pentru a activa validarea AI</div>
        <input id="_ai-pass-input" type="password" placeholder="Parolă"
          style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(79,195,247,0.3);
                 border-radius:8px;padding:10px 14px;color:#e0e0e0;font-size:13px;
                 font-family:'Space Mono',monospace;outline:none;letter-spacing:2px;
                 margin-bottom:10px;" />
        <div id="_ai-pass-err" style="font-size:10.5px;color:#ef5350;min-height:16px;
                                       margin-bottom:10px;display:none;">
          ✘ Parolă incorectă
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="_ai-pass-cancel"
            style="padding:7px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);
                   background:transparent;color:rgba(255,255,255,0.4);font-size:11px;cursor:pointer;">
            Anulează
          </button>
          <button id="_ai-pass-ok"
            style="padding:7px 18px;border-radius:8px;border:none;
                   background:linear-gradient(135deg,#4fc3f7,#7c6af7);
                   color:#fff;font-size:11px;font-weight:700;cursor:pointer;">
            Confirmă
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const input  = overlay.querySelector('#_ai-pass-input');
    const errEl  = overlay.querySelector('#_ai-pass-err');
    const btnOk  = overlay.querySelector('#_ai-pass-ok');
    const btnCan = overlay.querySelector('#_ai-pass-cancel');

    input.focus();

    async function trySubmit() {
      const hash = await _sha256(input.value);
      if (hash === _AI_PASS_HASH) {
        overlay.remove();
        resolve(true);
      } else {
        errEl.style.display = 'block';
        input.value = '';
        input.style.borderColor = 'rgba(239,83,80,0.6)';
        input.focus();
        setTimeout(() => { input.style.borderColor = 'rgba(79,195,247,0.3)'; }, 1200);
      }
    }

    btnOk.addEventListener('click', trySubmit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') trySubmit(); });
    btnCan.addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

// ── Handler generic pentru orice provider ────────────
async function _runValidation(provider) {
  // Parola doar pentru Claude — Gemini e free, nu necesita autentificare
  if (provider !== 'gemini') {
    const ok = await _showPasswordModal();
    if (!ok) return;
  }

  const cfg     = _PROVIDER_CFG[provider] || _PROVIDER_CFG.claude;
  const btnId   = provider === 'gemini' ? 'val-gemini-validate-btn' : 'val-ai-validate-btn';
  const btn     = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Se validează...'; }

  const _sector   = $('val-sector')?.value || 'tech';
  const _priceEl  = $('val-current-price');
  const _price    = _priceEl ? parseFloat(_priceEl.dataset.price) : 0;
  const _currency = _priceEl ? (_priceEl.dataset.currency || 'USD') : 'USD';
  const _ticker   = document.getElementById('stock-ticker')?.textContent?.trim() || '';

  try {
    const result = await validateFundamentalsAI(_ticker, _sector, _currency, _price, provider);
    applyAIValidation(result, _currency);
  } catch (err) {
    console.warn(`[AI validation / ${provider}]`, err.message);
    let el = document.getElementById('val-ai-validation');
    if (!el) {
      el = document.createElement('div');
      el.id = 'val-ai-validation';
      document.getElementById('val-results-grid')?.parentNode
        ?.insertBefore(el, document.getElementById('val-results-grid'));
    }
    el.innerHTML = `<div style="padding:8px 12px;border:1px solid rgba(239,83,80,0.3);border-radius:8px;
      font-size:10.5px;color:rgba(239,83,80,0.7);">⚠ ${cfg.label} indisponibil — ${err.message}</div>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = provider === 'gemini' ? `${cfg.icon} Gemini` : `${cfg.icon} Claude`;
    }
  }
}

// ── Handlere publice ──────────────────────────────────
window._runAIValidation     = () => _runValidation('claude');
window._runGeminiValidation = () => _runValidation('gemini');

window.toggleValuare = function () {
  const content = $('val-content');
  const icon    = $('val-toggle-icon');
  if (!content || !icon) return;
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : 'block';
  icon.textContent = isOpen ? '▼ Extinde' : '▲ Restrânge';
};
