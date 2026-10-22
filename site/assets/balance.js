// Balance: the Stats page's Balance section and each card's Balance block, from data/analytics.json (build/analytics.py).
// Charts follow stats.js (dataviz method): thin marks, hairline grid, legends for two series, a table view for each.
// DOM-free: every function returns HTML, every string goes through esc.
import { esc, diffWords, badgeHtml, tagInfo } from "./text.js";
import { chartCard as card, hbar, table, stacked, fmt, trunc } from "./stats.js";

const KIND = { creature: "creature", minion: "minion", creatures: "auxiliary creature" };
const KINDS = { creature: "creatures", minion: "minions" };
const ITEM_KIND = { creature: "Creature", item: "Item", field: "Field card", minion: "Minion", nme: "N.M.E. item", "aux item": "Auxiliary item",
  debuff: "Debuff", buff: "Buff", creatures: "Auxiliary creature", rulebook: "Rulebook page", unknown: "Other" };
const STATS = [["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"]];
// days and months in one fixed zone, the bot's TIMEZONE (analytics.py ZONE), so every viewer sees the same waves
const TZ = "America/Los_Angeles";
const day = ts => new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: TZ });
const ymd = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });
const dayKey = ts => { const p = Object.fromEntries(ymd.formatToParts(new Date(ts * 1000)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
const monthKey = ts => dayKey(ts).slice(0, 7);
const monthLabel = key => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }); };
const monthsFrom = (first, last) => {
  const out = [];
  for (let [y, m] = first.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= last; m === 12 ? (y++, (m = 1)) : m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
};
const WAVE = 5;                                          // cards on one day that make a wave of the cooldown update
const plural = (n, one, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "3★ creatures", "all minions" for a cohort key */
export function cohortName(key, cohort) {
  const [kind, stars] = key.split("|");
  return stars === "all" ? `all ${KINDS[kind] || kind}` : `${stars}★ ${KINDS[kind] || kind}`;
}
/** the analytics of a card (a duplicate has its original's) */
export function cardData(A, c, byId) {
  if (!A || !c) return null;
  return A.cards[c.id] || (c.dup && A.cards[c.dup]) || null;
}
/** a change row's kind for the monthly chart: each counted once */
export function changeKind(r) {
  if (r.stats || r.lines) return "stats";
  if (r.words) return "text";
  if (r.tags) return "tags";
  return "other";
}
/** changes to how a card plays (analytics.py reworked): not a series, spacing or timing-tag rename alone */
export const isRework = r => !!(r.words || r.stats || r.stars || r.kind || r.sub || r.types || r.lines);
const runTags = run => [...run.matchAll(/\(([^()]+)\)/g)].map(m => m[1]);
const runHtml = run => runTags(run).map(t => badgeHtml(t)).join("") || `<span class="muted">none</span>`;
const groupOf = run => tagInfo(runTags(run)[0] || "")?.group;

// ---- chart pieces -------------------------------------------------------------------------------------------------
const legend = items => `<div class="legend">${items.map(([color, label, shape]) => `<span><i style="background:${color}${shape === "line" ? ";height:3px;vertical-align:3px" : ""}"></i>${esc(label)}</span>`).join("")}</div>`;

/** One row per cohort: the middle 80% as a band, the median as a tick, the lowest to highest as a hairline, and the
    top and bottom 10% of the cards in scope as dots. rows: [{label, q:{p10,p50,p90}, lo, hi, dots:[{v,id,name,hot}]}] */
function strips(rows) {
  const W = 1000, labelW = 170, padR = 30, rowH = 40, top = 6, axisH = 26, H = top + rows.length * rowH + axisH;
  const lo = Math.floor(Math.min(...rows.map(r => r.lo))) - 1, hi = Math.ceil(Math.max(...rows.map(r => r.hi))) + 1;
  const X = v => labelW + ((v - lo) / Math.max(1, hi - lo)) * (W - labelW - padR);
  const step = hi - lo > 30 ? 10 : 5, ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const grid = ticks.map(t => `<line class="gridline" x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H - axisH}"/><text x="${X(t)}" y="${H - 8}" text-anchor="middle">${t}</text>`).join("");
  const body = rows.map((r, i) => {
    const y = top + i * rowH + rowH / 2, { p10, p50, p90 } = r.q;
    const dots = r.dots.map((d, k) => {
      const cy = y + ((k % 5) - 2) * 3;
      return `<g class="dot" data-card="${esc(d.id)}" data-v="${esc(`${d.v} total`)}" data-l="${esc(`${d.name} · ${d.hot === "top" ? "top" : "bottom"} 10% of ${r.label}`)}">
        <circle class="hit" cx="${X(d.v)}" cy="${cy}" r="11"/><circle class="mark" cx="${X(d.v)}" cy="${cy}" r="4" fill="var(${d.hot === "top" ? "--s1" : "--s2"})" stroke="var(--surface)" stroke-width="2"/></g>`;
    }).join("");
    return `<g class="row" data-v="${esc(`median ${fmt(p50)}`)}" data-l="${esc(`${r.label} (${r.n}): middle 80% ${fmt(p10)}–${fmt(p90)}, lowest ${r.lo}, highest ${r.hi}`)}">
      <rect class="hit" x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}"/>
      <text class="lbl" x="${labelW - 10}" y="${y + 4}" text-anchor="end">${esc(trunc(`${r.label} (${r.n})`, 26))}</text>
      <line class="axis" x1="${X(r.lo)}" x2="${X(r.hi)}" y1="${y}" y2="${y}"/>
      <rect class="band" x="${X(p10)}" y="${y - 6}" width="${Math.max(2, X(p90) - X(p10))}" height="12" rx="4"/>
      <line class="median" x1="${X(p50)}" x2="${X(p50)}" y1="${y - 10}" y2="${y + 10}"/>
      <text class="val" x="${X(p50)}" y="${y - 13}" text-anchor="middle">${esc(fmt(p50))}</text></g>${dots}`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" class="strips">${grid}${body}</svg>`;
}

/** Bars to both sides of a centre line: rows [{label, value, id}] (value > 0 right in --s1, < 0 left in --s2) */
function diverging(rows, { unit = "", labelW = 200 } = {}) {
  const rowH = 24, bar = 14, W = 560, plotW = W - labelW - 40, mid = labelW + plotW / 2;
  const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));
  const H = rows.length * rowH + 4;
  const parts = rows.map((r, i) => {
    const y = i * rowH, w = (Math.abs(r.value) / max) * (plotW / 2 - 34), up = r.value > 0, x = up ? mid : mid - w, by = y + (rowH - bar) / 2;
    const d = up ? `M${x},${by}H${x + w - 4}Q${x + w},${by} ${x + w},${by + 4}V${by + bar - 4}Q${x + w},${by + bar} ${x + w - 4},${by + bar}H${x}Z`
      : `M${mid},${by}H${x + 4}Q${x},${by} ${x},${by + 4}V${by + bar - 4}Q${x},${by + bar} ${x + 4},${by + bar}H${mid}Z`;
    const v = `${r.value > 0 ? "+" : r.value < 0 ? "\u2212" : ""}${fmt(Math.abs(r.value))}`;
    return `<g class="row" data-card="${esc(r.id)}" data-v="${esc(`${v} ${unit}`)}" data-l="${esc(r.tip || r.label)}">
      <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}"/>
      <text class="lbl" x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(trunc(r.label, 30))}</text>
      ${w > 0 ? `<path class="mark" d="${d}" fill="var(${up ? "--s1" : "--s2"})"/>` : ""}
      <text class="val" x="${up ? x + w + 5 : x - 5}" y="${y + rowH / 2 + 4}" text-anchor="${up ? "start" : "end"}">${esc(v)}</text></g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img"><line class="axis" x1="${mid}" x2="${mid}" y1="0" y2="${H - 4}"/>${parts.join("")}</svg>`;
}

/** Columns up (a) and down (b) from one baseline, by month: [{label, up, down, tip}] */
function updown(cols, { every = 1 } = {}) {
  const W = 1000, padL = 36, H = 220, axisH = 26, plotH = H - axisH, mid = plotH / 2;
  const max = Math.max(1, ...cols.flatMap(c => [c.up, c.down]));
  const band = (W - padL) / Math.max(1, cols.length), bw = Math.min(24, band * 0.7);
  const Y = v => (v / max) * (mid - 6);
  const grid = [max, 0, max].map((t, k) => { const y = k === 0 ? mid - Y(max) : k === 1 ? mid : mid + Y(max);
    return `<line class="${k === 1 ? "axis" : "gridline"}" x1="${padL}" x2="${W}" y1="${y}" y2="${y}"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${k === 1 ? 0 : t}</text>`; }).join("");
  const parts = cols.map((c, i) => {
    const x = padL + i * band + (band - bw) / 2, hu = Y(c.up), hd = Y(c.down), r = 4;
    const upPath = hu > 0 ? `M${x},${mid}V${mid - hu + Math.min(r, hu)}Q${x},${mid - hu} ${x + Math.min(r, bw / 2)},${mid - hu}H${x + bw - Math.min(r, bw / 2)}Q${x + bw},${mid - hu} ${x + bw},${mid - hu + Math.min(r, hu)}V${mid}Z` : "";
    const downPath = hd > 0 ? `M${x},${mid + 2}V${mid + hd - Math.min(r, hd)}Q${x},${mid + hd} ${x + Math.min(r, bw / 2)},${mid + hd}H${x + bw - Math.min(r, bw / 2)}Q${x + bw},${mid + hd} ${x + bw},${mid + hd - Math.min(r, hd)}V${mid + 2}Z` : "";
    return `<g class="col" data-v="${esc(`${c.up} up · ${c.down} down`)}" data-l="${esc(c.tip || c.label)}">
      <rect class="hit" x="${padL + i * band}" y="0" width="${band}" height="${plotH}"/>
      ${upPath ? `<path class="mark" d="${upPath}" fill="var(--s1)"/>` : ""}${downPath ? `<path class="mark" d="${downPath}" fill="var(--s2)"/>` : ""}
      ${i % every === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(c.label)}</text>` : ""}</g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${parts}</svg>`;
}

/** One small chart per cohort over the months: the average total as a line, the middle 80% as a band; months with
    fewer than `min` cards are left out. panels: [{label, points: [[n, mean, p10, p50, p90] | null]}] */
function multiples(months, panels, min) {
  const vals = panels.flatMap(p => p.points.filter(x => x && x[0] >= min).flatMap(x => [x[2], x[4]]));
  if (!vals.length) return "";
  const lo = Math.floor(Math.min(...vals) / 5) * 5, hi = Math.max(lo + 5, Math.ceil(Math.max(...vals) / 5) * 5);
  const W = 320, H = 150, padL = 28, padR = 34, axisH = 20, plotH = H - axisH - 8;
  const X = i => padL + (months.length < 2 ? 0 : (i / (months.length - 1)) * (W - padL - padR)), Y = v => 8 + plotH - ((v - lo) / (hi - lo)) * plotH;
  const ticks = (hi - lo) % 10 === 0 ? [lo, (lo + hi) / 2, hi] : [lo, hi];
  return panels.map(p => {
    const ok = p.points.map((x, i) => (x && x[0] >= min ? [i, x] : null));
    const runs = [];
    for (const pt of ok) { if (!pt) { if (runs.length && runs[runs.length - 1].length) runs.push([]); continue; } if (!runs.length) runs.push([]); runs[runs.length - 1].push(pt); }
    const segs = runs.filter(r => r.length);
    const band = segs.map(r => `<path class="area" d="M${r.map(([i, x]) => `${X(i)},${Y(x[4])}`).join("L")}L${r.slice().reverse().map(([i, x]) => `${X(i)},${Y(x[2])}`).join("L")}Z"/>`).join("");
    const line = segs.map(r => `<path class="line" d="M${r.map(([i, x]) => `${X(i)},${Y(x[1])}`).join("L")}"/>`).join("");
    const last = ok.filter(Boolean).pop();
    const hits = ok.map((pt, i) => (pt ? `<rect class="hit" x="${X(i) - (W - padL - padR) / Math.max(1, months.length - 1) / 2}" y="0" width="${(W - padL - padR) / Math.max(1, months.length - 1)}" height="${H - axisH}" data-v="${esc(`average ${fmt(pt[1][1])}`)}" data-l="${esc(`${monthLabel(months[i])} · ${p.label}: ${pt[1][0]} cards, middle 80% ${fmt(pt[1][2])}–${fmt(pt[1][4])}`)}"/>` : "")).join("");
    const grid = ticks.map(t => `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${padL - 5}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`).join("");
    const xl = months.length ? `<text x="${padL}" y="${H - 4}">${esc(monthLabel(months[0]))}</text><text x="${W - padR}" y="${H - 4}" text-anchor="end">${esc(monthLabel(months[months.length - 1]))}</text>` : "";
    const end = last ? `<circle class="end" cx="${X(last[0])}" cy="${Y(last[1][1])}" r="4"/><text class="val" x="${X(last[0]) + 7}" y="${Y(last[1][1]) + 4}">${esc(fmt(last[1][1]))}</text>` : "";
    return `<div><div class="legend" style="margin:6px 0 0">${esc(p.label)}</div><svg viewBox="0 0 ${W} ${H}" role="img" class="trend">${grid}${xl}${band}${line}${end}${hits}</svg></div>`;
  }).join("");
}

/** A card's total over its versions: [{ts, hp, def, atk, spd, total}] */
function sparkline(points) {
  const W = 240, H = 46, pad = 6, totals = points.map(p => p.total);
  const lo = Math.min(...totals), hi = Math.max(...totals), t0 = points[0].ts, t1 = points[points.length - 1].ts;
  const X = t => pad + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (W - 2 * pad - 30), Y = v => pad + (hi > lo ? 1 - (v - lo) / (hi - lo) : 0.5) * (H - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.ts)},${Y(p.total)}`).join("");
  const dots = points.map(p => `<g data-v="${esc(`${p.total} total`)}" data-l="${esc(`${day(p.ts)}: HP ${p.hp} · DEF ${p.def} · ATK ${p.atk} · SPD ${p.spd}`)}"><circle class="hit" cx="${X(p.ts)}" cy="${Y(p.total)}" r="10"/><circle class="end" cx="${X(p.ts)}" cy="${Y(p.total)}" r="4"/></g>`).join("");
  const last = points[points.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Total stats over time: ${totals.join(", ")}`)}"><path class="line" d="${d}"/>${dots}<text class="val" x="${X(last.ts) + 8}" y="${Y(last.total) + 4}">${last.total}</text></svg>`;
}

// ---- describing a change ------------------------------------------------------------------------------------------
const statsLine = l => STATS.map(([, lab], i) => `${lab} ${l[i]}`).join(" · ");
/** plain parts of a change row (HTML), the ability diff aside */
export function changeParts(r) {
  const parts = [];
  if (r.stats) {
    const [a, b] = r.stats;
    if (a && b) {
      const moved = STATS.map(([, lab], i) => (a[i] !== b[i] ? `${lab} ${a[i]} → ${b[i]}` : "")).filter(Boolean).join(", ");
      const ta = a.reduce((s, v) => s + v, 0), tb = b.reduce((s, v) => s + v, 0);
      const what = r.bal === "buff" ? "Buff" : r.bal === "nerf" ? "Nerf" : r.bal === "shift" ? "Stats moved" : "Stats";
      parts.push(`<b>${what}:</b> ${esc(moved)}${r.bal ? ` <span class="muted">(total ${ta} → ${tb})</span>` : ` <span class="muted">(total ${ta} → ${tb}: off the scale, not a buff or nerf)</span>`}`);
    } else parts.push(a ? `<b>Stats lost</b> <span class="muted">(were ${esc(statsLine(a))})</span>` : `<b>Stats read:</b> ${esc(statsLine(b))}`);
  }
  if (r.lines) parts.push(`<b>Creatures on the card:</b> ${r.lines[0]} → ${r.lines[1]}`);
  if (r.stars) parts.push(`<b>Stars:</b> ${esc(r.stars[0] ?? "none")}${r.stars[0] != null ? "★" : ""} → ${esc(r.stars[1] ?? "none")}${r.stars[1] != null ? "★" : ""}`);
  if (r.kind) parts.push(`<b>Kind:</b> ${esc(ITEM_KIND[r.kind[0]] || r.kind[0] || "none")} → ${esc(ITEM_KIND[r.kind[1]] || r.kind[1] || "none")}`);
  if (r.sub) parts.push(`<b>Item type:</b> ${esc(r.sub[0] || "none")} → ${esc(r.sub[1] || "none")}`);
  if (r.types) parts.push(`<b>Types:</b> ${[...r.types.add.map(t => `+${t.replace(/_/g, " ")}`), ...r.types.drop.map(t => `−${t.replace(/_/g, " ")}`)].map(esc).join(", ")}`);
  if (r.series) parts.push(`<b>Series:</b> ${esc(r.series[0] || "none")} → ${esc(r.series[1] || "none")}`);
  if (r.tags) parts.push(`<b>Timing tags:</b> ${r.tags.map(([a, b]) => `${runHtml(a)} → ${runHtml(b)}`).join(", ")}`);
  if (r.words) parts.push(`<b>Ability reworded</b>`);
  else if (r.ws && !r.tags) parts.push(`<b>Ability spacing</b>`);
  return parts;
}

// ---- the card's Balance block -------------------------------------------------------------------------------------
/** Both parts. texts = the card's history texts then its current one (history.json + ability), for the diffs; null while loading */
export function cardHtml(c, A, opts = {}) { return balanceBlock(c, A, opts) + changesBlock(c, A, opts); }

/** The Balance line: the card's total among its star level, with the median and the middle 80% */
export function balanceBlock(c, A, { byId } = {}) {
  const a = cardData(A, c, byId), cohort = a?.cohort && A.cohorts[a.cohort];
  const out = [];
  if (cohort) {
    const line = a.stats || STATS.map(([k]) => c[k]);          // as built: the cohort numbers are too
    const name = cohortName(a.cohort, cohort), total = line.reduce((s, v) => s + (v ?? 0), 0);
    const all = a.cohort.endsWith("|all"), of = all ? `all ${cohort.n}` : `the ${cohort.n}`;
    const where = a.flags?.includes("top") ? `in the top 10% of ${name}: ${a.below} of ${of} have a lower total`
      : a.flags?.includes("bottom") ? `in the bottom 10% of ${name}: ${a.above} of ${of} have a higher total`
      : `${a.below} of ${all ? `all ${cohort.n} ${KINDS[cohort.kind]}` : `the ${cohort.n} ${name}`} have a lower total, ${a.above} a higher one`;
    const folded = all ? (c.type === "creatures" ? " Auxiliary creatures have no star level, so they are compared with all creatures."
      : ` Fewer than ${A.minCohort} ${KINDS[cohort.kind]} have ${c.stars ?? "no"}★, so it is compared with all of them.`) : "";
    const several = c.creatures?.length > 1 ? " (creature 1)" : "";
    const rows = [["This card" + several, ...line.map(v => (v == null ? "—" : String(v))), String(total)],
      [`Median of ${name}`, ...["hp", "def", "atk", "spd", "total"].map(k => fmt(cohort[k].p50))],
      ["Middle 80%", ...["hp", "def", "atk", "spd", "total"].map(k => `${fmt(cohort[k].p10)}–${fmt(cohort[k].p90)}`)]];
    out.push(`<h3>Balance</h3><p class="bal-line"><b>Total ${total}</b>, ${esc(where)}.${esc(folded)}</p>
      <div class="table-wrap"><table class="data bal-vs"><thead><tr><th></th>${STATS.map(([, l]) => `<th class="num">${l}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map((v, i) => (i ? `<td class="num">${esc(v)}</td>` : `<td>${esc(v)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`);
    if (c._staged || c._sent) out.push(`<p class="muted">As built, before this card's unpublished edits.</p>`);
    if (a.trend?.length > 1) out.push(`<div class="bal-trend"><span class="muted">Total over time</span>${sparkline(a.trend)}</div>`);
  }
  return out.join("");
}

/** The card's recorded changes, newest first: stats (buff, nerf), stars, kind, types, series, timing tags, wording */
export function changesBlock(c, A, { byId, texts = null } = {}) {
  const a = cardData(A, c, byId), out = [];
  if (a?.changes?.length) {
    const items = a.changes.map(r => {
      const parts = changeParts(r);
      const [i, j] = r.text || [];
      const diff = r.words && texts && texts[i] != null && texts[j] != null ? `<details class="bal-diff"><summary>Show the change</summary><div>${diffWords(texts[i], texts[j])}</div></details>` : "";
      const when = r.approx ? `${esc(day(r.ts))}<br><small>date approximate</small>` : esc(day(r.ts));
      return `<li><span class="when">${when}</span><div>${parts.join("<br>")}${diff}</div></li>`;
    }).join("");
    out.push(`<h3>Recorded changes</h3><ol class="bal-changes">${items}</ol>
      <p class="muted">From the bot's card history${A.since ? ` (since ${esc(day(A.since))})` : ""}: each version the bot read, dated by its PSD's commit (Pacific time). Older records kept no PSD, so a date no commit of the PSD confirms is marked approximate. A PSD read again by a newer parser is not a change.</p>`);
  }
  return out.join("");
}

// ---- the Stats page's Balance section ---------------------------------------------------------------------------------
export function statsHtml(A, { cards, byId }, params) {
  if (!A || (!Object.keys(A.cohorts || {}).length && !Object.keys(A.cards || {}).length)) return "";     // the build made none
  const kind = params.get("kind") || "", series = params.get("series") || "";
  const pool = cards.filter(c => !c.dup && (!kind || c.type === kind) && (!series || c.series === series));
  const inPool = new Set(pool.map(c => c.id));
  const charts = [];
  const scope = series ? ` in ${series}` : "";

  // 1 cohorts: the middle 80% of each star level, and its top and bottom 10% in scope
  const keys = Object.keys(A.cohorts).filter(k => { const kd = k.split("|")[0]; return !kind || kind === kd || (kind === "creatures" && kd === "creature"); });
  const members = new Map();
  for (const [id, a] of Object.entries(A.cards)) if (a.cohort && inPool.has(id)) (members.get(a.cohort) || members.set(a.cohort, []).get(a.cohort)).push([id, a]);
  const totalOf = id => { const l = A.cards[id]?.stats, c = byId.get(id); return l ? l.reduce((s, v) => s + v, 0) : c ? STATS.reduce((s, [k]) => s + (c[k] ?? 0), 0) : 0; };   // as built
  const rows = keys.map(k => {
    const co = A.cohorts[k], mine = members.get(k) || [];
    const dots = mine.filter(([, a]) => a.flags?.length).map(([id, a]) => ({ v: totalOf(id), id, name: byId.get(id)?.name || id, hot: a.flags[0] }));
    return { key: k, label: cohortName(k, co).replace(/^all /, "All "), n: co.n, q: co.total, dots,
      lo: Math.min(co.total.min ?? co.total.p10, ...dots.map(d => d.v)), hi: Math.max(co.total.max ?? co.total.p90, ...dots.map(d => d.v)) };
  }).filter(r => r.n);
  if (rows.length) {
    charts.push(card("bal-cohorts", "Total stats by star level", `HP + DEF + ATK + SPD of creatures and minions. Band: the middle 80% of each star level; tick: its median; line: lowest to highest. Dots: the top and bottom 10%${scope}.`,
      strips(rows), table(["Star level", "Cards", "Lowest", "Bottom of the middle 80%", "Median", "Top of the middle 80%", "Highest", "Average"],
        rows.map(r => { const t = A.cohorts[r.key].total; return [r.label, r.n, t.min ?? "—", t.p10, t.p50, t.p90, t.max ?? "—", t.mean]; })),
      { wide: true, legend: legend([["var(--s1)", "Top 10%"], ["var(--s2)", "Bottom 10%"], ["color-mix(in srgb, var(--s1) 28%, transparent)", "Middle 80%"]]) }));

    // 2 outliers: distance from the star level's median
    const flagged = [...members.entries()].flatMap(([k, ms]) => ms.filter(([, a]) => a.flags?.length).map(([id, a]) => {
      const c = byId.get(id), co = A.cohorts[k], t = totalOf(id);
      return { id, label: c?.name || id, value: Math.round((t - co.total.p50) * 10) / 10, total: t, k, co, a };
    })).sort((x, y) => y.value - x.value || x.label.localeCompare(y.label));
    if (flagged.length) {
      const ups = flagged.filter(f => f.value > 0).slice(0, 10), downs = flagged.filter(f => f.value < 0).slice(-10);
      const bars = [...ups, ...downs].map(f => ({ ...f, tip: `${f.label}: total ${f.total}, median of ${cohortName(f.k, f.co)} ${fmt(f.co.total.p50)}` }));
      charts.push(card("bal-outliers", "Strongest and weakest for their star level", `Total minus its star level's median, for the top and bottom 10%${scope}: the ${ups.length} highest and ${downs.length} lowest of ${flagged.length}; all of them in the table.`,
        diverging(bars, { unit: "vs median" }),
        table(["Card", "Star level", "Total", "Median", "Difference", "Lower totals"], flagged.map(f => [f.label, cohortName(f.k, f.co), f.total, f.co.total.p50, f.value, `${f.a.below} of ${f.co.n}`]), 2),
        { legend: legend([["var(--s1)", "Above the median"], ["var(--s2)", "Below the median"]]) }));
    }

    // 3 over time: small multiples, one per star level
    const months = A.time?.months || [];
    const panels = keys.filter(k => !k.endsWith("|all") && A.time?.series?.[k]).map(k => ({ key: k, label: cohortName(k, A.cohorts[k]), points: A.time.series[k] }));
    const multi = months.length && panels.length ? multiples(months, panels, A.minCohort) : "";
    charts.push(card("bal-time", "Average total by star level over time", multi
      ? `At each month's end, the creatures and minions there were then, with the stats they had then (a card counts from its first upload). Line: the average total; band: the middle 80%; months with fewer than ${A.minCohort} cards left out. All cards${kind ? ` of the kind picked` : ""}, any series.`
      : "", multi ? `<div class="multiples">${multi}</div>` : `<p class="muted">Needs the card repo's git history (a full-history build): a card counts from its first upload.</p>`,
      multi ? table(["Month", ...panels.map(p => p.label)], months.map((m, i) => [monthLabel(m), ...panels.map(p => (p.points[i] && p.points[i][0] >= A.minCohort ? `${fmt(p.points[i][1])} (${p.points[i][0]})` : "—"))]), 1) : "",
      { wide: true }));
  }

  // the recorded changes in scope
  const changes = [];
  for (const [id, a] of Object.entries(A.cards)) if (inPool.has(id)) for (const r of a.changes || []) changes.push({ id, r });
  const since = A.since ? day(A.since) : "";

  // 4 buffs and nerfs
  const bal = changes.filter(x => x.r.bal === "buff" || x.r.bal === "nerf");
  const shifts = changes.filter(x => x.r.bal === "shift");
  if (bal.length) {
    const months = monthsFrom(monthKey(Math.min(...bal.map(x => x.r.ts))), monthKey(Math.max(...bal.map(x => x.r.ts))));
    const cols = months.map(m => { const here = bal.filter(x => monthKey(x.r.ts) === m);
      return { label: monthLabel(m), up: here.filter(x => x.r.bal === "buff").length, down: here.filter(x => x.r.bal === "nerf").length,
        tip: here.length ? here.map(x => `${byId.get(x.id)?.name || x.id} (${x.r.bal})`).slice(0, 6).join(", ") + (here.length > 6 ? "…" : "") : monthLabel(m) }; });
    const sums = x => x.r.stats.map(l => l.reduce((s, v) => s + v, 0));
    charts.push(card("bal-buffs", "Buffs and nerfs by month", `A buff raises a card's total stats, a nerf lowers it${shifts.length ? `; ${plural(shifts.length, "change")} moved stats without changing the total (in the table)` : ""}.`,
      updown(cols, { every: Math.ceil(cols.length / 12) }),
      table(["Date", "Card", "Change", "Total"], [...bal, ...shifts].sort((x, y) => y.r.ts - x.r.ts).map(x => [day(x.r.ts), byId.get(x.id)?.name || x.id, x.r.bal === "buff" ? "Buff" : x.r.bal === "nerf" ? "Nerf" : "Stats moved", sums(x).join(" → ")]), 3),
      { wide: true, legend: legend([["var(--s1)", "Buffs"], ["var(--s2)", "Nerfs"]]) }));
  } else {
    const count = f => changes.filter(x => f(x.r)).length;
    const what = [[count(r => r.stats), "changed stats", "changed stats"], [count(r => r.words), "reworded an ability", "reworded an ability"], [count(r => r.tags), "changed timing tags", "changed timing tags"],
      [count(r => r.types), "changed types", "changed types"], [count(r => r.series), "changed a series", "changed a series"],
      [count(r => r.stars), "changed a star level", "changed a star level"], [count(r => r.kind), "changed a kind", "changed a kind"]].filter(([n]) => n).map(([n, l]) => `${n.toLocaleString()} ${l}`);
    const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}` : what[0];
    const off = count(r => r.stats && !r.bal);
    charts.push(card("bal-buffs", "Buffs and nerfs", "", `<p class="bal-empty">No buff or nerf is recorded${scope}${since ? ` since ${esc(since)}` : ""}: a buff or nerf is a change to a card's total stats.${off ? ` ${plural(off, "stat change")} from or to stats off the scale (a total above ${A.offScale}) ${off === 1 ? "is" : "are"} not counted.` : ""}${what.length ? ` Of the ${plural(changes.length, "recorded change")}, ${esc(list)}${what.length > 1 ? " (one change can do several)" : ""}.` : ""}</p>`, ""));
  }

  // 5 changes by month
  if (changes.length) {
    const months = monthsFrom(monthKey(Math.min(...changes.map(x => x.r.ts))), monthKey(Math.max(...changes.map(x => x.r.ts))));
    const SERIES = [{ key: "text", label: "Ability reworded", color: "var(--s1)" }, { key: "tags", label: "Timing tags only", color: "var(--s2)" },
      { key: "stats", label: "Stats", color: "var(--s3)" }, { key: "other", label: "Other (stars, kind, types, series)", color: "var(--deemph)" }];   // gray: --s4 beside --s2 fails the palette check
    const counts = new Map(months.map(m => [m, { text: 0, tags: 0, stats: 0, other: 0 }]));
    for (const x of changes) counts.get(monthKey(x.r.ts))[changeKind(x.r)]++;
    const labels = months.map(monthLabel), byLabel = new Map(months.map((m, i) => [labels[i], counts.get(m)]));
    charts.push(card("bal-months", "Recorded changes by month", `Each change to a card the bot saw${scope}, counted once: stats first, then ability wording, then timing tags.${since ? ` The bot's history goes back to ${since}.` : ""}`,
      stacked(labels, SERIES, (cat, key) => byLabel.get(cat)[key], { unit: "changes", every: Math.ceil(labels.length / 12) }),
      table(["Month", ...SERIES.map(s => s.label), "All"], months.map((m, i) => { const v = counts.get(m); return [labels[i], v.text, v.tags, v.stats, v.other, v.text + v.tags + v.stats + v.other]; })),
      { wide: true, legend: legend(SERIES.map(s => [s.color, s.label])) }));
  }

  // 6 most reworked
  const per = new Map();
  for (const x of changes) if (isRework(x.r)) { const p = per.get(x.id) || per.set(x.id, { n: 0, text: 0, stats: 0, stars: 0, types: 0, last: 0 }).get(x.id);
    p.n++; if (x.r.words) p.text++; if (x.r.stats || x.r.lines) p.stats++; if (x.r.stars || x.r.kind || x.r.sub) p.stars++; if (x.r.types) p.types++; p.last = Math.max(p.last, x.r.ts); }
  const top = [...per.entries()].sort((x, y) => y[1].n - x[1].n || y[1].last - x[1].last).map(([id, p]) => ({ id, p, name: byId.get(id)?.name || id }));
  if (top.length) {
    const what = p => [p.text && plural(p.text, "rewording"), p.stats && plural(p.stats, "stat change"), p.stars && plural(p.stars, "star, kind or item type change"), p.types && plural(p.types, "type change")].filter(Boolean).join(", ");
    charts.push(card("bal-reworked", "Most reworked cards", `Changes to how a card plays${scope}: its wording, stats, stars, kind, item type or types (not a timing-tag rename alone). ${plural(top.length, "card")} in all.`,
      hbar(top.slice(0, 15).map(t => ({ label: t.name, value: t.p.n, card: t.id })), { labelWidth: 190, unit: "changes" }),
      table(["Card", "Changes", "Rewordings", "Stats", "Stars, kind, item type", "Types", "Last"], top.map(t => [t.name, t.p.n, t.p.text, t.p.stats, t.p.stars, t.p.types, day(t.p.last)]))));
  }

  // 7 the cooldown update: tags to cooldowns (CD), global cooldowns (GCD) and uses (U)
  // the update came in waves: days on which WAVE or more cards changed timing tags; other days are only counted
  const retagged = changes.filter(x => x.r.tags), days = new Map();
  for (const x of retagged) {
    const d = dayKey(x.r.ts), w = days.get(d) || days.set(d, { ts: x.r.ts, cards: new Set(), old: new Set(), rows: [] }).get(d);
    w.cards.add(x.id); w.rows.push(x); if (x.r.old) w.old.add(x.id);
  }
  const waves = [...days.values()].filter(w => w.cards.size >= WAVE).sort((a, b) => a.ts - b.ts);     // by date
  const tagged = waves.flatMap(w => w.rows);
  if (tagged.length) {
    const main = waves.reduce((m, w) => (w.cards.size > m.cards.size || (w.cards.size === m.cards.size && w.ts > m.ts) ? w : m));   // the biggest
    const listed = ws => ws.map(w => `${plural(w.cards.size, "card")} on ${day(w.ts)}`).join(", ");
    const earlier = waves.filter(w => w.ts < main.ts), later = waves.filter(w => w.ts > main.ts), rest = new Set(retagged.filter(x => !tagged.includes(x)).map(x => x.id)).size;
    const pairs = new Map();
    for (const x of tagged) for (const [a, b] of x.r.tags) { const k = `${a}\u0001${b}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
    const pairRows = [...pairs.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => { const [a, b] = k.split("\u0001"); return { a, b, value: v }; });
    const cardsOf = f => new Set(tagged.filter(f).map(x => x.id)).size;       // cards, not rows: a card may change twice in a day
    const all = cardsOf(() => true), reworded = cardsOf(x => x.r.words);
    const facts = [["Cards", all], ["Timing tags only", all - reworded], ["Also reworded", reworded],
      ["Turn to global turn", cardsOf(x => x.r.tags.some(([a, b]) => groupOf(a) === "turn" && groupOf(b) === "any"))], ["With stat changes", cardsOf(x => x.r.stats)]];
    const sub = `${day(main.ts)}: ${plural(main.cards.size, "card")}${scope} changed timing tags${main.old.size ? `, ${main.old.size.toLocaleString()} from the old per-turn and every-N-turns tags` : ""} to cooldowns (CD), global cooldowns (GCD) and uses (U).`
      + (earlier.length ? ` Earlier: ${listed(earlier)}.` : "") + (later.length ? ` Later: ${listed(later)}.` : "") + (rest ? ` ${plural(rest, "other card")} changed timing tags on other days (not counted here).` : "");
    charts.push(card("bal-cooldown", "The cooldown update", sub,
      `<div class="facts">${facts.map(([l, v]) => `<span class="fact">${esc(l)} <b>${v.toLocaleString()}</b></span>`).join("")}</div>`
      + hbar(pairRows.slice(0, 14).map(p => ({ label: `${p.a || "none"} → ${p.b || "none"}`, value: p.value, html: `${runHtml(p.a)}<span class="muted">→</span>${runHtml(p.b)}` })), { labelWidth: 200, unit: "abilities" }),
      table(["Date", "Card", "Before", "After", "Also reworded"], tagged.sort((x, y) => y.r.ts - x.r.ts || (byId.get(x.id)?.name || "").localeCompare(byId.get(y.id)?.name || ""))
        .map(x => [day(x.r.ts), byId.get(x.id)?.name || x.id, x.r.tags.map(t => t[0] || "none").join(" "), x.r.tags.map(t => t[1] || "none").join(" "), x.r.words ? "yes" : ""]), 5)));
  }

  if (!charts.length) return "";
  const n = A.counts ? (A.counts.creature || 0) + (A.counts.minion || 0) : 0;
  return `<h2 class="bal-title">Balance</h2>
    <p class="muted bal-intro">${n ? `${n.toLocaleString()} creatures and minions compared with others of their star level` : "Cards compared with others of their star level"}${A.counts?.creatures ? ` (the ${A.counts.creatures} auxiliary creatures with all creatures)` : ""}, and the ${plural(A.versions || 0, "earlier version")} the bot recorded${since ? ` since ${esc(since)}` : ""}. Dates are Pacific time, the bot's.</p>
    <div class="charts">${charts.join("")}</div>`;
}
