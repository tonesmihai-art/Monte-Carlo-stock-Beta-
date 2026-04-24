// ─────────────────────────────────────────────────────
//  STORAGE.JS — localStorage: istoric + watchlist
//  Nu atinge DOM-ul — functii pure de date.
// ─────────────────────────────────────────────────────

export const ISTORIC_KEY  = 'istoricSimulari';
export const WATCHLIST_KEY = 'watchlistUrmarit';
const MAX_ISTORIC = 30;

// ── Istoric simulari ─────────────────────────────────

export function loadIstoric() {
  try { return JSON.parse(localStorage.getItem(ISTORIC_KEY)) || []; }
  catch { return []; }
}

export function saveIstoric(ticker, pret) {
  let istoric = loadIstoric();
  istoric     = istoric.filter(item => item.ticker !== ticker);
  istoric.unshift({
    ticker,
    pret,
    timestamp: new Date().toLocaleString('ro-RO', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }),
  });
  localStorage.setItem(ISTORIC_KEY, JSON.stringify(istoric.slice(0, MAX_ISTORIC)));
}

// ── Watchlist ────────────────────────────────────────

export function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY)) || []; }
  catch { return []; }
}

export function saveToWatchlist(entry) {
  let list = loadWatchlist();
  list     = list.filter(e => e.ticker !== entry.ticker);
  list.unshift(entry);
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}
