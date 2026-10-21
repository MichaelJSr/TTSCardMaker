// Inline editing, edit mode only (signed in): the card dialog's values edit in place, and tiles in the cards grid select
// and drag onto a Series or Author value. A DOM upgrade after app.js has rendered (attributes and listeners, no template
// change), so view mode is untouched. Staging goes through the editor's single-field ops (edit.js stageField/stageAuthor),
// the same batch the form fills. Helpers above `install` are pure; node checks under /tmp exercise them.
import { esc } from "./text.js";

const STATS = ["hp", "def", "atk", "spd"];
const LABEL = { hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", series: "Series", subseries: "Subseries", author: "Author", note: "Note" };
const IMAGE = "on the card image";                 // the form's "On the card image" marker (PSD fields); the rest is database only

/** A click on stat cell `cell` (1-based) of a row showing `current`: that value, or one less for the top lit cell (so 0 is reachable). */
export const cellValue = (current, cell) => (cell === current ? cell - 1 : cell);
/** Rows for a textarea holding `text`: one more than its lines, 2 to 14. */
export const fit = text => Math.min(14, Math.max(2, String(text ?? "").split("\n").length + 1));
/** The ids a drag carries: the selection when the dragged tile is in it, else that tile alone. */
export const dragIds = (id, selected) => (selected.has(id) ? [...selected] : [id]);
/** Shift-click: the ids of `order` from the anchor to `id`, both included; just `id` without an anchor in the list. */
export const rangeIds = (order, anchor, id) => { const a = order.indexOf(anchor), b = order.indexOf(id); return a < 0 || b < 0 ? [id] : order.slice(Math.min(a, b), Math.max(a, b) + 1); };
/** The control for a field: name and chips an input (chips with a datalist of known values), the ability a textarea. */
export function control(f, v, list = []) {
  const label = f === "name" ? "Name, Enter to save, Esc to cancel" : f === "ability" ? "Ability text, Ctrl+Enter to save, Esc to cancel" : `${LABEL[f]}, Enter to save, Esc to cancel`;
  if (f === "name") return `<input class="inline-name" aria-label="${label}" value="${esc(v)}">`;
  if (f === "ability") return `<textarea class="inline-ability" rows="${fit(v)}" spellcheck="true" aria-label="${label}">${esc(v)}</textarea>`;
  const dl = list.length ? `<datalist id="inline-dl">${list.map(x => `<option value="${esc(x)}">`).join("")}</datalist>` : "";
  return `<input class="inline-fact${f === "note" ? " inline-note" : ""}"${dl ? ' list="inline-dl"' : ""} aria-label="${label}" placeholder="${LABEL[f].toLowerCase()}" value="${esc(v)}" style="--w:${v.length + 2}ch">${dl}`;
}

let A = null;                                      // {editor, modal, selected, goCard, rerender, toast}, from install
let card = null;                                   // the card the dialog shows (mountCard)
let cur = null;                                    // the open editor: {c, f, el, host, html, cls, tip, ctl, v}
let prov = null;                                   // a stat row changed by keyboard, not yet saved: {row, k, v0}
let pointer = false;                               // the last input was a pointer (focus moved by a click, not Tab)

// ---- the card dialog
/** Mark the editable spots of the open card dialog (edit mode only; call after openCard). */
export function mountCard(modal, c, api = A) {
  const detail = modal.querySelector(".detail"); if (!detail) return;
  card = c; cur = null; prov = null;
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
    if (f === "author" && c.dup) { if (chip.author) chip.author.dataset.tip = "Same as the original"; continue; }
    if (chip[f]) { chip[f].dataset.inline = f; chip[f].dataset.tip = `Click to edit the ${LABEL[f].toLowerCase()}`; }
    else facts.insertAdjacentHTML("beforeend", `<button type="button" class="fact ghost-fact" data-inline="${f}" data-empty aria-label="Add a ${LABEL[f].toLowerCase()}">+ ${LABEL[f].toLowerCase()}</button>`);
  }
  const note = detail.querySelector(":scope > div:nth-child(2) > .note");
  if (note) mark(note, "note", "Click to edit the note");
  else facts.insertAdjacentHTML("beforeend", `<button type="button" class="fact ghost-fact" data-inline="note" data-empty aria-label="Add a note">+ note</button>`);
}
function open(el, f) {
  if (cur) commit(false);
  if (!el.isConnected || !card) return;
  const c = card, v = f === "author" ? (c.author || "") : String(A.editor.value(c, f) ?? "");
  const opts = A.editor.options(), list = f === "series" ? opts.series : f === "subseries" ? opts.subseries(c.series) : f === "author" ? opts.authors : [];
  const swap = el.tagName === "A" || el.tagName === "BUTTON";     // a link would still navigate, a button can't hold an input
  let host = el;
  if (swap) { host = document.createElement("span"); host.className = el.className; host.dataset.inline = f; el.replaceWith(host); }
  cur = { c, f, el, host, html: el.innerHTML, cls: el.className, tip: el.dataset.tip, ctl: null, v };
  if (!swap) { delete el.dataset.tip; if (el.tagName === "P") el.className = "ability"; }   // "No ability text." becomes the text box
  host.innerHTML = control(f, v, list);
  cur.ctl = host.querySelector("input, textarea");
  cur.ctl.focus(); if (f !== "ability") cur.ctl.select();
}
function cancel(refocus) {
  if (!cur) return;
  const { el, host, html, cls, tip } = cur; cur = null;
  if (host !== el) host.replaceWith(el); else { el.innerHTML = html; el.className = cls; if (tip) el.dataset.tip = tip; }
  if (refocus) el.focus();
}
function commit(kbd) {                            // kbd: from the keyboard, so focus returns to the spot
  if (!cur) return;
  const { c, f, ctl, v } = cur, next = ctl.value.replace(/\r/g, "");
  if (next.trim() === v.replace(/\r/g, "").trim()) { cancel(kbd); return; }
  cur = null;
  if (f === "author") A.editor.stageAuthor(c.id, next); else A.editor.stageField(c.id, f, next);
  refresh(c, f, kbd);
}
function refresh(c, f, kbd) {                      // the dialog again (as the form does), scrolled as it was; after a mouse action
  const scroll = A.modal.scrollTop;                // focus stays off (openCard blurs so the shortcuts work), after a key it comes back
  A.goCard(c.id); A.modal.scrollTop = scroll;
  if (kbd) A.modal.querySelector(`[data-inline="${f}"]`)?.focus();
}
const paint = (row, v) => { [...row.children].forEach((i, n) => i.classList.toggle("on", n < v)); row.setAttribute("aria-valuenow", String(v)); if (row.nextElementSibling?.classList.contains("num")) row.nextElementSibling.textContent = String(v); };
function setStat(k, v, kbd) { if (!card) return; A.editor.stageField(card.id, k, v); refresh(card, k, kbd); }
function commitStat(kbd) {
  if (!prov) return;
  const { row, k, v0 } = prov, v = +row.getAttribute("aria-valuenow"); prov = null;
  if (v !== v0) setStat(k, v, kbd);
}
function statKey(row, k, e) {
  const now = +row.getAttribute("aria-valuenow"), v0 = prov?.row === row ? prov.v0 : now;
  const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
  const v = step !== undefined ? Math.max(0, Math.min(10, now + step)) : e.key === "Home" ? 0 : e.key === "End" ? 10 : null;
  if (v !== null) { e.preventDefault(); e.stopPropagation(); prov = { row, k, v0 }; paint(row, v); return; }
  if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitStat(true); return; }
  if (e.key === "Escape" && now !== v0) { e.preventDefault(); e.stopPropagation(); paint(row, v0); prov = null; }   // else Esc closes the dialog, as usual
}
function onClick(e) {
  if (cur && cur.host.contains(e.target)) return;
  const cell = e.target.closest(".segs[data-inline] > i");
  if (cell) {                                                                // relative to the saved value, not a keyboard change not yet saved
    e.stopPropagation(); const row = cell.parentElement, v = prov?.row === row ? prov.v0 : +row.getAttribute("aria-valuenow"); prov = null;
    setStat(row.dataset.inline, cellValue(v, [...row.children].indexOf(cell) + 1), false); return;
  }
  const el = e.target.closest("[data-inline]");
  if (!el || !A.modal.contains(el)) return;
  const f = el.dataset.inline;
  if (f === "name" || STATS.includes(f)) return;                            // the name on double-click, rows by cell or key
  if ((f === "ability" || f === "note") && e.target.closest("a, .badge, img")) return;   // links in the text still open the card
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;                          // a chip's link still opens in a new tab
  e.preventDefault(); e.stopPropagation();
  open(el, f);
}
function onDblClick(e) {
  const el = e.target.closest('[data-inline="name"]');
  if (el && A.modal.contains(el)) { e.preventDefault(); open(el, "name"); }
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
  if (STATS.includes(f)) { statKey(el, f, e); return; }
  if (e.key === "Enter" && el.tagName !== "A" && el.tagName !== "BUTTON") { e.preventDefault(); e.stopPropagation(); open(el, f); }   // links and buttons click themselves
}
function onFocusOut(e) {                          // Tab to another control keeps the focus in the dialog; a click doesn't
  if (!document.hasFocus()) return;               // the window losing focus (alt-tab) leaves the editor open
  const kbd = !!e.relatedTarget && !pointer;
  if (cur) { if (cur.host.contains(e.target) && !cur.host.contains(e.relatedTarget)) commit(kbd); }
  else if (prov && e.target === prov.row) commitStat(kbd);
}

// ---- the cards grid: select with Ctrl/Cmd/Shift-click, drag onto a Series or Author value in the filter bar
/** Tiles reflect the selection; the result count says how many. */
export function reflect(view, selected) {
  for (const t of view.querySelectorAll(".browse .grid .tile[data-open]")) t.toggleAttribute("data-selected", selected.has(t.dataset.open));
  const rc = view.querySelector(".result-count");
  if (rc) rc.textContent = rc.textContent.replace(/ · \d+ selected$/, "") + (selected.size ? ` · ${selected.size} selected` : "");
}
/** Make the grid's tiles draggable and add the drop lists (every series, every author) under the two selects; shown only
 *  while a drag is on (body.dragging-cards). Edit mode only; call after renderCards. */
export function mountGrid(view, api = A) {
  const grid = view.querySelector(".browse .grid"); if (!grid) return;
  for (const t of grid.querySelectorAll(".tile[data-open]")) t.draggable = true;
  reflect(view, api.selected);
  const opts = api.editor.options();
  for (const [key, list] of [["series", opts.series], ["author", opts.authors]]) {
    const sel = view.querySelector(`.filters select[data-key="${key}"]`); if (!sel) continue;
    sel.insertAdjacentHTML("afterend", `<div class="drop-list" data-drop="${key}" aria-label="Drop cards on a ${key} to set it">${list.map(v => `<span class="chip" data-value="${esc(v)}">${esc(v)}</span>`).join("")}</div>`);
  }
}
const dragOff = () => { document.body.classList.remove("dragging-cards"); for (const c of document.querySelectorAll(".drop-list .over")) c.classList.remove("over"); };
function onDragStart(e) {
  const t = e.target.closest?.(".tile[draggable]"); if (!t) return;
  e.dataTransfer.setData("text/plain", dragIds(t.dataset.open, A.selected).join(","));
  e.dataTransfer.effectAllowed = "link";
  document.body.classList.add("dragging-cards");
}
const dragging = () => document.body.classList.contains("dragging-cards");   // our tiles, not text or files dragged in
function onDragOver(e) {
  const chip = dragging() && e.target.closest?.(".drop-list .chip"); if (!chip) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "link"; chip.classList.add("over");
}
function onDragLeave(e) { e.target.closest?.(".drop-list .chip")?.classList.remove("over"); }
function onDrop(e) {
  const chip = dragging() && e.target.closest?.(".drop-list .chip"); if (!chip) return;
  e.preventDefault(); dragOff();
  const ids = (e.dataTransfer.getData("text/plain") || "").split(",").filter(Boolean), key = chip.closest(".drop-list").dataset.drop, v = chip.dataset.value;
  const n = A.editor.stageMany(ids, key, v);
  A.selected.clear();
  A.rerender();
  A.toast(`${n} card${n === 1 ? "" : "s"}: ${key} → ${v}`);
}

/** Once at boot: delegated listeners on the modal (editors) and the document (drag). api = {editor, modal, selected (Set of
 *  card ids), goCard, rerender, toast}. */
export function install(api) {
  A = api;
  api.modal.addEventListener("pointerdown", () => { pointer = true; });
  api.modal.addEventListener("click", onClick);
  api.modal.addEventListener("dblclick", onDblClick);
  api.modal.addEventListener("keydown", onKey);
  api.modal.addEventListener("focusout", onFocusOut);
  document.addEventListener("dragstart", onDragStart);
  document.addEventListener("dragend", dragOff);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
}
