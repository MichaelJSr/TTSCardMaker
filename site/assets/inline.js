// Inline editing, edit mode only (signed in): the card dialog's values edit in place, tiles in the cards grid select
// and drag onto a Series, Subseries or Author value, and the filter bar's selects make new ones. A DOM upgrade after
// app.js has rendered (attributes and listeners, no template change), so view mode is untouched. Staging goes through
// the editor's single-field ops (edit.js stageField/stageAuthor), the same batch the form fills. Helpers above
// `install` are pure; node checks under /tmp exercise them. Stars (stars.js) and types (palette.js) edit in place too;
// what is typed is kept as a draft until it is saved (drafts.js), and offered back when the card opens again.
import { esc } from "./text.js";
import { starsHtml, paintStars, stepValue } from "./stars.js";
import { typeVocab, mountPalette, rowHtml } from "./palette.js";
import { rawOf, restorable, offerHtml, later, movedSince } from "./drafts.js";
import { renameButton } from "./edit.js";
import { straighten } from "./parts.js";
import { ART } from "./art.js";

const STATS = ["hp", "def", "atk", "spd"];
const SLIDERS = [...STATS, "stars"];                // a row of cells: click one, or arrows and Enter
const ART_KEYS = ART.map(([k]) => k);               // the artwork sources: one line each, under the note
const TEXT = ["name", "ability", "note", ...ART_KEYS, "series", "subseries", "author"];   // the fields with a text control
const LABEL = { hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", series: "Series", subseries: "Subseries", author: "Author", note: "Note", stars: "Stars", types: "Types",
  ...Object.fromEntries(ART) };
const IMAGE = "on the card image";                 // the form's "On the card image" marker (PSD fields); the rest is database only

/** A click on stat cell `cell` (1-based) of a row showing `current`: that value, or one less for the top lit cell (so 0 is reachable). */
export const cellValue = (current, cell) => (cell === current ? cell - 1 : cell);
/** Rows for a textarea holding `text`: one more than its lines, 2 to 14. */
export const fit = text => Math.min(14, Math.max(2, String(text ?? "").split("\n").length + 1));
/** The ids a drag carries: the selection when the dragged tile is in it, else that tile alone. */
export const dragIds = (id, selected) => (selected.has(id) ? [...selected] : [id]);
/** Shift-click: the ids of `order` from the anchor to `id`, both included; just `id` without an anchor in the list. */
export const rangeIds = (order, anchor, id) => { const a = order.indexOf(anchor), b = order.indexOf(id); return a < 0 || b < 0 ? [id] : order.slice(Math.min(a, b), Math.max(a, b) + 1); };
/** The control for a field: name and chips an input, the ability a textarea. fresh: the filter bar's input for a new
 *  series, subseries or author. The ability and note take the token picker (tokens.js, data-tokens); series, subseries
 *  and author its list of known names (data-suggest). While the list is open its keys are its own, so the first Esc
 *  only closes it. */
export function control(f, v, fresh = false) {
  const label = f === "name" ? "Name, Enter to save, Esc to cancel" : f === "ability" ? "Ability text, Ctrl+Enter to save, Esc to cancel"
    : `${fresh ? `New ${LABEL[f].toLowerCase()}` : LABEL[f]}, Enter to save, Esc to cancel`;
  if (f === "name") return `<input class="inline-name" aria-label="${label}" value="${esc(v)}">`;
  if (f === "ability") return `<textarea class="inline-ability" rows="${fit(v)}" spellcheck="true" aria-label="${label}" data-tokens>${esc(v)}</textarea>`;
  const named = f === "series" || f === "subseries" || f === "author";
  return `<input class="inline-fact${f === "note" || ART_KEYS.includes(f) ? " inline-note" : ""}"${f === "note" ? ' data-tokens autocomplete="off"' : ""}${named ? ` data-suggest="${f}" autocomplete="off"` : ""} aria-label="${label}" placeholder="${fresh ? "new " : ""}${LABEL[f].toLowerCase()}" value="${esc(v)}" style="--w:${v.length + 2}ch">`;
}
/** The bucket options a filter select gets: those it lacks, as "X (no cards yet)", selected when picked. have: its
 *  option values; list: [name]. */
export const bucketOptions = (have, list, picked) => list.filter(v => !have.has(v))
  .map(v => `<option value="${esc(v)}"${v === picked ? " selected" : ""}>${esc(v)} (no cards yet)</option>`).join("");
/** The select's last option: "New series…" (data-new-bucket: its value never matters). */
export const newOption = key => `<option value="" data-new-bucket>New ${LABEL[key].toLowerCase()}…</option>`;
const ghost = f => `<button type="button" class="fact ghost-fact" data-inline="${f}" data-empty aria-label="Add ${f}">+ ${f}</button>`;
const chipHtml = (v, fresh) => `<span class="chip" data-value="${esc(v)}"${fresh ? " data-new" : ""}>${esc(v)}</span>`;
/** A drop list's chips: the new (pending) values first, dashed, then the rest. */
export const dropChips = (list, fresh) => [...fresh.map(v => chipHtml(v, true)), ...list.filter(v => !fresh.includes(v)).map(v => chipHtml(v, false))].join("");

let A = null;                                      // {editor, modal, selected, goCard, rerender, toast}, from install
let card = null;                                   // the card the dialog shows (mountCard)
let cur = null;                                    // the open editor: {c, f, el, host, html, cls, tip, ctl, v, save, snap}
let pal = null;                                    // the open type palette: {c, row, html, tip, temp, save, ctl, snap}
let closing = false;                               // this press is on the dialog's close button: a save doesn't redraw the card
let stay = false;                                  // this press is on the backdrop and ends an edit: its click doesn't close the card
let offered = null;                                // the card dialog's draft offer: {c, fields}
let prov = null;                                   // a stat row changed by keyboard, not yet saved: {row, k, v0}
let pointer = false;                               // the last input was a pointer (focus moved by a click, not Tab)
let naming = null;                                 // the filter bar's open "New …" input: {sel, key, input}
let listParams = new URLSearchParams();            // the params of the list mountGrid last upgraded (not the hash: a card route has none)
let arrowAt = -1e9;                                // when an arrow key last went to a filter select
let dragged = null;                                // the ids being dragged (the drop's source of truth)

// ---- the card dialog
/** Mark the editable spots of the open card dialog (edit mode only; call after openCard). */
export function mountCard(modal, c, api = A) {
  const detail = modal.querySelector(".detail"); if (!detail) return;
  card = c; cur = null; prov = null; pal = null; offered = null; closing = false;
  const facts = detail.querySelector(".facts");
  const mark = (el, f, tip) => { if (!el) return; el.dataset.inline = f; el.tabIndex = 0; el.dataset.tip = tip; };
  mark(detail.querySelector("h2"), "name", `Double-click to rename · ${IMAGE}`);
  const abilityEl = detail.querySelector(":scope > div:nth-child(2) > .ability") || [...detail.querySelectorAll(":scope > div:nth-child(2) > p.muted")].find(p => p.textContent === "No ability text.");
  mark(abilityEl, "ability", `Click to edit · ${IMAGE}`);
  const rows = c.creatures?.length > 1 ? [] : STATS.filter(k => c[k] != null);
  detail.querySelectorAll(".statbars .segs").forEach((seg, i) => {
    const k = rows[i], v = k && c[k];
    if (!k || v > 10) { seg.dataset.tip = "Use All fields"; return; }
    seg.setAttribute("role", "slider"); seg.tabIndex = 0; seg.dataset.inline = k;
    seg.setAttribute("aria-valuemin", "0"); seg.setAttribute("aria-valuemax", "10"); seg.setAttribute("aria-valuenow", String(v));
    seg.setAttribute("aria-label", `${LABEL[k]} ${v}, arrows to change, Enter to save`); seg.dataset.tip = `Click a cell to set ${LABEL[k]} · ${IMAGE}`;
  });
  const chips = [...facts.querySelectorAll("a.fact")], hrefOf = a => a.getAttribute("href") || "";
  const chip = { series: chips.find(a => hrefOf(a).startsWith("#/cards?series=") && !hrefOf(a).includes("subseries=")),
    subseries: chips.find(a => hrefOf(a).includes("subseries=")), author: chips.find(a => hrefOf(a).startsWith("#/cards?author=")) };
  for (const f of ["series", "subseries", "author"]) {
    if (f === "author" && c.dup && !c.variantOf) { if (chip.author) chip.author.dataset.tip = "Same as the original"; continue; }   // a variant: its own
    if (chip[f]) { chip[f].dataset.inline = f; chip[f].dataset.tip = `Click to edit the ${LABEL[f].toLowerCase()}`; }
    else facts.insertAdjacentHTML("beforeend", `<button type="button" class="fact ghost-fact" data-inline="${f}" data-empty aria-label="Add a ${LABEL[f].toLowerCase()}">+ ${LABEL[f].toLowerCase()}</button>`);
  }
  const subChip = chips.find(a => hrefOf(a).startsWith("#/cards?sub="));     // Rename everywhere beside each value
  for (const [f, el] of [["subtype", subChip], ["series", chip.series], ["subseries", chip.subseries], ["author", chip.author]])
    if (el && c[f]) el.insertAdjacentHTML("afterend", renameButton(f, c[f], "fact ghost-fact rename-tag"));
  const note = detail.querySelector(":scope > div:nth-child(2) > .note");
  if (note) mark(note, "note", "Click to edit the note");
  else facts.insertAdjacentHTML("beforeend", `<button type="button" class="fact ghost-fact" data-inline="note" data-empty aria-label="Add a note">+ note</button>`);
  for (const [k, label] of ART) {                  // every entry its own, duplicates and variant pictures too
    const el = detail.querySelector(`:scope > div:nth-child(2) > .art-src[data-art="${k}"]`);
    if (el) mark(el, k, `Click to edit the ${label.toLowerCase()}`);
    else facts.insertAdjacentHTML("beforeend", `<button type="button" class="fact ghost-fact" data-inline="${k}" data-empty aria-label="Add the ${label.toLowerCase()}">+ ${label.toLowerCase()}</button>`);
  }
  const starChip = chips.find(a => hrefOf(a).startsWith("#/cards?stars="));      // stars: a slider in its place
  if (c.stars > 10) { if (starChip) starChip.dataset.tip = "Use All fields"; }
  else if (starChip) starChip.outerHTML = starsHtml(c.stars);
  else facts.insertAdjacentHTML("beforeend", ghost("stars"));
  const typeRow = detail.querySelector(":scope > div:nth-child(2) > .ctypes");     // types: the row opens the palette
  if (typeRow) {
    mark(typeRow, "types", `Click to change the types · ${IMAGE}`);
    typeRow.setAttribute("role", "button"); typeRow.setAttribute("aria-label", `Types: ${(c.types || []).map(t => t.replace(/_/g, " ")).join(", ") || "none"}. Change the types`);
  } else facts.insertAdjacentHTML("beforeend", ghost("types"));
  offer(c, detail);
}
// ---- drafts: what an editor holds before it is saved, kept in edit.js's draft store (drafts.js)
const drafts = () => A.editor.drafts;
function offer(c, detail) {                        // "Restore your unsaved edit?" over the card, when it has a draft the card doesn't show
  const d = drafts()?.get(c.id); if (!d) return;
  const now = Object.fromEntries(Object.keys(d.fields).filter(f => !f.startsWith("ban")).map(f => [f, rawOf(c, f, A.editor.value(c, "dup_of"))]));
  const fields = restorable(d.fields, now);
  if (!Object.keys(fields).length) { drafts().drop(c.id); return; }   // the batch has it already
  offered = { c, fields };
  detail.querySelector(":scope > div:nth-child(2)")?.insertAdjacentHTML("afterbegin", offerHtml(fields, d.at, Date.now(), movedSince(d, now)));
}
const spot = f => A.modal.querySelector(`.detail [data-inline="${f}"]`);
function answer(restore) {
  const o = offered; offered = null;
  A.modal.querySelector(".detail .draft-offer")?.remove();
  if (!o) return;
  if (!restore) { drafts().drop(o.c.id); A.toast("Unsaved edit discarded"); return; }
  const keys = Object.keys(o.fields), [f] = keys, el = keys.length === 1 && spot(f);   // one field: its own editor, else All fields
  if (el && TEXT.includes(f)) openText(el, f, o.fields[f]);
  else if (el && f === "types") openTypes(el, o.fields.types);
  else A.editor.open(o.c.id, { draft: o.fields });
}
const keep = (c, f, v) => later(() => {            // the editor's text as a draft, a moment after each key
  const t = (f === "types" ? pal?.ctl?.value : cur?.f === f && cur.c === c ? cur.ctl.value : null);
  if (t == null) return;
  if (f === "types" ? JSON.stringify(t) === JSON.stringify(v) : String(t).replace(/\r/g, "").trim() === String(v).replace(/\r/g, "").trim()) drafts()?.drop(c.id, [f]);
  else drafts()?.put(c.id, { [f]: f === "types" ? t : String(t).replace(/\r/g, "") }, false, { [f]: f === "types" ? v : String(v).replace(/\r/g, "") });
});
function open(el, f, text = null) {               // text: a restored draft
  if (cur && !commit(false)) { cur?.ctl.focus(); return; }                // a refused name stays open, to shorten it
  if (pal) pal.ctl.close(true);
  if (!el.isConnected || !card) return;
  A.hideTip?.();                                   // its "Click to edit" goes with the data-tip
  const c = card, v = f === "author" ? (c.author || "") : String(A.editor.value(c, f) ?? "");
  const swap = el.tagName === "A" || el.tagName === "BUTTON";     // a link would still navigate, a button can't hold an input
  let host = el;
  if (swap) { host = document.createElement("span"); host.className = el.className; host.dataset.inline = f; el.replaceWith(host); }
  cur = { c, f, el, host, html: el.innerHTML, cls: el.className, tip: el.dataset.tip, ctl: null, v, save: keep(c, f, v), snap: drafts()?.snap(c.id, [f]) };
  if (!swap) { delete el.dataset.tip; if (el.tagName === "P") el.className = "ability"; }   // "No ability text." becomes the text box
  host.innerHTML = control(f, text ?? v);
  cur.ctl = host.querySelector("input, textarea");
  const save = cur.save, words = f === "name" || f === "ability" || f === "note";
  cur.ctl.addEventListener("input", e => { if (words && !e.isComposing) straighten(e.target); save.run(); });   // straight apostrophes (owner 10-25)
  if (text != null) save.run();
  cur.ctl.focus(); if (f !== "ability" && text == null) cur.ctl.select();
}
function cancel(refocus) {                        // Esc, or nothing changed: what was typed goes, an older draft stays as it was
  if (!cur) return;
  const { c, f, el, host, html, cls, tip, save, snap, ctl } = cur; cur = null;
  save.cancel(); drafts()?.back(c.id, snap, [f]); A.hideTip?.(); A.closePicker?.();
  ctl?.blur();                                     // a native popover goes with it
  if (host !== el) host.replaceWith(el); else { el.innerHTML = html; el.className = cls; if (tip) el.dataset.tip = tip; }
  if (refocus) el.focus();
}
function commit(kbd) {                            // kbd: from the keyboard, so focus returns to the spot; false: refused
  if (!cur) return true;
  const was = cur, { c, f, ctl, v } = cur, next = ctl.value.replace(/\r/g, "");
  if (next.trim() === v.replace(/\r/g, "").trim()) { cancel(kbd); return true; }
  cur = null;
  if (!(f === "author" ? A.editor.stageAuthor(c.id, next) : A.editor.stageField(c.id, f, next))) {   // refused, with a toast (a name too long):
    if (was.host.isConnected) cur = was;           // the input and its text stay, as in the filter bar
    return false;
  }
  was.save.cancel(); drafts()?.drop(c.id, [f]);    // in the batch now
  A.closePicker?.();
  refresh(c, f, kbd);
  return true;
}
function refresh(c, f, kbd) {                      // the dialog again (as the form does), scrolled as it was; after a mouse action
  const scroll = A.modal.scrollTop;                // focus stays off (openCard blurs so the shortcuts work), after a key it comes back
  A.hideTip?.();
  if (closing) { closing = false; return; }        // the dialog is closing: its click closes it (a redraw now would eat that click)
  A.goCard(c.id); A.modal.scrollTop = scroll;
  if (kbd) A.modal.querySelector(`[data-inline="${f}"]`)?.focus();
}
const paint = (row, v) => { if (row.classList.contains("star-pick")) { paintStars(row, v); return; }
  [...row.children].forEach((i, n) => i.classList.toggle("on", n < v)); row.setAttribute("aria-valuenow", String(v)); if (row.nextElementSibling?.classList.contains("num")) row.nextElementSibling.textContent = String(v); };
function setStat(k, v, kbd) { if (!card) return; A.editor.stageField(card.id, k, v); refresh(card, k, kbd); }
function commitStat(kbd) {
  if (!prov) return;
  const { row, k, v0 } = prov, v = +row.getAttribute("aria-valuenow"); prov = null;
  if (v !== v0) setStat(k, v, kbd);
}
function statKey(row, k, e) {
  const now = +row.getAttribute("aria-valuenow"), v0 = prov?.row === row ? prov.v0 : now;
  const v = stepValue(now, e.key, 10);
  if (e.key === "Escape" && row.hasAttribute("data-fresh") && now === 0) { e.preventDefault(); e.stopPropagation(); unfresh(row, true); return; }
  if (v !== null) { e.preventDefault(); e.stopPropagation(); prov = { row, k, v0 }; paint(row, v); return; }
  if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitStat(true); return; }
  if (e.key === "Escape" && now !== v0) { e.preventDefault(); e.stopPropagation(); paint(row, v0); prov = null; }   // else Esc closes the dialog, as usual
}
// ---- types: the palette under the type row (a row made for it on a card without types)
const sameTypes = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function openTypes(el, initial = null) {          // initial: a restored draft
  if (cur && !commit(false)) { cur?.ctl.focus(); return; }
  if (pal || !card || !el.isConnected) return;
  A.hideTip?.();
  const c = card, start = [...(c.types || [])].sort(), vocab = typeVocab(A.icons?.());
  let row = el, temp = false;
  if (!el.classList.contains("ctypes")) {          // "+ types"
    A.modal.querySelector(".detail .facts").insertAdjacentHTML("afterend", `<div class="ctypes editing" data-inline="types"></div>`);
    row = A.modal.querySelector(".detail .facts").nextElementSibling; temp = true;
  }
  const html = row.innerHTML, tip = row.dataset.tip, on = initial ? [...initial].sort() : start;
  delete row.dataset.tip; row.classList.add("editing");
  if (initial || temp) row.innerHTML = rowHtml(on, vocab);
  const p = pal = { c, row, html, tip, temp, save: keep(c, "types", start), ctl: null, snap: drafts()?.snap(c.id, ["types"]) };
  const done = staged => { pal = null; p.save.cancel(); if (staged) drafts()?.drop(c.id, ["types"]); else drafts()?.back(c.id, p.snap, ["types"]); A.hideTip?.(); };   // not saved: an older draft stays
  p.ctl = mountPalette(row, { vocab, on, first: start,
    onChange: list => { row.innerHTML = rowHtml(list, vocab); p.save.run(); },
    onSave: (list, kbd) => { const ok = !sameTypes(list, start) && A.editor.stageField(c.id, "types", list); done(ok); if (ok) refresh(c, "types", kbd); else putBack(p, kbd); },
    onCancel: kbd => { done(false); putBack(p, kbd); } });
  if (initial) p.save.run();
}
function putBack(p, kbd) {
  if (p.temp) p.row.remove(); else { p.row.innerHTML = p.html; p.row.classList.remove("editing"); if (p.tip) p.row.dataset.tip = p.tip; }
  if (kbd) spot("types")?.focus();
}
function onClick(e) {
  if (cur && cur.host.contains(e.target)) return;
  const answerBtn = e.target.closest(".detail .draft-offer [data-draft]");
  if (answerBtn) { e.preventDefault(); e.stopPropagation(); answer(answerBtn.dataset.draft === "restore"); return; }
  const cell = e.target.closest(".segs[data-inline] > i, .star-pick > i");
  if (cell) {                                                                // relative to the saved value, not a keyboard change not yet saved
    e.stopPropagation(); const row = cell.parentElement, v = prov?.row === row ? prov.v0 : +row.getAttribute("aria-valuenow"); prov = null;
    setStat(row.dataset.inline, cellValue(v, [...row.children].indexOf(cell) + 1), false); return;
  }
  const el = e.target.closest("[data-inline]");
  if (!el || !A.modal.contains(el)) return;
  const f = el.dataset.inline;
  if (f === "stars" && el.hasAttribute("data-empty")) {                     // "+ stars": the slider, at none
    e.preventDefault(); e.stopPropagation(); el.outerHTML = starsHtml(0);
    const sp = A.modal.querySelector(".detail .star-pick"); if (sp) { sp.dataset.fresh = ""; sp.focus(); } return;   // fresh: nothing chosen puts "+ stars" back
  }
  if (f === "name" || SLIDERS.includes(f)) return;                          // the name on double-click, rows by cell or key
  if ((f === "ability" || f === "note" || ART_KEYS.includes(f)) && e.target.closest("a, .badge, img")) return;   // links in the text still open (the card, the source)
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;                          // a chip's link still opens in a new tab
  e.preventDefault(); e.stopPropagation();
  if (f === "types") openTypes(el); else openText(el, f);
}
/** A text field: in place, unless the card's record has parts and the field isn't one layer (several, or none): then
 *  the Edit dialog at that field, one box per layer (PARTS_EDITOR.md §5). */
function openText(el, f, text = null) {          // text: a restored draft (the dialog drops a joined one on several boxes)
  const c = card;
  if ((f !== "name" && f !== "ability") || !c?.details || !A.editor.partsFor || (c.siteOnly || []).includes(f)) { open(el, f, text); return; }   // website only: one plain value
  A.editor.partsFor(c).then(n => {
    if (card !== c || !el.isConnected) return;
    if (n && (n.rule || n[f === "name" ? "title" : "ability"] !== 1)) A.editor.open(c.id, { focus: f, ...(text != null ? { draft: { [f]: text } } : {}) }); else open(el, f, text);
  });
}
function onDblClick(e) {
  const el = e.target.closest('[data-inline="name"]');
  if (el && A.modal.contains(el)) { e.preventDefault(); openText(el, "name"); }
}
function onKey(e) {
  pointer = false;
  if (cur) {                                                                 // keys inside the open control stay there
    if (!cur.host.contains(e.target)) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(true); }
    else if (e.key === "Enter" && (cur.ctl.tagName !== "TEXTAREA" || e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); commit(true); }
    else e.stopPropagation();
    return;
  }
  const el = e.target.closest?.("[data-inline]");
  if (!el || !A.modal.contains(el)) return;
  const f = el.dataset.inline;
  if (SLIDERS.includes(f) && !el.hasAttribute("data-empty")) { statKey(el, f, e); return; }
  if ((e.key === "Enter" || (e.key === " " && f === "types")) && el.tagName !== "A" && el.tagName !== "BUTTON") { e.preventDefault(); e.stopPropagation(); if (f === "types") openTypes(el); else openText(el, f); }   // links and buttons click themselves; the type row is a button
}
function onFocusOut(e) {                          // Tab to another control keeps the focus in the dialog; a click doesn't
  if (!document.hasFocus()) return;               // the window losing focus (alt-tab) leaves the editor open
  const kbd = !!e.relatedTarget && !pointer;
  if (cur) { if (cur.host.contains(e.target) && !cur.host.contains(e.relatedTarget)) commit(kbd); }
  else if (prov && e.target === prov.row) { commitStat(kbd); if (atNone(e.target) && !e.target.contains(e.relatedTarget)) unfresh(e.target, false); }   // moved and back
  else if (e.target.matches?.(".star-pick[data-fresh]") && !e.target.contains(e.relatedTarget)) unfresh(e.target, false);
}
const atNone = row => row.matches(".star-pick[data-fresh]") && +row.getAttribute("aria-valuenow") === 0;
function unfresh(row, refocus) {                   // a "+ stars" slider left at none: the chip again
  if (!row.isConnected || !row.hasAttribute("data-fresh")) return;
  row.removeAttribute("data-fresh");               // its blur, as it goes, comes back here
  row.outerHTML = ghost("stars");
  if (refocus) spot("stars")?.focus();
}
function away(e) {                                 // a click or tap away saves, even when no focus moves (iOS)
  const t = e.target;
  if ((t === A.modal || t === document.documentElement) && (e.offsetX >= t.clientWidth || e.offsetY >= t.clientHeight)) return;   // its scrollbar
  if (t.closest?.(".tok-picker")) return;
  if (cur && !cur.host.contains(t)) commit(false);
  const fresh = A.modal.querySelector(".detail .star-pick[data-fresh]");
  if (fresh && !fresh.contains(t)) { const moved = prov?.row === fresh; if (moved) commitStat(false); if (!moved || atNone(fresh)) unfresh(fresh, false); }
  if (naming && t !== naming.input) { if (naming.input.value.trim()) createBucket(false); else closeName(false); }
}

// ---- the cards grid: select with Ctrl/Cmd/Shift-click, drag onto a Series or Author value in the filter bar
/** Tiles reflect the selection; the result count says how many. */
export function reflect(view, selected) {
  for (const t of view.querySelectorAll(".browse .grid .tile[data-open]")) t.toggleAttribute("data-selected", selected.has(t.dataset.open));
  const rc = view.querySelector(".result-count");
  if (rc) rc.textContent = rc.textContent.replace(/ · \d+ selected$/, "") + (selected.size ? ` · ${selected.size} selected` : "");
}
/** The edit-mode marks of the tiles in root: the tile drags, not its picture; data-selected. mountGrid's, and app.js
 *  fillGrid's for the tiles it adds after the first screen. */
export function markTiles(root, selected) {
  for (const t of root.querySelectorAll(".tile[data-open]")) {
    t.draggable = true; t.querySelector("img")?.setAttribute("draggable", "false");
    t.toggleAttribute("data-selected", selected.has(t.dataset.open));
  }
}
/** Edit mode only; call after renderCards. The Series, Subseries and Author selects get the new values no card carries yet
 *  and a "New …" option, in the grid and the table alike (a list without subseries gets its Subseries select). With the
 *  grid, the tiles turn draggable and drop lists go under the selects (every series, subseries and author), shown only
 *  while a drag is on (body.dragging-cards). p: the rendered list's params, renderCards' r.params
 *  (with the card dialog open the list is S.listHash's, not the hash's). */
export function mountGrid(view, p, api = A) {
  const filters = view.querySelector(".browse .filters"); if (!filters) return;
  naming = null; listParams = p;
  const grid = view.querySelector(".browse .grid"), opts = api.editor.options(), b = opts.buckets;
  const sel = key => filters.querySelector(`select[data-key="${key}"]`);
  const at = key => sel(key)?.closest(".sel-row") || sel(key);            // after the select's ≠ toggle
  if (!sel("subseries")) at("series")?.insertAdjacentHTML("afterend", `<h3>Subseries</h3><select data-action="select-param" data-key="subseries"><option value="">All subseries</option></select>`);
  for (const key of ["series", "subseries", "author"]) {
    const el = sel(key); if (!el) continue;
    el.insertAdjacentHTML("beforeend", bucketOptions(new Set([...el.options].map(o => o.value)), b[key], p.get(key) || "") + newOption(key));
    if (p.get(key)) at(key)?.insertAdjacentHTML("afterend", renameButton(key, p.get(key), "ghost rename-value", `⇄ Rename “${p.get(key)}”…`));   // Rename everywhere under a picked value
  }
  const subs = (p.get("sub") || "").split(",").filter(Boolean), subChips = filters.querySelector('[data-key="sub"]')?.closest(".chips");
  if (subs.length === 1 && subChips) subChips.insertAdjacentHTML("afterend", renameButton("subtype", subs[0], "ghost rename-value", `⇄ Rename “${subs[0]}”…`));
  if (!grid) return;
  markTiles(grid, api.selected);
  reflect(view, api.selected);
  for (const [key, list, news] of [["series", opts.series, b.series], ["subseries", opts.subseries, b.subseries], ["author", opts.authors, b.author]])
    at(key)?.insertAdjacentHTML("afterend", `<div class="drop-list" data-drop="${key}" aria-label="Drop cards on a ${key} to set it">${dropChips(list, news)}</div>`);
}
const DROP = ".drop-list .chip, .tray .bucket-wrap";   // a filter-bar value, a pinned box with its ✕ and rename buttons
/** The chip or pinned box (.bucket[data-pin]) a drop region stands for. */
const boxOf = r => (r?.classList.contains("bucket-wrap") ? r.querySelector(".bucket[data-pin]") : r);
/** A drop target's {key, value}: a filter-bar chip (its list's data-drop), or a tray box (data-pin-k, -v). */
export const targetOf = el => (el.dataset.pin != null
  ? { key: el.dataset.pinK, value: el.dataset.pinV }
  : { key: el.closest(".drop-list").dataset.drop, value: el.dataset.value });
// Edge autoscroll for the tray (it scrolls past ~3 rows of boxes): a drag in its top or bottom EDGE px (a sixth of a short tray) scrolls it,
// faster nearer the edge up to MAXV px a frame. Safari doesn't autoscroll overflow boxes in a drag; Chrome does in the
// outer ~20 px, so while the browser scrolls it at least as fast, this one waits (the speed is the larger of the two, not the sum).
const EDGE = 40, MAXV = 5;
let roll = null, raf = 0;                          // roll {tray, v: px a frame, x, y: the pointer, at: scrollTop after the last frame, native: when the browser last did, until: ms}
function edgeScroll(e) {
  const tray = document.querySelector(".browse > section > .tray"), r = tray?.getBoundingClientRect();
  const edge = Math.min(EDGE, r ? r.height / 6 : 0);   // a short tray (phones): smaller zones, the middle rows stay still
  const d = !r || tray.scrollHeight <= tray.clientHeight || e.clientX < r.left || e.clientX > r.right ? 0
    : e.clientY >= r.top && e.clientY < r.top + edge ? e.clientY - (r.top + edge)
    : e.clientY <= r.bottom && e.clientY > r.bottom - edge ? e.clientY - (r.bottom - edge) : 0;
  if (!d) { roll = null; return; }                 // a queued frame then stops itself: one loop at most (raf)
  const v = Math.sign(d) * Math.min(MAXV, Math.ceil(Math.abs(d) / 6));
  const go = roll?.tray === tray;
  roll = { tray, v, x: e.clientX, y: e.clientY, at: go ? roll.at : tray.scrollTop, native: go ? roll.native : -1e9, until: performance.now() + 500 };   // dragover repeats while the pointer rests
  if (!raf) raf = requestAnimationFrame(rollOn);
}
function rollOn(t) {
  raf = 0;
  if (!roll || t > roll.until || !roll.tray.isConnected) { roll = null; return; }
  const { tray, v } = roll, moved = (tray.scrollTop - roll.at) * Math.sign(v);
  if (moved >= Math.abs(v)) roll.native = t;      // the browser scrolls it at least as fast: leave it to the browser a while
  else if (!(t - roll.native < 150)) tray.scrollTop = roll.at + v;
  roll.at = tray.scrollTop;
  relight(roll.x, roll.y);                         // the boxes moved under a resting pointer: light the one a drop would hit
  raf = requestAnimationFrame(rollOn);
}
function relight(x, y) {
  const t = boxOf(document.elementFromPoint(x, y)?.closest(DROP));
  for (const c of document.querySelectorAll(".tray .over")) if (c !== t) c.classList.remove("over");
  if (t?.closest(".tray")) t.classList.add("over");
}
const dragOff = () => { roll = null; dragged = null; document.body.classList.remove("dragging-cards"); for (const c of document.querySelectorAll(".drop-list .over, .tray .over")) c.classList.remove("over"); };
function onDragStart(e) {
  const t = e.target.closest?.(".tile[draggable]"); if (!t) return;
  dragged = dragIds(t.dataset.open, A.selected);
  e.dataTransfer.setData("text/plain", dragged.join(","));   // Firefox starts no drag without data
  e.dataTransfer.effectAllowed = "link";
  requestAnimationFrame(() => { if (dragged) document.body.classList.add("dragging-cards"); });   // a layout change inside dragstart cancels it
}
const dragging = () => !!dragged;                  // our tiles, not text or files dragged in
function onDragOver(e) {                           // dragenter too: Safari and Firefox drop only on a target that cancelled it
  if (dragging()) edgeScroll(e);
  const t = dragging() && boxOf(e.target.closest?.(DROP)); if (!t) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "link"; t.classList.add("over");
}
function onDragLeave(e) {
  if (!e.relatedTarget) roll = null;               // left the window: no scrolling on (a dragenter starts it again)
  const r = e.target.closest?.(DROP); if (r && !r.contains(e.relatedTarget)) boxOf(r)?.classList.remove("over");
}
function onDrop(e) {
  const t = dragging() && boxOf(e.target.closest?.(DROP)); if (!t) return;
  e.preventDefault();
  const ids = dragged?.length ? dragged : (e.dataTransfer.getData("text/plain") || "").split(",").filter(Boolean);
  dragOff();
  dropOn(ids, targetOf(t));
}
/** The one staging path for a drop, a tray tap or a number key: key = value on every card in ids, a toast, the selection cleared. */
export function dropOn(ids, { key, value: v }) {
  const r = A.editor.stageMany(ids, key, v), { changed: n, dups, value, error } = r;
  A.selected.clear();
  A.rerender();
  A.toast(error || [n ? `${n} card${n === 1 ? "" : "s"}: ${key} → ${value}` : "",
    dups ? `${dups} duplicate${dups === 1 ? " kept its original's" : "s kept their originals'"} author` : ""].filter(Boolean).join(" · ") || `Already ${value}`);
  return r;
}

// ---- the filter bar: "New series…" (subseries, author) swaps its select for an input; Enter or a click away makes the
// name (editor.addBucket), Esc or nothing typed puts the select back as it was
function openName(sel) {
  closeName(false);
  sel.hidden = true;
  sel.insertAdjacentHTML("afterend", control(sel.dataset.key, "", true));
  naming = { sel, key: sel.dataset.key, input: sel.nextElementSibling };
  naming.input.focus();
}
function closeName(refocus) {
  if (!naming) return;
  const { sel, input } = naming; naming = null;
  input.remove(); sel.hidden = false;
  sel.selectedIndex = Math.max(0, [...sel.options].findIndex(o => o.defaultSelected));
  if (refocus) sel.focus();
}
function createBucket(kbd) {
  const { sel, key, input } = naming;
  const r = A.editor.addBucket(key, input.value);
  if (!r) { closeName(kbd); return; }                                        // nothing typed
  if (r.error) { A.toast(r.error); return; }                                 // the input stays, to shorten it
  closeName(kbd);
  const drops = document.querySelector(`.filters .drop-list[data-drop="${key}"]`);
  if (!r.existed) {                                // added in place, no re-render: a click that ended the typing still lands
    sel.querySelector("[data-new-bucket]")?.insertAdjacentHTML("beforebegin", bucketOptions(new Set(), [r.name], ""));
    const last = drops?.querySelectorAll(".chip[data-new]"), html = dropChips([], [r.name]);
    if (last?.length) last[last.length - 1].insertAdjacentHTML("afterend", html); else drops?.insertAdjacentHTML("afterbegin", html);
  }
  A.toast(r.note || `New ${LABEL[key].toLowerCase()} “${r.name}”: ${(listParams.get("view") || localStorage.getItem("view")) === "table" ? "in Grid view, drag cards onto it" : `drag cards onto it under ${LABEL[key]}`}`);   // app.js's view choice
}
function onChange(e) {                            // before app.js's listener: the filter doesn't change
  const sel = e.target.closest?.(".filters select[data-key]");
  if (!sel || !sel.options[sel.selectedIndex]?.hasAttribute("data-new-bucket")) return;
  e.stopImmediatePropagation();
  if (performance.now() - arrowAt < 150) { sel.selectedIndex = Math.max(0, [...sel.options].findIndex(o => o.defaultSelected)); return; }   // arrowed past the end of a closed select
  openName(sel);
}
function onNameKey(e) {
  if (!naming && /^(Arrow|Page|Home$|End$)/.test(e.key) && !e.altKey && e.target.closest?.(".filters select[data-key]")) arrowAt = performance.now();
  if (!naming || e.target !== naming.input) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeName(true); }
  else if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); createBucket(true); }
}
function onNameFocusOut(e) {
  if (!naming || e.target !== naming.input || !document.hasFocus()) return;   // alt-tab leaves it open
  if (naming.input.value.trim()) createBucket(false); else closeName(false);
}

/** More of the api, after install: {hideTip, icons (() => cards.json icons), closePicker (tokens.js dismiss)}. */
export const extend = more => { Object.assign(A, more); };
/** Once at boot, before app.js's document listeners: delegated listeners on the modal (editors) and the document (drag,
 *  the filter bar's "New …"). api = {editor, modal, selected (Set of card ids), goCard, rerender, toast}. */
export function install(api) {
  A = api;
  const flush = () => { cur?.save.flush(); pal?.save.flush(); };    // closing the tab: the draft now, not in a moment
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  api.modal.addEventListener("pointerdown", () => { pointer = true; });
  window.addEventListener("pointerdown", e => { closing = !!(cur || pal || prov) && api.modal.contains(e.target) && !!e.target.closest?.('[data-action="close"]');
    stay = !!(cur || pal || prov) && e.target === api.modal; }, true);   // before the palette's click-away
  window.addEventListener("click", e => { if (stay && e.target === api.modal) e.stopPropagation(); stay = false; }, true);   // the card stays open (app.js closes on a backdrop click)
  document.addEventListener("pointerdown", away, true);
  api.modal.addEventListener("click", onClick);
  api.modal.addEventListener("dblclick", onDblClick);
  api.modal.addEventListener("keydown", onKey);
  api.modal.addEventListener("focusout", onFocusOut);
  api.modal.addEventListener("suggest-pick", e => { if (cur && e.target === cur.ctl) commit(true); });   // a picked name saves at once
  document.addEventListener("dragstart", onDragStart);
  document.addEventListener("dragend", dragOff);
  document.addEventListener("dragenter", onDragOver);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", onNameKey);
  document.addEventListener("focusout", onNameFocusOut);
  document.addEventListener("suggest-pick", e => { if (naming && e.target === naming.input) createBucket(true); });
}
