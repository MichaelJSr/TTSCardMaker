// Stars in place (edit mode): a slider of stars instead of the stars chip. NOTES.md §21.
export const MAX = 10;                             // the card page draws at most 10 (app.js stars()); the slider: the most any card has (owner 10-31)

/** The value after key on a slider at `now` (0..max), or null for a key it doesn't take. */
export function stepValue(now, key, max = MAX) {
  const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[key];
  return step !== undefined ? Math.max(0, Math.min(max, now + step)) : key === "Home" ? 0 : key === "End" ? max : null;
}
/** The slider's words for a count: "3 stars", "1 star", "No stars". */
export const starWords = n => (n ? `${n} star${n === 1 ? "" : "s"}` : "No stars");
/** The control for a card with n stars, 0..max (a fact, so it sits in the chips where the stars chip was). */
export const starsHtml = (n, max = MAX) => `<span class="fact star-pick" role="slider" tabindex="0" data-inline="stars" aria-label="Stars, arrows to change, Enter to save"
  aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${n}" aria-valuetext="${starWords(n)}" data-tip="Click a star to set the count · on the card image">${
  Array.from({ length: max }, (_, i) => `<i class="${i < n ? "on" : ""}" aria-hidden="true">★</i>`).join("")}</span>`;
/** Show n on the slider (before it is saved). */
export function paintStars(el, n) {
  [...el.children].forEach((s, i) => s.classList.toggle("on", i < n));
  el.setAttribute("aria-valuenow", String(n)); el.setAttribute("aria-valuetext", starWords(n));
}
