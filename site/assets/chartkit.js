// Chart primitives (SVG strings) for stats.js, balance.js, insights.js and profile.js: a chunk of their own, so a card's
// Balance block and the People pages load them without the Stats page (app.js loadAnalytics, NOTES.md §33).
import { esc, noted, headHtml } from "./text.js";

const NF = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });   // one formatter: toLocaleString per value was a hotspot
const PLAIN = NF.format(-123) === "-123";   // whole numbers under 1000 print as String() does here: skip the formatter (most values)
const fmt = n => { const v = Math.round(n * 10) / 10; return PLAIN && Number.isInteger(v) && v > -1000 && v < 1000 && !Object.is(v, -0) ? String(v) : NF.format(v); };

// ---- links to the Cards grid: a chart element that stands for a set of cards (app.js filterCards reads the params) --
/** "#/cards?…" for p's filters within the Stats page's scope (its kind and series; global: none); no duplicates, as Stats */
function cardsHref(p, scope = null) {
  const q = new URLSearchParams(), kind = scope?.get("kind") || p.kind, series = p.series || scope?.get("series");
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
/** a phone's panel (under 600 px): the Stats page's charts draw at about its width (narrow), so labels keep their size */
const narrowOf = el => el.clientWidth > 0 && el.clientWidth < 600;
/** narrow x labels: every Nth, so none touch (about 6.6 units a character) */
const thin = (labels, every, W) => Math.max(every, Math.ceil(labels.length * (Math.max(0, ...labels.map(l => String(l).length)) * 6.6 + 10) / (W - 50)));

/** Horizontal bars. rows: [{label, value, html?, card?, href?, tip?}] */
function hbar(rows, { labelWidth = 150, unit = "cards", chars = 24, narrow = false } = {}) {
  const cap = rows.some(r => r.html) ? 160 : 130;          // narrow: an HTML label can't be shortened: more room
  if (narrow && labelWidth > cap) { chars = Math.round((chars * cap) / labelWidth); labelWidth = cap; }
  const rowH = 26, W = narrow ? 340 : 560, plotW = W - labelWidth - 48;
  const max = Math.max(1, ...rows.map(r => r.value));
  const H = rows.length * rowH + 4;
  const parts = rows.map((r, i) => {
    const y = i * rowH, w = (r.value / max) * plotW, bar = 14;
    const label = r.html
      ? `<foreignObject x="0" y="${y}" width="${labelWidth - 8}" height="${rowH}"><div xmlns="http://www.w3.org/1999/xhtml" class="svg-label">${r.html}</div></foreignObject>`
      : `<text class="lbl" x="${labelWidth - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(trunc(r.label, chars))}</text>`;
    return go(r.href, r.tip || r.label, `<g class="row" data-v="${esc(fmt(r.value))} ${esc(unit)}" data-l="${esc(r.tip || r.label)}"${r.card && !r.href ? ` data-card="${esc(r.card)}"` : ""}>
      <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}"/>${label}
      <path class="mark" d="${roundedRight(labelWidth, y + (rowH - bar) / 2, w, bar)}" fill="var(--s1)"/>
      <text class="val" x="${labelWidth + w + 6}" y="${y + rowH / 2 + 4}">${esc(fmt(r.value))}</text></g>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}"${svgRole(rows.some(r => r.href))}><line class="axis" x1="${labelWidth}" x2="${labelWidth}" y1="0" y2="${H - 4}"/>${parts.join("")}</svg>`;
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Vertical columns: [{label, value, href?}] (single series; label every Nth tick; max: a fixed y scale; minH: a non-zero
    column's least height; vals: its count over it). */
/** padT: room above the top tick's number, for a label sitting right above the chart (it would cover the number) */
function columns(cols, { unit = "cards", color = "var(--s1)", every = 1, height = 200, width = 1000, max: fixed, minH = 0, vals = false, padT = 0, narrow = false } = {}) {
  if (narrow && width > 360) { width = 360; every = thin(cols.map(c => c.label), every, width); }
  const W = width, padL = 36, padR = narrow ? 14 : 0, padB = 26, plotH = height - padB - padT, base = padT + plotH, n = cols.length;
  const max = fixed ?? niceMax(Math.max(1, ...cols.map(c => c.value)));
  const band = (W - padL - padR) / Math.max(1, n), bw = Math.min(24, band * 0.7);
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
function stacked(cats, series, get, { unit = "cards", width = 1000, every = 1, href = () => null, narrow = false } = {}) {
  if (narrow && width > 360) { width = 360; every = thin(cats, every, width); }
  const height = 230, W = width, padL = 36, padR = narrow ? 14 : 0, padB = 26, plotH = height - padB, gap = 2;
  const totals = cats.map(c => series.reduce((s, sr) => s + get(c, sr.key), 0));
  const max = niceMax(Math.max(1, ...totals));
  const band = (W - padL - padR) / cats.length, bw = Math.min(24, band * 0.6);
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

function table(head, rows, numericFrom = 1) {
  return `<div class="table-wrap"><table class="data"><thead><tr>${head.map((h, i) => `<th class="${i >= numericFrom ? "num" : ""}">${headHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td class="${i >= numericFrom ? "num" : ""}">${typeof v === "number" ? esc(fmt(v)) : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** A chart card, open on its chart (the Table button shows the table); tip: the title's note */
function card(id, title, sub, chartHtml, tableHtml, { wide = false, legend = "", tip = "" } = {}) {
  return `<section class="chart${wide ? " wide" : ""}" id="chart-${id}">
    <header><h3>${noted(title, tip)}</h3>${tableHtml ? `<button type="button" class="ghost" data-action="toggle-table" data-target="${id}" aria-pressed="false">Table</button>` : ""}</header>
    ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}${legend}
    <div class="view-chart">${chartHtml}</div>${tableHtml ? `<div class="view-table" hidden>${tableHtml}</div>` : ""}</section>`;
}

export { fmt, cardsHref, go, svgRole, roundedTop, niceMax, narrowOf, thin, hbar, trunc, columns, stacked, table, card as chartCard };
