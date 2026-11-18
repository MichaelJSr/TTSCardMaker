// Image versions compare (app.js compareHtml, nowPair; owner 11-17 ~20:35, ~23:50 (1)): GitHub's image-diff modes
// wherever two pictures sit side by side: a picked version and a pinned base, or an old version and today's card.
// 2-up (side by side, the older left), Swipe (one box, a divider shows the older left of it and the newer right), Onion
// skin (the picked over the base, its opacity 0-100) and Difference (the picked over the base, CSS mix-blend-mode:
// difference on black: no canvas reads, so pictures from another origin need no CORS). Both pictures fit the same box
// (contain, centred) in every mode, so sizes and crops line up and a switch never moves the page. The last mode is kept
// (localStorage MODE_KEY). A side with no picture: 2-up only (ver-lack; the mode kept). DOM-free: every function
// returns HTML or data.
import { esc } from "./text.js";

export const MODES = [["2up", "2-up"], ["swipe", "Swipe"], ["onion", "Onion skin"], ["diff", "Difference"]];
export const MODE_KEY = "ver-mode";
const HINT = { "2up": "Side by side, the older left.", swipe: "Drag the divider (or its arrow keys).",
  diff: "Unchanged pixels are black." };
export const LACK = "One picture is missing: 2-up only.";      // the stacked modes over a side with no picture
/** A stored mode, else 2-up */
export const modeOf = m => (MODES.some(([k]) => k === m) ? m : "2up");
/** 0-100, whole */
export const clampPct = x => Math.max(0, Math.min(100, Math.round(Number(x) || 0)));
/** The divider's place under a pointer at clientX over a box (its left and width) */
export const pctAt = (clientX, left, width) => (width > 0 ? clampPct(((clientX - left) / width) * 100) : 50);
/** A slider key's new value (the arrows 5, Shift 1, Page 25, Home/End the ends); null: not a slider key */
export function slideKey(value, key, shift = false) {
  const step = shift ? 1 : 5;
  const to = { ArrowLeft: value - step, ArrowDown: value - step, ArrowRight: value + step, ArrowUp: value + step,
    PageDown: value - 25, PageUp: value + 25, Home: 0, End: 100 }[key];
  return to === undefined ? null : clampPct(to);
}
/** The box both pictures fit: width / height of the tallest of their known sizes ([w, h] or null), else fallback */
export function boxRatio(sizes, fallback = [2, 3]) {
  const known = sizes.filter(s => s && s[0] > 0 && s[1] > 0);
  const [w, h] = known.length ? known.reduce((a, b) => (b[1] / b[0] > a[1] / a[0] ? b : a)) : fallback;
  return `${w} / ${h}`;
}
/** Each picture's own size as GitHub shows it, only when they differ ([w, h] each); else null */
export const sizesText = (a, b) => (a && b && (a[0] !== b[0] || a[1] !== b[1]) ? [a, b].map(([w, h]) => `${w} × ${h} px`) : null);
/** The slider's spoken value */
const swipeText = (x, a, b) => `${x}%: the ${a} version left, the ${b} version right`;

/**
 * The compare block above the changes list. a: the older version, b: the newer (2-up's and Swipe's order); each
 * {pic: its <img> HTML (in a link or not), cap: its caption HTML, when: its date text, base: the pinned one (none
 * pinned: b, today's card, is under the picked a), own: its picture's own [w, h] when known, none: no picture}.
 * ratio: boxRatio's; at: {swipe, onion} the controls' values (0-100).
 */
export function compareView(mode, a, b, ratio, at = {}) {
  mode = modeOf(mode);
  const x = clampPct(at.swipe ?? 50), op = clampPct(at.onion ?? 50), pick = a.base ? b : a, base = a.base ? a : b;
  const sizes = sizesText(a.own, b.own), lack = !!(a.none || b.none);
  const switcher = MODES.map(([k, label]) => `<button type="button" class="ver-mode" data-action="ver-mode" data-mode="${k}" aria-pressed="${k === mode}">${label}</button>`).join("");
  const hint = k => `<span class="ver-hint" data-for="${k}"${k === mode ? "" : " hidden"}>${HINT[k]}</span>`;
  const pane = (v, side) => `<div class="ver-pic ver-${side} ${v === base ? "ver-is-base" : "ver-is-pick"}">${v.pic}</div>`;
  const cap = (v, side, n) => `<div class="ver-cap ver-${side}">${v.cap}<span class="ver-size">${sizes ? sizes[n] : ""}</span></div>`;
  return `<div class="ver-cmp${lack ? " ver-lack" : ""}" data-mode="${mode}" style="--ar:${ratio};--x:${x}%;--op:${op / 100}">
    <div class="ver-modes" role="group" aria-label="Compare view">${switcher}</div>
    <div class="ver-ctl">${hint("2up")}${hint("swipe")}<label class="ver-hint" data-for="onion"${mode === "onion" ? "" : " hidden"}>Opacity <input type="range" class="ver-onion" min="0" max="100" step="1" value="${op}" aria-label="Opacity of the picked ${esc(pick.when)} version over the ${base.base ? "base " : ""}${esc(base.when)} version"> <output>${op}%</output></label>${hint("diff")}<span class="ver-lack-note">${LACK}</span></div>
    <div class="ver-stage">
      <div class="ver-pics">${pane(a, "a")}${pane(b, "b")}<div class="ver-swipe" role="slider" tabindex="${mode === "swipe" ? 0 : -1}" data-a="${esc(a.when)}" data-b="${esc(b.when)}" aria-label="Swipe between the ${esc(a.when)} and ${esc(b.when)} versions" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${x}" aria-valuetext="${esc(swipeText(x, a.when, b.when))}"${mode === "swipe" ? "" : " hidden"}><span class="ver-grip" aria-hidden="true"></span></div></div>
      <div class="ver-caps">${cap(a, "a", 0)}${cap(b, "b", 1)}</div>
    </div>
  </div>`;
}
/** The slider's aria values at x (app.js sets them as it moves) */
export const swipeAria = (x, aWhen, bWhen) => ({ "aria-valuenow": String(x), "aria-valuetext": swipeText(x, aWhen, bWhen) });
