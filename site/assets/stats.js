// Stats dashboard. Marks follow the dataviz method: thin bars with 4px rounded data-ends, hairline grid,
// values at bar tips, legends for multi-series, hover tooltips, and a table view for every chart.
import { esc, tagInfo, badgeHtml, TAG } from "./text.js";
import { total } from "./search.js";
import { HAND } from "./deck.js";
import { date, monthKey } from "./history.js";

// the game's names (rulebook "04 Table")
const KIND_LABEL = { creature: "Creatures", item: "Items", field: "Field cards", minion: "Minions", nme: "N.M.E. items", "aux item": "Auxiliary items",
  debuff: "Debuffs", buff: "Buffs", creatures: "Auxiliary creatures", unknown: "Other" };
const fmt = n => (Math.round(n * 10) / 10).toLocaleString();

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

/** Horizontal bars. rows: [{label, value, html?, card?}] */
function hbar(rows, { labelWidth = 150, unit = "cards", color = "var(--s1)", chars = 24 } = {}) {
  const rowH = 26, bar = 14, W = 560, plotW = W - labelWidth - 48;
  const max = Math.max(1, ...rows.map(r => r.value));
  const H = rows.length * rowH + 4;
  const parts = rows.map((r, i) => {
    const y = i * rowH, w = (r.value / max) * plotW;
    const label = r.html
      ? `<foreignObject x="0" y="${y}" width="${labelWidth - 8}" height="${rowH}"><div xmlns="http://www.w3.org/1999/xhtml" class="svg-label">${r.html}</div></foreignObject>`
      : `<text class="lbl" x="${labelWidth - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(trunc(r.label, chars))}</text>`;
    return `<g class="row" data-v="${esc(fmt(r.value))} ${esc(unit)}" data-l="${esc(r.label)}"${r.card ? ` data-card="${esc(r.card)}"` : ""}>
      <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}"/>${label}
      <path class="mark" d="${roundedRight(labelWidth, y + (rowH - bar) / 2, w, bar)}" fill="${color}"/>
      <text class="val" x="${labelWidth + w + 6}" y="${y + rowH / 2 + 4}">${esc(fmt(r.value))}</text></g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img"><line class="axis" x1="${labelWidth}" x2="${labelWidth}" y1="0" y2="${H - 4}"/>${parts.join("")}</svg>`;
}
const SUB_BARS = { labelWidth: 250, chars: 36 };           // subseries names are long ("Paper Mario: The Thousand-Year Door")
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Vertical columns: [{label, value}] (single series; label every Nth tick). */
function columns(cols, { unit = "cards", color = "var(--s1)", every = 1, height = 200, width = 1000 } = {}) {
  const W = width, padL = 36, padB = 26, plotH = height - padB, n = cols.length;
  const max = niceMax(Math.max(1, ...cols.map(c => c.value)));
  const band = (W - padL) / Math.max(1, n), bw = Math.min(24, band * 0.7);
  const ticks = [0, max / 2, max].map(t => {
    const y = plotH - (t / max) * plotH;
    return `<line class="gridline" x1="${padL}" x2="${W}" y1="${y}" y2="${y}"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`;
  }).join("");
  const parts = cols.map((c, i) => {
    const x = padL + i * band + (band - bw) / 2, h = (c.value / max) * plotH;
    return `<g class="col" data-v="${esc(fmt(c.value))} ${esc(unit)}" data-l="${esc(c.label)}">
      <rect class="hit" x="${padL + i * band}" y="0" width="${band}" height="${height}"/>
      <path class="mark" d="${roundedTop(x, plotH - h, bw, h)}" fill="${color}"/>
      ${i % every === 0 ? `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${esc(c.label)}</text>` : ""}</g>`;
  });
  return `<svg viewBox="0 0 ${W} ${height}" role="img">${ticks}<line class="axis" x1="${padL}" x2="${W}" y1="${plotH}" y2="${plotH}"/>${parts.join("")}</svg>`;
}

/** Stacked columns with a 2px surface gap between segments. cats: labels; series: [{key,label,color}]; get(cat,key) */
function stacked(cats, series, get, { height = 230, unit = "cards", width = 1000, every = 1 } = {}) {
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
      return `<path class="mark" d="${d}" fill="${sr.color}" data-v="${v} ${esc(unit)}" data-l="${esc(`${sr.label}, ${cat}`)}"/>`;
    }).join("");
    return `<g class="col"><rect class="hit" x="${padL + i * band}" y="0" width="${band}" height="${plotH}" data-v="${totals[i]} ${esc(unit)}" data-l="${esc(`${cat}: ${series.map(sr => `${sr.label} ${get(cat, sr.key)}`).join(" · ")}`)}"/>${segs}
      ${i % every === 0 ? `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${esc(cat)}</text>` : ""}</g>`;
  });
  return `<svg viewBox="0 0 ${W} ${height}" role="img">${ticks}<line class="axis" x1="${padL}" x2="${W}" y1="${plotH}" y2="${plotH}"/>${parts.join("")}</svg>`;
}

/** Scatter with emphasis: [{x, y, label, card, hot}] — hot points in the accent, the rest de-emphasised. */
function scatter(points, { xLabel, yLabel, xTicks, height = 300 }) {
  const W = 1000, padL = 44, padB = 34, plotH = height - padB;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x0 = Math.min(...xs) - 0.6, x1 = Math.max(...xs) + 0.6, y1 = niceMax(Math.max(...ys)), y0 = 0;
  const X = v => padL + ((v - x0) / (x1 - x0)) * (W - padL - 10), Y = v => plotH - ((v - y0) / (y1 - y0)) * plotH;
  const grid = [0, y1 / 4, y1 / 2, (3 * y1) / 4, y1].map(t => `<line class="gridline" x1="${padL}" x2="${W}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${padL - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
  const xt = xTicks.map(t => `<text x="${X(t)}" y="${height - 14}" text-anchor="middle">${esc(String(t))}★</text>`).join("");
  const sorted = [...points].sort((a, b) => (a.hot ? 1 : 0) - (b.hot ? 1 : 0));
  const dots = sorted.map(p => `<g class="dot" data-card="${esc(p.card)}" data-v="${p.y} total" data-l="${esc(p.label)}">
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
  return `<div class="table-wrap"><table class="data"><thead><tr>${head.map((h, i) => `<th class="${i >= numericFrom ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td class="${i >= numericFrom ? "num" : ""}">${typeof v === "number" ? esc(fmt(v)) : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
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
function heatScale() {
  const css = getComputedStyle(document.documentElement), get = n => hex2rgb(css.getPropertyValue(n));
  const lo = oklab(get("--seq-100")), hi = oklab(get("--seq-700")), dark = luminance([11, 11, 11]), light = luminance([240, 239, 236]);
  const at = p => rgbOf(lo.map((v, i) => v + (hi[i] - v) * (p / 100)));
  const pass = rgb => { const L = luminance(rgb); return Math.max(contrast(L, dark), contrast(L, light)) >= 4.5; };
  return p => {
    let q = p;
    for (let d = 0; d <= 50 && !pass(at(q)); d++) { if (p - d >= 0 && pass(at(p - d))) { q = p - d; break; } if (p + d <= 100 && pass(at(p + d))) { q = p + d; break; } }
    const rgb = at(q), L = luminance(rgb);
    return { bg: `rgb(${rgb.join(",")})`, ink: contrast(L, dark) >= contrast(L, light) ? "#0b0b0b" : "#f0efec" };
  };
}

function card(id, title, sub, chartHtml, tableHtml, { wide = false, legend = "" } = {}) {
  return `<section class="chart${wide ? " wide" : ""}" id="chart-${id}">
    <header><h3>${esc(title)}</h3>${tableHtml ? `<button type="button" class="ghost" data-action="toggle-table" data-target="${id}" aria-pressed="false">Table</button>` : ""}</header>
    ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}${legend}
    <div class="view-chart">${chartHtml}</div>${tableHtml ? `<div class="view-table" hidden>${tableHtml}</div>` : ""}</section>`;
}

// ---- the dashboard ---------------------------------------------------------------------------------
export function renderStats(root, ctx, params) {
  const { cards, renderer, banned, icons } = ctx;
  const kind = params.get("kind") || "", series = params.get("series") || "";
  // a duplicate (another PNG from the same PSD: Breakfast, Supper for A Snack) is the same card: count it once
  let pool = cards.filter(c => !c.dup && (!kind || c.type === kind) && (!series || c.series === series));
  const kinds = [...new Set(cards.map(c => c.type))].sort((a, b) => cards.filter(c => c.type === b).length - cards.filter(c => c.type === a).length);
  const allSeries = [...new Set(cards.filter(c => c.series).map(c => c.series))].sort();
  const count = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (k == null || k === "") continue; m.set(k, (m.get(k) || 0) + 1); } return m; };
  const desc = m => [...m.entries()].sort((a, b) => b[1] - a[1]);

  const subKey = c => (c.subseries ? `${c.series || ""}\u0001${c.subseries}` : null);     // a subseries belongs to its series
  const subCount = new Set(pool.map(subKey).filter(Boolean)).size;

  // KPI tiles
  const latest = pool.reduce((m, c) => Math.max(m, c.ts || 0), 0);
  const kpis = [
    ["Cards", pool.length], ["Creatures", pool.filter(c => c.type === "creature").length], ["Items", pool.filter(c => c.type === "item").length],
    ["Series", new Set(pool.map(c => c.series).filter(Boolean)).size], ...(subCount ? [["Subseries", subCount]] : []), ["Authors", new Set(pool.map(c => c.author).filter(Boolean)).size],
    ["Banned (constructed)", pool.filter(c => banned.has(c.id)).length],
    ["Last card update", latest ? date(latest) : "—"],
  ];
  const charts = [];

  // 1 kinds
  const byKind = desc(count(pool, c => c.type)).map(([k, v]) => ({ label: KIND_LABEL[k] || k, value: v }));
  charts.push(card("kinds", "Cards by kind", `${pool.length} cards`, hbar(byKind), table(["Kind", "Cards"], byKind.map(r => [r.label, r.value]))));

  // 2 series
  const ser = desc(count(pool.filter(c => c.type === "creature"), c => c.series));
  const top = ser.slice(0, 15).map(([k, v]) => ({ label: k, value: v }));
  const rest = ser.slice(15).reduce((s, [, v]) => s + v, 0);
  if (rest) top.push({ label: `Other (${ser.length - 15} series)`, value: rest });
  if (top.length) charts.push(card("series", "Creatures by series", `${ser.length} series`, hbar(top, { labelWidth: 190 }), table(["Series", "Creatures"], ser.map(([k, v]) => [k, v]))));

  // 2b subseries: of the picked series (cards without one as their own row), else the top ones overall
  if (subCount && series) {
    const rows = desc(count(pool, c => c.subseries)).map(([k, v]) => ({ label: k, value: v }));
    const none = pool.filter(c => !c.subseries).length;
    if (none) rows.push({ label: "No subseries", value: none });
    charts.push(card("subseries", `${series} by subseries`, `${subCount} subseries`, hbar(rows, SUB_BARS), table(["Subseries", "Cards"], rows.map(r => [r.label, r.value]))));
  } else if (subCount) {
    const all = desc(count(pool, subKey)).map(([k, v]) => { const [s, sub] = k.split("\u0001"); return { label: sub, series: s, value: v }; });
    const shared = new Set(all.filter((r, i) => all.findIndex(x => x.label === r.label) !== i).map(r => r.label));   // same name in two series
    const bars = all.slice(0, 15).map(r => { if (!shared.has(r.label)) return r;             // keep the series readable
      const s = r.series || "no series"; return { ...r, label: `${trunc(r.label, SUB_BARS.chars - s.length - 3)} (${s})` }; });
    charts.push(card("subseries", "Top subseries", `${subCount} subseries; pick a series for its breakdown`, hbar(bars, SUB_BARS),
      table(["Subseries", "Series", "Cards"], all.map(r => [r.label, r.series, r.value]), 2)));
  }

  // 3 starting-hand depth: for each star level the constructed hand uses (rulebook "03 Setting Up"), how many legal
  //   cards there are to pick from. Not banned, parsed by the bot; the same pool the deck builder offers.
  const handRows = [];
  for (const g of HAND) {
    if (kind && kind !== g.kind) continue;
    for (const [st, need] of g.tiers) {
      const all = pool.filter(c => c.type === g.kind && c.stars === st && c.parsed !== false);
      const legal = all.filter(c => !banned.has(c.id)).length;
      handRows.push({ label: `${st}★ ${g.label.toLowerCase()}`, value: legal, need, bannedN: all.length - legal, per: legal / need, kind: g.label });
    }
  }
  if (handRows.length) {
    const rows = handRows.map(r => ({ label: `${r.label} · hand needs ${r.need}`, value: r.value, html: `<span>${esc(r.label)}</span><span class="muted">needs ${r.need}</span>` }));
    charts.push(card("hand", "Starting-hand choices", "Legal cards per star level vs. how many the hand takes.",
      hbar(rows, { labelWidth: 190, unit: "legal cards" }),
      table(["Star level", "Hand needs", "Legal cards", "Banned", "Choices per pick"], handRows.map(r => [r.label, r.need, r.value, r.bannedN, Math.round(r.per * 10) / 10]))));
  }

  // 4 average stats by star tier (heat table)
  // creatures and minions ("for most purposes, minions are considered creatures": rulebook "15 Minions")
  const creatures = pool.filter(c => (c.type === "creature" || c.type === "creatures" || c.type === "minion") && c.hp != null);
  const tiers = [...new Set(creatures.map(c => c.stars).filter(Boolean))].sort((a, b) => a - b);
  if (tiers.length) {
    const keys = [["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"]];
    const avg = (arr, f) => { const v = arr.map(f).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const rows = tiers.map(t => { const g = creatures.filter(c => c.stars === t); return [t, g.length, ...keys.map(([k]) => avg(g, c => c[k])), avg(g, total)]; });
    const heatColor = heatScale();
    const shade = (v, lo, hi) => {
      if (v == null) return "";
      const { bg, ink } = heatColor(hi > lo ? Math.round(((v - lo) / (hi - lo)) * 100) : 50);
      return `style="background:${bg};color:${ink}"`;
    };
    const cols = [2, 3, 4, 5, 6].map(i => { const v = rows.map(r => r[i]).filter(x => x != null); return [Math.min(...v), Math.max(...v)]; });
    const heat = `<div class="table-wrap"><table class="data heat"><thead><tr><th>Stars</th><th class="num">Cards</th>${keys.map(([, l]) => `<th class="num">${l}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r[0]}★</td><td class="num">${r[1]}</td>${[2, 3, 4, 5, 6].map((i, j) => `<td class="num" ${shade(r[i], ...cols[j])}>${r[i] == null ? "—" : fmt(r[i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    charts.push(card("tiers", "Average stats by star level", "Creatures and minions. Darker = higher in its column.", heat,
      table(["Stars", "Cards", "HP", "DEF", "ATK", "SPD", "Total"], rows.map(r => [`${r[0]}★`, ...r.slice(1).map(v => (v == null ? "—" : v))]))));

    // 5 distributions (small multiples)
    // every value up to 20 (stats can pass 10: Sonic's speed is 20); anything higher shares a last "21+" column
    const high = Math.max(10, ...creatures.flatMap(c => keys.map(([k]) => c[k] ?? 0))), top = Math.min(high, 20);
    const bins = Array.from({ length: top + 1 }, (_, i) => [String(i), v => v === i]);
    if (high > top) bins.push([`${top + 1}+`, v => v > top]);
    const binCounts = k => bins.map(([label, hit]) => ({ label, value: creatures.filter(c => c[k] != null && hit(c[k])).length }));
    const multiples = keys.map(([k, l]) => `<div><div class="legend" style="margin:6px 0 0">${l}</div>${columns(binCounts(k), { height: 170, width: 320 })}</div>`).join("");
    charts.push(card("dist", "Stat distributions", `Creatures and minions per value (0–${high > top ? `${top}, ${top + 1}+` : top})`, `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">${multiples}</div>`,
      table(["Value", ...keys.map(([, l]) => l)], bins.map(([label], i) => [label, ...keys.map(([k]) => binCounts(k)[i].value)])), { wide: true }));

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
      charts.push(card("outliers", "Total stats vs star level", `Highlighted: 1.5σ+ from their star level's average (possible outliers).${offChart.length ? ` Off the chart: ${offChart.map(c => `${c.name} (${c.stars}★, ${total(c)})`).join(", ")}.` : ""}`,
        scatter(pts, { xLabel: "star level", yLabel: "HP + DEF + ATK + SPD", xTicks: tiers }),
        table(["Card", "Stars", "Total", "vs tier avg (σ)"], pts.filter(p => p.hot).sort((a, b) => b.z - a.z).map(p => [p.label, `${p.x}★`, p.y, Math.round(p.z * 10) / 10]), 1), { wide: true }));
    }
  }

  // 7 creature types
  const types = new Map();
  for (const c of pool) for (const t of c.types || []) types.set(t, (types.get(t) || 0) + 1);
  const typeRows = desc(types).map(([t, v]) => {
    const ic = icons[t.toLowerCase().replace(/[\s_\-.'’]+/g, "")];
    return { label: t.replace(/_/g, " "), value: v, html: `${ic ? `<img src="${esc(ic.file)}" alt="">` : ""}<span>${esc(t.replace(/_/g, " "))}</span>` };
  });
  if (typeRows.length) charts.push(card("types", "Types on cards", "", hbar(typeRows), table(["Type", "Cards"], typeRows.map(r => [r.label, r.value]))));

  // 8 timing tags (not neutral ones such as Action)
  const tags = new Map();
  for (const c of pool) for (const m of (c.ability || "").matchAll(new RegExp(TAG.source, "g"))) {
    const t = tagInfo(m[1]);   // counted under the canonical case
    if (t && t.group !== "neutral") tags.set(t.tag, (tags.get(t.tag) || 0) + 1);
  }
  const tagRows = desc(tags).slice(0, 18).map(([t, v]) => ({ label: `(${t}) ${tagInfo(t).meaning}`, value: v, html: badgeHtml(t) }));
  if (tagRows.length) charts.push(card("tags", "Timing tags", "", hbar(tagRows, { labelWidth: 110, unit: "uses" }),
    table(["Tag", "Meaning", "Uses"], desc(tags).map(([t, v]) => [`(${t})`, tagInfo(t).meaning, v]), 2)));

  // 9 status effects + 10 most referenced
  const refCount = new Map(), statusIds = new Set(cards.filter(c => c.type === "debuff" || c.type === "buff").map(c => c.id));
  for (const c of pool) for (const id of ctx.mentions.get(c.id) || []) refCount.set(id, (refCount.get(id) || 0) + 1);
  const byId = ctx.byId;
  const statusRows = desc(new Map([...refCount].filter(([id]) => statusIds.has(id)))).slice(0, 15).map(([id, v]) => ({ label: byId.get(id).name, value: v, card: id }));
  const unused = cards.filter(c => c._unused && (!series || c.series === series)).sort((a, b) => a.name.localeCompare(b.name));
  const unusedHtml = unused.length ? `<p class="muted">On no card (${unused.length}): ${unused.map(c => `<a href="#/card/${c.id}">${esc(c.name)}</a>`).join(", ")}</p>` : "";
  if (statusRows.length) charts.push(card("status", "Status effects mentioned", "Cards naming each one", hbar(statusRows) + unusedHtml, table(["Status effect", "Cards"], statusRows.map(r => [r.label, r.value]))));
  const refRows = desc(new Map([...refCount].filter(([id]) => !statusIds.has(id)))).slice(0, 12).map(([id, v]) => ({ label: byId.get(id).name, value: v, card: id }));
  if (refRows.length) charts.push(card("refs", "Most referenced cards", "Cards naming them", hbar(refRows, { labelWidth: 180 }), table(["Card", "Mentioned by"], refRows.map(r => [r.label, r.value]))));

  // 11 authors
  const authors = desc(count(pool, c => c.author)).map(([k, v]) => ({ label: k, value: v }));
  if (authors.length) charts.push(card("authors", "Cards per author", "", hbar(authors), table(["Author", "Cards"], authors.map(r => [r.label, r.value]))));

  // 12 banned reasons
  const reasons = new Map();
  for (const g of ctx.banlist.groups) for (const e of g.entries) for (const r of e.reason.split(/,\s*/)) if (r) reasons.set(r, (reasons.get(r) || 0) + 1);
  const reasonRows = desc(reasons).map(([k, v]) => ({ label: k, value: v }));
  if (reasonRows.length && !kind && !series) charts.push(card("bans", "Constructed ban reasons", "", hbar(reasonRows, { labelWidth: 230, unit: "bans" }), table(["Reason", "Bans"], reasonRows.map(r => [r.label, r.value]))));

  // 13 timeline
  const months = new Map();
  for (const c of pool) if (c.ts) { const k = monthKey(c.ts); months.set(k, (months.get(k) || 0) + 1); }     // Pacific
  const keysSorted = [...months.keys()].sort();
  if (keysSorted.length) {
    const [y0, m0] = keysSorted[0].split("-").map(Number), [y1, m1] = keysSorted[keysSorted.length - 1].split("-").map(Number);
    const cols = [];
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      cols.push({ label: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }), value: months.get(k) || 0 });
    }
    charts.push(card("timeline", "Last change by month", "", columns(cols, { every: Math.ceil(cols.length / 12) }),
      table(["Month", "Cards"], cols.map(c => [c.label, c.value])), { wide: true }));
  }

  root.innerHTML = `<div class="filters-row">
      <label>Kind <select data-action="stats-filter" data-key="kind"><option value="">All cards</option>${kinds.map(k => `<option value="${esc(k)}"${k === kind ? " selected" : ""}>${esc(KIND_LABEL[k] || k)}</option>`).join("")}</select></label>
      <label>Series <select data-action="stats-filter" data-key="series"><option value="">All series</option>${allSeries.map(s => `<option${s === series ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
      <span class="muted">${pool.length} cards in scope</span></div>
    <div class="kpis">${kpis.map(([l, v]) => `<div class="kpi"><div class="label">${esc(l)}</div><div class="value${typeof v === "number" ? "" : " text"}">${esc(typeof v === "number" ? v.toLocaleString() : v)}</div></div>`).join("")}</div>
    <div class="charts">${charts.join("")}</div>
    <div id="stats-balance"></div>`;
}

export { columns, card as chartCard, hbar, table, stacked, fmt, trunc };   // the person page's activity chart (profile.js), the Balance charts (balance.js)
