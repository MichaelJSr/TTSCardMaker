// The Stats page's Ratings and History sections (app.js renderStatsView, after Balance), from cards.json (ratings,
// created, since). Charts follow stats.js (dataviz method); DOM-free like balance.js. NOTES.md §26, §30.
import { esc } from "./text.js";
import { chartCard as card, table, stacked, columns, fmt, cardsHref } from "./stats.js";
import { diverging, legend } from "./balance.js";
import { latestBy, current, ratingDates, hasPersonal, dayLabel } from "./ratings.js";
import { yearOf } from "./history.js";

const round1 = v => Math.round(v * 10) / 10;
const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
const median = v => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const signed = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;
/** a card's published ratings (not the signed-in editor's staged or sent ones) */
const published = c => (c.ratings?.length ? c.ratings.filter(e => !e._staged && !e._sent) : []);
const poolOf = (cards, params) => {
  const kind = params.get("kind") || "", series = params.get("series") || "";
  return cards.filter(c => !c.dup && (!kind || c.type === kind) && (!series || c.series === series));
};
/** top n keys of a Map by value, then name */
const topKeys = (m, n) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([k]) => k);
const add = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
/** S13: when a card's ability last changed (its current text's start), else its creation; null without an ability */
const freshTs = c => (!c.ability ? null : (c.hv ? c.since ?? c.ts : c.created ? Date.parse(`${c.created}T12:00:00Z`) / 1000 : c.fs ?? c.ts) || null);
/** its year (app.js fresh=) */
export const freshYear = c => { const ts = freshTs(c); return ts ? yearOf(ts) : null; };

/** One row per card on a shared 1-10 axis: a dot per rater, the median as a tick. rows [{c, raters: [[by, v]], med}] */
function dotRows(rows) {
  const W = 560, labelW = 170, padR = 14, rowH = 28, axisH = 20, H = rows.length * rowH + axisH;
  const X = v => labelW + ((v - 1) / 9) * (W - labelW - padR);
  const grid = [1, 4, 7, 10].map(t => `<line class="gridline" x1="${X(t)}" x2="${X(t)}" y1="0" y2="${H - axisH}"/><text x="${X(t)}" y="${H - 6}" text-anchor="middle">${t}</text>`).join("");
  const body = rows.map((r, i) => {
    const y = i * rowH + rowH / 2, vs = r.raters.map(([, v]) => v);
    const dots = r.raters.map(([by, v]) => `<g class="dot" data-v="${esc(String(v))}" data-l="${esc(`${r.c.name} · ${by}`)}"><circle class="hit" cx="${X(v)}" cy="${y}" r="9"/><circle class="mark" cx="${X(v)}" cy="${y}" r="4" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/></g>`).join("");
    return `<g class="row" data-card="${esc(r.c.id)}" data-v="${esc(`spread ${fmt(r.sd)}`)}" data-l="${esc(`${r.c.name}: ${r.raters.length} raters, median ${fmt(r.med)}`)}">
      <rect class="hit" x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}"/>
      <text class="lbl" x="${labelW - 8}" y="${y + 4}" text-anchor="end">${esc(r.c.name.length > 24 ? `${r.c.name.slice(0, 23)}…` : r.c.name)}</text>
      <line class="axis" x1="${X(Math.min(...vs))}" x2="${X(Math.max(...vs))}" y1="${y}" y2="${y}"/>
      <line class="median" x1="${X(r.med)}" x2="${X(r.med)}" y1="${y - 8}" y2="${y + 8}"/>${dots}</g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${body}</svg>`;
}

// ---- Ratings: S4, S5, S7 --------------------------------------------------------------------------------------------------
/** The Ratings section; "" when no card has a published rating */
export function ratingsHtml({ cards }, params) {
  if (!cards.some(c => published(c).length)) return "";
  const all = poolOf(cards, params), rated = all.map(c => ({ c, list: published(c) })).filter(x => x.list.length);
  const charts = [];

  // S4 favourites and least liked: bars from the mean; a card counts with the group's rating or 3+ raters
  const favs = rated.map(x => ({ ...x, r: current(x.list, "favorability") }))
    .filter(x => x.r && (x.r.raters >= 3 || latestBy(x.list, "favorability").has("group"))).sort((a, b) => b.r.value - a.r.value || a.c.name.localeCompare(b.c.name));
  if (favs.length > 1) {
    const m = mean(favs.map(x => x.r.value)), d = x => round1(x.r.value - m);
    const ups = favs.filter(x => d(x) > 0).slice(0, 10), downs = favs.filter(x => d(x) < 0).slice(-10);
    charts.push(card("rat-fav", "Favourites and least liked", `Favorability, 1–10; bars from the average (${fmt(m)}).`,
      diverging([...ups, ...downs].map(x => ({ label: x.c.name, value: d(x), id: x.c.id, tip: `${x.c.name}: ${x.r.value} favorability` })), { unit: "vs average" }),
      table(["Card", { label: "Favorability", tip: "Mean of each rater's latest favorability, 1–10; a group rating counts as one rater" },
        { label: "Raters", tip: "People who rated its favorability; a TTS session's group counts as one" },
        { label: "Last rated", tip: "Date of the newest rating counted" }], favs.map(x => [x.c.name, x.r.value, x.r.raters, dayLabel(x.r.date)]), 1),
      { tip: "Cards with a group rating or 3+ raters; bars: favorability minus these cards' average", legend: legend([["var(--s1)", "Above the average"], ["var(--s2)", "Below the average"]]) }));
  }

  // S5 most divisive: people's latest favorability (not the group's), 3+ of them; spread = population SD
  if (hasPersonal(all, "favorability")) {
    const rows = [];
    for (const { c, list } of rated) {
      const by = latestBy(list, "favorability", { skip: "group" });
      if (by.size < 3) continue;
      const raters = [...by].map(([who, e]) => [who, e.value]), v = raters.map(([, x]) => x), m = mean(v);
      rows.push({ c, raters, sd: Math.sqrt(mean(v.map(x => (x - m) ** 2))), med: median(v), lo: Math.min(...v), hi: Math.max(...v) });
    }
    if (rows.length) {
      rows.sort((a, b) => b.sd - a.sd || a.c.name.localeCompare(b.c.name));
      charts.push(card("rat-divisive", "Most divisive", "Spread of raters' favorability; 3+ raters.", dotRows(rows.slice(0, 10)),
        table(["Card", { label: "Raters", tip: "People with a favorability rating; group ratings not counted" },
          { label: "Spread", tip: "Standard deviation of each person's latest favorability; group ratings left out" }, "Lowest", "Highest"], rows.map(r => [r.c.name, r.raters.length, round1(r.sd), r.lo, r.hi]))));
    }
  }

  // S7 risers and fallers: favorability at its first date vs now, 0.5+ apart
  const moves = [];
  for (const { c, list } of rated) {
    const dates = ratingDates(list, "favorability");
    if (dates.length < 2) continue;
    const from = current(list, "favorability", { day: dates[0] }), to = current(list, "favorability"), d = round1(to.value - from.value);
    if (Math.abs(d) >= 0.5) moves.push({ c, from, to, d });
  }
  if (moves.length) {
    moves.sort((a, b) => b.d - a.d || a.c.name.localeCompare(b.c.name));
    const bars = [...moves.filter(x => x.d > 0).slice(0, 8), ...moves.filter(x => x.d < 0).slice(-8)];
    charts.push(card("rat-movers", "Risers and fallers", "Favorability, first rating to now.",
      diverging(bars.map(x => ({ label: x.c.name, value: x.d, id: x.c.id, tip: `${x.c.name}: ${x.from.value} → ${x.to.value} (${dayLabel(x.from.date)} → ${dayLabel(x.to.date)})` })), { unit: "favorability" }),
      table(["Card", { label: "First", tip: "Favorability on its first rating day: the mean of that day's ratings" },
        { label: "Now", tip: "Mean of each rater's latest favorability" }, "Change", "From", { label: "To", tip: "Date of the newest rating counted in Now" }], moves.map(x => [x.c.name, x.from.value, x.to.value, signed(x.d), dayLabel(x.from.date), dayLabel(x.to.date)])),
      { tip: "Cards whose favorability moved 0.5 or more since their first rating day", legend: legend([["var(--s1)", "Rose"], ["var(--s2)", "Fell"]]) }));
  }

  return `<h2 class="bal-title">Ratings</h2><p class="muted bal-intro">From TTS sessions and card pages.</p>
    ${charts.length ? `<div class="charts">${charts.join("")}</div>` : `<p class="muted">No rated cards in scope.</p>`}`;
}

// ---- History: S11, S13 -----------------------------------------------------------------------------------------------------
/** The History section */
export function historyHtml({ cards }, params) {
  const pool = poolOf(cards, params), charts = [], L = p => cardsHref(p, params);

  // S11 cards created per year, by author (owner 10-31: every author): a colour each by their rank over all cards, so a
  // filter never repaints one; past the eight colours, the rest as Others
  const made = pool.filter(c => c.created);
  if (made.length) {
    const all = new Map(), counts = new Map();
    for (const c of cards) if (!c.dup && c.author) add(all, c.author);
    const ranked = topKeys(all, 8), here = new Set(made.map(c => c.author)), top = ranked.filter(a => here.has(a));
    for (const c of made) add(counts, `${c.created.slice(0, 4)}\u0001${top.includes(c.author) ? c.author : ""}`);
    const ys = made.map(c => +c.created.slice(0, 4)), years = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) years.push(String(y));
    const series = [...top.map(a => ({ key: a, label: a, color: `var(--s${ranked.indexOf(a) + 1})` })),
      ...(made.some(c => !top.includes(c.author)) ? [{ key: "", label: "Others", color: "var(--deemph)" }] : [])];
    const get = (y, k) => counts.get(`${y}\u0001${k}`) || 0;
    const href = (y, k) => (k === "" ? null : L({ q: `created==${y}`, author: k }));     // Others: no filter
    charts.push(card("hist-created", "Cards created per year", "By author.", stacked(years, series, get, { width: 560, href }),
      table(["Year", ...series.map(s => s.label), "All"], years.map(y => [y, ...series.map(s => get(y, s.key)), series.reduce((n, s) => n + get(y, s.key), 0)])),
      { tip: "Cards by the year they were created, as on their card pages; each author a colour of their own", legend: legend(series.map(s => [s.color, s.label, "", s.key ? L({ author: s.key }) : null])) }));
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
