// When the tooltip shows and goes (app.js fills it): it goes when the pointer leaves its element, or that element
// leaves the page or loses its data-tip (an inline editor opened). NOTES.md §21. Touch: a tap shows it, the next tap
// elsewhere or a scroll hides it; on a card link only a long press does (the tap opens it), other links keep theirs.
// A tapped note inside a <summary> (details.js counts) shows without toggling the section. Keyboard: a :focus-visible
// focus shows it under the element until focus leaves; the first Esc hides it (WCAG 1.4.13), the next closes the dialog.

/** What shows a tooltip: data-tip text, chart values (data-v, data-l), a card link's preview. */
export const TIP_SEL = "[data-tip], [data-v], a.card-ref, .chart [data-card]";
const REF = "a.card-ref, .chart [data-card]";
/** What a tap follows (app.js's click handler): no tooltip on a tap, a card link's on a long press. */
const NAV = "a[href], [data-open], .chart [data-card]";
export const LONG_PRESS = 450;                           // ms

/** The element a pointer over `target` shows a tooltip for, or null: a chart value, else a card link, else the nearest
 *  data-tip (app.js's order). */
export function tipSource(target) {
  const ref = target?.closest?.(REF) || null, t = target?.closest?.("[data-tip], [data-v]") || null;
  return t && t.dataset.v !== undefined ? t : ref || t;
}
/** What a keyboard focus on `el` shows a tooltip for: its own (tipSource), else, on a link, button, summary or tile, one
 *  inside it (a tile: only its flag; a type icon on every tile would be noise). */
export function focusSource(el) {
  const own = tipSource(el);
  if (own || !el?.matches?.("a[href], button, summary, .tile")) return own;
  return el.querySelector(el.matches(".tile") ? ".flag[data-tip]" : TIP_SEL);
}
/** The tooltip shown for `src` has to go: `src` left the page or has no tooltip any more. */
export const tipGone = src => !src || !src.isConnected || !src.matches(TIP_SEL);
/** The tooltip shown for `src` stays while the pointer moves to `to` (pointerout's relatedTarget): `to` is inside it. */
export const tipStays = (src, to) => !tipGone(src) && !!to && src.contains(to);

/** The rules over pointer events. fill(src): put src's content in the tooltip, false when it has none (an unknown card);
 *  show(), hide(): the tooltip element; id: its id. over/out/move take pointerover's target, pointerout's relatedTarget
 *  and nothing; move() is true when a pointer's tooltip is up (app.js then places it). hide(): from code (an editor opened).
 *  Touch (pointerType "touch"): over/out are ignored; tap(target, long) on pointerup (or a long press) shows the tip,
 *  true when it did; down(target) on the next touch elsewhere and scrolled() hide it. Keyboard: focus(el) shows el's
 *  (focusSource) with aria-describedby on el while up, true when it did; blur() hides it; keyed(): el while up. */
export function tipController({ fill, show, hide, id = "" }) {
  let src = null, touch = false, kb = null;             // kb: the focused element a keyboard tooltip is for
  const describe = on => {                               // kb's aria-describedby, its own ids kept
    if (!kb || !id) return;
    const ids = (kb.getAttribute("aria-describedby") || "").split(" ").filter(x => x && x !== id);
    if (on) ids.push(id);
    if (ids.length) kb.setAttribute("aria-describedby", ids.join(" ")); else kb.removeAttribute("aria-describedby");
  };
  const off = () => { describe(false); src = null; touch = false; kb = null; hide(); };
  return {
    over(target, kind) { if (kind === "touch") return; const s = tipSource(target); if (!s || (kb && s === src) || fill(s) === false) return; describe(false); src = s; touch = false; kb = null; show(); },
    out(to, kind) { if (kind !== "touch" && src && !touch && !kb && !tipStays(src, to)) off(); },
    move() { if (src && tipGone(src)) off(); return !!src && !kb; },
    focus(el) { if (src) off(); const s = focusSource(el); if (!s || fill(s) === false) return false; src = s; kb = el; describe(true); show(); return true; },
    blur() { if (kb) off(); },
    keyed: () => kb,
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
  };
}

/** Wire a tipController to the document's pointer, focus and key events; place(x, y) puts the tooltip near that point,
 *  place(0, 0, box) under (or over) that element's box. hold: a touch long press of its own, no tooltip ({match(target):
 *  the element or null, run(el)}: app.js's exclusions). */
export function wireTips(doc, tips, place, hold) {
  let press = null, swallow = false;                     // a touch held on a card link: its long-press timer
  let touched = false;                                   // the last press was a touch
  let pointed = false;                                   // the last input was a press, not a key: no focus tooltip
  const cancel = () => { if (press) clearTimeout(press.timer); press = null; };
  const under = () => { const el = tips.keyed(); if (el) place(0, 0, el.getBoundingClientRect()); };
  const sized = typeof ResizeObserver === "function" ? new ResizeObserver(under) : null;   // a strip's tile resizes as pictures load
  doc.addEventListener("focusin", e => { if (!pointed && e.target.matches?.(":focus-visible") && tips.focus(e.target)) { under(); sized?.observe(e.target); } });
  doc.addEventListener("focusout", () => { sized?.disconnect(); tips.blur(); });
  doc.addEventListener("keydown", e => {
    pointed = false; tips.move();                        // its element gone (a re-render): hide it
    if (e.key !== "Escape") return;
    const kb = tips.keyed(); tips.hide();                // a pointer's goes too, the Esc then does its job
    if (kb) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  doc.addEventListener("pointerover", e => tips.over(e.target, e.pointerType));
  doc.addEventListener("pointerout", e => tips.out(e.relatedTarget, e.pointerType));
  doc.addEventListener("pointermove", e => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancel();
    if (e.pointerType !== "touch" && tips.move()) place(e.clientX, e.clientY);
  });
  doc.addEventListener("pointerdown", e => {
    cancel(); swallow = false; touched = e.pointerType === "touch"; pointed = true;
    if (!touched) return;
    tips.down(e.target);
    const own = hold.match(e.target);
    if (own) { const { clientX: x, clientY: y } = e; press = { x, y, timer: setTimeout(() => { press = null; swallow = true; tips.hide(); hold.run(own); }, LONG_PRESS) }; return; }
    const s = tipSource(e.target);
    if (s && s.matches(REF)) {                           // other links: the browser's long press (link menu)
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
  doc.addEventListener("click", e => { if (touched && e.target.closest?.("summary .qn")) e.preventDefault(); }, true);       // a tapped note in a summary: no toggle
  doc.addEventListener("contextmenu", e => { if (swallow || press) e.preventDefault(); });                                    // Android's link menu
  doc.defaultView?.addEventListener("scroll", () => { cancel(); tips.scrolled(); under(); }, { passive: true, capture: true });   // focus scrolls after focusin
}
