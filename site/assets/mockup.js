// The quick image mock-up: the edited name, text and stats drawn over the card image in a canvas, at once, in the
// browser (the Edit dialog and the card page, edit mode). Never the real image: the bake draws that (preview.js).
// Layout: the PSD's text boxes when the details record has them (text[].box, canvas px), else the card template's
// (TEMPLATES, measured on the PSDs) narrowed to where the image shows text (findText). The old text is erased with the
// card's own background (erase), the new one drawn in the card's font (data/fonts.json -> MDW/Fonts as a web font) with
// icon tokens as icons. Everything above `draw` is pure (node checks run it on plain pixel arrays).
import { norm } from "./text.js";

export const LABEL = "Mock-up: the real image comes from the bake";
const STATS = ["hp", "def", "atk", "spd"];
export const LINE = 1.22;                            // line pitch in ems (findText reads a size back from it)
// fractions of the image [x0, y0, x1, y1]: where a template prints the name and the text; its stat bars (one row per stat,
// `step` apart, 10 cells across `box`). Measured on the PSDs' layer boxes (2026-10-23): tall = 1200x2400 creatures and
// minions (311 of 390 with stat rows sit exactly here), item = 1200x1800 items and field cards (the totems' two rows),
// square = 1200x1200 status effects.
export const TEMPLATES = {
  tall: { name: [0.2, 0, 0.8, 0.1], ability: [0.012, 0.722, 0.988, 0.995], bars: { box: [0.3, 0.5, 0.978, 0.535], step: 0.0525 } },
  item: { name: [0.2, 0, 0.8, 0.165], ability: [0.012, 0.6, 0.988, 0.995], bars: { box: [0.308, 0.624, 0.986, 0.671], step: 0.053 } },
  square: { name: [0.17, 0, 0.83, 0.15], ability: [0.012, 0.68, 0.988, 0.995] },
};
/** The template of an image w x h: "tall", "item", "square", or "" (a rulebook page, another size). */
export const shapeOf = (w, h) => { const r = h / w; return r > 1.9 && r < 2.1 ? "tall" : r > 1.4 && r < 1.6 ? "item" : r > 0.9 && r < 1.1 ? "square" : ""; };   // 1080x1920 rulebook pages: none
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Luminance (0-255) of RGBA pixels. */
export function luma(data) {
  const L = new Uint8Array(data.length / 4);
  for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  return L;
}
const px = (box, W, H) => [clamp(Math.round(box[0]), 0, W), clamp(Math.round(box[1]), 0, H), clamp(Math.round(box[2]), 0, W), clamp(Math.round(box[3]), 0, H)];
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const smooth = (a, r) => { const out = new Float32Array(a.length); for (let i = 0; i < a.length; i++) { let s = 0, n = 0; for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) { s += a[k]; n++; } out[i] = s / n; } return out; };
/** Runs of indexes where a[i] > thr: [[start, end)]. */
export function runs(a, thr) {
  const out = []; let s = -1;
  for (let i = 0; i <= a.length; i++) {
    const on = i < a.length && a[i] > thr;
    if (on && s < 0) s = i; else if (!on && s >= 0) { out.push([s, i]); s = -1; }
  }
  return out;
}

/** Where the image shows text inside box (px): {box, lines: [[x0, y0, x1, y1]], size (font px), align: "center" | "left"},
 *  or null. Text is where many sharp edges are (glyphs with their outline). Rows: hysteresis, so a short last line
 *  ("it.") joins the paragraph of the strong rows next to it; the paragraph is the heaviest cluster of rows, its lines
 *  the runs between quiet rows (pitch and alignment come from them). L: luma(), W x H. */
export function findText(L, W, H, box, { edge = 40 } = {}) {
  const [x0, y0, x1, y1] = px(box, W, H), w = x1 - x0, h = y1 - y0;
  if (w < 16 || h < 6) return null;
  const sharp = (o, x) => Math.abs(L[o + x + 1] - L[o + x]) > edge;
  const raw = new Float32Array(h);
  for (let y = 0; y < h; y++) { let n = 0; const o = (y0 + y) * W; for (let x = x0; x < x1 - 1; x++) if (sharp(o, x)) n++; raw[y] = n; }
  const rows = smooth(raw, 1), sorted = [...rows].sort((a, b) => a - b), p90 = sorted[Math.floor(0.9 * (h - 1))];
  if (p90 < Math.max(6, w * 0.02)) return null;      // no text here
  const hi = 0.3 * p90, lo = Math.max(2, 0.05 * p90);
  const seeds = runs(rows, hi).filter(([a, b]) => b - a >= 2);
  if (!seeds.length) return null;
  const tall = median(seeds.map(([a, b]) => b - a)), gap = Math.max(3, 1.7 * tall);   // a weak line ("it.") between two strong ones is mostly quiet rows
  const parts = runs(rows, lo).filter(([a, b]) => seeds.some(([s, e]) => s < b + gap && e > a - gap));     // near a strong run
  const clusters = [];
  for (const r of parts) { const c = clusters[clusters.length - 1]; if (c && r[0] - c[c.length - 1][1] <= gap) c.push(r); else clusters.push([r]); }
  const mass = c => c.reduce((s, [a, b]) => { for (let y = a; y < b; y++) s += rows[y]; return s; }, 0);
  const para = clusters.reduce((best, c) => (mass(c) > mass(best) ? c : best));
  const py0 = para[0][0], py1 = para[para.length - 1][1];
  // lines: rows above 30% of the paragraph's median row; their pitch gives the size (a dropped short line doubles one gap only)
  const inPara = [...rows.subarray(py0, py1)].sort((a, b) => a - b), floor = 0.3 * inPara[inPara.length >> 1];
  let lines = runs(rows.subarray(py0, py1), Math.max(lo, floor)).map(([a, b]) => [a + py0, b + py0]);
  const maxH = Math.max(1, ...lines.map(([a, b]) => b - a));
  lines = lines.filter(([a, b]) => b - a >= maxH / 3);
  if (!lines.length) lines = [[py0, py1]];
  const extent = (a, b, lh = b - a) => {              // columns with edges, word spaces bridged (lh: a line's height): [x0, x1] or null
    const cols = new Float32Array(w);
    for (let y = a; y < b; y++) { const o = (y0 + y) * W; for (let x = x0; x < x1 - 1; x++) if (sharp(o, x)) cols[x - x0]++; }
    const on = runs(smooth(cols, Math.max(2, Math.round(lh * 0.5))), Math.max(0.4, lh * 0.03));
    if (!on.length) return null;
    const big = on.reduce((m, r) => (r[1] - r[0] > m[1] - m[0] ? r : m)), reach = lh * 2.5;
    let s = big[0], e = big[1];
    for (let moved = true; moved;) {               // runs within a few letters of the line join it
      moved = false;
      for (const r of on) {
        if (r[0] < s && s - r[1] < reach) { s = r[0]; moved = true; }
        if (r[1] > e && r[0] - e < reach) { e = r[1]; moved = true; }
      }
    }
    while (s < e - 1 && !cols[s]) s++;                // the smoothing's spill: back to the first and last sharp column
    while (e > s + 1 && !cols[e - 1]) e--;
    return [x0 + s, x0 + e];
  };
  const spans = lines.map(([a, b]) => { const x = extent(a, b); return x && [x[0], y0 + a, x[1], y0 + b]; }).filter(Boolean);
  const all = extent(py0, py1, median(lines.map(([a, b]) => b - a)));
  if (!spans.length || !all) return null;
  const bx = [Math.min(all[0], ...spans.map(s => s[0])), y0 + py0, Math.max(all[1], ...spans.map(s => s[2])), y0 + py1];
  const centres = spans.map(s => (s[1] + s[3]) / 2), heights = spans.map(s => s[3] - s[1]);
  const pitches = centres.slice(1).map((c, i) => c - centres[i]), pitch = pitches.length ? Math.min(...pitches.filter(p => p >= 0.7 * median(pitches))) : 0;
  const size = clamp(Math.min(pitch ? pitch / LINE : Infinity, median(heights) / (pitch ? 0.85 : 1.05)), 4, h);   // a line's run is about an em with its outline
  return { box: bx, lines: spans, size, align: alignOf(spans, x0, x1) };
}
/** "left" when the lines share a left edge more than a centre, else "center" (one line: centred in [x0, x1] or not). */
export function alignOf(spans, x0, x1) {
  const spread = f => { const v = spans.map(f); return Math.max(...v) - Math.min(...v); };
  const w = x1 - x0, mid = s => (s[0] + s[2]) / 2;
  if (spans.length === 1) return Math.abs(mid(spans[0]) - (x0 + x1) / 2) < 0.08 * w ? "center" : "left";
  return spread(s => s[0]) < Math.min(0.6 * spread(mid), 0.03 * w) ? "left" : "center";
}

/** Erase the text in box (px) of RGBA data, in place: pixels near a sharp edge (glyphs and their outline, `reach` px)
 *  take the colour of the background around them (the unmasked pixels' mean per cell, cells without any filled from
 *  their neighbours, blended across cells). Returns the colours read on the way: {bg, fill, stroke | null} as [r, g, b]. */
export function erase(data, W, H, box, { reach = 3, cell = 10, edge = 40 } = {}) {
  const [x0, y0, x1, y1] = px(box, W, H), w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) return null;
  const L = luma(data), mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y0 + y) * W + x0 + x;
    const dx = x0 + x + 1 < W ? Math.abs(L[i + 1] - L[i]) : 0, dy = y0 + y + 1 < H ? Math.abs(L[i + W] - L[i]) : 0;
    if (dx > edge || dy > edge) mask[y * w + x] = 1;
  }
  dilate(mask, w, h, reach);
  const cw = Math.max(2, Math.round(cell)), gx = Math.ceil(w / cw), gy = Math.ceil(h / cw);
  const sum = new Float64Array(gx * gy * 3), cnt = new Float64Array(gx * gy);
  const masked = [];                                  // [lum, r, g, b] of the text's pixels: its colours
  let bgSum = [0, 0, 0], bgN = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * W + x0 + x) * 4;
    if (mask[y * w + x]) { if ((x + y) % 3 === 0) masked.push([L[i >> 2], data[i], data[i + 1], data[i + 2]]); continue; }
    const c = Math.floor(y / cw) * gx + Math.floor(x / cw);
    sum[c * 3] += data[i]; sum[c * 3 + 1] += data[i + 1]; sum[c * 3 + 2] += data[i + 2]; cnt[c]++;
    bgSum[0] += data[i]; bgSum[1] += data[i + 1]; bgSum[2] += data[i + 2]; bgN++;
  }
  const grid = new Float64Array(gx * gy * 3), have = new Uint8Array(gx * gy);
  for (let c = 0; c < gx * gy; c++) if (cnt[c] >= 3) { for (let k = 0; k < 3; k++) grid[c * 3 + k] = sum[c * 3 + k] / cnt[c]; have[c] = 1; }
  const bg = bgN ? bgSum.map(v => v / bgN) : [0, 0, 0];
  if (!have.some(Boolean)) for (let c = 0; c < gx * gy; c++) { grid.set(bg, c * 3); have[c] = 1; }
  for (let pass = 0; pass < gx + gy && have.some(v => !v); pass++) {     // cells all text: their neighbours' colour
    const next = Uint8Array.from(have);
    for (let cy = 0; cy < gy; cy++) for (let cx = 0; cx < gx; cx++) {
      const c = cy * gx + cx; if (have[c]) continue;
      let n = 0; const acc = [0, 0, 0];
      for (const [ax, ay] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        if (ax < 0 || ay < 0 || ax >= gx || ay >= gy || !have[ay * gx + ax]) continue;
        for (let k = 0; k < 3; k++) acc[k] += grid[(ay * gx + ax) * 3 + k]; n++;
      }
      if (n) { for (let k = 0; k < 3; k++) grid[c * 3 + k] = acc[k] / n; next[c] = 1; }
    }
    have.set(next);
  }
  const at = (cx, cy, k) => grid[(clamp(cy, 0, gy - 1) * gx + clamp(cx, 0, gx - 1)) * 3 + k];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const fx = (x + 0.5) / cw - 0.5, fy = (y + 0.5) / cw - 0.5, cx = Math.floor(fx), cy = Math.floor(fy), tx = fx - cx, ty = fy - cy;
    const i = ((y0 + y) * W + x0 + x) * 4;
    for (let k = 0; k < 3; k++) {
      data[i + k] = (at(cx, cy, k) * (1 - tx) + at(cx + 1, cy, k) * tx) * (1 - ty) + (at(cx, cy + 1, k) * (1 - tx) + at(cx + 1, cy + 1, k) * tx) * ty;
    }
  }
  return { bg: bg.map(Math.round), ...textColours(masked, bg) };
}
function dilate(mask, w, h, r) {                     // square dilation, separable
  if (r < 1) return;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (mask[y * w + x]) last = x; if (x - last <= r) tmp[y * w + x] = 1; }
    last = 1e9; for (let x = w - 1; x >= 0; x--) { if (mask[y * w + x]) last = x; if (last - x <= r) tmp[y * w + x] = 1; } }
  mask.fill(0);
  for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; if (y - last <= r) mask[y * w + x] = 1; }
    last = 1e9; for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) mask[y * w + x] = 1; } }
}
/** The text's fill and outline from its pixels [lum, r, g, b]: on a dark background the brightest ones fill and the
 *  darkest outline (when darker than the background), on a light one the other way round. */
export function textColours(masked, bg) {
  if (masked.length < 8) return { fill: null, stroke: null };
  const bgL = (bg[0] * 77 + bg[1] * 150 + bg[2] * 29) >> 8, s = [...masked].sort((a, b) => a[0] - b[0]), n = Math.max(1, Math.round(s.length * 0.12));
  const avg = part => [1, 2, 3].map(k => Math.round(part.reduce((t, p) => t + p[k], 0) / part.length));
  const lum = part => part.reduce((t, p) => t + p[0], 0) / part.length;
  const dark = s.slice(0, n), light = s.slice(-n);
  return bgL < 140 ? { fill: avg(light), stroke: lum(dark) < bgL - 25 ? avg(dark) : null }
    : { fill: avg(dark), stroke: lum(light) > bgL + 25 ? avg(light) : null };
}

/** Ability text as paragraphs of chunks (no break inside a chunk), each piece {text} or {icon, no} (an icon token the
 *  site has, "[fire]", "[fire:no]"; another bracket stays text). */
export function tokenize(text, icons = {}) {
  return String(text ?? "").replace(/\r/g, "").split("\n").map(line => line.split(/[ \t]+/).filter(Boolean).map(chunk => {
    const out = []; let at = 0;
    for (const m of chunk.matchAll(/\[([^\[\]\n]{1,52})\]/g)) {
      const [base, variant = ""] = m[1].split(":"), ic = icons[norm(base)];
      if (!ic) continue;
      if (m.index > at) out.push({ text: chunk.slice(at, m.index) });
      out.push({ icon: ic.file, name: base, no: variant.trim().toLowerCase() === "no" });
      at = m.index + m[0].length;
    }
    if (at < chunk.length) out.push({ text: chunk.slice(at) });
    return out;
  }));
}
const ICON_EM = 1.1;                                  // an icon's width in ems
/** Lines of paragraphs at font size `size` within maxW: [{pieces: [{text | icon, w}], w}] (a space between chunks);
 *  measure(text, size) -> px. An empty paragraph is an empty line. */
export function layout(paras, maxW, size, measure) {
  const space = measure(" ", size), lines = [];
  for (const para of paras) {
    let line = { pieces: [], w: 0 };
    if (!para.length) { lines.push(line); continue; }
    for (const chunk of para) {
      const pieces = chunk.map(p => ({ ...p, w: p.icon ? ICON_EM * size : measure(p.text, size) })), w = pieces.reduce((t, p) => t + p.w, 0);
      if (line.pieces.length && line.w + space + w > maxW) { lines.push(line); line = { pieces: [], w: 0 }; }
      if (line.pieces.length) { line.pieces.push({ text: " ", w: space }); line.w += space; }
      line.pieces.push(...pieces); line.w += w;
    }
    lines.push(line);
  }
  return lines;
}
/** The largest size up to `size` (down to min x size) whose lines fit maxW x maxH: {size, lines}. */
export function fit(paras, maxW, maxH, size, measure, { min = 0.45, lines: most = Infinity } = {}) {
  let s = size, lines = layout(paras, maxW, s, measure);
  const fits = () => lines.length <= most && lines.length * s * LINE <= maxH + 0.5 && lines.every(l => l.w <= maxW + 0.5);
  while (!fits() && s > size * min) { s *= 0.94; lines = layout(paras, maxW, s, measure); }
  return { size: s, lines };
}

/** The stat rows a template draws, in px: [{k, box, cells: 10}] for the stats a card has (hp, def, atk, spd in order);
 *  none for a shape without bars or stats the details call anything but "template". */
export function barRows(shape, W, H, card, rec) {
  const t = TEMPLATES[shape]?.bars;
  if (!t) return [];
  const st = rec && typeof rec.stats === "object" ? rec.stats : null;
  const keys = STATS.filter(k => card[k] != null || (st && st[k] === "template"));
  if (st && keys.some(k => st[k] !== "template")) return [];
  return keys.map((k, i) => ({ k, box: [t.box[0] * W, (t.box[1] + i * t.step) * H, t.box[2] * W, (t.box[3] + i * t.step) * H], cells: 10 }));
}
/** Does row (px) look like a 10-cell bar? The cell borders are sharper than the cells' insides. */
export function isBar(L, W, H, box, cells = 10) {
  const [x0, y0, x1, y1] = px(box, W, H), cw = (x1 - x0) / cells, y = Math.round((y0 + y1) / 2);
  if (cw < 3 || y <= 0 || y >= H) return false;
  const at = x => { let s = 0; for (let k = -1; k <= 1; k++) s += L[clamp(y + k, 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)]; return s / 3; };
  const jump = x => Math.max(Math.abs(at(x + 1) - at(x - 1)), Math.abs(at(x + 2) - at(x - 2)));
  let border = 0, inside = 0;
  for (let j = 1; j < cells; j++) { border += Math.max(jump(x0 + j * cw - 1), jump(x0 + j * cw), jump(x0 + j * cw + 1)); inside += jump(x0 + (j - 0.5) * cw); }
  return border / (cells - 1) > 12 && border > 2 * inside;
}
/** What redraws stat row cells from `from` to `to` (0-10): [{cell, as: cell index to copy | "lit" | "dark"}]. A cell
 *  lights as the last lit one (the first when that is the bar's rounded end: "lit", its colour) and darkens as the first
 *  dark one ("dark", a shade, when none or the rounded end). */
export function cellPlan(from, to, cells = 10) {
  const out = [];
  for (let c = Math.min(from, to); c < Math.max(from, to); c++) {
    if (to > from) out.push({ cell: c, as: from - 1 >= 1 ? from - 1 : "lit" });
    else out.push({ cell: c, as: from < cells - 1 ? from : "dark" });
  }
  return out;
}

/** The fields the mock-up redraws: those of `edit` that differ from the image's (`psd`), as {name, ability, stats: {k: [from,
 *  to]}, skipped: [labels]} (stars, types and stats above 10 aren't drawn). */
export function changes(edit, psd) {
  const out = { name: null, ability: null, stats: {}, skipped: [] };
  const text = s => String(s ?? "").replace(/\r/g, "").trim();
  if ("name" in edit && text(edit.name) !== text(psd.name)) out.name = text(edit.name);
  if ("ability" in edit && text(edit.ability) !== text(psd.ability)) out.ability = text(edit.ability);
  for (const k of STATS) if (k in edit && edit[k] !== psd[k]) {
    if (edit[k] == null || psd[k] == null || edit[k] > 10 || psd[k] > 10) out.skipped.push(k.toUpperCase());
    else out.stats[k] = [psd[k], edit[k]];
  }
  if ("stars" in edit && edit.stars !== psd.stars) out.skipped.push("stars");
  if ("types" in edit && JSON.stringify([...(edit.types || [])].sort()) !== JSON.stringify([...(psd.types || [])].sort())) out.skipped.push("types");
  return out;
}
/** The record's box (image px) for a text layer: text[].box ([x0, y0, x1, y1] in canvas px) scaled to the image. */
export function recordBox(rec, layer, W) {
  const t = Array.isArray(rec?.text) ? rec.text.find(x => x && x.layer === layer) : null, cw = rec?.canvas?.w;
  return t && Array.isArray(t.box) && t.box.length === 4 && t.box.every(Number.isFinite) && cw > 0 ? t.box.map(v => (v * W) / cw) : null;
}
/** The details record's text layer for a role ("name" | "ability"): {layer, font, size, color} or null. */
export function layerOf(rec, role) {
  const tpl = rec?.template && typeof rec.template === "object" ? rec.template : {};
  const want = role === "name" ? [tpl.name_layer] : Array.isArray(tpl.ability_layers) ? tpl.ability_layers : [];
  const list = Array.isArray(rec?.text) ? rec.text.filter(t => t && typeof t === "object") : [];
  return list.find(t => want.includes(t.layer)) || list.find(t => (role === "name" ? /(^|\/)name$/i : /(^|\/)ability$/i).test(String(t.layer || ""))) || null;
}
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const hexRgb = h => (/^#[0-9a-f]{6}$/i.test(h || "") ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null);

// ---- drawing (canvas; the browser)
const fontFaces = new Map();                          // font name -> Promise<family | "">
let fontsP = null;                                    // data/fonts.json
/** The family to draw a PSD font in: a FontFace from MDW/Fonts when data/fonts.json maps it (loaded once), else "". */
export function loadFont(name, { getFonts, raw }) {
  if (!name || typeof FontFace === "undefined") return Promise.resolve("");
  if (!fontFaces.has(name)) {
    fontsP ||= getFonts().then(d => (d && typeof d.fonts === "object" ? d.fonts : {}), () => ({}));
    fontFaces.set(name, fontsP.then(async map => {
      const f = map[name];
      if (!f || typeof f.file !== "string") return "";
      const family = `mk-${norm(name).slice(0, 40) || "font"}`;
      const face = new FontFace(family, `url("${raw}${f.file.split("/").map(encodeURIComponent).join("/")}")`);
      await face.load(); document.fonts.add(face);
      return family;
    }).catch(() => ""));
  }
  return fontFaces.get(name);
}
const images = new Map();
function loadImage(src) {
  if (!images.has(src)) images.set(src, new Promise((ok, no) => { const i = new Image(); i.decoding = "async"; i.onload = () => ok(i); i.onerror = no; i.src = src; }).catch(() => null));
  return images.get(src);
}
const STAND_IN = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Draw the mock-up into canvas: the card image (src, same origin) with `edit`'s PSD fields over it. opts: {card, src, rec
 *  (details record or null), edit, psd (the image's values), icons, getFonts, raw, onFont (a font has loaded: draw
 *  again), stale (a newer draw started: drop this one)}. Drawn off-screen, then copied. Returns {drawn: [labels], skipped,
 *  fonts: {name: family | ""}, shape} or null (the image didn't load, or stale). */
export async function draw(canvas, { card, src, rec, edit, psd, icons, getFonts, raw, onFont, stale = () => false }) {
  const img = await loadImage(src);
  if (!img || stale()) return null;
  const W = img.naturalWidth, H = img.naturalHeight, shape = shapeOf(W, H), tpl = TEMPLATES[shape];
  const work = document.createElement("canvas"); work.width = W; work.height = H;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const todo = changes(edit, psd), out = { drawn: [], skipped: [...todo.skipped], fonts: {}, shape };
  const blit = () => { if (stale()) return null; canvas.width = W; canvas.height = H; canvas.getContext("2d").drawImage(work, 0, 0); return out; };
  if (!tpl) { out.skipped.push(...[todo.name != null && "name", todo.ability != null && "text", ...Object.keys(todo.stats).map(k => k.toUpperCase())].filter(Boolean)); return blit(); }
  const pixels = ctx.getImageData(0, 0, W, H), L = luma(pixels.data);
  const family = async role => {
    const layer = layerOf(rec, role), name = layer?.font || "";
    const pending = name ? loadFont(name, { getFonts, raw }) : Promise.resolve("");
    let fam = "";
    const ready = await Promise.race([pending, new Promise(r => setTimeout(() => r(null), 60))]);   // a loaded font draws at once
    if (ready === null) pending.then(f => { if (f) onFont?.(); }); else fam = ready;
    if (name) out.fonts[name] = fam;
    return { fam: fam ? `"${fam}", ${STAND_IN}` : STAND_IN, layer };
  };
  const scaled = b => b.map((v, i) => v * (i % 2 ? H : W));
  const regions = [];
  if (todo.name != null) regions.push(["name", todo.name, recordBox(rec, layerOf(rec, "name")?.layer, W) || scaled(tpl.name)]);
  if (todo.ability != null) regions.push(["ability", todo.ability, recordBox(rec, layerOf(rec, "ability")?.layer, W) || scaled(tpl.ability)]);
  const jobs = [];
  for (const [role, text, region] of regions) {
    const found = findText(L, W, H, region), rh = region[3] - region[1];
    const cap = role === "name" ? (rh * 0.62) / Math.max(1, found?.lines.length || 1) : W * (shape === "square" ? 0.11 : 0.065);
    const size = Math.min(cap, found?.size || cap * 0.8);
    const cover = found ? [found.box[0] - size * 0.3, found.box[1] - size * 0.3, found.box[2] + size * 0.3, found.box[3] + size * 0.3] : region;
    const colours = erase(pixels.data, W, H, cover, { reach: Math.max(2, Math.round(size * 0.14)), cell: Math.max(6, size * 0.8) });
    jobs.push({ role, text, region, found, size, colours });
  }
  const rows = barRows(shape, W, H, card, rec);
  for (const [k, [from, to]] of Object.entries(todo.stats)) {
    const row = rows.find(r => r.k === k);
    if (!row || !isBar(L, W, H, row.box)) { out.skipped.push(k.toUpperCase()); continue; }
    paintCells(pixels.data, W, H, row, from, to); out.drawn.push(k.toUpperCase());
  }
  ctx.putImageData(pixels, 0, 0);
  for (const job of jobs) {
    const { fam, layer } = await family(job.role);
    drawText(ctx, job, fam, layer, icons, await iconImages(job.text, icons));
    out.drawn.push(job.role === "name" ? "name" : "text");
  }
  return blit();
}
async function iconImages(text, icons) {
  const files = new Set(tokenize(text, icons).flat(2).filter(p => p.icon).map(p => p.icon)), out = new Map();
  for (const f of files) out.set(f, await loadImage(f));
  return out;
}
function drawText(ctx, { role, text, region, found, size, colours }, fam, layer, icons, imgs) {
  const paras = tokenize(text, icons);
  const measure = (s, z) => { ctx.font = `${z}px ${fam}`; return ctx.measureText(s).width; };
  const left = found ? Math.min(found.box[0], region[0] + (region[2] - region[0]) * 0.02) : region[0] + (region[2] - region[0]) * 0.02;
  const maxW = role === "name" ? Math.max(found ? found.box[2] - found.box[0] : 0, (region[2] - region[0]) * 0.96) : (region[2] - region[0]) * 0.96;
  const maxH = region[3] - region[1];
  const { size: z, lines } = fit(paras, maxW, maxH, size, measure, role === "name" ? { lines: Math.max(1, found?.lines.length || 1), min: 0.3 } : {});
  const align = found?.align || "center", blockH = lines.length * z * LINE;
  const mid = found ? (found.box[1] + found.box[3]) / 2 : (region[1] + region[3]) / 2;
  const top = clamp(mid - blockH / 2, region[1], Math.max(region[1], region[3] - blockH));
  const centre = found && align === "center" ? (found.box[0] + found.box[2]) / 2 : (region[0] + region[2]) / 2;
  const fill = colours?.fill || hexRgb(layer?.color) || [255, 255, 255];
  const stroke = colours?.stroke;
  ctx.textBaseline = "alphabetic";
  lines.forEach((line, n) => {
    let x = align === "left" ? left : clamp(centre - line.w / 2, region[0], Math.max(region[0], region[2] - line.w));
    const base = top + n * z * LINE + z * 0.92;
    for (const p of line.pieces) {
      if (p.icon) {
        const im = imgs.get(p.icon), s = z * 1.05;
        if (im) ctx.drawImage(im, x + (p.w - s) / 2, base - s * 0.82, s, s);
        if (p.no) { ctx.save(); ctx.strokeStyle = "#e11"; ctx.lineWidth = Math.max(2, z * 0.12); ctx.beginPath(); ctx.moveTo(x + p.w * 0.1, base - s * 0.75); ctx.lineTo(x + p.w * 0.9, base + s * 0.1); ctx.stroke(); ctx.restore(); }
      } else if (p.text.trim()) {
        ctx.font = `${z}px ${fam}`;
        if (stroke) { ctx.lineJoin = "round"; ctx.strokeStyle = rgb(stroke); ctx.lineWidth = Math.max(1.5, z * 0.16); ctx.strokeText(p.text, x, base); }
        ctx.fillStyle = rgb(fill); ctx.fillText(p.text, x, base);
      }
      x += p.w;
    }
  });
}
function paintCells(data, W, H, row, from, to) {
  const [x0, y0, x1, y1] = px(row.box, W, H), cw = (x1 - x0) / row.cells;
  const cellBox = c => [Math.round(x0 + c * cw), Math.round(x0 + (c + 1) * cw)];
  const src = new Uint8ClampedArray(data);           // copies read the image before any cell changed
  const centre = c => { const [a, b] = cellBox(c), i = ((Math.round((y0 + y1) / 2)) * W + Math.round((a + b) / 2)) * 4; return [src[i], src[i + 1], src[i + 2]]; };
  for (const { cell, as } of cellPlan(from, to, row.cells)) {
    const [a, b] = cellBox(cell), lit = as === "lit" ? centre(0) : null;
    for (let y = y0 + 1; y < y1 - 1; y++) for (let x = a + 1; x < b - 1; x++) {
      const i = (y * W + x) * 4;
      if (typeof as === "number") { const [sa] = cellBox(as), j = (y * W + sa + (x - a)) * 4; data[i] = src[j]; data[i + 1] = src[j + 1]; data[i + 2] = src[j + 2]; }
      else if (lit) { data[i] = lit[0]; data[i + 1] = lit[1]; data[i + 2] = lit[2]; }
      else { data[i] = src[i] * 0.38; data[i + 1] = src[i + 1] * 0.38; data[i + 2] = src[i + 2] * 0.38; }
    }
  }
}
