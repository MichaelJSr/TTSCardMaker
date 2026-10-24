// The Stats page's Ratings and History sections (app.js renderStatsView, after Balance), from cards.json (ratings,
// created, since) and data/analytics.json (cohorts, changes, revisions, archived; A null: the charts that need it are
// left out). Charts follow stats.js (dataviz method); DOM-free like balance.js. NOTES.md §26.
import { esc } from "./text.js";
import { chartCard as card, hbar, table, stacked, columns, scatter, heatTable, fmt } from "./stats.js";
import { diverging, legend } from "./balance.js";
import { ARCHIVE_TAGS, archiveTag } from "./changes.js";
import { TIERS, tierOf, latestBy, current, ratingDates, hasPersonal, dayLabel } from "./ratings.js";
import { date, dayOf, yearOf } from "./history.js";

const NO_BAL = "No buffs or nerfs recorded yet.", NO_HISTORY = "Needs a full-history build.";   // shared with balance.js, the person page
const STRONG = 4, WEAK = 0;                              // tierOf: Too Stronk, Plz buff
const MIN_POINTS = 10;                                   // S3: fewer rated creatures and minions, no chart
const COHORT = new Set(["creature", "creatures", "minion"]);
const KIND = { creature: "Creature", item: "Item", field: "Field card", minion: "Minion", nme: "N.M.E. item", "aux item": "Auxiliary item",
  debuff: "Debuff", buff: "Buff", creatures: "Auxiliary creature", unknown: "Other" };   // changes.js KIND_LABEL
const YEAR = 365.25 * 86400;
const round1 = v => Math.round(v * 10) / 10;
const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
const median = v => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const signed = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;
const empty = text => `<p class="bal-empty">${esc(text)}</p>`;
const link = c => `<a href="#/card/${encodeURIComponent(c.id)}">${esc(c.name)}</a>`;
/** a card's published ratings (not the signed-in editor's staged or sent ones) */
const published = c => (c.ratings?.length ? c.ratings.filter(e => !e._staged && !e._sent) : []);
const poolOf = (cards, params) => {
  const kind = params.get("kind") || "", series = params.get("series") || "";
  return cards.filter(c => !c.dup && (!kind || c.type === kind) && (!series || c.series === series));
};
/** total minus its star level's median, as built (balance.js); null outside the cohorts */
function strengthOf(A, c) {
  const a = A?.cards?.[c.id], co = a?.cohort && A.cohorts?.[a.cohort];
  if (!co) return null;
  const line = a.stats || [c.hp, c.def, c.atk, c.spd];
  return line.reduce((s, v) => s + (v ?? 0), 0) - co.total.p50;
}
/** top n keys of a Map by value, then name */
const topKeys = (m, n) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([k]) => k);
const add = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);

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

// ---- Ratings: S3, S4, S5, S7, S8, S9 -----------------------------------------------------------------------------------
/** The Ratings section; "" when no card has a published rating */
export function ratingsHtml(A, { cards, banned }, params) {
  if (!cards.some(c => published(c).length)) return "";
  const all = poolOf(cards, params), rated = all.map(c => ({ c, list: published(c) })).filter(x => x.list.length);
  const charts = [];

  // S3 rated power vs stat power: a least-squares line; labelled: the 8 farthest from it (1.5+)
  if (A) {
    const pts = [];
    for (const { c, list } of rated) {
      const s = COHORT.has(c.type) ? strengthOf(A, c) : null, r = s == null ? null : current(list, "power");
      if (r) pts.push({ c, x: round1(s), y: r.value });
    }
    if (pts.length >= MIN_POINTS) {
      const mx = mean(pts.map(p => p.x)), my = mean(pts.map(p => p.y)), sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
      const slope = sxx ? pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx : 0;
      for (const p of pts) Object.assign(p, { gap: round1(p.y - (my + slope * (p.x - mx))), jx: p.x, label: p.c.name, card: p.c.id, v: `${p.y} power` });
      for (const p of pts) p.hot = Math.abs(p.gap) >= 1.5;
      const ranked = [...pts].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.label.localeCompare(b.label));
      ranked.filter(p => p.hot).slice(0, 8).forEach(p => (p.showLabel = true));
      const lo = Math.min(...pts.map(p => p.x)), hi = Math.max(...pts.map(p => p.x)), ticks = [];
      for (let t = Math.ceil(lo / 5) * 5; t <= hi; t += 5) ticks.push(t);
      charts.push(card("rat-power", "Rated power vs stats", "Labelled: rated far from what its stats suggest.",
        scatter(pts, { xLabel: "total vs star level median", yLabel: "power rating", xTicks: ticks, xTickLabel: t => (t > 0 ? `+${t}` : String(t)),
          x0: lo - 1, x1: hi + 1, y0: 1, y1: 10, yTicks: [2, 4, 6, 8, 10] }),
        table(["Card", "Star level", "vs median", "Power rating", "Gap"], ranked.map(p => [p.c.name, p.c.stars ? `${p.c.stars}★` : "—", signed(p.x), p.y, signed(p.gap)]), 2),
        { wide: true }));
    }
  }

  // S4 favourites and least liked: bars from the mean; a card counts with the group's rating or 3+ raters
  const favs = rated.map(x => ({ ...x, r: current(x.list, "favorability") }))
    .filter(x => x.r && (x.r.raters >= 3 || latestBy(x.list, "favorability").has("group"))).sort((a, b) => b.r.value - a.r.value || a.c.name.localeCompare(b.c.name));
  if (favs.length > 1) {
    const m = mean(favs.map(x => x.r.value)), d = x => round1(x.r.value - m);
    const ups = favs.filter(x => d(x) > 0).slice(0, 10), downs = favs.filter(x => d(x) < 0).slice(-10);
    charts.push(card("rat-fav", "Favourites and least liked", `Favorability, 1–10; bars from the average (${fmt(m)}).`,
      diverging([...ups, ...downs].map(x => ({ label: x.c.name, value: d(x), id: x.c.id, tip: `${x.c.name}: ${x.r.value} favorability` })), { unit: "vs average" }),
      table(["Card", "Favorability", "Raters", "Last rated"], favs.map(x => [x.c.name, x.r.value, x.r.raters, dayLabel(x.r.date)]), 1),
      { legend: legend([["var(--s1)", "Above the average"], ["var(--s2)", "Below the average"]]) }));
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
        table(["Card", "Raters", "Spread", "Lowest", "Highest"], rows.map(r => [r.c.name, r.raters.length, round1(r.sd), r.lo, r.hi]))));
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
      table(["Card", "First", "Now", "Change", "From", "To"], moves.map(x => [x.c.name, x.from.value, x.to.value, signed(x.d), dayLabel(x.from.date), dayLabel(x.to.date)])),
      { legend: legend([["var(--s1)", "Rose"], ["var(--s2)", "Fell"]]) }));
  }

  // S8 power tier vs the ban list
  const tiers = TIERS.power.map(label => ({ label, n: 0, banned: 0 }));
  for (const { c, list } of rated) {
    const r = current(list, "power");
    if (!r) continue;
    const t = tiers[tierOf(r.value)];
    t.n++;
    if (banned.has(c.id)) t.banned++;
  }
  if (tiers.some(t => t.n)) {
    const byLabel = new Map(tiers.map(t => [t.label, t])), share = t => (t.n ? Math.round((t.banned / t.n) * 100) : 0);
    charts.push(card("rat-bans", "Power tier vs ban list", "Cards per power tier.",
      stacked(TIERS.power, [{ key: "ok", label: "Not banned", color: "var(--s1)" }, { key: "banned", label: "Banned", color: "var(--s2)" }],
        (cat, key) => { const t = byLabel.get(cat); return key === "banned" ? t.banned : t.n - t.banned; },
        { width: 560, tip: cat => { const t = byLabel.get(cat); return `${cat}: ${t.banned} of ${t.n} banned (${share(t)}%)`; } }),
      table(["Tier", "Cards", "Banned", "Share banned"], tiers.map(t => [t.label, t.n, t.banned, `${share(t)}%`])),
      { legend: legend([["var(--s1)", "Not banned"], ["var(--s2)", "Banned"]]) }));
  }

  // S9 rated Too Stronk (or Plz buff), then nerfed (buffed): the first change after the first day it was rated so
  if (A && rated.some(x => x.list.some(e => e.scale === "power"))) {
    const changesOf = id => A.cards?.[id]?.changes || [];
    const anyBal = all.some(c => changesOf(c.id).some(r => r.bal === "buff" || r.bal === "nerf"));
    const n = { strong: 0, nerfed: 0, weak: 0, buffed: 0 }, hits = [];
    if (anyBal) for (const { c, list } of rated) {
      const dates = ratingDates(list, "power");
      for (const [tier, want, key, done] of [[STRONG, "nerf", "strong", "nerfed"], [WEAK, "buff", "weak", "buffed"]]) {
        const day = dates.find(d => tierOf(current(list, "power", { day: d }).value) === tier);
        if (!day) continue;
        n[key]++;
        const row = changesOf(c.id).filter(r => r.bal === want && dayOf(r.ts) > day).sort((a, b) => a.ts - b.ts)[0];
        if (row) { n[done]++; hits.push({ c, tier, day, row }); }
      }
    }
    const total = l => l.reduce((s, v) => s + v, 0), change = h => `${h.row.bal}, total ${total(h.row.stats[0])} → ${total(h.row.stats[1])}`;
    const facts = [["Too Stronk", n.strong], ["Nerfed later", n.nerfed], ["Plz buff", n.weak], ["Buffed later", n.buffed]];
    charts.push(card("rat-nerfed", "Did Too Stronk cards get nerfed?", anyBal ? "Rated Too Stronk or Plz buff, then changed." : "",
      anyBal ? `<div class="facts">${facts.map(([l, v]) => `<span class="fact">${esc(l)} <b>${v}</b></span>`).join("")}</div>`
        + (hits.length ? `<ul class="cl-lines">${hits.map(h => `<li>${link(h.c)} <span class="muted">${esc(TIERS.power[h.tier])} ${esc(dayLabel(h.day))} · ${esc(change(h))} ${esc(date(h.row.ts))}</span></li>`).join("")}</ul>` : "")
        : empty(NO_BAL),
      anyBal && hits.length ? table(["Card", "Tier", "Rated", "Changed", "Change"], hits.map(h => [h.c.name, TIERS.power[h.tier], dayLabel(h.day), date(h.row.ts), change(h)])) : ""));
  }

  return `<h2 class="bal-title">Ratings</h2><p class="muted bal-intro">From TTS sessions and card pages.</p>
    ${charts.length ? `<div class="charts">${charts.join("")}</div>` : `<p class="muted">No rated cards in scope.</p>`}`;
}

// ---- History: S6, S10, S11, S13, S18 -----------------------------------------------------------------------------------
/** The History section */
export function historyHtml(A, { cards }, params) {
  const pool = poolOf(cards, params), charts = [];

  // S6 who changes whose cards, S10 most revised: image changes after the upload (analytics.json revisions)
  if (A && !A.revisions?.available) {
    charts.push(card("hist-who", "Who changes whose cards", "", empty(NO_HISTORY), ""), card("hist-revised", "Most revised cards", "", empty(NO_HISTORY), ""));
  } else if (A) {
    const pairs = new Map(), byAuthor = new Map(), byWho = new Map(), perCard = [];
    for (const c of pool) {
      const got = A.revisions.cards?.[c.id];
      if (!got) continue;
      const au = c.author || "Unknown";
      let n = 0;
      for (const [who, k] of Object.entries(got)) { add(pairs, `${au}\u0001${who}`, k); add(byAuthor, au, k); add(byWho, who, k); n += k; }
      perCard.push({ c, n, top: topKeys(new Map(Object.entries(got)), 1)[0] });
    }
    if (pairs.size) {
      const rowKeys = topKeys(byAuthor, 7), colKeys = topKeys(byWho, 7);
      const rows = [...rowKeys, ...(byAuthor.size > 7 ? ["Others"] : [])], cols = [...colKeys, ...(byWho.size > 7 ? ["Others"] : [])];
      const grid = new Map();
      for (const [k, n] of pairs) {
        const [au, who] = k.split("\u0001"), r = rowKeys.includes(au) ? au : "Others", c = colKeys.includes(who) ? who : "Others";
        add(grid, `${r}\u0001${c}`, n);
      }
      const rowSum = r => cols.reduce((s, c) => s + (grid.get(`${r}\u0001${c}`) || 0), 0), colSum = c => rows.reduce((s, r) => s + (grid.get(`${r}\u0001${c}`) || 0), 0);
      const body = [...rows.map(r => [r, ...cols.map(c => grid.get(`${r}\u0001${c}`) || ""), String(rowSum(r))]),
        ["All", ...cols.map(c => String(colSum(c))), String(rows.reduce((s, r) => s + rowSum(r), 0))]];
      const list = [...pairs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 60).map(([k, n]) => [...k.split("\u0001"), n]);
      charts.push(card("hist-who", "Who changes whose cards", "Rows: card author; columns: who changed the image.",
        heatTable(["Author", ...cols, "All"], body, { shade: cols.map((_, i) => i + 1), all: true }),
        table(["Author", "Changed by", "Image changes"], list, 2), { wide: true }));
      perCard.sort((a, b) => b.n - a.n || a.c.name.localeCompare(b.c.name));
      charts.push(card("hist-revised", "Most revised cards", "Image changes since upload; mass passes left out.",
        hbar(perCard.slice(0, 15).map(x => ({ label: x.c.name, value: x.n, card: x.c.id })), { labelWidth: 190, unit: "image changes" }),
        table(["Card", "Image changes", "Top committer"], perCard.map(x => [x.c.name, x.n, x.top]), 1)));
    }
  }

  // S11 cards created per year, by author: the pool's top 4, the rest as Others
  const made = pool.filter(c => c.created);
  if (made.length) {
    const byAuthor = new Map(), counts = new Map();
    for (const c of made) add(byAuthor, c.author || "");
    const top = topKeys(new Map([...byAuthor].filter(([a]) => a)), 4);
    for (const c of made) add(counts, `${c.created.slice(0, 4)}\u0001${top.includes(c.author) ? c.author : ""}`);
    const ys = made.map(c => +c.created.slice(0, 4)), years = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) years.push(String(y));
    const series = [...top.map((a, i) => ({ key: a, label: a, color: `var(--s${i + 1})` })),
      ...(made.some(c => !top.includes(c.author)) ? [{ key: "", label: "Others", color: "var(--deemph)" }] : [])];
    const get = (y, k) => counts.get(`${y}\u0001${k}`) || 0;
    charts.push(card("hist-created", "Cards created per year", "By author; the rest as Others.", stacked(years, series, get, { width: 560 }),
      table(["Year", ...series.map(s => s.label), "All"], years.map(y => [y, ...series.map(s => get(y, s.key)), series.reduce((n, s) => n + get(y, s.key), 0)])),
      { legend: legend(series.map(s => [s.color, s.label])) }));
  }

  // S13 text freshness: the year a card's ability last changed (its current text's start), else its creation
  const fresh = new Map();
  for (const c of pool) {
    if (!c.ability) continue;
    const ts = c.hv ? c.since ?? c.ts : c.created ? Date.parse(`${c.created}T12:00:00Z`) / 1000 : c.fs ?? c.ts;
    if (!ts) continue;
    const y = yearOf(ts), g = fresh.get(y) || fresh.set(y, { n: 0, ts: Infinity, c: null }).get(y);
    g.n++;
    if (ts < g.ts) Object.assign(g, { ts, c });
  }
  if (fresh.size) {
    const ys = [...fresh.keys()].map(Number), years = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) years.push(String(y));
    charts.push(card("hist-fresh", "Text freshness", "Cards by the year their ability last changed.",
      columns(years.map(y => ({ label: y, value: fresh.get(y)?.n || 0 })), { width: 560, height: 200 }),
      table(["Year", "Cards", "Oldest card that year"], years.map(y => [y, fresh.get(y)?.n || 0, fresh.get(y)?.c?.name || ""]), 1)));
  }

  // S18 retired and deleted cards (renames left out), by the year archived; life: archived minus created
  const kind = params.get("kind") || "", series = params.get("series") || "";
  const gone = (A?.archived || []).filter(r => archiveTag(r) !== "renamed" && r.at && (!kind || r.card_type === kind) && (!series || r.series === series));
  if (gone.length) {
    const label = t => ARCHIVE_TAGS.find(([k]) => k === t)[1], life = r => (r.created ? (r.at - Date.parse(`${r.created}T12:00:00Z`) / 1000) / YEAR : null);
    const per = new Map();
    for (const r of gone) add(per, `${yearOf(r.at)}\u0001${archiveTag(r)}`);
    const ys = gone.map(r => +yearOf(r.at)), years = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) years.push(String(y));
    const lives = gone.map(life).filter(v => v != null && v >= 0);
    const facts = lives.length ? `<div class="facts"><span class="fact">Median life <b>${fmt(median(lives))} years</b></span></div>` : "";
    const rows = [...gone].sort((a, b) => b.at - a.at || String(a.card).localeCompare(String(b.card)));
    charts.push(card("hist-archive", "Retired and deleted cards", "Per year; renames left out.",
      facts + stacked(years, [{ key: "retired", label: "Retired", color: "var(--s1)" }, { key: "deleted", label: "Deleted", color: "var(--s2)" }],
        (y, k) => per.get(`${y}\u0001${k}`) || 0, { width: 560 }),
      table(["Card", "Tag", "Kind", "Author", "Created", "Archived", "Life"], rows.map(r => { const l = life(r);
        return [r.title || r.card, label(archiveTag(r)), KIND[r.card_type] || r.card_type || "", r.author || "", r.created ? dayLabel(r.created) : "—", date(r.at), l == null || l < 0 ? "—" : `${fmt(l)} years`]; }), 7),
      { legend: legend([["var(--s1)", "Retired"], ["var(--s2)", "Deleted"]]) }));
  }

  return charts.length ? `<h2 class="bal-title">History</h2><div class="charts">${charts.join("")}</div>` : "";
}
