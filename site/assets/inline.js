// Inline editing, edit mode only (signed in): the card dialog's values edit in place, tiles in the cards grid select
// and drag onto a Series, Subseries or Author value, and the filter bar's selects make new ones. A DOM upgrade after
// app.js has rendered (attributes and listeners, no template change), so view mode is untouched. Staging goes through
// the editor's single-field ops (edit.js stageField/stageAuthor), the same batch the form fills. Helpers above
// `install` are pure; node checks under /tmp exercise them. Stars (stars.js) and types (palette.js) edit in place too;
// what is typed is kept as a draft until it is saved (drafts.js), and offered back when the card opens again.
import { esc } from "./text.js";
import { starsHtml, paintStars, stepValue } from "./stars.js";
import { typeVocab, mountPalette, rowHtml } from "./palette.js";
import { rawOf, restorable, offerHtml, later } from "./drafts.js";

const STATS = ["hp", "def", "atk", "spd"];
const SLIDERS = [...STATS, "stars"];                // a row of cells: click one, or arrows and Enter
const TEXT = ["name", "ability", "note", "series", "subseries", "author"];   // the fields with a text control
const LABEL = { hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", series: "Series", subseries: "Subseries", author: "Author", note: "Note", stars: "Stars", types: "Types" };
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
/** The bucket options a filter select gets: those it lacks, as "X (no cards yet)", selected when picked. have: its
 *  optKey()s; list: [{value, series?, where?}]; series: a subseries' series (the select-param handler then sets it too);
 *  where: that series, shown in the brackets ("X (Mario, no cards yet)") when none is picked. */
export const bucketOptions = (have, list, picked) => list.filter(x => !have.has(x.where ? `${x.series}\u0001${x.value}` : x.value))
  .map(x => `<option value="${esc(x.value)}"${x.series != null ? ` data-series="${esc(x.series)}"` : ""}${x.value === picked && !x.where ? " selected" : ""}>${esc(x.value)} (${x.where ? `${esc(x.where)}, ` : ""}no cards yet)</option>`).join("");
/** An option's key for bucketOptions' have: its series too when it names one (a subseries in two series). */
export const optKey = o => (o.dataset.series != null ? `${o.dataset.series}\u0001${o.value}` : o.value);
/** The select's last option: "New series…" (data-new-bucket: its value never matters); a subseries needs a picked series. */
export const newOption = (key, series) => (key === "subseries" && !series ? `<option disabled>Pick a series to add a subseries</option>`
  : `<option value="" data-new-bucket>New ${LABEL[key].toLowerCase()}…</option>`);
const chipHtml = (v, fresh) => `<span class="chip" data-value="${esc(v)}"${fresh ? " data-new" : ""}>${esc(v)}</span>`;
/** A drop list's chips: the new (pending) values first, dashed, then the rest. */
export const dropChips = (list, fresh) => [...fresh.map(v => chipHtml(v, true)), ...list.filter(v => !fresh.includes(v)).map(v => chipHtml(v, false))].join("");

let A = null;                                      // {editor, modal, selected, goCard, rerender, toast}, from install
let card = null;                                   // the card the dialog shows (mountCard)
let cur = null;                                    // the open editor: {c, f, el, host, html, cls, tip, ctl, v, save}
let pal = null;                                    // the open type palette: {c, row, html, tip, temp, save, ctl}
let offered = null;                                // the card dialog's draft offer: {c, fields}
let prov = null;                                   // a stat row changed by keyboard, not yet saved: {row, k, v0}
let pointer = false;                               // the last input was a pointer (focus moved by a click, not Tab)
let naming = null;                                 // the filter bar's open "New …" input: {sel, key, input}
let listParams = new URLSearchParams();            // the params of the list mountGrid last upgraded (not the hash: a card route has none)
let arrowAt = -1e9;                                // when an arrow key last went to a filter select

// ---- the card dialog
/** Mark the editable spots of the open card dialog (edit mode only; call after openCard). */
export function mountCard(modal, c, api = A) {
  const detail = modal.querySelector(".detail"); if (!detail) return;
  card = c; cur = null; prov = null; pal = null; offered = null;
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
  const ghost = f => `<button type="button" class="fact ghost-fact" data-inline="${f}" data-empty aria-label="Add ${f}">+ ${f}</button>`;
  const starChip = chips.find(a => hrefOf(a).startsWith("#/cards?stars="));      // stars: a slider in its place
  if (c.stars > 10) { if (starChip) starChip.dataset.tip = "Use All fields"; }
  else if (starChip) starChip.outerHTML = starsHtml(c.stars);
  else facts.insertAdjacentHTML("beforeend", ghost("stars"));
  const typeRow = detail.querySelector(":scope > div:nth-child(2) > .ctypes");     // types: the row opens the palette
  if (typeRow) {
    mark(typeRow, "types", `Click to change the types · ${IMAGE}`);
    typeRow.setAttribute("role", "group"); typeRow.setAttribute("aria-label", `Types: ${(c.types || []).map(t => t.replace(/_/g, " ")).join(", ")}. Enter to change them`);
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
  detail.querySelector(":scope > div:nth-child(2)")?.insertAdjacentHTML("afterbegin", offerHtml(fields, d.at));
}
const spot = f => A.modal.querySelector(`.detail [data-inline="${f}"]`);
function answer(restore) {
  const o = offered; offered = null;
  A.modal.querySelector(".detail .draft-offer")?.remove();
  if (!o) return;
  if (!restore) { drafts().drop(o.c.id); A.toast("Unsaved edit discarded"); return; }
  const keys = Object.keys(o.fields), [f] = keys, el = keys.length === 1 && spot(f);   // one field: its own editor, else All fields
  if (el && TEXT.includes(f)) open(el, f, o.fields[f]);
  else if (el && f === "types") openTypes(el, o.fields.types);
  else A.editor.open(o.c.id, { draft: o.fields });
}
const keep = (c, f, v) => later(() => {            // the editor's text as a draft, a moment after each key
  const t = (f === "types" ? pal?.ctl?.value : cur?.f === f && cur.c === c ? cur.ctl.value : null);
  if (t == null) return;
  if (f === "types" ? JSON.stringify(t) === JSON.stringify(v) : String(t).replace(/\r/g, "").trim() === String(v).replace(/\r/g, "").trim()) drafts()?.drop(c.id, [f]);
  else drafts()?.put(c.id, { [f]: f === "types" ? t : String(t).replace(/\r/g, "") });
});
function open(el, f, text = null) {               // text: a restored draft
  if (cur && !commit(false)) { cur?.ctl.focus(); return; }                // a refused name stays open, to shorten it
  if (pal) pal.ctl.close(true);
  if (!el.isConnected || !card) return;
  A.hideTip?.();                                   // its "Click to edit" goes with the data-tip
  const c = card, v = f === "author" ? (c.author || "") : String(A.editor.value(c, f) ?? "");
  const opts = A.editor.options(), list = f === "series" ? opts.series : f === "subseries" ? opts.subseries(c.series) : f === "author" ? opts.authors : [];
  const swap = el.tagName === "A" || el.tagName === "BUTTON";     // a link would still navigate, a button can't hold an input
  let host = el;
  if (swap) { host = document.createElement("span"); host.className = el.className; host.dataset.inline = f; el.replaceWith(host); }
  cur = { c, f, el, host, html: el.innerHTML, cls: el.className, tip: el.dataset.tip, ctl: null, v, save: keep(c, f, v) };
  if (!swap) { delete el.dataset.tip; if (el.tagName === "P") el.className = "ability"; }   // "No ability text." becomes the text box
  host.innerHTML = control(f, text ?? v, list);
  cur.ctl = host.querySelector("input, textarea");
  const save = cur.save; cur.ctl.addEventListener("input", () => save.run());
  if (text != null) save.run();
  cur.ctl.focus(); if (f !== "ability" && text == null) cur.ctl.select();
}
function cancel(refocus) {                        // Esc, or nothing changed: no draft either
  if (!cur) return;
  const { c, f, el, host, html, cls, tip, save } = cur; cur = null;
  save.cancel(); drafts()?.drop(c.id, [f]); A.hideTip?.();
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
  refresh(c, f, kbd);
  return true;
}
function refresh(c, f, kbd) {                      // the dialog again (as the form does), scrolled as it was; after a mouse action
  const scroll = A.modal.scrollTop;                // focus stays off (openCard blurs so the shortcuts work), after a key it comes back
  A.hideTip?.();
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
  const p = pal = { c, row, html, tip, temp, save: keep(c, "types", start), ctl: null };
  const done = () => { pal = null; p.save.cancel(); drafts()?.drop(c.id, ["types"]); A.hideTip?.(); };
  p.ctl = mountPalette(row, { vocab, on, first: start,
    onChange: list => { row.innerHTML = rowHtml(list, vocab); p.save.run(); },
    onSave: (list, kbd) => { done(); if (!sameTypes(list, start) && A.editor.stageField(c.id, "types", list)) refresh(c, "types", kbd); else putBack(p, kbd); },
    onCancel: kbd => { done(); putBack(p, kbd); } });
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
    e.preventDefault(); e.stopPropagation(); el.outerHTML = starsHtml(0); A.modal.querySelector(".detail .star-pick")?.focus(); return;
  }
  if (f === "name" || SLIDERS.includes(f)) return;                          // the name on double-click, rows by cell or key
  if ((f === "ability" || f === "note") && e.target.closest("a, .badge, img")) return;   // links in the text still open the card
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;                          // a chip's link still opens in a new tab
  e.preventDefault(); e.stopPropagation();
  if (f === "types") openTypes(el); else open(el, f);
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
  if (SLIDERS.includes(f) && !el.hasAttribute("data-empty")) { statKey(el, f, e); return; }
  if (e.key === "Enter" && el.tagName !== "A" && el.tagName !== "BUTTON") { e.preventDefault(); e.stopPropagation(); if (f === "types") openTypes(el); else open(el, f); }   // links and buttons click themselves
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
 *  subseries), shown only while a drag is on (body.dragging-cards). p: the rendered list's params, renderCards' r.params
 *  (with the card dialog open the list is S.listHash's, not the hash's). */
export function mountGrid(view, p, api = A) {
  const filters = view.querySelector(".browse .filters"); if (!filters) return;
  naming = null; listParams = p;
  const grid = view.querySelector(".browse .grid"), opts = api.editor.options(), b = opts.buckets;
  const series = p.get("series") || "", sel = key => filters.querySelector(`select[data-key="${key}"]`);
  if (!sel("subseries")) sel("series")?.insertAdjacentHTML("afterend", `<h3>Subseries</h3><select data-action="select-param" data-key="subseries"><option value="">All subseries</option></select>`);
  const fresh = { series: b.series.map(value => ({ value })), author: b.author.map(value => ({ value })),
    subseries: b.subseries.filter(([s]) => !series || s === series).map(([s, value]) => ({ value, series: s, where: series ? "" : s })) };
  for (const key of ["series", "subseries", "author"]) {
    const el = sel(key); if (!el) continue;
    el.insertAdjacentHTML("beforeend", bucketOptions(new Set([...el.options].map(optKey)), fresh[key], p.get(key) || "") + newOption(key, series));
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
  const { changed: n, dups, kept, value, error } = A.editor.stageMany(ids, key, v);
  A.selected.clear();
  A.rerender();
  A.toast(error || [n ? `${n} card${n === 1 ? "" : "s"}: ${key} → ${value}` : "",
    kept ? `${kept} kept ${kept === 1 ? "its" : "their"} old subseries` : "",
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
  const { sel, key, input } = naming, series = key === "subseries" ? listParams.get("series") || "" : "";
  const r = A.editor.addBucket(key, input.value, series);
  if (!r) { closeName(kbd); return; }                                        // nothing typed
  if (r.error) { A.toast(r.error); return; }                                 // the input stays, to shorten it
  closeName(kbd);
  const drops = document.querySelector(`.filters .drop-list[data-drop="${key}"]`);
  if (!r.existed) {                                // added in place, no re-render: a click that ended the typing still lands
    sel.querySelector("[data-new-bucket]")?.insertAdjacentHTML("beforebegin", bucketOptions(new Set(), [{ value: r.name, ...(series ? { series } : {}) }], ""));
    const last = drops?.querySelectorAll(".chip[data-new]"), html = dropChips([], [r.name]);
    if (last?.length) last[last.length - 1].insertAdjacentHTML("afterend", html); else drops?.insertAdjacentHTML("afterbegin", html);
  }
  A.toast(r.note || `New ${LABEL[key].toLowerCase()} “${r.name}”${series ? ` of ${series}` : ""}: ${(listParams.get("view") || localStorage.getItem("view")) === "table" ? "in Grid view, drag cards onto it" : `drag cards onto it under ${LABEL[key]}`}`);   // app.js's view choice
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

/** Once at boot, before app.js's document listeners: delegated listeners on the modal (editors) and the document (drag,
 *  the filter bar's "New …"). api = {editor, modal, selected (Set of card ids), goCard, rerender, toast, hideTip, icons
 *  (() => cards.json icons)}. */
export function install(api) {
  A = api;
  const flush = () => { cur?.save.flush(); pal?.save.flush(); };    // closing the tab: the draft now, not in a moment
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
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
