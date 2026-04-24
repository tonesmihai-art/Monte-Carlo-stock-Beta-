// ─────────────────────────────────────────────────────
//  UI.JS — Helpers DOM, pills, status, grafice perioada
// ─────────────────────────────────────────────────────

import { drawTrajectories, drawHistogram } from './charts.js';
import { NUM_SIMS } from './montecarlo.js';

// Shortcut getElementById — exportat ca sa fie reutilizat in toate modulele
export const $ = id => document.getElementById(id);

// ── Formatare numere ─────────────────────────────────

export function fmt(n, dec = 2) {
  return n == null ? '—' : n.toLocaleString('en-US', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  });
}

// ── Status bar ───────────────────────────────────────

export function setStatus(msg, type = 'info') {
  const el = $('status');
  el.textContent   = msg;
  el.className     = `status status--${type}`;
  el.style.display = msg ? 'block' : 'none';
}

// ── Navigatie sectiuni ────────────────────────────────

export function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  $(id)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.section === id));
}

// ── Pills cu culori dinamice ─────────────────────────

export const PILL_COLORS = {
  green:  'pill--green',
  yellow: 'pill--yellow',
  orange: 'pill--orange',
  red:    'pill--red',
  gray:   'pill--gray',
  purple: 'pill--purple',
};

export function setPillColor(pillId, color) {
  const el = document.getElementById(pillId);
  if (!el) return;
  Object.values(PILL_COLORS).forEach(c => el.classList.remove(c));
  if (color && PILL_COLORS[color]) el.classList.add(PILL_COLORS[color]);
}

// ── Sector + VIX badge ───────────────────────────────

export function renderSectorBadge(sector, industry, vixData, weights) {
  const el = $('sector-badge');
  if (!el) return;
  const emoji    = weights?.emoji || '📊';
  const vixColor = !vixData?.vix    ? '#888'
                 : vixData.vix < 15 ? '#66bb6a'
                 : vixData.vix < 25 ? '#ffee58'
                 : vixData.vix < 35 ? '#ffa726'
                 : '#ef5350';

  const vixImpactDesc = !vixData?.vix
    ? 'Date VIX indisponibile.'
    : vixData.vix < 15
      ? 'Piata <strong style="color:#66bb6a">calma</strong> — sigma neschimbata in simulare.'
      : vixData.vix < 25
        ? 'Volatilitate <strong style="color:#ffee58">normala</strong> — impact redus asupra sigmei.'
        : vixData.vix < 35
          ? 'Volatilitate <strong style="color:#ffa726">ridicata</strong> — sigma creste +20% in simulare.'
          : 'Piata in <strong style="color:#ef5350">panica</strong> — sigma creste +40% in simulare.';

  el.innerHTML = `
    <span class="tip-wrap">
      <span class="sector-chip">${emoji} ${sector}</span>
      <i class="tip-icon" style="border-color:rgba(79,195,247,0.4)">i</i>
      <div class="tip-bubble">
        <strong>🏭 Sector — ${sector}</strong>
        ${industry ? `<em style="color:#aaa;font-size:10px">${industry}</em><br><br>` : ''}
        Sectorul determina <b>ponderile</b> celor 7 factori de sentiment. Fiecare sector amplifica factorii cei mai relevanti:
        <div class="tip-scale" style="margin-top:6px">
          <div class="tip-scale-row"><span class="tip-dot" style="background:#4fc3f7"></span> Energy → geopolitica + tarife</div>
          <div class="tip-scale-row"><span class="tip-dot" style="background:#ce93d8"></span> Technology → reglementari + inovatie</div>
          <div class="tip-scale-row"><span class="tip-dot" style="background:#ffcc02"></span> Financial → macro + dobânzi</div>
        </div>
        <span class="tip-impact">Influenteaza: ponderile sentimentului AI</span>
      </div>
    </span>
    <span class="tip-wrap">
      <span class="vix-chip" style="color:${vixColor}">
        VIX: ${vixData?.vix ?? 'N/A'} ${vixData?.vixLabel ?? ''}
      </span>
      <i class="tip-icon" style="border-color:${vixColor};color:${vixColor};background:transparent">i</i>
      <div class="tip-bubble">
        <strong>😱 VIX — Indicele fricii pietei</strong>
        Masoara volatilitatea <em>implicita</em> asteptata de piata pe urmatoarele 30 de zile. Cu cat e mai mare, cu atat piata anticipeaza miscari bruste.
        <div class="tip-scale" style="margin-top:6px">
          <div class="tip-scale-row"><span class="tip-dot" style="background:#66bb6a"></span> &lt; 15 — piata calma, sigma normala</div>
          <div class="tip-scale-row"><span class="tip-dot" style="background:#ffee58"></span> 15–25 — normal, impact minor</div>
          <div class="tip-scale-row"><span class="tip-dot" style="background:#ffa726"></span> 25–35 — ingrijorare, sigma +20%</div>
          <div class="tip-scale-row"><span class="tip-dot" style="background:#ef5350"></span> &gt; 35 — panica, sigma +40%</div>
        </div>
        <div style="margin-top:6px;font-size:10.5px">${vixImpactDesc}</div>
        <span class="tip-impact">Influenteaza: sigma in simulare</span>
      </div>
    </span>
  `;
  el.style.display = 'flex';
}

// ── Tabel statistici ─────────────────────────────────

export function renderStatsCard(stats, statsAdj, currentPrice, days, currency) {
  const sym = currency === 'USD' ? '$' : currency + ' ';
  function row(label, valC, valA, color) {
    return `<tr>
      <td class="stat-label">${label}</td>
      <td class="stat-val" style="color:${color || '#fff'}">${sym}${fmt(valC)}</td>
      ${valA != null ? `<td class="stat-val ai-col">${sym}${fmt(valA)}</td>` : `<td class="stat-val ai-col">—</td>`}
    </tr>`;
  }
  function pctRow(label, valC, valA, color) {
    return `<tr>
      <td class="stat-label">${label}</td>
      <td class="stat-val" style="color:${color || '#fff'}">${fmt(valC, 1)}%</td>
      ${valA != null ? `<td class="stat-val ai-col">${fmt(valA, 1)}%</td>` : `<td class="stat-val ai-col">—</td>`}
    </tr>`;
  }
  return `
    <div class="stats-card">
      <div class="stats-title">Statistici — ${days} zile</div>
      <table class="stats-table">
        <thead><tr><th></th><th style="color:#4fc3f7">Clasic</th><th style="color:#ffa726">AI Ajustat</th></tr></thead>
        <tbody>
          <tr><td colspan="3" class="stat-sep">Preturi estimate</td></tr>
          ${row('Pret curent',    currentPrice,  null,            '#fff')}
          ${row('Medie',          stats.mean,    statsAdj?.mean,  '#ffee58')}
          ${row('Median',         stats.median,  statsAdj?.median,'#fff')}
          ${row('P90 — optimist', stats.p90,     statsAdj?.p90,   '#66bb6a')}
          ${row('P10 — pesimist', stats.p10,     statsAdj?.p10,   '#ef5350')}
          ${row('Max simulat',    stats.max,     statsAdj?.max,   '#4fc3f7')}
          ${row('Min simulat',    stats.min,     statsAdj?.min,   '#4fc3f7')}
          <tr><td colspan="3" class="stat-sep">Probabilitati</td></tr>
          ${pctRow('Prob. profit',     stats.probProfit, statsAdj?.probProfit, '#66bb6a')}
          ${pctRow('Prob. gain > 10%', stats.probGain10, statsAdj?.probGain10, '#66bb6a')}
          ${pctRow('Prob. loss > 10%', stats.probLoss10, statsAdj?.probLoss10, '#ef5350')}
        </tbody>
      </table>
      <div class="stats-footer">${NUM_SIMS.toLocaleString()} simulari GBM</div>
    </div>`;
}

// ── Randeaza rezultatele pentru o perioada ────────────

export function renderPeriod(periodData) {
  const { stats, statsAdj, percs, percsAdj, days, currentPrice, currency, ticker } = periodData;
  const canvasTraj = `traj-${days}`;
  const canvasHist = `hist-${days}`;
  $('chart-area').innerHTML = `
    <div class="chart-grid">
      <div class="chart-box">
        <div class="chart-label">Traiectorii simulate — ${days} zile</div>
        <div class="canvas-wrap"><canvas id="${canvasTraj}"></canvas></div>
      </div>
      <div class="chart-box">
        <div class="chart-label">Distributia preturilor finale — ${days} zile</div>
        <div class="canvas-wrap"><canvas id="${canvasHist}"></canvas></div>
      </div>
    </div>
    ${renderStatsCard(stats, statsAdj, currentPrice, days, currency)}
  `;
  requestAnimationFrame(() => {
    drawTrajectories(canvasTraj, percs, percsAdj, days, currentPrice, ticker);
    drawHistogram(canvasHist, stats, statsAdj, currentPrice, days);
  });
}
