// Types in place (edit mode): a palette of the type icons under the type row, with a search. NOTES.md §21.
import { esc, norm } from "./text.js";

/** The type icons, one entry each, by name: [{name, file, keys}] from cards.json icons ({spelling: {file, name, kind}});
 *  keys: its other spellings (aliases), normalized. The token picker's vocabulary() of kind "type". */
export function typeVocab(icons) {
  const by = new Map();
  for (const [key, ic] of Object.entries(icons || {})) {
    if (ic?.kind !== "type" || !ic.name) continue;
    if (!by.has(ic.file)) by.set(ic.file, { name: ic.name, file: ic.file, keys: [] });
    if (key !== norm(ic.name)) by.get(ic.file).keys.push(key);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}
/** The entries matching q, best first: the name or an alias exactly, a name prefix, an alias prefix, then (2+ letters)
 *  inside a name, inside an alias; ties by name. All of them for an empty q. */
export function findTypes(vocab, q) {
  const k = norm(q);
  if (!k) return [...vocab];
  const out = [];
  for (const e of vocab) {
    const n = norm(e.name), long = k.length > 1;
    const tier = n === k || e.keys.includes(k) ? 0 : n.startsWith(k) ? 1 : e.keys.some(x => x.startsWith(k)) ? 2
      : long && n.includes(k) ? 3 : long && e.keys.some(x => x.includes(k)) ? 4 : -1;
    if (tier >= 0) out.push([tier, e]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map(([, e]) => e);
}
let search = findTypes;
/** The palette's search: fn(vocab, q) -> entries best first; none given: findTypes. For the token picker's, once on main. */
export const useSearch = fn => { search = fn || findTypes; };
/** The token picker's ranking as the palette's search (its typo slips and most-used order too): suggest = tokens.js
 *  suggest, all() = its vocabulary (app.js S.vocab). Its plain type rows, mapped back to the palette's entries by name.
 *  Once tokens.js is on main, in app.js: palette.useSearch(palette.pickerSearch(tokens.suggest, () => S.vocab || [])). */
export const pickerSearch = (suggest, all) => (vocab, q) => {
  const by = new Map(vocab.map(e => [e.name, e]));
  return suggest({ type: "icon", base: q, variant: null }, all()).filter(r => r.kind === "type" && !r.variant)
    .map(r => by.get(r.token.slice(1, -1))).filter(Boolean);
};
/** The palette's chips in order: no query, the card's types first (as the palette opened), then the rest by name; a
 *  query, its matches. first: the types to put first. */
export function paletteOrder(vocab, first, q) {
  if (norm(q)) return search(vocab, q);
  const lead = new Set(first.map(norm));
  return [...vocab.filter(e => lead.has(norm(e.name))), ...vocab.filter(e => !lead.has(norm(e.name)))];
}
/** on with name added or taken out, sorted (as the All fields toggles list them, so the order is no edit). */
export const toggleType = (on, name) => (on.includes(name) ? on.filter(t => t !== name) : [...on, name]).sort();
const label = name => name.replace(/_/g, " ");
/** What the status line says: "2 types: fire, water", "No types". */
export const typesWords = on => (on.length ? `${on.length} type${on.length === 1 ? "" : "s"}: ${on.map(label).join(", ")}` : "No types");
/** The chips for entries; on: the chosen names. */
export const chipsHtml = (list, on) => list.map(e => `<button type="button" class="chip pal-type${on.includes(e.name) ? " on" : ""}" data-type="${esc(e.name)}" aria-pressed="${on.includes(e.name)}"><img src="${esc(e.file)}" alt="">${esc(label(e.name))}</button>`).join("");
/** The palette for the chosen names on. */
export const paletteHtml = (vocab, on, q = "") => {
  const list = paletteOrder(vocab, on, q);
  return `<div class="type-palette" role="group" aria-label="Types">
    <div class="pal-bar"><input type="search" class="pal-search" placeholder="Find a type" aria-label="Find a type: Enter toggles the first match, Enter on an empty box saves, Esc cancels" autocomplete="off" value="${esc(q)}">
      <span class="pal-status muted" aria-live="polite">${esc(typesWords(on))}</span></div>
    <div class="pal-chips">${list.length ? chipsHtml(list, on) : `<span class="muted">No type matches “${esc(q)}”</span>`}</div>
    <div class="actions"><button type="button" class="primary" data-pal="save">Save</button><button type="button" class="ghost" data-pal="cancel">Cancel</button>
      <span class="muted pal-note">On the card image</span></div></div>`;
};
/** The type row's icons for the chosen names (the card page's look; no links while it is edited). */
export const rowHtml = (on, vocab) => on.map(t => { const e = vocab.find(x => x.name === t); return e ? `<img src="${esc(e.file)}" alt="${esc(t)}">` : `<span class="fact">${esc(label(t))}</span>`; }).join("");

/** In the browser: the palette after element `after`. on: the chosen names to start from. onChange(list) on each toggle,
 *  onSave(list, kbd) / onCancel(kbd) once (kbd: from the keyboard, so the focus goes back to the row). -> {el, close(save)} */
export function mountPalette(after, { vocab, on, first = on, onChange = () => {}, onSave, onCancel }) {
  after.insertAdjacentHTML("afterend", paletteHtml(vocab, on));
  const el = after.nextElementSibling, q = el.querySelector(".pal-search"), chips = el.querySelector(".pal-chips"), status = el.querySelector(".pal-status");
  let sel = [...on].sort(), done = false, pressing = false, touch = false;
  const draw = () => { const list = paletteOrder(vocab, first, q.value); chips.innerHTML = list.length ? chipsHtml(list, sel) : `<span class="muted">No type matches “${esc(q.value)}”</span>`; };
  const flip = name => {
    sel = toggleType(sel, name);
    for (const b of chips.querySelectorAll("[data-type]")) if (b.dataset.type === name) { const v = sel.includes(name); b.classList.toggle("on", v); b.setAttribute("aria-pressed", String(v)); }
    status.textContent = typesWords(sel); onChange(sel);
  };
  const outside = e => { if (!el.isConnected) stop(); else if (!el.contains(e.target)) finish(true, false); };   // gone with the dialog: nothing saved
  const up = () => setTimeout(() => { pressing = false; });
  const stop = () => { done = true; document.removeEventListener("pointerdown", outside, true); document.removeEventListener("pointerup", up, true); };
  function finish(save, kbd) {
    if (done) return;
    stop(); el.remove();
    if (save) onSave(sel, kbd); else onCancel(kbd);
  }
  el.addEventListener("pointerdown", e => { pressing = true; touch = e.pointerType === "touch"; });
  el.addEventListener("click", e => {
    const chip = e.target.closest("[data-type]"), act = e.target.closest("[data-pal]")?.dataset.pal;
    if (chip) { flip(chip.dataset.type); if (e.detail && !touch && !el.contains(document.activeElement)) q.focus({ preventScroll: true }); }   // Safari leaves the focus nowhere
    else if (act) finish(act === "save", e.detail === 0);       // detail 0: Enter or Space on the button
  });
  el.addEventListener("input", e => { if (e.target === q) draw(); });
  el.addEventListener("keydown", e => {
    e.stopPropagation();                                          // the palette's keys are its own (no card shortcuts, Esc doesn't close the dialog)
    const items = [...chips.querySelectorAll("[data-type]")], at = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); finish(false, true); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true, true); }
    else if (e.key === "Enter" && e.target === q) {                 // a name typed: toggle the first match; an empty box: save
      e.preventDefault();
      if (!q.value.trim()) finish(true, true); else if (items[0]) { flip(items[0].dataset.type); q.value = ""; draw(); }
    }
    else if (e.target === q && e.key === "ArrowDown") { e.preventDefault(); items[0]?.focus(); }
    else if (at >= 0 && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) {
      e.preventDefault();
      const to = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : at + (/Right|Down/.test(e.key) ? 1 : -1);
      if (to < 0) q.focus(); else items[Math.min(to, items.length - 1)].focus();
    }
  });
  el.addEventListener("focusout", e => {                          // Tab out saves; a press inside (Safari doesn't focus buttons) doesn't
    if (pressing || !document.hasFocus() || !e.relatedTarget || el.contains(e.relatedTarget)) return;
    finish(true, true);
  });
  document.addEventListener("pointerdown", outside, true);        // a click or tap away saves
  document.addEventListener("pointerup", up, true);
  q.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest" });
  return { el, close: save => finish(save, false), get value() { return sel; } };
}
