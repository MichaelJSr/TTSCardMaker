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
import { norm, splitToken, tagInfo, cooldownOf, ringParts, RING_PAINT, TAG, COST, costInfo, variantFile } from "./text.js";
import { starMove, starsKept, titleInPicture } from "./parts.js";
import { colorRanges, inkOf, layerColors, phraseText, spansOf, statusSpans } from "./textcolor.js";

export const LABEL = "Mock-up: the real image comes from the bake";
export const BADGE = { turn: "#2563eb", any: "#7c3aed", forced: "#dc2626", trigger: "#d97706", neutral: "#475569",   // flat, before the label font loads
  points: "#055e45", bricks: "#4f260f", sp: "#20397f", own: "#0f766e" };                                     // and its costs' pills
const STATS = ["hp", "def", "atk", "spd"];
export const LINE = 1.22;                            // line pitch in ems
// fractions of the image [x0, y0, x1, y1]: where a template prints the name and the text; its stat bars (one row per stat,
// `step` apart, 10 cells across `box`). Measured on the PSDs' layer boxes (2026-10-23): tall = 1200x2400 creatures and
// minions (311 of 390 with stat rows sit exactly here), item = 1200x1800 items and field cards (the totems' two rows),
// square = 1200x1200 status effects. stars, types: the header's star and type icon areas for the box fallback (the median
// union of psd_details' header boxes over 764 card PSDs, 2026-10-24: 660 with stars, 687 with type icons). first: where a
// card with no type icon takes its first (Creature_Template's, psd_edit.template_icon; every creature card's).
export const TEMPLATES = {
  tall: { name: [0.2, 0, 0.8, 0.1], ability: [0.012, 0.722, 0.988, 0.995], bars: { box: [0.3, 0.5, 0.978, 0.535], step: 0.0525 },
    stars: [0.785, 0.007, 0.99, 0.1], types: [0.017, 0.01, 0.179, 0.086], first: [62 / 1200, 27 / 2400, 175 / 1200, 183 / 2400] },
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
 *  last line ("it.") joins the paragraph of the strong rows next to it; clusters of rows are paragraphs. textBlocks:
 *  every run of up to 12 neighbouring paragraphs that reaches into the seed rows ([y0, y1]
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
/** How well a found block holds the old text (paras: tokenize(old)): measured at the block's size the old text is k times
 *  as wide as the block's lines together, and wrapped at the block's width it makes nPred lines (against the block's).
 *  size: the block's size scaled by k (the old text at it fills the block as the old one did). ok: k within 0.62-1.6 and
 *  the line counts within one (or 30%); one line: k within 0.6-3 (its size from its width), its run at least 0.3 em
 *  high, and the old text in one or two lines. exact (a name): as many lines as found, one line at most twice as wide
 *  (wide: three times). px (a record's set size, several lines): size px, k within 0.85-1.18 and, wrapped at wrap,
 *  as many lines as found; px and exact (a title): size px, k within 0.85-1.18, a line per paragraph as found.
 *  measure(text, size) -> px. */
export function calibrate(found, paras, measure, { exact = false, wide = false, px = 0, wrap = 0 } = {}) {
  const s0 = found.size, inked = found.lines.reduce((t, l) => t + (l[2] - l[0]), 0);
  if (px > 0 && found.lines.length > 1) {
    const one = layout(paras, Infinity, px, measure).reduce((t, l) => t + l.w, 0), k = one ? inked / one : 0, nFound = found.lines.length;
    const nPred = layout(paras, wrap || (found.box[2] - found.box[0]) * 1.04, px, measure).filter(l => l.pieces.length).length;
    return { ok: k >= 0.85 && k <= 1.18 && nPred === nFound && lineLike(found), k, size: px, nPred, nFound };
  }
  if (px > 0 && exact) {                               // a title at the record's set size: as wide as its ink, its lines as found
    const one = layout(paras, Infinity, px, measure), k = one.length ? inked / one.reduce((t, l) => t + l.w, 0) : 0;
    return { ok: k >= 0.85 && k <= 1.18 && one.length === found.lines.length, k, size: px, nPred: one.length, nFound: found.lines.length };
  }
  const oneLine = layout(paras, Infinity, s0, measure).reduce((t, l) => t + l.w, 0);
  if (!oneLine || !inked) return { ok: false, k: 0, size: s0, nPred: 0, nFound: found.lines.length };
  const k = inked / oneLine, nFound = found.lines.length;
  if (nFound === 1) {                                 // one line: no pitch, and its run of rows can be well under an em (thin letters): the width decides
    const size = s0 * clamp(k, 0.6, 3), inkH = found.lines[0][3] - found.lines[0][1];
    const nPred = layout(paras, (found.box[2] - found.box[0]) * 1.04, size, measure).filter(l => l.pieces.length).length;
    return { ok: (exact ? nPred === 1 && k <= (wide ? 3 : 2) : nPred <= 2) && k >= 0.6 && k <= 3 && inkH >= 0.3 * size && inkH <= 1.4 * size, k, size, nPred, nFound };
  }
  const size = s0 * clamp(k, 0.75, 1.33);
  const nPred = layout(paras, (found.box[2] - found.box[0]) * 1.04, size, measure).filter(l => l.pieces.length).length;
  const fits = k > 0.62 && k < 1.6 && (exact ? nPred === nFound : Math.abs(nPred - nFound) <= Math.max(1, Math.round(nFound * 0.3)));
  return { ok: fits && lineLike(found), k, size, nPred, nFound };
}
/** Of every block textBlocks finds in area ({box, seed}) at two edge strengths (soft art merges with text at the lower)
 *  and two seed strengths (short lines seed blocks at the lower, art merges in),
 *  the one calibrate says holds the old text (paras), the most edge mass first: {b, cal, edge} or null. name: a card's
 *  name (one or two lines, the stars beside it kept apart: words join within 1.2 line heights, not 4). joins: the
 *  join reaches to try (line heights). */
export function bestBlock(L, W, H, area, paras, measure, { edges = [40, 80, 130], name = false, wide = false, px = 0, wrap = 0, joins = [name ? 1.2 : 4] } = {}) {
  let best = null;
  for (const join of joins) for (const edge of edges) for (const strong of [0.3, 0.18]) for (const b of textBlocks(L, W, H, area.box, { seed: area.seed, edge, strong, join, span: name ? 2 : 12 })) {
    const cal = calibrate(b, paras, measure, { exact: name, wide, px, wrap });
    if (!cal.ok) continue;
    const score = b.mass / (1 + 0.5 * Math.abs(cal.nPred - cal.nFound));   // the most text that fits it
    if (!best || score > best.score) best = { b, cal, edge, score };
  }
  return best || (name && !wide ? bestBlock(L, W, H, area, paras, measure, { edges, name, wide: true }) : null);   // a title in a wide font
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
/** One layer's block b grown by strayLines inside its own box (px; a quarter em z past top and bottom): all its ink,
 *  the new text from its first line. -> {found, strays} */
export function layerBlock(L, W, H, b, own, z, bars = []) {
  const strays = strayLines(L, W, H, b, { top: Math.max(0, own[1] - 0.25 * z), bottom: Math.min(H, own[3] + 0.25 * z), bars });
  if (!strays.length) return { found: b, strays };
  const all = [b.box, ...strays], box = [0, 1, 2, 3].map(i => (i < 2 ? Math.min : Math.max)(...all.map(l => l[i])));
  return { found: { ...b, lines: [...b.lines, ...strays].sort((p, q) => p[1] - q[1]), box }, strays };
}
/** The lines to erase: a centred block's lines made even about its centre (a line read short on one side, past a dim
 *  word, still goes whole). */
export function eraseLines(found) {
  if (found.align === "left") return found.lines;
  const mid = median(found.lines.map(l => (l[0] + l[2]) / 2));
  return found.lines.map(l => { const half = Math.max(mid - l[0], l[2] - mid); return [mid - half, l[1], mid + half, l[3]]; });
}
/** Text not found on the image, as a found block in the record's box (own, px): one even band per line of the old text
 *  at size z (wrapped at wrap, px, or not), left when the box sits at the frame's left edge (frame, px), else centred. */
export function recordBlock(own, paras, measure, z, wrap = 0, frame = null) {
  const n = Math.max(1, layout(paras, wrap || Infinity, z, measure).filter(l => l.pieces.length).length), lh = (own[3] - own[1]) / n, c = (own[0] + own[2]) / 2;
  const lines = Array.from({ length: n }, (_, i) => [own[0], own[1] + i * lh, own[2], own[1] + (i + 1) * lh]);
  return { box: own, lines, size: z, pitch: lh, align: frame && Math.abs(own[0] - frame[0]) < Math.abs(c - (frame[0] + frame[2]) / 2) ? "left" : "center", mass: 0 };
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
 *  Returns the colours read on the way: {bg, fill, stroke | null} as [r, g, b]. fill: the record's (textColours' known).
 *  profile (a Gradient Overlay): shades too, the old letters' colours top to bottom (shadesOf), else null. */
export function erase(data, W, H, box, { reach = 3, cell = 10, edge = 40, lines = null, close = 0, fill = null, profile = false } = {}) {
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
  const masked = [];                                  // [lum, r, g, b, x, y] of the text's pixels: its colours
  let bgSum = [0, 0, 0], bgN = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * W + x0 + x) * 4;
    if (mask[y * w + x]) { if ((x + y) % 3 === 0) masked.push([L[i >> 2], data[i], data[i + 1], data[i + 2], x, y]); continue; }
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
  const tc = textColours(masked, bg, fill), shades = profile ? shadesOf(masked, lines, y0, cw, at, tc.stroke) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const fx = (x + 0.5) / cw - 0.5, fy = (y + 0.5) / cw - 0.5, cx = Math.floor(fx), cy = Math.floor(fy), tx = fx - cx, ty = fy - cy;
    const i = ((y0 + y) * W + x0 + x) * 4;
    for (let k = 0; k < 3; k++) {
      data[i + k] = (at(cx, cy, k) * (1 - tx) + at(cx + 1, cy, k) * tx) * (1 - ty) + (at(cx, cy + 1, k) * (1 - tx) + at(cx + 1, cy + 1, k) * tx) * ty;
    }
  }
  return { bg: bg.map(Math.round), ...tc, shades };
}
/** A Gradient Overlay's colours over the old lines (px), top to bottom: in 8 bands, the median colour of the text's
 *  pixels (erase's masked, x and y in its box from y0) that are neither the background (at: its cells) nor the outline.
 *  -> {stops: [[t, [r, g, b]]], top, bottom} | null */
function shadesOf(masked, lines, y0, cw, at, stroke) {
  if (!lines?.length) return null;
  const top = Math.min(...lines.map(l => l[1])), bottom = Math.max(...lines.map(l => l[3])), B = 8, bands = Array.from({ length: B }, () => [[], [], []]);
  const near = (p, c, d) => [0, 1, 2].every(k => Math.abs(p[k + 1] - c[k]) < d);
  for (const p of masked) {
    const t = (y0 + p[5] - top) / Math.max(1, bottom - top), cx = Math.floor(p[4] / cw), cy = Math.floor(p[5] / cw);
    if (t < 0 || t >= 1 || near(p, [0, 1, 2].map(k => at(cx, cy, k)), 48) || (stroke && near(p, stroke, 60))) continue;
    const b = bands[Math.floor(t * B)]; for (let k = 0; k < 3; k++) b[k].push(p[k + 1]);
  }
  const stops = bands.flatMap((b, i) => (b[0].length >= 6 ? [[(i + 0.5) / B, b.map(median)]] : []));
  return stops.length >= 2 ? { stops, top, bottom } : null;
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
 *  darkest outline (when darker than the background), on a light one the other way round. known (the record's fill)
 *  fills instead when 4% of the pixels are near it. */
export function textColours(masked, bg, known = null) {
  if (masked.length < 8) return { fill: known, stroke: null };
  const bgL = (bg[0] * 77 + bg[1] * 150 + bg[2] * 29) >> 8, s = [...masked].sort((a, b) => a[0] - b[0]), n = Math.max(1, Math.round(s.length * 0.12));
  const avg = part => [1, 2, 3].map(k => Math.round(part.reduce((t, p) => t + p[k], 0) / part.length));
  const lum = part => part.reduce((t, p) => t + p[0], 0) / part.length;
  const dark = s.slice(0, n), light = s.slice(-n);
  const seen = known && masked.filter(p => Math.max(...known.map((v, k) => Math.abs(p[k + 1] - v))) <= 48).length >= 0.04 * masked.length;
  if (seen) {                                         // the record's fill, found in the text: the outline past the background
    const kL = (known[0] * 77 + known[1] * 150 + known[2] * 29) >> 8;
    if (kL >= bgL) return { fill: known, stroke: lum(dark) < bgL - 25 ? avg(dark) : kL - bgL < 40 && lum(light) > kL + 50 ? avg(light) : null };
    return { fill: known, stroke: lum(dark) < kL - 50 ? avg(dark) : lum(light) > bgL + 25 ? avg(light) : null };   // black past it: its outline
  }
  return bgL < 140 ? { fill: avg(light), stroke: lum(dark) < bgL - 25 ? avg(dark) : null }
    : { fill: avg(dark), stroke: lum(light) > bgL + 25 ? avg(light) : null };
}

/** Ability text as paragraphs of chunks (no break inside a chunk), each piece {text}, {icon, no, sticker} (an icon token
 *  the site has, "[fire]", "[fire:no]", "[fire:sticker]" with its masks; another bracket or variant stays text) or {badge,
 *  group} (a timing tag, "(1CD)", as text.js reads it; a cost, "(2 points)", with cost {n, word, kind}; another
 *  parenthesis stays text). */
export function tokenize(text, icons = {}) {
  const PIECE = new RegExp(`\\[([^\\[\\]\\n]{1,52})\\]|${TAG.source}|\u0001(\\d+)\u0002`, "g"), costs = [];
  const held = line => line.replace(new RegExp(COST.source, "gi"), (all, inner) => (costInfo(inner) ? `\u0001${costs.push({ ...costInfo(inner), src: all }) - 1}\u0002` : all));
  return String(text ?? "").replace(/\r/g, "").split("\n").map(line => held(line).split(/[ \t]+/).filter(Boolean).map(chunk => {
    const out = []; let at = 0;
    for (const m of chunk.matchAll(PIECE)) {
      let piece = null;
      if (m[1] != null) { const t = splitToken(m[1]), ic = t && icons[norm(t.base)]; if (ic) piece = { icon: ic.file, name: t.base, no: t.v === "no", sticker: t.v === "sticker" && ["tint", "sticker"].every(v => ic.v?.includes(v)) ? { tint: variantFile(ic, "tint"), outline: variantFile(ic, "sticker") } : null }; }
      else if (m[3] != null) { const c = costs[+m[3]], own = c.kind === "souls" || c.kind === "counters"; piece = { badge: `${c.n} ${c.word}`, group: own ? "own" : c.kind, cost: own ? null : c, src: c.src }; }
      else { const t = tagInfo(m[2]); if (t) piece = { badge: t.tag.replace("-", "\u2212"), group: t.group, ring: cooldownOf(m[2]) }; }
      if (!piece) continue;
      piece.src ??= m[0];                            // its text, for colours (colourize)
      if (m.index > at) out.push({ text: chunk.slice(at, m.index) });
      out.push(piece);
      at = m.index + m[0].length;
    }
    if (at < chunk.length) out.push({ text: chunk.slice(at) });
    return out;
  }));
}
/** tokenize's paragraphs with their letters in their colours (textcolor.js colorRanges of text, over base: the card's
 *  own, baseInk): a text piece split where its colour changes, each part's `color` "#rrggbb" or none; icons and badges
 *  keep their own. back: [r, g, b] the text sits on, a colour under 3:1 against it left out. fills: {status name
 *  lowercased: "#rrggbb"}, the ability's status words (statusSpans) in the chart's colour over base, as the bake. */
export function colourize(paras, text, colors, field, statuses = null, base = null, back = null, fills = null) {
  text = String(text ?? "").replace(/\r/g, "");
  if (field === "ability" && fills) base = [...(base || []), ...statusSpans(text, statuses).map(([start, end]) => ({ start, end, color: fills[text.slice(start, end).replace(/[\s\u0003]+/g, " ").toLowerCase()] }))];
  const ranges = seenOn(colorRanges(text, colors, field, statuses, base), back);
  if (!ranges.length) return paras;
  const at = i => ranges.find(r => r.start <= i && i < r.end)?.color || null;
  let cursor = 0;
  return paras.map(para => para.map(chunk => chunk.flatMap(p => {
    const src = p.text ?? p.src ?? "", i = src ? text.indexOf(src, cursor) : -1;
    if (i < 0) return [p];
    cursor = i + src.length;
    if (p.text == null) return [p];
    const out = [];
    for (let k = 0; k < src.length; k++) {
      const c = at(i + k), last = out[out.length - 1];
      if (last && last.color === c) last.text += src[k]; else out.push({ text: src[k], color: c });
    }
    return out.map(x => (x.color ? x : { text: x.text }));
  })));
}
/** The card's own colours on a redrawn text, as its page keeps them over a staged edit (textcolor.js inkOf: a word
 *  the edit cuts into loses its own): the field's; a part's (old: its layer's text) the field's colours where that text
 *  is in the field, followed to the new; null without any. */
export function baseInk(card, field, text, old = null) {
  if (old == null) return inkOf(card, field, text);
  const was = String(card?.ink?.built?.[field] ?? card?.[field] ?? ""), at = old ? was.indexOf(old) : -1;
  const runs = at < 0 ? [] : (inkOf(card, field, was) || []).filter(r => r.start >= at && r.end <= at + old.length);
  return runs.length ? inkOf({ [field]: old, ink: { [field]: runs.map(r => [r.start - at, r.end - at, r.color]) } }, field, text) : null;
}
const lin = v => (v <= 10 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const lumOf = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** ranges without the colours under 3:1 against rgb (none: all): they stay in the text's own colour. */
const seenOn = (ranges, rgb) => { if (!rgb) return ranges; const b = lumOf(rgb); return ranges.filter(r => { const c = lumOf(hexRgb(r.color) || [0, 0, 0]); return (Math.max(b, c) + 0.05) / (Math.min(b, c) + 0.05) >= 3; }); };
const ICON_EM = 1.1;                                  // an icon's width in ems
const BADGE_EM = 0.78;                                // a badge's letters, in ems of the text, at BADGE_H
const BADGE_H = 0.92;                                 // the pill's height in ems before it is fitted
export const BADGE_RATIO = 1.35;                      // the pill over the text's capital height (AutoCroissant psd_edit)
/** [capital height, capital middle] above the baseline of the drawn "H" at z px in fam (0.7 and 0.35 em without
 *  actualBoundingBox*): what a badge is fitted to. */
export function capOf(ctx, fam, z) {
  ctx.font = `${z}px ${fam}`;
  const m = ctx.measureText("H"), up = m.actualBoundingBoxAscent, down = m.actualBoundingBoxDescent || 0;
  return Number.isFinite(up) && up > 0 ? [up + down, (up - down) / 2] : [0.7 * z, 0.35 * z];
}
/** A badge fitted as the bake fits it (owner 2026-10-25): {h, top, k} with the pill BADGE_RATIO times the capital height,
 *  its middle on the capitals' middle (top: px above the baseline), k its scale against the unfitted pill. */
export function badgeFit(z, cap) {
  const [capH, mid] = cap || [0.7 * z, 0.35 * z], h = BADGE_RATIO * capH;
  return { h, top: mid + h / 2, k: h / (BADGE_H * z) };
}
/** A piece's width at size: an icon ICON_EM, a badge its letters (bold, BADGE_EM) and its pill's ends at its fitted
 *  scale (measure.cap: capOf), a cooldown's ring end too, else the text. */
const pieceW = (p, size, measure) => {
  if (!p.badge) return p.icon ? ICON_EM * size : measure(p.text, size);
  const { k, h } = badgeFit(size, measure.cap?.(size)), em = h / PILL_EM;
  const set = measure.label?.(em);
  if (set && !p.cost) {                               // the label font loaded: the font's own widths
    const w = set.width(p.badge);
    return p.ring ? w + 1.29 * em : Math.max(PILL_EM * em, w + 0.4 * em) + 0.08 * em;
  }
  if (set) return costGeom(p.cost, h, set).w + 0.08 * em;
  const tw = set ? set.text(p.badge, size * BADGE_EM * k) : measure(p.badge, size * BADGE_EM * k);
  return tw * 1.1 + size * (p.cost ? 1.1 : 0.75) * k + (p.ring ? RING_W * h : 0);   // a cost: its icon beside
};
// ---- timing badges as the font draws them (build_stoogedings _tag_badges): ems of the badge glyph; the pill 0.95 em
const PILL_EM = 0.95;
const PILL = { turn: ["#4f86f7", "#2563eb", "#1e3a8a"], any: ["#9f67ff", "#7c3aed", "#4c1d95"], forced: ["#ef5050", "#dc2626", "#7f1d1d"],   // BADGE_GROUPS: top, bottom, border
  trigger: ["#e08a1e", "#b45309", "#78350f"], neutral: ["#64748b", "#475569", "#1e293b"],
  points: ["#08785a", "#034532", "#012419"], bricks: ["#5e3019", "#3f1d0c", "#241005"], sp: ["#2a4a9e", "#172a63", "#0b1740"],   // COSTS
  own: ["#149488", "#0f766e", "#0b4f4a"] };
const COST_WORD = { points: "#effff9", bricks: "#ffe6d6", sp: "#eef2ff" };
const COST_ART = {   // the font's icons (build_stoogedings cost_badge): fill stops, edge, number
  points: [[[0, "#e8fff7"], [0.3, "#6dffd0"], [0.58, "#00ffae"], [1, "#00a36c"]], "#00603f", "#003d29"],
  bricks: [[[0, "#c97b52"], [0.45, "#a0522d"], [1, "#7a3a1c"]], "#3d1a08", "#ffffff"],
  sp: [[[0, "#ffffe8"], [0.3, "#ffff70"], [0.55, "#ffff00"], [0.85, "#d9c800"], [1, "#a69400"]], "#6e6200", "#3b3300"] };
const SIN72 = Math.sin(0.4 * Math.PI);
/** A cost badge laid out as the font lays it (build_stoogedings cost_badge), px of its pill's height h (u: a font unit,
 *  h / 950) from the pill's left end and top: {u, icon {x, y, w, h, r} (the coin, the brick) or star {cx, cy, r}, num {x
 *  (origin), y (baseline), set}, word {x, y, set}, w (the pill)}; set: labelSet's (its sized: the number's capitals 440,
 *  10 between figures, the word's 540 and 26; a long number on the star shrunk to 0.88 of its radius). */
const costGeom = (c, h, set) => {
  const u = h / 950, word = set.sized(0.54, 0.026), ww = word.width(c.word);
  let num = set.sized(0.44, 0.010), nw = num.width(c.n), icon = null, star = null, nx, ny = 475 * u, w0;
  if (c.kind === "sp") {
    const k = Math.min(1, 528 * u / nw);
    if (k < 1) { num = set.sized(0.44 * k, 0.010 * k); nw = num.width(c.n); }
    star = { cx: (20 + 600 * SIN72) * u, cy: 435 * u, r: 600 * u };
    [nx, ny, w0] = [star.cx, ny - 4 * u, (1200 * SIN72 + 20) * u];   // its capitals' middle 36 below the star's centre
  } else {
    const coin = c.kind === "points", ih = (coin ? 830 : 700) * u, iw = Math.max(coin ? ih : 1060 * u, nw + (coin ? 380 : 400) * u);
    icon = { x: (coin ? 60 : 150) * u, y: (950 * u - ih) / 2, w: iw, h: ih, r: coin ? ih / 2 : 70 * u };
    [nx, w0] = [icon.x + iw / 2, icon.x + iw];
  }
  const [a, b] = num.ink(c.n), caps = num.caps, one = c.n[0] === "1" ? (c.n.length > 1 ? -0.15 / 5.7 : -0.3 / 7.8) * caps : 0;   // a 1 optically (_one_nudge)
  return { u, icon, star, w: w0 + 80 * u + ww + 210 * u, num: { x: nx - (a + b) / 2 + one, y: ny + caps / 2, set: num },
    word: { x: w0 + 80 * u, y: 475 * u + word.caps / 2, set: word } };
};
/** A badge's label as the font sets it in fam (Roboto Black, its capitals 1456 of 2048: capitals 0.54 em, 0.026 em
 *  between letters, no kerning) at em px: {width(t), ink(t): [left, right] of its origin, draw(t, x, y, how(ch, x, y)),
 *  font(px): the CSS font, caps: its capital height, sized(caps, track): the same at other capitals and spacing (ems)}. */
export const LABEL_FONT = "Roboto";                   // style.css's @font-face: MDW/Fonts/Roboto Black.ttf, weight 900
export function labelSet(ctx, fam, em) {
  const css = px => `900 ${px}px "${fam}"`;
  const sized = (capsEm, trackEm) => {
    const font = css(capsEm * 2048 / 1456 * em), track = trackEm * em;
    const adv = t => { ctx.font = font; ctx.textAlign = "left"; return [...t].map(c => ctx.measureText(c).width); };
    return {
      font, caps: capsEm * em,
      width: t => adv(t).reduce((a, v) => a + v, 0) + track * ([...t].length - 1),
      ink: t => {
        const cs = [...t], a = adv(t), f = ctx.measureText(cs[0]), l = ctx.measureText(cs[cs.length - 1]);
        return [-f.actualBoundingBoxLeft, a.slice(0, -1).reduce((x, v) => x + v + track, 0) + l.actualBoundingBoxRight];
      },
      draw: (t, x, y, how) => { const a = adv(t); [...t].forEach((c, i) => { how(c, x, y); x += a[i] + track; }); },
    };
  };
  return { ...sized(0.54, 0.026), font: css, sized };
}
const starPath = (cx, cy, r) => { const s = new Path2D(); for (let i = 0; i < 10; i++) { const a = (90 - 36 * i) * Math.PI / 180, rr = i % 2 ? r / 2 : r; s.lineTo(cx + rr * Math.cos(a), cy - rr * Math.sin(a)); } s.closePath(); return s; };
const roundPath = (x, y, w, h, r) => { const s = new Path2D(); s.roundRect(x, y, w, h, Math.max(0, r)); return s; };
/** A shape filled with an SVG objectBoundingBox gradient (x, y, w, h its box; radial: [cx, cy, r] of the box, else top to bottom). */
function boxFill(ctx, shape, [x, y, w, h], stops, radial = null) {
  ctx.save(); ctx.translate(x, y); ctx.scale(w, h);
  const g = radial ? ctx.createRadialGradient(radial[0], radial[1], 0, radial[0], radial[1], radial[2]) : ctx.createLinearGradient(0, 0, 0, 1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  const box = new Path2D(); box.addPath(shape, new DOMMatrix([1 / w, 0, 0, 1 / h, -x / w, -y / h]));   // the shape where it was
  ctx.fillStyle = g; ctx.fill(box); ctx.restore();
}
/** A cost badge (costGeom G, its pill from x0, top, h) as the font draws it; one ({fill, stroke, z}): as its salt glyph,
 *  in one colour, the outline stroke first: the pill's and the icon's outlines (68 units inside the icon's edge), the
 *  number and the word. */
function paintCost(ctx, G, c, x0, top, h, pill, one = null) {
  const { u } = G, [stops, edge, numColour] = COST_ART[c.kind], at = (dx, dy) => [x0 + dx, top + dy];
  const outer = G.star ? starPath(...at(G.star.cx, G.star.cy), G.star.r) : roundPath(...at(G.icon.x, G.icon.y), G.icon.w, G.icon.h, G.icon.r);
  const text = (part, t, how) => part.set.draw(t, x0 + part.x, top + part.y, how);
  if (one) {
    const t = 68 * u, ring = new Path2D(outer);
    ring.addPath(G.star ? starPath(...at(G.star.cx, G.star.cy), G.star.r - 74.8 * u)
      : roundPath(...at(G.icon.x + t, G.icon.y + t), G.icon.w - 2 * t, G.icon.h - 2 * t, Math.max(G.icon.r - t, 10 * u)));
    ctx.lineJoin = "round";
    if (one.stroke) {
      ctx.strokeStyle = rgb(one.stroke); ctx.lineWidth = Math.max(2, one.z * 0.21); pill(); ctx.stroke(); ctx.stroke(outer);
      ctx.lineWidth = Math.max(1.5, one.z * 0.16); ctx.font = G.num.set.font; text(G.num, c.n, (ch, a, b) => ctx.strokeText(ch, a, b));
      ctx.font = G.word.set.font; text(G.word, c.word, (ch, a, b) => ctx.strokeText(ch, a, b));
    }
    const lw = Math.max(1, h * 50 / 950);              // BADGE_LINE inside the pill, as the salt glyph
    ctx.fillStyle = ctx.strokeStyle = rgb(one.fill); pill(lw / 2); ctx.lineWidth = lw; ctx.stroke(); ctx.fill(ring, "evenodd");
    text(G.num, c.n, (ch, a, b) => ctx.fillText(ch, a, b)); text(G.word, c.word, (ch, a, b) => ctx.fillText(ch, a, b));
    return;
  }
  const [c0, c1, border] = PILL[c.kind];
  const bg = ctx.createLinearGradient(0, top, 0, top + h); bg.addColorStop(0, c0); bg.addColorStop(1, c1);
  pill(); ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 30 * u; ctx.strokeStyle = border; ctx.stroke();   // the pill's border under the icon
  if (G.star) {
    const { cx, cy, r } = G.star, inner = starPath(...at(cx, cy), r - 61.2 * u), box = [x0 + cx - SIN72 * (r - 61.2 * u), top + cy - (r - 61.2 * u), 2 * SIN72 * (r - 61.2 * u), (r - 61.2 * u) * (1 + Math.cos(Math.PI / 5))];
    ctx.fillStyle = edge; ctx.fill(outer); boxFill(ctx, inner, box, stops, [0.38, 0.3, 0.8]);
    ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.ellipse(x0 + cx - 0.24 * r, top + cy - 0.24 * r, 0.1 * r, 0.06 * r, 0, 0, 2 * Math.PI); ctx.fill();
  } else {
    const { x, y, w, h: ih, r } = G.icon, [X, Y] = at(x, y);
    boxFill(ctx, outer, [X, Y, w, ih], stops, c.kind === "points" ? [0.35, 0.3, 0.8] : null);
    ctx.lineWidth = 34 * u; ctx.strokeStyle = edge; ctx.stroke(outer);
    if (c.kind === "points") {
      ctx.lineWidth = 30 * u; ctx.strokeStyle = "#00c98a"; ctx.stroke(roundPath(X + 105 * u, Y + 105 * u, w - 210 * u, ih - 210 * u, r - 105 * u));
      ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.beginPath(); ctx.ellipse(X + 0.3 * ih, Y + 0.26 * ih, 0.13 * ih, 0.075 * ih, 0, 0, 2 * Math.PI); ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fill(roundPath(X + 70 * u, Y + 50 * u, w - 140 * u, 44 * u, 22 * u));
      ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fill(roundPath(X + 70 * u, Y + ih - 94 * u, w - 140 * u, 44 * u, 22 * u));
    }
  }
  ctx.font = G.num.set.font;
  if (c.kind === "bricks") { ctx.fillStyle = "rgba(61,26,8,.7)"; G.num.set.draw(c.n, x0 + G.num.x, top + G.num.y + 28 * u, (ch, a, b) => ctx.fillText(ch, a, b)); }
  ctx.fillStyle = numColour; text(G.num, c.n, (ch, a, b) => ctx.fillText(ch, a, b));
  ctx.fillStyle = COST_WORD[c.kind]; text(G.word, c.word, (ch, a, b) => ctx.fillText(ch, a, b));
}

// ---- cooldown rings, as the font draws them (build_stoogedings ring_parts; text.js ringParts, the same shapes): the
// pill's left end, all of it inside the pill
export const RING_W = 810 / 950;                      // build_stoogedings RING_D + RING_GAP - BADGE_PAD over the pill's height: the width it adds
/** A cooldown's ring ({cap, start}: text.js cooldownOf; group: its badge's) centred at cx, cy, u px a unit of its 22-unit
 *  box (the pill's height over 22), over the pill's left end. one ({fill, stroke, width}: [r, g, b], stroke may be null,
 *  width its px): the salt glyph, all in fill (outlined in stroke first) inside the pill's outline (paintLines draws it),
 *  no body or rim. */
export function drawRing(ctx, ring, group, cx, cy, u, one = null) {
  const { parts, number, colour } = ringParts(ring, !!one);
  const shapes = [...parts.map(([p, d]) => [p, new Path2D(d)]), ...number.map(([d, x, y, k]) => { const m = new Path2D(); m.addPath(new Path2D(d), new DOMMatrix([k, 0, 0, k, x, y])); return ["number", m]; })];
  ctx.save(); ctx.translate(cx - 11 * u, cy - 11 * u); ctx.scale(u, u);
  if (one) {
    for (const [c, extra] of [[one.stroke, (one.width || 0) / u], [one.fill, 0]]) {
      if (!c) continue;
      ctx.fillStyle = ctx.strokeStyle = rgb(c); ctx.lineWidth = extra; ctx.lineJoin = "round";
      for (const [, s] of shapes) { ctx.fill(s); if (extra) ctx.stroke(s); }
    }
  } else {
    ctx.fillStyle = RING_PAINT.body; ctx.beginPath(); ctx.arc(11, 11, 10.45, 0, 2 * Math.PI); ctx.fill();   // no glow (owner 2026-11-04)
    const [r0, r1] = RING_PAINT.rim[group] || [RING_PAINT.hollow, RING_PAINT.hollow], rim = ctx.createLinearGradient(0, 0, 0, 22);   // shaded over the pill's height
    rim.addColorStop(0, r0); rim.addColorStop(1, r1);
    ctx.strokeStyle = rim; ctx.lineWidth = 0.75; ctx.beginPath(); ctx.arc(11, 11, 10.275, 0, 2 * Math.PI); ctx.stroke();
    for (const [p, s] of shapes) { ctx.fillStyle = p === "number" ? colour : RING_PAINT[p]; ctx.fill(s); }
  }
  ctx.restore();
}
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
/** Point text as the bake sets it: each paragraph one line at `size`, smaller by 0.94 down to 40% while a line is wider
 *  than `reach` (off the card's sides: psd_edit fit_below). */
export function pointLayout(paras, size, reach, measure) {
  let s = size, lines = layout(paras, Infinity, s, measure);
  while (Math.max(...lines.map(l => l.w)) > reach && s > size * 0.4) { s *= 0.94; lines = layout(paras, Infinity, s, measure); }
  return { size: s, lines };
}
/** A title as the bake sets it (psd_edit set_text_layer): never shrunk; point text keeps its lines, a box's (more lines
 *  found than the old text's n0 paragraphs) wraps at maxW. over: more lines than it has; dx: back on the card (back_on). */
export function titleLayout(paras, n0, found, maxW, size, measure, W) {
  const lines = layout(paras, found.lines.length > n0 ? maxW : Infinity, size, measure);
  const w = Math.max(0, ...lines.map(l => l.w)), x0 = (found.box[0] + found.box[2] - w) / 2;
  return { size, lines, over: lines.length > Math.max(1, found.lines.length, paras.length), dx: w > W ? 0 : clamp(x0, 0, W - w) - x0 };
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
/** A template stat row moved to its label's height (the record's visible "Health", "Defense"... text layer), if a bar is
 *  there and not a quarter cell aside (cells of another size), else null. */
export function labelRow(L, W, H, rec, row) {
  const k = rec?.canvas?.w > 0 ? W / rec.canvas.w : 0;
  const t = k && Array.isArray(rec.text) ? rec.text.find(x => x && x.visible !== false && Array.isArray(x.box) && STAT_NAME[row.k].test(String(x.text || "").trim())) : null;
  if (!t) return null;
  const mid = (t.box[1] + t.box[3]) / 2 * k, half = (row.box[3] - row.box[1]) / 2, q = (row.box[2] - row.box[0]) / row.cells / 4;
  const at = d => [row.box[0] + d, mid - half, row.box[2] + d, mid + half];
  return isBar(L, W, H, at(0)) && !isBar(L, W, H, at(-q)) && !isBar(L, W, H, at(q)) ? { ...row, box: at(0) } : null;
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
  const out = { name: null, ability: null, stats: {}, stars: null, types: null, skipped: [], colors: null };
  const text = s => String(s ?? "").replace(/\r/g, "").trim();
  if ("name" in edit && text(edit.name) !== text(psd.name)) out.name = text(edit.name);
  if ("ability" in edit && text(edit.ability) !== text(psd.ability)) out.ability = text(edit.ability);
  for (const k of STATS) if (k in edit && edit[k] !== psd[k]) {
    if (edit[k] == null || psd[k] == null || edit[k] > 10 || psd[k] > 10) out.skipped.push(k.toUpperCase());
    else out.stats[k] = [psd[k], edit[k]];
  }
  if ("stars" in edit && edit.stars != null && edit.stars !== psd.stars) out.stars = [psd.stars ?? 0, edit.stars];
  if ("types" in edit && JSON.stringify([...(edit.types || [])].map(norm).sort()) !== JSON.stringify([...(psd.types || [])].map(norm).sort())) out.types = [[...(psd.types || [])], [...(edit.types || [])]];
  const of = (list, f) => JSON.stringify((list || []).filter(one => one.field === f));
  for (const f of ["name", "ability"]) if ("colors" in edit && of(edit.colors, f) !== of(psd.colors, f)) {   // a colour redraws its text
    out[f] ??= text(edit[f] ?? psd[f]) || null; out.colors = edit.colors;
  }
  return out;
}

const STAT_NAME = { hp: /^(hp|health)$/i, def: /^(def|defen[cs]e|defemse)$/i, atk: /^(atk|attack)$/i, spd: /^(spd|speed)$/i };   // psd_regions.STATS
/** Whether the record's stat bar is a layer-comp smart object (the Alt template's Stats Bars/Darks/Health): it bakes to 20. */
export const compBar = (rec, k) => Array.isArray(rec?.smart_objects) && rec.smart_objects.some(p => {
  const path = String(p).split("/"), own = path.pop().trim();
  return STAT_NAME[k].test(own) && path.some(g => /dark|bars/i.test(g)); });
/** Why a stat at `to` stays on the website (psd_edit.classify's site reasons; old bars), or null: it bakes, or the record
 *  can't tell (several rows: Top and Bottom rows bake to 20, several creatures' rows don't). */
export function statSite(rec, k, to) {
  const kind = rec?.stats?.[k];
  if (!(to > 10) || typeof kind !== "string" || !Array.isArray(rec.smart_objects) || compBar(rec, k)) return null;
  if (kind === "two-row") return to > 20 ? "the card's bars print up to 20" : null;
  return `the card's ${kind === "template" ? "old-style " : ""}bars print up to 10`;
}

/** The boxes to redraw from per-layer edits (PARTS_EDITOR.md §5; parts: Card Edits.json's, by layer id): [{id, role (name |
 *  ability), old, text (null: the layer is deleted), box (canvas px), added, colors}] for the record's parts whose edit
 *  differs from the layer's text, or whose letters `colors` paints otherwise than `was` (the image's); an added ability
 *  goes in the template's Ability box. colors: each part's share of the field's (textcolor.js layerColors over the
 *  field's layers as the bake leaves them, picture 1's, in reading order). */
export function partJobs(rec, parts, { colors = null, was = null, statuses = null } = {}) {
  const p = obj(rec?.parts);
  if (!p || !obj(parts)) return [];
  const list = [...(p.title || []).map(x => ["name", x]), ...(p.ability || []).map(x => ["ability", x]), ...(p.blocks || []).map(x => ["ability", x])];
  const add = obj(parts["+ability"]), tb = rec?.template?.ability?.box, plus = add?.text && !(p.ability || []).length ? { id: "+ability" } : null;
  const textOf = part => { const e = obj(parts[String(part?.id)]); return e ? (e.delete ? null : String(e.text ?? "")) : part?.text; };
  const layers = { name: [], ability: plus ? [plus] : [] };
  for (const [role, part] of list) if (textOf(part) != null && !(Array.isArray(part?.variants) && !part.variants.includes(1))) layers[role].push(part);
  const share = (role, part, v) => { const i = layers[role].indexOf(part); return v && i >= 0 ? layerColors(layers[role].map(textOf), i, v, role) : null; };
  const out = [];
  for (const [role, part] of list) {
    const text = textOf(part), mine = share(role, part, colors), theirs = share(role, part, was);
    const recolour = text != null && text === part?.text && JSON.stringify(colorRanges(text, mine, role, statuses)) !== JSON.stringify(colorRanges(text, theirs, role, statuses));
    if ((obj(parts[String(part?.id)]) && text !== part.text) || recolour) out.push({ id: String(part.id), role, old: String(part.text ?? ""), text, box: Array.isArray(part.box) ? part.box : null, added: false, layer: String(part.layer || ""), colors: mine });
  }
  if (plus) out.push({ id: "+ability", role: "ability", old: "", text: String(add.text), box: Array.isArray(tb) ? tb : null, added: true, colors: share("ability", plus, colors) });
  return out;
}

/** A field's record parts that picture 1 prints: the title's, or the Ability's and blocks'. */
const printed = (p, f) => (f === "name" ? p.title || [] : [...(p.ability || []), ...(p.blocks || [])]).filter(x => !(Array.isArray(x?.variants) && !x.variants.includes(1)));

/** The colours the bake refuses as painted over (AutoCroissant psd_edit plan_colors, _painted_over, _solid_overlay):
 *  [{one, label, why}]. Refused when an enabled Color, Gradient or Pattern Overlay, the part's own or a group's above it,
 *  hides every title or Ability part the colour paints (layerColors). A part's own isn't counted for a whole field's
 *  colour or a phrase on a field that has one (it goes off), a phrase that is all of the part's text (_whole_span) or
 *  one after it, nor a lone Color Overlay under a phrase. The record has no opacity, blend mode or fill. typed: the
 *  fields `edit` retypes; their colours are checked in the new text (a box's own, a one-layer field's), as plan_colors
 *  does. */
export function paintedOver(rec, colors, typed = [], edit = null) {
  const p = obj(rec?.parts), fx = obj(rec?.effects) || {}, out = [];
  if (!p || !Array.isArray(colors)) return out;
  const on = path => (Array.isArray(fx[path]) ? fx[path] : []).filter(n => OVERLAY.test(String(n))).map(n => n.replace("Overlay", " Overlay"));
  const lit = new Set(colors.filter(one => !one?.phrase).map(one => one?.field)), done = new Set();   // done: parts a phrase took whole
  const blank = s => !s.replace(/\u0003/g, " ").trim();
  const whole = (t, c) => (spansOf(String(t ?? ""), c) || []).some(([a, b]) => blank(String(t).slice(0, a)) && blank(String(t).slice(b)));
  const textOf = (x, f, n) => {                       // retyped: its box's new text ("" deleted), a lone layer's the field's
    if (!typed.includes(f)) return x?.text;
    const b = obj(obj(edit?.parts)?.[String(x?.id)]);
    return b ? (b.delete ? "" : String(b.text ?? "")) : n === 1 ? String(edit?.[f] ?? x?.text ?? "") : x?.text;
  };
  for (const one of colors) {
    const f = one?.field, what = f === "name" ? "title" : "ability";
    if (f !== "name" && f !== "ability") continue;
    const list = printed(p, f), texts = list.map(x => textOf(x, f, list.length));
    const mine = list.map((x, i) => [x, layerColors(texts, i, [one], f), texts[i]]).filter(([, c]) => c);
    const full = one.phrase ? mine.filter(([, c, t]) => whole(t, c[0])).map(([x]) => x) : [];
    const hid = mine.map(([x]) => {
      const path = String(x?.layer || "").split("/"), own = on(path.join("/"));
      if (own.length && one.phrase && !lit.has(f) && !done.has(x) && !full.includes(x) && !(own.length === 1 && own[0] === "Color Overlay")) return `its ${own[0]}`;
      for (let i = path.length - 1; i > 0; i--) { const e = on(path.slice(0, i).join("/")); if (e.length) return `its group '${path[i - 1]}''s ${e[0]}`; }
      return null;
    });
    if (hid.length && hid.every(Boolean)) out.push({ one, label: one.phrase ? `colour of ${phraseText(one.phrase)}` : `${f === "name" ? "title" : "Ability"}'s colour`,
      why: `${hid.sort()[0]} paints over the ${what}'s colours: recolour it in Photoshop` });
    else for (const x of full) done.add(x);              // its own overlays go off (set_colors)
  }
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
 *  up with or no spots for the count: boxed. first: the template's spot (canvas px) when the card has no type icon; one
 *  new icon goes there. */
export function typePlan(types, old, now, first = null) {
  const ty = obj(types), row = Array.isArray(ty?.row) ? ty.row : [];
  if (!ty && first && now.length === 1) return { erase: [], draw: [{ name: now[0], core: first }], refused: null, boxed: false };
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
export function oneColour(rec, path, kind = OVERLAY) {
  const fx = rec?.effects && typeof rec.effects === "object" ? rec.effects : {}, parts = String(path || "").split("/");
  return !!path && parts.some((_, i) => { const e = fx[parts.slice(0, i + 1).join("/")]; return Array.isArray(e) && e.some(n => kind.test(String(n))); });
}
/** The same for an enabled Gradient Overlay: the letters are drawn in the old ones' shades (erase's profile). */
export const gradientOn = (rec, path) => oneColour(rec, path, /^GradientOverlay$/);
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const hexRgb = h => (/^#[0-9a-f]{6}$/i.test(h || "") ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null);
/** A record text layer's main fill [r, g, b]: the colour most of its letters are in (build_site layer_inks' main ink,
 *  which cards.json `ink` leaves out), however few; null without one, or under an enabled overlay (oneColour). */
export function mainInk(rec, t) {
  if (!t?.layer || oneColour(rec, t.layer)) return null;
  const cs = Array.isArray(t.colors) && t.colors.length ? t.colors : [t.color], text = String(t.text ?? "");
  if (!Array.isArray(t.runs) || !t.runs.length) return cs.length === 1 ? hexRgb(cs[0]) : null;
  const n = new Map();
  for (const [a, b, i] of t.runs) for (let x = a; x < b; x++) if (text[x] && !/\s/.test(text[x])) n.set(cs[i], (n.get(cs[i]) || 0) + 1);
  const best = [...n].sort((x, y) => y[1] - x[1])[0];
  return (best && hexRgb(best[0])) || null;
}

// ---- drawing (canvas; the browser)
const fontFaces = new Map();                          // font name -> Promise<family | "">
let fontsP = null;                                    // data/fonts.json
/** The family to draw a PSD font in: a FontFace from MDW/Fonts when data/fonts.json maps it (loaded once), else "".
 *  Its WOFF2 copy on the site first, the TTF/OTF from raw when that copy fails (fontSrc). */
/** The badges' letters: LABEL_FONT's family once style.css's @font-face for it has loaded, else "". */
let labelP = null;
export function labelFont() {
  if (typeof document === "undefined" || !document.fonts?.load) return Promise.resolve("");
  return (labelP ||= document.fonts.load(`900 16px "${LABEL_FONT}"`, "0").then(f => (f.length ? LABEL_FONT : ""), () => ""));
}
export function loadFont(name, { getFonts, raw }) {
  if (!name || typeof FontFace === "undefined") return Promise.resolve("");
  if (!fontFaces.has(name)) {
    fontsP ||= getFonts().then(d => (d && typeof d.fonts === "object" ? d.fonts : {}), () => ({}));
    fontFaces.set(name, fontsP.then(async map => {
      const f = map[name];
      if (!f || typeof f.file !== "string") return "";
      const family = `mk-${norm(name).slice(0, 40) || "font"}`;
      const face = new FontFace(family, fontSrc(f, raw));
      await face.load(); document.fonts.add(face);
      return family;
    }).catch(() => ""));
  }
  return fontFaces.get(name);
}
/** A FontFace source list: the build's WOFF2 copy (f.woff2, relative to the page), then the file on raw. */
export function fontSrc(f, raw, base = typeof document !== "undefined" ? document.baseURI : undefined) {
  const own = `url("${raw}${f.file.split("/").map(encodeURIComponent).join("/")}")`;
  return typeof f.woff2 === "string" && base ? `url("${new URL(f.woff2, base).href}") format("woff2"), ${own}` : own;
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
 *  again), stale (a newer draw started: drop this one), fills (colourize's)}. Drawn off-screen, then copied. Returns
 *  {drawn: [labels], skipped, boxed: [labels drawn in a box], over: [labels too long for their place, at 40%], refused:
 *  [[label, why]] (stars, types or colours the bake would refuse), fonts: {name: family | ""}, standIn: [labels without
 *  a font name], shape} or null (the image didn't load, or stale). */
export async function draw(canvas, { card, src, rec, edit, psd, icons, getFonts, raw, onFont, statuses = null, fills = null, stale = () => false }) {
  const img = await loadImage(src);
  if (!img || stale()) return null;
  const W = img.naturalWidth, H = img.naturalHeight, shape = shapeOf(W, H), tpl = TEMPLATES[shape];
  const work = document.createElement("canvas"); work.width = W; work.height = H;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const txt = s => String(s ?? "").replace(/\r/g, "").trim(), typed = ["name", "ability"].filter(f => (f in edit && txt(edit[f]) !== txt(psd[f])) || partJobs(rec, edit.parts).some(j => j.role === f));
  const nix = paintedOver(rec, edit.colors, typed, edit);   // the bake refuses them: not drawn, said
  if (nix.length) edit = { ...edit, colors: edit.colors.filter(one => !nix.some(n => n.one === one)) };
  const todo = changes(edit, psd), out = { drawn: [], skipped: [], boxed: [], over: [], refused: nix.map(n => [n.label, n.why]), fonts: {}, standIn: [], shape, site: [], starsKept: null };
  for (const label of todo.skipped) {                 // a stat past what its bar prints stays on the website
    const k = label.toLowerCase(), why = statSite(rec, k, edit[k]);
    if (why) out.site.push([`${label} ${edit[k]}`, why]);
    else if (compBar(rec, k) && psd[k] >= 1 && psd[k] <= 10 && edit[k] > 10 && edit[k] <= 20) todo.stats[k] = [psd[k], edit[k]];   // its comps' two half rows; from 0: no lit cell to copy
    else out.skipped.push(label);
  }
  if (todo.name != null && titleInPicture(rec)) { out.site.push(["name", "title"]); todo.name = null; }   // the dialog's note
  const kept = todo.stars && starsKept(rec?.header?.stars, todo.stars[1]), moved = kept && starMove(card?.psd, todo.stars[1]);
  if (kept) { if (moved) out.starsKept = { why: kept, to: moved.to }; else out.refused.push(["stars", kept]); todo.stars = null; }   // the picture's stay
  const blit = () => { if (stale()) return null; canvas.width = W; canvas.height = H; canvas.getContext("2d").drawImage(work, 0, 0); return out; };
  if (!tpl) { out.skipped.push(...[todo.name != null && "name", todo.ability != null && "text", ...Object.keys(todo.stats).map(k => k.toUpperCase()), todo.stars && "stars", todo.types && "types"].filter(Boolean)); return blit(); }
  const pixels = ctx.getImageData(0, 0, W, H), L = luma(pixels.data);
  const family = async (role, label, path = "", id = "") => {   // path, id: a part's own layer (a split title's share a path)
    const mine = t => t && (id && t.id != null ? String(t.id) === id : t.layer === path) && !ICON_FONT.test(String(t.font || ""));
    const own = path && Array.isArray(rec?.text) ? rec.text.find(mine) : null;
    const layer = own || layerOf(rec, role), name = layer?.font || "";
    const pending = name ? loadFont(name, { getFonts, raw }) : Promise.resolve("");
    let fam = "";
    const ready = await Promise.race([pending, new Promise(r => setTimeout(() => r(null), 60))]);   // a loaded font draws at once
    if (ready === null) pending.then(f => { if (f) onFont?.(); }); else fam = ready;
    if (name) out.fonts[name] = fam; else out.standIn.push(label);
    return { fam: fam ? `"${fam}", ${STAND_IN}` : STAND_IN, layer };
  };
  const badgeFont = labelFont();
  let bfam = await Promise.race([badgeFont, new Promise(r => setTimeout(() => r(null), 60))]);
  if (bfam === null) { badgeFont.then(f => { if (f) onFont?.(); }); bfam = ""; }
  const scaled = b => b.map((v, i) => v * (i % 2 ? H : W));
  const bars = barRows(shape, W, H, card, rec).map(r => (isBar(L, W, H, r.box) ? r : labelRow(L, W, H, rec, r))).filter(Boolean);   // the rows drawn on: the template's, else beside the stat's label
  const rows = barRows(shape, W, H, card, null), seen = rows.filter(r => isBar(L, W, H, r.box)), lowest = seen.length ? seen : rows;
  const barsBottom = lowest.length ? Math.max(...lowest.map(r => r.box[3])) : 0;   // the text starts below the card's stat rows (where they are seen, else the template's)
  const jobs = [], kc = rec?.canvas?.w > 0 ? W / rec.canvas.w : 0;
  const specs = [["name", todo.name, psd.name, "name"], ["ability", todo.ability, psd.ability, "text"]].filter(x => x[1] != null).map(([role, text, old, label]) => ({ role, text, old, label }));
  const boxes = obj(edit.parts), tinted = !boxes && obj(rec?.parts) ? specs.filter(s => txt(s.text) === txt(s.old) && printed(rec.parts, s.role).length > 1).map(s => s.role) : [];   // a colour alone on a field of several layers
  const partly = partJobs(rec, boxes || (tinted.length ? {} : null), { colors: todo.colors, was: todo.colors && psd.colors, statuses }).filter(j => boxes || tinted.includes(j.role));
  if (obj(rec?.parts) && boxes) specs.length = 0;   // one box per layer: each changed layer in its own box, not the joined fields
  else specs.splice(0, specs.length, ...specs.filter(s => !tinted.includes(s.role)));   // each of its layers recoloured in its own box
  for (const j of partly) specs.push({ role: j.role, text: j.text, old: j.old, label: j.role === "name" ? "name" : "text", own: j.box && kc ? j.box.map(v => v * kc) : null, added: j.added, part: true, path: j.layer, id: j.added ? "" : j.id, colors: j.colors });
  for (const { role, text, old, label, own: partBox, added, part, path, id, colors: shared } of specs) {
    const { fam, layer } = await family(role, label, path, id);
    const set = role === "ability" ? layer : null, track = Number.isFinite(set?.track) ? set.track / 1000 : 0, hx = set?.hx > 0 ? set.hx : 1;   // the Ability's tracking (ems) and letter width (psd_details)
    const measure = (t, z) => {
      ctx.font = `${z}px ${fam}`;
      if (!track) return ctx.measureText(t).width * hx;
      ctx.letterSpacing = `${track * z}px`; const w = ctx.measureText(t).width * hx; ctx.letterSpacing = "0px"; return w;
    };
    measure.track = track; measure.hx = hx;
    measure.cap = z => capOf(ctx, fam, z);
    measure.label = bfam ? em => labelSet(ctx, bfam, em) : null;   // badges' labels: the font's (Roboto Black), once loaded
    const own = partBox || (part ? null : recordBox(rec, layer?.layer, W)), one = role === "ability" && oneColour(rec, layer?.layer);
    const area = own ? { box: own, seed: [own[1], own[3]] } : role === "name" ? { box: scaled(tpl.name), seed: null } : textArea(shape, W, H, barsBottom);
    const colors = part ? shared : todo.colors;  // one box per layer: its share of the field's
    const ink = text == null || added ? null : baseInk(card, role, text, part ? old : null);    // the card's own colours on what is unchanged
    if (added) { jobs.push({ role, text, label, area: { box: own || area.box, seed: null }, fam, layer, measure, icons, one, colors, statuses, boxed: true }); out.boxed.push(label); continue; }
    const paras = tokenize(old, icons);
    const wrap = kc && set?.px > 0 && Array.isArray(set.frame) && set.frame.length === 4 ? (set.frame[2] - set.frame[0]) * kc : 0;   // box text's frame width
    const atSet = role === "name" && kc && layer?.px > 0 ? bestBlock(L, W, H, area, paras, measure, { name: true, wide: true, px: layer.px * kc, joins: [1.2, 4] }) : null;   // a title at the record's set size first
    const hit = atSet || bestBlock(L, W, H, area, paras, measure, { name: role === "name" })   // the block that holds the old text, or none
      || (wrap ? bestBlock(L, W, H, area, paras, measure, { px: set.px * kc, wrap }) : null);   // tight leading: at the record's set size
    if (hit) {
      const { b, cal, edge } = hit, z = cal.size;
      const strayTop = seen.length ? Math.min(area.box[1], barsBottom + 0.004 * H) : own ? area.box[1] : (TEMPLATES[shape].ability[1] - 0.06) * H;   // stat rows not seen where the template has them: look higher
      const { found, strays } = part && own && role === "ability" ? layerBlock(L, W, H, b, own, z, rows) : { found: b, strays: [] };   // one layer: its lines in its own box
      const gone = role === "name" ? b.lines : part ? [...eraseLines(b), ...strays] : [...eraseLines(b), ...strayLines(L, W, H, b, { top: strayTop, bottom: H, bars: rows })];   // a name or one layer: its own lines
      const all = [Math.min(...gone.map(l => l[0])) - z, Math.min(...gone.map(l => l[1])) - z * 0.5, Math.max(...gone.map(l => l[2])) + z, Math.max(...gone.map(l => l[3])) + z * 0.5];
      const colours = erase(pixels.data, W, H, all, { lines: gone, close: Math.round(z * 1.2), reach: Math.max(2, Math.round(z * 0.14)), cell: Math.max(6, z * 0.8), edge: 25, fill: mainInk(rec, layer), profile: gradientOn(rec, layer?.layer) });   // in the lines only: dim words too
      if (text == null) { out.drawn.push(`${label} (layer deleted)`); continue; }   // a deleted layer: erased only
      jobs.push({ role, text, old, label, area, found, size: z, colours, fam, layer, measure, icons, one, colors, statuses, ink, kc });
    } else if (text == null) out.skipped.push(`${label} (deleted layer)`);
    else if (own && kc && layer?.px > 0 && (part || printed(obj(rec.parts) || {}, role).some(p => p?.layer === layer.layer))) {   // not found: at the record's box, size and frame (a whole field's: its printed layer)
      const z = layer.px * kc, found = recordBlock(own, paras, measure, z, wrap, wrap ? layer.frame.map(v => v * kc) : null);
      const colours = erase(pixels.data, W, H, [own[0] - z, own[1] - z * 0.5, own[2] + z, own[3] + z * 0.5], { lines: found.lines, close: Math.round(z * 1.2), reach: Math.max(2, Math.round(z * 0.14)), cell: Math.max(6, z * 0.8), edge: 25, fill: mainInk(rec, layer), profile: gradientOn(rec, layer?.layer) });
      jobs.push({ role, text, old, label, area, found, size: z, colours, fam, layer, measure, icons, one, colors, statuses, ink, kc });
    } else { jobs.push({ role, text, label, area: part || role === "name" ? { box: area.box, seed: null } : area, fam, layer, measure, icons, one, colors, statuses, ink, boxed: true }); out.boxed.push(label); }   // a layer's or the title's box: covered, never the card below it
  }
  const shown = { ...psd };                            // the values the rows show as they are redrawn
  for (const [k, [from, to]] of Object.entries(todo.stats)) {
    const row = bars.find(r => r.k === k);
    if (!row) { out.skipped.push(k.toUpperCase()); continue; }
    const lit = from === 0 && to <= row.cells ? bars.filter(r => r !== row && shown[r.k] >= 1 && shown[r.k] <= r.cells).sort((a, b) => Math.abs(a.box[1] - row.box[1]) - Math.abs(b.box[1] - row.box[1])).map(r => ({ row: r, v: shown[r.k] })) : [];
    if (lit.length) paintLit(pixels.data, W, H, row, lit, to);   // no lit cell on the row: another row's
    else (to > row.cells ? paintComp : paintCells)(pixels.data, W, H, row, from, to);
    shown[k] = to; out.drawn.push(k.toUpperCase());
  }
  const head = obj(rec?.header), k = rec?.canvas?.w > 0 ? W / rec.canvas.w : 0, at = b => b.map(v => v * k);
  const icons2 = [];                                  // [label, plan] for the stars and types
  if (todo.stars) icons2.push(["stars", k ? starPlan(head?.stars, ...todo.stars) : { boxed: true, refused: null }]);
  const first = head?.types === null && tpl.first ? scaled(tpl.first).map(v => v / k) : null;   // no type icon on the card
  if (todo.types) icons2.push(["types", k ? typePlan(head?.types, ...todo.types, first) : { boxed: true, refused: null }]);
  for (const [, plan] of icons2) if (!plan.boxed) for (const b of plan.erase) { const g = at(b); fillBox(pixels.data, W, H, [g[0] - 2, g[1] - 2, g[2] + 2, g[3] + 2], { pad: Math.max(2, Math.round(W * 0.004)) }); }
  ctx.putImageData(pixels, 0, 0);
  for (const [label, plan] of icons2) {
    if (plan.refused) out.refused.push([label, plan.refused]);
    if (plan.boxed && !(label === "stars" ? +todo.stars[1] : todo.types[1]?.length)) { out.skipped.push(label); continue; }   // none, with no place: the old ones stay
    if (plan.boxed) { out.boxed.push(label); await drawIconBox(ctx, label, label === "stars" ? todo.stars[1] : todo.types[1], { icons, head, W, H, tpl }); }
    else if (label === "stars") { const src = await starSource(head.stars, icons, img, k); for (const b of plan.draw) drawIcon(ctx, src, at(b)); }
    else {
      const look = plan.draw.length ? await iconLook(img, head?.types?.row, icons, k) : null;   // the bake copies a shown icon's look
      for (const d of plan.draw) { const im = await iconOf(icons, d.name); drawIcon(ctx, look && im ? recolour(im, look, at(d.core)) : im, at(d.core)); }
    }
    out.drawn.push(label);
  }
  for (const job of jobs) {
    const imgs = await iconImages(job.text, icons);
    const j = { ...job, fills: job.one ? null : fills };   // under an overlay: painted over, as the bake's
    if (j.boxed ? drawBox(ctx, j, imgs, W, H, shape) : drawText(ctx, j, imgs, W)) out.over.push(j.label);
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
/** A w x h canvas's context with an image's (sx, sy, sw, sh) drawn over it. */
function drawn(im, sx, sy, sw, sh, w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, sx, sy, sw, sh, 0, 0, w, h);
  return g;
}
/** The card's own colours on its type icons (fitLook), or null: each shown icon's stock picture fitted into its core,
 *  against the image there. */
async function iconLook(img, row, icons, k) {
  const pairs = [];
  for (const u of Array.isArray(row) ? row : []) {
    const im = await iconOf(icons, u.name), sw = im?.naturalWidth, sh = im?.naturalHeight;
    if (!sw || !sh || !Array.isArray(u.core)) continue;
    const b = u.core.map(v => v * k), s = Math.min((b[2] - b[0]) / sw, (b[3] - b[1]) / sh), w = Math.round(sw * s), h = Math.round(sh * s);
    const x = Math.round(b[0] + (b[2] - b[0] - w) / 2), y = Math.round(b[1] + (b[3] - b[1] - h) / 2);
    const x0 = Math.max(0, x), y0 = Math.max(0, y), cw = Math.min(img.naturalWidth, x + w) - x0, ch = Math.min(img.naturalHeight, y + h) - y0;
    if (w < 4 || h < 4 || cw < 1 || ch < 1) continue;
    pairs.push([drawn(im, 0, 0, sw, sh, w, h).getImageData(x0 - x, y0 - y, cw, ch).data, drawn(img, x0, y0, cw, ch, cw, ch).getImageData(0, 0, cw, ch).data]);   // its part on the card
  }
  return fitLook(pairs);
}
/** A recolouring from pairs [[stock, shown]] of RGBA arrays, on the stock's opaque pixels: luma -> colour (a Gradient
 *  Map, a Color Fill) or each channel -> itself (Curves, Levels, Exposure), 16 bins each, the closer one. Only when the
 *  shown pixels are far from the stock's (mean over 36 levels) and the map reads them within half of that and under
 *  25 levels; else null (stock colours, or the icon's own art). */
export function fitLook(pairs) {
  const lum = Array.from({ length: 16 }, () => [0, 0, 0, 0]), chan = [0, 1, 2].map(() => Array.from({ length: 16 }, () => [0, 0]));
  const each = fn => { for (const [st, th] of pairs) for (let i = 0; i < st.length; i += 4) if (st[i + 3] >= 245) fn(st, th, i); };
  let off = 0, n = 0;
  each((st, th, i) => {
    const q = Math.min(15, (0.299 * st[i] + 0.587 * st[i + 1] + 0.114 * st[i + 2]) >> 4);
    for (let ch = 0; ch < 3; ch++) { lum[q][ch] += th[i + ch]; const e = chan[ch][st[i + ch] >> 4]; e[0] += th[i + ch]; e[1]++; }
    lum[q][3]++; off += (Math.abs(th[i] - st[i]) + Math.abs(th[i + 1] - st[i + 1]) + Math.abs(th[i + 2] - st[i + 2])) / 3; n++;
  });
  if (n < 50) return null;
  off /= n;
  const mid = q => q * 16 + 8;
  const fill = bins => bins.map((v, q) => {          // empty bins: between filled ones blended, past them the nearest's offset
    if (v) return v;
    let a = q - 1, z = q + 1; while (a >= 0 && !bins[a]) a--; while (z < 16 && !bins[z]) z++;
    if (a >= 0 && z < 16) return bins[a].map((x, i) => x + (bins[z][i] - x) * (q - a) / (z - a));
    const j = a >= 0 ? a : z; return bins[j].map(x => Math.max(0, Math.min(255, x + mid(q) - mid(j))));
  });
  const looks = [{ luma: fill(lum.map(([r, g, b, m]) => (m ? [r / m, g / m, b / m] : null))) },
    { chan: [0, 1, 2].map(ch => fill(chan[ch].map(([t, m]) => (m ? [t / m] : null))).map(v => v[0])) }];
  const err = look => { let e = 0; each((st, th, i) => { const o = lookMap(look, st[i], st[i + 1], st[i + 2]); e += (Math.abs(o[0] - th[i]) + Math.abs(o[1] - th[i + 1]) + Math.abs(o[2] - th[i + 2])) / 3; }); return e / n; };
  const [best] = looks.map(look => ({ look, e: err(look) })).sort((x, y) => x.e - y.e);
  return off > 36 && best.e * 2 <= off && best.e < 25 ? best.look : null;
}
/** A colour through a look (fitLook's), between bin centres. */
export function lookMap(look, r, g, b) {
  const at = (bins, v) => { const f = Math.max(0, Math.min(15, (v - 8) / 16)), q = Math.min(14, Math.floor(f)); return [bins[q], bins[q + 1], f - q]; };
  if (look.luma) { const [x, y, t] = at(look.luma, 0.299 * r + 0.587 * g + 0.114 * b); return x.map((v, i) => v + (y[i] - v) * t); }
  return [r, g, b].map((v, ch) => { const [x, y, t] = at(look.chan[ch], v); return x + (y - x) * t; });
}
/** A stock icon through a look, at box's size: {img, crop} for drawIcon. */
function recolour(im, look, box) {
  const sw = im.naturalWidth, sh = im.naturalHeight, s = Math.min((box[2] - box[0]) / sw, (box[3] - box[1]) / sh);
  const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
  const g = drawn(im, 0, 0, sw, sh, w, h), d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) d.data.set(lookMap(look, d.data[i], d.data[i + 1], d.data[i + 2]), i);
  g.putImageData(d, 0, 0);
  return { img: g.canvas, crop: [0, 0, w, h] };
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
/** A vertical gradient of shades (shadesOf, canvas px) for letters drawn translated to y. */
function shaded(ctx, { stops, top, bottom }, y) {
  const g = ctx.createLinearGradient(0, top - y, 0, bottom - y);
  for (const [t, c] of stops) g.addColorStop(t, rgb(c));
  return g;
}
/** Lines of pieces from x at baseline base, z px: text with an outline, icons, badges as pills (a cooldown's ring its
 *  left end). one (an overlay on the ability): badges as outlined pills, rings in one colour and stickers as an outline
 *  round the one-colour icon, in the text's fill. shades (a Gradient Overlay's, shadesOf): letters without a colour in them. */
function paintLines(ctx, lines, { at, base, pitch, z, fam, label = null, fill, stroke, imgs, one = false, track = 0, hx = 1, shades = null }) {
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
        const fitted = badgeFit(z, capOf(ctx, fam, z)), h = fitted.h, k = fitted.k, top = y - fitted.top, r = h / 2, em = h / PILL_EM;
        const lab = label ? label(em) : null, set = p.cost ? null : lab, side = lab ? 0.04 * em : z * 0.06 * k;
        const x0 = x + side, x1 = x + p.w - side;     // a cooldown's ring: the pill's left end, its label after it
        const pill = (d = 0) => { ctx.beginPath(); ctx.moveTo(x0 + r, top + d); ctx.arcTo(x1 - d, top + d, x1 - d, top + h - d, r - d); ctx.arcTo(x1 - d, top + h - d, x0 + d, top + h - d, r - d); ctx.arcTo(x0 + d, top + h - d, x0 + d, top + d, r - d); ctx.arcTo(x0 + d, top + d, x1 - d, top + d, r - d); ctx.closePath(); };   // d: inset
        ctx.save(); pill();
        ctx.font = lab ? lab.font(z * BADGE_EM * k) : `800 ${z * BADGE_EM * k}px ${fam}`; ctx.textAlign = "center";
        let lx = (x0 + (p.ring ? RING_W * h : 0) + x1) / 2, ly = top + h * 0.5 + z * BADGE_EM * k * 0.36;
        const letters = how => {                      // the label, centred by its ink as the font centres it
          if (!set) return how(p.badge, lx, ly);
          const [a, b] = set.ink(p.badge);
          const from = (p.ring ? (x0 + h + x1) / 2 - 0.043 * em : (x0 + x1) / 2) - (a + b) / 2;   // a ring's: in the rest, the round ends' curve allowed (RING_ENDS)
          set.draw(p.badge, from, top + h / 2 + 0.27 * em, how);
        };
        const G = p.cost && lab ? costGeom(p.cost, h, lab) : null;
        if (G) paintCost(ctx, G, p.cost, x0, top, h, pill, one ? { fill, stroke, z } : null);   // the number on its icon, the word beside
        else if (one) {                               // the font's Stylistic Alternates: a pill outline and solid letters
          ctx.lineJoin = "round";
          if (stroke) { ctx.strokeStyle = rgb(stroke); ctx.lineWidth = Math.max(2, z * 0.21); ctx.stroke(); ctx.lineWidth = Math.max(1.5, z * 0.16); letters((t, a, b) => ctx.strokeText(t, a, b)); }
          const lw = Math.max(1, h * 50 / 950); pill(lw / 2); ctx.strokeStyle = rgb(fill); ctx.lineWidth = lw; ctx.stroke(); ctx.fillStyle = rgb(fill); letters((t, a, b) => ctx.fillText(t, a, b));   // BADGE_LINE inside the pill
        } else if (p.cost) {                          // the label font not loaded: a plain pill
          ctx.fillStyle = BADGE[p.group]; ctx.fill(); ctx.fillStyle = "#fff"; letters((t, a, b) => ctx.fillText(t, a, b));
        } else {                                      // the font's pill: shaded top to bottom, its border over the ring
          const [c0, c1, edge] = PILL[p.group] || PILL.neutral, g = ctx.createLinearGradient(0, top, 0, top + h);
          g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g; ctx.fill();
          if (p.ring) drawRing(ctx, p.ring, p.group, x0 + r, top + r, h / 22);
          pill(); ctx.lineWidth = h * 30 / 950; ctx.strokeStyle = edge; ctx.stroke();
          ctx.fillStyle = "#fff"; letters((t, a, b) => ctx.fillText(t, a, b));
        }
        ctx.restore();
        if (p.ring && one) drawRing(ctx, p.ring, p.group, x0 + r, top + r, h / 22, { fill, stroke, width: Math.max(1.5, z * 0.16) });
      } else if (p.text.trim()) {
        ctx.save(); ctx.font = `${z}px ${fam}`; if (track) ctx.letterSpacing = `${track * z}px`; ctx.translate(x, y); ctx.scale(hx, 1);
        if (stroke) { ctx.lineJoin = "round"; ctx.strokeStyle = rgb(stroke); ctx.lineWidth = Math.max(1.5, z * 0.16); ctx.strokeText(p.text, 0, 0); }
        ctx.fillStyle = p.color || (shades ? shaded(ctx, shades, y) : rgb(fill)); ctx.fillText(p.text, 0, 0); ctx.restore();
      }
      x += p.w;
    }
  });
}
/** The old lines' pitch: the mean of their middles' gaps within 30% of the median gap (capitals, badges or descenders
 *  move a line's middle: the least gap reads the leading tight). */
export function steadyPitch(lines) {
  const c = lines.map(l => (l[1] + l[3]) / 2), d = c.slice(1).map((v, i) => v - c[i]), m = median(d), ok = d.filter(x => x >= 0.7 * m && x <= 1.3 * m);
  return ok.length ? ok.reduce((t, x) => t + x, 0) / ok.length : m;
}
/** The new text where the old block was: its size, line pitch and alignment, from its first line down (a PSD's text
 *  grows downwards), shrunk when it would run past the area; a title at its size (titleLayout). An Ability with the
 *  record's frame and px (box text) wraps at the frame at its set size, as the bake; with px and no frame (point
 *  text) each paragraph is one line (pointLayout). */
function drawText(ctx, { role, text, old, area, found, size, colours, fam, layer, measure, icons, one, colors, statuses, ink, kc, fills }, imgs, W) {
  const paras = colourize(tokenize(text, icons), text, colors, role, statuses, ink, null, fills), region = area.box;
  const mid = (found.box[0] + found.box[2]) / 2, wide = found.box[2] - found.box[0], room = 2 * Math.min(mid - region[0], region[2] - mid);
  const left = found.align === "left" && role !== "name";
  const frame = role === "ability" && kc && Array.isArray(layer?.frame) && layer.frame.length === 4 ? layer.frame.map(v => v * kc) : null;   // box text's frame: Photoshop wraps there
  if (frame && layer.px > 0) size = layer.px * kc;    // at its set size
  const point = role === "ability" && !!kc && !frame && layer?.px > 0;   // point text: its paragraphs never wrap
  if (point) size = layer.px * kc;
  const maxW = point ? Infinity : frame ? (left ? frame[2] - found.box[0] : frame[2] - frame[0]) : left ? region[2] - found.box[0] - W * 0.01 : role === "name" ? Math.max(wide, room * 0.96) : found.lines.length > 1 ? Math.min(wide * 1.06, Math.max(wide, room)) : Math.max(wide, room * 0.94);
  const pitch0 = steadyPitch(found.lines) || size * LINE, top = found.lines[0][1];
  // Room for an Ability at its size, as the bake leaves it (psd_edit fit_below, ink_beyond): its new ink ends no lower
  // than the old text's, or lower but on the card and off the design below (the backdrop under the old text, BEYOND)
  function roomBelow() {
    const H = ctx.canvas.height, k = kc || W / 1200, pad = 6 * k;
    const h1 = Math.max(size * 0.5, found.box[3] - top - (found.lines.length - 1) * pitch0), floor = found.box[3] + pad;
    const end = top + ((lines.length - 1) * pitch0 + h1) * (z / size);
    if (end <= floor) return true;
    if (end > H) return false;
    const y0 = clamp(Math.round(found.box[1] - pad), 0, H - 1), from = Math.ceil(floor), img = ctx.getImageData(0, y0, W, H - y0).data;
    const lum = (x, y) => { const i = ((y - y0) * W + x) * 4; return (img[i] * 77 + img[i + 1] * 150 + img[i + 2] * 29) >> 8; };
    const under = new Array(256).fill(0), dev = new Array(256).fill(0), x0 = clamp(Math.round(found.box[0] - pad), 0, W), x1 = clamp(Math.round(found.box[2] + pad), 0, W);
    let seen = 0;                                     // the backdrop's luma under the old text, as a histogram
    for (let y = y0; y < Math.min(H, from); y++) for (let x = x0; x < x1; x++, seen++) under[lum(x, y)]++;
    const nth = (h, i) => { let v = 0; for (let c = h[0]; c <= i && v < 255; c += h[++v]); return v; };   // a histogram's i-th smallest
    const med = seen ? nth(under, seen >> 1) : 0;
    under.forEach((c, v) => { dev[Math.abs(v - med)] += c; });
    const bar = Math.max(60, (seen ? nth(dev, Math.floor(0.95 * (seen - 1))) : 0) + 20);
    const mask = document.createElement("canvas"); mask.width = W; mask.height = Math.max(1, H - from);
    const mx = mask.getContext("2d", { willReadFrequently: true }); mx.translate(0, -from);
    paintLines(mx, lines, { at: l => (left ? found.box[0] : mid - l.w / 2), base: top + z * 0.8, pitch: pitch0 * (z / size), z, fam, label: measure.label, track: measure.track, hx: measure.hx, fill: [255, 255, 255], stroke: null, imgs, one });
    const a = mx.getImageData(0, 0, W, mask.height).data; let n = 0;
    for (let y = from, j = 3; y < H; y++) for (let x = 0; x < W; x++, j += 4) if (a[j] > 128 && Math.abs(lum(x, y) - med) > bar) n++;
    return n < 100 * k * k;
  }
  let { size: z, lines, over = false, dx = 0 } = role === "name" ? titleLayout(paras, tokenize(old).length, found, maxW, size, measure, W)
    : point ? pointLayout(paras, size, left ? W - found.box[0] : 2 * Math.min(mid, W - mid), measure) : fit(paras, maxW, Infinity, size, measure);
  if (role !== "name" && !roomBelow()) {              // past the area's bottom: smaller, down to 40%; still past it: said so
    const room2 = region[3] - top, need = s => (lines.length - 1) * pitch0 * (s / size) + s * 1.05;
    while (need(z) > room2 && z > size * 0.4) { z *= 0.94; lines = layout(paras, maxW, z, measure); }
    over = need(z) > room2 + 1;
  }
  const pitch = pitch0 * (z / size);
  let base = top + z * (role === "name" ? 0.8 : 0.7);   // an Ability: textBlocks leaves out thin ascender rows, so its top sits low
  if (role === "name" && old) {                       // a title keeps its baseline: where its old ink's top and bottom put it
    ctx.font = `${size}px ${fam}`; ctx.textBaseline = "alphabetic";
    const m = ctx.measureText(String(old).replace(/\r/g, "").split("\n")[0]), up = m.actualBoundingBoxAscent, tall = up + m.actualBoundingBoxDescent;
    if (Number.isFinite(tall) && tall > 0) base = top + (found.lines[0][3] - top) * up / tall;
  }
  const fill = colours?.fill || hexRgb(layer?.color) || [255, 255, 255], stroke = colours?.stroke;
  const shades = colours?.shades && { ...colours.shades, bottom: colours.shades.bottom + Math.max(0, lines.length - found.lines.length) * pitch };   // more lines: the gradient grows
  paintLines(ctx, lines, { at: l => (left ? found.box[0] : mid - l.w / 2 + dx), base, pitch, z, fam, label: measure.label, track: measure.track, hx: measure.hx, fill, stroke, imgs, one, shades });
  return over;
}
const BOX_FILL = [16, 16, 22];                        // drawBox's box
/** No block held the old text: the new text in a dark box over the area (the template's, or the record's box), so the
 *  old text is covered, never half there. */
function drawBox(ctx, { role, text, area, fam, measure, icons, one, colors, statuses, ink, fills }, imgs, W, H, shape) {
  const r = area.seed ? [0, area.seed[0], W, H] : area.box;     // the text area to the card's edges (the old text may touch them)
  const b = area.seed ? r : [r[0] - W * 0.01, r[1] - H * 0.004, r[2] + W * 0.01, r[3] + H * 0.004], pad = W * 0.03;
  const start = role === "name" ? (b[3] - b[1]) * 0.5 : W * (shape === "square" ? 0.06 : shape === "item" ? 0.05 : 0.045);
  const { size: z, lines } = fit(colourize(tokenize(text, icons), text, colors, role, statuses, ink, BOX_FILL, fills), b[2] - b[0] - 2 * pad, b[3] - b[1] - pad, start, measure, role === "name" ? { lines: 1, min: 0.3 } : { min: 0.35 });
  const over = lines.length * z * LINE > b[3] - b[1] - pad + 0.5;
  const rad = Math.min(W * 0.03, (b[3] - b[1]) / 2);
  ctx.save(); ctx.beginPath(); ctx.moveTo(b[0] + rad, b[1]); ctx.arcTo(b[2], b[1], b[2], b[3], rad); ctx.arcTo(b[2], b[3], b[0], b[3], rad); ctx.arcTo(b[0], b[3], b[0], b[1], rad); ctx.arcTo(b[0], b[1], b[2], b[1], rad); ctx.closePath();
  ctx.fillStyle = rgb(BOX_FILL); ctx.fill(); ctx.lineWidth = Math.max(1.5, W * 0.003); ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.setLineDash([W * 0.012, W * 0.008]); ctx.stroke(); ctx.restore();
  const pitch = z * LINE, base = (b[1] + b[3]) / 2 - (lines.length * pitch) / 2 + z * 0.9, mid = (b[0] + b[2]) / 2;
  paintLines(ctx, lines, { at: l => mid - l.w / 2, base, pitch, z, fam, label: measure.label, track: measure.track, hx: measure.hx, fill: [255, 255, 255], stroke: [0, 0, 0], imgs, one });
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
/** A layer-comp bar from `from` (1-10) to `to` (11-20) as its comps draw it: the top half row all lit, the bottom half lit
 *  to to - 10 and dark after (the first dark cell's, a shade when none or the rounded end), a soft border-coloured line
 *  between the halves of the cells lit in both. */
export function paintComp(data, W, H, row, from, to) {
  const [x0, y0, x1, y1] = px(row.box, W, H), cw = (x1 - x0) / row.cells, mid = Math.round((y0 + y1) / 2);
  const cellBox = c => [Math.round(x0 + c * cw), Math.round(x0 + (c + 1) * cw)];
  const src = new Uint8ClampedArray(data), d = from < row.cells - 1 ? cellBox(from)[0] : null;
  const e = (mid * W + cellBox(1)[0]) * 4, line = [src[e], src[e + 1], src[e + 2]];   // a cell border
  paintCells(data, W, H, row, from, row.cells);
  for (let c = to - row.cells; c < row.cells; c++) {
    const [a, b] = cellBox(c);
    for (let y = mid; y < y1 - 1; y++) for (let x = a + 1; x < b - 1; x++) {
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) data[i + ch] = d == null ? data[i + ch] * 0.38 : src[(y * W + d + x - a) * 4 + ch];
    }
  }
  const t = Math.max(1, Math.round((y1 - y0) * 0.04)), top = mid - Math.floor(t / 2), inset = Math.round(cw * 0.3), end = Math.min(x1 - inset, cellBox(to - row.cells)[0]);
  for (let y = top; y < top + t; y++) for (let x = x0 + inset; x < end; x++) {
    const i = (y * W + x) * 4; for (let ch = 0; ch < 3; ch++) data[i + ch] = data[i + ch] * 0.3 + line[ch] * 0.7;
  }
}
/** A row from 0 to `to` (1-10) lit as the bake lights it: each cell copied from the nearest row lit there (lit: [{row,
 *  v}], nearest first), else from that row's last lit cell (when that is the rounded end, its flat right half). */
export function paintLit(data, W, H, row, lit, to) {
  const span = r => { const [x0, y0, x1, y1] = px(r.box, W, H); return { x0, y0, y1, cw: (x1 - x0) / r.cells }; };
  const T = span(row);
  for (let c = 0; c < to; c++) {
    const d = lit.find(o => o.v > c) || lit[0], k = Math.min(c, d.v - 1), S = span(d.row);
    const a = Math.round(T.x0 + c * T.cw), b = Math.round(T.x0 + (c + 1) * T.cw), sa = Math.round(S.x0 + k * S.cw), dy = S.y0 - T.y0;
    for (let y = T.y0 + 1; y < T.y1 - 1; y++) for (let x = a + 1; x < b - 1; x++) {
      const i = (y * W + x) * 4, j = ((y + dy) * W + sa + (k || !c ? x - a : Math.max(x - a, (b - a) >> 1))) * 4;
      data[i] = data[j]; data[i + 1] = data[j + 1]; data[i + 2] = data[j + 2];
    }
  }
}
