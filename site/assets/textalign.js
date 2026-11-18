// How an edit of card text lines up with the text it replaces: a port of AutoCroissant commands/text_align.py (the bake's
// alignment, owner 2026-11-03, Pot Full of Spiders!): paragraphs first, then words, never letters across a break; a
// moved paragraph is found as moved. The mock-up colours an edit with it as the bake does (mockup.js bakeInk). The
// AutoCroissant test test_text_align pins it to the Python on real card edits. Offsets are UTF-16 (JS strings).
const BREAKS = "\r\n\u0003", BLANKS = BREAKS + " ";
const UNIT = /\[[^[\]\r\n\u0003]{1,52}\]|\(-?[0-9A-Za-z/]{2,8}\)|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[\s\S]/gu, WORD = /^[\p{L}\p{N}]/u;
const PAIR_BONUS = 0.05, REFINE_MIN = 0.5, MOVE_MIN = 0.6;
export const SAME_RUN = 3;                           // psd_edit.SAME_RUN: kept this many in a row, never restyled

/** difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks(): [[i, j, n]], ending [len a, len b, 0]. */
function blocksOf(a, b) {
  const b2j = new Map();
  b.forEach((x, j) => { const l = b2j.get(x); if (l) l.push(j); else b2j.set(x, [j]); });
  const longest = (alo, ahi, blo, bhi) => {
    let bi = alo, bj = blo, bs = 0, j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        next.set(j, k);
        if (k > bs) { bi = i - k + 1; bj = j - k + 1; bs = k; }
      }
      j2len = next;
    }
    while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) { bi--; bj--; bs++; }
    while (bi + bs < ahi && bj + bs < bhi && a[bi + bs] === b[bj + bs]) bs++;
    return [bi, bj, bs];
  };
  const queue = [[0, a.length, 0, b.length]], found = [];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop(), x = longest(alo, ahi, blo, bhi), [i, j, k] = x;
    if (!k) continue;
    found.push(x);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  found.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const out = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of found) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
    else { if (k1) out.push([i1, j1, k1]); [i1, j1, k1] = [i2, j2, k2]; }
  }
  if (k1) out.push([i1, j1, k1]);
  return [...out, [a.length, b.length, 0]];
}
/** difflib's get_opcodes(): [[tag, i1, i2, j1, j2]]. */
function opcodesOf(a, b) {
  const out = [];
  let i = 0, j = 0;
  for (const [ai, bj, size] of blocksOf(a, b)) {
    const tag = i < ai && j < bj ? "replace" : i < ai ? "delete" : j < bj ? "insert" : "";
    if (tag) out.push([tag, i, ai, j, bj]);
    i = ai + size; j = bj + size;
    if (size) out.push(["equal", ai, i, bj, j]);
  }
  return out;
}
const ratio = (a, b) => (a.length + b.length ? (2 * blocksOf(a, b).reduce((s, x) => s + x[2], 0)) / (a.length + b.length) : 1);
const letters = t => t.split("");                    // UTF-16 units: offsets as JS strings count them
function paragraphs(t) {
  const out = [];
  let at = 0;
  for (let i = 0; i < t.length; i++) if (BREAKS.includes(t[i])) { out.push([at, i]); at = i + 1; }
  return [...out, [at, t.length]];
}
const units = (t, s = 0, e = t.length) => [...t.slice(s, e).matchAll(UNIT)].map(m => [s + m.index, s + m.index + m[0].length]);
/** How alike two paragraphs are, 0..1 (text_align.likeness). */
function likeness(a, b) {
  const words = t => units(t).map(([s, e]) => t.slice(s, e)).filter(u => !/^\s+$/.test(u)).map(u => u.toLowerCase());
  const x = words(a), y = words(b);
  if (!x.length && !y.length) return 1;
  const count = l => l.reduce((m, u) => m.set(u, (m.get(u) || 0) + 1), new Map()), cy = count(y);
  let shared = 0;
  for (const [u, n] of count(x)) shared += Math.min(n, cy.get(u) || 0);
  return (ratio(x, y) + 2 * shared / (x.length + y.length)) / 2;
}
function bestPairs(old, now) {
  const n = old.length, m = now.length, like = old.map(a => now.map(b => likeness(a, b) + PAIR_BONUS));
  const S = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) S[i][j] = Math.max(S[i - 1][j - 1] + like[i - 1][j - 1], S[i - 1][j], S[i][j - 1]);
  const out = [];
  let i = n, j = m;
  while (i && j) {
    if (S[i][j] === S[i - 1][j - 1] + like[i - 1][j - 1]) { out.push([i - 1, j - 1]); i--; j--; }
    else if (S[i][j] === S[i - 1][j]) i--;
    else j--;
  }
  return out.reverse();
}
const span = (a, b) => Array.from({ length: b - a }, (_, k) => a + k), most = l => (l.length ? Math.max(...l) : 0);
/** text_align.pairs: [[old index, new index]] of the paragraphs that are one; a likelier one elsewhere: moved. */
function pairs(old, now) {
  const ops = opcodesOf(old, now), stretches = ops.filter(o => o[0] !== "equal").map(o => o.slice(1));
  const looseA = stretches.flatMap(([i1, i2]) => span(i1, i2)), looseB = stretches.flatMap(([, , j1, j2]) => span(j1, j2));
  const movedA = new Set(), movedB = new Set();
  for (const [i1, i2, j1, j2] of stretches) {
    for (const k of span(i1, i2)) {
      const inside = most(span(j1, j2).map(m => likeness(old[k], now[m]))), outside = most(looseB.filter(m => m < j1 || m >= j2).map(m => likeness(old[k], now[m])));
      if (outside >= MOVE_MIN && outside > inside) movedA.add(k);
    }
    for (const m of span(j1, j2)) {
      const inside = most(span(i1, i2).map(k => likeness(old[k], now[m]))), outside = most(looseA.filter(k => k < i1 || k >= i2).map(k => likeness(old[k], now[m])));
      if (outside >= MOVE_MIN && outside > inside) movedB.add(m);
    }
  }
  const out = [];
  for (const [tag, i1, i2, j1, j2] of ops) {
    if (tag === "equal") { for (let k = 0; k < i2 - i1; k++) out.push([i1 + k, j1 + k]); continue; }
    const xs = span(i1, i2).filter(k => !movedA.has(k)), ys = span(j1, j2).filter(m => !movedB.has(m));
    for (const [a, b] of bestPairs(xs.map(k => old[k]), ys.map(m => now[m]))) out.push([xs[a], ys[b]]);
  }
  return out;
}
/** text_align.Layout: paragraphs, pairs and each character's group [kind, number, place]. */
function layout(old, now) {
  const pa = paragraphs(old), pb = paragraphs(now), found = pairs(pa.map(([s, e]) => old.slice(s, e)), pb.map(([s, e]) => now.slice(s, e)));
  const groups = (text, ps, partner, side) => {
    const own = ps.map((_, k) => (partner.has(k) ? ["p", partner.get(k)[0]] : [side, k])), first = partner.size ? Math.min(...partner.keys()) : ps.length;
    const out = new Array(text.length);
    ps.forEach(([s, e], k) => {
      for (let i = s; i < e; i++) out[i] = [...own[k], 1];
      if (k + 1 < ps.length) {                      // the break after paragraph k
        const after = k + 1, before = partner.has(after) ? partner.get(after)[1] > 0 : after > first, owner = before ? after : k;
        out[e] = [...own[owner], before ? 0 : own[owner][0] === "p" ? 2 : 1];
      }
    });
    return out;
  };
  return { old, now, pa, pb, pairs: found,
    ga: groups(old, pa, new Map(found.map(([i, j], n) => [i, [n, j]])), "a"), gb: groups(now, pb, new Map(found.map(([i, j], n) => [j, [n, i]])), "b") };
}
const kindOf = u => (WORD.test(u) ? "word" : u.length > 2 && "[(".includes(u[0]) ? u[0] : "");
/** The matching blocks of the paragraph old[a] against now[b]: units, then letters for one into one alike of its kind. */
function wordBlocks(old, now, a, b) {
  const ua = units(old, ...a), ub = units(now, ...b), out = [];
  let pa = 0, pb = 0;
  for (const [i, j, size] of blocksOf(ua.map(([s, e]) => old.slice(s, e)), ub.map(([s, e]) => now.slice(s, e)))) {
    if (i - pa === 1 && j - pb === 1) {
      const [s0, e0] = ua[pa], [s1, e1] = ub[pb], x = letters(old.slice(s0, e0)), y = letters(now.slice(s1, e1));
      if (kindOf(old.slice(s0, e0)) && kindOf(old.slice(s0, e0)) === kindOf(now.slice(s1, e1)) && ratio(x, y) >= REFINE_MIN)
        for (const [p, q, n] of blocksOf(x, y)) if (n) out.push([s0 + p, s1 + q, n]);
    }
    if (size) out.push([ua[i][0], ub[j][0], ua[i + size - 1][1] - ua[i][0]]);
    pa = i + size; pb = j + size;
  }
  return out;
}
const unblank = t => [...t].filter(c => !BLANKS.includes(c)).join("");
/** text_align.break_ops: the letter opcodes of an edit that only joins or splits lines, else null. */
function breakOps(old, now) {
  if (old === now || unblank(old) !== unblank(now)) return null;
  const ops = opcodesOf(letters(old), letters(now));
  for (const [tag, i1, i2, j1, j2] of ops) {
    const ch = [...old.slice(i1, i2) + now.slice(j1, j2)];
    if (tag !== "equal" && (ch.some(c => !BLANKS.includes(c)) || !ch.some(c => BREAKS.includes(c)))) return null;
  }
  return ops;
}
function layBlocks(L) {
  const { old, now } = L, found = [], merged = [];
  for (const [i, j] of L.pairs) {
    if (i && j && old[L.pa[i][0] - 1] === now[L.pb[j][0] - 1]) found.push([L.pa[i][0] - 1, L.pb[j][0] - 1, 1]);   // the break before it
    found.push(...wordBlocks(old, now, L.pa[i], L.pb[j]));
  }
  for (const [i, j, n] of found) {
    const m = merged[merged.length - 1];
    if (m && m[0] + m[2] === i && m[1] + m[2] === j) m[2] += n; else merged.push([i, j, n]);
  }
  return [...merged, [old.length, now.length, 0]];
}
const key = g => g.join("|");
function runsOf(groups, lo, hi) {
  const out = [];
  for (let k = lo; k < hi; k++) { const l = out[out.length - 1]; if (l && key(l[2]) === key(groups[k])) l[1] = k + 1; else out.push([k, k + 1, groups[k]]); }
  return out;
}
function firstOf(x, y, L) {
  if (x[0] === y[0] && x[1] === y[1]) return x[2] < y[2];
  if (x[0] === "p" && y[0] === "p") return x[1] < y[1];
  if (x[0] === "a" && y[0] === "p") return x[1] < L.pairs[y[1]][0];
  if (x[0] === "p" && y[0] === "b") return L.pairs[x[1]][1] < y[1];
  return x[0] === "a";
}
/** text_align.segments: [[tag, i1, i2, j1, j2, group]], each change split where its group (paragraph) changes. */
export function taSegments(old, now) {
  const ops = breakOps(old, now);
  if (ops) return ops.map((op, k) => [...op, `brk|${k}`]);
  const L = layout(old, now), out = [];
  let i = 0, j = 0;
  for (const [a, b, n] of layBlocks(L)) {
    const olds = runsOf(L.ga, i, a), news = runsOf(L.gb, j, b);
    let ci = i, cj = j;
    while (olds.length || news.length) {            // in paragraph order, so typed text sits in its own paragraph
      const x = olds[0], y = news[0];
      if (x && y && key(x[2]) === key(y[2])) { out.push(["replace", x[0], x[1], y[0], y[1], key(x[2])]); ci = x[1]; cj = y[1]; olds.shift(); news.shift(); }
      else if (x && (!y || firstOf(x[2], y[2], L))) { out.push(["delete", x[0], x[1], cj, cj, key(x[2])]); ci = x[1]; olds.shift(); }
      else { out.push(["insert", ci, ci, y[0], y[1], key(y[2])]); cj = y[1]; news.shift(); }
    }
    if (n) out.push(["equal", a, a + n, b, b + n, key(L.ga[a])]);
    i = a + n; j = b + n;
  }
  return out;
}
/** text_align.moves: [[[old start, end], [new start, end], blocks from each start]] of the paragraphs the edit moved. */
export function taMoves(old, now) {
  if (breakOps(old, now)) return [];
  const L = layout(old, now), pA = new Set(L.pairs.map(p => p[0])), pB = new Set(L.pairs.map(p => p[1]));
  const gone = span(0, L.pa.length).filter(k => !pA.has(k) && old.slice(...L.pa[k]).trim()), came = span(0, L.pb.length).filter(k => !pB.has(k) && now.slice(...L.pb[k]).trim());
  const scored = gone.flatMap(a => came.map(b => [likeness(old.slice(...L.pa[a]), now.slice(...L.pb[b])), a, b])).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2]);
  const out = [], usedA = new Set(), usedB = new Set();
  for (const [s, a, b] of scored) {
    if (s < MOVE_MIN || usedA.has(a) || usedB.has(b)) continue;
    const [s0, e0] = L.pa[a], [t0, t1] = L.pb[b];
    out.push([[s0, e0], [t0, t1], wordBlocks(old, now, [s0, e0], [t0, t1]).map(([i, j, n]) => [i - s0, j - t0, n])]);
    usedA.add(a); usedB.add(b);
  }
  return out.sort((x, y) => x[1][0] - y[1][0]);
}
/** text_align.blocks: [[i, j, n]] the edit keeps (psd_edit.kept_chars'). */
export const taBlocks = (old, now) => taSegments(old, now).filter(s => s[0] === "equal").map(s => [s[1], s[3], s[2] - s[1]]);
/** psd_edit.aligned_parts (edit_parts over the whole text): [[a0, a1, b0, b1, kept]]; a short kept stretch joins its
 *  paragraph's change. */
export function taParts(old, now) {
  const out = [];
  for (const [tag, a0, a1, b0, b1, g] of taSegments(old, now)) {
    const l = out[out.length - 1];
    if (tag === "equal" && (a1 - a0 >= SAME_RUN || [...old.slice(a0, a1)].some(c => BREAKS.includes(c)))) out.push([a0, a1, b0, b1, true, g]);
    else if (l && !l[4] && l[5] === g) { l[1] = a1; l[3] = b1; }
    else out.push([a0, a1, b0, b1, false, g]);
  }
  return out.map(p => p.slice(0, 5));
}
