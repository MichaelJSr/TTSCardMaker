// The Stats page's History section (app.js renderStatsView, after Balance), from cards.json (created, since). Charts
// follow stats.js (dataviz method); DOM-free like balance.js. NOTES.md §26, §30.
import { chartCard as card, table, stacked, columns, cardsHref } from "./stats.js";
import { legend } from "./balance.js";
import { yearOf } from "./history.js";

const poolOf = (cards, params) => {
  const kind = params.get("kind") || "", series = params.get("series") || "";
  return cards.filter(c => !c.dup && (!kind || c.type === kind) && (!series || c.series === series));
};
/** top n keys of a Map by value, then name */
const topKeys = (m, n) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([k]) => k);
const add = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
// S11's author colours: pinned ones, then --s1…--s4 by rank, then these (purple, light green, brick red: chosen far
// from those four and the pink, in both themes)
const AUTHOR_COLOUR = { Zomoroko: "#ffa9e2" }, AUTHOR_EXTRA = ["#9c27b0", "#aed581", "#a52a2a"];
/** S13: when a card's ability last changed (its current text's start), else its creation; null without an ability */
const freshTs = c => (!c.ability ? null : (c.hv ? c.since ?? c.ts : c.created ? Date.parse(`${c.created}T12:00:00Z`) / 1000 : c.fs ?? c.ts) || null);
/** its year (app.js fresh=) */
export const freshYear = c => { const ts = freshTs(c); return ts ? yearOf(ts) : null; };

// ---- History: S11, S13 -----------------------------------------------------------------------------------------------------
/** The History section */
export function historyHtml({ cards }, params) {
  const pool = poolOf(cards, params), charts = [], L = p => cardsHref(p, params);

  // S11 cards created per year, by author (owner 10-31: every author, none too alike, Zomoroko #ffa9e2): colours by rank
  // over all cards, so a filter never repaints one; past the eight, the rest as Others
  const made = pool.filter(c => c.created);
  if (made.length) {
    const all = new Map(), counts = new Map();
    for (const c of cards) if (!c.dup && c.author) add(all, c.author);
    const ranked = topKeys(all, 8), here = new Set(made.map(c => c.author)), top = ranked.filter(a => here.has(a));
    const free = [...[1, 2, 3, 4].map(i => `var(--s${i})`), ...AUTHOR_EXTRA], colour = new Map();
    for (const a of ranked) colour.set(a, AUTHOR_COLOUR[a] || free.shift());
    for (const c of made) add(counts, `${c.created.slice(0, 4)}\u0001${top.includes(c.author) ? c.author : ""}`);
    const ys = made.map(c => +c.created.slice(0, 4)), years = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) years.push(String(y));
    const series = [...top.map(a => ({ key: a, label: a, color: colour.get(a) })),
      ...(made.some(c => !top.includes(c.author)) ? [{ key: "", label: "Others", color: "var(--deemph)" }] : [])];
    const get = (y, k) => counts.get(`${y}\u0001${k}`) || 0;
    const href = (y, k) => (k === "" ? null : L({ q: `created==${y}`, author: k }));     // Others: no filter
    charts.push(card("hist-created", "Cards created per year", "By author.", stacked(years, series, get, { width: 560, href }),
      table(["Year", ...series.map(s => s.label), "All"], years.map(y => [y, ...series.map(s => get(y, s.key)), series.reduce((n, s) => n + get(y, s.key), 0)])),
      { tip: "Cards by the year they were created, as on their card pages; each author a colour of their own", legend: legend(series.map(s => [s.color, s.label, s.key ? L({ author: s.key }) : null])) }));
  }

  // S13 text freshness: the year a card's ability last changed (its current text's start), else its creation
  const fresh = new Map();
  for (const c of pool) {
    const ts = freshTs(c);
    if (!ts) continue;
    const y = yearOf(ts), g = fresh.get(y) || fresh.set(y, { n: 0, ts: Infinity, c: null }).get(y);
    g.n++;
    if (ts < g.ts) Object.assign(g, { ts, c });
  }
  if (fresh.size) {
    const ys = [...fresh.keys()].map(Number), years = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) years.push(String(y));
    charts.push(card("hist-fresh", "Text freshness", "Cards by the year their ability last changed.",
      columns(years.map(y => ({ label: y, value: fresh.get(y)?.n || 0, href: L({ fresh: y }) })), { width: 560, height: 200 }),
      table(["Year", "Cards", { label: "Oldest card that year", tip: "The card whose current text started earliest that year" }], years.map(y => [y, fresh.get(y)?.n || 0, fresh.get(y)?.c?.name || ""]), 1),
      { tip: "The year each card's current ability text started; without text history, the year it was created" }));
  }

  return charts.length ? `<h2 class="bal-title">History</h2><div class="charts">${charts.join("")}</div>` : "";
}
