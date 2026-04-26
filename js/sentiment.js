// ─────────────────────────────────────────────────────
//  ANALIZA SENTIMENT — fara API key
//  Surse: Yahoo Finance News + Reuters RSS + Google News
//         + Seeking Alpha + Euronews Business
//  Algoritm: VADER-lite implementat in JavaScript
//  + Detectie sector + VIX
// ─────────────────────────────────────────────────────

import { fetchFinnhubSector } from './api.js';

// Lexicon VADER simplificat (cuvinte financiare + general)
const VADER_LEXICON = {
  'good':0.9,'great':1.5,'excellent':2.0,'strong':1.2,'growth':1.3,
  'profit':1.5,'gains':1.2,'bullish':1.8,'rally':1.4,'surge':1.6,
  'beat':1.3,'record':1.1,'boost':1.2,'rise':0.8,'soar':1.8,
  'upgrade':1.5,'outperform':1.6,'buy':0.8,'positive':1.0,
  'win':1.2,'recover':1.0,'rebound':1.2,'expand':1.0,'increase':0.8,
  'improve':1.0,'innovation':1.1,'launch':0.8,'deal':0.9,'partnership':0.9,
  'dividend':1.0,'revenue':0.5,'acquisition':0.7,'merger':0.5,
  'bad':-0.9,'worst':-1.8,'poor':-1.2,'weak':-1.1,'loss':-1.5,
  'bearish':-1.8,'crash':-2.0,'plunge':-1.8,'fall':-0.9,'drop':-1.0,
  'decline':-1.0,'miss':-1.3,'downgrade':-1.5,'sell':-0.8,'negative':-1.0,
  'concern':-0.8,'risk':-0.7,'warning':-1.2,'crisis':-1.8,'debt':-0.8,
  'layoff':-1.5,'bankrupt':-2.0,'fine':-1.2,'fraud':-1.8,'scandal':-1.8,
  'lawsuit':-1.2,'recall':-1.3,'halt':-1.0,'suspend':-1.0,'cut':-0.9,
  'war':-1.5,'conflict':-1.2,'sanction':-1.3,'tariff':-0.8,'inflation':-0.8,
  'recession':-1.5,'default':-1.8,'volatile':-0.6,'uncertainty':-0.8,
  'very':1.3,'extremely':1.5,'highly':1.2,'significantly':1.2,
};

const NEGATIONS = new Set(['not','no','never','neither','nor','without',
                           'hardly','barely','scarcely','dont','cant','wont']);

function vaderScore(text) {
  const words    = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/);
  let total      = 0;
  let count      = 0;
  let amplifier  = 1.0;

  for (let i = 0; i < words.length; i++) {
    const w       = words[i];
    const negated = i > 0 && (NEGATIONS.has(words[i-1]) ||
                   (i > 1 && NEGATIONS.has(words[i-2])));
    if (VADER_LEXICON[w] !== undefined) {
      let score = VADER_LEXICON[w] * amplifier;
      if (negated) score *= -0.74;
      total += score;
      count++;
      amplifier = 1.0;
    } else if (['very','extremely','highly','significantly'].includes(w)) {
      amplifier = 1.3;
    } else {
      amplifier = 1.0;
    }
  }
  if (count === 0) return 0;
  return Math.max(-1, Math.min(1, total / (count * 2.5)));
}

// ── Ponderi per sector ────────────────────────────────
export const SECTOR_WEIGHTS = {
  'Technology': {
    geopolitic: 0.8, inflatie_dobanzi: 1.0, crize_financiare: 0.7,
    pandemii_sanatate: 0.3, tarife_comerciale: 1.2, alegeri_politice: 1.5,
    stiri_companie: 2.0,
    emoji: '💻', label: 'Technology',
  },
  'Energy': {
    geopolitic: 2.0, inflatie_dobanzi: 1.2, crize_financiare: 0.8,
    pandemii_sanatate: 0.3, tarife_comerciale: 1.5, alegeri_politice: 1.3,
    stiri_companie: 1.5,
    emoji: '⚡', label: 'Energy',
  },
  'Financial Services': {
    geopolitic: 0.8, inflatie_dobanzi: 2.0, crize_financiare: 2.0,
    pandemii_sanatate: 0.4, tarife_comerciale: 0.7, alegeri_politice: 1.5,
    stiri_companie: 1.5,
    emoji: '🏦', label: 'Financial Services',
  },
  'Healthcare': {
    geopolitic: 0.4, inflatie_dobanzi: 0.7, crize_financiare: 0.5,
    pandemii_sanatate: 2.0, tarife_comerciale: 0.6, alegeri_politice: 1.8,
    stiri_companie: 1.8,
    emoji: '🏥', label: 'Healthcare',
  },
  'Consumer Cyclical': {
    geopolitic: 0.6, inflatie_dobanzi: 1.5, crize_financiare: 1.2,
    pandemii_sanatate: 0.8, tarife_comerciale: 1.3, alegeri_politice: 0.8,
    stiri_companie: 1.5,
    emoji: '🛍', label: 'Consumer Cyclical',
  },
  'Consumer Defensive': {
    geopolitic: 0.5, inflatie_dobanzi: 1.2, crize_financiare: 0.8,
    pandemii_sanatate: 1.0, tarife_comerciale: 1.0, alegeri_politice: 0.7,
    stiri_companie: 1.3,
    emoji: '🛒', label: 'Consumer Defensive',
  },
  'Industrials': {
    geopolitic: 1.2, inflatie_dobanzi: 1.0, crize_financiare: 0.9,
    pandemii_sanatate: 0.5, tarife_comerciale: 1.8, alegeri_politice: 1.0,
    stiri_companie: 1.2,
    emoji: '🏭', label: 'Industrials',
  },
  'Basic Materials': {
    geopolitic: 1.5, inflatie_dobanzi: 1.0, crize_financiare: 0.8,
    pandemii_sanatate: 0.3, tarife_comerciale: 1.8, alegeri_politice: 0.9,
    stiri_companie: 1.2,
    emoji: '⛏', label: 'Basic Materials',
  },
  'Real Estate': {
    geopolitic: 0.4, inflatie_dobanzi: 2.0, crize_financiare: 1.5,
    pandemii_sanatate: 0.5, tarife_comerciale: 0.4, alegeri_politice: 1.0,
    stiri_companie: 1.2,
    emoji: '🏠', label: 'Real Estate',
  },
  'Utilities': {
    geopolitic: 1.0, inflatie_dobanzi: 1.5, crize_financiare: 0.7,
    pandemii_sanatate: 0.3, tarife_comerciale: 0.5, alegeri_politice: 1.3,
    stiri_companie: 1.0,
    emoji: '💡', label: 'Utilities',
  },
  'Communication Services': {
    geopolitic: 0.7, inflatie_dobanzi: 0.8, crize_financiare: 0.7,
    pandemii_sanatate: 0.4, tarife_comerciale: 1.0, alegeri_politice: 1.5,
    stiri_companie: 2.0,
    emoji: '📡', label: 'Communication Services',
  },
  'Cryptocurrency': {
    geopolitic: 1.0, inflatie_dobanzi: 1.5, crize_financiare: 1.5,
    pandemii_sanatate: 0.2, tarife_comerciale: 0.5, alegeri_politice: 1.3,
    stiri_companie: 2.0,
    emoji: '₿', label: 'Cryptocurrency',
  },
  'Unknown': {
    geopolitic: 1.0, inflatie_dobanzi: 1.0, crize_financiare: 1.0,
    pandemii_sanatate: 1.0, tarife_comerciale: 1.0, alegeri_politice: 1.0,
    stiri_companie: 1.0,
    emoji: '📊', label: 'Unknown',
  },
};

// ── Fallback local pentru tickere frecvente ──────────
const TICKER_SECTOR_MAP = {
  // US — Technology
  'AAPL':   { sector: 'Technology',             industry: 'Consumer Electronics' },
  'MSFT':   { sector: 'Technology',             industry: 'Software — Infrastructure' },
  'NVDA':   { sector: 'Technology',             industry: 'Semiconductors' },
  'MU':     { sector: 'Technology',             industry: 'Semiconductors' },
  'AMD':    { sector: 'Technology',             industry: 'Semiconductors' },
  'INTC':   { sector: 'Technology',             industry: 'Semiconductors' },
  'TSM':    { sector: 'Technology',             industry: 'Semiconductors' },
  'AVGO':   { sector: 'Technology',             industry: 'Semiconductors' },
  'QCOM':   { sector: 'Technology',             industry: 'Semiconductors' },
  'CRM':    { sector: 'Technology',             industry: 'Software — Application' },
  'ORCL':   { sector: 'Technology',             industry: 'Software — Infrastructure' },
  'ADBE':   { sector: 'Technology',             industry: 'Software — Application' },
  'IBM':    { sector: 'Technology',             industry: 'Information Technology Services' },
  'CSCO':   { sector: 'Technology',             industry: 'Communication Equipment' },
  // US — Communication Services
  'GOOGL':  { sector: 'Communication Services', industry: 'Internet Content & Information' },
  'GOOG':   { sector: 'Communication Services', industry: 'Internet Content & Information' },
  'META':   { sector: 'Communication Services', industry: 'Internet Content & Information' },
  'NFLX':   { sector: 'Communication Services', industry: 'Entertainment' },
  'DIS':    { sector: 'Communication Services', industry: 'Entertainment' },
  'T':      { sector: 'Communication Services', industry: 'Telecom Services' },
  'VZ':     { sector: 'Communication Services', industry: 'Telecom Services' },
  // US — Consumer Cyclical
  'TSLA':   { sector: 'Consumer Cyclical',      industry: 'Auto Manufacturers' },
  'AMZN':   { sector: 'Consumer Cyclical',      industry: 'Internet Retail' },
  'HD':     { sector: 'Consumer Cyclical',      industry: 'Home Improvement Retail' },
  'MCD':    { sector: 'Consumer Cyclical',      industry: 'Restaurants' },
  'SBUX':   { sector: 'Consumer Cyclical',      industry: 'Restaurants' },
  'NKE':    { sector: 'Consumer Cyclical',      industry: 'Footwear & Accessories' },
  'F':      { sector: 'Consumer Cyclical',      industry: 'Auto Manufacturers' },
  'GM':     { sector: 'Consumer Cyclical',      industry: 'Auto Manufacturers' },
  // US — Consumer Defensive
  'MO':     { sector: 'Consumer Defensive',     industry: 'Tobacco' },
  'PM':     { sector: 'Consumer Defensive',     industry: 'Tobacco' },
  'KO':     { sector: 'Consumer Defensive',     industry: 'Beverages — Non-Alcoholic' },
  'PEP':    { sector: 'Consumer Defensive',     industry: 'Beverages — Non-Alcoholic' },
  'PG':     { sector: 'Consumer Defensive',     industry: 'Household & Personal Products' },
  'WMT':    { sector: 'Consumer Defensive',     industry: 'Discount Stores' },
  'COST':   { sector: 'Consumer Defensive',     industry: 'Discount Stores' },
  'CL':     { sector: 'Consumer Defensive',     industry: 'Household & Personal Products' },
  // US — Financial Services
  'RY':     { sector: 'Financial Services',     industry: 'Banks — Diversified' },
  'JPM':    { sector: 'Financial Services',     industry: 'Banks — Diversified' },
  'BAC':    { sector: 'Financial Services',     industry: 'Banks — Diversified' },
  'WFC':    { sector: 'Financial Services',     industry: 'Banks — Diversified' },
  'C':      { sector: 'Financial Services',     industry: 'Banks — Diversified' },
  'GS':     { sector: 'Financial Services',     industry: 'Capital Markets' },
  'MS':     { sector: 'Financial Services',     industry: 'Capital Markets' },
  'V':      { sector: 'Financial Services',     industry: 'Credit Services' },
  'MA':     { sector: 'Financial Services',     industry: 'Credit Services' },
  'BRK-B':  { sector: 'Financial Services',     industry: 'Insurance — Diversified' },
  'BRK.B':  { sector: 'Financial Services',     industry: 'Insurance — Diversified' },
  // US — Energy
  'ENB':    { sector: 'Energy',                 industry: 'Oil & Gas Midstream' },
  'XOM':    { sector: 'Energy',                 industry: 'Oil & Gas Integrated' },
  'CVX':    { sector: 'Energy',                 industry: 'Oil & Gas Integrated' },
  'COP':    { sector: 'Energy',                 industry: 'Oil & Gas E&P' },
  // US — Healthcare
  'JNJ':    { sector: 'Healthcare',             industry: 'Drug Manufacturers — General' },
  'PFE':    { sector: 'Healthcare',             industry: 'Drug Manufacturers — General' },
  'UNH':    { sector: 'Healthcare',             industry: 'Healthcare Plans' },
  'LLY':    { sector: 'Healthcare',             industry: 'Drug Manufacturers — General' },
  'ABBV':   { sector: 'Healthcare',             industry: 'Drug Manufacturers — General' },
  'MRK':    { sector: 'Healthcare',             industry: 'Drug Manufacturers — General' },
  // US — Industrials
  'BA':     { sector: 'Industrials',            industry: 'Aerospace & Defense' },
  'CAT':    { sector: 'Industrials',            industry: 'Farm & Heavy Construction Machinery' },
  'GE':     { sector: 'Industrials',            industry: 'Specialty Industrial Machinery' },
  'MMM':    { sector: 'Industrials',            industry: 'Conglomerates' },
  'HON':    { sector: 'Industrials',            industry: 'Conglomerates' },
  'UPS':    { sector: 'Industrials',            industry: 'Integrated Freight & Logistics' },
  // US — Utilities / Real Estate
  'NEE':    { sector: 'Utilities',              industry: 'Utilities — Regulated Electric' },
  'DUK':    { sector: 'Utilities',              industry: 'Utilities — Regulated Electric' },
  'SO':     { sector: 'Utilities',              industry: 'Utilities — Regulated Electric' },
  'AMT':    { sector: 'Real Estate',            industry: 'REIT — Specialty' },
  'PLD':    { sector: 'Real Estate',            industry: 'REIT — Industrial' },
  'APLE':   { sector: 'Real Estate',            industry: 'REIT — Hotel & Motel' },
  'VICI':   { sector: 'Real Estate',            industry: 'REIT — Diversified' },
  'O':      { sector: 'Real Estate',            industry: 'REIT — Retail' },
  'REALTY': { sector: 'Real Estate',            industry: 'REIT — Retail' },
  'SPG':    { sector: 'Real Estate',            industry: 'REIT — Retail' },
  'AVB':    { sector: 'Real Estate',            industry: 'REIT — Residential' },
  'EQR':    { sector: 'Real Estate',            industry: 'REIT — Residential' },
  'PSA':    { sector: 'Real Estate',            industry: 'REIT — Specialty' },
  'DLR':    { sector: 'Real Estate',            industry: 'REIT — Specialty' },
  'WPC':    { sector: 'Real Estate',            industry: 'REIT — Diversified' },
  'NNN':    { sector: 'Real Estate',            industry: 'REIT — Retail' },
  'STAG':   { sector: 'Real Estate',            industry: 'REIT — Industrial' },
  // Swiss (.SW)
  'ABBN.SW':{ sector: 'Industrials',            industry: 'Specialty Industrial Machinery' },
  'ZURN.SW':{ sector: 'Financial Services',     industry: 'Insurance — Diversified' },
  'NESN.SW':{ sector: 'Consumer Defensive',     industry: 'Packaged Foods' },
  'SIKA.SW':{ sector: 'Basic Materials',        industry: 'Specialty Chemicals' },
  'ROG.SW': { sector: 'Healthcare',             industry: 'Drug Manufacturers — General' },
  'NOVN.SW':{ sector: 'Healthcare',             industry: 'Drug Manufacturers — General' },
  'UBSG.SW':{ sector: 'Financial Services',     industry: 'Banks — Diversified' },
  // German (.DE)
  'OMV.DE': { sector: 'Energy',                 industry: 'Oil & Gas Integrated' },
  'MUM.DE': { sector: 'Financial Services',     industry: 'Insurance — Reinsurance' },
  'SAP.DE': { sector: 'Technology',             industry: 'Software — Application' },
  'BMW.DE': { sector: 'Consumer Cyclical',      industry: 'Auto Manufacturers' },
  'SIE.DE': { sector: 'Industrials',            industry: 'Specialty Industrial Machinery' },
  // UK (.L)
  'BATS.L': { sector: 'Consumer Defensive',     industry: 'Tobacco' },
  'SHEL.L': { sector: 'Energy',                 industry: 'Oil & Gas Integrated' },
  'HSBA.L': { sector: 'Financial Services',     industry: 'Banks — Diversified' },
  // Netherlands (.AS)
  'APAM.AS':  { sector: 'Basic Materials',      industry: 'Steel' },
  'ASML.AS':  { sector: 'Technology',           industry: 'Semiconductor Equipment & Materials' },
  'VPK.AS':   { sector: 'Energy',               industry: 'Oil & Gas Integrated' },
  'ECMPA.AS': { sector: 'Real Estate',          industry: 'REIT — Specialty' },
  'LIGHT.AS': { sector: 'Industrials',          industry: 'Electrical Equipment & Parts' },
  'PHIA.AS':  { sector: 'Healthcare',           industry: 'Medical Devices' },
  'HEIA.AS':  { sector: 'Consumer Defensive',   industry: 'Beverages — Alcoholic' },
  'INGA.AS':  { sector: 'Financial Services',   industry: 'Banks — Diversified' },
  'RAND.AS':  { sector: 'Financial Services',   industry: 'Asset Management' },
  'URW.AS':   { sector: 'Real Estate',          industry: 'REIT — Retail' },
  'DSM.AS':   { sector: 'Basic Materials',      industry: 'Specialty Chemicals' },
  'AKZA.AS':  { sector: 'Basic Materials',      industry: 'Specialty Chemicals' },
  'WKL.AS':   { sector: 'Industrials',          industry: 'Specialty Industrial Machinery' },
  // Romania (.RO)
  'TLV.RO': { sector: 'Financial Services',     industry: 'Banks — Regional' },
  'SNP.RO': { sector: 'Energy',                 industry: 'Oil & Gas Integrated' },
  'BRD.RO': { sector: 'Financial Services',     industry: 'Banks — Regional' },
   // Franta (.PA)
  'TTE.PA': { sector: 'Energy',                 industry: 'Oil & Gas Integrated' },
  'ENX.PA': { sector: 'Financial Services',     industry: 'Banks — Regional' },
  'COV.PA': { sector: 'Real Estate',            industry: 'REIT — Specialty' },
  
};

// ── Detectie sector din Yahoo Finance ────────────────
async function fetchWithTimeout(url, ms = 4000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSectorData(ticker) {
  if (ticker.includes('-USD') || ticker.includes('-EUR') ||
      ticker.includes('-BTC') || ['BTC','ETH','BNB','SOL','XRP'].includes(ticker)) {
    return { sector: 'Cryptocurrency', industry: 'Cryptocurrency', weights: SECTOR_WEIGHTS['Cryptocurrency'] };
  }

  const upper = ticker.toUpperCase();

  if (TICKER_SECTOR_MAP[upper]) {
    const { sector, industry } = TICKER_SECTOR_MAP[upper];
    const weights = SECTOR_WEIGHTS[sector] || SECTOR_WEIGHTS['Unknown'];
    return { sector, industry, weights };
  }

  // ── Yahoo quoteSummary — o singura incercare rapida (US tickers) ──
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile`;
    const r   = await fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(url)}`, 5000);
    if (r.ok) {
      const data    = await r.json();
      const profile = data?.quoteSummary?.result?.[0]?.assetProfile;
      const sector  = profile?.sector;
      const industry = profile?.industry;
      if (sector) {
        const weights = SECTOR_WEIGHTS[sector] || SECTOR_WEIGHTS['Unknown'];
        return { sector, industry: industry || sector, weights };
      }
    }
  } catch (_) {}

  // Fallback: detecteaza sectorul din numele companiei
  try {
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const r = await fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(chartUrl)}`, 4000);
    if (r.ok) {
      const d    = await r.json();
      const name = (d?.chart?.result?.[0]?.meta?.longName || '').toLowerCase();
      const detected =
        /reit|real estate|hospitality reit|hotel reit|property trust|mortgage trust/.test(name) ? 'Real Estate'
      : /bank|bancorp|savings bank|financial corp/.test(name)                                   ? 'Financial Services'
      : /insurance|assurance|reinsurance/.test(name)                                            ? 'Financial Services'
      : /energy|oil|gas|petroleum|pipeline|midstream/.test(name)                               ? 'Energy'
      : /utilities|electric power|water utility/.test(name)                                     ? 'Utilities'
      : /pharma|biotech|therapeutics|biosciences|oncology/.test(name)                           ? 'Healthcare'
      : /tobacco|cigarette|altria/.test(name)                                                   ? 'Consumer Defensive'
      : null;
      if (detected) {
        const weights = SECTOR_WEIGHTS[detected] || SECTOR_WEIGHTS['Unknown'];
        return { sector: detected, industry: detected, weights };
      }
    }
  } catch (_) {}

  // Fallback final: Finnhub profile2 (pt tickere EU blocate de Yahoo)
  try {
    const fhResult = await fetchFinnhubSector(ticker);
    if (fhResult && fhResult.sector && fhResult.sector !== 'Unknown') {
      const weights = SECTOR_WEIGHTS[fhResult.sector] || SECTOR_WEIGHTS['Unknown'];
      return { sector: fhResult.sector, industry: fhResult.industry, weights };
    }
  } catch (_) {}

  return { sector: 'Unknown', industry: 'Unknown', weights: SECTOR_WEIGHTS['Unknown'] };
}

// ── Fetch VIX ────────────────────────────────────────
export async function fetchVIX() {
  try {
    const url   = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d';
    const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const r     = await fetchWithTimeout(proxy, 4000);
    const data  = await r.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(Boolean);
    if (!closes || closes.length === 0) return { vix: null, vixLabel: 'N/A', vixImpact: 0 };

    const vix = closes[closes.length - 1];
    const vixLabel = vix < 15 ? '😴 Calm' : vix < 25 ? '😐 Normal' : vix < 35 ? '😟 Stres' : '🔥 Panica';
    const vixImpact = vix > 25 ? (vix - 25) / 100 : vix < 15 ? -(15 - vix) / 200 : 0;
    return { vix: +vix.toFixed(2), vixLabel, vixImpact };
  } catch (e) {
    console.warn('VIX fetch failed:', e);
    return { vix: null, vixLabel: 'N/A', vixImpact: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════
//  PIPELINE DE FILTRARE SEMANTICA (metoda fonduri/banci)
//  Separa stirile in 4 niveluri de relevanta:
//   Tier 1 — impact direct (mentioneaza compania + eveniment financiar)
//   Tier 2 — relevanta indirecta (sector/industrie related)
//   Tier 3 — macro general (Fed, inflatie, PIB — fara legatura directa)
//   Tier 4 — zgomot (clickbait, tagging gresit, feed duplicat)
// ═══════════════════════════════════════════════════════════════

// ── Profil de cuvinte-cheie per sector ───────────────
// Folosit pentru "company profile embedding" — cu cat mai multe cuvinte
// dintr-o stire se regasesc in profil, cu atat stirea e mai relevanta
const SECTOR_PROFILE = {
  'Technology':            ['tech','software','hardware','chip','semiconductor','ai',
                            'cloud','data','digital','cyber','app','platform','code',
                            'silicon','processor','gpu','cpu','saas','startup'],
  'Energy':                ['oil','gas','energy','barrel','crude','refinery','pipeline',
                            'petrol','lng','opec','renewable','solar','wind','coal',
                            'fuel','drill','exploration','upstream','downstream'],
  'Financial Services':    ['bank','banking','loan','credit','interest','mortgage',
                            'fund','asset','capital','insurance','invest','portfolio',
                            'finance','dividend','rate','yield','bond','treasury'],
  'Healthcare':            ['drug','pharma','clinical','fda','trial','vaccine','therapy',
                            'biotech','hospital','patient','medical','health','approval',
                            'treatment','disease','cancer','genomic','biosimilar'],
  'Consumer Cyclical':     ['retail','consumer','sales','store','brand','fashion','auto',
                            'vehicle','car','electric','demand','shopping','luxury',
                            'ecommerce','delivery','restaurant','travel','hotel'],
  'Consumer Defensive':    ['food','beverage','tobacco','staple','grocery','packaged',
                            'consumer','brand','household','personal','care','supply'],
  'Industrials':           ['manufacturing','industrial','aerospace','defense','machine',
                            'construction','logistics','transport','freight','supply',
                            'infrastructure','factory','equipment','engineering'],
  'Basic Materials':       ['steel','metal','copper','aluminum','chemical','mining',
                            'commodity','iron','gold','silver','lithium','rare earth',
                            'fertilizer','plastic','polymer','material'],
  'Real Estate':           ['reit','property','real estate','mortgage','rent','lease',
                            'building','office','residential','commercial','occupancy'],
  'Utilities':             ['utility','electric','water','gas','grid','power','regulated',
                            'infrastructure','transmission','distribution','renewable'],
  'Communication Services':['media','telecom','streaming','content','social','network',
                            'broadband','wireless','subscriber','advertising','platform'],
  'Cryptocurrency':        ['bitcoin','crypto','blockchain','defi','token','wallet',
                            'ethereum','exchange','mining','stablecoin','nft','web3'],
  'Unknown':               [],
};

// ── Cuvinte de inalt impact financiar ────────────────
// Prezenta lor alaturi de mentionarea companiei => Tier 1
const HIGH_IMPACT_WORDS = new Set([
  'earnings','revenue','profit','loss','dividend','acquisition','merger','buyout',
  'bankruptcy','default','recall','lawsuit','ceo','layoff','ipo','spinoff',
  'upgrade','downgrade','forecast','guidance','quarterly','annual','results',
  'buyback','stake','deal','agreement','contract','partnership','fine','penalty',
  'investigation','fraud','scandal','miss','beat','exceed','cut','raise','halted',
]);

// ── Pattern-uri de zgomot (Tier 4) ───────────────────
const NOISE_PATTERNS = [
  /^\d+ (stock|shares?|ticker)/i,        // "5 stocks to buy"
  /top \d+/i,                            // "Top 10 stocks"
  /\d+ (reason|thing|way)/i,             // "3 reasons to..."
  /you (need|should|must|have to)/i,     // clickbait imperativ
  /best stock/i,
  /dont miss/i,
  /secrets? (of|to)/i,
  /\bvs\.?\b/i,                          // "AAPL vs MSFT" — comparatii generice
  /investing in \d{4}/i,                 // "Investing in 2024"
  /here.s why/i,
];

// ── Cosine similarity pe bag-of-words ────────────────
// Compara doua seturi de cuvinte ponderate si returneaza similaritate 0-1
function cosineSim(titleWords, profileWords) {
  if (profileWords.size === 0) return 0;
  let intersection = 0;
  for (const w of titleWords) {
    if (profileWords.has(w)) intersection++;
  }
  // Jaccard-like: intersectie / uniune (mai robust decat cosine pur pt texte scurte)
  const union = new Set([...titleWords, ...profileWords]).size;
  return union > 0 ? intersection / union : 0;
}

// ── Construieste profilul companiei ──────────────────
// Returneaza doua seturi: identitate (ticker, nume) si domeniu (sector, industrie)
function buildCompanyProfile(ticker, companyName, sector, industry) {
  const identity = new Set();
  const domain   = new Set();

  // Ticker fara sufix (.DE, .RO, -USD etc.)
  const tickerBase = ticker.toLowerCase().split('.')[0].split('-')[0];
  identity.add(tickerBase);

  // Cuvintele din numele companiei (peste 3 litere)
  if (companyName) {
    companyName.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['corp','inc','ltd','plc','gmbh','ag','sa','nv'].includes(w))
      .forEach(w => identity.add(w));
  }

  // Cuvintele din industrie
  if (industry) {
    industry.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3)
      .forEach(w => domain.add(w));
  }

  // Profilul sectorului
  (SECTOR_PROFILE[sector] || []).forEach(w => domain.add(w));

  return { identity, domain };
}

// ── Tokenizare titlu ──────────────────────────────────
function tokenize(text) {
  return new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

// ── Clasificare stire in 4 tiere ─────────────────────
// Returneaza { tier, relevanta, categorie, weight }
// weight = cat de mult conteaza scorul VADER al acestei stiri in calcul
export function classifyNewsTier(titlu, ticker, companyName, sector, industry) {
  const t      = titlu.toLowerCase();
  const tokens = tokenize(titlu);
  const { identity, domain } = buildCompanyProfile(ticker, companyName, sector, industry);

  // ── Tier 4: Zgomot — eliminat din calcul ─────────────
  if (NOISE_PATTERNS.some(p => p.test(titlu))) {
    return { tier: 4, relevanta: 0, categorie: 'zgomot_clickbait', weight: 0 };
  }

  // ── Similaritate cu profilul companiei ───────────────
  const simIdentitate = cosineSim(tokens, identity); // cat de mult vorbeste despre companie
  const simDomeniu    = cosineSim(tokens, domain);   // cat de mult vorbeste despre sector

  // Verifica daca stirea mentioneaza direct compania
  const mentieDirect = simIdentitate > 0.08; // cel putin 1-2 cuvinte din identitate

  // Verifica prezenta cuvintelor de inalt impact financiar
  const areImpact = [...tokens].some(w => HIGH_IMPACT_WORDS.has(w));

  // ── Tier 1: Impact direct ────────────────────────────
  // Compania e mentionata + exista un eveniment financiar clar
  if (mentieDirect && areImpact) {
    return { tier: 1, relevanta: 0.90 + simIdentitate * 0.1, categorie: 'impact_direct', weight: 3.0 };
  }

  // Compania e mentionata fara eveniment explicit — totusi relevant
  if (mentieDirect) {
    return { tier: 1, relevanta: 0.65 + simIdentitate * 0.2, categorie: 'mentionare_directa', weight: 2.0 };
  }

  // ── Tier 2: Relevanta indirecta ──────────────────────
  // Stire din acelasi sector/industrie cu impact financiar
  if (simDomeniu > 0.15 && areImpact) {
    return { tier: 2, relevanta: 0.45 + simDomeniu * 0.3, categorie: 'sector_cu_impact', weight: 1.0 };
  }

  // Stire din sector fara impact specific
  if (simDomeniu > 0.10) {
    return { tier: 2, relevanta: 0.25 + simDomeniu * 0.4, categorie: 'sector_general', weight: 0.5 };
  }

  // ── Tier 3: Macro ────────────────────────────────────
  // Fiecare tip de macro are 3 niveluri de expunere per sector:
  //  'direct'   → weight 0.30  (sector primar afectat)
  //  'indirect' → weight 0.12  (afectat prin lant de valoare / chiriasi / clienti)
  //  null       → Tier 4       (irelevant pentru acest sector)
  //
  // Logica: "tariff news" pt Real Estate = indirect (chiriasii mall-ului sunt retaileri)
  //          "tariff news" pt Healthcare = null (nicio legatura)

  const MACRO_EXPOSURE = {
    // Tarife comerciale, razboi comercial
    tarife: {
      keywords: ['tariff','trade war','import','export','customs','embargo','trade deal'],
      expunere: {
        'Technology':             'direct',
        'Industrials':            'direct',
        'Basic Materials':        'direct',
        'Consumer Cyclical':      'direct',
        'Consumer Defensive':     'direct',
        'Energy':                 'direct',
        'Financial Services':     'indirect',   // finantare comert international
        'Real Estate':            'indirect',   // chiriasii retaileri afectati
        'Communication Services': 'indirect',   // publicitate afectata de consum
        'Utilities':              null,
        'Healthcare':             null,
        'Cryptocurrency':         'indirect',
      },
    },
    // Pandemii, sanatate publica
    sanatate: {
      keywords: ['pandemic','virus','covid','outbreak','vaccine','lockdown','epidemic'],
      expunere: {
        'Healthcare':             'direct',
        'Consumer Cyclical':      'direct',     // travel, restaurant
        'Real Estate':            'indirect',   // occupancy office/retail
        'Financial Services':     'indirect',
        'Utilities':              'indirect',
        'Technology':             'indirect',   // remote work boom/bust
        'Consumer Defensive':     'indirect',
        'Industrials':            'indirect',
        'Basic Materials':        null,
        'Energy':                 'indirect',
        'Communication Services': 'indirect',
        'Cryptocurrency':         null,
      },
    },
    // Alegeri, reglementari, politica
    politica: {
      keywords: ['election','regulation','congress','senate','parliament','government policy','antitrust','legislation'],
      expunere: {
        'Financial Services':     'direct',
        'Technology':             'direct',
        'Energy':                 'direct',
        'Communication Services': 'direct',
        'Healthcare':             'direct',     // reglementari preturi medicamente
        'Industrials':            'indirect',
        'Consumer Cyclical':      'indirect',
        'Consumer Defensive':     'indirect',
        'Real Estate':            'indirect',   // politici de zonare, taxe
        'Utilities':              'indirect',
        'Basic Materials':        'indirect',
        'Cryptocurrency':         'direct',
      },
    },
    // Geopolitica, razboi, sanctiuni
    geopolitic: {
      keywords: ['war','conflict','sanction','nato','invasion','military','troops','nuclear'],
      expunere: {
        'Energy':                 'direct',
        'Basic Materials':        'direct',
        'Industrials':            'direct',
        'Financial Services':     'direct',
        'Technology':             'direct',
        'Consumer Defensive':     'indirect',
        'Consumer Cyclical':      'indirect',
        'Real Estate':            'indirect',
        'Healthcare':             'indirect',
        'Utilities':              'indirect',
        'Communication Services': 'indirect',
        'Cryptocurrency':         'indirect',
      },
    },
  };

  // Verifica fiecare tip de macro
  for (const [tip, { keywords, expunere }] of Object.entries(MACRO_EXPOSURE)) {
    const match = keywords.some(kw => t.includes(kw));
    if (!match) continue;

    const nivel = expunere[sector] ?? null;
    if (nivel === 'direct') {
      return { tier: 3, relevanta: 0.22, categorie: `macro_${tip}_direct`, weight: 0.30 };
    }
    if (nivel === 'indirect') {
      return { tier: 3, relevanta: 0.12, categorie: `macro_${tip}_indirect`, weight: 0.12 };
    }
    // nivel === null → cade in Tier 4 mai jos
    return { tier: 4, relevanta: 0.03, categorie: `macro_${tip}_irelevant`, weight: 0 };
  }

  // A) Macro universal — afecteaza TOATE sectoarele
  const isMacroUniversal = [
    'fed','ecb','federal reserve','interest rate','inflation','recession',
    'central bank','gdp','yield curve','powell','lagarde','monetary policy',
  ].some(kw => t.includes(kw));

  if (isMacroUniversal) {
    return { tier: 3, relevanta: 0.20, categorie: 'macro_universal', weight: 0.30 };
  }

  // ── Tier 4: Zgomot ───────────────────────────────────
  return { tier: 4, relevanta: 0.05, categorie: 'zgomot_irelevant', weight: 0 };
}

// ── Keywords pentru cei 7 factori ────────────────────
const FACTOR_KEYWORDS = {
  geopolitic:        ['war','conflict','sanction','nato','russia','ukraine','china',
                      'taiwan','military','geopolit','tension','invasion','nuclear','troops'],
  inflatie_dobanzi:  ['inflation','interest rate','fed','federal reserve','ecb','rate',
                      'cpi','monetary','recession','gdp','economy','yield','bond','powell'],
  crize_financiare:  ['bank','crash','crisis','bankruptcy','default','debt','credit',
                      'collapse','bailout','financial','bear market'],
  pandemii_sanatate: ['pandemic','virus','covid','disease','outbreak','health',
                      'vaccine','lockdown','epidemic'],
  tarife_comerciale: ['tariff','trade war','import','export','customs','wto',
                      'supply chain','embargo','trade deal'],
  alegeri_politice:  ['election','vote','president','congress','senate','government',
                      'policy','political','democrat','republican','regulation','law','parliament'],
  stiri_companie:    [],
};

function assignFactor(title, ticker) {
  const t         = title.toLowerCase();
  const tickerLow = ticker.toLowerCase().split('.')[0];
  if (t.includes(tickerLow)) return 'stiri_companie';
  for (const [factor, keywords] of Object.entries(FACTOR_KEYWORDS)) {
    if (factor === 'stiri_companie') continue;
    if (keywords.some(kw => t.includes(kw))) return factor;
  }
  return 'stiri_companie';
}

// ── Descarcare stiri — RSS cu doua proxy-uri fallback ─
// Incearca rss2json.com → daca pica, fallback la corsproxy.io + DOMParser
async function fetchRss(url, sursa, limit = 25) {
  const titluri = [];

  // Incercare 1: rss2json.com (raspuns JSON gata parsit)
  try {
    const proxy = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`;
    const r     = await fetchWithTimeout(proxy, 5000);
    if (r.ok) {
      const data = await r.json();
      if (data.status === 'ok' && data.items?.length > 0) {
        data.items.slice(0, limit).forEach(item => {
          if (item.title) titluri.push({ titlu: item.title, sursa });
        });
        return titluri; // succes — returnam direct
      }
    }
  } catch (e) { console.warn(`${sursa} rss2json fail:`, e.message); }

  // Incercare 2: corsproxy.io + parsare XML cu DOMParser
  try {
    const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const r     = await fetchWithTimeout(proxy, 5000);
    if (r.ok) {
      const text   = await r.text();
      const parser = new DOMParser();
      const xml    = parser.parseFromString(text, 'text/xml');
      Array.from(xml.querySelectorAll('item')).slice(0, limit).forEach(item => {
        const raw = item.querySelector('title')?.textContent || '';
        const titlu = raw.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        if (titlu) titluri.push({ titlu, sursa });
      });
    }
  } catch (e) { console.warn(`${sursa} corsproxy fail:`, e.message); }

  return titluri;
}

// ── Yahoo Finance News ────────────────────────────────
async function fetchYahooNews(ticker) {
  const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`;
  return fetchRss(rssUrl, 'Yahoo Finance', 50);
}

// ── AP Business + CNBC — inlocuiesc Reuters (RSS-urile Reuters sunt moarte din 2020)
async function fetchReutersNews() {
  const feeds = [
    ['https://feeds.apnews.com/rss/apf-business',                                     'AP Business'],
    ['https://www.cnbc.com/id/10000664/device/rss/rss.html',                          'CNBC Markets'],
    ['https://www.cnbc.com/id/100003114/device/rss/rss.html',                         'CNBC Finance'],
  ];
  const results = await Promise.all(feeds.map(([u, s]) => fetchRss(u, s, 20)));
  return results.flat();
}

// ── Google News ───────────────────────────────────────
async function fetchGoogleNews(ticker, companyName) {
  const queries = [ticker, `${ticker} stock`];
  if (companyName && companyName !== ticker) queries.push(companyName.split(' ')[0]);
  const results = await Promise.all(queries.map(q => {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    return fetchRss(rssUrl, 'Google News', 20);
  }));
  return results.flat();
}

// ── Seeking Alpha — feed general de piata ────────────
// RSS per ticker necesita cont platit — folosim feed-ul general public
async function fetchSeekingAlphaNews(ticker) {
  const sym = ticker.split('.')[0].split('-')[0];
  // Incercam mai intai feed-ul per ticker, apoi feed-ul general
  const feeds = [
    [`https://seekingalpha.com/symbol/${sym}/news.xml`,      'Seeking Alpha'],
    [`https://seekingalpha.com/feed.xml`,                    'Seeking Alpha'],
  ];
  for (const [url, sursa] of feeds) {
    const rezultate = await fetchRss(url, sursa, 25);
    if (rezultate.length > 0) return rezultate;
  }
  return [];
}

// ── Euronews Business RSS ─────────────────────────────
async function fetchEuronewsNews() {
  const feeds = [
    ['https://euronews.com/rss?level=theme&name=business',   'Euronews Business'],
    ['https://www.euronews.com/rss?level=theme&name=business','Euronews Business'],
    ['https://feeds.euronews.com/feeds/rss/business.xml',    'Euronews Business'],
  ];
  // Incercam fiecare URL pana gasim unul care functioneaza
  for (const [url, sursa] of feeds) {
    const rezultate = await fetchRss(url, sursa, 25);
    if (rezultate.length > 0) return rezultate;
  }
  return [];
}

// ── Analiza principala ────────────────────────────────
export async function analyzeSentiment(ticker, companyName, onProgress) {
  onProgress?.('Descarc sector, VIX si stiri (paralel)...');

  // Toate fetch-urile simultan — inclusiv Seeking Alpha si Euronews
  const [
    { sector, industry, weights },
    vixData,
    yahooNews,
    reutersNews,
    googleNews,
    seekingAlphaNews,
    euronewsNews,
  ] = await Promise.all([
    fetchSectorData(ticker),
    fetchVIX(),
    fetchYahooNews(ticker),
    fetchReutersNews(),
    fetchGoogleNews(ticker, companyName),
    fetchSeekingAlphaNews(ticker),
    fetchEuronewsNews(),
  ]);

  const all = [
    ...yahooNews,
    ...reutersNews,
    ...googleNews,
    ...seekingAlphaNews,
    ...euronewsNews,
  ];

  // Deduplicare
  const seen  = new Set();
  const unice = all.filter(({ titlu }) => {
    const k = titlu.toLowerCase().slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  onProgress?.(`Filtrez si clasific ${unice.length} stiri (pipeline semantic)...`);

  // ── Pasul 1: Clasificare semantica a fiecarei stiri ─
  // Fiecare stire primeste un tier (1-4) si un weight pentru scorul VADER
  const tierStats = { t1: 0, t2: 0, t3: 0, t4: 0 };
  const stiriFiltrate = unice.map(({ titlu, sursa }) => {
    const clasificare = classifyNewsTier(titlu, ticker, companyName, sector, industry);
    if (clasificare.tier === 1) tierStats.t1++;
    else if (clasificare.tier === 2) tierStats.t2++;
    else if (clasificare.tier === 3) tierStats.t3++;
    else tierStats.t4++;
    return { titlu, sursa, ...clasificare };
  });

  // Filtram complet Tier 4 (zgomot) — nu contribuie la scor
  const stiriFiltrateCurate = stiriFiltrate.filter(s => s.tier < 4);

  onProgress?.(`${stiriFiltrateCurate.length} stiri relevante din ${unice.length} (T1:${tierStats.t1} T2:${tierStats.t2} T3:${tierStats.t3} filtrat:${tierStats.t4})`);

  const FACTORS = ['geopolitic','inflatie_dobanzi','crize_financiare',
                   'pandemii_sanatate','tarife_comerciale','alegeri_politice','stiri_companie'];

  const buckets = {};
  FACTORS.forEach(f => buckets[f] = []);

  // ── Pasul 2: Asignare factor + scor VADER ponderat ──
  // Scorul fiecarei stiri e amplificat/diminuat de weight-ul tier-ului
  stiriFiltrateCurate.forEach(({ titlu, sursa, tier, weight, categorie, relevanta }) => {
    const factor    = assignFactor(titlu, ticker);
    const scorBrut  = vaderScore(titlu);
    const scorAjust = scorBrut * weight; // Tier1 x3, Tier2 x1, Tier3 x0.3
    buckets[factor].push({ titlu, sursa, score: scorBrut, scorAjust, tier, weight, categorie, relevanta });
  });

  const LABELS = {
    geopolitic:        '🌍 Geopolitic',
    inflatie_dobanzi:  '💵 Inflatie / Dobanzi',
    crize_financiare:  '🏦 Crize financiare',
    pandemii_sanatate: '🦠 Pandemii / Sanatate',
    tarife_comerciale: '📦 Tarife comerciale',
    alegeri_politice:  '🗳 Alegeri / Politica',
    stiri_companie:    '📰 Stiri companie',
  };

  const factoriResult  = {};
  const weightedScores = [];
  let totalWeight      = 0;

  // ── Pasul 3: Calcul scor per factor cu medii ponderate ──
  // In loc de medie simpla, folosim media ponderata de tier-weight
  FACTORS.forEach(factor => {
    const items      = buckets[factor];
    let scorTotal    = 0;
    let weightTotal  = 0;

    items.forEach(item => {
      scorTotal   += item.scorAjust;
      weightTotal += item.weight;
    });

    // Medie ponderata (Tier1 conteaza de 3x mai mult decat Tier2)
    const scor = weightTotal > 0 ? scorTotal / weightTotal : 0;

    const w = weights[factor] ?? 1.0;
    weightedScores.push(scor * w);
    totalWeight += w;

    factoriResult[factor] = {
      scor:   +scor.toFixed(3),
      weight: +w.toFixed(1),
      label:  LABELS[factor],
      impact: scor > 0.1 ? 'bullish' : scor < -0.1 ? 'bearish' : 'neutru',
      count:  items.length,
      // Afisam stirile cele mai relevante primele (Tier1 > Tier2 > Tier3)
      stiri:  items.sort((a, b) => a.tier - b.tier || b.relevanta - a.relevanta).slice(0, 5),
    };
  });

  const globalScore = totalWeight > 0
    ? weightedScores.reduce((a, b) => a + b, 0) / totalWeight
    : 0;

  const pozitive  = FACTORS.filter(f => factoriResult[f].scor > 0.1).length;
  const negative  = FACTORS.filter(f => factoriResult[f].scor < -0.1).length;
  const rawScores = FACTORS.map(f => factoriResult[f].scor);

  return {
    ticker,
    sector,
    industry,
    sectorWeights:   weights,
    vix:             vixData,
    factori:         factoriResult,
    sentimentGlobal: +globalScore.toFixed(3),
    totalStiri:      stiriFiltrateCurate.length,  // dupa filtrare semantica
    totalBrut:       unice.length,                // inainte de filtrare
    tierStats,                                    // distributia pe tiere
    surse: {
      yahoo:         yahooNews.length,
      reuters:       reutersNews.length,
      google:        googleNews.length,
      seekingAlpha:  seekingAlphaNews.length,
      euronews:      euronewsNews.length,
    },
    scores:   rawScores,
    concluzie: globalScore > 0.1
      ? `Sentiment pozitiv (${pozitive}/7 factori bullish). Stiri favorabile pentru ${ticker} [${sector}].`
      : globalScore < -0.1
      ? `Sentiment negativ (${negative}/7 factori bearish). Precautie recomandata pentru ${ticker} [${sector}].`
      : `Sentiment neutru pentru ${ticker} [${sector}]. Factori mixti sau lipsa de stiri semnificative.`,
  };
}
