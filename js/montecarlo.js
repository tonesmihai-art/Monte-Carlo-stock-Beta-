// ─────────────────────────────────────────────────────
//  MONTE CARLO — GBM + GARCH(1,1) + Fat Tails (Student-t)
//  pret_nou = pret_vechi * exp(drift + sigma_t * Z_t)
//  sigma_t  : GARCH(1,1) — volatilitate variabila in timp
//  Z_t      : Student-t(ν) — cozi groase (crashuri mai realiste)
//  + Mean Reversion (Ornstein-Uhlenbeck) pe 50 de zile
// ─────────────────────────────────────────────────────

const NUM_SIMS = 30_000;

// ── Box-Muller: distributie normala N(0,1) ────────────
function randNormal() {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  do { v = Math.random(); } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Student-t(ν) scalat la varianta unitara ───────────
//
//  De ce Student-t?
//  Distributia normala subestimeaza dramatic evenimentele extreme:
//  un crash de -5σ are probabilitate 1 in 3.5 milioane zile sub gaussiana,
//  dar se intampla in realitate de cateva ori pe deceniu.
//  Student-t cu ν mic (3-6) produce cozi groase fara a modifica
//  media sau volatilitatea generala a simularii.
//
//  Metoda eficienta (fara a genera ν numere normale):
//  - Z  ~ N(0,1)  prin Box-Muller
//  - χ²(ν) generat din ν/2 valori Uniforme: -2·log(U) ~ χ²(2)
//  - T  = Z / √(χ²/ν), scalat la varianta 1: ×√((ν-2)/ν)
//
function randStudentT(nu) {
  const z    = randNormal();
  const half = Math.floor(nu / 2);

  // χ²(2k) = -2 · Σ log(Ui), Ui ~ Uniform(0,1)  → O(ν/2) random() calls
  let chi2 = 0;
  for (let i = 0; i < half; i++) {
    let u;
    do { u = Math.random(); } while (u === 0);
    chi2 -= 2 * Math.log(u);                    // fiecare termen ~ χ²(2)
  }
  if (nu % 2 !== 0) {                           // ν impar: adauga un χ²(1)
    const w = randNormal();
    chi2   += w * w;
  }

  // Scalare la varianta unitara: E[T²] = ν/(ν-2), deci impartim la √(ν/(ν-2))
  return z / Math.sqrt(chi2 / nu) * Math.sqrt((nu - 2) / nu);
}

// ── Estimare ν (grade libertate) din date istorice ───
//
//  Excess kurtosis al distributiei Student-t(ν) = 6/(ν-4) pentru ν>4
//  Inversand: ν = 6/kurtosis + 4
//
//  Interpretare practica:
//   ν = 3-4 : cozi foarte groase (crypto, penny stocks)
//   ν = 4-6 : actiuni volatile (TSLA, NVDA)
//   ν = 6-10: actiuni normale (MSFT, OMV)
//   ν > 20  : practic normal (indici diversificati)
//
export function estimateNu(logReturns) {
  const n    = logReturns.length;
  if (n < 30) return 8; // fallback rezonabil

  const mean = logReturns.reduce((a, b) => a + b, 0) / n;
  const res  = logReturns.map(r => r - mean);

  const variance = res.reduce((s, r) => s + r * r, 0) / n;
  if (variance === 0) return 8;

  // Kurtosis in exces (kurtosis normala = 3, deci scadem 3)
  const kurtosis = res.reduce((s, r) => s + r ** 4, 0) / (n * variance ** 2) - 3;

  // ν din kurtosis; clampit la [3, 30]
  let nu;
  if (kurtosis <= 0.1) {
    nu = 30;                       // distributie practic normala
  } else {
    nu = 6 / kurtosis + 4;
  }
  return +Math.max(3, Math.min(30, nu)).toFixed(1);
}

// ── GARCH(1,1) — estimare parametri din date istorice ──
//
//  Modelul: σ²(t) = ω + α·ε²(t-1) + β·σ²(t-1)
//  unde ε(t) = σ(t)·Z(t) este socul de la pasul anterior
//
//  α (alpha) — cat de mult influenteaza un soc recent volatilitatea
//  β (beta)  — cat de persistenta e volatilitatea (memory)
//  ω (omega) — ancora spre varianta pe termen lung
//  α + β < 1 garanteaza stabilitatea modelului
//
export function estimateGARCH(logReturns) {
  const n = logReturns.length;
  if (n < 50) return null; // date insuficiente

  const mean = logReturns.reduce((a, b) => a + b, 0) / n;
  const res  = logReturns.map(r => r - mean);
  const res2 = res.map(r => r * r); // randamente patrate

  // Varianta pe termen lung (unconditional variance)
  const varLR = res2.reduce((a, b) => a + b, 0) / n;

  // Autocorelatia randamentelor patrate la lag 1
  // Teoretic: ρ₁ ≈ α + β pentru GARCH(1,1)
  const meanR2 = varLR;
  let cov1 = 0;
  let var2  = 0;
  for (let i = 1; i < n; i++) {
    cov1 += (res2[i] - meanR2) * (res2[i - 1] - meanR2);
    var2 += (res2[i] - meanR2) ** 2;
  }
  cov1 /= (n - 1);
  var2 /= n;
  const rho1 = var2 > 1e-20 ? cov1 / Math.sqrt(var2 * var2) : 0.85;

  // Persistenta (α+β): clampata la intervalul realist [0.70, 0.98]
  const persistence = Math.max(0.70, Math.min(0.98, Math.abs(rho1)));

  // Impartim persistenta intre α si β
  // α tipic 0.05-0.15 pentru actiuni; β = persistenta - α
  const alpha = Math.max(0.04, Math.min(0.15, (1 - persistence) * 0.65));
  const beta  = Math.max(0.55, persistence - alpha);

  // ω ancorat la varianta pe termen lung
  const omega = Math.max(varLR * (1 - alpha - beta), 1e-12);

  // Filtram GARCH pe ultimele 60 de zile pentru a obtine σ² initial realist
  // (capteaza daca suntem intr-un regim de volatilitate ridicata sau calma)
  let varCurrent = varLR;
  const startIdx = Math.max(1, n - 60);
  for (let i = startIdx; i < n; i++) {
    varCurrent = omega + alpha * res[i - 1] * res[i - 1] + beta * varCurrent;
  }
  varCurrent = Math.max(varCurrent, omega / (1 - beta)); // floor rezonabil

  return {
    alpha:       +alpha.toFixed(5),
    beta:        +beta.toFixed(5),
    omega,
    sigma0:      Math.sqrt(varCurrent),      // volatilitatea CONDITIONATA actuala
    sigmaLR:     Math.sqrt(varLR),           // volatilitatea pe termen lung
    persistence: +(alpha + beta).toFixed(4), // cat de "lipicioasa" e volatilitatea
  };
}

// Calculeaza drift, sigma si media pe 50 de zile din preturile istorice
export function calcParams(closes, volumes = []) {
  const logReturns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  const n        = logReturns.length;
  const mean     = logReturns.reduce((a, b) => a + b, 0) / n;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const sigma    = Math.sqrt(variance);
  const drift    = mean - variance / 2;

  // Media preturilor pe ultimele 50 de zile
  const last50       = closes.slice(-50);
  const mean50       = last50.reduce((a, b) => a + b, 0) / last50.length;
  const currentPrice = closes[closes.length - 1];
  const deviationPct = ((currentPrice - mean50) / mean50) * 100;

  // Volume Trend
  const volumeTrend = calcVolumeTrend(closes, volumes);

  // Estimare GARCH(1,1) din randamentele istorice
  const garch = estimateGARCH(logReturns);

  // Estimare ν (grade libertate Student-t) din kurtosis
  const nu = estimateNu(logReturns);

  return { drift, sigma, mean, variance, mean50, deviationPct, volumeTrend, garch, nu };
}

// Calculeaza trendul de volum pe ultimele 10 zile
function calcVolumeTrend(closes, volumes) {
  if (!volumes || volumes.length < 20) {
    return { score: 0, label: 'N/A', detail: 'date insuficiente' };
  }
  const n    = Math.min(10, closes.length - 1);
  const vols = volumes.filter(v => v != null && v > 0);
  if (vols.length < 20) return { score: 0, label: 'N/A', detail: 'volum indisponibil' };

  const recentVols   = vols.slice(-n);
  const avgVol30     = vols.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, vols.length);
  const recentCloses = closes.slice(-n);
  const priceUp      = recentCloses[recentCloses.length - 1] > recentCloses[0];
  const avgRecentVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
  const volRatio     = avgRecentVol / avgVol30;

  let score = 0, label = '', detail = '';

  if (priceUp && volRatio > 1.1) {
    score  = Math.min(0.3, (volRatio - 1) * 0.5);
    label  = `📈 Trend confirmat (+${((volRatio-1)*100).toFixed(0)}% vol)`;
    detail = 'bullish';
  } else if (priceUp && volRatio < 0.9) {
    score  = -Math.min(0.15, (1 - volRatio) * 0.3);
    label  = `⚠️ Trend slab (vol -${((1-volRatio)*100).toFixed(0)}%)`;
    detail = 'divergenta bearish';
  } else if (!priceUp && volRatio > 1.1) {
    score  = -Math.min(0.3, (volRatio - 1) * 0.5);
    label  = `📉 Vanzare confirmata (+${((volRatio-1)*100).toFixed(0)}% vol)`;
    detail = 'bearish';
  } else if (!priceUp && volRatio < 0.9) {
    score  = Math.min(0.1, (1 - volRatio) * 0.2);
    label  = `🔄 Corectie slaba (vol -${((1-volRatio)*100).toFixed(0)}%)`;
    detail = 'divergenta bullish';
  } else {
    score  = 0;
    label  = '➡️ Neutral';
    detail = 'neutru';
  }
  return { score: +score.toFixed(3), label, detail, volRatio: +volRatio.toFixed(2) };
}

// ── Simulare GBM + GARCH(1,1) + Mean Reversion ────────
//
//  Fiecare simulare are propria sa volatilitate σ_t care evolueaza
//  conform GARCH(1,1) — socurile mari din trecut cresc volatilitatea
//  urmatoare, iar efectul dispare treptat cu ritmul β.
//
//  Daca garchParams = null, revenim la sigma constanta (GBM clasic).
//
export function simulate(currentPrice, drift, sigma, days,
                          driftAdj    = null,
                          sigmaAdj    = null,
                          meanRevStrength = 0,
                          mean50      = null,
                          garchParams = null,
                          nu          = null) {

  const d      = driftAdj ?? drift;
  const sBase  = sigmaAdj ?? sigma;
  const target = mean50 ?? currentPrice;
  const matrix = new Float64Array((days + 1) * NUM_SIMS);

  // Alege generatorul de socuri: Student-t(ν) sau Normal
  // ν < 29 => fat tails; ν >= 29 => practic normal (economie de calcul)
  const useFatTails = nu != null && nu < 29;
  const nuInt = useFatTails ? Math.max(3, Math.min(30, Math.round(nu))) : null;
  const randShock = useFatTails
    ? () => randStudentT(nuInt)
    : randNormal;

  // Pretul initial identic pentru toate simulatiile
  for (let sim = 0; sim < NUM_SIMS; sim++) matrix[sim] = currentPrice;

  if (garchParams) {
    // ── Simulare cu GARCH(1,1) + Fat Tails ──────────────
    //  σ²_t = ω + α·ε²_(t-1) + β·σ²_(t-1)
    //
    //  Fiecare simulare porneste cu aceeasi sigma0 (volatilitatea
    //  conditionata estimata din ultimele 60 de zile de date reale),
    //  dar evolueaza independent dupa socurile proprii.

    const { alpha, beta, omega, sigma0 } = garchParams;

    // Scalare: daca s-a aplicat ajustare AI de sigma, scalez sigma0 proportional
    const scale  = sBase / (garchParams.sigmaLR || sBase || 1);
    const s0     = sigma0 * scale;
    const omegaS = omega * scale * scale; // omega scalat consistent

    // Vectori de stare per simulare (doar ziua curenta — economie de memorie)
    const varT   = new Float64Array(NUM_SIMS).fill(s0 * s0);
    const epsT   = new Float64Array(NUM_SIMS); // soc anterior (initial 0)

    for (let day = 1; day <= days; day++) {
      const offset     = day * NUM_SIMS;
      const prevOffset = (day - 1) * NUM_SIMS;

      for (let sim = 0; sim < NUM_SIMS; sim++) {
        const prevPrice = matrix[prevOffset + sim];

        // Actualizeaza varianta GARCH cu socul zilei anterioare
        varT[sim] = omegaS + alpha * epsT[sim] * epsT[sim] + beta * varT[sim];
        // Clamp: evita variante negative sau explozive
        varT[sim] = Math.max(varT[sim], omegaS);
        varT[sim] = Math.min(varT[sim], sBase * sBase * 25); // max 5× sigma initiala

        const sigmaT = Math.sqrt(varT[sim]);
        const z      = randShock();   // Normal sau Student-t(ν)
        const eps    = sigmaT * z;
        epsT[sim]    = eps; // salveaza pentru urmatoarea zi

        // Mean reversion spre MA50
        const revPull = meanRevStrength > 0 && target > 0
          ? meanRevStrength * Math.log(target / prevPrice)
          : 0;

        matrix[offset + sim] = prevPrice * Math.exp(d + revPull + eps);
      }
    }

  } else {
    // ── Simulare GBM clasica (sigma constanta) + Fat Tails
    for (let day = 1; day <= days; day++) {
      const offset     = day * NUM_SIMS;
      const prevOffset = (day - 1) * NUM_SIMS;
      for (let sim = 0; sim < NUM_SIMS; sim++) {
        const prevPrice = matrix[prevOffset + sim];
        const z         = randShock();   // Normal sau Student-t(ν)
        const revPull   = meanRevStrength > 0 && target > 0
          ? meanRevStrength * Math.log(target / prevPrice)
          : 0;
        matrix[offset + sim] = prevPrice * Math.exp(d + revPull + sBase * z);
      }
    }
  }

  return matrix;
}

// Extrage preturile finale (ultima zi)
export function getFinalPrices(matrix, days) {
  const offset = days * NUM_SIMS;
  const finals = new Float64Array(NUM_SIMS);
  for (let i = 0; i < NUM_SIMS; i++) finals[i] = matrix[offset + i];
  return finals;
}

// Calculeaza percentila dintr-un array
export function percentile(arr, p) {
  const sorted = Float64Array.from(arr).sort();
  const idx    = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

// Calculeaza toate statisticile
export function calcStats(matrix, days, currentPrice) {
  const finals = getFinalPrices(matrix, days);
  const sorted = Float64Array.from(finals).sort();
  const n      = sorted.length;
  const mean   = finals.reduce((a, b) => a + b, 0) / n;

  let probProfit = 0, probGain10 = 0, probLoss10 = 0;
  for (let i = 0; i < n; i++) {
    if (sorted[i] > currentPrice)        probProfit++;
    if (sorted[i] > currentPrice * 1.10) probGain10++;
    if (sorted[i] < currentPrice * 0.90) probLoss10++;
  }

  return {
    mean,
    median:     sorted[Math.floor(n * 0.5)],
    p10:        sorted[Math.floor(n * 0.10)],
    p25:        sorted[Math.floor(n * 0.25)],
    p75:        sorted[Math.floor(n * 0.75)],
    p90:        sorted[Math.floor(n * 0.90)],
    min:        sorted[0],
    max:        sorted[n - 1],
    probProfit: (probProfit / n) * 100,
    probGain10: (probGain10 / n) * 100,
    probLoss10: (probLoss10 / n) * 100,
    finals,
    sorted,
  };
}

// ── Percentile per zi (pentru graficul de traiectorii) ──
//
// step > 1: sorteaza doar la fiecare `step` zile, interpoleaza liniar intre ele.
// Economie: 30d→step=1 (31), 90d→step=2 (46), 180d→step=3 (61), 360d→step=5 (73)
// Total: 211 sorturi in loc de 664. Vizual identic — Chart.js face smoothing oricum.
//
export function percentilesPerDay(matrix, days, pcts = [10, 50, 90], step = 1) {
  const result = {};
  pcts.forEach(p => result[p] = new Float64Array(days + 1));

  // Buffer refolosit — evita 664 × 240 KB de alocari cu presiune pe GC
  const buf = new Float64Array(NUM_SIMS);

  // Checkpoints exacte (prima si ultima zi mereu incluse)
  const checkpoints = new Set([0, days]);
  for (let d = step; d < days; d += step) checkpoints.add(d);
  const checkSorted = Array.from(checkpoints).sort((a, b) => a - b);

  for (const day of checkSorted) {
    const offset = day * NUM_SIMS;
    buf.set(matrix.subarray(offset, offset + NUM_SIMS)); // subarray: zero-copy view
    buf.sort();
    pcts.forEach(p => {
      result[p][day] = buf[Math.floor((p / 100) * (NUM_SIMS - 1))];
    });
  }

  // Interpolare liniara intre checkpoints
  if (step > 1) {
    for (let i = 0; i < checkSorted.length - 1; i++) {
      const a = checkSorted[i], b = checkSorted[i + 1];
      if (b - a <= 1) continue;
      pcts.forEach(p => {
        const va = result[p][a], vb = result[p][b];
        for (let d = a + 1; d < b; d++) {
          result[p][d] = va + (vb - va) * (d - a) / (b - a);
        }
      });
    }
  }

  return result;
}

// ── Ajustare parametri GBM pe baza sentimentului ─────
export function adjustParams(drift, sigma, sentimentScores,
                              sectorWeights = null, vixImpact = 0,
                              deviationPct = 0, volumeTrendScore = 0) {
  if (!sentimentScores || sentimentScores.length === 0) {
    return {
      driftAdj: drift, sigmaAdj: sigma,
      meanRevStrength: calcMeanRevStrength(deviationPct),
    };
  }

  const FACTOR_KEYS = ['geopolitic','inflatie_dobanzi','crize_financiare',
                       'pandemii_sanatate','tarife_comerciale','alegeri_politice','stiri_companie'];

  let weightedSum = 0;
  let totalWeight = 0;
  sentimentScores.forEach((score, i) => {
    const key = FACTOR_KEYS[i];
    const w   = sectorWeights?.[key] ?? 1.0;
    weightedSum += score * w;
    totalWeight += w;
  });

  const avg    = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const absAvg = Math.abs(avg);

  const driftAdj        = drift + avg * 0.0002 + volumeTrendScore * 0.0001;
  const volUncertainty  = volumeTrendScore < 0 ? Math.abs(volumeTrendScore) * 0.15 : 0;
  const sigmaAdj        = sigma * (1 + absAvg * 0.3 + vixImpact + volUncertainty);
  const meanRevStrength = calcMeanRevStrength(deviationPct);

  return { driftAdj, sigmaAdj, meanRevStrength };
}

function calcMeanRevStrength(deviationPct) {
  const absDev = Math.abs(deviationPct);
  if (absDev < 5)  return 0.0;
  if (absDev < 15) return 0.03;
  if (absDev < 30) return 0.07;
  return 0.12;
}

export { NUM_SIMS };

// ═══════════════════════════════════════════════════════
//  OU + HESTON — Simulare 2 (Mean Reversion + Vol. Stoch.)
// ═══════════════════════════════════════════════════════

export const NUM_SIMS_OU = 15_000;

// ── Estimare parametri OU + Heston din date istorice ──
//
//  κ_S  — viteza de revenire a log-pretului spre μ
//  μ    — nivelul de echilibru (pret, nu log)
//  κ_v  — viteza de revenire a variantei spre θ (din GARCH)
//  θ    — varianta pe termen lung (σ_LR²)
//  ξ    — volatilitatea volatilitatii (vol-of-vol)
//  ρ    — corelatie randamente <-> schimbari de volatilitate
//         (efectul lever: pret jos => vol sus, tipic -0.4…-0.7)
//
export function estimateOUHeston(closes, garch) {
  const n = closes.length;
  if (n < 60) return null;

  const logP = closes.map(p => Math.log(p));
  const dt   = 1 / 252;

  // ── OLS exact pt OU: logP_t = a*logP_{t-1} + b + eps ─
  let Sx = 0, Sy = 0, Sxy = 0, Sx2 = 0;
  const m = logP.length - 1;
  for (let i = 0; i < m; i++) {
    Sx  += logP[i];
    Sy  += logP[i + 1];
    Sxy += logP[i] * logP[i + 1];
    Sx2 += logP[i] * logP[i];
  }
  const denom = m * Sx2 - Sx * Sx;
  const aOU   = denom > 1e-20 ? (m * Sxy - Sx * Sy) / denom : 1;
  const bOU   = (Sy - aOU * Sx) / m;

  // kappa: -ln(a)/dt; clampat la [0.01, 15] anual
  const kappaS = Math.max(0.01, Math.min(15, -Math.log(Math.max(1e-9, Math.abs(aOU))) / dt));
  // μ: nivel de echilibru
  const muLog  = Math.abs(1 - aOU) > 1e-9 ? bOU / (1 - aOU) : logP.reduce((s,v) => s+v,0)/n;
  const mu     = Math.exp(muLog);
  // half-life in zile lucratoare
  const halfLifeDays = Math.round(Math.log(2) / kappaS / dt);

  // ── Sigma OU din reziduuri ────────────────────────────
  let ssRes = 0;
  for (let i = 0; i < m; i++) ssRes += (logP[i+1] - aOU*logP[i] - bOU) ** 2;
  const sigmaOU = Math.sqrt(ssRes / (m - 2) / dt);

  // ── Heston — din GARCH ────────────────────────────────
  const kappav = garch ? Math.max(0.5, (1 - garch.persistence) * 252) : 5;
  const theta  = garch ? garch.sigmaLR ** 2 : (sigmaOU ** 2 / 252);
  const v0     = garch ? garch.sigma0  ** 2 : theta;

  // ── ξ (vol-of-vol) din dispersia variantei pe ferestre ─
  let xi = 0.35;
  if (n >= 30) {
    const winVars = [];
    const returns = [];
    for (let i = 1; i < n; i++) returns.push(logP[i] - logP[i-1]);
    for (let i = 5; i < returns.length; i += 5) {
      const w = returns.slice(i-5, i);
      const wm = w.reduce((s,v) => s+v,0)/5;
      winVars.push(w.reduce((s,v) => s+(v-wm)**2,0)/4/dt);
    }
    if (winVars.length > 3) {
      const mwv = winVars.reduce((s,v) => s+v,0)/winVars.length;
      const swv = Math.sqrt(winVars.reduce((s,v) => s+(v-mwv)**2,0)/(winVars.length-1));
      xi = Math.max(0.1, Math.min(2.0, swv / Math.sqrt(mwv || 1)));
    }
  }

  // ── ρ (leverage effect) din corr(ret_t, Δ|ret_{t-1}|) ─
  let rho = -0.5;
  if (n >= 30) {
    const ret = [];
    for (let i = 1; i < n; i++) ret.push(logP[i] - logP[i-1]);
    const absRet = ret.map(r => Math.abs(r));
    const m2 = ret.length - 1;
    const mR  = ret.slice(1).reduce((s,v) => s+v,0)/m2;
    const mA  = absRet.slice(0,m2).reduce((s,v) => s+v,0)/m2;
    let cov = 0, da = 0, db = 0;
    for (let i = 0; i < m2; i++) {
      cov += (ret[i+1]-mR)*(absRet[i]-mA);
      da  += (ret[i+1]-mR)**2;
      db  += (absRet[i]-mA)**2;
    }
    const den2 = Math.sqrt(da*db);
    if (den2 > 1e-20) rho = Math.max(-0.95, Math.min(0, cov/den2));
  }

  return { kappaS, mu, muLog, sigmaOU, halfLifeDays, kappav, theta, xi, rho, v0 };
}

// ── Simulare OU + Heston (Euler-Maruyama, Full Truncation) ─
//
//  d(logP) = κ_S·(μ_log − logP)·dt  +  √v·dW₁
//  dv      = κ_v·(θ − v)·dt  +  ξ·√v·dW₂
//  corr(dW₁, dW₂) = ρ  →  dW₂ = ρ·dW₁ + √(1−ρ²)·dZ
//
export function simulateOUHeston(ouParams, currentPrice, days) {
  const { kappaS, muLog, kappav, theta, xi, rho, v0 } = ouParams;
  const n      = NUM_SIMS_OU;
  const dt     = 1 / 252;
  const sqrtDt = Math.sqrt(dt);
  const rho2   = Math.sqrt(Math.max(0, 1 - rho * rho));
  const logP0  = Math.log(currentPrice);

  const matrix    = new Float64Array((days + 1) * n);
  const logPrices = new Float64Array(n).fill(logP0);
  const variances = new Float64Array(n).fill(v0);

  // Ziua 0
  for (let s = 0; s < n; s++) matrix[s] = currentPrice;

  for (let day = 1; day <= days; day++) {
    const offset = day * n;
    for (let s = 0; s < n; s++) {
      // Doua normale independente (Box-Muller)
      let u1, u2, u3, u4;
      do { u1 = Math.random(); } while (u1 === 0);
      do { u2 = Math.random(); } while (u2 === 0);
      do { u3 = Math.random(); } while (u3 === 0);
      do { u4 = Math.random(); } while (u4 === 0);
      const z1  = Math.sqrt(-2*Math.log(u1)) * Math.cos(2*Math.PI*u2);
      const z2  = Math.sqrt(-2*Math.log(u3)) * Math.cos(2*Math.PI*u4);
      const dW1 = z1;
      const dW2 = rho * z1 + rho2 * z2;       // corelat cu dW1

      // Heston — Full Truncation (evita variante negative)
      const v    = variances[s];
      const sqV  = Math.sqrt(Math.max(0, v));
      variances[s] = Math.max(0, v + kappav*(theta-v)*dt + xi*sqV*sqrtDt*dW2);

      // OU log-pret
      const sqV2 = Math.sqrt(Math.max(0, variances[s]));
      logPrices[s] += kappaS*(muLog - logPrices[s])*dt + sqV2*sqrtDt*dW1;
      matrix[offset + s] = Math.exp(logPrices[s]);
    }
  }
  return matrix;
}

// ── Statistici din matricea OU (NUM_SIMS_OU) ──────────
export function calcStatsOU(matrix, days, currentPrice) {
  const n      = NUM_SIMS_OU;
  const offset = days * n;
  const finals = Float64Array.from(matrix.subarray(offset, offset + n));
  const sorted = Float64Array.from(finals).sort();
  const mean   = finals.reduce((a,b) => a+b, 0) / n;
  let probProfit = 0, probGain10 = 0, probLoss10 = 0;
  for (let i = 0; i < n; i++) {
    if (sorted[i] > currentPrice)         probProfit++;
    if (sorted[i] > currentPrice * 1.10)  probGain10++;
    if (sorted[i] < currentPrice * 0.90)  probLoss10++;
  }
  return {
    mean,
    median:     sorted[Math.floor(n * 0.50)],
    p10:        sorted[Math.floor(n * 0.10)],
    p25:        sorted[Math.floor(n * 0.25)],
    p75:        sorted[Math.floor(n * 0.75)],
    p90:        sorted[Math.floor(n * 0.90)],
    min: sorted[0], max: sorted[n-1],
    probProfit: probProfit/n*100,
    probGain10: probGain10/n*100,
    probLoss10: probLoss10/n*100,
    finals, sorted,
  };
}

// ── Percentile per zi din matricea OU ────────────────
export function percentilesPerDayOU(matrix, days, pcts = [10,50,90], step = 1) {
  const n      = NUM_SIMS_OU;
  const result = {};
  pcts.forEach(p => { result[p] = new Float64Array(days + 1); });
  const buf = new Float64Array(n);

  const checkpoints = new Set([0, days]);
  for (let d = step; d < days; d += step) checkpoints.add(d);
  const checkSorted = Array.from(checkpoints).sort((a,b) => a-b);

  for (const day of checkSorted) {
    const offset = day * n;
    buf.set(matrix.subarray(offset, offset + n));
    buf.sort();
    pcts.forEach(p => { result[p][day] = buf[Math.floor((p/100)*(n-1))]; });
  }

  if (step > 1) {
    for (let i = 0; i < checkSorted.length - 1; i++) {
      const a = checkSorted[i], b = checkSorted[i+1];
      if (b-a <= 1) continue;
      pcts.forEach(p => {
        const va = result[p][a], vb = result[p][b];
        for (let d = a+1; d < b; d++)
          result[p][d] = va + (vb-va)*(d-a)/(b-a);
      });
    }
  }
  return result;
}
