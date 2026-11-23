// The quick image mock-up: the edited name, text, stats, stars and type icons drawn over the card image in a canvas, at
// once, in the browser (the Edit dialog and the card page, edit mode). Never the real image: the bake draws that (preview.js).
// Stars: the bake's own picture from the card's plate (card_plates.with_stars), else, as type icons, where the bake would
// put them (the details record's header: starPlan, typePlan), else in a box. A new type icon's colours: the shown icons'
// (iconLook), or a look that redraws the bake's own made icons of two hues far better (the plate's typeProbe: probeLook).
// Layout: the PSD's text boxes when the details record has them (text[].box, canvas px), else the card template's
// (TEMPLATES, measured on the PSDs, below the stat bars) narrowed to where the image shows text: the block of lines
// (textBlocks) whose size and line count fit the old text (calibrate). That block is erased with the card's own
// background (erase) and the new text drawn there in the card's font (data/fonts.json -> MDW/Fonts as a web font), icon
// tokens as icons and timing tags as badges. When no block fits the old text (text over art, a stylised title), the new
// text goes in a dark box over the template's area instead ("box"), never over a half-erased old one. Everything above
// `draw` is pure (node checks run it on plain pixel arrays).
import { norm, splitToken, tagInfo, cooldownOf, ringParts, RING_PAINT, TAG, COST, costInfo, variantFile } from "./text.js";
import { fxOf, starMove, starsKept, titleInPicture } from "./parts.js";
import { colorRanges, drawnSpans, inkOf, layerColors, phraseText, spansOf, statusSpans } from "./textcolor.js";
import { SAME_RUN, taBlocks, taMoves, taParts } from "./textalign.js";

export const LABEL = "Mock-up: the real image comes from the bake";
export const BADGE = { turn: "#2563eb", any: "#7c3aed", forced: "#dc2626", trigger: "#d97706", neutral: "#475569",   // flat, before the label font loads
  points: "#055e45", bricks: "#4f260f", sp: "#20397f", own: "#0f766e" };                                     // and its costs' pills
const STATS = ["hp", "def", "atk", "spd"];
export const LINE = 1.22;                            // line pitch in ems
const FIT_STEP = 0.94, FIT_MIN = 0.4, LIFT_GAP = 2, BEYOND = 6;   // AutoCroissant psd_edit (canvas px): fit_below's steps, lift's gap, ink_beyond's pad
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
export function textBlocks(L, W, H, box, { edge = 40, seed = null, span = 12, strong = span > 1 ? 0.18 : 0.3, join = 4 } = {}) {
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
  return out.sort((a, b) => b.mass - a.mass);
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
/** A one-line title's found block (b) with its rows as the record's box (own: psd_details' ink box, image px) where
 *  that box holds the same line: the found rows leave out thin ones (descenders, an apostrophe's tip), which puts the
 *  title's baseline high. */
export function recordRows(b, own, old, W) {
  const l = b?.lines?.[0];
  if (!l || !own || b.lines.length !== 1 || String(old ?? "").replace(/\r/g, "").trim().includes("\n")) return b;
  const tol = 0.02 * W;
  if (Math.abs(own[0] - l[0]) > tol || Math.abs(own[2] - l[2]) > tol || own[1] > l[1] + 1 || own[3] < l[3] - 1 || own[3] - own[1] > 2 * (l[3] - l[1])) return b;
  const line = [l[0], Math.min(l[1], own[1]), l[2], Math.max(l[3], own[3])];
  return { ...b, lines: [line], box: [b.box[0], Math.min(b.box[1], line[1]), b.box[2], Math.max(b.box[3], line[3])] };
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
export function strayLines(L, W, H, found, { top = 0, bottom = H, bars = [] } = {}) {
  const edge = 25, hs = found.lines.map(l => l[3] - l[1]), lh = median(hs), pitch = found.pitch || lh * 1.3, out = [];
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
 *  Returns the colours read on the way: {fill, stroke | null} as [r, g, b]. fill, stroke: the record's (textColours').
 *  profile (a Gradient Overlay): shades too, the old letters' colours top to bottom (shadesOf), else null. */
export function erase(data, W, H, box, { reach = 3, cell = 10, edge = 40, lines = null, close = 0, fill = null, profile = false, stroke = null } = {}) {
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
  const tc = textColours(masked, bg, fill, stroke), shades = profile ? shadesOf(masked, lines, y0, cw, at, tc.stroke || stroke) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const fx = (x + 0.5) / cw - 0.5, fy = (y + 0.5) / cw - 0.5, cx = Math.floor(fx), cy = Math.floor(fy), tx = fx - cx, ty = fy - cy;
    const i = ((y0 + y) * W + x0 + x) * 4;
    for (let k = 0; k < 3; k++) {
      data[i + k] = (at(cx, cy, k) * (1 - tx) + at(cx + 1, cy, k) * tx) * (1 - ty) + (at(cx, cy + 1, k) * (1 - tx) + at(cx + 1, cy + 1, k) * tx) * ty;
    }
  }
  return { ...tc, shades };
}
/** A Gradient Overlay's colours over the old lines (px), top to bottom: in 8 bands, the median colour of the text's
 *  pixels (erase's masked, x and y in its box from y0) that are neither the background (at: its cells) nor the outline
 *  (stroke: the one read, else the record's; a black one on a dark backdrop isn't read). -> {stops: [[t, [r, g, b]]], top, bottom} | null */
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
 *  fills instead when 4% of the pixels are near it. stroke (the record's): a guessed fill that is it gives way to the
 *  ink off it and off the background. */
export function textColours(masked, bg, known = null, stroke = null) {
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
  const guess = bgL < 140 ? { fill: avg(light), stroke: lum(dark) < bgL - 25 ? avg(dark) : null }
    : { fill: avg(dark), stroke: lum(light) > bgL + 25 ? avg(light) : null };
  const far = (p, c, d) => Math.max(Math.abs(p[1] - c[0]), Math.abs(p[2] - c[1]), Math.abs(p[3] - c[2])) > d;
  if (stroke && !far([0, ...guess.fill], stroke, 60)) {   // the darkest ink was the Stroke
    const rest = masked.filter(p => far(p, stroke, 60) && far(p, bg, 48));
    if (rest.length >= 8) return { fill: [1, 2, 3].map(k => median(rest.map(p => p[k]))), stroke };
  }
  return guess;
}

/** Ability text as paragraphs of chunks (no break inside a chunk), each piece {text}, {icon, no, sticker, vary, vfile} (an
 *  icon token the site has, "[fire]", "[fire:no]", "[fire:sticker]" with its masks, a variant it has with its picture;
 *  another bracket or variant stays text) or {badge,
 *  group} (a timing tag, "(1CD)", as text.js reads it; a cost, "(2 points)", with cost {n, word, kind}; another
 *  parenthesis stays text). */
export function tokenize(text, icons = {}) {
  const PIECE = new RegExp(`\\[([^\\[\\]\\n]{1,52})\\]|${TAG.source}|\u0001(\\d+)\u0002`, "g"), costs = [];
  const held = line => line.replace(new RegExp(COST.source, "gi"), (all, inner) => (costInfo(inner) ? `\u0001${costs.push({ ...costInfo(inner), src: all }) - 1}\u0002` : all));
  return String(text ?? "").replace(/\r/g, "").split("\n").map(line => held(line).split(/[ \t]+/).filter(Boolean).map(chunk => {
    const out = []; let at = 0;
    for (const m of chunk.matchAll(PIECE)) {
      let piece = null;
      if (m[1] != null) { const t = splitToken(m[1]), ic = t && icons[norm(t.base)]; if (ic) piece = { icon: ic.file, name: t.base, ...(ic.a > 0 ? { a: ic.a } : {}), no: t.v === "no", sticker: t.v === "sticker" && ["tint", "sticker"].every(v => ic.v?.includes(v)) ? { tint: variantFile(ic, "tint"), outline: variantFile(ic, "sticker") } : null, ...(VARIANT_REACH[t.v] != null && ic.v?.includes(t.v) ? { vary: t.v, vfile: variantFile(ic, t.v) } : {}) }; }
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
    if (p.text == null) {                            // a :tint or :sticker in its run's colour: the nearest letter's
      if (p.vary !== "tint" && p.vary !== "sticker") return [p];
      let a = i - 1, b = i + src.length;
      while (a >= 0 && /\s/.test(text[a]) && text[a] !== "\n") a--;
      while (b < text.length && /[ \t]/.test(text[b])) b++;
      return [{ ...p, ink: at(i) || (a >= 0 && text[a] !== "\n" ? at(a) : null) || (b < text.length && text[b] !== "\n" ? at(b) : null) }];
    }
    const out = [];
    for (let k = 0; k < src.length; k++) {
      const c = at(i + k), last = out[out.length - 1];
      if (last && last.color === c) last.text += src[k]; else out.push({ text: src[k], color: c });
    }
    return out.map(x => (x.color ? x : { text: x.text }));
  })));
}
const INK_CELLS = 600000;                            // typedAt's alignment at most this many cells
/** The longest common letters of was and now as [[a0, a1, b0, b1, kept]] (typedAt's); null past INK_CELLS. */
function align(was, now) {
  const n = was.length, m = now.length;
  if (n * m > INK_CELLS) return null;
  const W = m + 1, dp = new Uint16Array((n + 1) * W);   // longest common letters of was[i:], now[j:]
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = was[i] === now[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const segs = [];
  const put = (kept, i, j, di, dj) => { const s = segs[segs.length - 1]; if (s && s[4] === kept) { s[1] += di; s[3] += dj; } else segs.push([i, i + di, j, j + dj, kept]); };
  for (let i = 0, j = 0; i < n || j < m;) {
    if (i < n && j < m && was[i] === now[j]) put(true, i++, j++, 1, 1);
    else if (j < m && (i >= n || dp[i * W + j + 1] >= dp[(i + 1) * W + j])) put(false, i, j++, 0, 1);
    else put(false, i++, j, 1, 0);
  }
  return segs;
}
/** The colours the bake gives an edited text (psd_edit edit_styles), from list ([{start, end, color}] over was, none:
 *  the main ink), lined up as the bake does (textalign.js: paragraphs, then words): kept letters keep theirs (a kept
 *  stretch under SAME_RUN letters without a break joins its paragraph's change); a changed stretch takes the commonest
 *  of the letters it replaces (no blanks, icons, badges or status words: statuses, the status names); typed-in text the
 *  nearest letter's before it on its line, else after, or the body's (the commonest outside status words) between two
 *  colours of a line of several; a paragraph the edit moved its own, letter for letter where kept, else its commonest;
 *  a kept status word's letters the nearest letter's on their line (the chart's goes on after); whole lines typed right
 *  under a header (heads: psd_details' header lines' text, psd_edit header_looks) the next line's first letter's. Its
 *  runs ([] none). */
export function bakeInk(was, list, now, statuses = null, heads = null) {
  was = String(was ?? ""); now = String(now ?? "");
  const n = was.length, m = now.length;
  if (!list?.length) return [];
  const col = Array(n).fill(null), drawn = Array(n).fill(false), status = Array(n).fill(false);
  for (const r of list) for (let i = Math.max(0, r.start); i < Math.min(n, r.end); i++) col[i] = r.color;
  for (const [s, e] of drawnSpans(was)) for (let i = s; i < e; i++) drawn[i] = true;
  for (const [s, e] of statusSpans(was, statuses)) for (let i = s; i < e; i++) status[i] = true;
  const letter = i => !/\s/.test(was[i]) && !drawn[i] && !status[i];
  const commonest = (lo, hi, ok) => { const count = new Map(); for (let k = lo; k < hi; k++) if (ok(k)) count.set(col[k], (count.get(col[k]) || 0) + 1); return count.size ? [[...count].reduce((x, y) => (y[1] > x[1] ? y : x))[0]] : null; };
  const body = commonest(0, n, k => !status[k])?.[0] ?? null;   // body_fill
  const lineOf = (lo, hi) => [was.lastIndexOf("\n", lo - 1) + 1, (k => (k < 0 ? n : k))(was.indexOf("\n", hi))];
  const near = (lo, hi) => {
    const [top, bottom] = lineOf(lo, hi), seen = new Set();
    for (let k = top; k < bottom; k++) if (letter(k)) seen.add(col[k]);
    if (seen.size > 1 && !(lo > top && hi < bottom && col[lo - 1] === col[hi])) return body;   // typed between two colours
    for (let k = lo - 1; k >= top; k--) if (letter(k)) return col[k];
    for (let k = hi; k < bottom; k++) if (letter(k)) return col[k];
    return null;
  };
  const beside = i => { const [top, bottom] = lineOf(i, i + 1); for (let k = i - 1; k >= top; k--) if (letter(k)) return col[k]; for (let k = i + 1; k < bottom; k++) if (letter(k)) return col[k]; return body; };
  const out = Array(m).fill(null), changed = Array(m).fill(false);
  for (const [a0, a1, b0, b1, kept] of taParts(was, now)) {   // a kept status word's letters: the nearest letter's (the edit resets them)
    if (kept) { for (let k = 0; k < b1 - b0; k++) out[b0 + k] = status[a0 + k] ? beside(a0 + k) : col[a0 + k]; continue; }
    if (b1 <= b0) continue;
    changed.fill(true, b0, b1);
    const c = commonest(a0, a1, letter), bare = !was.slice(a0, a1).split("").some((x, k) => !/\s/.test(x) && !status[a0 + k]);
    out.fill(c ? c[0] : bare ? near(a0, a1) : null, b0, b1);   // replacing only blanks and status words: as typed
  }
  for (const [[s0, e0], [t0, t1], kl] of taMoves(was, now)) {   // a moved paragraph: its own colours
    const c = commonest(s0, e0, letter);
    if (!c) continue;
    const from = new Map();
    for (const [p, q, k] of kl) for (let d = 0; d < k; d++) from.set(t0 + q + d, s0 + p + d);
    for (let k = t0; k < t1; k++) if (changed[k]) out[k] = from.has(k) ? col[from.get(k)] : c[0];
  }
  for (const [lo, hi, c] of headInk(was, now, heads, letter, drawn, col)) out.fill(c, lo, hi);
  const runs = [];
  out.forEach((c, k) => { const r = runs[runs.length - 1]; if (c && r?.color === c && r.end === k) r.end++; else if (c) runs.push({ start: k, end: k + 1, color: c }); });
  return runs;
}
/** [[start, end, colour]] over now: each insertion of whole lines right under a header line of was (heads: those lines'
 *  text) and above a line with letters, in that line's first letter's colour (no status word: letter), as the bake
 *  sets it (psd_edit header_looks); a typed line took the header's look, a second cost line. */
function headInk(was, now, heads, letter, drawn, col) {
  const names = new Set((heads || []).map(h => String(h).trim()).filter(Boolean)), out = [];
  if (!names.size) return out;
  const added = [];                                   // insertions at one place joined (a break is a part of its own)
  for (const [a0, a1, b0, b1, kept] of taParts(was, now)) {
    if (kept || a1 > a0) continue;
    const last = added[added.length - 1];
    if (last && last[0] === a0 && last[2] === b0) last[2] = b1; else added.push([a0, b0, b1]);
  }
  for (const [a0, b0, b1] of added) {
    if (!now.slice(b0, b1).trim()) continue;
    const after = was[a0] === "\n" && now[b0] === "\n", before = a0 > 0 && was[a0 - 1] === "\n" && now[b1 - 1] === "\n";
    if (!after && !before) continue;
    const end = after ? a0 : a0 - 1, top = was.lastIndexOf("\n", end - 1) + 1;
    if (!names.has(was.slice(top, end).trim())) continue;
    let k = end + 1, first = -1;
    for (; k < was.length && first < 0; k++) if (letter(k)) first = k;
    for (k = end + 1; first < 0 && k < was.length; k++) if (!/\s/.test(was[k]) && !drawn[k]) first = k;
    if (first >= 0) out.push(after ? [b0 + 1, b1, col[first]] : [b0, b1, col[first]]);
  }
  return out;
}
/** Per letter of now, edited from was: null where the edit keeps it, else the index in was of the letter whose run the
 *  bake types it in (psd_edit changed_range's span, edit_parts' changed parts; plain_typed: a replacement's first
 *  letter, an insertion's letter before). */
export function typedAt(was, now) {
  was = String(was ?? ""); now = String(now ?? "");
  const out = Array(now.length).fill(null);
  let a = 0, b = 0;
  while (a < was.length && a < now.length && was[a] === now[a]) a++;
  while (b < was.length - a && b < now.length - a && was[was.length - 1 - b] === now[now.length - 1 - b]) b++;
  const segs = align(was.slice(a, was.length - b), now.slice(a, now.length - b)) || [[0, was.length - a - b, 0, now.length - a - b, false]];
  const parts = [];                                   // a short kept stretch joins the change
  for (const [a0, a1, b0, b1, kept] of segs) {
    const last = parts[parts.length - 1];
    if (kept && (a1 - a0 >= SAME_RUN || was.slice(a + a0, a + a1).includes("\n"))) parts.push(null);
    else if (last) { last[1] = a + a1; last[3] = a + b1; } else parts.push([a + a0, a + a1, a + b0, a + b1]);
  }
  for (const p of parts) if (p) out.fill(p[1] > p[0] || !p[0] ? p[0] : p[0] - 1, p[2], p[3]);
  return out;
}
const PLAIN_MARKS = { "\u2014": "-", "\u2013": "-", "\u2026": "...", "\u201c": '"', "\u201d": '"' };   // psd_edit.PLAIN_MARKS (owner D13)
const MGP_FONT = "MyriadPro-Regular";               // psd_edit.MGP_FONT: glyph_fonts' last pick (Photoshop's stand-in)
const AS = { "\ufdd0": 1, "\ufdd1": 3, "\ufdd2": "-", "\ufdd3": "...", "\ufdd4": '"' }, STAND = { 1: "\ufdd0", 3: "\ufdd1", "-": "\ufdd2", "...": "\ufdd3", '"': "\ufdd4" };   // glyphPlan's
const STOOD = /[\ufdd0-\ufdd4]/;                     // stand-ins (noncharacters): that many .notdefs, or a mark plain
/** text as the bake sets the typed letters its font can't draw (lacks, empty: data/fonts.json's, no glyph or an empty
 *  one): a D13 mark plain where the font draws the plain one (psd_edit.plain_typed), else in the font the bake picks
 *  (pick(s, from): a font name or "", psd_edit.glyph_fonts; from: the letter of the run it is typed into, when the font
 *  lacks that one too: The Structure's digits), else as its .notdef (no_glyph; an empty glyph as it is); a kept one the
 *  font can't draw in the font its layer prints it in (keep(c), Crock Pot's Arial ':'), icons and badges as they
 *  are. {text: the same length, with stand-ins glyphRuns reads, boxes: the letters set as .notdef, fonts: Map(letter ->
 *  font name) draw sets each such letter in, the text left as typed}. */
export function glyphPlan(text, old, lacks, pick = null, empty = "", keep = null) {
  text = String(text ?? ""); old = String(old ?? ""); lacks = String(lacks ?? ""); empty = String(empty ?? "");
  const fonts = new Map();
  if (!(lacks || empty) || !text) return { text, boxes: "", fonts };
  const typed = typedAt(old, text), drawn = drawnSpans(old), no = c => lacks.includes(c) || empty.includes(c);
  const shown = Array(text.length).fill(false);       // icons and badges
  for (const [a, b] of drawnSpans(text)) { typed.fill(null, a, b); shown.fill(true, a, b); }
  const other = j => j >= 0 && j < old.length && !/\s/.test(old[j]) && no(old[j]) && !drawn.some(([a, b]) => a <= j && j < b);
  const kept = new Map(), picked = new Map();
  let out = "", boxes = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i], plain = no(c) ? PLAIN_MARKS[c] : null, s = plain || c;
    if (!no(c) || /\s/.test(c)) { out += c; continue; }
    if (typed[i] == null) { if (!shown[i] && keep && !kept.has(c)) kept.set(c, keep(c) || ""); out += c; continue; }
    if (plain && !no(plain[0])) { out += STAND[plain]; continue; }
    const by = pick?.(s, other(typed[i]) ? old[typed[i]] : "") || "";
    if (by) { out += plain ? STAND[plain] : c; for (const x of s) if (!picked.has(x)) picked.set(x, by); }
    else if (!lacks.includes(s[0])) out += plain ? STAND[plain] : c;   // an empty glyph: drawn so (nothing)
    else if (other(typed[i])) out += c;
    else { out += STAND[plain?.length || 1]; boxes += s[0]; }
  }
  for (const [c, f] of [...picked, ...kept]) if (f) fonts.set(c, f);   // a kept letter's own font first
  return { text: out, boxes: [...new Set(boxes)].join(""), fonts };
}
/** The font the bake sets a typed c its font can't draw in (psd_edit.glyph_fonts): the one the run it is typed into
 *  prints from in (from: that run's letter), else the one the layer prints it in, else (not own) the one another shown
 *  type layer of the card prints it in (details' faces, else its font; most letters first), else Myriad Pro; one map
 *  (data/fonts.json's) offers that draws c, never the icon font; else "". */
export function glyphFont(rec, layer, c, map, own = false, from = "") {
  const draws = f => typeof f === "string" && !ICON_FONT.test(f) && typeof map?.[f]?.file === "string"
    && !String(map[f].lacks ?? "").includes(c) && !String(map[f].empty ?? "").includes(c);
  const letters = t => { let s = String(t ?? ""); for (const [a, b] of drawnSpans(s).reverse()) s = s.slice(0, a) + s.slice(b); return s; };
  const faces = t => (Array.isArray(t?.faces) ? t.faces : [[t?.lf || t?.font, letters(t?.text)]]);
  const hit = (t, x = c) => faces(t).find(([f, cs]) => String(cs ?? "").includes(x) && draws(f))?.[0];
  const mine = t => t === layer || (t?.layer === layer?.layer && t?.id === layer?.id);
  const found = (from && hit(layer, from)) || hit(layer);
  if (found || own) return found || "";
  const theirs = (Array.isArray(rec?.text) ? rec.text : []).filter(t => t && !mine(t) && t.visible !== false).map(t => hit(t)).find(Boolean);
  return theirs || (draws(MGP_FONT) ? MGP_FONT : "");
}
const PICKED = new Map();                             // family (draw's fam) -> Map(letter -> CSS family): glyphPlan's fonts
/** A text's runs as drawn: strings (a stand-in mark plain), numbers (that many .notdefs) and {s, fam} (letters picks
 *  sets in another family: glyphPlan's fonts). */
export function glyphRuns(t, picks = null) {
  const out = [], add = x => {
    const last = out[out.length - 1];
    if (typeof x === "string" && typeof last === "string") out[out.length - 1] += x;
    else if (typeof x === "object" && typeof last === "object" && last.fam === x.fam) last.s += x.s;
    else out.push(x);
  };
  for (const c of t) {
    const x = AS[c] ?? c;
    if (typeof x !== "string" || !picks?.size) add(x);
    else for (const d of x) add(picks.has(d) ? { s: d, fam: picks.get(d) } : d);
  }
  return out;
}
/** Whether t holds what glyphRuns splits (a stand-in, with fam's .notdef; or a letter its picks set). */
function glyphy(t, fam) {
  const pk = PICKED.get(fam);
  return (NOTDEFS.has(fam) && STOOD.test(t)) || (!!pk?.size && [...String(t)].some(c => pk.has(c) || (typeof AS[c] === "string" && [...AS[c]].some(d => pk.has(d)))));
}
/** The card's own colours on a redrawn text, as the bake gives them (bakeInk; statuses: the status names, heads: the
 *  header lines, an Ability's):
 *  the field's; a part's (old: its layer's text) the field's colours where that text is in the field, followed to the
 *  new; null without any. */
export function baseInk(card, field, text, old = null, statuses = null, heads = null) {
  const was = String(card?.ink?.built?.[field] ?? card?.[field] ?? ""), list = inkOf(card, field, was) || [];
  const some = r => (r.length ? r : null);
  if (old == null) return some(bakeInk(was, list, text, statuses, heads));
  const at = old ? was.indexOf(old) : -1;
  if (at < 0) return null;
  const own = list.filter(r => r.end > at && r.start < at + old.length).map(r => ({ ...r, start: Math.max(0, r.start - at), end: Math.min(old.length, r.end - at) }));
  return some(bakeInk(old, own, text, statuses, heads));
}
/** [start, end] of each badge tokenize finds in text, in order. */
const badgeAt = text => {
  const out = []; let at = 0;
  for (const para of tokenize(text)) for (const chunk of para) for (const p of chunk) {
    const src = p.text ?? p.src ?? "", i = src ? text.indexOf(src, at) : -1;
    if (i < 0) continue;
    at = i + src.length;
    if (p.badge) out.push([i, at]);
  }
  return out;
};
/** How the bake sets each badge of text, edited from old (psd_edit): one that holds most of an old badge's kept letters
 *  (taBlocks: psd_edit kept_chars) keeps that badge's size and tracking, {bem, tk} from badges (psd_details: [em, track]
 *  per old badge, null when not in the icon font); a typed one is fitted, tracked as the layer's badges at their
 *  commonest size (icon_style), {tk}. Per badge, in order; null: as before. */
export function badgeLooks(text, old, badges) {
  text = String(text ?? "").replace(/\r/g, ""); old = String(old ?? "").replace(/\r/g, "");
  const now = badgeAt(text), looks = now.map(() => null);
  if (!Array.isArray(badges) || !badges.length) return looks;
  const set = badges.filter(b => Array.isArray(b) && b[0] > 0), count = (list, key) => list.reduce((m, b) => m.set(key(b), (m.get(key(b)) || 0) + 1), new Map());
  const pick = (m, tie = () => false) => { let best; for (const [k, n] of m) if (best === undefined || n > m.get(best) || (n === m.get(best) && tie(k) && !tie(best))) best = k; return best; };
  const em = pick(count(set, b => b[0]), k => k === 1), tk = set.length ? pick(count(set.filter(b => b[0] === em), b => b[1])) : 0;
  now.forEach((_, i) => { if (tk) looks[i] = { tk }; });
  const was = badgeAt(old);
  if (was.length !== badges.length) return looks;
  const from = now.map(() => -1), moved = Array(old.length).fill(-1), into = was.map(() => new Map());   // an old badge's home: the new one with most
  for (const [a0, b0, n] of old === text ? [[0, 0, old.length]] : taBlocks(old, text)) for (let k = 0; k < n; k++) moved[a0 + k] = b0 + k;   // of its kept letters
  was.forEach(([a, b], i) => { for (let k = a; k < b; k++) { const j = now.findIndex(([c, d]) => c <= moved[k] && moved[k] < d); if (j >= 0) into[i].set(j, (into[i].get(j) || 0) + 1); } });
  into.forEach((n, i) => { if (!n.size) return; const j = pick(n); if (from[j] < 0 || n.get(j) > into[from[j]].get(j)) from[j] = i; });   // (psd_edit "edited"); of those, the one giving it most
  from.forEach((i, j) => { const b = badges[i]; if (i >= 0) looks[j] = Array.isArray(b) && b[0] > 0 ? { bem: b[0], tk: b[1] || 0 } : null; });
  return looks;
}
const lin = v => (v <= 10 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const lumOf = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** ranges without the colours under 3:1 against rgb (none: all): they stay in the text's own colour. */
const seenOn = (ranges, rgb) => { if (!rgb) return ranges; const b = lumOf(rgb); return ranges.filter(r => { const c = lumOf(hexRgb(r.color) || [0, 0, 0]); return (Math.max(b, c) + 0.05) / (Math.min(b, c) + 0.05) >= 3; }); };
const ICON_EM = 1.1;                                  // an icon's width in ems (its shape unknown)
const VARIANT_REACH = { tint: 0, sticker: 0.0729, glow: 0.3021, darkglow: 0.3021 };   // cards.json iconVariants (build_site variant_reach)
const VARIANT_PAD = { sticker: 0.03, glow: 0.26, darkglow: 0.26 };   // build_stoogedings: OUTLINE - SIDE, GLOW_SIZE - SIDE (em) each side
const LAYERED = new Set(["sticker", "no", "glow", "darkglow"]);   // psd_edit LAYERED: typed at tracking 0
/** An icon glyph as build_stoogedings draws it, in ems: its picture (a: width over height) 1 em tall, 1.4 wide at most,
 *  0.04 each side, a variant's spacers (pad) each side beyond; null when its shape is unknown. */
const iconEm = p => { const a = p?.a; if (!(a > 0)) return null; const h = a <= 1.4 ? 1 : 1.4 / a, pad = VARIANT_PAD[p.vary] || 0; return { h, w: h * a, adv: h * a + 0.08 + 2 * pad, pad }; };
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
/** A piece's width at size: an icon its glyph's (iconEm), a badge its letters (bold, BADGE_EM) and its pill's ends at its fitted
 *  scale (measure.cap: capOf; a kept one's own, bem) and tracking (tk), a cooldown's ring end too, else the text. */
const pieceW = (p, size, measure) => {
  if (!p.badge) return p.icon ? (iconEm(p)?.adv ?? ICON_EM) * size : measure(p.text, size);
  const { k, h } = pillOf(p, size, measure.cap?.(size)), em = h / PILL_EM;
  return badgeW(p, size, measure, k, h, em) + (p.tk || 0) / 1000 * em;   // its tracking after it (psd_details badges)
};
/** A badge's {h, k}: a kept one's own size (bem), else fitted (badgeFit). */
const pillOf = (p, z, cap) => (p.bem > 0 ? { h: PILL_EM * p.bem * z, k: PILL_EM * p.bem / BADGE_H } : badgeFit(z, cap));
const badgeW = (p, size, measure, k, h, em) => {
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
 *  measure(text, size) -> px. An empty paragraph is an empty line. indent: px the first line's leading spaces take. */
export function layout(paras, maxW, size, measure, indent = 0) {
  const space = measure(" ", size), lines = [];
  for (const para of paras) {
    let line = { pieces: [], w: 0 };
    if (!para.length) { lines.push(line); continue; }
    for (const chunk of para) {
      const pieces = chunk.map(p => ({ ...p, w: pieceW(p, size, measure) })), w = pieces.reduce((t, p) => t + p.w, 0);
      if (line.pieces.length && line.w + space + w > maxW - (lines.length ? 0 : indent)) { lines.push(line); line = { pieces: [], w: 0 }; }
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
/** A title as the bake sets it (psd_edit set_text_layer): at its size (titleFit: smaller off icons); point text keeps its lines, a box's (more lines
 *  found than the old text's n0 paragraphs) wraps at maxW. over: more lines than it has; dx: back on the card (back_on),
 *  from its left edge when left set, else centred. */
export function titleLayout(paras, n0, found, maxW, size, measure, W, left = false) {
  const lines = layout(paras, found.lines.length > n0 ? maxW : Infinity, size, measure);
  const w = Math.max(0, ...lines.map(l => l.w)), x0 = left ? found.box[0] : (found.box[0] + found.box[2] - w) / 2;
  return { size, lines, over: lines.length > Math.max(1, found.lines.length, paras.length), dx: w > W ? 0 : clamp(x0, 0, W - w) - x0 };
}
export const TITLE_MIN = 0.7, TOUCH_PAD = 10;         // psd_edit fit_title: its floor; px round the old title an icon is left out
/** The record's shown stars and header type icons ([name, core], image px at k per canvas px) a title may not newly
 *  print over (psd_edit _clear_icons): none within TOUCH_PAD of any of its old boxes (image px). */
export function titleIcons(head, k, boxes) {
  const pad = TOUCH_PAD * k, near = (c, b) => Math.min(c[2], b[2] + pad) > Math.max(c[0], b[0] - pad) && Math.min(c[3], b[3] + pad) > Math.max(c[1], b[1] - pad);
  const all = [...(Array.isArray(head?.stars?.units) ? head.stars.units : []).map(u => ["star", u?.core]), ...(Array.isArray(head?.types?.row) ? head.types.row : []).map(u => [u?.name, u?.core])];
  return all.filter(([, c]) => Array.isArray(c) && c.length === 4).map(([n, c]) => [n, c.map(v => v * k)]).filter(([, c]) => !boxes.some(b => near(c, b)));
}
/** psd_edit fit_title: the largest scale, by 0.94 down to TITLE_MIN, at which a title prints on none of its icons and
 *  stays on the card (reaches(s, sides): true while it doesn't); 1 when it reaches none at its size or none clears. */
export function titleFit(reaches) {
  if (!reaches(1, false)) return 1;
  for (let s = 1; s > TITLE_MIN;) { s = Math.max(TITLE_MIN, s * 0.94); if (!reaches(s, true)) return s; }
  return 1;
}
/** The card maker's title boxes (canvas px) an earlier fit kept: the card's titleWas, with its titleFit (psd_edit
 *  set_text_layer's was; titleIcons leaves icons near them out, never near its text's at the card maker's size); a split
 *  title's part id: its titleFits [fit, boxes] (card_bake TITLE_FITS); else null. */
export function keptTitle(card, id) {
  const part = id != null && Array.isArray(card?.titleFits?.[id]) ? card.titleFits[id] : null, fit = part ? part[0] : card?.titleFit, was = part ? part[1] : card?.titleWas;
  const kept = fit > 0 && fit < 1 && Array.isArray(was) ? was.filter(b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)) : [];
  return kept.length ? kept : null;
}
/** The scale an earlier bake set a title (a split title's part id: that part) at: titleFit, or titleFits[id][0]. */
export const keptFit = (card, id) => (id != null && Array.isArray(card?.titleFits?.[id]) ? card.titleFits[id][0] : card?.titleFit);

/** The stat rows a template draws, in px: [{k, box, cells: 10}] for the stats a card has (hp, def, atk, spd in order);
 *  none for a shape without bars or stats the details call anything but "template" or "pixel" (drawn bars). */
export function barRows(shape, W, H, card, rec) {
  const t = TEMPLATES[shape]?.bars;
  if (!t) return [];
  const st = rec && typeof rec.stats === "object" ? rec.stats : null;
  const keys = STATS.filter(k => card[k] != null || (st && st[k] === "template"));
  if (st && keys.some(k => st[k] !== "template" && st[k] !== "pixel")) return [];
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
/** Does row (px) show v: its first v cells' centres all lighter, or all darker, than the rest by 8 or more? A row at 0 or
 *  full can't tell: yes. */
export function rowShows(L, W, H, row, v) {
  if (!(v > 0 && v < row.cells)) return true;
  const [x0, y0, x1, y1] = px(row.box, W, H), cw = (x1 - x0) / row.cells, m = [];
  for (let c = 0; c < row.cells; c++) {
    let t = 0, n = 0;
    for (let y = Math.round(y0 + (y1 - y0) * 0.3); y < y0 + (y1 - y0) * 0.7; y++) for (let x = Math.round(x0 + (c + 0.25) * cw); x < x0 + (c + 0.75) * cw; x++) { t += L[y * W + x]; n++; }
    m.push(n ? t / n : 0);
  }
  const a = m.slice(0, v), b = m.slice(v);
  return Math.min(...a) > Math.max(...b) + 8 || Math.max(...a) + 8 < Math.min(...b);
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
 *  to]}, stars: [from, to] | null, types: [old, new] | null (not a reorder), skipped: [labels]} (stats above 10 aren't drawn;
 *  "<k>@<n>": creature n's own, n 2 or more, drawn from the plate's pictures only). */
export function changes(edit, psd) {
  const out = { name: null, ability: null, stats: {}, stars: null, types: null, skipped: [], colors: null };
  const text = s => String(s ?? "").replace(/\r/g, "").trim();
  if ("name" in edit && text(edit.name) !== text(psd.name)) out.name = text(edit.name);
  if ("ability" in edit && text(edit.ability) !== text(psd.ability)) out.ability = text(edit.ability);
  for (const k of STATS) if (k in edit && edit[k] !== psd[k]) {
    if (edit[k] == null || psd[k] == null || edit[k] > 10 || psd[k] > 10) out.skipped.push(k.toUpperCase());
    else out.stats[k] = [psd[k], edit[k]];
  }
  if (Array.isArray(edit.creatures) && Array.isArray(psd.creatures) && edit.creatures.length === psd.creatures.length)
    edit.creatures.forEach((one, i) => { if (i) for (const k of STATS) { const a = psd.creatures[i]?.[k], v = one?.[k];
      if (Number.isInteger(a) && Number.isInteger(v) && a !== v) out.stats[`${k}@${i + 1}`] = [a, v]; } });
  if ("stars" in edit && edit.stars != null && edit.stars !== psd.stars) out.stars = [psd.stars ?? 0, edit.stars];
  if ("types" in edit && JSON.stringify([...(edit.types || [])].map(norm).sort()) !== JSON.stringify([...(psd.types || [])].map(norm).sort())) out.types = [[...(psd.types || [])], [...(edit.types || [])]];
  const of = (list, f) => JSON.stringify((list || []).filter(one => one.field === f));
  for (const f of ["name", "ability"]) if ("colors" in edit && of(edit.colors, f) !== of(psd.colors, f)) {   // a colour redraws its text
    out[f] ??= text(edit[f] ?? psd[f]) || null; out.colors = edit.colors;
  }
  return out;
}

const STAT_NAME = { hp: /^(hp|health)$/i, def: /^(def|defen[cs]e|defemse)$/i, atk: /^(atk|attack)$/i, spd: /^(spd|speed)$/i };   // psd_regions.STATS
const isComp = (p, k) => { const path = String(p).split("/"), own = path.pop().trim(); return STAT_NAME[k].test(own) && path.some(g => /dark|bars/i.test(g)); };
/** Whether the record's stat bar is a layer-comp smart object (the Alt template's Stats Bars/Darks/Health): it bakes to 20. */
export const compBar = (rec, k) => Array.isArray(rec?.smart_objects) && rec.smart_objects.some(p => isComp(p, k));
/** Whether a comp bar's group shows a layer in its Bars group (the lit look its comps uncover); none (Bulborb Larva: its
 *  comps draw their own look, up to 10): nothing to light from 0. */
const compLit = (rec, k) => rec.smart_objects.some(p => {
  if (!isComp(p, k)) return false;
  let kids = Array.isArray(rec.tree) ? rec.tree : [];
  for (const g of String(p).split("/").slice(0, -2)) kids = kids.find(n => n?.[0] === g && n[1] === "group")?.[3] || [];
  const shown = list => Array.isArray(list) && list.some(n => n?.[2] && (n[1] !== "group" || shown(n[3])));
  return kids.some(n => n?.[1] === "group" && /^\s*bars\s*$/i.test(n[0]) && shown(n[3]));
});
/** Why a stat at `to` stays on the website (psd_edit.classify's site reasons; old bars), or null: it bakes, or the record
 *  can't tell (several creatures' digit rows). */
export function statSite(rec, k, to) {
  const kind = rec?.stats?.[k];
  if (!(to > 10) || typeof kind !== "string" || !Array.isArray(rec.smart_objects) || compBar(rec, k)) return null;
  if (kind === "two-row") return null;                 // several creatures' rows: their stat caps refuse past 10
  return `the card's ${kind === "template" ? "old-style " : ""}bars print up to 10`;
}
/** Why the creatures list stays on the website (psd_edit._classify_creatures' first site reason), or null: a list of
 *  another length (split, + or - Creature), or creature 2+'s stat emptied. Then none of creature 2+'s stats bake. */
export function creatureSite(edit, psd) {
  const many = x => (Array.isArray(x) && x.length > 1 ? x : null), now = many(edit.creatures), was = many(psd.creatures);
  if (edit.creatures === undefined || (!now && !was)) return null;
  if (now?.length !== was?.length) return "each creature's stats print only on a bar per creature";
  for (const k of STATS) for (const [n, one] of now.entries())
    if (n && k in (one || {}) && one[k] == null && was[n]?.[k] != null) return `a bar can't show no value (creature ${n + 1}'s ${k.toUpperCase()})`;
  return null;
}
const HAND_STATS = /\b(Stat|(?:HP|DEF|ATK|SPD)(?: and (?:HP|DEF|ATK|SPD))*) (?:edits need Photoshop|(?:edits|raises) bake but change nothing|bars are on each other's rows)|brighten the cells/g;
/** The stats whose edits Card checks' real bakes refuse, leave as they are or put on the wrong bar (cards.json
 *  checks.hand: AutoCroissant card_checks _note("stats"), NO_CHANGE_NOTE, SWAP_NOTE, BRIGHT_NOTE; keep in step). */
export const handStats = card => [...new Set([...String(card?.checks?.hand || "").matchAll(HAND_STATS)]
  .flatMap(m => (!m[1] || m[1] === "Stat" ? STATS : m[1].toLowerCase().split(" and "))))];

/** The boxes to redraw from per-layer edits (PARTS_EDITOR.md §5; parts: Card Edits.json's, by layer id): [{id, role (name |
 *  ability), old, text (null: the layer is deleted), box (canvas px), added, colors}] for the record's parts whose edit
 *  differs from the layer's text, or whose letters `colors` paints otherwise than `was` (the image's); an added ability
 *  goes where the bake puts it (the details' addRoom, card_checks' room), else in the template's Ability box, and
 *  nowhere on a card with no room for one (addRoom false: the bake refuses it). colors: each part's share of the
 *  field's (textcolor.js layerColors over the field's layers as the bake leaves them, picture 1's, in reading order). */
export function partJobs(rec, parts, { colors = null, was = null, statuses = null } = {}) {
  const p = obj(rec?.parts);
  if (!p || !obj(parts)) return [];
  const list = [...(p.title || []).map(x => ["name", x]), ...(p.ability || []).map(x => ["ability", x])];
  const room = rec?.addRoom, tb = Array.isArray(room) ? room : rec?.partsTemplate?.ability?.box;
  const add = obj(parts["+ability"]), plus = add?.text && !(p.ability || []).length && room !== false ? { id: "+ability" } : null;
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

/** A field's record parts that picture 1 prints: the title's, or the Ability's. */
const printed = (p, f) => (f === "name" ? p.title || [] : p.ability || []).filter(x => !(Array.isArray(x?.variants) && !x.variants.includes(1)));

/** A stacked Ability box's rows (several Ability layers of one path: Bulborb Larva's three): {own, others} ink boxes
 *  (record parts' box, x k: image px), the others' grown by their Stroke and shadows' offsets (the bake counts a row's
 *  effects), or null. */
export function stackRows(rec, id, k) {
  const rows = printed(obj(rec?.parts) || {}, "ability"), me = rows.find(p => String(p?.id) === String(id));
  const others = me && Array.isArray(me.box) && k > 0 ? rows.filter(p => p !== me && p?.layer === me.layer && Array.isArray(p.box)) : [];
  const grown = p => {
    const t = Array.isArray(rec?.text) ? rec.text.find(x => String(x?.id) === String(p.id)) : null, s = Array.isArray(t?.stroke) ? +t.stroke[3] || 0 : 0, g = [s, s, s, s];
    for (const e of Array.isArray(t?.fx) ? t.fx : []) if (e?.k === "shadow") { g[0] = Math.max(g[0], -(e.dx || 0)); g[1] = Math.max(g[1], -(e.dy || 0)); g[2] = Math.max(g[2], e.dx || 0); g[3] = Math.max(g[3], e.dy || 0); }
    return p.box.map((v, i) => (v + (i < 2 ? -g[i] : g[i])) * k);
  };
  return others.length ? { own: me.box.map(v => v * k), others: others.map(grown) } : null;
}
const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** The colours the bake refuses as painted over (AutoCroissant psd_edit plan_colors, _painted_over, _solid_overlay):
 *  [{one, label, why}]. Refused when an enabled Color, Gradient or Pattern Overlay, the part's own or a group's above it,
 *  hides every title or Ability part the colour paints (layerColors). A part's own isn't counted for a whole field's
 *  colour or a phrase on a field that has one (it goes off), a phrase that is all of the part's text (_whole_span) or
 *  one after it, nor a lone Color Overlay under a phrase; nor, on a field with a whole colour, the group whose shown
 *  layers are all the field's (ownedGroup); a part's clip (an opaque layer clipped onto it or its group
 *  over it, _clipped_over) counts as its own. The record has no opacity, blend mode or fill. typed: the
 *  fields `edit` retypes; their colours are checked in the new text (a box's own, a one-layer field's), as plan_colors
 *  does. mixed(part, field) (draw's): whether the plate's looks draw the part's whole colour (mixPlan); given, the
 *  ownedGroup counts again on a field retyped, with a phrase colour or with a part under it they don't draw (its plain
 *  redraw can't draw them: rotated words). */
export function paintedOver(rec, colors, typed = [], edit = null, mixed = null) {
  const p = obj(rec?.parts), fx = obj(rec?.effects) || {}, out = [];
  if (!p || !Array.isArray(colors)) return out;
  const on = (path, t = null) => (Array.isArray(t?.effects) ? t.effects : Array.isArray(fx[path]) ? fx[path] : []).filter(n => OVERLAY.test(String(n))).map(n => n.replace("Overlay", " Overlay"));   // t: its own where layers share the path
  const lit = new Set(colors.filter(one => !one?.phrase).map(one => one?.field)), done = new Set();   // done: parts a phrase took whole
  const drawsAll = new Map(), owned = (path, f, list) => {   // ownedGroup, as mixed allows
    const g = lit.has(f) ? ownedGroup(rec, path, f) : null, key = `${f}\n${g}`;
    if (!g || !mixed) return g;
    if (!drawsAll.has(key)) drawsAll.set(key, !typed.includes(f) && !colors.some(o => o?.field === f && o.phrase)
      && list.every(x => !String(x?.layer || "").startsWith(`${g}/`) || mixed(x, f)));
    return drawsAll.get(key) ? g : null;
  };
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
      const path = String(x?.layer || "").split("/"), t = Array.isArray(rec?.text) ? rec.text.find(e => e?.id === x?.id && e?.layer === x?.layer) : null;
      const own = on(path.join("/"), t), g = owned(path.join("/"), f, list);
      const mineToo = one.phrase && !lit.has(f) && !done.has(x) && !full.includes(x);
      if (mineToo && x?.clip) return `its clipped layer '${x.clip}'`;
      if (own.length && mineToo && !(own.length === 1 && own[0] === "Color Overlay")) return `its ${own[0]}`;
      for (let i = path.length - 1; i > 0; i--) { const at = path.slice(0, i).join("/"), e = on(at); if (e.length && at !== g) return `its group '${path[i - 1]}''s ${e[0]}`; }
      return null;
    });
    if (hid.length && hid.every(Boolean)) out.push({ one, label: one.phrase ? `colour of ${phraseText(one.phrase)}` : `${f === "name" ? "title" : "Ability"}'s colour`,
      why: `${hid.sort()[0]} paints over the ${what}'s colours: recolour it in Photoshop` });
    else for (const x of full) done.add(x);              // its own overlays go off (set_colors)
  }
  return out;
}

const PLACED = /^Text\/Name(\s*#[\d,\s]+)?$/;         // a Text/Name smart object prints the title (Gust of Wind's)
/** The colours the bake refuses as keeping their own look (psd_edit plan_colors): [{one, label, why}]. A phrase on an
 *  Ability not retyped whose letters (layerColors) are only an FX layer's words (_fx_words; with blanks), else only badges
 *  and icons (drawnSpans) or status words (statusSpans; blanks paint, as _painted's); any colour on a title only a
 *  Text/Name smart object prints, with no name edit (title_in_picture: PICTURE_TITLE). */
export function keptOver(rec, colors, typed = [], statuses = null) {
  const p = obj(rec?.parts), out = [];
  if (!p || !Array.isArray(colors)) return out;
  const placed = !printed(p, "name").length && Array.isArray(rec?.smart_objects) && rec.smart_objects.some(s => PLACED.test(String(s)));
  const parts = printed(p, "ability"), texts = parts.map(x => String(x?.text ?? "")), within = (L, k) => L.some(([a, b]) => a <= k && k < b);
  const fxWords = (x, t) => fxOf(rec, x).flatMap(path => { const at = path.indexOf(" FX: "), name = path.slice(path.lastIndexOf("/", at) + 1);   // [start, end, its FX layer's name]
    return path.slice(at + 5).split("|").map(w => w.trim()).filter(Boolean).flatMap(w => (spansOf(t, { phrase: w }) || []).map(([a, b]) => [a, b, name])); });
  for (const one of colors) {
    const f = one?.field, w = one?.phrase ? phraseText(one.phrase) : "";
    if (f === "name" && placed && !typed.includes(f)) out.push({ one, label: w ? `colour of ${w}` : "title's colour", why: "the title is part of the picture" });
    if (f !== "ability" || !w || typed.includes(f)) continue;
    let hit = false, mine = false, ink = false, other = false, cut = "";   // mine: letters it paints (ink: not blank); other: not icons
    parts.forEach((x, i) => {
      const t = texts[i], c = layerColors(texts, i, [one], f), icons = drawnSpans(t), words = statusSpans(t, statuses), fx = fxWords(x, t);
      for (const [a, b] of (c && spansOf(t, c[0])) || []) {
        cut ||= fx.find(([s, e]) => s < b && a < e)?.[2] || "";
        for (let k = a; k < b; k++) {
          hit = true;
          if (within(icons, k)) continue;
          other = true;
          if (!within(fx, k) && !within(words, k)) { mine = true; ink ||= /\S/.test(t[k]); }
        }
      }
    });
    const why = cut && !ink ? `is drawn by its effect layer '${cut}', which keeps its own pixels` : !hit || mine ? ""
      : other ? "is a status word, which keeps the chart's colour" : "is only badges or icons, which keep their own colours";
    if (why) out.push({ one, label: `colour of ${w}`, why: `${w} ${why}` });
  }
  return out;
}

// ---- stars and type icons: where the bake would put them (psd_details' header, canvas px; AutoCroissant psd_edit)
const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const centreOf = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const boxAt = ([cx, cy], w, h) => [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
/** A unit's erase box (glow included) kept within half the icon's larger side of its core: a record's box past that
 *  (Holo Defense API, Ice Dragon: the whole card) is not its glow. */
export const capBox = ({ core: c, box: b }) => { const m = 0.5 * Math.max(c[2] - c[0], c[3] - c[1]); return [Math.max(b[0], c[0] - m), Math.max(b[1], c[1] - m), Math.min(b[2], c[2] + m), Math.min(b[3], c[3] + m)]; };
/** Stars from `from` to `to` on the record's header.stars: {erase: [box], draw: [box], refused, boxed}. A shown star stays when
 *  one of the count's centres (at[to], the bake's plan) is within a quarter of a star of its own; the others are erased
 *  (their box, glow included) and a star drawn at every centre none covers. A count whose stars all shrink to fit their
 *  banner (scale[to], the bake's option B; past 1, back to the maker's size after one) erases them all and draws each
 *  centre that much smaller (or larger). No record, no layout for the count, or stars not one per unit: boxed. refused:
 *  why the bake would refuse the count. */
export function starPlan(stars, from, to) {
  const st = obj(stars), why = st && obj(st.refused) ? st.refused[to] ?? st.refused["*"] ?? null : null;
  const units = Array.isArray(st?.units) ? st.units : [], at = to === 0 ? [] : obj(st?.at)?.[to];   // none: all erased
  if (!units.length || units.length !== from || !Array.isArray(at)) return { erase: [], draw: [], refused: why, boxed: true };
  const w = median(units.map(u => u.core[2] - u.core[0])), h = median(units.map(u => u.core[3] - u.core[1])), tol = 0.25 * Math.max(w, h);
  const s = +obj(st.scale)?.[to];
  if (s > 0 && s !== 1) return { erase: units.map(capBox), draw: at.map(t => boxAt(t, w * s, h * s)), refused: why, boxed: false };
  const left = units.map(u => ({ u, c: centreOf(u.core) })), draw = [];
  for (const t of at) {
    const i = left.findIndex(({ c }) => Math.abs(c[0] - t[0]) <= tol && Math.abs(c[1] - t[1]) <= tol);
    if (i >= 0) left.splice(i, 1); else draw.push(boxAt(t, w, h));
  }
  return { erase: left.map(({ u }) => capBox(u)), draw, refused: why, boxed: false };
}
/** Type icons for `now` on the record's header.types, as psd_edit.plan_types does it: kept icons stay in their
 *  slot, removed ones are erased, a kept icon past the new count moves to the first free slot (centre on centre, its own
 *  size), new ones take the next free slots (spots[count] past the row). -> {erase: [box], draw: [{name, core}], refused,
 *  boxed, gone: the erased icons' row indexes}. A token row, no icon to line up with or no spots for the count: boxed.
 *  first: the template's spot (canvas px) when the card has no type icon; one new icon goes there. */
export function typePlan(types, now, first = null) {
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
  const spots = [...row.slice(0, count).map(u => u.core), ...more], erase = [], draw = [], gone = [];
  const free = spots.map((_, i) => i).filter(i => !(i < row.length && kept[i]));
  row.forEach((u, i) => {
    if (!kept[i]) { erase.push(capBox(u)); gone.push(i); }
    else if (i >= count) {
      const to = centreOf(spots[free.shift()]), c = centreOf(u.core), dx = Math.round(to[0] - c[0]), dy = Math.round(to[1] - c[1]);
      erase.push(capBox(u)); gone.push(i); draw.push({ name: u.name, core: [u.core[0] + dx, u.core[1] + dy, u.core[2] + dx, u.core[3] + dy] });
    }
  });
  for (const name of added) draw.push({ name, core: spots[free.shift()] });
  return { erase, draw, refused, boxed: false, gone };
}
/** The bake's own icon moves undone (the record's header.types_back, psd_edit's types memo, D14): back to the card
 *  maker's types, in any order, -> {erase, draw} as typePlan's; else null. */
export function backPlan(back, now) {
  const b = obj(back), key = list => JSON.stringify([...list].map(norm).sort());
  return b && Array.isArray(b.types) && key(b.types) === key(now || []) ? { erase: b.erase || [], draw: b.draw || [], refused: null, boxed: false } : null;
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
const PLATE_OFF = 20;                               // off the ink, a plate's mean distance from the card's pixels (max channel) at most
/** The plate's card without its type icons (AutoCroissant card_plates.with_under) where a types edit takes icons away:
 *  a pixel in a gone icon's mask takes bare (the card without its icons), or in a kept icon's reach each gone one's
 *  patch (the card without it alone) adds its change; kept icons stay. data: RGBA W px wide; cut: [x, y, w, h] (image
 *  px); bare, card (the image there), masks and patches (per icon; null: none): RGBA w x h; reach: per icon [x0, y0,
 *  x1, y1] in the cut; gone: the icons' indexes. -> false, nothing pasted: bare off the masks unlike the image
 *  (PLATE_OFF: another picture's). */
export function pasteUnder(data, W, [x0, y0, w, h], bare, card, masks, patches, reach, gone) {
  const out = masks.map((_, k) => gone.includes(k)), kept = reach.filter((_, k) => !out[k]);
  let n = 0, sum = 0;
  for (let j = 0; j < w * h * 4; j += 4) if (masks.every(m => m[j] < 128)) { n++; sum += Math.max(Math.abs(bare[j] - card[j]), Math.abs(bare[j + 1] - card[j + 1]), Math.abs(bare[j + 2] - card[j + 2])); }
  if (n >= 50 && sum > PLATE_OFF * n) return false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4, i = ((y0 + y) * W + x0 + x) * 4;
    if (!masks.some((m, k) => out[k] && m[j] >= 128)) continue;
    if (!kept.some(r => x >= r[0] && x < r[2] && y >= r[1] && y < r[3])) { data[i] = bare[j]; data[i + 1] = bare[j + 1]; data[i + 2] = bare[j + 2]; continue; }
    for (let c = 0; c < 3; c++) {                       // a kept icon may show here: each gone one's own change
      let d = 0;
      masks.forEach((m, k) => { if (out[k] && m[j] >= 128) d += (patches[k] || bare)[j + c] - card[j + c]; });
      data[i + c] += d;
    }
  }
  return true;
}
const count = (t, w) => String(t ?? "").toLowerCase().split(w.toLowerCase()).length - 1;
/** The plate crops (AutoCroissant card_plates) of layer ids, cut to the image (W x H, k px per canvas px; read(crop, w,
 *  h): its RGBA at that size), each checked against the card's pixels (data) off its ink: [[x, y, w, h, rgba]], or null
 *  (a layer without one, or a plate not of this picture). A layer's crop without its FX layers when one of their words
 *  leaves the text (old -> text): the bake drops them. near: every layer this draw wipes; a crop over another's ink (or
 *  one without a crop) is null too: that crop still holds its old letters. */
export function plateCuts(data, W, H, k, plate, read, ids, old = "", text = "", near = ids) {
  const pick = id => { const of = plate.crops.filter(c => id != null && String(c.id) === String(id)), bare = of.find(c => Array.isArray(c.fx));
    return bare && bare.fx.some(w => count(text, w) < count(old, w)) ? bare : of.find(c => !c.fx) || null; };
  const list = ids.map(pick);
  if (!list.length || list.some(c => !c) || !(k > 0)) return null;
  const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  for (const c of list) for (const o of near) {
    if (String(o) === String(c.id)) continue;
    const theirs = plate.crops.filter(x => String(x.id) === String(o));
    if (!theirs.length || theirs.some(x => meets(c.box, x.ink))) return null;
  }
  const cuts = [];
  for (const c of list) {
    const [x0, y0, x1, y1] = px(c.box.map(v => v * k), W, H), w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return null;
    const p = read(c, w, h), [ix0, iy0, ix1, iy1] = c.ink.map(v => v * k);
    let n = 0, sum = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = x0 + x, Y = y0 + y;
      if (X >= ix0 - 1 && X < ix1 + 1 && Y >= iy0 - 1 && Y < iy1 + 1) continue;
      const i = (Y * W + X) * 4, j = (y * w + x) * 4; n++;
      sum += Math.max(Math.abs(p[j] - data[i]), Math.abs(p[j + 1] - data[i + 1]), Math.abs(p[j + 2] - data[i + 2]));
    }
    if (n >= 50 && sum > PLATE_OFF * n) return null;   // another picture's, or no longer this card's
    cuts.push([x0, y0, w, h, p]);
  }
  return cuts;
}
/** Specs for the record's follow layers (AutoCroissant psd_parts) the bake rewrites with a retyped part (psd_edit
 *  set_parts) that have a plate crop of their own (card_plates: printed elsewhere, Autopsy Report's Evidence title,
 *  Mosling's script name): a copy the part's new text (none: deleted with it), a watermark the joined title; none when
 *  its crop and another wiped one's meet (one's box, the other's ink) or a layer over it is wiped or has no crop. */
export function followSpecs(rec, plate, specs, k) {
  const p = obj(rec?.parts), list = Array.isArray(p?.follow) ? p.follow : [], texts = Array.isArray(rec?.text) ? rec.text : [];
  const parts = specs.filter(s => s.part && !s.added && s.id), out = [];
  if (!list.length || !parts.length) return out;
  const flat = t => String(t ?? "").replace(/\s+/g, " ").trim().toLowerCase(), spec = id => parts.find(s => String(s.id) === String(id));
  const crop = id => plate.crops.find(c => String(c.id) === String(id) && !Array.isArray(c.fx));
  const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3], wiped = parts.map(s => crop(s.id));
  const titles = printed(p, "name"), title = list => list.filter(t => t != null).join(" ");
  for (const f of list) {
    const t = texts.find(x => String(x?.id) === String(f?.id)), c = crop(f?.id), of = (Array.isArray(f?.of) ? f.of : []).map(spec).filter(Boolean);
    if (!t || !c || !of.length || !Array.isArray(t.box) || !(f.how === "copy" || f.how === "watermark")) continue;
    const text = f.how === "watermark" ? (flat(t.text) === flat(title(titles.map(x => x.text))) ? title(titles.map(x => (spec(x.id) ? spec(x.id).text : x.text))) || null : undefined)
      : flat(t.text) !== flat(of[0].old) ? undefined : of[0].text;
    if (text === undefined || (text != null && flat(text) === flat(t.text))) continue;
    if ((c.over || []).some(id => !crop(id) || spec(id)) || wiped.some(w => w && (meets(w.box, c.ink) || meets(c.box, w.ink)))) continue;
    out.push({ role: of[0].role, text, old: String(t.text), label: of[0].label, own: t.box.map(v => v * k), part: true, path: t.layer, id: String(f.id), colors: null, follow: c });
  }
  return out;
}
const SPLIT_LINE = 0.25, SPLIT_INTO = 0.3;           // ems of its size a retyped part's estimate must pass its frame, or into another part, by
/** Why the bake refuses a split title's box edits (AutoCroissant psd_edit.split_title_check), or "": among the title
 *  parts one picture shows, a retyped part (its old ink box scaled by this font's widths, set by its layer's just, moved
 *  back onto the card as back_on does) may not break onto another line, run off the card or run into a part on its line.
 *  Said only when clear-cut (past the limit by a margin): near it, the bake's ink decides. */
export function splitWhy(ctx, rec, specs, fams, kc, W) {
  const typed = new Map(specs.map((s, k) => [s, k]).filter(([s]) => s.role === "name" && s.part && !s.added && !s.follow && s.id && s.text !== s.old).map(([s, k]) => [String(s.id), k]));
  const spec = p => specs[typed.get(String(p.id))];
  if (!(kc > 0) || ![...typed.values()].some(k => specs[k].text != null)) return "";
  const parts = (obj(rec?.parts)?.title || []).filter(p => Array.isArray(p?.box) && p.box.length === 4 && !(typed.has(String(p.id)) && spec(p).text == null));
  const lines = t => String(t ?? "").replace(/\r/g, "\n").split("\n").map(l => l.trim()).filter(Boolean);
  const say = t => { const x = lines(t).join(" ").slice(0, 30); return x.includes("'") && !x.includes('"') ? `"${x}"` : `'${x}'`; };   // quoted as the bake's repr
  const across = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const level = (a, b) => Math.min(a[3], b[3]) - Math.max(a[1], b[1]) >= Math.min(a[3] - a[1], b[3] - b[1]) / 2;   // half the shorter's height shared
  const was = new Map(parts.map(p => [p, p.box.map(v => v * kc)])), now = new Map(was), shape = new Map(), em = new Map();
  for (const p of parts.filter(p => typed.has(String(p.id)))) {
    const k = typed.get(String(p.id)), layer = fams[k]?.layer, box = was.get(p);
    if (!(layer?.px > 0)) continue;
    const z = layer.px * kc, track = Number.isFinite(layer.track) ? layer.track / 1000 : 0;
    ctx.font = `${z}px ${fams[k].fam}`; ctx.letterSpacing = `${track * z}px`;
    const wide = t => Math.max(0, ...lines(t).map(l => ctx.measureText(l).width)), w0 = wide(specs[k].old), w = w0 > 0 ? (box[2] - box[0]) * wide(specs[k].text) / w0 : 0;
    ctx.letterSpacing = "0px";
    if (!(w > 0)) continue;
    const frame = Array.isArray(layer.frame) && layer.frame.length === 4 ? (layer.frame[2] - layer.frame[0]) * kc : 0;
    em.set(p, z);
    if (frame && w > frame + Math.max(SPLIT_LINE * z, 0.03 * frame)) shape.set(p, "would break onto another line");
    else if (w > W) shape.set(p, "would run off the card");
    const x0 = clamp(layer.just === 0 ? box[0] : layer.just === 1 ? box[2] - w : (box[0] + box[2] - w) / 2, 0, Math.max(0, W - w));
    now.set(p, [x0, box[1], x0 + w, box[3]]);
  }
  const pictures = [...new Set(parts.flatMap(p => (Array.isArray(p.variants) ? p.variants : [])))].sort((a, b) => a - b);
  for (const n of pictures.length ? pictures : [null]) {
    const group = parts.filter(p => p.variants == null || (Array.isArray(p.variants) && p.variants.includes(n))), edited = group.filter(p => typed.has(String(p.id)));
    if (group.length < 2 || !edited.length) continue;
    const why = (p, w) => `title part ${group.indexOf(p) + 1}/${group.length} (${say(spec(p).text)}) ${w}: shorten it, or change the title in Photoshop`;
    for (const p of edited) if (shape.has(p)) return why(p, shape.get(p));
    for (const p of edited) for (const q of group) {
      if (q !== p && em.has(p) && level(was.get(p), was.get(q)) && across(now.get(p), now.get(q)) > across(was.get(p), was.get(q)) + SPLIT_INTO * em.get(p))
        return why(p, `would run into ${say(typed.has(String(q.id)) ? spec(q).text : q.text)}, another part of the title`);
    }
  }
  return "";
}
/** The copies stacked on the one layer ids names (its plate crop's "stacked", AutoCroissant card_plates._stacked) in its
 *  font and size (layer: its text record): [{dx, dy (image px), above, ch, fill}] or null. off: a whole colour turns
 *  their overlays off too (psd_edit set_colors): no fill of their own. */
function stackedOf(rec, plate, ids, k, layer, off = false) {
  const c = ids.length === 1 && k > 0 ? (plate?.crops || []).find(x => String(x.id) === String(ids[0]) && !Array.isArray(x.fx)) : null;
  const texts = Array.isArray(rec?.text) ? rec.text : [];
  const out = (Array.isArray(c?.stacked) ? c.stacked : []).filter(x => {
    const t = texts.find(y => String(y?.id) === String(x?.id));
    return t && layer && t.font === layer.font && t.size === layer.size && Array.isArray(x.at);
  }).map(x => ({ dx: x.at[0] * k, dy: x.at[1] * k, above: !!x.above, ch: Array.isArray(x.ch) ? x.ch : null, fill: !off && Array.isArray(x.fill) ? x.fill : null }));
  return out.length ? out : null;
}
/** The layers over a follow layer back on top of its new letters (cuts: their plates, the card without each): the card's
 *  pixels as far as it differs from them (OPAQUE's ramp). */
function putOver(ctx, W, cuts, card) {
  for (const [x0, y0, w, h, p] of cuts) {
    const im = ctx.getImageData(x0, y0, w, h), d = im.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4, i = ((y0 + y) * W + x0 + x) * 4;
      let e = 0; for (let c = 0; c < 3; c++) e = Math.max(e, Math.abs(card[i + c] - p[j + c]));
      const a = clamp((e - OPAQUE[0]) / (OPAQUE[1] - OPAQUE[0]), 0, 1);
      if (a > 0) for (let c = 0; c < 3; c++) d[j + c] = Math.round(a * card[i + c] + (1 - a) * d[j + c]);
    }
    ctx.putImageData(im, x0, y0);
  }
}
const NEW_INK = 64, HID_MIN = 24;                   // |new - plate| of a new letter; px of them under a cover, at 720 wide
/** The pictures over layers ids (the plate's covers: AutoCroissant card_plates.cover_alpha) cut to the image (W x H, k px
 *  per canvas px; read: plateCuts'; alpha(cover, w, h): its alpha's RGBA at that size, or null): [[x, y, w, h, plate rgba
 *  (the layer's crop: the card without it), alpha rgba]], or null (none). */
export function coverCuts(plate, read, alpha, ids, k, W, H) {
  const out = [];
  for (const id of ids) {
    const s = (plate?.covers || []).find(x => String(x.id) === String(id)), c = s && plate.crops.find(x => String(x.id) === String(id) && !Array.isArray(x.fx));
    if (!c || !Array.isArray(s.box) || String(s.box) !== String(c.box) || !(k > 0)) continue;
    const [x0, y0, x1, y1] = px(c.box.map(v => v * k), W, H), w = x1 - x0, h = y1 - y0, a = w > 0 && h > 0 ? alpha(s, w, h) : null;
    if (a) out.push([x0, y0, w, h, read(c, w, h), a]);
  }
  return out.length ? out : null;
}
/** A cover's share at image pixel (x, y) (cover: coverCuts), 0 off them. */
const coverAt = (cover, x, y) => { let a = 0; for (const [x0, y0, w, h, , al] of cover) if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) a = Math.max(a, al[((y - y0) * w + x - x0) * 4] / 255); return a; };
/** The pictures over a layer back on top of its new letters, as the bake leaves them (cover: coverCuts): each pixel
 *  that is no longer the card's mixed towards the plate by the cover's share. -> whether new letters went under them
 *  past the old lines' ink (lines: [x0, y0, x1, y1] image px, grown by grow). */
export function putCover(ctx, W, cover, card, lines, grow) {
  let hid = 0;
  const off = (x, y) => !lines.some(l => x >= l[0] - grow && x < l[2] + grow && y >= l[1] - grow && y < l[3] + grow);
  for (const [x0, y0, w, h, p, a] of cover) {
    const im = ctx.getImageData(x0, y0, w, h), d = im.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4, i = ((y0 + y) * W + x0 + x) * 4, s = a[j] / 255;
      if (!s) continue;
      let e = 0, n = 0; for (let c = 0; c < 3; c++) { e = Math.max(e, Math.abs(d[j + c] - card[i + c])); n = Math.max(n, Math.abs(d[j + c] - p[j + c])); }
      if (e <= 2) continue;                           // the card's own pixel
      if (s >= 0.5 && n > NEW_INK && off(x0 + x, y0 + y)) hid++;
      for (let c = 0; c < 3; c++) d[j + c] = Math.round(d[j + c] + s * (p[j + c] - d[j + c]));
    }
    ctx.putImageData(im, x0, y0);
  }
  return hid >= HID_MIN * (W / 720) ** 2;
}
/** A text job's old lines' ink (image px): its plate layout's (card_plates.layout), else the lines found on the image. */
const oldInk = j => (Array.isArray(j.geo?.c?.lines) && j.kc > 0 ? j.geo.c.lines.map(l => [l[3] * j.kc, l[5] * j.kc, l[4] * j.kc, l[6] * j.kc]) : j.found?.lines || []);
/** Whether old holds a word of the FX layers on layers ids (the plate's crops without them). */
const fxIn = (plate, ids, old) => plate.crops.some(c => Array.isArray(c.fx) && ids.some(id => String(c.id) === String(id)) && c.fx.some(w => count(old, w)));
/** A stat's label: "HP", or "HP (creature 2)" for "hp@2". */
const statLabel = k => { const [s, n] = k.split("@"); return s.toUpperCase() + (n ? ` (creature ${n})` : ""); };
/** A stat's picture in the plate's bars (card_plates.bar_sheet: the bake's merge at the site's card view, per value
 *  the pixels it moves): its cut [x, y, w, h, sheet x, sheet y] (view px) for from -> to; null when the plate
 *  pictures the card's bars but not that value (the bake refuses it, or it moves nothing); undefined when it has no
 *  say (no bars there, or the card's value isn't the plate's: the cells then). */
export function barCut(bars, k, from, to) {
  if (!bars || !Array.isArray(bars.cuts)) return undefined;
  const s = bars.bars?.[k];
  if (!s) return null;
  if (s.at !== from) return undefined;
  const cut = bars.cuts[s.to?.[String(to)]];
  return Array.isArray(cut) && cut.length === 6 ? cut : null;
}
/** The plate's stars pictures for picture n (card_plates.with_stars): picture 1's "icons", another's "icons@<n>"; null
 *  without (an older plate: starPlan). */
export function starSheet(plate, n) {
  const s = plate?.[n === 1 ? "icons" : `icons@${n}`];
  return s?.vw > 0 && Array.isArray(s.cuts) ? s : null;
}
/** A bar cut's pixels from its sheet at k image px per view px: [x, y, w, h, rgba] (image px). */
function barPixels(img, [x, y, w, h, sx, sy], k) {
  const X = Math.round(x * k), Y = Math.round(y * k), w2 = Math.max(1, Math.round((x + w) * k) - X), h2 = Math.max(1, Math.round((y + h) * k) - Y);
  const cv = document.createElement("canvas"); cv.width = w2; cv.height = h2;
  const g = cv.getContext("2d", { willReadFrequently: true });
  if (k !== 1) g.imageSmoothingEnabled = false;
  g.drawImage(img, sx, sy, w, h, 0, 0, w2, h2);
  return [X, Y, w2, h2, g.getImageData(0, 0, w2, h2).data];
}
/** A bar cut's pixels onto the image's (W x H): those it holds (alpha 128 or more), opaque; the rest left as they are. */
export function putBar(data, W, H, [x0, y0, w, h, p]) {
  for (let y = Math.max(0, -y0); y < h && y0 + y < H; y++) for (let x = Math.max(0, -x0); x < w && x0 + x < W; x++) {
    const j = (y * w + x) * 4;
    if (p[j + 3] < 128) continue;
    const i = ((y0 + y) * W + x0 + x) * 4;
    data[i] = p[j]; data[i + 1] = p[j + 1]; data[i + 2] = p[j + 2]; data[i + 3] = 255;
  }
}
function putCuts(data, W, cuts) {
  for (const [x0, y0, w, h, p] of cuts) for (let y = 0; y < h; y++) data.set(p.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * W + x0) * 4);
}
/** putCuts on ctx; false without cuts. */
function pasteCuts(ctx, W, cuts) {
  if (!cuts) return false;
  const im = ctx.getImageData(0, 0, W, ctx.canvas.height); putCuts(im.data, W, cuts); ctx.putImageData(im, 0, 0); return true;
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
const FAUX_BOLD = 0.027;                               // the fork's FAUX_BOLD_EM: a faux bold letter's extra advance and dilation, in ems
const ICON_FONT = /^stoogedings/i;                    // AutoCroissant ICON_FONT_PREFIX: icons and badges, not letters
const OVERLAY = /^(Color|Gradient|Pattern)Overlay$/;  // psd_details' effect names; a disabled one ends " (off)"
/** Whether the text layer at path ("Text/Ability") or a group above it has an enabled Color, Gradient or Pattern Overlay
 *  (the details record's effects; t: the layer's record entry, whose own "effects" win where layers share the path,
 *  psd_details VERSION 12): the font then draws its badges and stickers in one colour, Stylistic Alternates
 *  (AutoCroissant psd_edit one_colour, 2026-10-25). */
export function oneColour(rec, path, kind = OVERLAY, t = null) {
  const fx = rec?.effects && typeof rec.effects === "object" ? rec.effects : {}, parts = String(path || "").split("/");
  const own = t?.layer === path && Array.isArray(t.effects) ? t.effects : null;
  return !!path && parts.some((_, i) => { const e = own && i === parts.length - 1 ? own : fx[parts.slice(0, i + 1).join("/")]; return Array.isArray(e) && e.some(n => kind.test(String(n))); });
}
/** Whether other text layers share t's path and t's record entry doesn't say its own effects (older than VERSION 12). */
const unsure = (rec, t) => !Array.isArray(t?.effects) && Array.isArray(rec?.text) && rec.text.filter(x => x?.layer === t?.layer).length > 1;
/** The same for an enabled Gradient Overlay: the letters are drawn in the old ones' shades (erase's profile). */
export const gradientOn = (rec, path, t = null) => oneColour(rec, path, /^GradientOverlay$/, t);
/** The record's Stroke [r, g, b] (psd_details: the layer's or its group's; an opaque rim's: centred or a gradient's), or null. */
const strokeOf = t => (Array.isArray(t?.stroke) && t.stroke.length === 4 && t.stroke[3] > 0 ? t.stroke.slice(0, 3)
  : Array.isArray(t?.rim) && t.rim.length === 5 && t.rim[3] > 0 && t.rim[4] === 100 ? t.rim.slice(0, 3) : null);
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const hexRgb = h => (/^#[0-9a-f]{6}$/i.test(h || "") ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null);
/** A record text layer's main fill [r, g, b]: the colour most of its letters are in (build_site layer_inks' main ink,
 *  which cards.json `ink` leaves out), however few; null without one, or under an enabled overlay (oneColour). */
export function mainInk(rec, t) {
  if (!t?.layer || oneColour(rec, t.layer, OVERLAY, t)) return null;
  const cs = Array.isArray(t.colors) && t.colors.length ? t.colors : [t.color], text = String(t.text ?? "");
  if (!Array.isArray(t.runs) || !t.runs.length) return cs.length === 1 ? hexRgb(cs[0]) : null;
  const n = new Map();
  for (const [a, b, i] of t.runs) for (let x = a; x < b; x++) if (text[x] && !/\s/.test(text[x])) n.set(cs[i], (n.get(cs[i]) || 0) + 1);
  const best = [...n].sort((x, y) => y[1] - x[1])[0];
  return (best && hexRgb(best[0])) || null;
}

// ---- drawing (canvas; the browser)
const fontFaces = new Map();                          // font name -> Promise<family | "">
let fontsP = null, fontMap = null;                    // data/fonts.json: its promise, its fonts once loaded
const NOTDEFS = new Map();                            // family (draw's fam) -> {adv: ems, path: Path2D | null}: its .notdef
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
    fontsP ||= getFonts().then(d => (d && typeof d.fonts === "object" ? d.fonts : {}), () => ({})).then(m => (fontMap = m));
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
/** measure(t, z): t's width at size z in fam, tracked (ems) and widened (hx) as the layer's letters. */
const widthIn = (ctx, fam, track, hx) => (t, z) => {
  ctx.font = `${z}px ${fam}`;
  if (!track) return ctx.measureText(t).width * hx;
  ctx.letterSpacing = `${track * z}px`; const w = ctx.measureText(t).width * hx; ctx.letterSpacing = "0px"; return w;
};

/** Draw the mock-up into canvas: the card image (src, same origin) with `edit`'s PSD fields over it. opts: {card, src, rec
 *  (details record or null), edit, psd (the image's values), icons, getFonts, raw, onFont (a font has loaded: draw
 *  again), stale (a newer draw started: drop this one), fills (colourize's)}. Drawn off-screen, then copied. Returns
 *  {drawn: [labels], skipped, boxed: [labels drawn in a box], over: [labels too long for their place, at 40%, or whose
 *  new words went under a picture over them: putCover], refused:
 *  [[label, why]] (stars, types or colours the bake would refuse), fonts: {name: family | ""}, standIn: [labels without
 *  a font name], added: an added ability's box from "room" (the bake's, addRoom) or "template", else null (none, or
 *  drawn as the bake sets it: addLook)} or null
 *  (the image didn't load, or stale). plate: the card's plates file (card_plates, the plates branch: picture 1's
 *  backdrop under each text layer, its layout; another picture's own titles' too) or null. */
let eraseMemo = null;                                // the last draw's erase pass (draw)
export async function draw(canvas, { card, src, rec, edit, psd, icons, getFonts, raw, onFont, statuses = null, fills = null, stale = () => false, plate = null }) {
  const seq = (canvas._seq = (canvas._seq || 0) + 1);   // the newest draw on a canvas wins (one with the plate may end first)
  const img = await loadImage(src);
  if (!img || stale()) return null;
  const mine = plate?.v === 1 && plate.w === rec?.canvas?.w, ours = mine && (card?.variant || 1) === 1;   // ours: picture 1's
  const sheet = mine && Array.isArray(plate.crops) && plate.crops.length ? await loadImage(plate.img) : null;   // any picture: plateCuts checks each crop
  const pics = ours && plate.bars?.vw > 0 && Array.isArray(plate.bars.cuts) ? plate.bars : null;   // the bake's stat pictures
  const spics = mine ? starSheet(plate, card?.variant || 1) : null;   // its stars pictures, this picture's
  const readPlate = (c, w, h) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(sheet, ...c.at, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
  const coverImgs = sheet && Array.isArray(plate.covers) ? await Promise.all(plate.covers.map(c => (typeof c?.img === "string" ? loadImage(c.img) : null))) : [];   // pictures over a layer (coverCuts)
  if (stale()) return null;
  const readCover = (c, w, h) => { const im = coverImgs[plate.covers.indexOf(c)]; if (!im?.naturalWidth) return null;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
  const W = img.naturalWidth, H = img.naturalHeight, shape = shapeOf(W, H), tpl = TEMPLATES[shape];
  const work = document.createElement("canvas"); work.width = W; work.height = H;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const txt = s => String(s ?? "").replace(/\r/g, "").trim(), typed = ["name", "ability"].filter(f => (f in edit && txt(edit[f]) !== txt(psd[f])) || partJobs(rec, edit.parts).some(j => j.role === f));
  let px0 = null;                                     // the card's pixels: mixed's, then the draw's
  const mixed = (x, f) => !!(sheet && rec?.canvas?.w > 0 && mixPlan((px0 ||= ctx.getImageData(0, 0, W, H)).data, W, H, W / rec.canvas.w, plate, [x?.id], [{ field: f, color: "#808080" }], f, readPlate));
  const own = keptOver(rec, edit.colors, typed, statuses), rest = own.length ? edit.colors.filter(one => !own.some(n => n.one === one)) : edit.colors;
  const nix = [...own, ...paintedOver(rec, rest, typed, edit, mixed)].sort((a, b) => edit.colors.indexOf(a.one) - edit.colors.indexOf(b.one));   // the bake refuses them, or only a redraw could draw them: not drawn, said
  if (nix.length) edit = { ...edit, colors: edit.colors.filter(one => !nix.some(n => n.one === one)) };
  const todo = changes(edit, psd), out = { drawn: [], skipped: [], boxed: [], over: [], refused: nix.map(n => [n.label, n.why]), fonts: {}, standIn: [], site: [], starsKept: null, added: null, noGlyph: [] };
  const hand = pics ? [] : handStats(card);           // the bake won't draw them: not drawn, nothing said (owner 11-11); a plate's bars tell value by value
  for (const k of Object.keys(todo.stats)) if (hand.includes(k.split("@")[0])) delete todo.stats[k];
  todo.skipped = todo.skipped.filter(label => !hand.includes(label.toLowerCase()));
  for (const label of todo.skipped) {                 // a stat past what its bar prints stays on the website
    const k = label.toLowerCase(), why = statSite(rec, k, edit[k]);
    if (barCut(pics, k, psd[k], edit[k])) todo.stats[k] = [psd[k], edit[k]];   // the bake's picture of it
    else if (why) out.site.push([`${label} ${edit[k]}`, why]);
    else if (compBar(rec, k) && Number.isInteger(psd[k]) && psd[k] >= 0 && psd[k] <= 10 && edit[k] > 10 && edit[k] <= 20
      && (psd[k] > 0 || compLit(rec, k))) todo.stats[k] = [psd[k], edit[k]];   // its comps' two half rows
  }                                                   // else not drawn, nothing said (owner 11-11)
  const listed = creatureSite(edit, psd);             // the bake's website-only creatures: said, as the Rendered tab does
  if (listed) { out.site.push(["The creature list", listed]); for (const k of Object.keys(todo.stats)) if (k.includes("@")) delete todo.stats[k]; }
  if (todo.name != null && titleInPicture(rec)) { out.site.push(["name", "title"]); todo.name = null; }   // the dialog's note
  const starCut = todo.stars && barCut(spics, "stars", ...todo.stars), starImg = starCut ? await loadImage(spics.img) : null;
  if (stale()) return null;
  const pasteStars = data => { putBar(data, W, H, barPixels(starImg, starCut, W / spics.vw)); out.drawn.push("stars"); todo.stars = null; };
  const kept = todo.stars && !starImg && starsKept(rec?.header?.stars, todo.stars[1]), moved = kept && starMove(card?.psd, todo.stars[1]);
  if (kept) { if (moved) out.starsKept = { why: kept, to: moved.to }; else out.refused.push(["stars", kept]); todo.stars = null; }   // the picture's stay
  const blit = () => { if (stale() || canvas._seq !== seq) return null; canvas.width = W; canvas.height = H; canvas.getContext("2d").drawImage(work, 0, 0); return out; };
  if (!tpl) {                                         // no template: the bake's stat pictures alone
    const got = Object.entries(todo.stats).map(([k, [from, to]]) => [k, barCut(pics, k, from, to)]).filter(([, c]) => c);
    const sheetImg = got.length ? await loadImage(pics.img) : null;
    if (stale()) return null;
    if (sheetImg || starImg) {
      const px = ctx.getImageData(0, 0, W, H);
      if (sheetImg) for (const [k, c] of got) { putBar(px.data, W, H, barPixels(sheetImg, c, W / pics.vw)); out.drawn.push(statLabel(k)); }
      if (starImg) pasteStars(px.data);
      ctx.putImageData(px, 0, 0);
    }
    out.skipped.push(...[todo.name != null && "name", todo.ability != null && "text", todo.stars && "stars", todo.types && "types"].filter(Boolean));   // stats: nothing said (owner 11-11)
    return blit();
  }
  const pixels = px0 || ctx.getImageData(0, 0, W, H), L = luma(pixels.data);
  const raced = async name => {                     // a loaded font at once; null: still loading (onFont draws again)
    const p = loadFont(name, { getFonts, raw }), got = await Promise.race([p, new Promise(r => setTimeout(() => r(null), 60))]);
    if (got === null) p.then(f => { if (f) onFont?.(); });
    return got;
  };
  const family = async (role, label, path = "", id = "", look = null) => {   // path, id: a part's own layer (a split title's share a path); look: an added ability's
    const mine = t => t && (id && t.id != null ? String(t.id) === id : t.layer === path) && (t.lf || !ICON_FONT.test(String(t.font || "")));
    const own = path && Array.isArray(rec?.text) ? rec.text.find(mine) : null;
    const layer = look || own || layerOf(rec, role), name = layer?.lf || layer?.font || "";   // lf: the font most of its letters use
    const fam = (name && await raced(name)) || "";
    if (name) out.fonts[name] = fam; else out.standIn.push(label);
    const gaps = fam ? fontMap?.[name] : null;
    let mfam = "";
    if (gaps?.lacks && fontMap?.[MGP_FONT]) mfam = (await raced(MGP_FONT)) || "";   // the letters it lacks fall back to Myriad Pro, as the bake's last pick
    const fr = {};
    for (const f of new Set((Array.isArray(layer?.fr) ? layer.fr : []).map(r => r?.[2]))) {   // letters set in another font (psd_details fr)
      const got = typeof f === "string" && f !== name ? await raced(f) : "";
      const m = got && fontMap?.[f]?.lacks && fontMap?.[MGP_FONT] ? mfam || (await raced(MGP_FONT)) || "" : mfam;   // the letters it lacks: Myriad Pro
      if (got) fr[f] = `"${got}", ${m ? `"${m}", ` : ""}${STAND_IN}`;
    }
    return { fam: fam ? `"${fam}", ${mfam ? `"${mfam}", ` : ""}${STAND_IN}` : STAND_IN, layer, gaps, fr };
  };
  const badgeFont = labelFont();
  let bfam = await Promise.race([badgeFont, new Promise(r => setTimeout(() => r(null), 60))]);
  if (bfam === null) { badgeFont.then(f => { if (f) onFont?.(); }); bfam = ""; }
  const scaled = b => b.map((v, i) => v * (i % 2 ? H : W));
  const bars = barRows(shape, W, H, card, rec).map(r => (isBar(L, W, H, r.box) ? r : labelRow(L, W, H, rec, r)))   // the rows drawn on: the template's, else beside the stat's label
    .filter(r => r && !(rec?.stats?.[r.k] === "pixel" && !rowShows(L, W, H, r, psd[r.k])));   // a drawn bar: only where it shows the card's value
  const rows = barRows(shape, W, H, card, null), seen = rows.filter(r => isBar(L, W, H, r.box)), lowest = seen.length ? seen : rows;
  const barsBottom = lowest.length ? Math.max(...lowest.map(r => r.box[3])) : 0;   // the text starts below the card's stat rows (where they are seen, else the template's)
  const jobs = [], kc = rec?.canvas?.w > 0 ? W / rec.canvas.w : 0;
  const specs = [["name", todo.name, psd.name, "name"], ["ability", todo.ability, psd.ability, "text"]].filter(x => x[1] != null).map(([role, text, old, label]) => ({ role, text, old, label }));
  const boxes = obj(edit.parts), tinted = !boxes && obj(rec?.parts) ? specs.filter(s => txt(s.text) === txt(s.old) && printed(rec.parts, s.role).length > 1).map(s => s.role) : [];   // a colour alone on a field of several layers
  const partly = partJobs(rec, boxes || (tinted.length ? {} : null), { colors: todo.colors, was: todo.colors && psd.colors, statuses }).filter(j => boxes || tinted.includes(j.role));
  if (obj(rec?.parts) && boxes) specs.length = 0;   // one box per layer: each changed layer in its own box, not the joined fields
  else specs.splice(0, specs.length, ...specs.filter(s => !tinted.includes(s.role)));   // each of its layers recoloured in its own box
  for (const j of partly) specs.push({ role: j.role, text: j.text, old: j.old, label: j.role === "name" ? "name" : "text", own: j.box && kc ? j.box.map(v => v * kc) : null, added: j.added, part: true, path: j.layer, id: j.added ? "" : j.id, colors: j.colors });
  if (sheet && kc) specs.push(...followSpecs(rec, plate, specs, kc));   // their copies elsewhere, as the bake writes them
  const fams = [];
  const look = Array.isArray(rec?.addRoom) && obj(rec?.addLook) && rec.addLook.px > 0 ? { ...rec.addLook, added: true } : null;   // how the bake sets an added ability
  for (const { role, label, path, id, added } of specs) fams.push(await family(role, label, path, id, added ? look : null));
  const split = splitWhy(ctx, rec, specs, fams, kc, W);   // the bake refuses every box edit then (field parts): said, none drawn
  if (split) {
    out.refused.push(["name", split]);
    for (let k = specs.length - 1; k >= 0; k--) if (specs[k].part) { specs.splice(k, 1); fams.splice(k, 1); }
    for (const j of partJobs(rec, {}, { colors: todo.colors, was: todo.colors && psd.colors, statuses })) {   // its colours still bake (field colors), on the card's own text
      specs.push({ role: j.role, text: j.text, old: j.old, label: j.role === "name" ? "name" : "text", own: j.box && kc ? j.box.map(v => v * kc) : null, part: true, path: j.layer, id: j.id, colors: j.colors });
      fams.push(await family(j.role, specs[specs.length - 1].label, j.layer, j.id));
    }
  }
  for (const [k, s] of specs.entries()) {             // typed letters its font can't draw: as the bake sets them
    const { fam, gaps, layer } = fams[k];
    if (s.text == null || typeof gaps?.lacks !== "string" || !Array.isArray(gaps.notdef)) continue;
    const plan = glyphPlan(s.text, s.added ? "" : s.old, gaps.lacks, (x, from) => glyphFont(rec, layer, x[0], fontMap, false, from),
      typeof gaps.empty === "string" ? gaps.empty : "", c => glyphFont(rec, layer, c, fontMap, true)), [adv, d] = gaps.notdef;
    if (plan.fonts.size) {                            // each picked font's family, once loaded (else the stand-in's)
      const names = [...new Set(plan.fonts.values())], loaded = new Map();
      for (const name of names) { const f = await raced(name); loaded.set(name, f ? `"${f}", ${STAND_IN}` : STAND_IN); }
      const tag = `g-${[...plan.fonts].map(([c, f]) => `${c.codePointAt(0).toString(16)}.${names.indexOf(f)}`).join("-")}`;
      fams[k] = { ...fams[k], fam: `${fam}, "${tag}"` };   // its own family list (the tag never matches): PICKED's key
      PICKED.set(fams[k].fam, new Map([...plan.fonts].map(([c, f]) => [c, loaded.get(f)])));
    }
    if (plan.text === s.text) continue;
    s.text = plan.text;
    const f2 = fams[k].fam;
    if (!NOTDEFS.has(f2)) NOTDEFS.set(f2, { adv: (+adv || 0) / 1000, path: d && typeof Path2D !== "undefined" ? new Path2D(d) : null });
    if (plan.boxes && !s.follow) out.noGlyph.push([s.label, plan.boxes, !d]);   // mockNote: a box, or a gap (an empty .notdef)
  }
  // the erase pass (where each old text is, erased) depends on none of the new text, colours or statuses: a redraw that
  // changed only those (typing) starts from the last one's pixels
  const fxWords = sheet ? plate.crops.flatMap(c => c.fx || []) : [];   // the plate picked follows these (plateCuts)
  const idsOf = (s, k) => { const ids = s.part ? [s.id] : printed(obj(rec?.parts) || {}, s.role).map(p => p?.id); return ids.length ? ids : [fams[k].layer?.id]; };
  const flat = (s, k) => s.role === "name" && titleOff(rec, fams[k].layer?.layer, s.part ? s.colors : todo.colors);   // redrawn flat, not tinted
  const mixes = specs.map((s, k) => (sheet && kc && !s.added && s.text != null && txt(s.text) === txt(s.old) ? mixPlan(pixels.data, W, H, kc, plate, idsOf(s, k), todo.colors, s.role, readPlate) : null));   // the bake's looks of it
  const tints = specs.map((s, k) => (!mixes[k] && sheet && !s.added && s.text != null && txt(s.text) === txt(s.old) && !(Array.isArray(psd.colors) && psd.colors.some(o => o.field === s.role)) && !flat(s, k)
    ? tintPlan(pixels.data, W, plate, idsOf(s, k), kc, s.old, fams[k].layer, s.part ? s.colors : todo.colors, s.role, statuses, s.role === "ability" && ownOverlay(rec, fams[k].layer?.layer, fams[k].layer) ? readPlate : null) : null));   // a colour alone: recoloured in place
  const wiping = sheet ? specs.flatMap((s, k) => (s.added || tints[k] || mixes[k] ? [] : idsOf(s, k))) : [];   // the layers this draw wipes
  const sig = JSON.stringify([src, W, H, card?.id, bfam, barsBottom, rows.map(r => r.k), seen.length, fams.map(f => f.fam), tints.map(Boolean), mixes.map(Boolean),
    specs.map(({ role, text, old, label, own, added, part, path, id }) => [role, text == null, old, label, own, !!added, !!part, path, id, fxWords.map(w => count(text, w))])]);
  const reuse = eraseMemo?.sig === sig && eraseMemo.rec === rec && eraseMemo.icons === icons && eraseMemo.sheet === sheet;
  const plans = reuse ? eraseMemo.plans : [];
  const cardPx = reuse ? eraseMemo.card : specs.length ? pixels.data.slice() : null;   // before any erase: an Ability's kept lines, a title's splice
  if (reuse) pixels.data.set(eraseMemo.data);
  for (const [k, { role, text, old, label, own: partBox, added, part, colors: shared, follow }] of specs.entries()) {
    if (tints[k] || mixes[k]) { out.drawn.push(label); continue; }   // never erased: tinted or mixed below
    const { fam, layer, fr } = fams[k];
    const set = role === "ability" || role === "name" ? layer : null, fb = set?.fb ? FAUX_BOLD : 0, track = (Number.isFinite(set?.track) ? set.track / 1000 : 0) + fb, hx = set?.hx > 0 ? set.hx : 1;   // tracking (ems; faux bold adds its own), letter width (psd_details)
    const width = widthIn(ctx, fam, track, hx);
    const nd = NOTDEFS.get(fam), pk = PICKED.get(fam), measure = (t, z) => (glyphy(t, fam)   // glyphPlan's stand-ins and picks: as glyphText draws them
      ? glyphRuns(t, pk).reduce((w, r) => w + (typeof r === "number" ? r * ((nd?.adv || 0) + track) * z * hx : typeof r === "object" ? widthIn(ctx, r.fam, track, hx)(r.s, z) : width(r, z)), 0) : width(t, z));
    measure.track = track; measure.hx = hx; measure.fb = fb;
    measure.cap = z => capOf(ctx, fam, z);
    measure.label = bfam ? em => labelSet(ctx, bfam, em) : null;   // badges' labels: the font's (Roboto Black), once loaded
    const own = partBox || (part ? null : recordBox(rec, layer?.layer, W));
    const area = own ? { box: own, seed: [own[1], own[3]] } : role === "name" ? { box: scaled(tpl.name), seed: null } : textArea(shape, W, H, barsBottom);
    const colors = part ? shared : todo.colors;  // one box per layer: its share of the field's
    const one = role === "ability" && oneColour(rec, layer?.layer, OVERLAY, layer) && (abilityOff(rec, layer, colors) || unsure(rec, layer) ? "badges" : true);
    const ink = text == null || added ? null : baseInk(card, role, text, part ? old : null, role === "ability" ? statuses : null, role === "ability" ? layer?.heads : null);    // the card's own colours on what is unchanged
    if (added && layer?.added && own) { jobs.push({ role, text, label, area: { box: own, seed: null }, fam, layer, measure, icons, colors, statuses, kc, look: true }); continue; }   // as the bake sets it
    if (added) {                                      // top: at the top of the bake's area, as tall as its lines
      jobs.push({ role, text, label, area: { box: own || area.box, seed: null }, fam, layer, measure, icons, one, colors, statuses, boxed: true, top: !!own });
      if (own) out.added = Array.isArray(rec?.addRoom) ? "room" : "template"; else out.boxed.push(label);   // mockNote says where
      continue;
    }
    if (follow) {                                     // a follow layer elsewhere: its crop pasted, set where the bake re-lays it
      if (!reuse) {
        const cuts = plateCuts(pixels.data, W, H, kc, plate, readPlate, [specs[k].id], old, text, wiping), z = layer?.px * kc;
        const above = follow.over?.length ? plateCuts(cardPx, W, H, kc, plate, readPlate, follow.over, "", "", follow.over) : [];   // the layers over it
        const re = Array.isArray(follow.relaid) && follow.relaid.length ? follow.relaid.map(l => l.map(v => v * kc)) : null;   // its lines as the bake re-lays it
        const block = re && { box: [Math.min(...re.map(l => l[0])), Math.min(...re.map(l => l[1])), Math.max(...re.map(l => l[2])), Math.max(...re.map(l => l[3]))], lines: re, size: z, pitch: z * LINE, align: "center", mass: 0 };
        plans[k] = cuts && above && z > 0 && own ? (putCuts(pixels.data, W, cuts), { found: block || recordBlock(own, tokenize(old, icons), measure, z), size: z, above, plated: true,
          colours: { fill: follow.fill || mainInk(rec, layer) || hexRgb(layer.color), stroke: null } }) : {};
      }
      const { found, size: z, colours, above } = plans[k];
      if (found && text != null) jobs.push({ role, text, old, label, area, found, size: z, colours, fam, layer, fr, measure, icons, one, colors: null, statuses, ink, kc, card: cardPx, split: false, fit: 0, geo: geoOf(plate, [specs[k].id], kc), above, quiet: true });
      continue;
    }
    let plated = false, cover = null;
    const wipe = (box, opts) => {                     // erase's colours; with the card's plate, its pixels in place of erase's
      const ids = idsOf(specs[k], k), cuts = sheet && plateCuts(pixels.data, W, H, kc, plate, readPlate, ids, old, text, wiping);
      if (!cuts) return erase(pixels.data, W, H, box, opts);
      const [x0, y0, x1, y1] = px(box, W, H), keep = pixels.data.slice(y0 * W * 4, y1 * W * 4);
      const colours = erase(pixels.data, W, H, box, opts);
      for (let y = y0; y < y1; y++) pixels.data.set(keep.subarray(((y - y0) * W + x0) * 4, ((y - y0) * W + x1) * 4), (y * W + x0) * 4);
      putCuts(pixels.data, W, cuts); plated = true; cover = coverCuts(plate, readPlate, readCover, ids, kc, W, H);   // pictures over it: back on top
      return colours;
    };
    const findAndErase = () => {                      // -> {found, size, colours} | {deleted} | {skipped} | {} (boxed)
      const paras = tokenize(old, icons);
      const wrap = kc && set?.px > 0 && Array.isArray(set.frame) && set.frame.length === 4 ? (set.frame[2] - set.frame[0]) * kc : 0;   // box text's frame width
      const atSet = role === "name" && kc && layer?.px > 0 ? bestBlock(L, W, H, area, paras, measure, { name: true, wide: true, px: layer.px * kc, joins: [1.2, 4] }) : null;   // a title at the record's set size first
      const hit = atSet || bestBlock(L, W, H, area, paras, measure, { name: role === "name" })   // the block that holds the old text, or none
        || (wrap ? bestBlock(L, W, H, area, paras, measure, { px: set.px * kc, wrap }) : null);   // tight leading: at the record's set size
      if (hit) {
        const { cal } = hit, z = cal.size, b = role === "name" ? recordRows(hit.b, own, old, W) : hit.b;
        const strayTop = seen.length ? Math.min(area.box[1], barsBottom + 0.004 * H) : own ? area.box[1] : (TEMPLATES[shape].ability[1] - 0.06) * H;   // stat rows not seen where the template has them: look higher
        const { found, strays } = part && own && role === "ability" ? layerBlock(L, W, H, b, own, z, rows) : { found: b, strays: [] };   // one layer: its lines in its own box
        const gone = role === "name" ? hit.b.lines : part ? [...eraseLines(b), ...strays] : [...eraseLines(b), ...strayLines(L, W, H, b, { top: strayTop, bottom: H, bars: rows })];   // a name or one layer: its own lines
        const all = [Math.min(...gone.map(l => l[0])) - z, Math.min(...gone.map(l => l[1])) - z * 0.5, Math.max(...gone.map(l => l[2])) + z, Math.max(...gone.map(l => l[3])) + z * 0.5];
        const colours = wipe(all, { lines: gone, close: Math.round(z * 1.2), reach: Math.max(2, Math.round(z * 0.14)), cell: Math.max(6, z * 0.8), edge: 25, fill: mainInk(rec, layer), profile: gradientOn(rec, layer?.layer, layer), stroke: strokeOf(layer) });   // in the lines only: dim words too
        return text == null ? { deleted: true } : { found, size: z, colours };
      }
      if (text == null) return { skipped: true };
      if (own && kc && layer?.px > 0 && (part || printed(obj(rec.parts) || {}, role).some(p => p?.layer === layer.layer))) {   // not found: at the record's box, size and frame (a whole field's: its printed layer)
        const z = layer.px * kc, found = recordBlock(own, paras, measure, z, wrap, wrap ? layer.frame.map(v => v * kc) : null);
        const colours = wipe([own[0] - z, own[1] - z * 0.5, own[2] + z, own[3] + z * 0.5], { lines: found.lines, close: Math.round(z * 1.2), reach: Math.max(2, Math.round(z * 0.14)), cell: Math.max(6, z * 0.8), edge: 25, fill: mainInk(rec, layer), profile: gradientOn(rec, layer?.layer, layer), stroke: strokeOf(layer) });
        return { found, size: z, colours };
      }
      return {};
    };
    if (!reuse) plans[k] = Object.assign(findAndErase(), plated ? { plated, cover } : {});
    const { found, size: z, colours, deleted, skipped } = plans[k];
    if (deleted) out.drawn.push(`${label} (layer deleted)`);   // a deleted layer: erased only
    else if (skipped) out.skipped.push(`${label} (deleted layer)`);
    else if (found) jobs.push({ role, text, old, label, area, found, size: z, colours, fam, layer, fr, measure, icons, one, colors, statuses, ink, kc, card: cardPx, split: role === "name" && printed(obj(rec?.parts) || {}, "name").length > 1, fit: role === "ability" ? card?.abilityFit : keptFit(card, layer?.id),
      head: role === "name" && !(obj(rec?.parts)?.follow || []).some(f => f?.how === "copy" && idsOf(specs[k], k).some(id => (f.of || []).includes(id))) ? obj(rec?.header) : null,   // a title with copies keeps its size
      titleWas: role === "name" ? keptTitle(card, layer?.id) : null,
      geo: plans[k].plated ? geoOf(plate, idsOf(specs[k], k), kc) : null, cover: plans[k].cover || null, stack: part && role === "ability" ? stackRows(rec, specs[k].id, kc) : null, copies: sheet ? stackedOf(rec, plate, idsOf(specs[k], k), kc, layer, (colors || []).some(o => o?.field === role && !o.phrase)) : null,
      bare: plans[k].plated && fxIn(plate, idsOf(specs[k], k), old) ? () => plateCuts(cardPx, W, H, kc, plate, readPlate, idsOf(specs[k], k), old, "", wiping) : null });   // the crop without its FX layers
    else { jobs.push({ role, text, label, area: part || role === "name" ? { box: area.box, seed: null } : area, fam, layer, measure, icons, one, colors, statuses, ink, boxed: true }); out.boxed.push(label); }   // a layer's or the title's box: covered, never the card below it
  }
  if (!reuse) eraseMemo = { sig, rec, icons, sheet, plans, data: pixels.data.slice(), card: cardPx };
  for (const t of tints) if (t) tintInPlace(pixels.data, W, H, kc, t, readPlate);   // after the memo: it never holds tinted pixels
  for (const m of mixes) if (m) paintMix(pixels.data, W, m);
  const shown = { ...psd };                            // the values the rows show as they are redrawn
  const cuts = Object.entries(todo.stats).map(([k, [from, to]]) => barCut(pics, k, from, to));
  const picsImg = cuts.some(Boolean) ? await loadImage(pics.img) : null;
  if (stale()) return null;
  for (const [n, [k, [from, to]]] of Object.entries(todo.stats).entries()) {
    if (cuts[n] !== undefined) {                      // the card's pictured bars: the bake's picture, or none (it refuses the value)
      if (cuts[n] && picsImg) { putBar(pixels.data, W, H, barPixels(picsImg, cuts[n], W / pics.vw)); shown[k] = to; out.drawn.push(statLabel(k)); }
      continue;
    }
    const row = bars.find(r => r.k === k);
    if (!row) continue;                               // no row found (a creature's past 1: never cells): not drawn, nothing said (owner 11-11)
    const lit = from === 0 ? bars.filter(r => r !== row && shown[r.k] >= 1 && shown[r.k] <= r.cells).sort((a, b) => Math.abs(a.box[1] - row.box[1]) - Math.abs(b.box[1] - row.box[1])).map(r => ({ row: r, v: shown[r.k] })) : [];
    if (lit.length) to > row.cells ? paintComp(pixels.data, W, H, row, from, to, lit) : paintLit(pixels.data, W, H, row, lit, to);   // no lit cell on the row: another row's
    else if (from === 0 && to > row.cells) continue;  // none anywhere: not drawn
    else (to > row.cells ? paintComp : paintCells)(pixels.data, W, H, row, from, to);
    shown[k] = to; out.drawn.push(k.toUpperCase());
  }
  if (starImg) pasteStars(pixels.data);              // the bake's stars: no erase, no starPlan
  const head = obj(rec?.header), k = rec?.canvas?.w > 0 ? W / rec.canvas.w : 0, at = b => b.map(v => v * k);
  const icons2 = [];                                  // [label, plan] for the stars and types
  if (todo.stars) icons2.push(["stars", k ? starPlan(head?.stars, ...todo.stars) : { boxed: true, refused: null }]);
  const first = head?.types === null && tpl.first ? scaled(tpl.first).map(v => v / k) : null;   // no type icon on the card
  if (todo.types) icons2.push(["types", k ? backPlan(head?.types_back, todo.types[1]) || typePlan(head?.types, todo.types[1], first) : { boxed: true, refused: null }]);
  const tp = icons2.find(([label]) => label === "types")?.[1], under = ours && tp?.gone?.length && obj(plate.under) && ["icons", "patch", "reach"].every(f => Array.isArray(plate.under[f])) ? plate.under : null;
  const which = under ? tp.gone.map(i => under.icons.findIndex(b => String(b) === String(head.types.row[i].box))) : [];   // the plate's icon for each gone
  const uImg = under && !which.includes(-1) ? await loadImage(under.img) : null;   // the card without its type icons
  if (stale()) return null;
  let pasted = false;
  if (uImg?.naturalWidth && Array.isArray(under.box)) {
    const p = under.pitch, last = under.icons.length + under.patch.filter(Boolean).length, uh = uImg.naturalHeight - last * p;
    const [x0, y0, x1, y1] = px(at(under.box), W, H), w = x1 - x0, h = y1 - y0, band = b => drawn(uImg, 0, b * p, uImg.naturalWidth, uh, w, h).getImageData(0, 0, w, h).data;
    if (p > 0 && uh > 0 && w > 0 && h > 0) pasted = pasteUnder(pixels.data, W, [x0, y0, w, h], band(0), drawn(img, x0, y0, w, h, w, h).getImageData(0, 0, w, h).data,
      under.icons.map((_, k) => band(k + 1)), under.patch.map(b => (b ? band(b) : null)), under.reach.map(r => { const q = px(at(r), W, H); return [q[0] - x0, q[1] - y0, q[2] - x0, q[3] - y0]; }), which);
  }
  for (const [label, plan] of icons2) if (!plan.boxed && !(pasted && label === "types")) for (const b of plan.erase) { const g = at(b); fillBox(pixels.data, W, H, [g[0] - 2, g[1] - 2, g[2] + 2, g[3] + 2], { pad: Math.max(2, Math.round(W * 0.004)) }); }   // types pasted: no fill
  ctx.putImageData(pixels, 0, 0);
  for (const [label, plan] of icons2) {
    if (plan.refused) out.refused.push([label, plan.refused]);
    if (plan.boxed && !(label === "stars" ? +todo.stars[1] : todo.types[1]?.length)) { out.skipped.push(label); continue; }   // none, with no place: the old ones stay
    if (plan.boxed) { out.boxed.push(label); await drawIconBox(ctx, label, label === "stars" ? todo.stars[1] : todo.types[1], { icons, head, W, H, tpl }); }
    else if (label === "stars") {
      const src = await starSource(head.stars, icons, img, k);
      const look = !src.crop && plan.draw.length ? await iconLook(img, head.stars.units.map(u => ({ name: head.stars.icon, core: u.core })), icons, k) : null;   // the stock star in the card's star colours
      for (const b of plan.draw) drawIcon(ctx, look ? recolour(src, look, at(b)) : src, at(b));
    }
    else {
      let look = plan.draw.length ? await iconLook(img, head?.types?.row, icons, k, true) : null;   // the bake copies a shown icon's look
      if (plan.draw.length && ours && plate.typeProbe?.vw > 0 && Array.isArray(plate.typeProbe.probes)) look = await probeLook(plate.typeProbe, icons, k, W, look);
      for (const d of plan.draw) { const im = await iconOf(icons, d.name); drawIcon(ctx, look && im ? recolour(im, look, at(d.core), true) : im, at(d.core), true); }
    }
    out.drawn.push(label);
  }
  const looks = mine && kc && Array.isArray(plate.letters) ? plate.letters : [], lookImg = looks.length ? await loadImage(plate.img) : null;
  if (stale()) return null;
  for (const job of jobs) {
    const imgs = await iconImages(job.text, icons);
    const j = { ...job, fills: job.one ? null : fills, tex: lookImg && letterLook(lookImg, looks, job.layer?.id, kc) };   // under an overlay: painted over, as the bake's
    if ((j.look ? drawAdded(ctx, j, imgs) : j.boxed ? drawBox(ctx, j, imgs, W, H, shape) : drawText(ctx, j, imgs, W)) && !j.quiet) out.over.push(j.label);
    if (j.above?.length) putOver(ctx, W, j.above, cardPx);
    if (j.cover && putCover(ctx, W, j.cover, cardPx, oldInk(j), j.size * 0.15) && !j.quiet && !out.over.includes(j.label)) out.over.push(j.label);   // its words under them: said
    if (!j.quiet) out.drawn.push(job.label);
  }
  return blit();
}
/** An icon's image by name (S.icons, norm keys), or null. */
const iconOf = async (icons, name) => { const ic = icons?.[norm(name)]; return ic?.file ? loadImage(ic.file) : null; };
/** A text layer's letter look (card_plates letters: the card with its letters an opaque band of their colour under its
 *  clipped textures) cut from the plate's sheet: {img, box (image px), fill}, or null. */
function letterLook(sheet, looks, id, kc) {
  const t = id == null ? null : looks.find(x => String(x.id) === String(id) && Array.isArray(x.box) && x.box.length === 4 && Array.isArray(x.at) && x.at[2] > 0 && x.at[3] > 0);
  if (!t) return null;
  const img = document.createElement("canvas"); img.width = t.at[2]; img.height = t.at[3];
  img.getContext("2d").drawImage(sheet, ...t.at, 0, 0, t.at[2], t.at[3]);
  return { img, box: t.box.map(v => v * kc), fill: hexRgb(t.fill) };
}
/** tex (letterLook) as a fill style: its pixels where they sit on the card, under any transform; null when a letter of
 *  colour c (a run's, else the layer's) is not tex's (its look was made in that colour). */
function texture(ctx, tex, c) {
  const k = c ? hexRgb(c) : null;
  if (!tex || (c && !(k && tex.fill && k.every((v, i) => Math.abs(v - tex.fill[i]) <= 3)))) return null;
  const [x0, y0, x1, y1] = tex.box, pat = ctx.createPattern(tex.img, "no-repeat");
  pat.setTransform(ctx.getTransform().invertSelf().translateSelf(x0, y0).scaleSelf((x1 - x0) / tex.img.width, (y1 - y0) / tex.img.height));
  return pat;
}
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
/** The card's own colours on its type or star icons (fitLook), or null: each shown icon's stock picture fitted into its
 *  core (solid: by its opaque part), against the image there. */
async function iconLook(img, row, icons, k, solid = false) {
  const pairs = [];
  for (const u of Array.isArray(row) ? row : []) {
    const im = await iconOf(icons, u.name), sw = im?.naturalWidth, sh = im?.naturalHeight;
    if (!sw || !sh || !Array.isArray(u.core)) continue;
    const o = solid ? opaqueBox(im) : [0, 0, sw, sh], b = u.core.map(v => v * k), s = Math.min((b[2] - b[0]) / (o[2] - o[0]), (b[3] - b[1]) / (o[3] - o[1]));
    const w = Math.round(sw * s), h = Math.round(sh * s), ow = solid ? (o[2] - o[0]) * s : w, oh = solid ? (o[3] - o[1]) * s : h;
    const x = Math.round(b[0] + (b[2] - b[0] - ow) / 2 - o[0] * s), y = Math.round(b[1] + (b[3] - b[1] - oh) / 2 - o[1] * s);
    const x0 = Math.max(0, x), y0 = Math.max(0, y), cw = Math.min(img.naturalWidth, x + w) - x0, ch = Math.min(img.naturalHeight, y + h) - y0;
    if (w < 4 || h < 4 || cw < 1 || ch < 1) continue;
    pairs.push([drawn(im, 0, 0, sw, sh, w, h).getImageData(x0 - x, y0 - y, cw, ch).data, drawn(img, x0, y0, cw, ch, cw, ch).getImageData(0, 0, cw, ch).data]);   // its part on the card
  }
  return fitLook(pairs);
}
/** A new type icon's look, checked on the bake's own made icons (p: the plate's typeProbe, a warm and a cool type):
 *  the shown icons' (shown, else stock colours) unless stock colours or a fit to both probes (fitLook's luma or channel
 *  map; each probe within 25 levels, so one hue's colours carried to the other fail: Galacta Knight's Ice drawn orange)
 *  draws them in half its error, fitLook's own rule. */
async function probeLook(p, icons, k, W, shown) {
  const v = W / p.vw, sets = [];
  for (const q of p.probes) {
    const im = Array.isArray(q.core) && Array.isArray(q.at) ? await iconOf(icons, q.name) : null, pim = im ? await loadImage(q.img) : null;
    const sw = im?.naturalWidth, sh = im?.naturalHeight;
    if (!sw || !sh || !pim || !(k > 0)) continue;
    const o = opaqueBox(im), b = q.core.map(c => c * k), s = Math.min((b[2] - b[0]) / (o[2] - o[0]), (b[3] - b[1]) / (o[3] - o[1]));
    const w = Math.round(sw * s), h = Math.round(sh * s);   // by its opaque part, as iconLook's solid
    const x = Math.round(b[0] + (b[2] - b[0] - (o[2] - o[0]) * s) / 2 - o[0] * s), y = Math.round(b[1] + (b[3] - b[1] - (o[3] - o[1]) * s) / 2 - o[1] * s);
    if (w < 4 || h < 4) continue;
    sets.push([drawn(im, 0, 0, sw, sh, w, h).getImageData(0, 0, w, h).data, drawn(pim, x / v - q.at[0], y / v - q.at[1], w / v, h / v, w, h).getImageData(0, 0, w, h).data]);
  }
  if (!sets.length) return shown;
  const err = (look, [st, th]) => { let e = 0, n = 0; for (let i = 0; i < st.length; i += 4) if (st[i + 3] >= 245) { const o = look ? lookMap(look, st[i], st[i + 1], st[i + 2]) : st.slice(i, i + 3); e += Math.abs(o[0] - th[i]) + Math.abs(o[1] - th[i + 1]) + Math.abs(o[2] - th[i + 2]); n++; } return n ? e / n / 3 : Infinity; };
  const mean = es => es.reduce((a, e) => a + e, 0) / es.length, base = mean(sets.map(t => err(shown, t)));
  const tried = shown ? [[null, mean(sets.map(t => err(null, t)))]] : [];
  if (sets.length > 1) for (const kind of ["luma", "chan"]) {
    const look = fitLook(sets, kind), es = look ? sets.map(t => err(look, t)) : [];
    if (look && Math.max(...es) < 25) tried.push([look, mean(es)]);
  }
  const [best] = tried.sort((a, b) => a[1] - b[1]);
  return best && Number.isFinite(base) && best[1] * 2 <= base ? best[0] : shown;
}
/** A recolouring from pairs [[stock, shown]] of RGBA arrays, on the stock's opaque pixels: luma -> colour (a Gradient
 *  Map, a Color Fill) or each channel -> itself (Curves, Levels, Exposure), 16 bins each, the closer one. Only when the
 *  shown pixels are far from the stock's (mean over 36 levels) and the map reads them within half of that and under
 *  25 levels; else null (stock colours, or the icon's own art). */
export function fitLook(pairs, kind = "") {
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
  if (kind) return looks.find(look => look[kind]);   // that kind, ungated (probeLook gates it)
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
/** A stock icon through a look, at box's size (solid: its opaque part's): {img, crop, solid?} for drawIcon. */
function recolour(im, look, box, solid = false) {
  const sw = im.naturalWidth, sh = im.naturalHeight, o = solid ? opaqueBox(im) : [0, 0, sw, sh];
  const s = Math.min((box[2] - box[0]) / (o[2] - o[0]), (box[3] - box[1]) / (o[3] - o[1]));
  const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
  const g = drawn(im, 0, 0, sw, sh, w, h), d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) d.data.set(lookMap(look, d.data[i], d.data[i + 1], d.data[i + 2]), i);
  g.putImageData(d, 0, 0);
  return { img: g.canvas, crop: [0, 0, w, h], ...(solid ? { solid: [o[0] * w / sw, o[1] * h / sh, o[2] * w / sw, o[3] * h / sh] } : {}) };
}
/** The box [x0, y0, x1, y1] of RGBA data's pixels at alpha >= 128 (psd_edit._icon_image's opaque part), or null. */
export function opaquePart(d, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}
const opaque = new WeakMap();
/** An icon image's opaque part, read once; the whole image when none. */
function opaqueBox(im) {
  if (!opaque.has(im)) { const w = im.naturalWidth, h = im.naturalHeight; opaque.set(im, opaquePart(drawn(im, 0, 0, w, h, w, h).getImageData(0, 0, w, h).data, w, h) || [0, 0, w, h]); }
  return opaque.get(im);
}
/** Where an sw x sh image goes so its part o fills box, centred, aspect kept: [x, y, w, h, the part's w, h]. */
export function fitPart(sw, sh, o, box) {
  const bw = box[2] - box[0], bh = box[3] - box[1], s = Math.min(bw / (o[2] - o[0]), bh / (o[3] - o[1])), ow = (o[2] - o[0]) * s, oh = (o[3] - o[1]) * s;
  return [box[0] + (bw - ow) / 2 - o[0] * s, box[1] + (bh - oh) / 2 - o[1] * s, sw * s, sh * s, ow, oh];
}
/** An icon (an image, or {img, crop}) fitted into box with a soft shadow for the PSD's drop shadow and glow. solid (a
 *  type icon): its opaque part fills the box, the glow around it, as the bake places it. */
function drawIcon(ctx, src, box, solid = false) {
  if (!src) return;
  const im = src.img || src, [sx, sy, sw, sh] = src.crop || [0, 0, im.naturalWidth, im.naturalHeight];
  if (!sw || !sh) return;
  const o = solid ? src.solid || (src.img ? [0, 0, sw, sh] : opaqueBox(im)) : [0, 0, sw, sh], [x, y, w, h, ow, oh] = fitPart(sw, sh, o, box);
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 0.06 * Math.max(ow, oh);
  ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h); ctx.restore();
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
  const files = new Set(tokenize(text, icons).flat(2).filter(p => p.icon).flatMap(p => [p.icon, p.sticker?.tint, p.sticker?.outline, p.vfile].filter(Boolean))), out = new Map();
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
/** ctx[how] ("fillText" | "strokeText") of t at 0, 0, glyphPlan's stand-ins and picks as the bake draws them: a mark
 *  plain, a picked letter in its font, a .notdef as the font's own (NOTDEFS: its outline, empty: a gap) at its advance,
 *  tracked. */
function glyphText(ctx, t, fam, z, track, how) {
  const nd = NOTDEFS.get(fam);
  if (!glyphy(t, fam)) return ctx[how](t, 0, 0);
  let x = 0;
  for (const r of glyphRuns(t, PICKED.get(fam))) {
    if (typeof r === "string") { ctx[how](r, x, 0); x += ctx.measureText(r).width; continue; }
    if (typeof r === "object") { const was = ctx.font; ctx.font = `${z}px ${r.fam}`; ctx[how](r.s, x, 0); x += ctx.measureText(r.s).width; ctx.font = was; continue; }
    for (let n = 0; n < r; n++, x += ((nd?.adv || 0) + track) * z) if (nd?.path) {
      const path = new Path2D(); path.addPath(nd.path, new DOMMatrix([z / 1000, 0, 0, -z / 1000, x, 0]));   // font units, y up
      if (how === "fillText") ctx.fill(path); else ctx.stroke(path);
    }
  }
}
/** im's alpha in box [x, y, w, h] grown by r px, in one colour: a layer Stroke round an icon. solid: every pixel im
 *  covers at all counts whole (the bake strokes a soft halo to its faintest edge). */
function outlineIcon(ctx, im, [x, y, w, h], colour, r, solid = false) {
  if (solid) {
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height); for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] ? 255 : 0;
    g.putImageData(d, 0, 0); im = c;
  }
  const pad = Math.ceil(r) + 2, c = document.createElement("canvas"); c.width = Math.ceil(w + 2 * pad); c.height = Math.ceil(h + 2 * pad);
  const g = c.getContext("2d");
  for (let k = 0; k < 32; k++) { const t = k / 16 * Math.PI; for (const f of [1, 0.66, 0.33]) g.drawImage(im, pad + Math.cos(t) * r * f, pad + Math.sin(t) * r * f, w, h); }
  g.globalCompositeOperation = "source-in"; g.fillStyle = rgb(colour); g.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(c, x - pad, y - pad);
}
const FX_BLEND = { screen: "screen", multiply: "multiply", normal: "source-over" };
/** The layer's Drop Shadows and Outer Glows (psd_details text fx, canvas px) under typed letters, as the bake casts
 *  them: the letters (and a Stroke set deeper, ws, at its opacity) grown by the spread, blurred as the fork's tent
 *  (sigma r / sqrt 6), moved, tinted and blended at the effect's opacity; on canvases cropped to the lines' reach. */
function paintEffects(ctx, lines, effects, { at, base, pitch, z, fam, track, hx }) {
  if (typeof CanvasRenderingContext2D === "undefined" || !("filter" in CanvasRenderingContext2D.prototype)) return;   // no canvas blur: the letters alone
  const T = ctx.getTransform(), s = Math.hypot(T.a, T.b) || 1, W = ctx.canvas.width, H = ctx.canvas.height;
  let x0 = Infinity, x1 = -Infinity;
  for (const line of lines) { const x = at(line); x0 = Math.min(x0, x); x1 = Math.max(x1, x + line.pieces.reduce((t, p) => t + (p.w || 0), 0)); }
  const y0 = base - 1.2 * z, y1 = base + (lines.length - 1) * pitch + 0.5 * z;
  for (const e of effects) {
    const blend = FX_BLEND[e.blend];
    if (!blend || !(e.opacity > 0) || !Array.isArray(e.color) || !(x1 > x0)) continue;
    const grow = e.size * (e.spread || 0) / 100, r = Math.max(0, e.size - grow), dx = e.dx || 0, dy = e.dy || 0;
    const pad = (e.ws || 0) + grow + 1.5 * r + Math.abs(dx) + Math.abs(dy) + 0.2 * z + 2;
    const xs = [], ys = [];
    for (const [x, y] of [[x0 - pad, y0 - pad], [x1 + pad, y0 - pad], [x0 - pad, y1 + pad], [x1 + pad, y1 + pad]]) { xs.push(T.a * x + T.c * y + T.e); ys.push(T.b * x + T.d * y + T.f); }
    const bx = Math.max(0, Math.floor(Math.min(...xs))), by = Math.max(0, Math.floor(Math.min(...ys)));
    const bw = Math.min(W, Math.ceil(Math.max(...xs))) - bx, bh = Math.min(H, Math.ceil(Math.max(...ys))) - by;
    if (bw <= 0 || bh <= 0) continue;
    const c = document.createElement("canvas"); c.width = bw; c.height = bh; const g = c.getContext("2d");
    g.setTransform(new DOMMatrix([1, 0, 0, 1, -bx, -by]).multiply(T)); g.textBaseline = "alphabetic"; g.fillStyle = g.strokeStyle = "#fff"; g.lineJoin = "round";
    lines.forEach((line, n) => {
      let x = at(line); const y = base + n * pitch;
      for (const p of line.pieces) {
        if (!p.icon && !p.badge && p.text?.trim()) {
          const pf = p.fam || fam;
          g.save(); g.font = `${z}px ${pf}`; if (track) g.letterSpacing = `${track * z}px`; g.translate(x, y); g.scale(hx, 1);
          if (e.ws > 0) { g.globalAlpha = (e.wo ?? 100) / 100; g.lineWidth = 2 * (e.ws + grow); glyphText(g, p.text, pf, z, track, "strokeText"); g.globalAlpha = 1; }   // the deeper Stroke
          if (grow > 0) { g.lineWidth = 2 * grow; glyphText(g, p.text, pf, z, track, "strokeText"); }
          glyphText(g, p.text, pf, z, track, "fillText"); g.restore();
        }
        x += p.w;
      }
    });
    const c2 = document.createElement("canvas"); c2.width = bw; c2.height = bh; const g2 = c2.getContext("2d");
    if (r > 0) g2.filter = `blur(${(r * s / Math.sqrt(6)).toFixed(3)}px)`;
    g2.drawImage(c, dx * s, dy * s); g2.filter = "none";
    g2.globalCompositeOperation = "source-in"; g2.fillStyle = rgb(e.color); g2.fillRect(0, 0, bw, bh);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(1, e.opacity / 100); ctx.globalCompositeOperation = blend; ctx.drawImage(c2, bx, by); ctx.restore();
  }
}
/** Lines of pieces from x at baseline base, z px: text with an outline, icons, badges as pills (a cooldown's ring its
 *  left end). one (an overlay on the ability): badges as outlined pills, rings and icons in one colour and stickers as
 *  an outline round the one-colour icon, in the text's fill ("badges": the overlay goes off, abilityOff, or may not be
 *  the layer's, unsure: icons in their own colours). shades (a Gradient Overlay's, shadesOf): letters without a colour in them.
 *  strokeW: the letters' outline width (the record's Stroke), else z * 0.16; strokeA: its opacity (0-1). effects:
 *  paintEffects' under them. tex: letterLook's, over the letters of its colour. fb: faux bold, letters dilated by fb
 *  ems. Every outline is drawn before any fill (one Stroke round the layer, as Photoshop's): a wide one never covers
 *  the letters beside it. */
export function paintLines(ctx, lines, { at, base, pitch, z, fam, label = null, fill, stroke, strokeW = 0, strokeA = 1, imgs, one = false, track = 0, hx = 1, shades = null, effects = null, tex = null, copies = null, fb = 0 }) {
  ctx.textBaseline = "alphabetic";
  if (effects?.length) paintEffects(ctx, lines, effects, { at, base, pitch, z, fam, track, hx });
  const copy = (c, how, g = ctx) => paintCopy(g, lines, { at, base, pitch, z, fam, track, hx, fill, stroke, strokeW, shades }, c, how);
  if (stroke && copies?.length) seeThrough(ctx, strokeA, g => { for (const c of copies) copy(c, "strokeText", g); });   // one outline round them all (the group's Stroke)
  for (const c of copies || []) if (!c.above) copy(c, "fillText");
  const bold = how => { if (fb) { ctx.lineJoin = "round"; ctx.strokeStyle = how; ctx.lineWidth = fb * z; } return fb; };   // faux bold: the fill dilated
  const pass = (ctx, rim) => lines.forEach((line, n) => {   // rim: the outlines, else the fills
    let x = at(line), y = base + n * pitch;
    for (const p of line.pieces) {
      if (p.icon && one && p.sticker && imgs.get(p.sticker.tint) && imgs.get(p.sticker.outline)) {
        if (rim) { x += p.w; continue; }
        const s = z * 1.05, r = s * STICKER_REACH, bx = x + (p.w - s) / 2, by = y - s * 0.82;
        paintMask(ctx, imgs.get(p.sticker.outline), [bx - r, by - r, s + 2 * r, s + 2 * r], fill, STICKER_LINE / (1 + 2 * STICKER_REACH));
        paintMask(ctx, imgs.get(p.sticker.tint), [bx, by, s, s], fill);
      } else if (p.icon) {
        const im = imgs.get(p.icon), s = z * 1.05, g = iconEm(p), ez = p.ez || z;   // ez: a spliced icon's own size
        const box = g ? [p.left ? x + (0.04 + g.pad) * ez : x + (p.w - g.w * ez) / 2, y - (0.82 - (1 - g.h) / 2) * ez, g.w * ez, g.h * ez] : [x + (p.w - s) / 2, y - s * 0.82, s, s];
        const near = line.pieces.slice(0, line.pieces.indexOf(p)).reverse().find(q => q.text?.trim()) || line.pieces.slice(line.pieces.indexOf(p) + 1).find(q => q.text?.trim());
        const tc = (p.ink && hexRgb(p.ink)) || (near?.color && hexRgb(near.color)) || fill;   // a variant in the text colour: its letters'
        const vim = p.vary && imgs.get(p.vfile), sq = (r) => { const side = Math.max(box[2], box[3]) * (1 + 2 * r); return [box[0] + box[2] / 2 - side / 2, box[1] + box[3] / 2 - side / 2, side, side]; };
        const ring = rim && strokeW > 0 ? (pic, b, solid) => outlineIcon(ctx, pic, b, stroke, strokeW / 2, solid) : () => {};   // the bake's Stroke round the glyph's ink
        const sign = (colour, extra) => {             // build_stoogedings prohibition: a ring and a bar on the icon box's middle
          const cx = g ? box[0] + box[2] / 2 : x + p.w / 2, cy = y - 0.32 * ez, r = 0.53 * ez, lw = 0.14 * r, k = Math.SQRT1_2 * (r - lw / 2);
          ctx.save(); ctx.strokeStyle = rgb(colour); ctx.lineWidth = lw + extra; ctx.beginPath(); ctx.arc(cx, cy, r - lw / 2, 0, 2 * Math.PI); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k); ctx.stroke(); ctx.restore();
        };
        if (vim && p.vary === "tint") { ring(vim, box); if (!rim) paintMask(ctx, vim, box, tc); }   // one colour: the text's
        else if (vim && (p.vary === "glow" || p.vary === "darkglow")) { const q = sq(VARIANT_REACH[p.vary]); ring(vim, q, true); if (!rim) ctx.drawImage(vim, ...q); }   // the halo with the icon on it (a Stroke makes the halo a disc)
        else {
          if (vim && p.vary === "sticker") { const q = sq(VARIANT_REACH.sticker); ring(vim, q); if (!rim) paintMask(ctx, vim, q, tc); }   // the outline in the text colour
          else if (im && g) ring(im, box);
          if (p.no && rim && strokeW > 0) sign(stroke, strokeW);
          if (!rim) { if (im && one === true) paintMask(ctx, im, box, fill); else if (im) ctx.drawImage(im, ...box); }   // under the Ability's overlay: in its colour, as the bake
        }
        if (p.no && !rim) sign([0xe0, 0x1b, 0x22], 0);
      } else if (p.badge) {
        const cap = capOf(ctx, fam, z), fitted = badgeFit(z, cap), { h, k } = pillOf(p, z, cap), top = y - fitted.top + (fitted.h - h) / 2, r = h / 2, em = h / PILL_EM;   // on the capitals' middle
        const lab = label ? label(em) : null, set = p.cost ? null : lab, side = lab ? 0.04 * em : z * 0.06 * k;
        const x0 = x + side, x1 = x + p.w - (p.tk || 0) / 1000 * em - side;     // a cooldown's ring: the pill's left end, its label after it; its tracking after
        const pill = (d = 0) => { ctx.beginPath(); ctx.moveTo(x0 + r, top + d); ctx.arcTo(x1 - d, top + d, x1 - d, top + h - d, r - d); ctx.arcTo(x1 - d, top + h - d, x0 + d, top + h - d, r - d); ctx.arcTo(x0 + d, top + h - d, x0 + d, top + d, r - d); ctx.arcTo(x0 + d, top + d, x1 - d, top + d, r - d); ctx.closePath(); };   // d: inset
        if (rim) {                                    // the layer's Stroke round the pill
          if (!one && strokeW > 0) { ctx.save(); pill(); ctx.lineJoin = "round"; ctx.strokeStyle = rgb(stroke); ctx.lineWidth = strokeW; ctx.stroke(); ctx.restore(); }
          x += p.w; continue;
        }
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
        const pf = p.fam || fam;                      // a spliced run in another font (psd_details fr)
        ctx.save(); ctx.font = `${z}px ${pf}`; if (track) ctx.letterSpacing = `${track * z}px`; ctx.translate(x, y); ctx.scale(hx, 1);
        if (rim) { ctx.lineJoin = "round"; ctx.strokeStyle = rgb(stroke); ctx.lineWidth = (strokeW || Math.max(1.5, z * 0.16)) + fb * z; glyphText(ctx, p.text, pf, z, track, "strokeText"); }   // round the dilated letters
        else {
          ctx.fillStyle = p.color || (shades ? shaded(ctx, shades, y) : rgb(fill)); glyphText(ctx, p.text, pf, z, track, "fillText");
          if (bold(ctx.fillStyle)) glyphText(ctx, p.text, pf, z, track, "strokeText");
          const look = texture(ctx, tex, p.color);     // over the flat fill: past its band, the flat colour
          if (look) { ctx.fillStyle = look; glyphText(ctx, p.text, pf, z, track, "fillText"); if (bold(look)) glyphText(ctx, p.text, pf, z, track, "strokeText"); }
        }
        ctx.restore();
      }
      x += p.w;
    }
  });
  if (stroke) seeThrough(ctx, strokeA, g => pass(g, true));
  pass(ctx, false);
  for (const c of copies || []) if (c.above) copy(c, "fillText");
}
/** draw(g) at opacity a (0-1): a see-through Stroke's outlines on a layer of their own, then onto ctx, so where they
 *  meet they don't add up; at 1 straight onto ctx. */
function seeThrough(ctx, a, draw) {
  if (!(a < 1)) return draw(ctx);
  const c = document.createElement("canvas"); c.width = ctx.canvas.width; c.height = ctx.canvas.height;
  const g = c.getContext("2d"); g.setTransform(ctx.getTransform()); g.textBaseline = ctx.textBaseline;
  draw(g);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= a; ctx.drawImage(c, 0, 0); ctx.restore();
}
/** A copy stacked on the lines (stackedOf's c): their letters moved by (dx, dy), outlined (how "strokeText") or filled in
 *  its fill, else each piece's colour; one that paints some channels only (Tainted Eden's: its blending restrictions)
 *  drawn apart and mixed into those. */
function paintCopy(ctx, lines, { at, base, pitch, z, fam, track, hx, fill, stroke, strokeW, shades }, c, how) {
  const T = ctx.getTransform(), mix = how === "fillText" && c.ch && c.ch.length < 3;
  let g = ctx, bx = 0, by = 0, bw = 0, bh = 0;
  if (mix) {                                          // its lines' reach, device px
    let x0 = Infinity, x1 = -Infinity;
    for (const line of lines) { const x = at(line); x0 = Math.min(x0, x); x1 = Math.max(x1, x + line.pieces.reduce((t, p) => t + (p.w || 0), 0)); }
    const pad = 0.3 * z + 2, xs = [], ys = [], y0 = base - 1.2 * z - pad + c.dy, y1 = base + (lines.length - 1) * pitch + 0.5 * z + pad + c.dy;
    for (const [x, y] of [[x0 - pad + c.dx, y0], [x1 + pad + c.dx, y0], [x0 - pad + c.dx, y1], [x1 + pad + c.dx, y1]]) { xs.push(T.a * x + T.c * y + T.e); ys.push(T.b * x + T.d * y + T.f); }
    bx = Math.max(0, Math.floor(Math.min(...xs))); by = Math.max(0, Math.floor(Math.min(...ys)));
    bw = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs))) - bx; bh = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys))) - by;
    if (!(bw > 0 && bh > 0) || !Number.isFinite(bw + bh)) return;
    const cv = document.createElement("canvas"); cv.width = bw; cv.height = bh;
    g = cv.getContext("2d", { willReadFrequently: true }); g.setTransform(new DOMMatrix([1, 0, 0, 1, -bx, -by]).multiply(T));
  }
  g.textBaseline = "alphabetic";
  lines.forEach((line, n) => {
    let x = at(line); const y = base + n * pitch;
    for (const p of line.pieces) {
      if (!p.icon && !p.badge && p.text?.trim()) {
        const pf = p.fam || fam;
        g.save(); g.font = `${z}px ${pf}`; if (track) g.letterSpacing = `${track * z}px`; g.translate(x + c.dx, y + c.dy); g.scale(hx, 1);
        if (how === "strokeText") { g.lineJoin = "round"; g.strokeStyle = rgb(stroke); g.lineWidth = strokeW || Math.max(1.5, z * 0.16); }
        else g.fillStyle = c.fill ? rgb(c.fill) : p.color || (shades ? shaded(g, shades, y) : rgb(fill));
        glyphText(g, p.text, pf, z, track, how); g.restore();
      }
      x += p.w;
    }
  });
  if (!mix) return;
  const src = g.getImageData(0, 0, bw, bh).data, im = ctx.getImageData(bx, by, bw, bh), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const a = src[i + 3] / 255; if (a) for (const k of c.ch) d[i + k] = Math.round(src[i + k] * a + d[i + k] * (1 - a)); }
  ctx.putImageData(im, bx, by);
}
/** The old lines' pitch: the mean of their middles' gaps within 30% of the median gap (capitals, badges or descenders
 *  move a line's middle: the least gap reads the leading tight). */
export function steadyPitch(lines) {
  const c = lines.map(l => (l[1] + l[3]) / 2), d = c.slice(1).map((v, i) => v - c[i]), m = median(d), ok = d.filter(x => x >= 0.7 * m && x <= 1.3 * m);
  return ok.length ? ok.reduce((t, x) => t + x, 0) / ok.length : m;
}
/** A laid line's ink [above, below] its baseline at z, as paintLines draws it (letters, a badge's pill, an icon). */
function lineInk(ctx, line, z, fam) {
  let up = 0, down = 0;
  for (const p of line.pieces) {
    if (p.badge) { const cap = capOf(ctx, fam, z), f = badgeFit(z, cap), { h } = pillOf(p, z, cap), t = f.top - (f.h - h) / 2; up = Math.max(up, t); down = Math.max(down, h - t); }
    else if (p.icon) { const g = iconEm(p), t = (g ? 0.82 - (1 - g.h) / 2 : 0.82 * 1.05) * z; up = Math.max(up, t); down = Math.max(down, (g ? g.h : 1.05) * z - t); }
  }
  const t = line.pieces.filter(p => !p.badge && !p.icon && p.text?.trim()).map(p => p.text).join("").trim();
  if (t) { ctx.font = `${z}px ${fam}`; ctx.textBaseline = "alphabetic"; const m = ctx.measureText(t); up = Math.max(up, m.actualBoundingBoxAscent || 0); down = Math.max(down, m.actualBoundingBoxDescent || 0); }
  return [up, down];
}
/** A laid line's first baseline from its ink top (top: a psd_details box's) at its set size s0, at z: the top plus its
 *  tallest piece above the baseline as paintLines draws it (letters' ink, a badge's pill, an icon's glyph), scaled from
 *  the frame's top when the text shrank; null when nothing on it reaches up. */
export function firstBase(ctx, line, { top, s0, z, frame, fam }) {
  let up = 0;
  for (const p of line?.pieces || []) {
    if (p.badge) { const cap = capOf(ctx, fam, s0), f = badgeFit(s0, cap), { h } = pillOf(p, s0, cap); up = Math.max(up, f.top - (f.h - h) / 2); }
    else if (p.icon) { const g = iconEm(p); up = Math.max(up, (g ? 0.82 - (1 - g.h) / 2 : 0.82 * 1.05) * s0); }
    else if (p.text?.trim()) { ctx.font = `${s0}px ${fam}`; ctx.textBaseline = "alphabetic"; const a = ctx.measureText(p.text.trim()).actualBoundingBoxAscent; if (Number.isFinite(a)) up = Math.max(up, a); }
  }
  if (!(up > 0)) return null;
  return frame ? frame[1] + (top + up - frame[1]) * z / s0 : top + up * z / s0;
}
/** The new text where the old block was: its size, line pitch and alignment, from its first line down (a PSD's text
 *  grows downwards), shrunk when it would run past the area; a title at its size (titleLayout), smaller where it newly
 *  prints over a star or type icon (titleFit). An Ability with the
 *  record's frame and px (box text) wraps at the frame at its set size, as the bake; with px and no frame (point
 *  text) each paragraph is one line (pointLayout), re-laid at a size it shrank to past the old text's (fit_below). An
 *  Ability or title a bake set smaller (the card's abilityFit, titleFit) starts from the card maker's size, as the next bake. */
function drawText(ctx, job, imgs, W) {
  let { role, text, old, area, found, size, colours, fam, layer, fr, measure, icons, one, colors, statuses, ink, kc, fills, card, geo, split, fit: was, tex, copies = null, cover = null } = job;
  const looked = (ps, s) => {                         // kept badges at their own size and tracking, typed ones tracked as the card's
    if (role === "ability" && Array.isArray(layer?.badges)) {
      const looks = badgeLooks(s, old, layer.badges); let i = 0;
      for (const para of ps) for (const chunk of para) for (const p of chunk) if (p.badge) Object.assign(p, looks[i++] || {});
    }
    return ps;
  };
  const paras = looked(colourize(tokenize(text, icons), text, colors, role, statuses, ink, null, fills), text), region = area.box;
  const mid = (found.box[0] + found.box[2]) / 2, wide = found.box[2] - found.box[0], room = 2 * Math.min(mid - region[0], region[2] - mid);
  const left = role === "name" ? layer?.just === 0 : found.align === "left";   // a title: left set in the PSD (psd_details just)
  const frame = role === "ability" && kc && Array.isArray(layer?.frame) && layer.frame.length === 4 ? layer.frame.map(v => v * kc) : null;   // box text's frame: Photoshop wraps there
  if (frame && layer.px > 0) size = layer.px * kc;    // at its set size
  const point = role === "ability" && !!kc && !frame && layer?.px > 0;   // point text: its paragraphs never wrap
  if (point) size = layer.px * kc;
  const stack = role === "ability" && job.stack && frame && layer.px > 0 ? job.stack : null;   // one of stacked boxes (stackRows)
  const grow = was > 0 && was < 1 && !stack ? 1 / was : 1;   // a bake set it smaller (its verdict's ability_fit): from the card maker's size, as the next bake
  size *= grow;
  const maxW = point ? Infinity : frame ? (left ? frame[2] - found.box[0] : frame[2] - frame[0]) : left ? region[2] - found.box[0] - W * 0.01 : role === "name" ? Math.max(wide, room * 0.96) : found.lines.length > 1 ? Math.min(wide * 1.06, Math.max(wide, room)) : Math.max(wide, room * 0.94);
  const steady = steadyPitch(found.lines) * grow, top = found.lines[0][1];
  const lead = !steady && kc && layer?.lead > 0 && (role === "name" || frame) ? layer.lead * kc * grow : 0;   // one line: its layer's own leading (psd_details lead), as the bake sets the next
  let pitch0 = steady || lead || size * LINE;
  const R = card && geo && !(Array.isArray(colors) && colors.length) ? recordLayout(geo.c, old, kc) : null, plan = R && geoPlan(R, text);
  // Room for an Ability at its size, as the bake leaves it (psd_edit fit_below, ink_beyond): its new ink ends no lower
  // than the old text's, or lower but on the card and off the design below (the backdrop under the old text, BEYOND).
  // With the card's own lines (its plate): the new ink where geoDraw sets it, the floor its inked lines'
  function roomBelow() {
    const H = ctx.canvas.height, k = kc || W / 1200, pad = 6 * k;
    const G = plan && !point && z === size && grow === 1 ? geoRoom(R, plan, paras, text, size, measure, pitch0, icons) : null;
    const h1 = Math.max(size * 0.5, (found.box[3] - top) * grow - (found.lines.length - 1) * pitch0), floor = (G ? G.floor : found.box[3]) + pad;
    let end = top + ((lines.length - 1) * pitch0 + h1) * (z / size), a = null, fl = 0;
    const ink = { z, fam, label: measure.label, track: measure.track, hx: measure.hx, fb: measure.fb, fill: [255, 255, 255], stroke: null, imgs, one };
    if (G) {                                          // its lowest ink row: by its lowest baseline, else drawn from the floor down
      if (G.low + z / 2 <= floor) return true;
      if (G.low - z > Math.max(H, floor)) return false;
      fl = Math.floor(floor);
      const m = document.createElement("canvas"); m.width = W; m.height = Math.max(1, Math.ceil(Math.max(H, G.deep + z)) - fl);
      const g = m.getContext("2d", { willReadFrequently: true }); g.translate(0, -fl);
      for (const p of G.paint) { const i = Math.max(0, Math.ceil((fl - z - p.base) / G.step)); if (i < p.lines.length) paintLines(g, p.lines.slice(i), { ...ink, at: p.at, base: p.base + i * G.step, pitch: G.step }); }
      a = g.getImageData(0, 0, W, m.height).data; end = 0;
      for (let y = m.height - 1; y >= 0 && !end; y--) for (let x = 0, j = y * W * 4 + 3; x < W; x++, j += 4) if (a[j] > 128) { end = fl + y + 1; break; }
    }
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
    if (!a) {
      const mask = document.createElement("canvas"); mask.width = W; mask.height = Math.max(1, H - from); fl = from;
      const mx = mask.getContext("2d", { willReadFrequently: true }); mx.translate(0, -from);
      paintLines(mx, lines, { ...ink, at: l => (left ? found.box[0] : mid - l.w / 2), base: top + z * 0.8, pitch: pitch0 * (z / size) });
      a = mx.getImageData(0, 0, W, mask.height).data;
    }
    let n = 0;
    for (let y = from, j = (from - fl) * W * 4 + 3; y < H; y++) for (let x = 0; x < W; x++, j += 4) if (a[j] > 128 && Math.abs(lum(x, y) - med) > bar) n++;
    return n < 100 * k * k;
  }
  // A stacked box as the bake sets it (psd_edit fit_below, stacked): at its size where it stays on the card, off the
  // other rows (stackRows) and off the design below (roomBelow); else smaller by FIT_STEP down to FIT_MIN, first in its
  // row (blank rows above kept: its first baseline rises by the leading it lost), then risen with them from the frame's
  // top and settled under the text above; ink ending no lower than the old ink's + BEYOND px.
  function stackFit() {
    const H = ctx.canvas.height, k = kc, pad = BEYOND * k, lineH = layer.lead > 0 ? layer.lead * k : size * LINE, F = found.lines;
    const base0 = firstBase(ctx, layout(looked(tokenize(old, icons), old), maxW, size, measure)[0], { top: stack.own[1], s0: size, z: size, frame: null, fam }) ?? top + size * 0.7;
    const rows = (String(layer.text ?? "").match(/^\s*/)[0].match(/[\r\n\u0003]/g) || []).length;   // blank rows above its line
    ctx.font = `${size}px ${fam}`; const dUp = ctx.measureText("d").actualBoundingBoxAscent || 0.75 * size;   // a box's first baseline: one 'd' ascent down
    const shift = rows ? base0 - (frame[1] + dUp + rows * lineH) : 0;   // past where its leading puts it (a baseline shift: Empress Bulblax's 63 px)
    const fc = (frame[0] + frame[2]) / 2, rest = F.length > 1 ? Math.min(...F.slice(1).map(l => l[0])) : frame[0];
    const atOf = (ls, s) => (layer.just === 0 ? l => frame[0] + ((l === ls[0] ? F[0][0] : rest) - frame[0]) * s   // as Photoshop sets its frame's lines; a first line's
      : layer.just === 1 ? l => found.box[2] - l.w : l => fc - l.w / 2 + (l === ls[0] ? ((F[0][0] + F[0][2]) / 2 - fc) * s : 0));   // spaces (Miracle Matter's) scale with it
    const lay = s => layout(paras, maxW, size * s, measure, layer.just === 0 ? Math.max(0, frame[0] + (F[0][0] - frame[0]) * s - (frame[2] - maxW)) : 0);   // those spaces take the first line's room
    const inks = (ls, s, b, p, at) => ls.flatMap((l, i) => { const ud = l.pieces.length ? lineInk(ctx, l, s, fam) : null; return ud ? [[at(l), b + i * p - ud[0], at(l) + l.w, b + i * p + ud[1]]] : []; });
    const others = stack.others.filter(o => !F.some(l => meets(l, o)));   // rows the old ink touches: not counted
    const above = others.filter(o => o[3] <= stack.own[1] && o[2] > stack.own[0] && o[0] < stack.own[2]);
    const ceiling = above.length ? Math.max(...above.map(o => o[3])) + LIFT_GAP * k : 0, floor = stack.own[3] + pad;
    const offBefore = found.box[0] < 0 || found.box[2] > W, span = q => [Math.min(...q.map(r => r[1])), Math.max(...q.map(r => r[3]))];
    const onCard = q => offBefore || q.every(r => r[0] >= 0 && r[2] <= W && r[3] <= H);
    const clear = q => q.every(r => !others.some(o => meets(r, o)));
    const ob = [found.box[0] - pad, found.box[1] - pad, found.box[2] + pad, found.box[3] + pad].map(Math.round);
    const letters = (ls, zs, b, p, at, q) => {        // the lines' letters alone (alpha), rows y0..y1
      const [ya, yb] = span(q).map(Math.round), y0 = clamp(ya - 2, 0, H), y1 = clamp(yb + 2, 0, H);
      if (y1 <= y0) return null;
      const mask = document.createElement("canvas"); mask.width = W; mask.height = y1 - y0;
      const mx = mask.getContext("2d", { willReadFrequently: true }); mx.translate(0, -y0);
      paintLines(mx, ls, { at, base: b, pitch: p, z: zs, fam, label: measure.label, track: measure.track, hx: measure.hx, fb: measure.fb, fill: [255, 255, 255], stroke: null, imgs, one });
      return { a: mx.getImageData(0, 0, W, y1 - y0).data, y0, y1 };
    };
    let lum = null, med = 0, bar = 0;
    const design = (ls, zs, b, p, at, q) => {          // new ink off the old ink's box on the design (ink_beyond: an icon beside the row)
      if (!lum) {                                     // the backdrop under the old text: its median luma and spread
        const d = ctx.getImageData(0, 0, W, H).data, h = new Array(256).fill(0), dev = new Array(256).fill(0); lum = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) lum[i] = (d[4 * i] * 77 + d[4 * i + 1] * 150 + d[4 * i + 2] * 29) >> 8;
        let n = 0;
        for (let y = clamp(ob[1], 0, H); y < clamp(ob[3], 0, H); y++) for (let x = clamp(ob[0], 0, W); x < clamp(ob[2], 0, W); x++, n++) h[lum[y * W + x]]++;
        const nth = (a, i) => { let v = 0; for (let c = a[0]; c <= i && v < 255; c += a[++v]); return v; };
        med = n ? nth(h, n >> 1) : 0; h.forEach((c, v) => { dev[Math.abs(v - med)] += c; });
        bar = Math.max(60, (n ? nth(dev, Math.floor(0.95 * (n - 1))) : 0) + 20);
      }
      const m = letters(ls, zs, b, p, at, q);
      if (!m) return false;
      const { a, y0, y1 } = m, out = r => others.every(o => !(r[0] >= o[0] && r[0] < o[2] && r[1] >= o[1] && r[1] < o[3]))
        && q.some(l => r[1] >= l[1] && r[1] < l[3] && Math.abs(r[0] - (l[0] + l[2]) / 2) < (l[2] - l[0]) * 0.48);   // a line's ends: our widths are estimates
      let n = 0;
      for (let y = y0, j = 3; y < y1; y++) for (let x = 0; x < W; x++, j += 4)
        if (a[j] > 128 && !(x >= ob[0] && x < ob[2] && y >= ob[1] && y < ob[3]) && Math.abs(lum[y * W + x] - med) > bar && out([x, y])) n++;
      return n >= 100 * k * k;
    };
    const onRows = c => {                             // a fallback's letters on another row's words (its box's ink, not only near it)
      const m = others.length && letters(c.lines, c.z, c.base, c.pitch, c.at, c.q);
      let n = 0;
      if (m) for (const o of others) for (let y = Math.max(m.y0, Math.floor(o[1])); y < Math.min(m.y1, Math.ceil(o[3])); y++)
        for (let x = Math.max(0, Math.floor(o[0])); x < Math.min(W, Math.ceil(o[2])); x++) if (m.a[((y - m.y0) * W + x) * 4 + 3] > 128) n++;
      return n >= 100 * k * k;
    };
    const ls1 = lay(1), at1 = atOf(ls1, 1), full = inks(ls1, size, base0, pitch0, at1);
    if (!full.length || onCard(full) && clear(full) && roomBelow()) return true;
    const liftBy = q => { const [y0, y1] = span(q), dy = y1 - stack.own[3]; return y1 <= H || dy <= 0 || y0 < dy ? 0 : Math.max(0, Math.min(dy, y0 - ceiling)); };   // lift: off the bottom, moved up
    const moved = (q, u) => q.map(r => [r[0], r[1] - u, r[2], r[3] - u]), off = !onCard(full);
    let largest = null, lifted = null;
    for (let s = FIT_STEP; s >= FIT_MIN; s *= FIT_STEP) {
      const zs = size * s, ls = lay(s), p = lineH * s, at = atOf(ls, s);
      for (const keep of rows ? [true, false] : [true]) {
        const b = keep && rows ? base0 - (lineH + shift) * (1 - s) : frame[1] + (base0 - frame[1]) * s, q = inks(ls, zs, b, p, at), [y0, y1] = span(q);
        if (y1 > floor || !onCard(q)) {
          const u = off && !largest && !lifted ? liftBy(q) : 0;   // none placed: the first on the card once moved up
          if (off && !largest && !lifted && onCard(moved(q, u))) lifted = { z: zs, lines: ls, base: b - u, pitch: p, at, over: true, ink: [y0 - u, y1 - u], q: moved(q, u) };
          continue;
        }
        if (clear(q) && !design(ls, zs, b, p, at, q)) return { z: zs, lines: ls, base: b, pitch: p, at, ink: [y0, y1] };
        const d = ceiling - y0, q2 = q.map(r => [r[0], r[1] + d, r[2], r[3] + d]);   // risen onto the text above: back down under it
        if (d > 0 && y1 + d <= floor && clear(q2) && !design(ls, zs, b + d, p, at, q2)) return { z: zs, lines: ls, base: b + d, pitch: p, at, ink: [y0 + d, y1 + d] };
        largest = largest || { z: zs, lines: ls, base: b, pitch: p, at, over: true, ink: [y0, y1], q };
      }
    }
    if (!off) return false;                           // none fits: at its size, told
    const u = liftBy(full), [y0, y1] = span(full), up = { z: size, lines: ls1, base: base0 - u, pitch: pitch0, at: at1, over: true, ink: [y0 - u, y1 - u] };
    const pick = largest || (lifted && !onCard(moved(full, u)) ? lifted : null);   // off the card at its size, even moved up: lifted's
    if (pick && !onRows(pick) && !(largest && u && onCard(moved(full, u)))) return pick;   // off the card: the largest placed
    return u ? up : false;                            // or at its size (moved up), told: never over another row's words
  }
  const reach = left ? W - found.box[0] : 2 * Math.min(mid, W - mid);   // point text: off the card's sides past this
  const tframe = role === "name" && !split && kc && Array.isArray(layer?.frame) && layer.frame.length === 4 ? layer.frame.map(v => v * kc) : null;   // a box-text title: Photoshop wraps at its frame
  const relay = zs => titleLayout(paras, tframe ? -1 : tokenize(old).length, found, tframe ? (left ? tframe[2] - found.box[0] : tframe[2] - tframe[0]) : maxW, zs, measure, W, left);
  let { size: z, lines, over = false, dx = 0 } = role === "name" ? relay(size)
    : point ? pointLayout(paras, size, reach, measure) : fit(paras, maxW, Infinity, size, measure);
  if (tframe) over = false;                           // the bake grows its box to hold the lines
  const row = stack ? stackFit() : null;              // true: at its size; false: none fits (left at it, told)
  if (row === false) over = true;
  else if (row && row !== true) { ({ z, lines, over } = row); over = !!over; pitch0 = row.pitch * size / z; }
  let roomy = role === "name" || !!stack || roomBelow();
  if (!roomy && lead) { pitch0 = size * LINE; roomy = roomBelow(); }   // an Ability at its leading only where it keeps its size
  if (!roomy) {                                       // past the area's bottom: smaller, down to 40%; still past it: said so
    const room2 = region[3] - top, need = s => (lines.length - 1) * pitch0 * (s / size) + s * 1.05;
    while (need(z) > room2 && z > size * 0.4) { z *= 0.94; lines = layout(paras, maxW, z, measure); }
    over = need(z) > room2 + 1;
  }
  let pitch = pitch0 * (z / size);
  let base = top + z * (role === "name" ? 0.8 : 0.7);   // an Ability: textBlocks leaves out thin ascender rows, so its top sits low
  if (role === "ability" && !point && !geo && kc && layer?.box?.length === 4 && plain(layer.text) === plain(old))   // no plate layout: its own first baseline
    base = firstBase(ctx, layout(looked(tokenize(old, icons), old), maxW, size / grow, measure)[0], { top: layer.box[1] * kc, s0: size / grow, z, frame, fam }) ?? base;
  if (row?.base != null) base = row.base;             // a stacked box set smaller: where the bake puts it
  if (role === "name" && old) {                       // a title keeps its baseline: where its old ink's top and bottom put it
    ctx.font = `${size}px ${fam}`; ctx.textBaseline = "alphabetic";
    const m = ctx.measureText(String(old).replace(/\r/g, "").split("\n")[0]), up = m.actualBoundingBoxAscent, tall = up + m.actualBoundingBoxDescent;
    if (Number.isFinite(tall) && tall > 0) base = top + (found.lines[0][3] - top) * up / tall;
  }
  const solid = (a, b) => (Array.isArray(a) && a.length === 4 ? [...a, 100] : Array.isArray(b) && b.length === 5 ? b : null);   // [r, g, b, reach, opacity %]
  const own = solid(layer?.stroke, layer?.rim);       // psd_details: the layer's or its group's Stroke (rim: see-through, centred or a gradient's)
  const ring = solid(layer?.outline, layer?.rims) || own;   // its groups' Strokes stacked on its own
  const fill = colours?.fill || hexRgb(layer?.color) || [255, 255, 255], stroke = ring ? ring.slice(0, 3) : colours?.stroke, strokeW = ring ? 2 * ring[3] * (kc || W / 1200) : 0;
  const o0 = own && own[4] < 100 && ring !== own ? ring : own;   // a see-through one of its own shows as the stack's
  const stroke0 = o0 ? o0.slice(0, 3) : colours?.stroke, strokeW0 = o0 ? 2 * o0[3] * (kc || W / 1200) : 0;   // a splice's (geoDraw)
  const strokeA = ring ? ring[4] / 100 : 1, strokeA0 = o0 ? o0[4] / 100 : 1;
  const fk = kc || W / 1200, effects = Array.isArray(layer?.fx) ? layer.fx.map(e => ({ ...e, dx: (e.dx || 0) * fk, dy: (e.dy || 0) * fk, size: (e.size || 0) * fk, ws: (e.ws || 0) * fk })) : null;   // psd_details: its shadows and glows
  let fitted = 1, moving = false, mdx = 0;            // a title (box, split part) newly over a star or type icon: smaller about its anchor (psd_edit fit_title); moving: where R4 moves it
  if (role === "name" && job.head && kc && old != null) {
    const R0 = geo ? recordLayout(geo.c, old, kc) : null, l0 = R0?.lines.find(l => l.para >= 0 && R0.was.slice(l.s, l.e).trim());   // the card's own first line: its baseline and ends
    const ox = l0 ? (left ? l0.left - found.box[0] : (l0.left + l0.right) / 2 - mid) : 0, pb = l0 ? l0.base : base, pt = l0 ? l0.top : found.lines[0][1];
    const baseAt = s => pt + (pb - pt) * s;                 // its first baseline at scale s: the bake's title shrinks towards its top (a box kept on its first baseline: keep_base)
    const boxes = job.titleWas ? job.titleWas.map(b => b.map(v => v * kc))   // the card maker's (an earlier fit's), else the old text's
      : [Array.isArray(layer?.box) && layer.box.length === 4 ? layer.box.map(v => v * kc) : found.box];
    const g = ring ? ring[3] * fk : 0, cores = titleIcons(job.head, kc, boxes).map(([, c]) => [c[0] - g, c[1] - g, c[2] + g, c[3] + g]), H = ctx.canvas.height;
    if (cores.length) {
      const y0 = clamp(Math.floor(Math.min(...cores.map(c => c[1]))), 0, H - 1), y1 = clamp(Math.ceil(Math.max(...cores.map(c => c[3]))), y0 + 1, H);
      const mask = document.createElement("canvas"); mask.width = W; mask.height = y1 - y0;
      const mx = mask.getContext("2d", { willReadFrequently: true }); mx.translate(0, -y0);
      const at = s => { const w = Math.max(0, ...relay(z * s).lines.map(l => l.w)), x0 = (left ? found.box[0] : mid - w / 2) + ox; return { w, x0, m: moving && w <= W ? clamp(x0, 0, W - w) - x0 : 0 }; };   // m: back_on's move
      const reaches = (s, sides) => {                   // its ink in a core (grown by its outline), or off the card's sides
        const t = relay(z * s), { w, x0, m } = at(s);
        mx.clearRect(0, y0, W, y1 - y0);
        paintLines(mx, t.lines, { at: l => (left ? found.box[0] : mid - l.w / 2) + ox + m, base: baseAt(s), pitch: pitch * s, z: z * s, fam, label: measure.label, track: measure.track, hx: measure.hx, fb: measure.fb, fill: [255, 255, 255], stroke: null, imgs, one });
        const a = mx.getImageData(0, 0, W, y1 - y0).data;
        const inked = c => { for (let y = Math.max(y0, Math.round(c[1])); y < Math.min(y1, Math.round(c[3])); y++) for (let x = Math.max(0, Math.round(c[0])); x < Math.min(W, Math.round(c[2])); x++) if (a[((y - y0) * W + x) * 4 + 3] > 128) return true; return false; };
        return cores.some(inked) || (sides && !m && (x0 < 0 || x0 + w > W));
      };
      fitted = titleFit(reaches);
      if (fitted === 1 && !reaches(1, false)) { moving = true; fitted = titleFit(reaches); }   // R4 would move it onto one (Fawful)
      if (fitted < 1) mdx = at(fitted).m;
    }
    if (fitted < 1) { ({ size: z, lines } = relay(z * fitted)); pitch *= fitted; dx = ox + mdx; base = baseAt(fitted); }   // re-laid where the card's line stands
  }
  let shades = colours?.shades && { ...colours.shades, bottom: colours.shades.bottom + Math.max(0, lines.length - found.lines.length) * pitch };   // more lines: the gradient grows
  if (shades && row?.ink) shades = { ...colours.shades, top: row.ink[0], bottom: row.ink[1] };   // a stacked box set anew: over its new ink (the layer's own Gradient Overlay)
  if (role === "name" && geo && kc && plain(text) === plain(old) && sameWords(geo.c.text, old)) {   // a colour alone on a title (its fill hidden: tintPlan's none): each of its own lines redrawn where it stands
    const Rl = recordLayout(geo.c, lineBreaks(geo.c.text), kc), rows = (Rl ? Rl.lines.filter(l => l.para >= 0 && Rl.was.slice(l.s, l.e).trim()) : []).map(l => {
      const t = Rl.was.slice(l.s, l.e).replace(/\s+$/, ""), body = t.trimStart();
      return { l, body, a: Rl.ink.get(l.s + t.length - body.length), b: Rl.ink.get(l.s + t.length - 1) };
    });
    if (rows.length && rows.every(r => r.a && r.b && !drawnSpans(r.body).length)) {   // letters only, each line's ink ends known
      for (const { l, body, a, b } of rows) {
        ctx.font = `${size}px ${fam}`; ctx.letterSpacing = measure.track ? `${measure.track * size}px` : "0px";
        const m = ctx.measureText(body), inkW = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * measure.hx; ctx.letterSpacing = "0px";
        const zl = inkW > 0 && b[1] > a[0] ? size * (b[1] - a[0]) / inkW : size;   // its own ink width
        const line = fit(colourize(tokenize(body, icons), body, colors, role, statuses, null, null, fills), Infinity, Infinity, zl, measure).lines.slice(0, 1);
        paintLines(ctx, line, { at: () => a[0] + m.actualBoundingBoxLeft * measure.hx * (zl / size), base: l.base, pitch: 0, z: zl, fam, label: measure.label, track: measure.track, hx: measure.hx, fb: measure.fb, fill, stroke, strokeW, strokeA, imgs, one, effects, copies });
      }
      job.lined = "own"; return false;
    }
  }
  if (R && Array.isArray(layer?.fr) && String(geo.c.id) === String(layer.id))   // its letters in another font, on was: [s, e, family, its measure]
    R.fr = layer.fr.map(([s, e, f]) => [R.at(s) + R.shift, R.at(e) + R.shift, fr?.[f], fr?.[f] ? Object.assign(widthIn(ctx, fr[f], measure.track, measure.hx), measure) : null]);
  const shrunk = point && z < size && z < pointLayout(looked(tokenize(old, icons), old), size, reach, measure).size;   // smaller than the old text: re-laid, unless spliced on the card (the bake shrinks ink off it only)
  job.lined = plan && grow === 1 && row?.base == null && fitted === 1 ? geoDraw(ctx, { R, plan, card, box: geo.box, fx: geo.fx, bare: job.bare, cover, measure, z: size, grow: !over && z === size, only: shrunk || (role === "name" && !(R.frame && !split)), icons, paras, text, look: { fam, label: measure.label, track: measure.track, hx: measure.hx, fb: measure.fb, fill, stroke, strokeW, strokeA, stroke0, strokeW0, strokeA0, imgs, one, shades, effects, tex, copies }, pitch: pitch0, W }) : "";
  if (job.lined) return over;                         // on the card's own lines
  if (job.bare && geo) pasteCuts(ctx, W, job.bare());   // re-laid: no FX word left behind (not without the card's layout: Computer Virus measured worse)
  const kept = card && role === "ability" && !point && !over && z === size && grow === 1 ? keptLines(ctx, { old, icons, lines, found, maxW, size, measure, fam, base, pitch, colors, W }) : [];
  if (kept.length) { keepLines(ctx, card, kept, found, z, W); lines = lines.map((l, i) => (kept.includes(i) ? { ...l, pieces: [] } : l)); }   // the bake leaves them: the card's own pixels
  paintLines(ctx, lines, { at: row?.at || (l => (left ? found.box[0] + dx : mid - l.w / 2 + dx)), base, pitch, z, fam, label: measure.label, track: measure.track, hx: measure.hx, fb: measure.fb, fill, stroke, strokeW, strokeA, imgs, one, shades, effects, tex, copies });
  return over;
}
/** The lines of a redrawn Ability the edit leaves as they were (indexes): its leading and trailing lines whose pieces
 *  match the old text laid out the same way, when that has as many lines as the card shows (found), not all of them;
 *  none with a colour edit, or when the redrawn lines would sit off the old ones (the old letters-only lines' ink top
 *  plus their ascent in this font vs base + i pitch, median, over 5 px at 720 wide). */
export function keptLines(ctx, { old, icons, lines, found, maxW, size, measure, fam, base, pitch, colors, W }) {
  if (old == null || (Array.isArray(colors) && colors.length)) return [];
  const was = layout(tokenize(old, icons), maxW, size, measure), n = was.length;
  if (n !== found.lines.length) return [];
  const key = l => JSON.stringify(l.pieces.map(p => [p.text ?? null, p.src ?? null, p.icon ?? null, p.badge ? 1 : 0]));
  const now = lines.map(key), then = was.map(key);
  let a = 0; while (a < Math.min(now.length, n) && now[a] === then[a]) a++;
  let b = 0; if (now.length === n) while (b < n - a && now[n - 1 - b] === then[n - 1 - b]) b++;
  if (!a && !b || a + b >= n) return [];
  ctx.font = `${size}px ${fam}`;
  const off = was.map((l, i) => {
    if (!l.pieces.length || l.pieces.some(q => q.badge || q.icon)) return null;
    const up = ctx.measureText(l.pieces.map(q => q.text ?? "").join("")).actualBoundingBoxAscent;
    return Number.isFinite(up) ? base + i * pitch - (found.lines[i][1] + up) : null;
  }).filter(e => e != null).sort((x, y) => x - y);
  if (!off.length || Math.abs(off[off.length >> 1]) > 5 * W / 720) return [];
  return [...Array(a).keys(), ...Array.from({ length: b }, (_, k) => n - 1 - k)];
}
/** Kept lines (keptLines) back to the card's pixels: each line's rows half-way to its neighbours, across the old block. */
export function keepLines(ctx, card, kept, found, z, W) {
  const F = found.lines, n = F.length, H = ctx.canvas.height, x0 = clamp(Math.floor(found.box[0] - z), 0, W), x1 = clamp(Math.ceil(found.box[2] + z), 0, W);
  for (const i of kept) {
    const t = Math.max(0, Math.floor(i ? (F[i - 1][3] + F[i][1]) / 2 : F[i][1] - 0.5 * z)), b = Math.min(H, Math.ceil(i < n - 1 ? (F[i][3] + F[i + 1][1]) / 2 : F[i][3] + 0.5 * z));
    if (b <= t || x1 <= x0) continue;
    const band = ctx.createImageData(W, b - t); band.data.set(card.subarray(t * W * 4, b * W * 4)); ctx.putImageData(band, 0, t, x0, 0, x1 - x0, b - t);
  }
}
// ---- the card's own lines and letters (AutoCroissant card_plates.layout, on a layer's plate crop)
const FIT_PAD = 1;                                    // image px a spliced line keeps off a wrap decision (our widths are estimates)
const LETTERS_ONLY = /[()[\]{}\u0001\u0002]/;          // a badge, icon or cost: never spliced as letters
/** A plate crop's layout (card_plates.layout) for old, the website's text of its layer (\r dropped), in image px (k per
 *  canvas px): {was, lines: [{s, e, base, left, right, top, bottom, just, para}], x: Map(char index -> pen x of the
 *  letter it starts), ink: Map(char index -> [left, right] of its ink), vary: Map(char index -> variant) of the icons
 *  the plate spells with a variant, frame: [left, right] | null}, indexes into was
 *  (para -1: a blank line the website trims); null when it has none or its text (icon variants aside) is not old's. */
export function recordLayout(c, old, k) {
  if (!c || typeof c.text !== "string" || !Array.isArray(c.lines) || !c.lines.length || !Array.isArray(c.glyphs) || !(k > 0)) return null;
  let T = c.text.replace(/[\r\u0003]/g, "\n").replace(/\t/g, " "), at = i => i, heads = [];
  const was = String(old ?? "").replace(/\r/g, ""), core = was.trim();
  if (!core) return null;
  if (T.trim() !== core) { const v = noVariants(T); if (!v || v.T.trim() !== core) return null; ({ T, at, heads } = v); }   // the record has [dark], the plate [dark:sticker]
  let cp = at;                                        // the plate's indexes are code points: an emoji is 2 here
  if (/[\ud800-\udfff]/.test(c.text)) { const u = [0]; for (const ch of c.text) u.push(u[u.length - 1] + ch.length); cp = i => at(u[i] ?? i); }
  const shift = was.indexOf(core) - T.indexOf(core), paraAt = [];   // T index + shift: was's
  for (let i = 0, p = 0; i <= was.length; i++) { paraAt.push(p); if (was[i] === "\n") p++; }
  const lines = c.lines.map(([s, e, base, left, right, top, bottom, just]) => {
    const a = cp(s) + shift, z = cp(e) + shift, inside = a === z ? a >= 0 && a <= was.length : z > 0 && a < was.length, s0 = clamp(a, 0, was.length);   // a leading space trimmed: from 0
    return { s: inside ? s0 : a, e: inside ? clamp(z, 0, was.length) : z, base: base * k, left: left * k, right: right * k, top: top * k, bottom: bottom * k, just: just | 0, para: inside ? paraAt[s0] : -1 };
  });
  const x = new Map(), ink = new Map();               // a cluster's first glyph (a sticker draws 3)
  for (const g of c.glyphs) {
    const j = cp(g[0]) + shift;
    if (!x.has(j)) x.set(j, g[1] * k);
    if (g.length >= 4 && !ink.has(j)) ink.set(j, [g[2] * k, g[3] * k]);
  }
  return { was, lines, x, ink, vary: new Map(heads.map(([i, v]) => [at(i) + shift, v])), frame: Array.isArray(c.frame) ? c.frame.map(v => v * k) : null, shift, at };
}
/** t without its icon variants ([dark:sticker] -> [dark]), at(i): t's index i there, heads: [t's index, variant] of the
 *  tokens that had one; null when it has none. */
function noVariants(t) {
  const cut = [], heads = [];
  for (const m of t.matchAll(/\[([^[\]]{1,70})\]/g)) { const v = splitToken(m[1]); if (v?.v) { cut.push([m.index + 1 + v.base.length, m.index + m[0].length - 1]); heads.push([m.index, v.v]); } }
  if (!cut.length) return null;
  const to = []; let T = "";
  for (let i = 0, j = 0; i <= t.length; i++) {
    while (j < cut.length && i >= cut[j][1]) j++;
    to.push(T.length);
    if (i < t.length && !(j < cut.length && i >= cut[j][0])) T += t[i];
  }
  return { T, heads, at: i => (i < 0 ? i : i < to.length ? to[i] : i - t.length + T.length) };
}
/** An Ability edit (R's was -> text) against the card's own lines (recordLayout R): {splice, splices, keep, gone, after,
 *  from, paras} or null (no change but trailing spaces). splice: {i, a, b, at, run} when one paragraph changes inside one
 *  line (was[a, b) -> run, text index at; at letters' starts); else splices: one such per changed line (lineSplices) or
 *  null. keep: the lines that stand (the paragraphs before the change, and the first changed one's lines a greedy wrap
 *  ends before it: the word that broke them unchanged); gone: the changed paragraphs' other lines; after: the
 *  paragraphs' after it (moved when the line count changes); the new text to wrap: its paragraphs paras [first, past
 *  the last], the first from text index from. */
export function geoPlan(R, text) {
  const was = R.was, now = String(text ?? "").replace(/\r/g, ""), L = R.lines;
  if (now === was) return null;
  const P0 = was.split("\n"), P1 = now.split("\n"), bare = q => q.replace(/[ \t]+$/, "");   // a paragraph's trailing spaces hang: never drawn
  const starts = P => P.reduce((t, q) => [...t, t[t.length - 1] + q.length + 1], [0]), S0 = starts(P0), S1 = starts(P1);
  let a = 0; while (a < P0.length && a < P1.length && bare(P0[a]) === bare(P1[a])) a++;
  let b = 0; while (b < P0.length - a && b < P1.length - a && bare(P0[P0.length - 1 - b]) === bare(P1[P1.length - 1 - b])) b++;
  if (a === P0.length && a === P1.length) return null;
  const same = P0.length - a - b >= 1 && P1.length - a - b >= 1, o = bare(P0[a] ?? ""), n = bare(P1[a] ?? "");
  let p = 0;
  if (same) while (p < o.length && p < n.length && o[p] === n[p]) p++;
  let splice = null;
  if (P0.length - a - b === 1 && P1.length - a - b === 1) {
    let s = 0; while (s < o.length - p && s < n.length - p && o[o.length - 1 - s] === n[n.length - 1 - s]) s++;
    const A = S0[a] + p, B = S0[a] + o.length - s, i = L.findIndex(l => l.para === a && l.s <= A && B <= l.e);
    if (i >= 0) {
      const l = L[i];
      let x0 = A; while (x0 > l.s && !R.x.has(x0)) x0--;
      let x1 = B; while (x1 < l.e && !R.x.has(x1)) x1++;
      const at = S1[a] + p - (A - x0);
      splice = { i, a: x0, b: x1, at, run: now.slice(at, S1[a] + n.length - s + (x1 - B)) };
    }
  }
  const splices = splice ? null : lineSplices(R, now);
  const lastOld = P0.length - b, lastNew = P1.length - b;
  const reach = j => { const k = L[j + 1], sp = was.indexOf(" ", k.s); return sp >= 0 && sp < k.e ? sp : k.e; };   // the next line's first word's end
  const keep = [], gone = [], after = [];
  L.forEach((l, j) => {
    if (l.para < 0) (l.s < 0 ? keep : after).push(j);
    else if (l.para < a) keep.push(j);
    else if (l.para >= lastOld) after.push(j);
    else if (same && l.para === a && L[j + 1]?.para === a && reach(j) <= S0[a] + p && (!j || keep.includes(j - 1))) keep.push(j);
    else gone.push(j);
  });
  const first = L[gone[0]], from = first && first.para === a ? S1[a] + first.s - S0[a] : S1[Math.min(a, P1.length)];
  return { splice, splices, keep, gone, after, from, paras: [a, lastNew] };
}
/** An edit's word changes (was -> now) each inside one of R's lines: per line, its changed run as geoPlan's splice
 *  ({i, a, b, at, run}, at letters' starts), lines in order; null when a change holds a line break or crosses a line. */
function lineSplices(R, now) {
  const was = R.was, L = R.lines, tok = t => t.match(/\n|[^\S\n]+|\S+/g) || [], A = tok(was), B = tok(now);
  if (A.length * B.length > 250000) return null;
  const n = A.length, m = B.length, D = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));   // LCS of the tokens
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) D[i][j] = A[i] === B[j] ? D[i + 1][j + 1] + 1 : Math.max(D[i + 1][j], D[i][j + 1]);
  const hunks = []; let i = 0, j = 0, pa = 0, pb = 0, h = null;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { if (h) hunks.push(h); h = null; pa += A[i++].length; pb += B[j++].length; }
    else { h ||= [pa, pa, pb, pb];
      if (j < m && (i >= n || D[i][j + 1] >= D[i + 1][j])) h[3] = pb += B[j++].length; else h[1] = pa += A[i++].length; }
  }
  if (h) hunks.push(h);
  const by = new Map(), ends = (t, e) => e >= t.length || t[e] === "\n";
  for (const [oa, ob, na, nb] of hunks) {
    const o = was.slice(oa, ob), w = now.slice(na, nb);
    if (/\n/.test(o + w)) return null;
    if (!/\S/.test(o + w) && ends(was, ob) && ends(now, nb)) continue;   // a paragraph's trailing spaces: never drawn
    const k = L.findIndex(l => l.para >= 0 && l.s <= oa && ob <= l.e);
    if (k < 0) return null;
    const g = by.get(k); by.set(k, g ? [g[0], ob, g[2], nb] : [oa, ob, na, nb]);
  }
  if (!by.size) return null;
  return [...by].sort((x, y) => x[0] - y[0]).map(([k, [oa, ob, na, nb]]) => {   // as geoPlan's splice
    const o = was.slice(oa, ob), w = now.slice(na, nb), l = L[k];
    let p = 0; while (p < o.length && p < w.length && o[p] === w[p]) p++;
    let q = 0; while (q < o.length - p && q < w.length - p && o[o.length - 1 - q] === w[w.length - 1 - q]) q++;
    const a0 = oa + p, b0 = ob - q;
    let x0 = a0; while (x0 > l.s && !R.x.has(x0)) x0--;
    let x1 = b0; while (x1 < l.e && !R.x.has(x1)) x1++;
    const at = na + p - (a0 - x0);
    return { i: k, a: x0, b: x1, at, run: now.slice(at, nb - q + (x1 - b0)) };
  });
}
/** The plate crop with the card's layout of the one layer ids names: {c, box (image px, k per canvas px), fx: its FX
 *  layers' words}, or null. */
function geoOf(plate, ids, k) {
  if (ids.length !== 1 || !(k > 0)) return null;
  const mine = (plate?.crops || []).filter(c => String(c.id) === String(ids[0])), c = mine.find(x => !Array.isArray(x.fx) && Array.isArray(x.lines));
  return c ? { c, box: c.box.map(v => v * k), fx: mine.flatMap(x => x.fx || []) } : null;
}
/** Spans of the FX layers' words (fx) in text, lowercased match. */
const fxSpans = (text, fx) => (fx || []).flatMap(w => { const out = [], t = text.toLowerCase(), k = String(w).toLowerCase(); if (!k) return out; for (let i = t.indexOf(k); i >= 0; i = t.indexOf(k, i + 1)) out.push([i, i + k.length]); return out; });
/** A splice (geoPlan's sp; now: was with it) inside one badge or icon: {a, b, at, run, was}, the old one was[a, b) (one
 *  glyph on the card), the new one run at text index at; null unless one badge (a timing tag or a cost) or icon token
 *  becomes another. */
function tagSwap(R, sp, now, icons) {
  const { was, x: X } = R, { a, b, run } = sp, l = R.lines[sp.i];
  const tag = (t, j) => { const s = t.lastIndexOf("(", a), e = t.indexOf(")", j - 1), inner = t.slice(s + 1, e);   // a timing tag, or a cost
    return s >= 0 && e >= 0 && ((e - s <= 9 && !/[\s()]/.test(inner)) || (!/[()\n]/.test(inner) && costInfo(inner))) ? [s, e + 1] : null; };
  const tok = (t, j) => { const s = t.lastIndexOf("[", a), e = t.indexOf("]", j - 1); return s >= 0 && e > s && t.indexOf("]", s) === e && !/[\s[]/.test(t.slice(s + 1, e)) ? [s, e + 1] : null; };   // an icon
  const pill = t => { const ps = tokenize(t, icons); return ps.length === 1 && ps[0].length === 1 && ps[0][0].length === 1 && !!(ps[0][0][0].badge || ps[0][0][0].icon); };
  const o = tag(was, Math.max(b, a + 1)) || tok(was, Math.max(b, a + 1)), n = tag(now, Math.max(a + run.length, a + 1)) || tok(now, Math.max(a + run.length, a + 1));
  if (!o || !n || o[0] !== n[0] || o[0] < l.s || o[1] > l.e || !pill(was.slice(...o)) || !pill(now.slice(...n)) || !X.has(o[0])) return null;
  let e = o[1]; while (e < l.e && !X.has(e)) e++;
  return e === o[1] ? { a: o[0], b: o[1], at: sp.at - (a - o[0]), run: now.slice(...n), was: was.slice(...o) } : null;   // its glyph ends there
}
/** A splice (geoPlan's) set as the bake would: the run's width from the line's own letters (their pen steps), else this
 *  font's scaled to the card's line; a badge for another (tagSwap) the old pill's width times the new one's over
 *  it in this font, an icon for another the old step and the glyphs' difference at the old icon's size (ez; left:
 *  tracked, set from its pen); whole timing tags in or out (segs) pills at the card's pill ratio; the line moved as its
 *  alignment moves it. {xa, cutA, cutB, dp, ds, hx, z, tag: {at, w, ez, left} | null, width, k, space, segs: [[s, e,
 *  isTag, w]] | null} (image px: the old run's pen start and the cuts between its letters' ink and its neighbours', prefix
 *  and suffix shifts, its letters' width scale, their size; the line's new width, card over this font, a space; the run's
 *  pieces) or null when it would wrap otherwise (past the frame, a word pulled up), is not letters and timing tags only,
 *  moves an FX layer's word, or the font is far off. */
export function spliceFit(R, sp, { measure, z, icons = {}, fx = [], W = Infinity, font = null }) {
  const { was, lines: L, x: X } = R, l = L[sp.i], { run } = sp, now = was.slice(0, sp.a) + run + was.slice(sp.b);
  const mOf = j => R.fr?.find(([s, e, , m]) => m && s <= j && j < e)?.[3] || null, m2 = font?.[3] || measure;   // R.fr: letters in another font; font: the run's (R.fr's entry)
  const mNow = j => (j < sp.a ? mOf(j) : j < sp.a + run.length ? font?.[3] : mOf(j - run.length + sp.b - sp.a)) || measure;
  const wNow = (s, e) => { let t = 0; for (let i = s, j; i < e; i = j) { const m = mNow(i); for (j = i + 1; j < e && mNow(j) === m;) j++; t += m(now.slice(i, j), z); } return t; };   // each letter in its own font
  const word = (t, i, j) => { while (i > 0 && !/\s/.test(t[i - 1])) i--; while (j < t.length && !/\s/.test(t[j])) j++; return t.slice(i, j); };
  if (/\n/.test(run)) return null;
  let { a, b } = sp, tag = null, segs = null;
  if (LETTERS_ONLY.test(word(was, a, b)) || LETTERS_ONLY.test(word(now, a, a + run.length))) {
    if ((tag = tagSwap(R, sp, now, icons))) ({ a, b } = tag);
    else if (cutsPiece(was, a, b) || cutsPiece(now, a, a + run.length) || !tagSegs(was.slice(a, b), icons) || !(segs = tagSegs(run, icons))) return null;   // whole timing tags in or out
  }
  if (l.just >= 3 && (l.just === 6 || L[sp.i + 1]?.para === l.para)) return null;   // justified: its spaces would stretch
  const xOf = j => (j >= l.e ? l.right : X.get(j)), xa = xOf(a), xb = xOf(b);
  if (xa == null || xb == null) return null;
  const kOf = l => {                                  // the card's line over ours, each letter in its own font
    const mixed = (R.fr || []).reduce((t, [s, e, , m]) => {
      const q = m ? was.slice(Math.max(s, l.s), Math.min(e, l.e)) : "", r = e >= l.e ? q.trimEnd() : q;
      return r.trim() ? t + m(r, z) - measure(r, z) : t; }, 0);
    const line = layout(tokenize(was.slice(l.s, l.e), icons), Infinity, z, measure)[0];
    return line?.w > 0 ? (l.right - l.left) / (line.w + mixed) : 0;
  };
  const k = kOf(l);
  if (!(k >= 0.5 && k <= 2)) return null;           // this font far off the card's
  const zl = Math.abs(k - 1) <= 0.15 ? z : z * k;   // a line set larger or smaller than the layer's size
  const kp = font && sp.b <= sp.a && sp.a === l.s && L[sp.i - 1] ? kOf(L[sp.i - 1]) : k, kr = kp >= 0.5 && kp <= 2 ? kp : k;   // typed at a line's start: the line before's style (its size)
  const zr = Math.abs(kr - 1) <= 0.15 ? z : z * kr;
  const starts = [...X.keys()].filter(j => j >= l.s && j < l.e).sort((m, n) => m - n), step = new Map(), pens = new Map(), fo = font?.[3] || null;
  starts.forEach((j, n) => { const e = starts[n + 1] ?? l.e; if (e - j === 1) for (const g of mOf(j) === fo ? [step, pens] : [pens]) if (!g.has(was[j])) g.set(was[j], xOf(e) - X.get(j)); });   // step: the run's font's
  const pillW = t => layout(tokenize(t, icons), Infinity, zl, measure)[0]?.w || 0;
  const one = t => tokenize(t, icons)[0]?.[0]?.[0], to = tag && one(tag.run), ic = to?.icon ? [iconEm((o => o && { ...o, vary: R.vary?.get(a) ?? o.vary })(one(tag.was))), iconEm(to)] : [];   // the old as the plate spells it
  const [g0, g1] = ic[0]?.w && ic[1] ? ic : [], inkW = g0 && R.ink.has(a) ? R.ink.get(a)[1] - R.ink.get(a)[0] : 0, ez0 = g0 ? (xb - xa) / g0.adv : 0;
  const vy = R.vary?.has(a), left = !!g0 && zl < 0.9 * ez0 && (vy || (inkW > 0 && inkW / g0.w < 0.9 * ez0)), ez = !left ? ez0 : vy ? zl : inkW / g0.w;   // the old icon's size: its pen step, where tracking spaces it out its ink (a variant's: the line's size)
  const flat = g0 && LAYERED.has(to.no ? "no" : to.vary);   // psd_edit sets a layered variant at tracking 0
  const letW = s => ([...s].every(ch => step.has(ch)) ? [...s].reduce((t, ch) => t + step.get(ch), 0) : m2(s, z) * kr);
  let kt = 1;                                         // the card's pills over this font's
  if (segs?.some(g => g[2])) { const ks = [];
    for (const m of was.matchAll(new RegExp(TAG.source, "g"))) {
      const s = m.index, e = s + m[0].length, ln = L.find(q => q.s <= s && e <= q.e), pw = tagInfo(m[1]) ? pillW(m[0]) : 0;
      const x0 = X.get(s), x1 = ln && (e >= ln.e ? ln.right : X.get(e));
      if (ln && pw > 0 && x0 != null && x1 != null && x1 > x0) ks.push((x1 - x0) / pw);
    }
    if (ks.length) kt = median(ks); }
  if (segs) segs = segs.map(([s, e, isTag]) => [s, e, isTag, isTag ? pillW(run.slice(s, e)) * kt : letW(run.slice(s, e))]);
  const w = g0 ? (flat ? g1.adv * ez : xb - xa + (g1.adv - g0.adv) * ez) : tag ? (xb - xa) * pillW(tag.run) / pillW(tag.was) : segs ? segs.reduce((t, g) => t + g[3], 0) : letW(run);
  if (!Number.isFinite(w)) return null;
  const dw = w - (xb - xa), width = l.right - l.left + dw, space = pens.get(" ") ?? measure(" ", z) * k;
  const [dp, ds] = l.just === 1 || l.just === 4 ? [-dw, 0] : l.just === 2 || l.just === 5 ? [-dw / 2, dw / 2] : [0, dw];
  if (R.frame) {
    const room = R.frame[1] - R.frame[0], prev = L[sp.i - 1], next = L[sp.i + 1];
    if (width > room - FIT_PAD) return null;        // past the frame: it wraps
    if (dw < 0 && next?.para === l.para) {          // the next line's first word would come up
      const sp2 = was.indexOf(" ", next.s), end = sp2 >= 0 && sp2 < next.e ? sp2 : next.e;
      if (width + space + (end >= next.e ? next.right : X.get(end) ?? next.right) - next.left <= room + FIT_PAD) return null;
    }
    const firstEnd = (() => { const i = was.indexOf(" ", l.s); return i >= 0 && i < l.e ? i : l.e; })();
    if (prev?.para === l.para && a <= firstEnd) {    // the first word changed: up onto the line before?
      const i = now.indexOf(" ", l.s), e = i >= 0 && i < l.e + run.length - (b - a) ? i : l.e + run.length - (b - a);
      const fw = tag ? (xOf(firstEnd) ?? l.right) - l.left + dw : wNow(l.s, e) * k;   // a pill: the card's own pens
      if (prev.right - prev.left + space + fw <= room + FIT_PAD) return null;
    }
  } else if (l.left + dp < 0 || l.right + ds > W) return null;   // point text off the card
  const moved = [...(dp ? [[l.s, a]] : []), ...(ds ? [[b, l.e]] : [])];
  if (fxSpans(was, fx).some(([s, e]) => (s < b && a < e) || moved.some(([m, n]) => s < n && m < e))) return null;   // an FX layer stays put
  const lets = segs ? segs.filter(g => !g[2]) : null, own = segs ? lets.reduce((t, g) => t + m2(run.slice(g[0], g[1]), zr), 0) : run && !tag ? m2(run, zr) : 0;
  const hx = own > 0 ? (segs ? lets.reduce((t, g) => t + g[3], 0) : w) / own : 1;
  if (own > 0 && !(hx >= 0.8 && hx <= 1.25)) return null;
  const inked = starts.filter(j => R.ink.has(j)), edge = (j, side) => R.ink.get(j)[side];   // cut between letters' ink, not pens: strokes past a pen stay with their letter
  const before = inked.filter(j => j < a).pop(), first = inked.find(j => j >= a && j < b), last = inked.filter(j => j >= a && j < b).pop(), next = inked.find(j => j >= b);
  const cut = (p, q, x) => (p != null && q != null ? (edge(p, 1) + edge(q, 0)) / 2 : x);
  const OFF = 1e6;                                    // nothing of the line before (after) the change: no part there to move
  let cutA = first != null ? cut(before, first, xa) : cut(before, next, xa), cutB = last != null ? cut(last, next, xb) : cutA;
  if (segs && before == null) { cutA = -OFF; if (first == null) cutB = -OFF; }
  if (segs && next == null) { cutB = OFF; if (first == null) cutA = OFF; }
  return { xa, cutA: Math.min(cutA, cutB), cutB: Math.max(cutA, cutB), dp, ds, hx, z: tag ? zl : zr, tag: tag && { at: tag.at, w, ...(g0 ? { ez, left } : {}) }, width, k, space, segs };
}
/** t's pieces when it is letters, spaces and whole timing tags only: [[start, end, isTag]]; null with an icon, a cost
 *  (a card's own souls or counters too) or a bracket. */
function tagSegs(t, icons) {
  if (/[[\]{}\u0001\u0002]/.test(t) || tokenize(t, icons).flat(2).some(p => p.icon || p.cost || p.group === "own")) return null;
  const out = []; let at = 0;
  for (const m of t.matchAll(new RegExp(TAG.source, "g"))) {
    if (!tagInfo(m[1])) continue;
    if (m.index > at) out.push([at, m.index, false]);
    out.push([m.index, m.index + m[0].length, true]); at = m.index + m[0].length;
  }
  if (at < t.length) out.push([at, t.length, false]);
  return out;
}
/** Whether an end of [i, j) falls inside a timing tag, cost or icon of t. */
function cutsPiece(t, i, j) {
  const res = [new RegExp(TAG.source, "g"), new RegExp(COST.source, "gi"), /\[[^[\]\n]{1,52}\]/g];
  return res.some((re, n) => [...t.matchAll(re)].some(m => (n || tagInfo(m[1])) && [i, j].some(x => m.index < x && x < m.index + m[0].length)));
}
/** lineSplices' sps (now: the edited text) with their spliceFits fits, framed text: no line spliced right after the
 *  line before (one paragraph) has a new first word that fits up there at that line's new width. */
function staysDown(R, sps, fits, now, measure, z) {
  const L = R.lines, room = R.frame[1] - R.frame[0];
  let d = 0;                                          // was -> now index shift so far
  return sps.every((sp, n) => {
    const l = L[sp.i], s = l.s + d, prev = sps[n - 1], f = fits[n - 1];
    d += sp.run.length - (sp.b - sp.a);
    if (!prev || prev.i !== sp.i - 1 || L[prev.i].para !== l.para) return true;
    const e = l.e + d, sp2 = now.indexOf(" ", s), word = now.slice(s, sp2 >= 0 && sp2 < e ? sp2 : e);
    return f.width + f.space + measure(word, z) * fits[n].k > room + FIT_PAD;
  });
}
/** geoPlan's gone lines wrapped as the bake wraps them (psd_tools compose._greedy, not justified) over the card's own
 *  pens: kept words (word LCS) are the card's ink moved (moveInk), typed ones drawn at the card's letter steps.
 *  {dy, moves, paints}, or null: justified, blank or mixed-alignment lines, an FX word, a typed badge or icon, a pen
 *  missing, a font far off, the card's own text not landing on its own lines, or a close break. */
export function ownWrap(R, plan, now, paras, { measure, z, fx, icons, step, B, x0, x1 }) {
  const { was, lines: L, x: X, ink: I } = R, G = plan.gone, [qa, qb] = plan.paras;
  if (!G.length || qb <= qa || G.some((j, n) => (n && j !== G[n - 1] + 1) || L[j].para < 0 || L[j].just >= 3 || L[j].just !== L[G[0]].just)) return null;
  if (fx?.length && fxSpans(was, fx).length) return null;
  const P1 = now.split("\n"), S1 = []; P1.reduce((s, p) => (S1.push(s), s + p.length + 1), 0);
  if (P1.slice(qa, qb).some(p => !p.trim())) return null;   // a blank paragraph: wrap() drops it at the range's ends
  const oa = L[G[0]].s, ob = L[G[G.length - 1]].e, na = plan.from, nb = S1[qb - 1] + P1[qb - 1].length;
  if (!(na <= nb) || /[^\S \n]/.test(was.slice(oa, ob) + now.slice(na, nb))) return null;   // tabs, no-break spaces
  const toks = (t, a, b) => [...t.slice(a, b).matchAll(/\n|[^\s]+/g)].map(m => ({ s: a + m.index, e: a + m.index + m[0].length, t: m[0] }));
  const O = toks(was, oa, ob), N = toks(now, na, nb);
  const lineOf = i => G.find(j => L[j].s <= i && i < L[j].e);
  const penEnd = (j, e) => { for (let i = e; i < L[j].e; i++) if (X.has(i)) return X.get(i); return L[j].right; };
  for (const w of O) if (w.t !== "\n") { w.j = lineOf(w.s); if (w.j == null || !X.has(w.s)) return null; w.w = penEnd(w.j, w.e) - X.get(w.s); }
  const gaps = [], step1 = new Map(), pair = new Map();   // the card's spaces; a letter's advance alone and before the next
  for (let n = 1; n < O.length; n++) { const a = O[n - 1], b = O[n]; if (a.t !== "\n" && b.t !== "\n" && a.j === b.j && /^ +$/.test(was.slice(a.e, b.s))) gaps.push((X.get(b.s) - penEnd(a.j, a.e)) / (b.s - a.e)); }
  for (const l of [...G.map(j => L[j]), ...L.filter((_, j) => !G.includes(j))]) {   // the changed lines first (a run in another font elsewhere)
    const st = [...X.keys()].filter(j => j >= l.s && j < l.e).sort((m, n) => m - n);
    st.forEach((j, n) => { const e = st[n + 1] ?? l.e; if (e - j !== 1) return; const d = (e >= l.e ? l.right : X.get(e)) - X.get(j);
      if (!step1.has(was[j])) step1.set(was[j], d); const p = was[j] + (e >= l.e ? " " : was[e]); if (!pair.has(p)) pair.set(p, d); });
  }
  const k = median(G.map(j => { const l = L[j], w = layout(tokenize(was.slice(l.s, l.e), icons), Infinity, z, measure)[0]?.w; return w > 0 ? (l.right - l.left) / w : NaN; }).filter(Number.isFinite));
  if (!(k >= 0.5 && k <= 2)) return null;           // this font far off the card's
  const zl = Math.abs(k - 1) <= 0.15 ? z : z * k, space = gaps.length ? median(gaps) : step1.get(" ") ?? measure(" ", z) * k;
  const n0 = O.length, m0 = N.length, D = Array.from({ length: n0 + 1 }, () => new Uint16Array(m0 + 1));   // the words kept (LCS)
  for (let i = n0 - 1; i >= 0; i--) for (let j = m0 - 1; j >= 0; j--) D[i][j] = O[i].t === N[j].t ? D[i + 1][j + 1] + 1 : Math.max(D[i + 1][j], D[i][j + 1]);
  for (let i = 0, j = 0; i < n0 && j < m0;) { if (O[i].t === N[j].t) { N[j].old = O[i]; i++; j++; } else if (D[i + 1][j] >= D[i][j + 1]) i++; else j++; }
  for (const w of N) if (w.t !== "\n") {
    if (w.old) { w.w = w.old.w; continue; }
    if (LETTERS_ONLY.test(w.t)) return null;          // a typed badge or icon
    const own = measure(w.t, zl), cs = [...w.t], adv = (c, n) => pair.get(c + (cs[n + 1] ?? " ")) ?? step1.get(c);
    w.w = cs.every((c, n) => adv(c, n) != null) ? cs.reduce((t, c, n) => t + adv(c, n), 0) : measure(w.t, z) * k;
    w.typed = true; w.hx = own > 0 ? w.w / own : 1;
    if (!(w.hx >= 0.8 && w.hx <= 1.25)) return null;
  }
  const just = L[G[0]].just, starts = G.filter(j => L[j].s === 0 || was[L[j].s - 1] === "\n"), rest = G.filter(j => !starts.includes(j));
  const lefts = [L[starts[0] ?? G[0]].left, L[rest[0] ?? starts[0] ?? G[0]].left];   // a paragraph's first line, the others
  const room = first => (R.frame ? (just ? R.frame[1] - R.frame[0] : R.frame[1] - lefts[first ? 0 : 1]) : Infinity);
  let close = false;
  const wrap = (ws, first) => {                      // compose._greedy, not justified
    const out = []; let cur = null, para = first;
    const line = (w, f) => { if (w.w > room(f) + 1e-6) close = true; return { items: [w], gap: [0], w: w.w, first: f }; };   // wider: broken inside
    ws.forEach((w, n) => {
      if (w.t === "\n") { if (cur) out.push(cur); else if (para && n) out.push({ items: [], gap: [], w: 0, first: true }); cur = null; para = true; return; }
      if (!cur) { cur = line(w, para); para = false; return; }
      const sp = (w.s - ws[n - 1].e) * space, nw = cur.w + sp + w.w, r = room(cur.first);
      if (Math.abs(nw - r) <= FIT_PAD * [w, ...cur.items].filter(x => x.typed).length) close = true;   // typed words' widths are estimates
      if (nw > r + 1e-6) { out.push(cur); cur = line(w, false); } else { cur.items.push(w); cur.gap.push(sp); cur.w = nw; }
    });
    if (cur) out.push(cur);
    return out;
  };
  const mine = wrap(O, oa === 0 || was[oa - 1] === "\n");
  if (mine.length !== G.length || mine.some((l, n) => l.items[0]?.j !== G[n])) return null;   // the card's own text lands on its own lines
  const got = wrap(N, na === 0 || now[na - 1] === "\n");
  if (close) return null;
  const keepBases = O.filter(w => w.t === "\n").length === N.filter(w => w.t === "\n").length;
  const baseOf = n => (keepBases && n < G.length ? L[G[n]].base : n < G.length || !keepBases ? L[G[0]].base + n * step : L[G[G.length - 1]].base + (n - G.length + 1) * step);
  const cx = median(G.map(j => (L[j].left + L[j].right) / 2)), rx = Math.max(...G.map(j => L[j].right));
  const xOf = l => (just === 1 ? rx - l.w : just === 2 ? cx - l.w / 2 : lefts[l.first ? 0 : 1]);
  const inked = new Map(G.map(j => [j, [...I.keys()].filter(i => i >= L[j].s && i < L[j].e).sort((a, b) => a - b)]));
  const moves = [], paints = [];
  got.forEach((l, n) => {
    let x = xOf(l); const base = baseOf(n);
    l.items.forEach((w, i) => {
      x += l.gap[i]; const at = x;
      if (w.old) {                                    // its ink, cut half-way to its neighbours' (a space past it at a line's end)
        const o = w.old, ks = inked.get(o.j), inW = ks.filter(c => c >= o.s && c < o.e), before = ks.filter(c => c < o.s).pop(), after = ks.find(c => c >= o.e);
        if (inW.length) moves.push([[before != null ? (I.get(before)[1] + I.get(inW[0])[0]) / 2 : Math.max(x0, I.get(inW[0])[0] - space), B[o.j][0],
          after != null ? (I.get(inW[inW.length - 1])[1] + I.get(after)[0]) / 2 : Math.min(x1, I.get(inW[inW.length - 1])[1] + space), B[o.j][1]], at - X.get(o.s), base - L[o.j].base]);
      } else paints.push([[{ pieces: runPieces(paras, now, w.s, w.e, measure, zl, w.hx) }], { at: () => at, base, hx: w.hx, z: zl }]);
      x += w.w;
    });
  });
  return { dy: (got.length - G.length) * step, moves, paints };
}
/** Rows of R's lines (image px [top, bottom)): half-way to the neighbours' ink, the first and last to box's edges. */
function bands(L, box) {
  return L.map((l, j) => [j ? (L[j - 1].bottom + l.top) / 2 : Math.min(box[1], l.top), j < L.length - 1 ? (l.bottom + L[j + 1].top) / 2 : Math.max(box[3], l.bottom)]);
}
const OPAQUE = [8, 64];                                // |card - wiped| (max channel): below, backdrop; past, the letter's own colour
/** The card's letters moved onto the wiped pixels (out, a copy of wiped: rows [ya, yb) of the image, W wide; card the
 *  whole image): src rect [x0, y0, x1, y1] shifted (dx, dy), bilinear for fractions; each pixel's letter share (by how
 *  far the card is from the wiped backdrop: OPAQUE) keeps its colour, the rest takes the backdrop where it lands. (0,
 *  0): the card's pixels. cover (coverCuts): pictures over the letters, never moved with them. */
export function moveInk(out, wiped, card, W, [ya, yb], [x0, y0, x1, y1], dx, dy, cover = null) {
  x0 = clamp(Math.floor(x0), 0, W); x1 = clamp(Math.ceil(x1), 0, W); y0 = clamp(Math.floor(y0), ya, yb); y1 = clamp(Math.ceil(y1), ya, yb);
  if (x1 <= x0 || y1 <= y0) return;
  if (!dx && !dy) { for (let y = y0; y < y1; y++) out.set(card.subarray((y * W + x0) * 4, (y * W + x1) * 4), ((y - ya) * W + x0) * 4); return; }
  const w = x1 - x0, h = y1 - y0, P = new Float32Array(w * h * 3), Q = new Float32Array(w * h).fill(1);   // out = P + Q * backdrop
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y + y0) * W + x + x0) * 4, iw = i - ya * W * 4, n = y * w + x;
    let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(card[i + c] - wiped[iw + c]));
    let q = 1 - clamp((d - OPAQUE[0]) / (OPAQUE[1] - OPAQUE[0]), 0, 1);
    if (cover) q += (1 - q) * coverAt(cover, x + x0, y + y0);   // a picture over the letters stays (putCover)
    Q[n] = q; for (let c = 0; c < 3; c++) P[n * 3 + c] = card[i + c] - q * wiped[iw + c];
  }
  const fx = Math.floor(dx), tx = dx - fx, fy = Math.floor(dy), ty = dy - fy;
  for (let Y = Math.max(ya, y0 + fy); Y < Math.min(yb, y1 + fy + 1); Y++) for (let X = Math.max(0, x0 + fx); X < Math.min(W, x1 + fx + 1); X++) {
    const sx = X - fx - 1 - x0, sy = Y - fy - 1 - y0, o = ((Y - ya) * W + X) * 4;   // dest X takes src X - dx: between sx and sx + 1
    let q = 0, wsum = 0; const p = [0, 0, 0];
    for (const [ax, ay, k] of [[sx, sy, tx * ty], [sx + 1, sy, (1 - tx) * ty], [sx, sy + 1, tx * (1 - ty)], [sx + 1, sy + 1, (1 - tx) * (1 - ty)]]) {
      if (!k) continue;
      const inside = ax >= 0 && ax < w && ay >= 0 && ay < h, n = ay * w + ax;
      wsum += k; q += k * (inside ? Q[n] : 1);
      if (inside) for (let c = 0; c < 3; c++) p[c] += k * P[n * 3 + c];
    }
    if (!wsum || q >= wsum - 1e-6) continue;          // backdrop only: as wiped
    for (let c = 0; c < 3; c++) out[o + c] = clamp(Math.round(p[c] + q * wiped[o + c]), 0, 255);
  }
}
/** Each chunk of paras (tokenize, colourize of text) where it starts and ends in text: [[para, chunk, start, end]]. */
function chunkSpans(paras, text) {
  const out = []; let cursor = 0;
  paras.forEach((para, q) => para.forEach((chunk, c) => {
    const src = chunk.map(p => p.text ?? p.src ?? "").join(""), i = src ? text.indexOf(src, cursor) : -1;
    if (i >= 0) { out.push([q, c, i, i + src.length]); cursor = i + src.length; }
  }));
  return out;
}
/** text[a, b) as text pieces in their colours (paras: colourize's of text), each w its width at z times hx. */
function runPieces(paras, text, a, b, measure, z, hx) {
  const spans = chunkSpans(paras, text), colour = j => {
    const s = spans.find(([, , i, e]) => i <= j && j < e);
    if (!s) return null;
    let at = s[2];
    for (const p of paras[s[0]][s[1]]) { const n = (p.text ?? p.src ?? "").length; if (j < at + n) return p.color || null; at += n; }
    return null;
  };
  const out = [];
  for (let j = a; j < b; j++) { const c = colour(j), last = out[out.length - 1]; if (last && last.c === c) last.text += text[j]; else out.push({ text: text[j], c }); }
  return out.map(({ text: t, c }) => ({ text: t, w: measure(t, z) * hx, ...(c ? { color: c } : {}) }));
}
/** The badge or icon of paras (colourize's of text, badgeLooks' looks on) at text index at as a run's pieces, w wide
 *  (an icon at size ez, left set); [] none. */
function pillAt(paras, text, at, { w, ez, left }) {
  for (const [q, c, s] of chunkSpans(paras, text)) {
    let o = s;
    for (const p of paras[q][c]) { if ((p.badge || p.icon) && o === at) return [{ ...p, w, ...(p.icon && ez ? { ez, left } : {}) }]; o += (p.text ?? p.src ?? "").length; }
  }
  return [];
}
/** The card's line step (R's lines): their baselines' median gap, else pitch. */
const lineStep = (L, pitch) => { const gaps = L.slice(1).map((l, j) => l.base - L[j].base).filter(g => g > 0); return gaps.length ? median(gaps) : pitch; };
/** x of a new line set as the card's line l sets its own (its just: right, centred or left). */
const justAt = l => (l.just === 1 || l.just === 4 ? n => l.right - n.w : l.just === 2 || l.just === 5 ? n => (l.left + l.right) / 2 - n.w / 2 : () => l.left);
/** geoPlan's changed paragraphs (paras: colourize's of now) wrapped at R's frame at z from plan.from: their lines, the
 *  first one's baseline (the first gone line's, else a step past the last kept one), the line set as theirs (ref) and
 *  how far the lines after move (dy). */
function geoLines(R, plan, paras, now, z, measure, step) {
  const [qa, qb] = plan.paras, spans = chunkSpans(paras, now), sel = [], L = R.lines, G = plan.gone;
  for (let q = qa; q < qb; q++) sel.push((paras[q] || []).filter((_, c) => { const s = spans.find(([p, k]) => p === q && k === c); return s && (q > qa || s[2] >= plan.from); }));
  const lines = layout(sel, R.frame ? R.frame[1] - R.frame[0] : Infinity, z, measure), ref = L[G[0] ?? plan.keep[plan.keep.length - 1] ?? plan.after[0]];
  return { lines, ref, base: G.length || !plan.keep.length ? ref.base : ref.base + step, dy: (lines.length - G.length) * step };
}
/** Where an Ability that grows on the card's own lines (geoDraw's lines path) puts its ink: {floor: the card's inked
 *  lines' lowest bottom (a blank line's is its baseline), step, paint: [{lines, at, base}]: the new lines, then the lines
 *  after, moved, low / deep: the lowest baseline of a line with ink / of any}; null when no line has ink. */
export function geoRoom(R, plan, paras, text, z, measure, pitch, icons) {
  const L = R.lines, inked = L.filter(l => l.bottom > l.top), step = lineStep(L, pitch);
  if (!inked.length) return null;
  const { lines, ref, base, dy } = geoLines(R, plan, paras, String(text ?? "").replace(/\r/g, ""), z, measure, step);
  const after = plan.after.map(j => ({ lines: layout(tokenize(R.was.slice(L[j].s, L[j].e), icons), Infinity, z, measure), at: justAt(L[j]), base: L[j].base + dy }));
  const paint = [{ lines, at: justAt(ref), base }, ...after];
  let low = -Infinity, deep = -Infinity;
  for (const p of paint) p.lines.forEach((l, i) => { const y = p.base + i * step; deep = Math.max(deep, y); if (l.pieces.some(q => q.icon || q.badge || q.text?.trim())) low = Math.max(low, y); });
  return { floor: Math.max(...inked.map(l => l.bottom)), step, low, deep, paint };
}
/** An Ability on the card's own lines (recordLayout R, geoPlan's plan): spliced (spliceFit: its one changed line, or
 *  each of several when all fit and staysDown), else re-wrapped as the bake wraps them (ownWrap), else its unchanged
 *  paragraphs' lines kept and the rest wrapped at the frame from where the change starts (wrapped lines that read as
 *  the card's first or last ones there kept too); kept lines are the card's pixels (moveInk, onto the plate's wiped
 *  ones: moved as the bake moves them). "splice" | "splices" | "wrap" | "lines", or "" when none holds (drawText's way
 *  then). box: the layer's plate crop (image px); z: its set size; grow: room for more lines at it (drawText's
 *  roomBelow); only: spliced or "" (a title); look: paintLines' options. bare: () => the crop's cuts without its FX
 *  layers, pasted when an FX layer's word moves or is redrawn (the bake moves the layer with it). cover: moveInk's. */
export function geoDraw(ctx, { R, plan, card, box, fx, bare = null, cover = null, measure, z, grow, only = false, icons, paras, text, look, pitch, W }) {
  const H = ctx.canvas.height, L = R.lines, now = String(text ?? "").replace(/\r/g, ""), B = bands(L, box);
  const step = lineStep(L, pitch);
  const runOf = sp => { const j = sp.b > sp.a ? sp.a : Math.max(0, sp.a - 1); return R.fr?.find(([s, e, , m]) => m && s <= j && j < e) || null; };   // the bake: the replaced text's font, an insertion the one before's
  let fit = plan.splice && spliceFit(R, plan.splice, { measure, z, icons, fx, W, font: runOf(plan.splice) }), useBare = false;
  if (!fit && plan.splice && bare && fx?.length && !fxSpans(R.was, fx).some(([s, e]) => s < plan.splice.b && plan.splice.a < e)) {   // FX words shift, unedited
    fit = spliceFit(R, plan.splice, { measure, z, icons, fx: [], W, font: runOf(plan.splice) }); useBare = !!fit; }
  const pill = fit?.tag && pillAt(paras, now, fit.tag.at, fit.tag);   // a badge's new pill alone, or an icon
  if (pill && !pill.length) fit = null;
  const segPieces = (f, at, o = null) => { const ps = f.segs.map(([s, e, isTag, w]) => (isTag ? pillAt(paras, now, at + s, { w }) : runPieces(paras, now, at + s, at + e, o?.[3] || measure, f.z, f.hx).map(p => (o ? { ...p, fam: o[2] } : p))));
    return f.segs.every((g, n) => !g[2] || ps[n].length) ? ps.flat() : null; };   // a tag's pill found, else no splice
  if (fit?.segs && !segPieces(fit, plan.splice.at)) fit = null;
  let sps = fit ? [plan.splice] : null, fits = [fit], pills = [pill];
  if (!fit && plan.splices) {                         // several lines changed: each spliced on its own when all fit
    const fs = plan.splices.map(sp => spliceFit(R, sp, { measure, z, icons, fx, W, font: runOf(sp) })), ps = fs.map(f => f?.tag && pillAt(paras, now, f.tag.at, f.tag));
    if (fs.every((f, n) => f && !(ps[n] && !ps[n].length) && !(f.segs && !segPieces(f, plan.splices[n].at))) && (!R.frame || staysDown(R, plan.splices, fs, now, measure, z))) [sps, fits, pills] = [plan.splices, fs, ps];
  }
  if (!sps && only) return "";
  let drawn = null, ow = null, x0 = box[0], x1 = box[2];
  if (sps) {
    const pad = Math.max(...fits.map(f => Math.abs(f.dp) + Math.abs(f.ds))), own = new Set(sps.map(sp => sp.i));
    x0 -= pad; x1 += pad;
    drawn = { paints: sps.map(({ i, at, run }, n) => { const f = fits[n], o = runOf(sps[n]);
        return [pills[n] ? [{ pieces: pills[n] }] : f.segs ? (run ? [{ pieces: segPieces(f, at, o) }] : []) : run ? [{ pieces: runPieces(paras, now, at, at + run.length, o?.[3] || measure, f.z, f.hx).map(p => (o ? { ...p, fam: o[2] } : p)) }] : [], { at: () => f.xa + f.dp, base: L[i].base, hx: look.hx * f.hx, z: f.z }]; }),
      moves: [...L.flatMap((_, j) => (own.has(j) ? [] : [[[x0, B[j][0], x1, B[j][1]], 0, 0]])),
        ...sps.flatMap(({ i }, n) => [[[x0, B[i][0], fits[n].cutA, B[i][1]], fits[n].dp, 0], [[fits[n].cutB, B[i][0], x1, B[i][1]], fits[n].ds, 0]])] };
  } else if ((ow = ownWrap(R, plan, now, paras, { measure, z, fx, icons, step, B, x0, x1 }))) {   // the bake's wrap: the card's own words moved
    if (ow.dy > 0 && !grow) return "";
    drawn = { paints: ow.paints.map(([lines, o]) => [lines, { ...o, hx: look.hx * o.hx }]),
      moves: [...plan.keep.map(j => [[x0, B[j][0], x1, B[j][1]], 0, 0]), ...ow.moves, ...plan.after.map(j => [[x0, B[j][0], x1, B[j][1]], 0, ow.dy])] };
  } else {
    const { lines, ref, base, dy } = geoLines(R, plan, paras, now, z, measure, step), G = plan.gone, at = justAt(ref);
    if (dy > 0 && !grow) return "";                 // more lines where the bake would shrink the text
    const fxs = fxSpans(R.was, fx), moving = j => fxs.some(([s, e]) => L[j].s < e && s < L[j].e);   // a line with an FX layer's word
    if (dy && !bare && plan.after.some(moving)) return "";   // that word would move: no plate without its layer
    const flat = s => s.replace(/\s+/g, " ").trim(), was = G.map(j => flat(R.was.slice(L[j].s, L[j].e))), got = lines.map(l => flat(l.pieces.map(p => p.text ?? p.src ?? "").join("")));
    let h = 0; while (h < G.length && h < lines.length && was[h] && got[h] === was[h]) h++;   // wrapped as the card's: its own lines
    let k = 0; while (k < G.length - h && k < lines.length - h && was[G.length - 1 - k] && got[lines.length - 1 - k] === was[G.length - 1 - k] && !(dy && !bare && moving(G[G.length - 1 - k]))) k++;
    const from = h ? L[G[h - 1]].base + step : base, tail = G.slice(G.length - k).map((j, n) => [j, from + (lines.length - h - k + n) * step - L[j].base]);
    useBare = !!bare && [...tail.filter(([, d]) => d).map(([j]) => j), ...(dy ? plan.after : []), ...G.slice(h, G.length - k)].some(moving);   // moved or redrawn
    drawn = { paints: [[lines.slice(h, lines.length - k), { at, base: from, hx: look.hx, z }]],
      moves: [...[...plan.keep, ...G.slice(0, h)].map(j => [[x0, B[j][0], x1, B[j][1]], 0, 0]), ...tail.map(([j, d]) => [[x0, B[j][0], x1, B[j][1]], 0, d]), ...plan.after.map(j => [[x0, B[j][0], x1, B[j][1]], 0, dy])] };
  }
  if (useBare && !pasteCuts(ctx, W, bare())) return "";   // FX layers off: moveInk moves their ink as letters
  const ya = clamp(Math.floor(Math.min(...drawn.moves.map(([r, , d]) => r[1] + Math.min(0, d)))), 0, H), yb = clamp(Math.ceil(Math.max(...drawn.moves.map(([r, , d]) => r[3] + Math.max(0, d)))) + 1, ya, H);
  if (yb > ya) {                                     // the rows the moves touch
    const img = ctx.getImageData(0, ya, W, yb - ya), wiped = img.data.slice();
    for (const [rect, dx, dy] of drawn.moves) moveInk(img.data, wiped, card, W, [ya, yb], rect, dx, dy, cover);
    ctx.putImageData(img, 0, ya);
  }
  const spliced = (sps || ow) && look.stroke0 !== undefined ? { stroke: look.stroke0, strokeW: look.strokeW0, strokeA: look.strokeA0 } : {};   // the layer's own Stroke (stacked, it covered the card's letters beside it)
  for (const [lines, o] of drawn.paints) paintLines(ctx, lines, { ...look, ...spliced, ...o, pitch: step });
  return sps ? (sps.length > 1 ? "splices" : "splice") : ow ? "wrap" : "lines";
}
/** An added ability as the bake sets it (the details' addLook: card_checks' plan font, px and leading, the template
 *  Ability's colour, Stroke and just): from the room's top (its first ink row), centred or left set, smaller by 0.94
 *  down to 40% (ability_place FIT_MIN) only while its lines run past the room. True: still past it. */
function drawAdded(ctx, { text, area, fam, layer: look, measure, icons, colors, statuses, fills, kc }, imgs) {
  const b = area.box, z0 = look.px * kc, lead = look.lead > 0 ? look.lead / look.px : LINE, room = b[3] - b[1];
  const paras = colourize(tokenize(text, icons), text, colors, "ability", statuses, null, null, fills);
  const tall = (lines, z) => (lines.length - 1) * z * lead + z;
  let z = z0, lines = layout(paras, b[2] - b[0], z, measure);
  while (tall(lines, z) > room + 0.5 && z > z0 * 0.4) { z *= 0.94; lines = layout(paras, b[2] - b[0], z, measure); }
  const stroke = Array.isArray(look.stroke) && look.stroke.length === 4 ? look.stroke : null;
  paintLines(ctx, lines, { at: l => (look.just === 0 ? b[0] : (b[0] + b[2] - l.w) / 2), base: b[1] + measure.cap(z)[0], pitch: z * lead, z, fam,
    label: measure.label, track: measure.track, hx: measure.hx, fb: measure.fb, fill: hexRgb(look.color) || [255, 255, 255], stroke: stroke?.slice(0, 3),
    strokeW: stroke ? 2 * stroke[3] * kc : 0, imgs });
  return tall(lines, z) > room + 0.5;
}
const BOX_FILL = [16, 16, 22];                        // drawBox's box
/** No block held the old text: the new text in a dark box over the area (the template's, or the record's box), so the
 *  old text is covered, never half there. top: the box only as tall as the lines, at the area's top (an added ability in
 *  the bake's area, card_checks' room). */
function drawBox(ctx, { role, text, area, fam, measure, icons, one, colors, statuses, ink, fills, top }, imgs, W, H, shape) {
  const r = area.seed ? [0, area.seed[0], W, H] : area.box;     // the text area to the card's edges (the old text may touch them)
  const b = area.seed ? r : [r[0] - W * 0.01, r[1] - H * 0.004, r[2] + W * 0.01, r[3] + H * 0.004], pad = W * 0.03;
  const start = role === "name" ? (b[3] - b[1]) * 0.5 : W * (shape === "square" ? 0.06 : shape === "item" ? 0.05 : 0.045);
  const { size: z, lines } = fit(colourize(tokenize(text, icons), text, colors, role, statuses, ink, BOX_FILL, fills), b[2] - b[0] - 2 * pad, b[3] - b[1] - pad, start, measure, role === "name" ? { lines: 1, min: 0.3 } : { min: 0.35 });
  const over = lines.length * z * LINE > b[3] - b[1] - pad + 0.5;
  if (top) b[3] = Math.min(b[3], b[1] + lines.length * z * LINE + pad);
  const rad = Math.min(W * 0.03, (b[3] - b[1]) / 2);
  ctx.save(); ctx.beginPath(); ctx.moveTo(b[0] + rad, b[1]); ctx.arcTo(b[2], b[1], b[2], b[3], rad); ctx.arcTo(b[2], b[3], b[0], b[3], rad); ctx.arcTo(b[0], b[3], b[0], b[1], rad); ctx.arcTo(b[0], b[1], b[2], b[1], rad); ctx.closePath();
  ctx.fillStyle = rgb(BOX_FILL); ctx.fill(); ctx.lineWidth = Math.max(1.5, W * 0.003); ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.setLineDash([W * 0.012, W * 0.008]); ctx.stroke(); ctx.restore();
  const pitch = z * LINE, base = (b[1] + b[3]) / 2 - (lines.length * pitch) / 2 + z * 0.9, mid = (b[0] + b[2]) / 2;
  paintLines(ctx, lines, { at: l => mid - l.w / 2, base, pitch, z, fam, label: measure.label, track: measure.track, hx: measure.hx, fb: measure.fb, fill: [255, 255, 255], stroke: [0, 0, 0], imgs, one });
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
/** A layer-comp bar from `from` (0-10) to `to` (11-20) as its comps draw it: the top half row all lit, the bottom half lit
 *  to to - 10 and dark after (the first dark cell's, a shade when none or the rounded end), a soft border-coloured line
 *  between the halves of the cells lit in both. lit (paintLit's, from 0): cells lit from other rows, dark as they were. */
export function paintComp(data, W, H, row, from, to, lit = null) {
  const [x0, y0, x1, y1] = px(row.box, W, H), cw = (x1 - x0) / row.cells, mid = Math.round((y0 + y1) / 2);
  const cellBox = c => [Math.round(x0 + c * cw), Math.round(x0 + (c + 1) * cw)];
  const src = new Uint8ClampedArray(data), d = from < row.cells - 1 ? cellBox(from)[0] : null;
  const e = (mid * W + cellBox(1)[0]) * 4, line = [src[e], src[e + 1], src[e + 2]];   // a cell border
  if (lit) paintLit(data, W, H, row, lit, row.cells); else paintCells(data, W, H, row, from, row.cells);
  for (let c = to - row.cells; c < row.cells; c++) {
    const [a, b] = cellBox(c);
    for (let y = mid; y < y1 - 1; y++) for (let x = a + 1; x < b - 1; x++) {
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) data[i + ch] = lit ? src[i + ch] : d == null ? data[i + ch] * 0.38 : src[(y * W + d + x - a) * 4 + ch];
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

// ---- a whole-field colour on textured or adjusted letters: mixed from the bake's looks (card_plates tints)
export const PROBES = ["#000000", "#ff0000", "#00ff00", "#0000ff", "#00ffff", "#ff00ff", "#ffff00", "#ffffff", "#808080"];   // AutoCroissant card_plates.PROBES
const LOOK_MOVED = 8;                                 // levels: a pixel the looks move more than this is the letters'
const lumaOf = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;   // psd-tools' Gradient Map's (blend.py _lum)
const PROBE_LUMA = PROBES.map(h => lumaOf([1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)));
const BY_LUMA = PROBE_LUMA.map((_, n) => n).sort((a, b) => PROBE_LUMA[a] - PROBE_LUMA[b]);
const MIXES = new WeakMap();                          // a plate's tint -> its looks read at one size (mixLooks)
/** A tint's looks at w x h (read: the plate's cuts), read once: {key, V (a look's pixels per PROBES), moved, still (the
 *  box's pixel indices the looks move past LOOK_MOVED, and the rest)}. */
function mixLooks(t, w, h, read) {
  const key = `${w}x${h}`, had = MIXES.get(t);
  if (had?.key === key) return had;
  const V = t.at.map(at => read({ at }, w, h)), moved = [], still = [];
  for (let p = 0, j = 0; p < w * h; p++, j += 4) {
    let mv = false;
    for (let n = 1; n < V.length && !mv; n++) mv = Math.abs(V[n][j] - V[0][j]) > LOOK_MOVED || Math.abs(V[n][j + 1] - V[0][j + 1]) > LOOK_MOVED || Math.abs(V[n][j + 2] - V[0][j + 2]) > LOOK_MOVED;
    (mv ? moved : still).push(p);
  }
  const bent = new Float32Array(moved.length * 3);    // per moved pixel and channel: the grey look less the corners' mean
  moved.forEach((p, q) => { for (let e = 0; e < 3; e++) { let sum = 0; for (let n = 0; n < 8; n++) sum += V[n][p * 4 + e]; bent[q * 3 + e] = V[8][p * 4 + e] - sum / 8; } });
  const got = { key, V, moved: Int32Array.from(moved), still: Int32Array.from(still), bent };
  MIXES.set(t, got);
  return got;
}
/** {boxes: [{x0, y0, w, ...mixLooks}], rgb (0..1)} for a whole-field colour (colors: the field's have no phrase; the
 *  last paints) on layers ids whose plate holds the bake's looks of it in the PROBES colours (tints), or null (another
 *  picture's: their unmoved pixels off the card's, PLATE_OFF). */
export function mixPlan(data, W, H, k, plate, ids, colors, role, read) {
  const mine = (Array.isArray(colors) ? colors : []).filter(o => o?.field === role), rgb = mine.length && !mine.some(o => o.phrase) ? hexRgb(mine[mine.length - 1].color) : null;
  const of = id => (Array.isArray(plate?.tints) ? plate.tints : []).find(t => String(t.id) === String(id) && Array.isArray(t.box) && Array.isArray(t.at) && t.at.length === PROBES.length);
  if (!rgb || !ids.length || ids.some(id => !of(id))) return null;
  const boxes = [];
  for (const id of ids) {
    const t = of(id), [x0, y0, x1, y1] = px(t.box.map(v => v * k), W, H), w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return null;
    const got = mixLooks(t, w, h, read), V0 = got.V[0];
    let sum = 0;
    for (const p of got.still) {
      const j = p * 4, i = ((y0 + ((p / w) | 0)) * W + x0 + (p % w)) * 4;
      sum += Math.max(Math.abs(V0[j] - data[i]), Math.abs(V0[j + 1] - data[i + 1]), Math.abs(V0[j + 2] - data[i + 2]));
    }
    if (got.still.length >= 50 && sum > PLATE_OFF * got.still.length) return null;
    boxes.push({ x0, y0, w, luma: !!t.luma, ...got });
  }
  return { boxes, rgb: rgb.map(v => v / 255) };
}
/** mixPlan's looks mixed at its colour, each pixel they move: trilinear over the RGB cube's corner looks plus the grey
 *  look's bend per channel ((grey - the corners' mean) x 4c(1 - c)); under a Gradient Map (luma: its output follows the
 *  luma alone) between the two looks whose probes' lumas hold the colour's. The rest keep the card's pixels. */
export function paintMix(data, W, { boxes, rgb }) {
  const [r, g, b] = rgb, [R, G, B] = rgb.map(v => 1 - v), bend = rgb.map(v => 4 * v * (1 - v));
  const cube = [R * G * B, r * G * B, R * g * B, R * G * b, R * g * b, r * G * b, r * g * B, r * g * b];   // PROBES' corners
  const L = lumaOf(rgb), f = BY_LUMA.findIndex(n => PROBE_LUMA[n] >= L), s = f < 0 ? BY_LUMA.length - 1 : Math.max(1, f), lo = BY_LUMA[s - 1], hi = BY_LUMA[s];
  const t = clamp((L - PROBE_LUMA[lo]) / (PROBE_LUMA[hi] - PROBE_LUMA[lo]), 0, 1);
  for (const { x0, y0, w, V, moved, bent, luma } of boxes) {
    const [k0, k1, k2, k3, k4, k5, k6, k7] = V, [c0, c1, c2, c3, c4, c5, c6, c7] = cube, A = V[lo], Z = V[hi];
    for (let q = 0; q < moved.length; q++) {
      const p = moved[q], j = p * 4, i = ((y0 + ((p / w) | 0)) * W + x0 + (p % w)) * 4;
      for (let e = 0; e < 3; e++) {
        const o = j + e;                              // a Uint8ClampedArray rounds and clamps
        data[i + e] = luma ? A[o] + (Z[o] - A[o]) * t
          : c0 * k0[o] + c1 * k1[o] + c2 * k2[o] + c3 * k3[o] + c4 * k4[o] + c5 * k5[o] + c6 * k6[o] + c7 * k7[o] + bent[q * 3 + e] * bend[e];
      }
    }
  }
}

// ---- a colour alone: the card's own letters recoloured in place (its plate's layout)
const lineBreaks = t => String(t ?? "").replace(/[\r\u0003]/g, "\n");   // Photoshop's paragraph and line breaks
const plain = t => String(t ?? "").replace(/\r/g, "").trim();   // text the same: a moved break is an edit
const sameWords = (a, b) => typeof a === "string" && lineBreaks(a).replace(/\s+/g, " ").trim() === lineBreaks(b).replace(/\s+/g, " ").trim();
/** {R, c, want, own} for tintInPlace when the plate (one layer, ids) has the layer's layout for old, colors newly paint
 *  some of its letters (colorRanges) and the layer's old fill shows in at least 4 in 5 of those (else an effect paints
 *  them otherwise); null: redrawn. layer: the details record's text layer (its colours over its text: runs). read: the
 *  layer has its own overlay (the bake turns it off): each letter's shown colour instead, badges too. */
export function tintPlan(data, W, plate, ids, k, old, layer, colors, role, statuses = null, read = null) {
  const geo = geoOf(plate, ids, k), R = geo && (recordLayout(geo.c, old, k) || (role === "name" && sameWords(geo.c.text, old) ? recordLayout(geo.c, lineBreaks(geo.c.text), k) : null));   // a title on several lines: the website's name joins them with spaces
  const want = R && colorRanges(R.was, colors, role, statuses);
  const own = want?.length ? (read ? shownFill(data, W, geo.c, k, R, layer, read) : tintOld(layer, R)) : null;   // its own overlay: the colour each letter shows
  const all = !!read;                                 // under its own overlay its badges are one colour: the bake paints them as letters
  return own && tintFits(data, W, R, want, own, all) ? { R, c: geo.c, want, own, all } : null;
}
/** Whether the text layer at path has its own enabled Color or Gradient Overlay and no group above it has one (the bake
 *  refuses a group's: paintedOver). */
function ownOverlay(rec, path, t = null) {
  const up = String(path || "").split("/").slice(0, -1).join("/");
  return oneColour(rec, path, /^(Color|Gradient)Overlay$/, t) && !(up && oneColour(rec, up));
}
/** The group above the field's text layer at path whose overlay a whole colour turns off too (psd_edit _owned_group): the
 *  nearest with an enabled overlay when every layer it shows (the record's tree) is one of the field's printed parts
 *  (The Big Yellow Cat's 'Overlay Text/Name'); its path, else null. */
export function ownedGroup(rec, path, f) {
  const p = obj(rec?.parts), fx = obj(rec?.effects) || {}, at = String(path || "").split("/");
  for (let i = at.length - 1; p && i > 0; i--) {
    const g = at.slice(0, i).join("/");
    if (!(Array.isArray(fx[g]) && fx[g].some(n => OVERLAY.test(String(n))))) continue;   // the nearest group with one
    let kids = Array.isArray(rec.tree) ? rec.tree : [];
    for (const name of at.slice(0, i)) { const n = kids.find(x => x?.[0] === name && x[1] === "group"); kids = n?.[2] && Array.isArray(n[3]) ? n[3] : null; if (!kids) return null; }
    const leaves = [], walk = (list, q) => { for (const n of list) if (n?.[2]) n[1] === "group" ? walk(Array.isArray(n[3]) ? n[3] : [], `${q}/${n[0]}`) : leaves.push(`${q}/${n[0]}`); };
    walk(kids, g);
    const left = printed(p, f).map(x => String(x?.layer || ""));
    return leaves.length && leaves.every(q => left.includes(q) && left.splice(left.indexOf(q), 1)) ? g : null;
  }
  return null;
}
/** Whether colors turn off the own overlay of the title layer at path (psd_edit set_colors' _overlay_off), or its
 *  ownedGroup's with no overlay above it: a whole title's colour. The bake then paints its letters flat in the colour. */
export const titleOff = (rec, path, colors) => (colors || []).some(o => o?.field === "name" && !o.phrase) && (ownOverlay(rec, path) || groupOff(rec, path));
/** The same for an Ability layer (t: its record entry): a whole Ability's colour turns its own overlay off (typed icons
 *  show their colours). */
const abilityOff = (rec, t, colors) => (colors || []).some(o => o?.field === "ability" && !o.phrase) && ownOverlay(rec, t?.layer, t);
function groupOff(rec, path) {
  const g = ownedGroup(rec, path, "name"), up = String(g || "").split("/").slice(0, -1).join("/");
  return !!g && oneColour(rec, g, /^(Color|Gradient)Overlay$/) && !(up && oneColour(rec, up));
}
/** Per index of R.was, the colour its letter shows under the layer's own overlay (the bake turns it off and paints the
 *  letters): the median of its ink pixels off the plate's backdrop and off the layer's Stroke colour (without one in the
 *  record: off the colour at its ink's edge, then of two colours left the lighter); null when few. */
function shownFill(data, W, c, k, R, layer, read) {
  const H = data.length / 4 / W, [cx0, cy0, cx1, cy1] = px(c.box.map(v => v * k), W, H), cw = cx1 - cx0, ch = cy1 - cy0;
  if (cw < 1 || ch < 1 || !String(layer?.text ?? "").trim()) return null;
  const bg = read(c, cw, ch), stroke = Array.isArray(layer?.stroke) && layer.stroke[3] > 0 ? layer.stroke : null, memo = new Map();
  const med = got => got[0].length >= 3 ? got.map(v => v.sort((a, b) => a - b)[v.length >> 1]) : null;
  return i => {
    if (memo.has(i)) return memo.get(i);
    const ink = R.ink.get(i), line = R.lines.find(l => l.para >= 0 && i >= l.s && i < l.e);
    let f = null;
    if (ink && line) {
      const x0 = Math.max(cx0, Math.floor(ink[0])), x1 = Math.min(cx1, Math.ceil(ink[1])), y0 = Math.max(cy0, Math.floor(line.top)), y1 = Math.min(cy1, Math.ceil(line.bottom));
      const off = (x, y) => { const p = (y * W + x) * 4, q = ((y - cy0) * cw + (x - cx0)) * 4; return (data[p] - bg[q]) ** 2 + (data[p + 1] - bg[q + 1]) ** 2 + (data[p + 2] - bg[q + 2]) ** 2 >= OFF_PLATE; };
      const at = (x, y) => { const p = (y * W + x) * 4; return [data[p], data[p + 1], data[p + 2]]; };
      const edge = [[], [], []], inks = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (!off(x, y)) continue;
        const d = at(x, y); inks.push(d);
        if ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([u, v]) => u >= x0 && u < x1 && v >= y0 && v < y1 && !off(u, v))) for (let e = 0; e < 3; e++) edge[e].push(d[e]);
      }
      const st = stroke || med(edge), got = [[], [], []], dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2, far = (a, b) => dist(a, b) > 2500;
      let keep = inks.filter(d => !st || far(d, st));   // its Stroke, else the colour at its ink's edge (a glow, a shadow or an unrecorded Stroke)
      if (!stroke && keep.length >= 6) {               // an unrecorded Stroke inside a shadow: of two colours, the lighter (our Strokes are dark)
        const mean = g => [0, 1, 2].map(e => g.reduce((t, d) => t + d[e], 0) / g.length);
        let c = [mean(keep)], parts = [keep, []];      // two-means from the mean and the colour farthest from it
        c[1] = keep.reduce((a, d) => (dist(d, c[0]) > dist(a, c[0]) ? d : a), keep[0]);
        for (let n = 0; n < 6; n++) {
          parts = [[], []]; for (const d of keep) parts[dist(d, c[0]) <= dist(d, c[1]) ? 0 : 1].push(d);
          if (!parts[0].length || !parts[1].length) break;
          c = parts.map(mean);
        }
        if (far(c[0], c[1]) && Math.min(parts[0].length, parts[1].length) >= 3) keep = c[0][0] + c[0][1] + c[0][2] >= c[1][0] + c[1][1] + c[1][2] ? parts[0] : parts[1];
      }
      for (const d of keep) for (let e = 0; e < 3; e++) got[e].push(d[e]);
      f = med(got);
    }
    memo.set(i, f); return f;
  };
}
/** Old fill colour per index of R.was from the record's layer (runs over its text), or null when its text (icon variants
 *  aside) isn't R's. */
function tintOld(lay, R) {
  if (!R || !lay) return null;
  const T0 = String(lay.text ?? "").replace(/[\r\u0003]/g, "\n"), core = R.was.trim();
  if (!core) return null;
  let T = T0; const back = [];                        // T's index -> the record's
  if (T.trim() !== core) {                            // the record has [dark:sticker], the website [dark]
    const v = noVariants(T0); if (!v || v.T.trim() !== core) return null;
    for (let j = 0; j < T0.length; j++) back[v.at(j)] = j;
    T = v.T;
  }
  const shift = R.was.indexOf(core) - T.indexOf(core), cols = Array.isArray(lay.colors) ? lay.colors : [lay.color];
  const runs = Array.isArray(lay.runs) && lay.runs.length ? lay.runs : [[0, T0.length, 0]];
  return i => { const j = back[i - shift] ?? i - shift, r = runs.find(([a, b]) => j >= a && j < b); return hexRgb(r ? cols[r[2]] : lay.color); };
}
/** The letters want paints: [{f (old fill), nw (new colour), ink, line}]; never a space, nor an icon or badge (drawnSpans)
 *  unless all. */
function tintLetters(R, want, own, all = false) {
  const icon = new Set(all ? [] : drawnSpans(R.was).flatMap(([a, b]) => Array.from({ length: b - a }, (_, j) => a + j))), out = [];
  for (const { start, end, color } of want) for (let i = start; i < end; i++) {
    const f = own(i), nw = hexRgb(color), ink = R.ink.get(i), line = R.lines.find(l => l.para >= 0 && i >= l.s && i < l.e);
    if (f && nw && ink && line && !icon.has(i) && !/\s/.test(R.was[i] || " ")) out.push({ f, nw, ink, line });
  }
  return out;
}
/** Whether the old fill shows in at least 4 in 5 of the letters to recolour. */
function tintFits(data, W, R, want, own, every = false) {
  const all = tintLetters(R, want, own, every);
  const seen = all.filter(({ f, ink, line }) => {
    for (let y = Math.max(0, Math.floor(line.top)); y < Math.ceil(line.bottom); y++) for (let x = Math.max(0, Math.floor(ink[0])); x < Math.min(W, Math.ceil(ink[1])); x++) {
      const p = (y * W + x) * 4;
      if ((data[p] - f[0]) ** 2 + (data[p + 1] - f[1]) ** 2 + (data[p + 2] - f[2]) ** 2 < 1600) return true;
    }
    return false;
  });
  return all.length > 0 && seen.length >= 0.8 * all.length;
}
const OFF_PLATE = 3600, SAME_FILL = 900, DOWNHILL = 24;   // squared RGB distances; levels
/** tintPlan's letters, each pixel of its ink box (+2 px) moved from the old fill toward the new colour by its share of
 *  the fill: fitted against the plate's backdrop pixel or the letter's stroke (its off-backdrop ink farthest from the
 *  fill), the better fit. What the box's edge reaches from the backdrop going only away from the fill (the backdrop, a
 *  stroke's outside) stays; each pixel tinted once. read(c, w, h): the plate crop's pixels at w x h. */
export function tintInPlace(data, W, H, k, { R, c, want, own, all = false }, read) {
  const [cx0, cy0, cx1, cy1] = px(c.box.map(v => v * k), W, H), cw = cx1 - cx0, ch = cy1 - cy0;
  if (cw < 1 || ch < 1) return;
  const bg = read(c, cw, ch), done = new Uint8Array(cw * ch), d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  for (const { f, nw, ink, line } of tintLetters(R, want, own, all)) {
    const x0 = clamp(Math.floor(ink[0]) - 2, cx0, cx1), x1 = clamp(Math.ceil(ink[1]) + 2, cx0, cx1), y0 = clamp(Math.floor(line.top) - 2, cy0, cy1), y1 = clamp(Math.ceil(line.bottom) + 2, cy0, cy1);
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 1 || bh < 1) continue;
    const P = [], B = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = (y * W + x) * 4, q = ((y - cy0) * cw + (x - cx0)) * 4;
      P.push([data[p], data[p + 1], data[p + 2]]); B.push([bg[q], bg[q + 1], bg[q + 2]]);
    }
    let s = null, far = 0;                             // a stroke: the ink off the backdrop farthest from the fill
    for (let j = 0; j < P.length; j++) { if (d2(P[j], B[j]) < OFF_PLATE) continue; const e = d2(P[j], f); if (e > far) { far = e; s = P[j]; } }
    const fd = P.map(q => Math.sqrt(d2(q, f))), on = P.map((q, j) => d2(q, B[j]) < OFF_PLATE), stay = new Uint8Array(P.length), stack = [];
    for (let j = 0; j < P.length; j++) {               // the backdrop from the box's edge (1), then only away from the fill (2)
      const x = j % bw, y = (j / bw) | 0;
      if ((!x || !y || x === bw - 1 || y === bh - 1) && on[j]) { stay[j] = 1; stack.push(j); }
    }
    while (stack.length) {
      const j = stack.pop(), x = j % bw, y = (j / bw) | 0;
      for (const n of [x > 0 && j - 1, x < bw - 1 && j + 1, y > 0 && j - bw, y < bh - 1 && j + bw]) {
        if (n === false || stay[n]) continue;
        const v = stay[j] === 1 && on[n] ? 1 : fd[n] >= fd[j] - DOWNHILL && fd[n] >= 40 ? 2 : 0;
        if (v) { stay[n] = v; stack.push(n); }
      }
    }
    for (let j = 0; j < P.length; j++) {
      const x = x0 + (j % bw), y = y0 + ((j / bw) | 0), m = (y - cy0) * cw + (x - cx0);
      if (stay[j] || done[m]) continue;
      let t = 0, best = Infinity;
      for (const o of [B[j], s]) {
        if (!o) continue;
        const dd = d2(f, o); if (dd < SAME_FILL) continue;
        const a = clamp(((P[j][0] - o[0]) * (f[0] - o[0]) + (P[j][1] - o[1]) * (f[1] - o[1]) + (P[j][2] - o[2]) * (f[2] - o[2])) / dd, 0, 1);
        const r = d2(P[j], [o[0] + a * (f[0] - o[0]), o[1] + a * (f[1] - o[1]), o[2] + a * (f[2] - o[2])]);
        if (r < best) { best = r; t = a; }
      }
      if (best === Infinity) t = clamp(1 - fd[j] / 60, 0, 1);
      if (!t) continue;
      const p = (y * W + x) * 4;
      for (let e = 0; e < 3; e++) data[p + e] = clamp(Math.round(data[p + e] + t * (nw[e] - f[e])), 0, 255);
      done[m] = 1;
    }
  }
}
