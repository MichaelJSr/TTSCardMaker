// When the tooltip shows and goes (app.js fills it): it goes when the pointer leaves its element, or that element
// leaves the page or loses its data-tip (an inline editor opened). NOTES.md §21. Touch: a tap shows it, the next tap
// elsewhere or a scroll hides it; on a link only a long press does (the tap opens it).

/** What shows a tooltip: data-tip text, chart values (data-v, data-l), a card link's preview. */
export const TIP_SEL = "[data-tip], [data-v], a.card-ref, .chart [data-card]";
const REF = "a.card-ref, .chart [data-card]";
/** What a tap follows (app.js's click handler): a tooltip there shows on a long press only. */
const NAV = "a[href], [data-open], .chart [data-card]";
export const LONG_PRESS = 450;                           // ms

/** The element a pointer over `target` shows a tooltip for, or null: a chart value, else a card link, else the nearest
 *  data-tip (app.js's order). */
export function tipSource(target) {
  const ref = target?.closest?.(REF) || null, t = target?.closest?.("[data-tip], [data-v]") || null;
  return t && t.dataset.v !== undefined ? t : ref || t;
}
/** The tooltip shown for `src` has to go: `src` left the page or has no tooltip any more. */
export const tipGone = src => !src || !src.isConnected || !src.matches(TIP_SEL);
/** The tooltip shown for `src` stays while the pointer moves to `to` (pointerout's relatedTarget): `to` is inside it. */
export const tipStays = (src, to) => !tipGone(src) && !!to && src.contains(to);

/** The rules over pointer events. fill(src): put src's content in the tooltip, false when it has none (an unknown card);
 *  show(), hide(): the tooltip element. over/out/move take pointerover's target, pointerout's relatedTarget and
 *  nothing; move() is true when the tooltip is up (app.js then places it). hide(): from code (an editor opened).
 *  Touch (pointerType "touch"): over/out are ignored; tap(target, long) on pointerup (or a long press) shows the tip,
 *  true when it did; down(target) on the next touch elsewhere and scrolled() hide it. */
export function tipController({ fill, show, hide }) {
  let src = null, touch = false;
  const off = () => { src = null; touch = false; hide(); };
  return {
    over(target, kind) { if (kind === "touch") return; const s = tipSource(target); if (!s || fill(s) === false) return; src = s; touch = false; show(); },
    out(to, kind) { if (kind !== "touch" && src && !touch && !tipStays(src, to)) off(); },
    move() { if (src && tipGone(src)) off(); return !!src; },
    tap(target, long = false) {
      const s = tipSource(target);
      if (s && s === src && touch) return true;
      if (src) off();
      if (!s || (!long && s.closest(NAV)) || fill(s) === false) return false;
      src = s; touch = true; show(); return true;
    },
    down(target) { if (src && touch && (tipGone(src) || !src.contains(target))) off(); },
    scrolled() { if (src && touch) off(); },
    hide: off,
    get source() { return src; },
    get touch() { return touch; },
  };
}

/** Wire a tipController to the document's pointer events; place(x, y) puts the tooltip near that point. */
export function wireTips(doc, tips, place) {
  let press = null, swallow = false;                     // a touch held on a link: its long-press timer
  const cancel = () => { if (press) clearTimeout(press.timer); press = null; };
  doc.addEventListener("pointerover", e => tips.over(e.target, e.pointerType));
  doc.addEventListener("pointerout", e => tips.out(e.relatedTarget, e.pointerType));
  doc.addEventListener("pointermove", e => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancel();
    if (e.pointerType !== "touch" && tips.move()) place(e.clientX, e.clientY);
  });
  doc.addEventListener("pointerdown", e => {
    cancel(); swallow = false;
    if (e.pointerType !== "touch") return;
    tips.down(e.target);
    const s = tipSource(e.target);
    if (s && s.closest(NAV)) {
      const { clientX: x, clientY: y, target } = e;
      press = { x, y, timer: setTimeout(() => { press = null; if (tips.tap(target, true)) { swallow = true; place(x, y); } }, LONG_PRESS) };
    }
  });
  doc.addEventListener("pointerup", e => {
    const held = !press && swallow;
    cancel();
    if (e.pointerType === "touch" && !held && tips.tap(e.target)) place(e.clientX, e.clientY);
  });
  doc.addEventListener("pointercancel", cancel);
  doc.addEventListener("click", e => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);   // the long press showed the tip: no navigation
  doc.addEventListener("contextmenu", e => { if (swallow || press) e.preventDefault(); });                                    // Android's link menu
  doc.defaultView?.addEventListener("scroll", () => { cancel(); tips.scrolled(); }, { passive: true, capture: true });
}
