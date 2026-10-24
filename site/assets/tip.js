// When the tooltip shows and goes (app.js fills it): it goes when the pointer leaves its element, or that element
// leaves the page or loses its data-tip (an inline editor opened). NOTES.md §19.

/** What shows a tooltip: data-tip text, chart values (data-v, data-l), a card link's preview. */
export const TIP_SEL = "[data-tip], [data-v], a.card-ref, .chart [data-card]";
const REF = "a.card-ref, .chart [data-card]";

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
 *  nothing; move() is true when the tooltip is up (app.js then places it). hide(): from code (an editor opened). */
export function tipController({ fill, show, hide }) {
  let src = null;
  const off = () => { src = null; hide(); };
  return {
    over(target) { const s = tipSource(target); if (!s || fill(s) === false) return; src = s; show(); },
    out(to) { if (src && !tipStays(src, to)) off(); },
    move() { if (src && tipGone(src)) off(); return !!src; },
    hide: off,
    get source() { return src; },
  };
}
