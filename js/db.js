// ─────────────────────────────────────────────────────
//  DB.JS — SQLite local via sql.js + IndexedDB persistence
//  Salveaza/incarca simulari Monte Carlo fara recalcul
// ─────────────────────────────────────────────────────

const IDB_STORE = 'mc_stocks_db';
const IDB_KEY   = 'sqliteDB';
const SQLJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.js';
const WASM_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.wasm';

let _db  = null;
let _SQL = null;

// ── Incarcare sql.js din CDN ──────────────────────────

function loadSqlJsScript() {
  if (window.initSqlJs) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s   = document.createElement('script');
    s.src     = SQLJS_CDN;
    s.onload  = resolve;
    s.onerror = () => reject(new Error('sql.js CDN indisponibil'));
    document.head.appendChild(s);
  });
}

// ── IndexedDB helpers ─────────────────────────────────

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_STORE, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('data');
    req.onsuccess       = e => resolve(e.target.result);
    req.onerror         = e => reject(e.target.error);
  });
}

async function idbGet(key) {
  const idb = await idbOpen();
  const tx  = idb.transaction('data', 'readonly');
  return new Promise((resolve, reject) => {
    const req = tx.objectStore('data').get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = reject;
  });
}

async function idbPut(key, value) {
  const idb = await idbOpen();
  const tx  = idb.transaction('data', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = tx.objectStore('data').put(value, key);
    req.onsuccess = resolve;
    req.onerror   = reject;
  });
}

// ── Schema SQL ────────────────────────────────────────

function createSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS simulations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker          TEXT    NOT NULL,
      name            TEXT,
      price           REAL,
      currency        TEXT,
      simulated_at    TEXT,
      drift           REAL,
      sigma           REAL,
      nu              REAL,
      garch_sigma0    REAL,
      garch_pers      REAL,
      iv_annual       REAL,
      skew            REAL,
      vol_annual      REAL,
      vix             REAL,
      deviation_pct   REAL,
      vol_trend       TEXT,
      sent_global     REAL,
      sent_conclusion TEXT
    );

    CREATE TABLE IF NOT EXISTS period_predictions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      simulation_id INTEGER REFERENCES simulations(id) ON DELETE CASCADE,
      days          INTEGER,
      mean          REAL,
      median        REAL,
      p10           REAL,
      p90           REAL,
      max_val       REAL,
      min_val       REAL,
      prob_profit   REAL,
      prob_gain10   REAL,
      prob_loss10   REAL,
      adj_mean      REAL,
      adj_p10       REAL,
      adj_p90       REAL,
      percs_json    TEXT
    );

    CREATE TABLE IF NOT EXISTS valuation_results (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      simulation_id  INTEGER REFERENCES simulations(id) ON DELETE CASCADE,
      sector         TEXT,
      weighted_value REAL,
      margin_safety  REAL,
      ai_total       REAL,
      ai_verdict     TEXT,
      ai_confidence  REAL
    );

    CREATE INDEX IF NOT EXISTS idx_sim_ticker ON simulations(ticker);
    CREATE INDEX IF NOT EXISTS idx_sim_date   ON simulations(simulated_at);
  `);
}

// ── Init DB ───────────────────────────────────────────

export async function initDB() {
  if (_db) return _db;
  await loadSqlJsScript();
  _SQL = await window.initSqlJs({ locateFile: () => WASM_URL });

  const saved = await idbGet(IDB_KEY);
  if (saved) {
    _db = new _SQL.Database(saved);
    createSchema(_db); // asigura schema e up-to-date
  } else {
    _db = new _SQL.Database();
    createSchema(_db);
  }
  return _db;
}

// ── Persist in IndexedDB ──────────────────────────────

export async function persistDB() {
  if (!_db) return;
  try {
    await idbPut(IDB_KEY, _db.export());
  } catch (e) {
    console.warn('persistDB error:', e);
  }
}

// ── Salveaza simulare ─────────────────────────────────
// extra = { ivAnnual, skew, vix, deviationPct, volTrend, valuation }

export async function saveSimulation({ stock, periodResults, sentimentData, drift, sigma, nu, garch, extra = {} }) {
  if (!_db) await initDB();

  const { currentPrice, currency, name, ticker } = stock;
  const now  = new Date().toISOString();
  const sent = sentimentData;

  _db.run(
    `INSERT INTO simulations
       (ticker, name, price, currency, simulated_at,
        drift, sigma, nu, garch_sigma0, garch_pers,
        iv_annual, skew, vol_annual, vix,
        deviation_pct, vol_trend, sent_global, sent_conclusion)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ticker,
      name ?? ticker,
      currentPrice,
      currency ?? 'USD',
      now,
      drift           ?? null,
      sigma           ?? null,
      nu              ?? null,
      garch?.sigma0   ?? null,
      garch?.persistence ?? null,
      extra.ivAnnual  ?? null,
      extra.skew      ?? null,
      sigma != null ? +(sigma * Math.sqrt(252)).toFixed(4) : null,
      extra.vix       ?? sent?.vix?.vix ?? null,
      extra.deviationPct ?? null,
      extra.volTrend  ?? null,
      sent?.sentimentGlobal ?? null,
      sent?.concluzie ?? null,
    ]
  );

  const simId = _db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  // ── Perioadele de predictie ───────────────────────
  for (const [daysStr, pd] of Object.entries(periodResults)) {
    if (!pd?.stats) continue;
    const s    = pd.stats;
    const sa   = pd.statsAdj;
    const days = parseInt(daysStr);

    // Comprima percs: pastreaza max 120 puncte per traiectorie
    let percsJson = null;
    if (pd.percs) {
      const compact = {};
      for (const [pct, arr] of Object.entries(pd.percs)) {
        const a    = Array.from(arr);
        const step = Math.max(1, Math.floor(a.length / 120));
        compact[pct] = a
          .filter((_, i) => i % step === 0 || i === a.length - 1)
          .map(v => Math.round(v * 100) / 100);
      }
      percsJson = JSON.stringify(compact);
    }

    _db.run(
      `INSERT INTO period_predictions
         (simulation_id, days, mean, median, p10, p90, max_val, min_val,
          prob_profit, prob_gain10, prob_loss10,
          adj_mean, adj_p10, adj_p90, percs_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        simId, days,
        s.mean    ?? null, s.median ?? null,
        s.p10     ?? null, s.p90    ?? null,
        s.max     ?? null, s.min    ?? null,
        s.probProfit  ?? null,
        s.probGain10  ?? null,
        s.probLoss10  ?? null,
        sa?.mean  ?? null,
        sa?.p10   ?? null,
        sa?.p90   ?? null,
        percsJson,
      ]
    );
  }

  // ── Valuare (optional) ───────────────────────────
  if (extra.valuation) {
    const v = extra.valuation;
    _db.run(
      `INSERT INTO valuation_results
         (simulation_id, sector, weighted_value, margin_safety,
          ai_total, ai_verdict, ai_confidence)
       VALUES (?,?,?,?,?,?,?)`,
      [
        simId,
        v.sector         ?? null,
        v.weightedValue  ?? null,
        v.marginOfSafety ?? null,
        v.aiTotal        ?? null,
        v.aiVerdict      ?? null,
        v.aiConfidence   ?? null,
      ]
    );
  }

  await persistDB();
  return simId;
}

// ── Lista simulari ────────────────────────────────────

export function listSimulations(ticker = null) {
  if (!_db) return [];
  const sql = ticker
    ? `SELECT id, ticker, name, price, currency, simulated_at,
              sigma, drift, iv_annual, sent_global, vol_trend
       FROM simulations
       WHERE ticker = ?
       ORDER BY simulated_at DESC`
    : `SELECT id, ticker, name, price, currency, simulated_at,
              sigma, drift, iv_annual, sent_global, vol_trend
       FROM simulations
       ORDER BY simulated_at DESC
       LIMIT 200`;

  const result = _db.exec(sql, ticker ? [ticker.toUpperCase()] : []);
  if (!result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(row =>
    Object.fromEntries(cols.map((c, i) => [c, row[i]]))
  );
}

// ── Incarca o simulare completa ───────────────────────

export function loadSimulation(id) {
  if (!_db) return null;

  const simRes = _db.exec(`SELECT * FROM simulations WHERE id = ?`, [id]);
  if (!simRes.length) return null;
  const simCols = simRes[0].columns;
  const sim     = Object.fromEntries(simCols.map((c, i) => [c, simRes[0].values[0][i]]));

  const predRes = _db.exec(
    `SELECT * FROM period_predictions WHERE simulation_id = ? ORDER BY days`, [id]
  );
  const periods = {};
  if (predRes.length) {
    const pCols = predRes[0].columns;
    predRes[0].values.forEach(row => {
      const p    = Object.fromEntries(pCols.map((c, i) => [c, row[i]]));
      const days = p.days;
      const percs = p.percs_json ? JSON.parse(p.percs_json) : null;
      periods[days] = {
        days,
        currentPrice: sim.price,
        currency:     sim.currency,
        ticker:       sim.ticker,
        stats: {
          mean:       p.mean,
          median:     p.median,
          p10:        p.p10,
          p90:        p.p90,
          max:        p.max_val,
          min:        p.min_val,
          probProfit: p.prob_profit,
          probGain10: p.prob_gain10,
          probLoss10: p.prob_loss10,
          finals: null, // nu e stocat (prea mare)
        },
        statsAdj: (p.adj_mean != null) ? {
          mean: p.adj_mean,
          p10:  p.adj_p10,
          p90:  p.adj_p90,
        } : null,
        percs,
      };
    });
  }

  const valRes = _db.exec(
    `SELECT * FROM valuation_results WHERE simulation_id = ?`, [id]
  );
  let valuation = null;
  if (valRes.length) {
    const vCols = valRes[0].columns;
    valuation = Object.fromEntries(vCols.map((c, i) => [c, valRes[0].values[0][i]]));
  }

  return { sim, periods, valuation };
}

// ── Sterge o simulare ─────────────────────────────────

export function deleteSimulation(id) {
  if (!_db) return;
  _db.run(`DELETE FROM simulations WHERE id = ?`, [id]);
  persistDB();
}

// ── Tickere unice (pentru autocomplete) ──────────────

export function listTickers() {
  if (!_db) return [];
  const res = _db.exec(
    `SELECT DISTINCT ticker, name FROM simulations ORDER BY ticker`
  );
  if (!res.length) return [];
  return res[0].values.map(([ticker, name]) => ({ ticker, name }));
}

// ── Export / Import .sqlite ───────────────────────────

export function exportDB() {
  if (!_db) return;
  const data = _db.export();
  const blob = new Blob([data], { type: 'application/x-sqlite3' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mc_stocks_${new Date().toISOString().slice(0, 10)}.sqlite`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importDB(file) {
  await loadSqlJsScript();
  if (!_SQL) _SQL = await window.initSqlJs({ locateFile: () => WASM_URL });
  const buf = await file.arrayBuffer();
  _db = new _SQL.Database(new Uint8Array(buf));
  createSchema(_db); // asigura indexi etc.
  await persistDB();
  return _db;
}
