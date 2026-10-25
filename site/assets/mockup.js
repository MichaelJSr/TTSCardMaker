// The quick image mock-up: the edited name, text, stats, stars and type icons drawn over the card image in a canvas, at
// once, in the browser (the Edit dialog and the card page, edit mode). Never the real image: the bake draws that (preview.js).
// Stars and type icons go where the bake would put them (the details record's header: starPlan, typePlan), else in a box.
// Layout: the PSD's text boxes when the details record has them (text[].box, canvas px), else the card template's
// (TEMPLATES, measured on the PSDs, below the stat bars) narrowed to where the image shows text: the block of lines
// (textBlocks) whose size and line count fit the old text (calibrate). That block is erased with the card's own
// background (erase) and the new text drawn there in the card's font (data/fonts.json -> MDW/Fonts as a web font), icon
// tokens as icons and timing tags as badges. When no block fits the old text (text over art, a stylised title), the new
// text goes in a dark box over the template's area instead ("box"), never over a half-erased old one. Everything above
// `draw` is pure (node checks run it on plain pixel arrays).
import { norm, splitToken, tagInfo, TAG, variantFile } from "./text.js";

export const LABEL = "Mock-up: the real image comes from the bake";
export const BADGE = { turn: "#2563eb", any: "#7c3aed", forced: "#dc2626", trigger: "#d97706", neutral: "#475569" };   // style.css --b-*, as the font's badges
const STATS = ["hp", "def", "atk", "spd"];
export const LINE = 1.22;                            // line pitch in ems (findText reads a size back from it)
// fractions of the image [x0, y0, x1, y1]: where a template prints the name and the text; its stat bars (one row per stat,
// `step` apart, 10 cells across `box`). Measured on the PSDs' layer boxes (2026-10-23): tall = 1200x2400 creatures and
// minions (311 of 390 with stat rows sit exactly here), item = 1200x1800 items and field cards (the totems' two rows),
// square = 1200x1200 status effects. stars, types: the header's star and type icon areas for the box fallback (the median
// union of psd_details' header boxes over 764 card PSDs, 2026-10-24: 660 with stars, 687 with type icons).
export const TEMPLATES = {
  tall: { name: [0.2, 0, 0.8, 0.1], ability: [0.012, 0.722, 0.988, 0.995], bars: { box: [0.3, 0.5, 0.978, 0.535], step: 0.0525 },
    stars: [0.785, 0.007, 0.99, 0.1], types: [0.017, 0.01, 0.179, 0.086] },
  item: { name: [0.2, 0, 0.8, 0.165], ability: [0.012, 0.6, 0.988, 0.995], bars: { box: [0.308, 0.624, 0.986, 0.671], step: 0.053 },
    stars: [0.811, 0.013, 0.984, 0.112], types: [0.023, 0.013, 0.162, 0.114] },
  square: { name: [0.17, 0, 0.83, 0.15], ability: [0.012, 0.68, 0.988, 0.995], stars: [0.78, 0.013, 0.993, 0.21], types: [0.01, 0.013, 0.154, 0.156] },
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

/** Where the image shows text inside box (px): {box, lines: [[x0, y0, x1, y1]], size (font px), pitch, align: "center" |
 *  "left", mass}, or null. Text is where many sharp edges are (glyphs with their outline). Rows: hysteresis, so a short
 *  last line ("it.") joins the paragraph of the strong rows next to it; clusters of rows are paragraphs. findText: the
 *  heaviest paragraph; textBlocks: every run of up to 12 neighbouring paragraphs that reaches into the seed rows ([y0, y1]
 *  px), the heaviest first, for calibrate to pick the one that holds the old text (a blank line between paragraphs, a last
 *  paragraph in another colour, art above or below). Lines are the runs between quiet rows (pitch, size and alignment come
 *  from them). L: luma(), W x H. */
export function textBlocks(L, W, H, box, { edge = 40, seed = null, most = Infinity, span = 12, strong = span > 1 ? 0.18 : 0.3, join = 4 } = {}) {
  const [x0, y0, x1, y1] = px(box, W, H), w = x1 - x0, h = y1 - y0;
  if (w < 16 || h < 6) return [];
  const sharp = (o, x) => Math.abs(L[o + x + 1] - L[o + x]) > edge;
  const raw = new Float32Array(h);
  for (let y = 0; y < h; y++) { let n = 0; const o = (y0 + y) * W; for (let x = x0; x < x1 - 1; x++) if (sharp(o, x)) n++; raw[y] = n; }
  const rows = smooth(raw, 1), sorted = [...rows].sort((a, b) => a - b), p90 = sorted[Math.floor((span > 1 ? 0.97 : 0.9) * (h - 1))];   // one short line is a few rows of many
  if (p90 < Math.max(6, w * 0.02)) return [];         // no text here
  const hi = strong * p90, lo = Math.max(2, 0.05 * p90);   // strong: a short line ("+1 SPD.") seeds a block too
  const seeds = runs(rows, hi).filter(([a, b]) => b - a >= 2);
  if (!seeds.length) return [];
  const tall = median(seeds.map(([a, b]) => b - a)), gap = Math.max(3, 1.7 * tall);   // a weak line ("it.") between two strong ones is mostly quiet rows
  const parts = runs(rows, lo).filter(([a, b]) => seeds.some(([s, e]) => s < b + gap && e > a - gap));     // near a strong run
  const clusters = [];
  for (const r of parts) { const c = clusters[clusters.length - 1]; if (c && r[0] - c[c.length - 1][1] <= gap) c.push(r); else clusters.push([r]); }
  const extent = (a, b, lh = b - a) => {              // columns with edges, word spaces bridged (lh: a line's height): [x0, x1] or null
    const cols = new Float32Array(w);
    for (let y = a; y < b; y++) { const o = (y0 + y) * W; for (let x = x0; x < x1 - 1; x++) if (sharp(o, x)) cols[x - x0]++; }
    const on = runs(smooth(cols, Math.max(2, Math.round(lh * 0.5))), Math.max(0.4, lh * 0.03));
    if (!on.length) return null;
    const big = on.reduce((m, r) => (r[1] - r[0] > m[1] - m[0] ? r : m)), reach = lh * join;
    let s = big[0], e = big[1];
    for (let moved = true; moved;) {               // runs within a few letters of the line join it (a soft icon, dim words between)
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
  // each paragraph's lines: rows above 30% of its median row (a short line kept, its outline's rows not)
  const paras = clusters.map(c => {
    const py0 = c[0][0], py1 = c[c.length - 1][1], m = c.reduce((t, [a, b]) => { for (let y = a; y < b; y++) t += rows[y]; return t; }, 0);
    const inPara = [...rows.subarray(py0, py1)].sort((a, b) => a - b), floor = 0.3 * inPara[inPara.length >> 1];
    let lines = runs(rows.subarray(py0, py1), Math.max(lo, floor)).map(([a, b]) => [a + py0, b + py0]);
    const maxH = Math.max(1, ...lines.map(([a, b]) => b - a));
    lines = lines.filter(([a, b]) => b - a >= maxH / 3);
    if (!lines.length) lines = [[py0, py1]];
    const spans = lines.map(([a, b]) => { const x = extent(a, b); return x && [x[0], y0 + a, x[1], y0 + b]; }).filter(s => s && s[2] - s[0] >= 1.2 * (s[3] - s[1]));   // narrower than it is tall: a mark, not a line
    return { py0: y0 + py0, py1: y0 + py1, spans, mass: m };
  });
  const block = list => {                             // paragraphs i..j as one block
    const spans = list.flatMap(p => p.spans);
    if (!spans.length) return null;
    const bx = [Math.min(...spans.map(s => s[0])), list[0].py0, Math.max(...spans.map(s => s[2])), list[list.length - 1].py1];
    const centres = spans.map(s => (s[1] + s[3]) / 2), heights = spans.map(s => s[3] - s[1]);
    const pitches = centres.slice(1).map((c, i) => c - centres[i]), pitch = pitches.length ? Math.min(...pitches.filter(p => p >= 0.7 * median(pitches))) : 0;
    const size = clamp(Math.min(pitch ? pitch / LINE : Infinity, median(heights) / (pitch ? 0.85 : 1.05)), 4, h);   // a line's run is about an em with its outline
    return { box: bx, lines: spans, size, pitch, align: alignOf(spans, x0, x1), mass: list.reduce((t, p) => t + p.mass, 0) };
  };
  const out = [];
  for (let i = 0; i < paras.length; i++) for (let j = i; j < Math.min(paras.length, i + span); j++) {
    if (seed && !(paras[j].py1 > seed[0] && paras[i].py0 < seed[1])) continue;
    const b = block(paras.slice(i, j + 1));
    if (b) out.push(b);
  }
  return out.sort((a, b) => b.mass - a.mass).slice(0, most);
}
/** The heaviest single paragraph of textBlocks, or null. */
export const findText = (L, W, H, box, opts = {}) => textBlocks(L, W, H, box, { ...opts, span: 1, most: 1 })[0] || null;
/** How well a found block holds the old text (paras: tokenize(old)): measured at the block's size the old text is k times
 *  as wide as the block's lines together, and wrapped at the block's width it makes nPred lines (against the block's).
 *  size: the block's size scaled by k (the old text at it fills the block as the old one did). ok: k within 0.62-1.6 and
 *  the line counts within one (or 30%); one line: k within 0.6-3 (its size from its width), its run at least 0.3 em
 *  high, and the old text in one or two lines. exact (a name): as many lines as found, one line at most twice as wide.
 *  measure(text, size) -> px. */
export function calibrate(found, paras, measure, { exact = false } = {}) {
  const s0 = found.size, inked = found.lines.reduce((t, l) => t + (l[2] - l[0]), 0);
  const oneLine = layout(paras, Infinity, s0, measure).reduce((t, l) => t + l.w, 0);
  if (!oneLine || !inked) return { ok: false, k: 0, size: s0, nPred: 0, nFound: found.lines.length };
  const k = inked / oneLine, nFound = found.lines.length;
  if (nFound === 1) {                                 // one line: no pitch, and its run of rows can be well under an em (thin letters): the width decides
    const size = s0 * clamp(k, 0.6, 3), inkH = found.lines[0][3] - found.lines[0][1];
    const nPred = layout(paras, (found.box[2] - found.box[0]) * 1.04, size, measure).filter(l => l.pieces.length).length;
    return { ok: (exact ? nPred === 1 && k <= 2 : nPred <= 2) && k >= 0.6 && k <= 3 && inkH >= 0.3 * size && inkH <= 1.4 * size, k, size, nPred, nFound };
  }
  const size = s0 * clamp(k, 0.75, 1.33);
  const nPred = layout(paras, (found.box[2] - found.box[0]) * 1.04, size, measure).filter(l => l.pieces.length).length;
  const fits = k > 0.62 && k < 1.6 && (exact ? nPred === nFound : Math.abs(nPred - nFound) <= Math.max(1, Math.round(nFound * 0.3)));
  return { ok: fits && lineLike(found), k, size, nPred, nFound };
}
/** Of every block textBlocks finds in area ({box, seed}) at two edge strengths (soft art merges with text at the lower)
 *  and two seed strengths (short lines seed blocks at the lower, art merges in),
 *  the one calibrate says holds the old text (paras), the most edge mass first: {b, cal, edge} or null. name: a card's
 *  name (one or two lines, the stars beside it kept apart: words join within 1.2 line heights, not 4). */
export function bestBlock(L, W, H, area, paras, measure, { edges = [40, 80, 130], name = false } = {}) {
  let best = null;
  for (const edge of edges) for (const strong of [0.3, 0.18]) for (const b of textBlocks(L, W, H, area.box, { seed: area.seed, edge, strong, join: name ? 1.2 : 4, span: name ? 2 : 12 })) {
    const cal = calibrate(b, paras, measure, { exact: name });
    if (!cal.ok) continue;
    const score = b.mass / (1 + 0.5 * Math.abs(cal.nPred - cal.nFound));   // the most text that fits it
    if (!best || score > best.score) best = { b, cal, edge, score };
  }
  return best;
}
/** Do a block's lines look like lines of one text: no line over twice the usual height or 2.6 times the lowest (art
 *  taken for a line), and
 *  centred lines share a centre, left ones a left edge (three in four, to a tenth, a twentieth of the block's width)? */
export function lineLike(found) {
  const L = found.lines; if (L.length < 2) return true;
  const hs = L.map(l => l[3] - l[1]), mh = median(hs), bw = Math.max(1, found.box[2] - found.box[0]);
  if (Math.max(...hs) > 2.2 * mh || Math.max(...hs) > 2.6 * Math.min(...hs)) return false;
  const near = (f, tol) => { const v = L.map(f), m = median(v); return v.filter(x => Math.abs(x - m) <= tol).length >= 0.75 * v.length; };   // a line cut short may stray
  return found.align === "left" ? near(l => l[0], 0.05 * bw) : near(l => (l[0] + l[2]) / 2, 0.1 * bw);
}
/** Lines of text just above or below a block that it left out (a header in another size or colour, a dim last line):
 *  rows within 1.6 line pitches of it, in its columns, with edges like its lines (at edge 25, dim words too; per em at least 0.3 as
 *  dense: a short header in big letters too), up to 2.4 line heights and 1.8 of its tallest, lined up with it, no wider
 *  than it nor across the card, and not a stat bar; at most four each way. top / bottom: rows not to pass (px). -> [[x0, y0, x1, y1]] */
export function strayLines(L, W, H, found, { top = 0, bottom = H, bars = [], edge = 25 } = {}) {
  const hs = found.lines.map(l => l[3] - l[1]), lh = median(hs), pitch = found.pitch || lh * 1.3, out = [];
  const bx0 = clamp(Math.round(found.box[0] - lh), 0, W - 1), bx1 = clamp(Math.round(found.box[2] + lh), 1, W);
  const count = y => { let n = 0; const o = y * W; for (let x = bx0; x < bx1 - 1; x++) if (Math.abs(L[o + x + 1] - L[o + x]) > edge) n++; return n; };
  const per = median(found.lines.map(l => { let t = 0; for (let y = Math.round(l[1]); y < Math.round(l[3]); y++) t += count(y); return t / Math.max(1, l[3] - l[1]); }));
  const dens = l => { let n = 0; for (let y = Math.round(l[1]); y < Math.round(l[3]); y++) for (let x = Math.round(l[0]); x < Math.round(l[2]) - 1; x++) if (Math.abs(L[y * W + x + 1] - L[y * W + x]) > edge) n++; return n / Math.max(1, (l[2] - l[0]) * (l[3] - l[1])); };
  const perEm = l => dens(l) * (l[3] - l[1]), textDens = median(found.lines.map(perEm));   // edges per em: alike for big and small letters; a stat bar's row is mostly smooth cells
  const mid = median(found.lines.map(l => (l[0] + l[2]) / 2)), bw = found.box[2] - found.box[0];
  for (const dir of [-1, 1]) {
    let edgeY = dir < 0 ? found.box[1] : found.box[3];
    for (let k = 0; k < 4; k++) {
      const a = Math.round(dir < 0 ? Math.max(top, edgeY - 1.6 * pitch) : edgeY), b = Math.round(dir < 0 ? edgeY : Math.min(bottom, edgeY + 1.6 * pitch));
      if (b - a < 3) break;
      const prof = []; for (let y = a; y < b; y++) prof.push(count(y));
      const runsOn = runs(smooth(Float32Array.from(prof), 1), 0.08 * per).map(([s, e]) => [a + s, a + e]).filter(([s, e]) => e - s >= 0.5 * lh && e - s <= 2.4 * lh);
      const r = dir < 0 ? runsOn[runsOn.length - 1] : runsOn[0];
      if (!r) break;
      const cols = []; for (let x = bx0; x < bx1 - 1; x++) { let n = 0; for (let y = r[0]; y < r[1]; y++) if (Math.abs(L[y * W + x + 1] - L[y * W + x]) > edge) n++; cols.push(n); }
      const on = runs(smooth(Float32Array.from(cols), Math.max(2, Math.round(lh * 0.5))), Math.max(0.4, lh * 0.03));
      if (!on.length) break;
      const mass = ([u, v]) => cols.slice(u, v).reduce((t, c) => t + c, 0);
      let [u, v] = on.reduce((m, q) => (mass(q) > mass(m) ? q : m));   // the line: its heaviest run and the runs a few letters from it
      for (let moved = true; moved;) { moved = false; for (const q of on) { if (q[0] < u && u - q[1] < 2 * lh) { u = q[0]; moved = true; } if (q[1] > v && q[0] - v < 2 * lh) { v = q[1]; moved = true; } } }
      const line = [bx0 + u, r[0], bx0 + v, r[1]];
      const lined = found.align === "left" ? Math.abs(line[0] - found.box[0]) <= 0.08 * bw : Math.abs((line[0] + line[2]) / 2 - mid) <= 0.15 * bw;
      if (!lined || line[2] - line[0] < 1.2 * (line[3] - line[1]) || line[2] - line[0] > 1.05 * bw || line[3] - line[1] > 1.8 * Math.max(...hs) || (line[0] <= 2 && line[2] >= W - 2) || perEm(line) < 0.3 * textDens || barLike(L, W, H, [0.25 * W, line[1] - 0.5 * lh, 0.98 * W, line[3] + 0.5 * lh]) || bars.some(q => q.box[1] < line[3] && q.box[3] > line[1] && isBar(L, W, H, q.box))) break;
      out.push(line); edgeY = dir < 0 ? line[1] : line[3];
    }
  }
  return out;
}
/** The lines to erase: a centred block's lines made even about its centre (a line read short on one side, past a dim
 *  word, still goes whole). */
export function eraseLines(found) {
  if (found.align === "left") return found.lines;
  const mid = median(found.lines.map(l => (l[0] + l[2]) / 2));
  return found.lines.map(l => { const half = Math.max(mid - l[0], l[2] - mid); return [mid - half, l[1], mid + half, l[3]]; });
}
/** The template's text area for an image W x H: {box, seed: [y0, y1]} (px), the search reaching a little above the
 *  template's top (text set higher), never into the stat bars (barsBottom: their last row's bottom, px, or 0). */
export function textArea(shape, W, H, barsBottom = 0) {
  const t = TEMPLATES[shape]; if (!t) return null;
  const [, b, , d] = t.ability, top = Math.max(barsBottom ? barsBottom + 0.012 * H : 0, (b - (shape === "tall" ? 0.06 : 0.04)) * H);
  return { box: [0, top, W, d * H], seed: [Math.max(top, b * H), d * H] };     // the full width: some text touches the card's sides
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
 *  their neighbours, blended across cells). lines ([[x0, y0, x1, y1]] px): only edges in them (grown by `reach`) count,
 *  and gaps up to `close` px between edges on a row are filled too (a badge's pill, the inside of thick letters).
 *  Returns the colours read on the way: {bg, fill, stroke | null} as [r, g, b]. */
export function erase(data, W, H, box, { reach = 3, cell = 10, edge = 40, lines = null, close = 0 } = {}) {
  const [x0, y0, x1, y1] = px(box, W, H), w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) return null;
  const L = luma(data), mask = new Uint8Array(w * h);
  const zones = lines && lines.map(l => { const lh = l[3] - l[1], sx = Math.max(reach, lh * 0.5), sy = Math.max(reach, lh * 0.25); return px([l[0] - sx, l[1] - sy, l[2] + sx, l[3] + sy], W, H); });
  const inZone = (x, y) => !zones || zones.some(z => x >= z[0] && x < z[2] && y >= z[1] && y < z[3]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y0 + y) * W + x0 + x;
    const dx = x0 + x + 1 < W ? Math.abs(L[i + 1] - L[i]) : 0, dy = y0 + y + 1 < H ? Math.abs(L[i + W] - L[i]) : 0;
    if ((dx > edge || dy > edge) && inZone(x0 + x, y0 + y)) mask[y * w + x] = 1;
  }
  if (close > 0) for (let y = 0; y < h; y++) {        // per row: short gaps between edges are inside the text (the image's edge counts as one)
    let last = x0 === 0 ? -1 : -1e9;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x - last > 1 && x - last <= close) mask.fill(1, y * w + last + 1, y * w + x); last = x; }
    if (x1 === W && last > -1e9 && w - last <= close && inZone(W - 1, y0 + y)) mask.fill(1, y * w + last + 1, y * w + w);
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

/** Ability text as paragraphs of chunks (no break inside a chunk), each piece {text}, {icon, no, sticker} (an icon token
 *  the site has, "[fire]", "[fire:no]", "[fire:sticker]" with its masks; another bracket or variant stays text) or {badge,
 *  group} (a timing tag, "(1CD)", as text.js reads it; another parenthesis stays text). */
export function tokenize(text, icons = {}) {
  const PIECE = new RegExp(`\\[([^\\[\\]\\n]{1,52})\\]|${TAG.source}`, "g");
  return String(text ?? "").replace(/\r/g, "").split("\n").map(line => line.split(/[ \t]+/).filter(Boolean).map(chunk => {
    const out = []; let at = 0;
    for (const m of chunk.matchAll(PIECE)) {
      let piece = null;
      if (m[1] != null) { const t = splitToken(m[1]), ic = t && icons[norm(t.base)]; if (ic) piece = { icon: ic.file, name: t.base, no: t.v === "no", sticker: t.v === "sticker" && ["tint", "sticker"].every(v => ic.v?.includes(v)) ? { tint: variantFile(ic, "tint"), outline: variantFile(ic, "sticker") } : null }; }
      else { const t = tagInfo(m[2]); if (t) piece = { badge: t.tag.replace("-", "\u2212"), group: t.group }; }
      if (!piece) continue;
      if (m.index > at) out.push({ text: chunk.slice(at, m.index) });
      out.push(piece);
      at = m.index + m[0].length;
    }
    if (at < chunk.length) out.push({ text: chunk.slice(at) });
    return out;
  }));
}
const ICON_EM = 1.1;                                  // an icon's width in ems
const BADGE_EM = 0.78;                                // a badge's letters, in ems of the text
/** A piece's width at size: an icon ICON_EM, a badge its letters (bold, BADGE_EM) and its pill's ends, else the text. */
const pieceW = (p, size, measure) => (p.icon ? ICON_EM * size : p.badge ? measure(p.badge, size * BADGE_EM) * 1.1 + size * 0.75 : measure(p.text, size));
/** Lines of paragraphs at font size `size` within maxW: [{pieces: [{text | icon, w}], w}] (a space between chunks);
 *  measure(text, size) -> px. An empty paragraph is an empty line. */
export function layout(paras, maxW, size, measure) {
  const space = measure(" ", size), lines = [];
  for (const para of paras) {
    let line = { pieces: [], w: 0 };
    if (!para.length) { lines.push(line); continue; }
    for (const chunk of para) {
      const pieces = chunk.map(p => ({ ...p, w: pieceW(p, size, measure) })), w = pieces.reduce((t, p) => t + p.w, 0);
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
/** Does a row band (px) hold a stat bar: its top and bottom borders, two rows apart whose step to the next row is sharp
 *  across most of the band's right two thirds? A line of text has only its letters' short tops, art one long edge at
 *  most. Looser than isBar: the bar needn't sit on the template's rows or columns. */
export function barLike(L, W, H, box) {
  const [x0, y0, x1, y1] = px(box, W, H), from = Math.round(x0 + (x1 - x0) * 0.33), n = x1 - from;
  if (n < 40) return false;
  const long = [];
  for (let y = Math.max(0, y0); y < Math.min(H - 1, y1); y++) {
    let on = 0; for (let x = from; x < x1; x++) if (Math.abs(L[(y + 1) * W + x] - L[y * W + x]) > 24) on++;
    if (on >= 0.7 * n) long.push(y);
  }
  return long.length > 1 && long[long.length - 1] - long[0] >= 6;
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
 *  to]}, stars: [from, to] | null, types: [old, new] | null (not a reorder), skipped: [labels]} (stats above 10 aren't drawn). */
export function changes(edit, psd) {
  const out = { name: null, ability: null, stats: {}, stars: null, types: null, skipped: [] };
  const text = s => String(s ?? "").replace(/\r/g, "").trim();
  if ("name" in edit && text(edit.name) !== text(psd.name)) out.name = text(edit.name);
  if ("ability" in edit && text(edit.ability) !== text(psd.ability)) out.ability = text(edit.ability);
  for (const k of STATS) if (k in edit && edit[k] !== psd[k]) {
    if (edit[k] == null || psd[k] == null || edit[k] > 10 || psd[k] > 10) out.skipped.push(k.toUpperCase());
    else out.stats[k] = [psd[k], edit[k]];
  }
  if ("stars" in edit && edit.stars != null && edit.stars !== psd.stars) out.stars = [psd.stars ?? 0, edit.stars];
  if ("types" in edit && JSON.stringify([...(edit.types || [])].map(norm).sort()) !== JSON.stringify([...(psd.types || [])].map(norm).sort())) out.types = [[...(psd.types || [])], [...(edit.types || [])]];
  return out;
}

/** The boxes to redraw from per-layer edits (PARTS_EDITOR.md §5; parts: Card Edits.json's, by layer id): [{id, role (name |
 *  ability), old, text (null: the layer is deleted), box (canvas px), added}] for the record's parts whose edit differs
 *  from the layer's text; an added ability goes in the template's Ability box. */
export function partJobs(rec, parts) {
  const p = obj(rec?.parts);
  if (!p || !obj(parts)) return [];
  const list = [...(p.title || []).map(x => ["name", x]), ...(p.ability || []).map(x => ["ability", x]), ...(p.blocks || []).map(x => ["ability", x])];
  const out = [];
  for (const [role, part] of list) {
    const e = parts[String(part?.id)];
    if (!e || typeof e !== "object") continue;
    const text = e.delete ? null : String(e.text ?? "");
    if (text !== part.text) out.push({ id: String(part.id), role, old: String(part.text ?? ""), text, box: Array.isArray(part.box) ? part.box : null, added: false, layer: String(part.layer || "") });
  }
  const add = obj(parts["+ability"]), tb = rec?.template?.ability?.box;
  if (add?.text && !(p.ability || []).length) out.push({ id: "+ability", role: "ability", old: "", text: String(add.text), box: Array.isArray(tb) ? tb : null, added: true });
  return out;
}

// ---- stars and type icons: where the bake would put them (psd_details' header, canvas px; AutoCroissant psd_edit)
const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const centreOf = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const boxAt = ([cx, cy], w, h) => [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
/** Stars from `from` to `to` on the record's header.stars: {erase: [box], draw: [box], refused, boxed}. A shown star stays when
 *  one of the count's centres (at[to], the bake's plan) is within a quarter of a star of its own; the others are erased
 *  (their box, glow included) and a star drawn at every centre none covers. No record, no layout for the count, or stars
 *  not one per unit: boxed. refused: why the bake would refuse the count. */
export function starPlan(stars, from, to) {
  const st = obj(stars), why = st && obj(st.refused) ? st.refused[to] ?? st.refused["*"] ?? null : null;
  const units = Array.isArray(st?.units) ? st.units : [], at = to === 0 ? [] : obj(st?.at)?.[to];   // none: all erased
  if (!units.length || units.length !== from || !Array.isArray(at)) return { erase: [], draw: [], refused: why, boxed: true };
  const w = median(units.map(u => u.core[2] - u.core[0])), h = median(units.map(u => u.core[3] - u.core[1])), tol = 0.25 * Math.max(w, h);
  const left = units.map(u => ({ u, c: centreOf(u.core) })), draw = [];
  for (const t of at) {
    const i = left.findIndex(({ c }) => Math.abs(c[0] - t[0]) <= tol && Math.abs(c[1] - t[1]) <= tol);
    if (i >= 0) left.splice(i, 1); else draw.push(boxAt(t, w, h));
  }
  return { erase: left.map(({ u }) => u.box), draw, refused: why, boxed: false };
}
/** Type icons from `old` to `now` on the record's header.types, as psd_edit.plan_types does it: kept icons stay in their
 *  slot, removed ones are erased, a kept icon past the new count moves to the first free slot, new ones take the next free
 *  slots (spots[count] past the row). -> {erase: [box], draw: [{name, core}], refused, boxed}. A token row, no icon to line
 *  up with or no spots for the count: boxed. */
export function typePlan(types, old, now) {
  const ty = obj(types), row = Array.isArray(ty?.row) ? ty.row : [];
  if (!ty || ty.tokens) return { erase: [], draw: [], refused: ty?.refused || null, boxed: true };
  let refused = ty.refused || null;
  const left = new Map();
  for (const n of now) left.set(norm(n), (left.get(norm(n)) || 0) + 1);
  const take = n => { const k = norm(n), m = left.get(k) || 0; if (m) left.set(k, m - 1); return m > 0; };
  for (const [name, why] of Array.isArray(ty.fixed) ? ty.fixed : []) if (!take(name)) refused ||= `${why}, not an icon to take off`;
  const kept = row.map(u => take(u.name));
  const added = now.filter(n => (left.get(norm(n)) || 0) > 0 && take(n));
  const count = kept.filter(Boolean).length + added.length;
  if (count > row.length && !row.length) return { erase: [], draw: [], refused: refused || "no type icon on the card to line a new one up with", boxed: true };
  const more = count > row.length ? obj(ty.spots)?.[count] : [];
  if (!Array.isArray(more) || more.length !== Math.max(0, count - row.length)) return { erase: [], draw: [], refused, boxed: true };
  const spots = [...row.slice(0, count).map(u => u.core), ...more], erase = [], draw = [];
  const free = spots.map((_, i) => i).filter(i => !(i < row.length && kept[i]));
  row.forEach((u, i) => {
    if (!kept[i]) erase.push(u.box);
    else if (i >= count) { const j = free.shift(); erase.push(u.box); draw.push({ name: u.name, core: spots[j] }); }
  });
  for (const name of added) draw.push({ name, core: spots[free.shift()] });
  return { erase, draw, refused, boxed: false };
}
/** Fill box (px) of RGBA data in place from the pixels around it: each pixel the mean of the left-right and top-bottom
 *  blends of the ring just outside (pad px deep), weighted by nearness, so a gradient goes on through it. */
export function fillBox(data, W, H, box, { pad = 3 } = {}) {
  const [x0, y0, x1, y1] = px(box, W, H);
  if (x1 - x0 < 1 || y1 - y0 < 1) return;
  const ring = (x, y, dx, dy) => { let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < pad; k++) { const u = x + dx * k, v = y + dy * k; if (u < 0 || v < 0 || u >= W || v >= H) break; const i = (v * W + u) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    return n ? [r / n, g / n, b / n] : null; };
  const L = [], R = [], T = [], B = [];
  for (let y = y0; y < y1; y++) { L.push(ring(x0 - 1, y, -1, 0)); R.push(ring(x1, y, 1, 0)); }
  for (let x = x0; x < x1; x++) { T.push(ring(x, y0 - 1, 0, -1)); B.push(ring(x, y1, 0, 1)); }
  const mix = (a, b, t) => (a && b ? a.map((v, k) => v + (b[k] - v) * t) : a || b);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const tx = (x - x0 + 0.5) / (x1 - x0), ty = (y - y0 + 0.5) / (y1 - y0);
    const hz = mix(L[y - y0], R[y - y0], tx), vt = mix(T[x - x0], B[x - x0], ty);
    const wh = 1 / Math.min(x - x0 + 1, x1 - x), wv = 1 / Math.min(y - y0 + 1, y1 - y);
    const c = hz && vt ? hz.map((v, k) => (v * wh + vt[k] * wv) / (wh + wv)) : hz || vt;
    if (!c) continue;
    const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
  }
}
/** The record's box (image px) for a text layer: text[].box ([x0, y0, x1, y1] in canvas px) scaled to the image. */
export function recordBox(rec, layer, W) {
  const t = Array.isArray(rec?.text) ? rec.text.find(x => x && x.layer === layer) : null, cw = rec?.canvas?.w;
  return t && Array.isArray(t.box) && t.box.length === 4 && t.box.every(Number.isFinite) && cw > 0 ? t.box.map(v => (v * W) / cw) : null;
}
/** The details record's text layer for a role ("name" | "ability"): {layer, font, size, color} or null. A layer whose
 *  first run is in the icon font (text that starts with a badge or an icon) takes the layer's other font (rec.fonts). */
export function layerOf(rec, role) {
  const tpl = rec?.template && typeof rec.template === "object" ? rec.template : {};
  const want = role === "name" ? [tpl.name_layer] : Array.isArray(tpl.ability_layers) ? tpl.ability_layers : [];
  const list = Array.isArray(rec?.text) ? rec.text.filter(t => t && typeof t === "object") : [];
  const t = list.find(t => want.includes(t.layer)) || list.find(t => (role === "name" ? /(^|\/)name$/i : /(^|\/)ability$/i).test(String(t.layer || ""))) || null;
  if (!t || !ICON_FONT.test(String(t.font || ""))) return t;
  const other = Object.entries(rec?.fonts && typeof rec.fonts === "object" ? rec.fonts : {}).find(([n, v]) => !ICON_FONT.test(n) && Array.isArray(v?.layers) && v.layers.includes(t.layer));
  return { ...t, font: other ? other[0] : "" };
}
const ICON_FONT = /^stoogedings/i;                    // AutoCroissant ICON_FONT_PREFIX: icons and badges, not letters
const OVERLAY = /^(Color|Gradient|Pattern)Overlay$/;  // psd_details' effect names; a disabled one ends " (off)"
/** Whether the text layer at path ("Text/Ability") or a group above it has an enabled Color, Gradient or Pattern Overlay
 *  (the details record's effects): the font then draws its badges and stickers in one colour, Stylistic Alternates
 *  (AutoCroissant psd_edit one_colour, 2026-10-25). */
export function oneColour(rec, path) {
  const fx = rec?.effects && typeof rec.effects === "object" ? rec.effects : {}, parts = String(path || "").split("/");
  return !!path && parts.some((_, i) => { const e = fx[parts.slice(0, i + 1).join("/")]; return Array.isArray(e) && e.some(n => OVERLAY.test(String(n))); });
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
const images = new Map();                             // src -> Promise<Image | null>, the last IMAGES used (a card's is 720 px, decoded)
const IMAGES = 24;
function loadImage(src) {
  let p = images.get(src);
  if (p) images.delete(src);                          // used now: kept longest
  else p = new Promise((ok, no) => { const i = new Image(); i.decoding = "async"; i.onload = () => ok(i); i.onerror = no; i.src = src; }).catch(() => null);
  images.set(src, p);
  while (images.size > IMAGES) images.delete(images.keys().next().value);
  return p;
}
const STAND_IN = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Draw the mock-up into canvas: the card image (src, same origin) with `edit`'s PSD fields over it. opts: {card, src, rec
 *  (details record or null), edit, psd (the image's values), icons, getFonts, raw, onFont (a font has loaded: draw
 *  again), stale (a newer draw started: drop this one)}. Drawn off-screen, then copied. Returns {drawn: [labels], skipped,
 *  boxed: [labels drawn in a box], over: [labels too long for their place, at 40%], refused: [[label, why]] (stars or types
 *  the bake would refuse), fonts: {name: family | ""}, standIn: [labels without a font name], shape} or null (the image
 *  didn't load, or stale). */
export async function draw(canvas, { card, src, rec, edit, psd, icons, getFonts, raw, onFont, stale = () => false }) {
  const img = await loadImage(src);
  if (!img || stale()) return null;
  const W = img.naturalWidth, H = img.naturalHeight, shape = shapeOf(W, H), tpl = TEMPLATES[shape];
  const work = document.createElement("canvas"); work.width = W; work.height = H;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const todo = changes(edit, psd), out = { drawn: [], skipped: [...todo.skipped], boxed: [], over: [], refused: [], fonts: {}, standIn: [], shape };
  const blit = () => { if (stale()) return null; canvas.width = W; canvas.height = H; canvas.getContext("2d").drawImage(work, 0, 0); return out; };
  if (!tpl) { out.skipped.push(...[todo.name != null && "name", todo.ability != null && "text", ...Object.keys(todo.stats).map(k => k.toUpperCase()), todo.stars && "stars", todo.types && "types"].filter(Boolean)); return blit(); }
  const pixels = ctx.getImageData(0, 0, W, H), L = luma(pixels.data);
  const family = async (role, label, path = "") => {        // path: a part's own layer, when the record lists it
    const own = path && Array.isArray(rec?.text) ? rec.text.find(t => t && t.layer === path && !ICON_FONT.test(String(t.font || ""))) : null;
    const layer = own || layerOf(rec, role), name = layer?.font || "";
    const pending = name ? loadFont(name, { getFonts, raw }) : Promise.resolve("");
    let fam = "";
    const ready = await Promise.race([pending, new Promise(r => setTimeout(() => r(null), 60))]);   // a loaded font draws at once
    if (ready === null) pending.then(f => { if (f) onFont?.(); }); else fam = ready;
    if (name) out.fonts[name] = fam; else out.standIn.push(label);
    return { fam: fam ? `"${fam}", ${STAND_IN}` : STAND_IN, layer };
  };
  const scaled = b => b.map((v, i) => v * (i % 2 ? H : W));
  const bars = barRows(shape, W, H, card, rec).filter(r => isBar(L, W, H, r.box));   // the rows drawn on
  const rows = barRows(shape, W, H, card, null), seen = rows.filter(r => isBar(L, W, H, r.box)), lowest = seen.length ? seen : rows;
  const barsBottom = lowest.length ? Math.max(...lowest.map(r => r.box[3])) : 0;   // the text starts below the card's stat rows (where they are seen, else the template's)
  const jobs = [], kc = rec?.canvas?.w > 0 ? W / rec.canvas.w : 0;
  const specs = [["name", todo.name, psd.name, "name"], ["ability", todo.ability, psd.ability, "text"]].filter(x => x[1] != null).map(([role, text, old, label]) => ({ role, text, old, label }));
  const partly = partJobs(rec, edit.parts);
  if (obj(rec?.parts) && obj(edit.parts)) specs.length = 0;   // one box per layer: each changed layer in its own box, not the joined fields
  for (const j of partly) specs.push({ role: j.role, text: j.text, old: j.old, label: j.role === "name" ? "name" : "text", own: j.box && kc ? j.box.map(v => v * kc) : null, added: j.added, part: true, path: j.layer });
  for (const { role, text, old, label, own: partBox, added, part, path } of specs) {
    const { fam, layer } = await family(role, label, path);
    const measure = (t, z) => { ctx.font = `${z}px ${fam}`; return ctx.measureText(t).width; };
    const own = partBox || (part ? null : recordBox(rec, layer?.layer, W)), one = role === "ability" && oneColour(rec, layer?.layer);
    const area = own ? { box: own, seed: [own[1], own[3]] } : role === "name" ? { box: scaled(tpl.name), seed: null } : textArea(shape, W, H, barsBottom);
    if (added) { jobs.push({ role, text, label, area: { box: own || area.box, seed: null }, fam, layer, measure, icons, one, boxed: true }); out.boxed.push(label); continue; }
    const paras = tokenize(old, icons);
    const hit = bestBlock(L, W, H, area, paras, measure, { name: role === "name" });   // the block that holds the old text, or none
    if (hit) {
      const { b, cal, edge } = hit, z = cal.size;
      const strayTop = seen.length ? Math.min(area.box[1], barsBottom + 0.004 * H) : own ? area.box[1] : (TEMPLATES[shape].ability[1] - 0.06) * H;   // stat rows not seen where the template has them: look higher
      const gone = role === "name" || part ? (role === "name" ? b.lines : eraseLines(b)) : [...eraseLines(b), ...strayLines(L, W, H, b, { top: strayTop, bottom: H, bars: rows })];   // a name or one layer: its own lines
      const all = [Math.min(...gone.map(l => l[0])) - z, Math.min(...gone.map(l => l[1])) - z * 0.5, Math.max(...gone.map(l => l[2])) + z, Math.max(...gone.map(l => l[3])) + z * 0.5];
      const colours = erase(pixels.data, W, H, all, { lines: gone, close: Math.round(z * 1.2), reach: Math.max(2, Math.round(z * 0.14)), cell: Math.max(6, z * 0.8), edge: 25 });   // in the lines only: dim words too
      if (text == null) { out.drawn.push(`${label} (layer deleted)`); continue; }   // a deleted layer: erased only
      jobs.push({ role, text, label, area, found: b, size: z, colours, fam, layer, measure, icons, one });
    } else if (text == null) out.skipped.push(`${label} (deleted layer)`);
    else { jobs.push({ role, text, label, area: part ? { box: area.box, seed: null } : area, fam, layer, measure, icons, one, boxed: true }); out.boxed.push(label); }   // a layer's box: covered, never the card below it
  }
  for (const [k, [from, to]] of Object.entries(todo.stats)) {
    const row = bars.find(r => r.k === k);
    if (!row) { out.skipped.push(k.toUpperCase()); continue; }
    paintCells(pixels.data, W, H, row, from, to); out.drawn.push(k.toUpperCase());
  }
  const head = obj(rec?.header), k = rec?.canvas?.w > 0 ? W / rec.canvas.w : 0, at = b => b.map(v => v * k);
  const icons2 = [];                                  // [label, plan] for the stars and types
  if (todo.stars) icons2.push(["stars", k ? starPlan(head?.stars, ...todo.stars) : { boxed: true, refused: null }]);
  if (todo.types) icons2.push(["types", k ? typePlan(head?.types, ...todo.types) : { boxed: true, refused: null }]);
  for (const [, plan] of icons2) if (!plan.boxed) for (const b of plan.erase) { const g = at(b); fillBox(pixels.data, W, H, [g[0] - 2, g[1] - 2, g[2] + 2, g[3] + 2], { pad: Math.max(2, Math.round(W * 0.004)) }); }
  ctx.putImageData(pixels, 0, 0);
  for (const [label, plan] of icons2) {
    if (plan.refused && !(label === "stars" && obj(rec?.parts) && /folder sets them/.test(plan.refused))) out.refused.push([label, plan.refused]);   // with parts the card moves folder (the dialog's note)
    if (plan.boxed && !(label === "stars" ? +todo.stars[1] : todo.types[1]?.length)) { out.skipped.push(label); continue; }   // none, with no place: the old ones stay
    if (plan.boxed) { out.boxed.push(label); await drawIconBox(ctx, label, label === "stars" ? todo.stars[1] : todo.types[1], { icons, head, W, H, tpl }); }
    else if (label === "stars") { const src = await starSource(head.stars, icons, img, k); for (const b of plan.draw) drawIcon(ctx, src, at(b)); }
    else for (const d of plan.draw) drawIcon(ctx, await iconOf(icons, d.name), at(d.core));
    out.drawn.push(label);
  }
  for (const job of jobs) {
    const imgs = await iconImages(job.text, icons);
    if (job.boxed ? drawBox(ctx, job, imgs, W, H, shape) : drawText(ctx, job, imgs, W)) out.over.push(job.label);
    out.drawn.push(job.label);
  }
  return blit();
}
/** An icon's image by name (S.icons, norm keys), or null. */
const iconOf = async (icons, name) => { const ic = icons?.[norm(name)]; return ic?.file ? loadImage(ic.file) : null; };
/** What a new star is drawn with: the star icon the bake copies (header.stars.icon), else the last shown star's pixels. */
async function starSource(stars, icons, img, k) {
  const im = stars.icon ? await iconOf(icons, stars.icon) : null;
  if (im) return im;
  const u = stars.units[stars.units.length - 1].core.map(v => v * k);
  return { img, crop: [u[0], u[1], u[2] - u[0], u[3] - u[1]] };
}
/** An icon (an image, or {img, crop}) fitted into box with a soft shadow for the PSD's drop shadow and glow. */
function drawIcon(ctx, src, box) {
  if (!src) return;
  const im = src.img || src, [sx, sy, sw, sh] = src.crop || [0, 0, im.naturalWidth, im.naturalHeight];
  if (!sw || !sh) return;
  const bw = box[2] - box[0], bh = box[3] - box[1], s = Math.min(bw / sw, bh / sh), w = sw * s, h = sh * s;
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 0.06 * Math.max(w, h);
  ctx.drawImage(im, sx, sy, sw, sh, box[0] + (bw - w) / 2, box[1] + (bh - h) / 2, w, h); ctx.restore();
}
/** No place found for the stars or types: a dark box over the template's area with the new stars in rows of two (the
 *  star icon, else a ★) or the type icons down a column. */
async function drawIconBox(ctx, label, value, { icons, head, W, H, tpl }) {
  const a = tpl[label], n = label === "stars" ? Math.min(+value || 0, 10) : (value || []).length;
  if (!a || !n) return;
  const x0 = a[0] * W, x1 = a[2] * W, y0 = a[1] * H, pad = W * 0.012;
  const cols = label === "stars" ? 2 : 1, cell = (x1 - x0 - 2 * pad) / cols, rows = Math.ceil(n / cols);
  const b = [x0, y0, x1, y0 + rows * cell + 2 * pad], rad = Math.min(W * 0.03, cell / 2);
  ctx.save(); ctx.beginPath(); ctx.moveTo(b[0] + rad, b[1]); ctx.arcTo(b[2], b[1], b[2], b[3], rad); ctx.arcTo(b[2], b[3], b[0], b[3], rad); ctx.arcTo(b[0], b[3], b[0], b[1], rad); ctx.arcTo(b[0], b[1], b[2], b[1], rad); ctx.closePath();
  ctx.fillStyle = "rgb(16,16,22)"; ctx.fill(); ctx.lineWidth = Math.max(1.5, W * 0.003); ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.setLineDash([W * 0.012, W * 0.008]); ctx.stroke(); ctx.restore();
  const star = label === "stars" && head?.stars && typeof head.stars === "object" && head.stars.icon ? await iconOf(icons, head.stars.icon) : null;
  for (let i = 0; i < n; i++) {
    const cx = cols === 2 ? x1 - pad - (i % 2 + 0.5) * cell : x0 + pad + cell / 2, cy = y0 + pad + (Math.floor(i / cols) + 0.5) * cell;   // stars right to left, as the cards read
    const box = boxAt([cx, cy], cell * 0.86, cell * 0.86);
    if (label === "types") drawIcon(ctx, await iconOf(icons, value[i]), box);
    else if (star) drawIcon(ctx, star, box);
    else { ctx.save(); ctx.font = `${cell * 0.8}px ${STAND_IN}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#ffd21f"; ctx.lineWidth = cell * 0.06; ctx.strokeStyle = "#000"; ctx.strokeText("★", cx, cy); ctx.fillText("★", cx, cy); ctx.restore(); }
  }
}
async function iconImages(text, icons) {
  const files = new Set(tokenize(text, icons).flat(2).filter(p => p.icon).flatMap(p => [p.icon, p.sticker?.tint, p.sticker?.outline].filter(Boolean))), out = new Map();
  for (const f of files) out.set(f, await loadImage(f));
  return out;
}
const STICKER_REACH = 0.0729, STICKER_LINE = 0.04;   // build_stoogedings OUTLINE, STICKER_LINE over HEIGHT
/** A mask image painted in one colour, into box [x, y, w, h]; inset (0..1) cuts the same mask, shrunk by it, back out
 *  (the outline of a one-colour sticker). */
function paintMask(ctx, im, [x, y, w, h], colour, inset = 0) {
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext("2d");
  g.drawImage(im, 0, 0, c.width, c.height);
  if (inset) { g.globalCompositeOperation = "destination-out"; g.drawImage(im, c.width * inset, c.height * inset, c.width * (1 - 2 * inset), c.height * (1 - 2 * inset)); }
  g.globalCompositeOperation = "source-in"; g.fillStyle = rgb(colour); g.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(c, x, y, w, h);
}
/** Lines of pieces from x at baseline base, z px: text with an outline, icons, badges as pills. one (an overlay on the
 *  ability): badges as outlined pills and stickers as an outline round the one-colour icon, in the text's fill. */
function paintLines(ctx, lines, { at, base, pitch, z, fam, fill, stroke, imgs, one = false }) {
  ctx.textBaseline = "alphabetic";
  lines.forEach((line, n) => {
    let x = at(line), y = base + n * pitch;
    for (const p of line.pieces) {
      if (p.icon && one && p.sticker && imgs.get(p.sticker.tint) && imgs.get(p.sticker.outline)) {
        const s = z * 1.05, r = s * STICKER_REACH, bx = x + (p.w - s) / 2, by = y - s * 0.82;
        paintMask(ctx, imgs.get(p.sticker.outline), [bx - r, by - r, s + 2 * r, s + 2 * r], fill, STICKER_LINE / (1 + 2 * STICKER_REACH));
        paintMask(ctx, imgs.get(p.sticker.tint), [bx, by, s, s], fill);
      } else if (p.icon) {
        const im = imgs.get(p.icon), s = z * 1.05;
        if (im) ctx.drawImage(im, x + (p.w - s) / 2, y - s * 0.82, s, s);
        if (p.no) { ctx.save(); ctx.strokeStyle = "#e11"; ctx.lineWidth = Math.max(2, z * 0.12); ctx.beginPath(); ctx.moveTo(x + p.w * 0.1, y - s * 0.75); ctx.lineTo(x + p.w * 0.9, y + s * 0.1); ctx.stroke(); ctx.restore(); }
      } else if (p.badge) {
        const h = z * 0.92, top = y - z * 0.76, r = h / 2, x0 = x + z * 0.06, x1 = x + p.w - z * 0.06;
        ctx.save(); ctx.beginPath(); ctx.moveTo(x0 + r, top); ctx.arcTo(x1, top, x1, top + h, r); ctx.arcTo(x1, top + h, x0, top + h, r); ctx.arcTo(x0, top + h, x0, top, r); ctx.arcTo(x0, top, x1, top, r); ctx.closePath();
        ctx.font = `800 ${z * BADGE_EM}px ${fam}`; ctx.textAlign = "center";
        const lx = (x0 + x1) / 2, ly = top + h * 0.5 + z * BADGE_EM * 0.36;
        if (one) {                                    // the font's Stylistic Alternates: a pill outline and solid letters
          ctx.lineJoin = "round";
          if (stroke) { ctx.strokeStyle = rgb(stroke); ctx.lineWidth = Math.max(2, z * 0.21); ctx.stroke(); ctx.lineWidth = Math.max(1.5, z * 0.16); ctx.strokeText(p.badge, lx, ly); }
          ctx.strokeStyle = rgb(fill); ctx.lineWidth = Math.max(1, z * 0.05); ctx.stroke(); ctx.fillStyle = rgb(fill); ctx.fillText(p.badge, lx, ly);
        } else {
          ctx.fillStyle = BADGE[p.group] || BADGE.neutral; ctx.fill(); ctx.lineWidth = Math.max(1, z * 0.07); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.stroke();
          ctx.fillStyle = "#fff"; ctx.fillText(p.badge, lx, ly);
        }
        ctx.restore();
      } else if (p.text.trim()) {
        ctx.font = `${z}px ${fam}`;
        if (stroke) { ctx.lineJoin = "round"; ctx.strokeStyle = rgb(stroke); ctx.lineWidth = Math.max(1.5, z * 0.16); ctx.strokeText(p.text, x, y); }
        ctx.fillStyle = rgb(fill); ctx.fillText(p.text, x, y);
      }
      x += p.w;
    }
  });
}
/** The new text where the old block was: its size, line pitch and alignment, from its first line down (a PSD's text
 *  grows downwards), shrunk when it would run past the area; a name keeps its line count and stays clear of the stars. */
function drawText(ctx, { role, text, area, found, size, colours, fam, layer, measure, icons, one }, imgs, W) {
  const paras = tokenize(text, icons), region = area.box;
  const mid = (found.box[0] + found.box[2]) / 2, wide = found.box[2] - found.box[0], room = 2 * Math.min(mid - region[0], region[2] - mid);
  const left = found.align === "left" && role !== "name";
  const maxW = left ? region[2] - found.box[0] - W * 0.01 : role === "name" ? Math.max(wide, room * 0.96) : found.lines.length > 1 ? Math.min(wide * 1.06, Math.max(wide, room)) : Math.max(wide, room * 0.94);
  const pitch0 = found.pitch || size * LINE, top = found.lines[0][1];
  let { size: z, lines } = fit(paras, maxW, Infinity, size, measure, role === "name" ? { lines: Math.max(1, found.lines.length, paras.length), min: 0.3 } : {});   // a title's line break: two lines
  let over = false;
  if (role !== "name") {                              // past the area's bottom: smaller, down to 40%; still past it: said so
    const room2 = region[3] - top, need = s => (lines.length - 1) * pitch0 * (s / size) + s * 1.05;
    while (need(z) > room2 && z > size * 0.4) { z *= 0.94; lines = layout(paras, maxW, z, measure); }
    over = need(z) > room2 + 1;
  }
  const pitch = pitch0 * (z / size), base = top + z * 0.8;
  const fill = colours?.fill || hexRgb(layer?.color) || [255, 255, 255], stroke = colours?.stroke;
  paintLines(ctx, lines, { at: l => (left ? found.box[0] : mid - l.w / 2), base, pitch, z, fam, fill, stroke, imgs, one });
  return over;
}
/** No block held the old text: the new text in a dark box over the area (the template's, or the record's box), so the
 *  old text is covered, never half there. */
function drawBox(ctx, { role, text, area, fam, measure, icons, one }, imgs, W, H, shape) {
  const r = area.seed ? [0, area.seed[0], W, H] : area.box;     // the text area to the card's edges (the old text may touch them)
  const b = area.seed ? r : [r[0] - W * 0.01, r[1] - H * 0.004, r[2] + W * 0.01, r[3] + H * 0.004], pad = W * 0.03;
  const start = role === "name" ? (b[3] - b[1]) * 0.5 : W * (shape === "square" ? 0.06 : shape === "item" ? 0.05 : 0.045);
  const { size: z, lines } = fit(tokenize(text, icons), b[2] - b[0] - 2 * pad, b[3] - b[1] - pad, start, measure, role === "name" ? { lines: 1, min: 0.3 } : { min: 0.35 });
  const over = lines.length * z * LINE > b[3] - b[1] - pad + 0.5;
  const rad = Math.min(W * 0.03, (b[3] - b[1]) / 2);
  ctx.save(); ctx.beginPath(); ctx.moveTo(b[0] + rad, b[1]); ctx.arcTo(b[2], b[1], b[2], b[3], rad); ctx.arcTo(b[2], b[3], b[0], b[3], rad); ctx.arcTo(b[0], b[3], b[0], b[1], rad); ctx.arcTo(b[0], b[1], b[2], b[1], rad); ctx.closePath();
  ctx.fillStyle = "rgb(16,16,22)"; ctx.fill(); ctx.lineWidth = Math.max(1.5, W * 0.003); ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.setLineDash([W * 0.012, W * 0.008]); ctx.stroke(); ctx.restore();
  const pitch = z * LINE, base = (b[1] + b[3]) / 2 - (lines.length * pitch) / 2 + z * 0.9, mid = (b[0] + b[2]) / 2;
  paintLines(ctx, lines, { at: l => mid - l.w / 2, base, pitch, z, fam, fill: [255, 255, 255], stroke: [0, 0, 0], imgs, one });
  return over;
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
