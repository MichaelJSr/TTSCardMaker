// Stats dashboard. Marks follow the dataviz method: thin bars with 4px rounded data-ends, hairline grid,
// values at bar tips, legends for multi-series, hover tooltips, and a table view for every chart.
import { esc, tagInfo, badgeHtml, TAG, plain, noted, headHtml } from "./text.js";
import { total } from "./search.js";
import { HAND } from "./deck.js";
import { date } from "./history.js";

// the game's names (rulebook "04 Table")
const KIND_LABEL = { creature: "Creatures", item: "Items", field: "Field cards", minion: "Minions", nme: "N.M.E. items", "aux item": "Auxiliary items",
  debuff: "Debuffs", buff: "Buffs", creatures: "Auxiliary creatures", unknown: "Other" };
const NF = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });   // one formatter: toLocaleString per value was a hotspot
const PLAIN = NF.format(-123) === "-123";   // whole numbers under 1000 print as String() does here: skip the formatter (most values)
const fmt = n => { const v = Math.round(n * 10) / 10; return PLAIN && Number.isInteger(v) && v > -1000 && v < 1000 && !Object.is(v, -0) ? String(v) : NF.format(v); };

// ---- links to the Cards grid: a chart element that stands for a set of cards (app.js filterCards reads the params) --
/** "#/cards?…" for p's filters within the Stats page's scope (its kind and series; global: none); no duplicates, as Stats */
function cardsHref(p, scope = null) {
  const q = new URLSearchParams(), kind = scope?.get?.("kind") || p.kind, series = p.series || scope?.get?.("series");
  for (const [k, v] of Object.entries({ ...p, kind, series, nodup: 1 })) if (v != null && v !== "") q.set(k, Array.isArray(v) ? v.join(",") : v);
  return `#/cards?${q}`;
}
/** inner wrapped in a link to href (an SVG <a> in charts), else as is */
const go = (href, label, inner) => (href ? `<a class="go" href="${esc(href)}" aria-label="${esc(`${label}: show these cards`)}">${inner}</a>` : inner);
const svgRole = linked => (linked ? "" : ' role="img"');      // a role="img" svg hides its links from assistive tech

// ---- chart primitives (SVG strings; every label is escaped) ----------------------------------------
function roundedRight(x, y, w, h, r = 4) {
  if (w <= 0) return "";
  r = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}
function roundedTop(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; }

/** Horizontal bars. rows: [{label, value, html?, card?, href?, sub?, tip?}]; sub: a subseries row under its series (thinner, lighter) */
function hbar(rows, { labelWidth = 150, unit = "cards", color = "var(--s1)", chars = 24 } = {}) {
  const rowH = 26, W = 560, plotW = W - labelWidth - 48;
  const max = Math.max(1, ...rows.map(r => r.value));
  const H = rows.length * rowH + 4;
  const parts = rows.map((r, i) => {
    const y = i * rowH, w = (r.value / max) * plotW, bar = r.sub ? 9 : 14;
    const label = r.html
      ? `<foreignObject x="0" y="${y}" width="${labelWidth - 8}" height="${rowH}"><div xmlns="http://www.w3.org/1999/xhtml" class="svg-label">${r.html}</div></foreignObject>`
      : `<text class="lbl${r.sub ? " sub" : ""}" x="${labelWidth - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(trunc(r.label, chars))}</text>`;
    return go(r.href, r.tip || r.label, `<g class="row" data-v="${esc(fmt(r.value))} ${esc(unit)}" data-l="${esc(r.tip || r.label)}"${r.card && !r.href ? ` data-card="${esc(r.card)}"` : ""}>
      <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}"/>${label}
      <path class="mark${r.sub ? " sub" : ""}" d="${roundedRight(labelWidth, y + (rowH - bar) / 2, w, bar)}" fill="${color}"/>
      <text class="val" x="${labelWidth + w + 6}" y="${y + rowH / 2 + 4}">${esc(fmt(r.value))}</text></g>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}"${svgRole(rows.some(r => r.href))}><line class="axis" x1="${labelWidth}" x2="${labelWidth}" y1="0" y2="${H - 4}"/>${parts.join("")}</svg>`;
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Vertical columns: [{label, value, href?}] (single series; label every Nth tick; max: a fixed y scale; minH: a non-zero
    column's least height; vals: its count over it). */
/** padT: room above the top tick's number, for a label sitting right above the chart (it would cover the number) */
function columns(cols, { unit = "cards", color = "var(--s1)", every = 1, height = 200, width = 1000, max: fixed, minH = 0, vals = false, padT = 0 } = {}) {
  const W = width, padL = 36, padB = 26, plotH = height - padB - padT, base = padT + plotH, n = cols.length;
  const max = fixed ?? niceMax(Math.max(1, ...cols.map(c => c.value)));
  const band = (W - padL) / Math.max(1, n), bw = Math.min(24, band * 0.7);
  const ticks = [0, max / 2, max].map(t => {
    const y = base - (t / max) * plotH;
    return `<line class="gridline" x1="${padL}" x2="${W}" y1="${y}" y2="${y}"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`;
  }).join("");
  const parts = cols.map((c, i) => {
    const x = padL + i * band + (band - bw) / 2, h = c.value ? Math.max(minH, (c.value / max) * plotH) : 0;
    return go(c.value ? c.href : null, c.tip || c.label, `<g class="col" data-v="${esc(fmt(c.value))} ${esc(unit)}" data-l="${esc(c.tip || c.label)}">
      <rect class="hit" x="${padL + i * band}" y="0" width="${band}" height="${height}"/>
      <path class="mark" d="${roundedTop(x, base - h, bw, h)}" fill="${color}"/>
      ${vals && c.value ? `<text class="val" x="${x + bw / 2}" y="${Math.max(padT + 11, base - h - 4)}" text-anchor="middle">${esc(fmt(c.value))}</text>` : ""}
      ${i % every === 0 ? `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${esc(c.label)}</text>` : ""}</g>`);
  });
  return `<svg viewBox="0 0 ${W} ${height}"${svgRole(cols.some(c => c.href))}>${ticks}<line class="axis" x1="${padL}" x2="${W}" y1="${base}" y2="${base}"/>${parts.join("")}</svg>`;
}

/** Stacked columns with a 2px surface gap between segments. cats: labels; series: [{key,label,color}]; get(cat,key);
    href(cat, key?): a segment's (key) or a column's cards, or null */
function stacked(cats, series, get, { height = 230, unit = "cards", width = 1000, every = 1, href = () => null } = {}) {
  const W = width, padL = 36, padB = 26, plotH = height - padB, gap = 2;
  const totals = cats.map(c => series.reduce((s, sr) => s + get(c, sr.key), 0));
  const max = niceMax(Math.max(1, ...totals));
  const band = (W - padL) / cats.length, bw = Math.min(24, band * 0.6);
  const ticks = [0, max / 2, max].map(t => {
    const y = plotH - (t / max) * plotH;
    return `<line class="gridline" x1="${padL}" x2="${W}" y1="${y}" y2="${y}"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`;
  }).join("");
  const parts = cats.map((cat, i) => {
    const x = padL + i * band + (band - bw) / 2;
    let y = plotH;
    const segs = series.map((sr, k) => {
      const v = get(cat, sr.key);
      if (!v) return "";
      const h = (v / max) * plotH, top = k === series.length - 1 || series.slice(k + 1).every(s2 => !get(cat, s2.key));
      y -= h;
      const d = top ? roundedTop(x, y, bw, Math.max(0, h - gap)) : `M${x},${y + gap}h${bw}v${Math.max(0, h - gap)}h${-bw}Z`;
      return go(h - gap >= 1 ? href(cat, sr.key) : null, `${sr.label}, ${cat}`, `<path class="mark" d="${d}" fill="${sr.color}" data-v="${v} ${esc(unit)}" data-l="${esc(`${sr.label}, ${cat}`)}"/>`);
    }).join("");
    const l = `${cat}: ${series.map(sr => `${sr.label} ${get(cat, sr.key)}`).join(" · ")}`;
    return `<g class="col">${go(totals[i] ? href(cat) : null, cat, `<rect class="hit" x="${padL + i * band}" y="0" width="${band}" height="${plotH}" data-v="${totals[i]} ${esc(unit)}" data-l="${esc(l)}"/>`)}${segs}
      ${i % every === 0 ? `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${esc(cat)}</text>` : ""}</g>`;
  });
  return `<svg viewBox="0 0 ${W} ${height}"${svgRole(cats.some(c => href(c) || series.some(sr => href(c, sr.key))))}>${ticks}<line class="axis" x1="${padL}" x2="${W}" y1="${plotH}" y2="${plotH}"/>${parts.join("")}</svg>`;
}

/** Scatter with emphasis: [{x, jx, y, label, card, hot, v?}] — hot points in the accent, the rest de-emphasised; v: the
    tip's value (default "<y> total"). Domains and ticks default to the star-level chart's. */
function scatter(points, { xLabel, yLabel, xTicks, height = 300, xTickLabel = t => `${t}★`, x0, x1, y0 = 0, y1, yTicks }) {
  const W = 1000, padL = 44, padB = 34, plotH = height - padB;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  x0 ??= Math.min(...xs) - 0.6; x1 ??= Math.max(...xs) + 0.6; y1 ??= niceMax(Math.max(...ys));
  yTicks ??= [y0, y1 / 4, y1 / 2, (3 * y1) / 4, y1];
  const X = v => padL + ((v - x0) / (x1 - x0)) * (W - padL - 10), Y = v => plotH - ((v - y0) / (y1 - y0)) * plotH;
  const grid = yTicks.map(t => `<line class="gridline" x1="${padL}" x2="${W}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${padL - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
  const xt = xTicks.map(t => `<text x="${X(t)}" y="${height - 14}" text-anchor="middle">${esc(xTickLabel(t))}</text>`).join("");
  const sorted = [...points].sort((a, b) => (a.hot ? 1 : 0) - (b.hot ? 1 : 0));
  const dots = sorted.map(p => `<g class="dot" data-card="${esc(p.card)}" data-v="${esc(p.v ?? `${p.y} total`)}" data-l="${esc(p.label)}">
    <circle class="hit" cx="${X(p.jx)}" cy="${Y(p.y)}" r="12"/>
    <circle class="mark" cx="${X(p.jx)}" cy="${Y(p.y)}" r="${p.hot ? 5 : 4}" fill="${p.hot ? "var(--s1)" : "var(--deemph)"}" stroke="var(--surface)" stroke-width="2"/></g>`).join("");
  const placed = [];                          // selective labels: skip any that would collide with one already placed
  const labels = points.filter(p => p.label && p.showLabel).map(p => {
    const x = X(p.jx) + 8, y = Y(p.y) - 7, w = Math.min(p.label.length, 22) * 6.6;
    if (placed.some(q => x < q.x + q.w + 6 && q.x < x + w + 6 && Math.abs(q.y - y) < 15)) return "";
    placed.push({ x, y, w });
    return `<text class="lbl" x="${x}" y="${y}">${esc(trunc(p.label, 22))}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${height}" role="img">${grid}<line class="axis" x1="${padL}" x2="${W}" y1="${plotH}" y2="${plotH}"/>${xt}
    <text x="${W}" y="${height - 2}" text-anchor="end">${esc(xLabel)}</text><text x="${padL + 6}" y="12">${esc(yLabel)}</text>${dots}${labels}</svg>`;
}

function table(head, rows, numericFrom = 1) {
  return `<div class="table-wrap"><table class="data"><thead><tr>${head.map((h, i) => `<th class="${i >= numericFrom ? "num" : ""}">${headHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr${r.sub ? ' class="sub"' : ""}>${r.map((v, i) => `<td class="${i >= numericFrom ? "num" : ""}">${typeof v === "number" ? esc(fmt(v)) : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// ---- heat-table colors: the --seq-100 -> --seq-700 ramp mixed in OKLab, with text that always passes WCAG AA ------
const hex2rgb = h => { const n = parseInt(h.replace("#", "").trim(), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toLin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const fromLin = v => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
function oklab([r, g, b]) {
  [r, g, b] = [r, g, b].map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function rgbOf([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(fromLin);
}
const luminance = rgb => { const [r, g, b] = rgb.map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** heat(p) for p in 0..100 → {bg, ink}: background from the theme's ramp, nudged off any mid-tone where neither the dark
    nor the light ink reaches 4.5:1, and the ink that contrasts more. */
let heatMemo = null;          // per theme: reading the ramp from the CSS forces a style pass (once per heat table was a hotspot)
function heatScale() {
  const theme = document.documentElement.dataset?.theme;
  if (heatMemo && heatMemo.theme === theme) return heatMemo.heat;
  const css = getComputedStyle(document.documentElement), get = n => hex2rgb(css.getPropertyValue(n));
  const lo = oklab(get("--seq-100")), hi = oklab(get("--seq-700")), dark = luminance([11, 11, 11]), light = luminance([240, 239, 236]);
  const at = p => rgbOf(lo.map((v, i) => v + (hi[i] - v) * (p / 100)));
  const pass = rgb => { const L = luminance(rgb); return Math.max(contrast(L, dark), contrast(L, light)) >= 4.5; };
  const heat = p => {
    let q = p;
    for (let d = 0; d <= 50 && !pass(at(q)); d++) { if (p - d >= 0 && pass(at(p - d))) { q = p - d; break; } if (p + d <= 100 && pass(at(p + d))) { q = p + d; break; } }
    const rgb = at(q), L = luminance(rgb);
    return { bg: `rgb(${rgb.join(",")})`, ink: contrast(L, dark) >= contrast(L, light) ? "#0b0b0b" : "#f0efec" };
  };
  if (css.getPropertyValue("--seq-100").trim()) heatMemo = { theme, heat };   // not before the stylesheet has loaded
  return heat;
}

/** A heat table: head [text | {html} | {label | html, tip}], rows of cells (a number shaded, null "—", text as is); shade: the columns shaded
    (default every one from numericFrom), each on its own range, or all on one (all); href(row, col): a cell's cards */
function heatTable(head, rows, { numericFrom = 1, shade = null, all = false, href = () => null } = {}) {
  const cols = shade || head.map((_, i) => i).filter(i => i >= numericFrom), heat = heatScale();
  const range = is => { const v = is.flatMap(i => rows.map(r => r[i])).filter(x => typeof x === "number"); return [Math.min(...v), Math.max(...v)]; };
  const ranges = new Map(cols.map(i => [i, all ? null : range([i])])), one = all ? range(cols) : null;
  const cell = (v, i, k) => {
    const rg = typeof v === "number" && ranges.has(i) ? one || ranges.get(i) : null;
    const st = rg ? (({ bg, ink }) => ` style="background:${bg};color:${ink}"`)(heat(rg[1] > rg[0] ? Math.round(((v - rg[0]) / (rg[1] - rg[0])) * 100) : 50)) : "";
    const text = v == null ? "—" : esc(typeof v === "number" ? fmt(v) : v), to = v == null || v === "" ? null : href(k, i);
    return `<td${i >= numericFrom ? ' class="num"' : ""}${st}>${to ? `<a class="go" href="${esc(to)}" data-tip="Show these cards">${text}</a>` : text}</td>`;
  };
  return `<div class="table-wrap"><table class="data heat"><thead><tr>${head.map((h, i) => `<th${i >= numericFrom ? ' class="num"' : ""}>${headHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r, k) => `<tr>${r.map((v, i) => cell(v, i, k)).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** A chart card; startTable: open on its table (the Chart button shows the chart); tip: the title's note */
function card(id, title, sub, chartHtml, tableHtml, { wide = false, legend = "", startTable = false, tip = "" } = {}) {
  const t = !!(startTable && tableHtml);
  return `<section class="chart${wide ? " wide" : ""}" id="chart-${id}">
    <header><h3>${noted(title, tip)}</h3>${tableHtml ? `<button type="button" class="ghost" data-action="toggle-table" data-target="${id}" aria-pressed="${t}">${t ? "Chart" : "Table"}</button>` : ""}</header>
    ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}${legend}
    <div class="view-chart"${t ? " hidden" : ""}>${chartHtml}</div>${tableHtml ? `<div class="view-table"${t ? "" : " hidden"}>${tableHtml}</div>` : ""}</section>`;
}

// ---- stat distributions: page 0 is 0–10, page k is 10k+1 … 10k+10; one y scale per stat, counts over pages above 0 ---
/** values -> Map(value, cards): one pass */
export const countValues = (cards, k) => { const m = new Map(); for (const c of cards) { const v = c[k]; if (v != null) m.set(v, (m.get(v) || 0) + 1); } return m; };
/** the pages holding a value: 0 always */
export const distPages = counts => [...new Set([0, ...[...counts.keys()].filter(v => v > 10).map(v => Math.ceil((v - 10) / 10))])].sort((a, b) => a - b);
export const pageRange = k => (k ? [10 * k + 1, 10 * k + 10] : [0, 10]);
/** One stat's panel: every page rendered, all but cur hidden (app.js distPage pages it) */
function distPanel({ k, l, counts, pages, yMax, cur, href }) {
  const paged = pages.length > 1, i = pages.indexOf(cur), [lo, hi] = pageRange(cur);
  const page = p => { const [a, b] = pageRange(p);
    return `<div class="dist-page" data-page="${p}"${p === cur ? "" : " hidden"}>${columns(Array.from({ length: b - a + 1 }, (_, j) => ({ label: String(a + j), value: counts.get(a + j) || 0, tip: `${l} ${a + j}`, href: href(a + j) })), { height: 184, width: 320, max: yMax, minH: 3, vals: p > 0, padT: 14 })}</div>`; };
  const btn = (step, label, off) => `<button type="button" class="ghost" data-action="dist-page" data-step="${step}" aria-label="${label}"${off ? " disabled" : ""}>${step < 0 ? "‹" : "›"}</button>`;
  const pager = paged ? `<span class="dist-pager">${btn(-1, "Lower values", i === 0)}<span class="dist-range">${lo}–${hi}</span>${btn(1, "Higher values", i === pages.length - 1)}</span>` : "";
  return `<div class="dist-panel" data-stat="${k}"${paged ? ` data-pages="${pages.join(",")}" data-cur="${cur}" tabindex="0" aria-label="${l}: ← → for more values"` : ""}>
    <div class="dist-head"><span class="legend">${l}</span>${pager}</div>${(paged ? pages : [0]).map(page).join("")}</div>`;
}

// ---- cards-only charts after the average stats: stat shapes, cooldowns, ability length, item types ----------------
const COOLDOWN = /^(?:(?:-1|\d|X)\/)?(\d)(G?)CD$/;          // the recurring number: (1CD) 1, (0/2CD) 2; (XCD) none
const USES = /^(\d)U$/;                                       // (2U) 2
const CD_COLS = [["1CD", "CD", 1], ["2CD", "CD", 2], ["3CD", "CD", 3], ["1GCD", "GCD", 1], ["2GCD", "GCD", 2],
  ["1U", "U", 1], ["2U", "U", 2], ["3U", "U", 3]];          // 3CD: 3+, 2GCD: 2+, 3U: 3+
const CD_PLUS = new Set([2, 4, 7]);
const CD_PLUS_TIP = { "3CD": "Cooldowns of 3 turns or more", "2GCD": "Global cooldowns of 2 global turns or more", "3U": "3 or more uses" };
const CD_KEYS = CD_COLS.map(([tag], i) => `${tag}${CD_PLUS.has(i) ? "+" : ""}`);   // app.js cd=
const WORD_KINDS = [["Creatures", ["creature", "creatures"]], ["Minions", ["minion"]], ["Items", ["item"]], ["Auxiliary items", ["aux item"]],
  ["Field cards", ["field"]], ["Debuffs", ["debuff"]], ["N.M.E. items", ["nme"]]];
const median = v => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const starsOf = arr => [...new Set(arr.map(c => c.stars).filter(Boolean))].sort((a, b) => a - b);
const STAT_KEYS = [["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"]];
const MINIONS = ["creature", "creatures", "minion"];     // the stat charts' cards: creatures and minions
/** a creature's single highest stat (hp, def, atk, spd) or "tied"; null without all four (S12; app.js shape=) */
export function shapeOf(c) {
  const v = STAT_KEYS.map(([k]) => c[k]);
  if (v.some(x => x == null)) return null;
  const hi = Math.max(...v), at = v.indexOf(hi);
  return v.indexOf(hi, at + 1) < 0 ? STAT_KEYS[at][0] : "tied";
}
/** the cooldown and uses columns (CD_COLS keys, "+" on the 3+ and 2+ ones) of each tag in a card's ability, in order (S15; app.js cd=) */
export function cooldownCols(c) {
  const out = [];
  for (const m of (c.ability || "").matchAll(new RegExp(TAG.source, "g"))) {
    const tag = tagInfo(m[1])?.tag || "", t = COOLDOWN.exec(tag), u = !t && USES.exec(tag);
    if (!t && !(u && +u[1])) continue;
    const n = +(t || u)[1], col = u ? 4 + Math.min(n, 3) : t[2] ? (n >= 2 ? 4 : 3) : Math.min(n, 3) - 1;
    out.push({ col, key: CD_KEYS[col], n: t ? n : null });
  }
  return out;
}
/** the timing tags in a card's ability, under their canonical case; not neutral ones such as Action (app.js tag=) */
export function tagsOf(c) {
  const out = [];
  for (const m of (c.ability || "").matchAll(new RegExp(TAG.source, "g"))) { const t = tagInfo(m[1]); if (t && t.group !== "neutral") out.push(t.tag); }
  return out;
}
function cardCharts(pool, creatures, L) {
  const out = [];
  // S12 stat shapes: by the single highest stat
  const shapes = new Map([...STAT_KEYS.map(([k]) => [k, 0]), ["tied", 0]]);
  for (const c of creatures) { const k = shapeOf(c); if (k) shapes.set(k, shapes.get(k) + 1); }
  const shapeRows = [...shapes].map(([k, value]) => ({ label: k === "tied" ? "Tied" : k.toUpperCase(), value, href: value ? L({ kind: MINIONS, shape: k }) : null }));
  if (shapeRows.some(r => r.value)) out.push(card("shapes", "Stat shapes", "Creatures and minions by their highest stat.", hbar(shapeRows, { labelWidth: 80 }),
    table(["Highest stat", "Cards"], shapeRows.map(r => [r.label, r.value])), { tip: "Creatures and minions with all four stats, by their highest stat; Tied: a shared top" }));
  // S15 cooldowns and uses by star level: each ability's cooldown or uses tag, by its number
  const cd = new Map();
  for (const c of pool) {
    if (!c.stars) continue;
    for (const { col, n } of cooldownCols(c)) {
      const row = cd.get(c.stars) || cd.set(c.stars, { n: CD_COLS.map(() => 0), sum: 0, k: 0 }).get(c.stars);
      row.n[col]++;
      if (n != null) { row.sum += n; row.k++; }
    }
  }
  if (cd.size) {
    const stars = [...cd.keys()].sort((a, b) => a - b), plus = i => (CD_PLUS.has(i) ? "+" : ""), avg = r => (r.k ? r.sum / r.k : null);
    const plusTip = i => CD_PLUS_TIP[CD_COLS[i][0]], avgHead = { label: "Avg turns", tip: "Mean recurring number of the cooldown and global cooldown tags; uses tags left out" };
    const head = ["Stars", ...CD_COLS.map(([tag], i) => (plus(i) ? { html: `${badgeHtml(tag, false)}+`, tip: plusTip(i) } : { html: badgeHtml(tag) })), avgHead];
    out.push(card("cooldowns", "Cooldowns and uses by star level", "Abilities per cooldown or uses, by star level.",
      heatTable(head, stars.map(st => { const r = cd.get(st); return [`${st}★`, ...r.n.map(v => v || ""), r.k ? String(fmt(avg(r))) : null]; }), { shade: CD_COLS.map((_, i) => i + 1), all: true,
        href: (k, i) => (i >= 1 && i <= CD_COLS.length ? L({ stars: stars[k], cd: CD_KEYS[i - 1] }) : null) }),
      table(["Stars", ...CD_COLS.map(([tag], i) => (plus(i) ? { label: `(${tag})+`, tip: plusTip(i) } : `(${tag})`)), avgHead], stars.map(st => { const r = cd.get(st); return [`${st}★`, ...r.n, avg(r)]; })),
      { tip: "Cooldown and uses tags with a number, each time one appears; cards with a star level only" }));
  }
  // S16 ability length: median words (timing tags left out) per star level and kind; under 3 cards: —
  const words = new Map();
  for (const c of pool) {
    if (!c.stars || !c.ability) continue;
    const kind = WORD_KINDS.findIndex(([, ts]) => ts.includes(c.type));
    if (kind < 0) continue;
    const n = plain(c.ability).replace(/\([^()]{2,6}\)/g, " ").split(/\s+/).filter(Boolean).length, key = `${c.stars}|${kind}`;
    (words.get(key) || words.set(key, []).get(key)).push(n);
  }
  const kinds = WORD_KINDS.map((k, i) => [k, i]).filter(([, i]) => [...words].some(([key, v]) => key.endsWith(`|${i}`) && v.length >= 3));
  if (kinds.length) {
    const stars = starsOf([...words.keys()].map(k => ({ stars: +k.split("|")[0] })));
    const cell = (st, i) => { const v = words.get(`${st}|${i}`); return v && v.length >= 3 ? median(v) : null; };
    const rows = stars.map(st => [`${st}★`, ...kinds.map(([, i]) => cell(st, i))]).filter(r => r.slice(1).some(v => v != null));
    const rowStars = stars.filter(st => kinds.some(([, i]) => cell(st, i) != null));
    const wordHead = ["Stars", ...kinds.map(([[l]]) => (l === "Creatures" ? { label: l, tip: "Creature cards and auxiliary creatures together" } : l))];
    out.push(card("words", "Ability length", "Median words per ability; — under 3 cards.",
      heatTable(wordHead, rows, { all: true, href: (k, i) => (i ? L({ stars: rowStars[k], kind: kinds[i - 1][0][1] }) : null) }),
      table(wordHead, rows.map(r => r.map(v => (v == null ? "—" : v)))),
      { tip: "Median words per ability: icons count as words, short (…) tags like (1CD) don't" }));
  }
  // S19 items by type and stars; rows read "Support", as in the rulebook
  const items = pool.filter(c => c.type === "item" && c.subtype && c.stars);
  if (items.length) {
    const stars = starsOf(items), types = new Map();
    for (const c of items) { const r = types.get(c.subtype) || types.set(c.subtype, new Map()).get(c.subtype); r.set(c.stars, (r.get(c.stars) || 0) + 1); }
    const rows = [...types].map(([t, m]) => Object.assign([t[0].toUpperCase() + t.slice(1), ...stars.map(st => m.get(st) || 0), [...m.values()].reduce((a, b) => a + b, 0)], { key: t })).sort((a, b) => b[b.length - 1] - a[a.length - 1] || a[0].localeCompare(b[0]));
    const head = ["Item type", ...stars.map(st => `${st}★`), "All"];
    out.push(card("itemtypes", "Items by type and stars", "Item cards per type and star level.",
      heatTable(head, rows.map(r => [r[0], ...r.slice(1, -1).map(v => v || ""), String(r[r.length - 1])]), { shade: stars.map((_, i) => i + 1), all: true,
        href: (k, i) => L({ kind: "item", sub: rows[k].key, stars: i >= 1 && i <= stars.length ? stars[i - 1] : "" }) }),
      table(head, rows)));
  }
  return out;
}

// ---- the dashboard ---------------------------------------------------------------------------------
export function renderStats(root, ctx, params) {
  const { cards, banned, icons } = ctx;
  const kind = params.get("kind") || "", series = params.get("series") || "";
  // a duplicate (another PNG from the same PSD: Breakfast, Supper for A Snack) is the same card: count it once
  let pool = cards.filter(c => !c.dup && (!kind || c.type === kind) && (!series || c.series === series));
  const kinds = [...new Set(cards.map(c => c.type))].sort((a, b) => cards.filter(c => c.type === b).length - cards.filter(c => c.type === a).length);
  const allSeries = [...new Set(cards.filter(c => c.series).map(c => c.series))].sort();
  const count = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (k == null || k === "") continue; m.set(k, (m.get(k) || 0) + 1); } return m; };
  const desc = m => [...m.entries()].sort((a, b) => b[1] - a[1]);

  // the series chart's cards: the picked kind, else creatures; the Subseries tile counts theirs
  const sk = kind || "creature", mine = pool.filter(c => c.type === sk);
  const subCount = new Set(mine.map(c => c.subseries).filter(Boolean)).size;     // a name in two series: one subseries

  // KPI tiles
  const latest = pool.reduce((m, c) => Math.max(m, c.ts || 0), 0);
  const kpis = [
    ["Cards", pool.length, "Cards in scope (Kind and Series above); a card's duplicate pictures count once"],
    ["Creatures", pool.filter(c => c.type === "creature").length, "Creature cards only; minions and auxiliary creatures aren't counted"],
    ["Items", pool.filter(c => c.type === "item").length, "Item cards only; auxiliary items and N.M.E. items aren't counted"],
    ["Series", new Set(pool.map(c => c.series).filter(Boolean)).size],
    ...(subCount ? [kind ? ["Subseries", subCount, "Different subseries among these cards; a name in two series counts once"]
      : ["Creature subseries", subCount, "Different subseries among the creature cards in scope; a name in two series counts once"]] : []),
    ["Authors", new Set(pool.map(c => c.author).filter(Boolean)).size],
    ["Banned (constructed)", pool.filter(c => banned.has(c.id)).length],
    ["Last card update", latest ? date(latest) : "—", "When a card in scope last had its PSD committed (Pacific time)"],
  ];
  const charts = [];
  let at = -1;                                 // where the cards-only charts go: after the average stats, else after the star-level block
  const L = p => cardsHref(p, params);         // a chart element's cards in the Cards grid

  // 1 kinds
  const byKind = desc(count(pool, c => c.type)).map(([k, v]) => ({ label: KIND_LABEL[k] || k, value: v, href: L({ kind: k }) }));
  charts.push(card("kinds", "Cards by kind", `${pool.length} cards`, hbar(byKind), table(["Kind", "Cards"], byKind.map(r => [r.label, r.value]))));

  // 2 series, each with its subseries under it (cards without one: "No subseries"; a subseries in several series: under
  //   each); cards with a subseries but no series: under "No series", last
  const ser = desc(count(mine, c => c.series)), what = KIND_LABEL[sk] || sk, noSer = mine.filter(c => !c.series);
  const subsOf = (s, of = mine.filter(c => c.series === s), f = { series: s }) => { const rows = desc(count(of, c => c.subseries));
    const none = rows.length ? of.filter(c => !c.subseries).length : 0;
    return [...rows.map(([sub, v]) => ({ label: sub, value: v, sub: true, tip: `${s} › ${sub}`, href: L({ kind: sk, ...f, subseries: sub }) })),
      ...(none ? [{ label: "No subseries", value: none, sub: true, tip: `${s}: no subseries` }] : [])]; };
  const rowsOf = (k, v, subs) => [[k, v], ...subs.map(r => Object.assign([`↳ ${r.label}`, r.value], { sub: true }))];
  const top = ser.slice(0, 15).flatMap(([k, v]) => [{ label: k, value: v, href: L({ kind: sk, series: k }) }, ...subsOf(k)]);
  const rest = ser.slice(15).reduce((s, [, v]) => s + v, 0);
  if (rest) top.push({ label: `Other (${ser.length - 15} series)`, value: rest });
  const serRows = ser.flatMap(([k, v]) => rowsOf(k, v, subsOf(k)));
  if (noSer.some(c => c.subseries)) {
    const subs = subsOf("No series", noSer, { missing: "series" });
    top.push({ label: "No series", value: noSer.length, href: L({ kind: sk, missing: "series" }) }, ...subs);
    serRows.push(...rowsOf("No series", noSer.length, subs));
  }
  if (top.length) charts.push(card("series", `${what} by series`, `${ser.length > 15 ? `Top 15 of ${ser.length} series` : `${ser.length} series`}${subCount ? ", with their subseries" : ""}.`,
    hbar(top, { labelWidth: 230, chars: 32 }), table(["Series", what], serRows)));

  // 3 starting-hand depth: for each star level the constructed hand uses (rulebook "03 Setting Up"), how many legal
  //   cards there are to pick from. Not banned, parsed by the bot; the same pool the deck builder offers.
  const handRows = [];
  for (const g of HAND) {
    if (kind && kind !== g.kind) continue;
    for (const [st, need] of g.tiers) {
      const all = pool.filter(c => c.type === g.kind && c.stars === st && c.parsed !== false);
      const legal = all.filter(c => !banned.has(c.id)).length;
      handRows.push({ label: `${st}★ ${g.label.toLowerCase()}`, value: legal, need, bannedN: all.length - legal, per: legal / need, kind: g.label, g: g.kind, st });
    }
  }
  if (handRows.length) {
    const rows = handRows.map(r => ({ label: `${r.label} · hand needs ${r.need}`, value: r.value, href: r.value ? L({ kind: r.g, stars: r.st, legal: 1 }) : null, html: `<span>${esc(r.label)}</span><span class="muted">needs ${r.need}</span>` }));
    charts.push(card("hand", "Starting-hand choices", "Legal cards per star level vs the hand's need.",
      hbar(rows, { labelWidth: 190, unit: "legal cards" }),
      table(["Star level", { label: "Hand needs", tip: "How many cards of this star level a constructed starting hand takes" },
        { label: "Legal cards", tip: "Cards of this kind and star level not banned in constructed; image-only cards left out" },
        { label: "Banned", tip: "Cards of this kind and star level banned in constructed; image-only cards left out" },
        { label: "Choices per pick", tip: "Legal cards divided by how many the hand takes, to one decimal" }], handRows.map(r => [r.label, r.need, r.value, r.bannedN, Math.round(r.per * 10) / 10]))));
  }

  // 4 average stats by star tier (heat table)
  // creatures and minions ("for most purposes, minions are considered creatures": rulebook "15 Minions")
  const creatures = pool.filter(c => (c.type === "creature" || c.type === "creatures" || c.type === "minion") && c.hp != null);
  const tiers = [...new Set(creatures.map(c => c.stars).filter(Boolean))].sort((a, b) => a - b);
  if (tiers.length) {
    const keys = STAT_KEYS;
    const avg = (arr, f) => { const v = arr.map(f).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const rows = tiers.map(t => { const g = creatures.filter(c => c.stars === t); return [t, g.length, ...keys.map(([k]) => avg(g, c => c[k])), avg(g, total)]; });
    const totalHead = { label: "Total", tip: "Mean of HP + DEF + ATK + SPD, a missing stat counted as 0" };
    const heat = heatTable(["Stars", "Cards", ...keys.map(([, l]) => l), totalHead], rows.map(r => [`${r[0]}★`, String(r[1]), ...r.slice(2)]), { shade: [2, 3, 4, 5, 6], href: (k, i) => (i < 2 ? L({ kind: MINIONS, stars: rows[k][0], hp: "0-99" }) : null) });
    charts.push(card("tiers", "Average stats by star level", "Creatures and minions, shaded per column.", heat,
      table(["Stars", "Cards", "HP", "DEF", "ATK", "SPD", totalHead], rows.map(r => [`${r[0]}★`, ...r.slice(1).map(v => (v == null ? "—" : v))])),
      { tip: "Means over the creatures and minions of each star level; a stat over the cards that have it" }));
    at = charts.length;

    // 5 distributions (small multiples): 0–10, and a pager on a stat with higher values (Sonic's speed is 20)
    const dist = keys.map(([k, l]) => {
      const counts = countValues(creatures, k), pages = distPages(counts);
      return { k, l, counts, pages, yMax: niceMax(Math.max(1, ...counts.values())), cur: pages.includes(ctx.distPage?.[k]) ? ctx.distPage[k] : 0,
        href: v => L({ kind: MINIONS, [k]: `${v}-${v}` }) };
    });
    const values = [...new Set([...Array.from({ length: 11 }, (_, i) => i), ...dist.flatMap(d => [...d.counts.keys()].filter(v => v > 10))])].sort((a, b) => a - b);
    charts.push(card("dist", "Stat distributions", "Creatures and minions per value.", `<div class="dist-grid">${dist.map(distPanel).join("")}</div>`,
      table(["Value", ...keys.map(([, l]) => l)], values.map(v => [String(v), ...dist.map(d => d.counts.get(v) || 0)])), { wide: true }));

    // 6 power outliers (emphasis scatter)
    const complete = creatures.filter(c => c.stars && [c.hp, c.def, c.atk, c.spd].every(v => v != null));
    const offChart = complete.filter(c => total(c) > 40 || c.stars > 8);   // e.g. Tainted Lazarus (stats above 10 on purpose)
    const full = complete.filter(c => !offChart.includes(c));
    const stat = {};
    for (const t of tiers) {
      const v = full.filter(c => c.stars === t).map(total);
      const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1);
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length || 1)) || 1;
      stat[t] = { mean, sd };
    }
    const pts = full.map((c, i) => {
      const z = (total(c) - stat[c.stars].mean) / stat[c.stars].sd;
      return { x: c.stars, jx: c.stars + (((i * 7919) % 100) / 100 - 0.5) * 0.7, y: total(c), label: c.name, card: c.id, z, hot: Math.abs(z) >= 1.5 };
    });
    pts.filter(p => p.hot).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 8).forEach(p => (p.showLabel = true));
    if (pts.length > 3) {
      charts.push(card("outliers", "Total stats vs star level", "Highlighted: far from their star level's average.",
        scatter(pts, { xLabel: "star level", yLabel: "HP + DEF + ATK + SPD", xTicks: tiers }),
        table(["Card", "Stars", "Total", { label: "vs tier avg (σ)", tip: "Standard deviations between its total and its star level's average total" }], [...pts.filter(p => p.hot).sort((a, b) => b.z - a.z).map(p => [p.label, `${p.x}★`, p.y, Math.round(p.z * 10) / 10]),
          ...offChart.map(c => [c.name, `${c.stars}★`, total(c), "off the chart"])], 1),
        { wide: true, tip: "Highlighted: totals 1.5 or more standard deviations from their star level's average" }));
    }
  }

  charts.splice(at < 0 ? charts.length : at, 0, ...cardCharts(pool, creatures, L));

  // 7 creature types
  const types = new Map();
  for (const c of pool) for (const t of new Set(c.types || [])) types.set(t, (types.get(t) || 0) + 1);
  const typeRows = desc(types).map(([t, v]) => {
    const ic = icons[t.toLowerCase().replace(/[\s_\-.'’]+/g, "")];
    return { label: t.replace(/_/g, " "), value: v, href: L({ types: t }), html: `${ic ? `<img src="${esc(ic.file)}" alt="">` : ""}<span>${esc(t.replace(/_/g, " "))}</span>` };
  });
  if (typeRows.length) charts.push(card("types", "Types on cards", "Cards with each type.", hbar(typeRows), table(["Type", "Cards"], typeRows.map(r => [r.label, r.value]))));

  // 8 timing tags (not neutral ones such as Action)
  const tags = new Map();
  for (const c of pool) for (const t of tagsOf(c)) tags.set(t, (tags.get(t) || 0) + 1);     // counted under the canonical case
  const tagRows = desc(tags).slice(0, 18).map(([t, v]) => ({ label: `(${t}) ${tagInfo(t).meaning}`, value: v, href: L({ tag: t }), html: badgeHtml(t) }));
  if (tagRows.length) charts.push(card("tags", "Timing tags", "Abilities using each tag.", hbar(tagRows, { labelWidth: 110, unit: "uses" }),
    table(["Tag", "Meaning", { label: "Uses", tip: "Times the tag appears in the abilities of cards in scope" }], desc(tags).map(([t, v]) => [`(${t})`, tagInfo(t).meaning, v]), 2),
    { tip: "Times each timing tag appears in these cards' abilities; (Action) isn't counted" }));

  // 9 status effects + 10 most referenced
  const refCount = new Map(), statusIds = new Set(cards.filter(c => c.type === "debuff" || c.type === "buff").map(c => c.id));
  for (const c of pool) for (const id of ctx.mentions.get(c.id) || []) refCount.set(id, (refCount.get(id) || 0) + 1);
  const byId = ctx.byId;
  const statusRows = desc(new Map([...refCount].filter(([id]) => statusIds.has(id)))).slice(0, 15).map(([id, v]) => ({ label: byId.get(id).name, value: v, href: L({ mentions: id }) }));
  const unused = cards.filter(c => c._unused && (c.type === "buff" || c.type === "debuff") && (!series || c.series === series)).sort((a, b) => a.name.localeCompare(b.name));
  const unusedHtml = unused.length ? `<p class="muted">${noted("On no card", "Buffs and debuffs that no card on the site names in its ability")} (${unused.length}): ${unused.map(c => `<a href="#/card/${c.id}">${esc(c.name)}</a>`).join(", ")}</p>` : "";
  if (statusRows.length) charts.push(card("status", "Status effects mentioned", "Cards naming each one.", hbar(statusRows) + unusedHtml, table(["Status effect", "Cards"], statusRows.map(r => [r.label, r.value])),
    { tip: "Cards in scope whose ability names each buff or debuff; the top 15" }));
  const refRows = desc(new Map([...refCount].filter(([id]) => !statusIds.has(id)))).slice(0, 12).map(([id, v]) => ({ label: byId.get(id).name, value: v, href: L({ mentions: id }) }));
  if (refRows.length) charts.push(card("refs", "Most referenced cards", "Cards naming them.", hbar(refRows, { labelWidth: 180 }), table(["Card", { label: "Mentioned by", tip: "Cards in scope whose ability names this card" }], refRows.map(r => [r.label, r.value]))));

  // 11 authors
  const authors = desc(count(pool, c => c.author)).map(([k, v]) => ({ label: k, value: v, href: L({ author: k }) }));
  if (authors.length) charts.push(card("authors", "Cards per author", "", hbar(authors), table(["Author", "Cards"], authors.map(r => [r.label, r.value]))));

  root.innerHTML = `<div class="filters-row">
      <label>Kind <select data-action="stats-filter" data-key="kind"><option value="">All cards</option>${kinds.map(k => `<option value="${esc(k)}"${k === kind ? " selected" : ""}>${esc(KIND_LABEL[k] || k)}</option>`).join("")}</select></label>
      <label>Series <select data-action="stats-filter" data-key="series"><option value="">All series</option>${allSeries.map(s => `<option${s === series ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
      <span class="muted">${pool.length} cards in scope</span>
      <nav class="stats-jump" aria-label="Sections"><a href="#/stats" data-scroll="stats-balance">Balance</a>${cards.some(c => (c.ratings || []).some(e => !e._staged && !e._sent)) ? `<a href="#/stats" data-scroll="stats-ratings">Ratings</a>` : ""}<a href="#/stats" data-scroll="stats-history">History</a></nav></div>
    <div class="kpis">${kpis.map(([l, v, tip]) => `<div class="kpi"><div class="label">${noted(l, tip)}</div><div class="value${typeof v === "number" ? "" : " text"}">${esc(typeof v === "number" ? v.toLocaleString() : v)}</div></div>`).join("")}</div>
    <div class="charts">${charts.join("")}</div>
    <div id="stats-balance"></div><div id="stats-ratings"></div><div id="stats-history"></div>`;
}

export { columns, card as chartCard, hbar, table, stacked, fmt, trunc, cardsHref, go, svgRole };   // profile.js's activity chart, balance.js, insights.js
