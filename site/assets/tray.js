// The pinned tray (edit mode, Cards grid): big boxes over the grid to drop cards on, pinned per browser (localStorage
// "edit-pins", never published). Drag tiles onto a box, or select tiles and press its number or tap it; staging is
// inline.js dropOn, the one path for drops. A new kind of box (Kind, Item type, a ban group…) is one KINDS entry plus
// edit.js stageMany support for its key. The helpers above `install` are pure (AutoCroissant tests/test_site_buckets.py).
import { esc } from "./text.js";
import { nameKey, NAME_MAX, renameButton } from "./edit.js";

export const PIN_KEY = "edit-pins", MAX_PINS = 9;
export const KINDS = { series: { label: "Series" }, subseries: { label: "Subseries", needsSeries: true }, author: { label: "Author" } };

export const samePin = (a, b) => a.k === b.k && nameKey(a.v) === nameKey(b.v) && nameKey(a.s || "") === nameKey(b.s || "");
/** localStorage text -> [{k, v, s?}]: known kinds, non-empty names ≤ NAME_MAX, a subseries with its series, no repeats
 *  (nameKey), ≤ MAX_PINS. */
export function readPins(text) {
  let raw = null;
  try { raw = JSON.parse(text); } catch { /* junk: no pins */ }
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!p || !Object.hasOwn(KINDS, p.k) || typeof p.v !== "string") continue;
    const v = p.v.trim(), s = typeof p.s === "string" ? p.s.trim() : "", needs = !!KINDS[p.k].needsSeries;
    if (!v || [...v].length > NAME_MAX || (needs && !s)) continue;
    const pin = needs ? { k: p.k, v, s } : { k: p.k, v };
    if (!out.some(q => samePin(q, pin))) out.push(pin);
    if (out.length === MAX_PINS) break;
  }
  return out;
}
/** -> {pins} or {error}: "Already pinned", "At most 9 pins". */
export function addPin(pins, pin) {
  if (pins.some(p => samePin(p, pin))) return { error: "Already pinned" };
  if (pins.length >= MAX_PINS) return { error: `At most ${MAX_PINS} pins` };
  return { pins: [...pins, pin] };
}
export const removePin = (pins, i) => pins.filter((_, j) => j !== i);
/** The pins after a Rename everywhere ({key, from, to, series}): the renamed value's, and a renamed series' subseries. */
export const renamedPins = (pins, { key, from, to, series = "" }) => readPins(JSON.stringify(pins.map(p =>
  p.k === key && nameKey(p.v) === nameKey(from) && (!KINDS[p.k].needsSeries || nameKey(p.s) === nameKey(series)) ? { ...p, v: to }
    : key === "series" && p.s && nameKey(p.s) === nameKey(from) ? { ...p, s: to } : p)));
/** "1".."9" -> a pin index, when that many are pinned; else null. */
export const pinOfKey = (key, pins) => (/^[1-9]$/.test(key) && +key <= pins.length ? +key - 1 : null);
/** Cards carrying each pin's value (a subseries: in its series too), in one pass. */
export function countPins(pins, cards) {
  const keys = pins.map(p => [nameKey(p.v), nameKey(p.s || "")]), n = pins.map(() => 0);
  if (!pins.length) return n;
  for (const c of cards) {
    const k = { series: nameKey(c.series), subseries: nameKey(c.subseries), author: nameKey(c.author) };
    pins.forEach((p, i) => { if (k[p.k] === keys[i][0] && (!KINDS[p.k].needsSeries || k.series === keys[i][1])) n[i]++; });
  }
  return n;
}
const cardsWord = n => (n ? `${n} card${n === 1 ? "" : "s"}` : "no cards yet");
const kindText = p => (KINDS[p.k].needsSeries ? `${KINDS[p.k].label} · ${p.s}` : KINDS[p.k].label);
/** The pin form: a kind select, a name input with the name list (tokens.js data-suggest), Pin. f = {k, v}; series: the
 *  filter bar's, for a subseries' list. */
export function formHtml(f, series = "") {
  return `<form class="pin-form" data-tray-form><select class="pin-kind" aria-label="Kind of box">${Object.entries(KINDS)
    .map(([k, d]) => `<option value="${k}"${k === f.k ? " selected" : ""}>${d.label}</option>`).join("")}</select>`
    + `<input class="pin-name" data-suggest="${f.k}" data-series="${esc(series)}" autocomplete="off" aria-label="${KINDS[f.k].label} to pin" placeholder="${f.k}" value="${esc(f.v || "")}">`
    + `<button type="submit" class="primary">Pin</button></form>`;
}
/** The tray's HTML ("" with no pins and no form): boxes data-pin/data-pin-k/-v/-s (not data-v: tip.js reads that), then + Pin or the open form.
 *  form: the open form's {k, v}; series: the filter bar's; selecting: the Select toggle is on (phones: it stays on screen). */
export function trayHtml(pins, counts, { form = null, series = "", selecting = false } = {}) {
  if (!pins.length && !form) return "";
  const box = (p, i) => {
    const n = cardsWord(counts[i] || 0), kind = kindText(p);
    return `<div class="bucket-wrap"><button type="button" class="bucket" data-action="tray-drop" data-pin="${i}" data-pin-k="${p.k}" data-pin-v="${esc(p.v)}"${p.s ? ` data-pin-s="${esc(p.s)}"` : ""}
      aria-label="${esc(`${kind} ${p.v}, ${n}. Drop cards here, or select cards and press ${i + 1}`)}"><span class="b-kind">${esc(kind)}</span>`
      + `<span class="b-value">${esc(p.v)}</span><span class="b-meta">${n}</span><span class="kbd" aria-hidden="true">${i + 1}</span></button>`
      + `<button type="button" class="ghost icon b-x" data-action="tray-unpin" data-i="${i}" aria-label="Unpin ${esc(p.v)}">✕</button>${renameButton(p.k, p.v, p.s || "", "ghost icon b-rn")}</div>`;
  };
  const tail = form ? formHtml(form, series) : pins.length < MAX_PINS ? `<button type="button" class="bucket add" data-action="tray-add">+ Pin</button>` : "";
  return `<div class="tray${selecting ? " selecting" : ""}" role="group" aria-label="Pinned boxes">${pins.map(box).join("")}${tail}</div>`;
}

// ---- in the page
let A = null;                                      // {view, editor, selected, drop, toast, cards, filterSeries}, from install
let pins = [];                                     // read once, written on change
let form = null;                                   // the open pin form: {k, v}
let selecting = false;                             // as renderCards last drew it
const save = () => { try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); } catch { /* storage full: kept for this page */ } };
/** The tray for renderCards (edit mode, Grid); sel: the Select toggle. */
export function html(sel = selecting) {
  selecting = sel;
  return trayHtml(pins, countPins(pins, A.cards()), { form, series: A.filterSeries(), selecting });
}
export const pinned = () => pins.length;
function paint(focus = false) {                    // in place: the grid isn't redrawn for a form or an unpin
  const sec = A.view.querySelector(".browse > section"); if (!sec) return;
  const old = sec.querySelector(":scope > .tray"), next = html();
  if (old) old.outerHTML = next; else if (next) sec.insertAdjacentHTML("afterbegin", next);
  sec.querySelector('.toolbar [data-action="tray-add"]')?.toggleAttribute("hidden", pins.length > 0);
  if (focus) sec.querySelector(".tray .pin-name")?.focus();
}
function drop(i) {
  const p = pins[i]; if (!p) return;
  if (!A.selected.size) { A.toast("Select cards first"); return; }
  A.drop([...A.selected], { key: p.k, value: p.v, series: p.s || "" });
}
/** app.js keydown, with cards selected: 1-9 drops them on that box; true when it took the key. */
export function dropKey(key) {
  const i = pinOfKey(key, pins); if (i === null) return false;
  drop(i); return true;
}
function closeForm() { if (!form) return; form = null; paint(); }
function submit(picked = null) {                   // picked: a suggest-pick's row (a subseries brings its series)
  const el = A.view.querySelector(".tray .pin-name"); if (!form || !el) return;
  const k = form.k, raw = el.value;
  if (!raw.trim()) { closeForm(); return; }
  let s = "";
  if (KINDS[k].needsSeries) {
    const known = [...new Set(A.editor.names(k).filter(e => nameKey(e.value) === nameKey(raw)).map(e => e.series))];
    s = picked?.series || A.filterSeries() || (known.length === 1 ? known[0] : "");
    if (!s) { A.toast("Pick a series in the filter bar first"); return; }
  }
  const r = A.editor.canonical(k, raw, s);
  if (!r) { closeForm(); return; }
  if (r.error) { A.toast(r.error); return; }
  const out = addPin(pins, s ? { k, v: r.name, s } : { k, v: r.name });
  if (out.error) { A.toast(out.error); return; }
  pins = out.pins; form = null; save(); paint();
}
export const actions = {
  "tray-add": () => { form = { k: form?.k || "series", v: "" }; paint(true); },
  "tray-unpin": el => { pins = removePin(pins, +el.dataset.i); save(); paint(); },
  "tray-drop": el => drop(+el.dataset.pin),
};
/** Once at boot, before app.js's document listeners. api = {view, editor, selected (Set), drop (inline.dropOn), toast,
 *  cards: () => S.all, filterSeries: () => the filter bar's series}. */
export function install(api) {
  A = api;
  pins = readPins(localStorage.getItem(PIN_KEY));
  document.addEventListener("submit", e => { if (e.target.matches?.("[data-tray-form]")) { e.preventDefault(); submit(); } });
  document.addEventListener("suggest-pick", e => { if (e.target.matches?.(".tray .pin-name")) submit(e.detail); });
  document.addEventListener("value-renamed", e => { pins = renamedPins(pins, e.detail); save(); });   // edit.js: before it re-renders
  document.addEventListener("input", e => { if (form && e.target.matches?.(".tray .pin-name")) form.v = e.target.value; });
  document.addEventListener("change", e => {        // the kind: the input's list follows
    if (!form || !e.target.matches?.(".tray .pin-kind")) return;
    form = { k: e.target.value, v: A.view.querySelector(".tray .pin-name")?.value || "" }; paint(true);
  });
  document.addEventListener("keydown", e => {       // before app.js: Esc closes the form, not the page's selection; Enter pins
    if (!form || !e.target.closest?.("[data-tray-form]") || e.isComposing) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeForm(); }
    else if (e.key === "Enter" && e.target.matches(".pin-name")) { e.preventDefault(); submit(); }
  });
  document.addEventListener("click", e => {         // a click away: what is typed is pinned, nothing typed cancels (inline.js's rule);
    // on click, not pointerdown: the repaint then can't move or take away what was pressed, and the click still lands
    if (!form || e.target.closest?.("[data-tray-form], .tok-picker")) return;
    if (A.view.querySelector(".tray .pin-name")?.value.trim()) submit(); else closeForm();
  }, true);
}
