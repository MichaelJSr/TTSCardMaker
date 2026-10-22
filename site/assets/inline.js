// Inline editing, edit mode only (signed in): the card dialog's values edit in place, tiles in the cards grid select
// and drag onto a Series, Subseries or Author value, and the filter bar's selects make new ones. A DOM upgrade after
// app.js has rendered (attributes and listeners, no template change), so view mode is untouched. Staging goes through
// the editor's single-field ops (edit.js stageField/stageAuthor), the same batch the form fills. Helpers above `install` are pure; node checks under /tmp exercise them.
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
/** The control for a field: name and chips an input (chips with a datalist of known values), the ability a textarea.
 *  fresh: the filter bar's input for a new series, subseries or author. */
export function control(f, v, list = [], fresh = false) {
  const label = f === "name" ? "Name, Enter to save, Esc to cancel" : f === "ability" ? "Ability text, Ctrl+Enter to save, Esc to cancel"
    : `${fresh ? `New ${LABEL[f].toLowerCase()}` : LABEL[f]}, Enter to save, Esc to cancel`;
  if (f === "name") return `<input class="inline-name" aria-label="${label}" value="${esc(v)}">`;
  if (f === "ability") return `<textarea class="inline-ability" rows="${fit(v)}" spellcheck="true" aria-label="${label}">${esc(v)}</textarea>`;
  const dl = list.length ? `<datalist id="inline-dl">${list.map(x => `<option value="${esc(x)}">`).join("")}</datalist>` : "";
  return `<input class="inline-fact${f === "note" ? " inline-note" : ""}"${dl ? ' list="inline-dl"' : ""} aria-label="${label}" placeholder="${fresh ? "new " : ""}${LABEL[f].toLowerCase()}" value="${esc(v)}" style="--w:${v.length + 2}ch">${dl}`;
}
/** The bucket options a filter select gets: those it lacks (have: its values), as "X (no cards yet)", selected when picked.
 *  list: [{value, series?, where?}]; series: a subseries' series (the select-param handler then sets it too); where: shown
 *  in the brackets ("X (Mario, no cards yet)"). */
export const bucketOptions = (have, list, picked) => list.filter(x => !have.has(x.value)).map(x => `<option value="${esc(x.value)}"${x.series != null ? ` data-series="${esc(x.series)}"` : ""}${x.value === picked ? " selected" : ""}>${esc(x.value)} (${x.where ? `${esc(x.where)}, ` : ""}no cards yet)</option>`).join("");
/** The select's last option: "New series…" (data-new-bucket: its value never matters); a subseries needs a picked series. */
export const newOption = (key, series) => (key === "subseries" && !series ? `<option disabled>Pick a series to add a subseries</option>`
  : `<option value="" data-new-bucket>New ${LABEL[key].toLowerCase()}…</option>`);
const chipHtml = (v, fresh) => `<span class="chip" data-value="${esc(v)}"${fresh ? " data-new" : ""}>${esc(v)}</span>`;
/** A drop list's chips: the new (pending) values first, dashed, then the rest. */
export const dropChips = (list, fresh) => [...fresh.map(v => chipHtml(v, true)), ...list.filter(v => !fresh.includes(v)).map(v => chipHtml(v, false))].join("");

let A = null;                                      // {editor, modal, selected, goCard, rerender, toast, params}, from install
let card = null;                                   // the card the dialog shows (mountCard)
let cur = null;                                    // the open editor: {c, f, el, host, html, cls, tip, ctl, v}
let prov = null;                                   // a stat row changed by keyboard, not yet saved: {row, k, v0}
let pointer = false;                               // the last input was a pointer (focus moved by a click, not Tab)
let naming = null;                                 // the filter bar's open "New …" input: {sel, key, input}

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
/** Edit mode only; call after renderCards. The Series, Subseries and Author selects get the new values no card carries yet
 *  and a "New …" option, in the grid and the table alike (a series without subseries gets its Subseries select). With the
 *  grid, the tiles turn draggable and drop lists go under the selects (every series, every author; the picked series' own
 *  subseries), shown only while a drag is on (body.dragging-cards). */
export function mountGrid(view, api = A) {
  const filters = view.querySelector(".browse .filters"); if (!filters) return;
  naming = null;
  const grid = view.querySelector(".browse .grid"), opts = api.editor.options(), b = opts.buckets;
  const p = api.params?.() || new URLSearchParams(), series = p.get("series") || "", sel = key => filters.querySelector(`select[data-key="${key}"]`);
  if (!sel("subseries")) sel("series")?.insertAdjacentHTML("afterend", `<h3>Subseries</h3><select data-action="select-param" data-key="subseries"><option value="">All subseries</option></select>`);
  const fresh = { series: b.series.map(value => ({ value })), author: b.author.map(value => ({ value })),
    subseries: b.subseries.filter(([s]) => !series || s === series).map(([s, value]) => ({ value, series: s, where: series ? "" : s })) };
  for (const key of ["series", "subseries", "author"]) {
    const el = sel(key); if (!el) continue;
    el.insertAdjacentHTML("beforeend", bucketOptions(new Set([...el.options].map(o => o.value)), fresh[key], p.get(key) || "") + newOption(key, series));
  }
  if (!grid) return;
  for (const t of grid.querySelectorAll(".tile[data-open]")) t.draggable = true;
  reflect(view, api.selected);
  const own = b.subseries.filter(([s]) => s === series).map(([, v]) => v);
  for (const [key, list, news] of [["series", opts.series, b.series], ["author", opts.authors, b.author], ...(series ? [["subseries", opts.ownSubseries(series), own]] : [])])
    sel(key)?.insertAdjacentHTML("afterend", `<div class="drop-list" data-drop="${key}" aria-label="Drop cards on a ${key} to set it">${dropChips(list, news)}</div>`);
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
  const { changed: n, dups, value, error } = A.editor.stageMany(ids, key, v);
  A.selected.clear();
  A.rerender();
  A.toast(error || [n ? `${n} card${n === 1 ? "" : "s"}: ${key} → ${value}` : "",
    dups ? `${dups} duplicate${dups === 1 ? " kept its original's" : "s kept their originals'"} author` : ""].filter(Boolean).join(" · ") || `Already ${value}`);
}

// ---- the filter bar: "New series…" (subseries, author) swaps its select for an input; Enter or a click away makes the
// name (editor.addBucket), Esc or nothing typed puts the select back as it was
function openName(sel) {
  closeName(false);
  sel.hidden = true;
  sel.insertAdjacentHTML("afterend", control(sel.dataset.key, "", [], true));
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
  const { key, input } = naming, series = key === "subseries" ? A.params().get("series") || "" : "";
  const r = A.editor.addBucket(key, input.value, series);
  if (!r) { closeName(kbd); return; }                                        // nothing typed
  if (r.error) { A.toast(r.error); if (!kbd) closeName(false); return; }     // after Enter the input stays, to shorten it
  naming = null;
  A.toast(r.note || `New ${LABEL[key].toLowerCase()} “${r.name}”${series ? ` of ${series}` : ""}: drag cards onto it under ${LABEL[key]}`);
  A.rerender();                                                              // the filter stays: the cards to drag are still shown
  if (kbd) document.querySelector(`.filters select[data-key="${key}"]`)?.focus();
}
function onChange(e) {                            // before app.js's listener: the filter doesn't change
  const sel = e.target.closest?.(".filters select[data-key]");
  if (!sel || !sel.options[sel.selectedIndex]?.hasAttribute("data-new-bucket")) return;
  e.stopImmediatePropagation();
  openName(sel);
}
function onNameKey(e) {
  if (!naming || e.target !== naming.input) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeName(true); }
  else if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); createBucket(true); }
}
function onNameFocusOut(e) {
  if (!naming || e.target !== naming.input || !document.hasFocus()) return;   // alt-tab leaves it open
  if (naming.input.value.trim()) createBucket(false); else closeName(false);
}

/** Once at boot, before app.js's document listeners: delegated listeners on the modal (editors) and the document (drag,
 *  the filter bar's "New …"). api = {editor, modal, selected (Set of card ids), goCard, rerender, toast, params (the hash's)}. */
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
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", onNameKey);
  document.addEventListener("focusout", onNameFocusOut);
}
