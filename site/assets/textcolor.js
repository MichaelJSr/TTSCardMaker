// Text colours (Card Edits.json `colors`, owner 2026-11-07): [{field, phrase?, color}] on the name, the ability and the
// note. A phrase matches as the effect layers' rule (AutoCroissant psd_edit.color_spans): any case, any blanks between its
// words, whole words when it occurs as one, "word#n" the nth; no phrase: the whole field. Whole fields paint first, then
// phrases as listed. The name's and ability's bake into the card image; the note's are the website's alone.
// The menu (edit mode): a chip beside a selection in those fields (or the whole field, focused with none selected) opens
// a compact palette. Everything above `attach` is DOM-free (the AutoCroissant tests run it in node).
import { esc, paintHtml } from "./text.js";
export { paintHtml };

export const FIELDS = ["name", "ability", "note"];        // card_edits.COLOR_FIELDS, build_site COLOR_FIELDS
export const PRINTED = ["name", "ability"];               // the card image's (card_edits.COLOR_PRINTED)
export const COLOR = /^#[0-9a-f]{6}$/, MAX = 64, PHRASE_MAX = 200;
export const RECENT_KEY = "text-colors-recent", RECENT_MAX = 8;
const LABEL = { name: "Name", ability: "Ability", note: "Note" };
const ALNUM = /[A-Za-z0-9]/;

/** A `colors` value as card_edits.valid_colors takes it: one entry per field and phrase. */
export function validColors(v) {
  if (!Array.isArray(v) || !v.length || v.length > MAX) return false;
  const seen = new Set();
  for (const one of v) {
    if (!one || typeof one !== "object" || Object.keys(one).some(k => !["field", "phrase", "color"].includes(k))) return false;
    if (!FIELDS.includes(one.field) || typeof one.color !== "string" || !COLOR.test(one.color)) return false;
    if ("phrase" in one && !(typeof one.phrase === "string" && one.phrase.trim() === one.phrase && one.phrase.length > 0 && one.phrase.length <= PHRASE_MAX)) return false;
    const k = `${one.field}\u0000${one.phrase ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}
/** The value as the file keeps it: a valid list, else null. */
export const tidyColors = v => (validColors(v) ? v.map(one => ({ field: one.field, ...(one.phrase ? { phrase: one.phrase } : {}), color: one.color })) : null);
const ORDINAL = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
/** "'Burning'", "'Burning' (2nd)": a phrase in plain words. */
export const phraseText = p => { const [w, n] = numbered(p); return `'${w}'${n ? ` (${ORDINAL(n)})` : ""}`; };
/** "Ability: 'Burning' coloured #ff7a1a", "Name coloured #ffffff" (card_edits.color_text). */
export const colorText = one => `${LABEL[one.field] || one.field}${one.phrase ? `: ${phraseText(one.phrase)}` : ""} coloured ${one.color}`;
const keyOf = one => `${one.field}\u0000${one.phrase ?? ""}`;
/** What changed between two lists, in plain words: ["Ability: 'Burning' coloured #ff7a1a", "Name: back to its own colour"]. */
export function colorsChange(a, b) {
  const was = new Map((a || []).map(one => [keyOf(one), one])), now = new Map((b || []).map(one => [keyOf(one), one]));
  const out = [];
  for (const [k, one] of now) if (was.get(k)?.color !== one.color) out.push(colorText(one));
  for (const [k, one] of was) if (!now.has(k)) out.push(`${LABEL[one.field] || one.field}${one.phrase ? `: ${phraseText(one.phrase)}` : ""} back to its own colour`);
  return out;
}
/** The card image's colours of a list (the note's are never baked), null when none. */
export const printedOf = v => { const p = (v || []).filter(one => PRINTED.includes(one.field)); return p.length ? p : null; };

const numbered = p => { const m = /^(.*\S)#(\d+)$/.exec(p); return m ? [m[1], +m[2]] : [p, 0]; };
const edge = (text, i) => !ALNUM.test(text[i] ?? " ");
/** A phrase's words' matches in text: {found, whole} as [start, end] (psd_edit._matches). */
function matches(text, words) {
  const parts = String(words).replace(/\u0003/g, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) return { found: [], whole: [] };
  const re = new RegExp(parts.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\u0003]+"), "gi");
  const found = [], whole = [];
  for (const m of String(text).matchAll(re)) {
    const a = m.index, b = a + m[0].length;
    if (b <= a) continue;
    found.push([a, b]);
    if (edge(text, a - 1) && edge(text, b)) whole.push([a, b]);
  }
  return { found, whole };
}
/** Where one colour paints in text: [[start, end]], or null when its phrase isn't there. */
export function spansOf(text, one) {
  text = String(text ?? "");
  if (!one.phrase) return text ? [[0, text.length]] : [];
  const [words, nth] = numbered(one.phrase), { found, whole } = matches(text, words), hits = whole.length ? whole : found;
  const out = nth ? hits.slice(nth - 1, nth) : hits;
  return out.length ? out : null;
}
/** The colour runs of field's text: [{start, end, color}], in order, apart; whole fields first, then phrases as listed. */
export function colorRanges(text, colors, field) {
  text = String(text ?? "");
  const paint = new Array(text.length).fill(null);
  const mine = (colors || []).filter(one => one.field === field && COLOR.test(one.color || ""));
  for (const one of [...mine.filter(x => !x.phrase), ...mine.filter(x => x.phrase)])
    for (const [a, b] of spansOf(text, one) || []) for (let i = a; i < b; i++) paint[i] = one.color;
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (!paint[i] || /\s/.test(text[i])) continue;
    const last = out[out.length - 1];
    if (last && last.color === paint[i] && text.slice(last.end, i).trim() === "") last.end = i + 1;
    else out.push({ start: i, end: i + 1, color: paint[i] });
  }
  return out;
}
/** The phrase for a selection [start, end) of text: {phrase} (undefined: the whole field), widened to whole words and
 *  numbered when the words occur more than once ("Burning#2"); null when it holds no word or can't be named. */
export function phraseAt(text, start, end) {
  text = String(text ?? "");
  let a = Math.min(start, end), b = Math.max(start, end);
  if (a === b) return { phrase: undefined, start: 0, end: text.length };
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  while (a > 0 && ALNUM.test(text[a - 1]) && ALNUM.test(text[a])) a--;
  while (b < text.length && ALNUM.test(text[b - 1]) && ALNUM.test(text[b])) b++;
  if (b <= a) return null;
  if (text.slice(0, a).trim() === "" && text.slice(b).trim() === "") return { phrase: undefined, start: 0, end: text.length };
  const words = text.slice(a, b).split(/\s+/).filter(Boolean).join(" ");
  if (!ALNUM.test(words) || words.length > PHRASE_MAX || /#\d+$/.test(words)) return null;     // no word, or "#2" typed
  const { found, whole } = matches(text, words), hits = whole.length ? whole : found;
  const k = hits.findIndex(([s, e]) => s === a && e === b);
  if (k < 0) return null;                          // a part of a longer match: can't be named
  return { phrase: hits.length > 1 ? `${words}#${k + 1}` : words, start: a, end: b };
}
/** The list with field's phrase coloured (color null: back to its own colour, with every phrase inside the selection,
 *  and the field's every colour for the whole field); text: the field's, for what the selection covers. */
export function withColor(list, field, phrase, color, text = "") {
  let out = (list || []).filter(one => !(one.field === field && (one.phrase ?? "") === (phrase ?? "")));
  if (color == null) {
    if (!phrase) out = out.filter(one => one.field !== field);
    else {
      const sel = spansOf(text, { phrase }) || [];
      out = out.filter(one => one.field !== field || !one.phrase || !(spansOf(text, one) || []).every(([a, b]) => sel.some(([s, e]) => s <= a && b <= e)));
    }
  } else out.push({ field, ...(phrase ? { phrase } : {}), color });
  return out.slice(0, MAX).length ? out.slice(0, MAX) : null;
}
/** The colour a selection shows now: its last painter's, else null. */
export function colorAt(list, field, text, start, end) {
  const r = colorRanges(text, list, field).filter(x => x.start < Math.max(end, start + 1) && start < x.end);
  return r.length ? r[r.length - 1].color : null;
}
/** The recent colours, newest first, with c added. */
export const recentWith = (recent, c) => [c, ...(recent || []).filter(x => x !== c && COLOR.test(x))].slice(0, RECENT_MAX);
/** Unique colours from the card's details record (text layers: their runs' colours, else the first run's) and its list. */
export function cardColors(rec, list) {
  const out = [];
  const add = c => { c = String(c || "").toLowerCase(); if (COLOR.test(c) && !out.includes(c)) out.push(c); };
  for (const t of Array.isArray(rec?.text) ? rec.text : []) if (t && t.visible !== false) for (const c of Array.isArray(t.colors) ? t.colors : [t.color]) add(c);
  for (const one of list || []) add(one.color);
  return out.slice(0, 16);
}

// ---- the menu ------------------------------------------------------------------------------------------------------
const SWATCH = c => `background:${COLOR.test(c) ? c : "#000"}`;
/** The palette's markup. groups: [[title, [{color, name?}]]]; now: the selection's colour. */
export function paletteHtml(groups, now, what) {
  const sw = ({ color, name }) => `<button type="button" class="tc-sw${color === now ? " on" : ""}" data-tc="${esc(color)}" style="${SWATCH(color)}" aria-label="${esc(name ? `${name} ${color}` : color)}" title="${esc(name ? `${name} ${color}` : color)}"></button>`;
  return `<div class="tc-head"><span>${esc(what)}</span><button type="button" class="ghost tc-x" data-tc-close aria-label="Close">✕</button></div>
    ${groups.filter(([, list]) => list.length).map(([title, list, filter]) => `<div class="tc-group"><div class="tc-title">${esc(title)}${filter ? ` <input class="tc-find" type="search" placeholder="find" aria-label="Find a ${esc(title.toLowerCase())}">` : ""}</div><div class="tc-grid${filter ? " tc-many" : ""}" role="group" aria-label="${esc(title)}">${list.map(sw).join("")}</div></div>`).join("")}
    <div class="tc-foot"><label class="tc-custom">Custom <input type="color" data-tc-pick value="${COLOR.test(now || "") ? now : "#ffffff"}" aria-label="Custom colour"></label>
      <button type="button" class="ghost" data-tc-default>Default</button></div>`;
}
/** A caret's place in an input or textarea, in its box (a mirror of its text). */
function caretAt(el, pos) {
  const cs = getComputedStyle(el), div = document.createElement("div"), span = document.createElement("span");
  for (const p of ["boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "paddingTop", "paddingRight", "paddingBottom",
    "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent",
    "letterSpacing", "wordSpacing", "tabSize"]) div.style[p] = cs[p];
  Object.assign(div.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: el.tagName === "TEXTAREA" ? "pre-wrap" : "pre", overflowWrap: "break-word" });
  div.textContent = el.value.slice(0, pos); span.textContent = el.value.slice(pos, pos + 1) || "."; div.appendChild(span);
  document.body.appendChild(div);
  const out = { x: span.offsetLeft - el.scrollLeft, y: span.offsetTop - el.scrollTop, h: span.offsetHeight };
  div.remove();
  return out;
}
/**
 * The colour menu on the text controls inside root. o: {fieldOf(el) -> "name" | "ability" | "note" | null, textOf(el) ->
 * {text, at} (the field's whole text and where el's text starts in it: a box of several), list() -> the colours now,
 * apply(list, {field, phrase, color}), rec() -> the details record or null, swatches() -> [{name, color}], storage}.
 * Returns {close, destroy}.
 */
export function attach(root, o) {
  const doc = root.ownerDocument, store = o.storage ?? globalThis.localStorage;
  const chip = doc.createElement("button");
  chip.type = "button"; chip.className = "tc-chip"; chip.hidden = true; chip.setAttribute("aria-haspopup", "dialog"); chip.setAttribute("aria-expanded", "false");
  chip.innerHTML = `<span class="tc-dot"></span><span class="tc-a" aria-hidden="true">A</span>`;
  const pop = doc.createElement("div");
  pop.className = "tc-pop"; pop.hidden = true; pop.setAttribute("role", "dialog");
  let cur = null;                                    // {el, field, phrase, start, end, text}
  const recent = () => { try { const r = JSON.parse(store?.getItem(RECENT_KEY) || "[]"); return Array.isArray(r) ? r.filter(c => COLOR.test(c)) : []; } catch { return []; } };
  const what = s => (s.phrase ? phraseText(s.phrase) : `the whole ${s.field}`);
  function selection(el) {
    const field = o.fieldOf(el); if (!field) return null;
    const { text, at = 0 } = o.textOf(el) || { text: el.value }, s = el.selectionStart ?? 0, e = el.selectionEnd ?? s;
    const got = phraseAt(text, at + s, at + e);
    return got && { el, field, text, phrase: got.phrase, start: got.start, end: got.end, caret: e };
  }
  function place() {
    if (!cur || !cur.el.isConnected) { hide(); return; }
    const r = cur.el.getBoundingClientRect(), whole = !cur.phrase, w = 30, h = 22;
    let x, y;
    if (whole) { x = r.right - w - 2; y = r.top - h - 2; if (y < 4) y = r.top + 2; }
    else { const c = caretAt(cur.el, cur.caret); x = Math.min(r.left + c.x + 4, r.right - w); y = r.top + c.y - h - 2; if (y < r.top - h - 2) y = r.top - h - 2; }
    if (r.bottom < 0 || r.top > innerHeight) { chip.hidden = true; return; }
    chip.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, x))}px`; chip.style.top = `${Math.max(4, y)}px`;
    if (!pop.hidden) placePop();
  }
  function placePop() {                            // under the text box (its words stay in sight), else above it, else under the chip
    const c = chip.getBoundingClientRect(), r = cur?.el.isConnected ? cur.el.getBoundingClientRect() : c, pw = Math.min(248, innerWidth - 8);
    pop.style.width = `${pw}px`;
    const ph = pop.offsetHeight, under = r.bottom - c.bottom < 140 ? r.bottom + 4 : c.bottom + 4;
    const top = under + ph <= innerHeight - 4 ? under : Math.min(c.top, r.top) - ph - 4 >= 4 ? Math.min(c.top, r.top) - ph - 4 : Math.max(4, innerHeight - ph - 4);
    pop.style.left = `${Math.max(4, Math.min(innerWidth - pw - 4, c.left - pw + c.width))}px`;
    pop.style.top = `${top}px`;
  }
  function show(sel) {
    cur = sel;
    const now = colorAt(o.list(), sel.field, sel.text, sel.start, sel.end);
    chip.querySelector(".tc-dot").style.cssText = now ? `background:${now}` : "";
    chip.classList.toggle("set", !!now);
    chip.setAttribute("aria-label", `Text colour of ${what(sel)}`); chip.title = `Text colour of ${what(sel)}`;
    if (chip.previousElementSibling !== sel.el) sel.el.after(chip, pop);    // next in the tab order; in the control's box (inline.js's host)
    chip.hidden = false; place();
  }
  function hide() { if (!pop.hidden) return; chip.hidden = true; cur = null; }
  function update() {
    if (!pop.hidden) return;
    const el = doc.activeElement;
    if (el === chip) return;
    const sel = el && root.contains(el) && el.matches?.("input, textarea") ? selection(el) : null;
    if (sel) show(sel); else hide();
  }
  function open() {
    if (!cur) return;
    const sel = cur, now = colorAt(o.list(), sel.field, sel.text, sel.start, sel.end);
    pop.innerHTML = paletteHtml([["On this card", cardColors(o.rec?.(), o.list()).map(color => ({ color }))], ["Recent", recent().map(color => ({ color }))],
      ["Status colours", (o.swatches?.() || []).filter(x => COLOR.test(x.color)), true]], now, `Colour ${what(sel)}`);
    pop.setAttribute("aria-label", `Colour ${what(sel)}`);
    pop.hidden = false; chip.setAttribute("aria-expanded", "true"); placePop();
    (pop.querySelector(".tc-sw.on") || pop.querySelector(".tc-sw, [data-tc-pick]"))?.focus({ preventScroll: true });
  }
  function close(back = true) {
    if (pop.hidden) return;
    pop.hidden = true; chip.setAttribute("aria-expanded", "false");
    if (back && cur?.el.isConnected) { cur.el.focus({ preventScroll: true }); try { cur.el.setSelectionRange(cur.start - (o.textOf(cur.el)?.at || 0), cur.end - (o.textOf(cur.el)?.at || 0)); } catch { /* a hidden control */ } }
    update();
  }
  function choose(color) {
    const sel = cur; if (!sel) return;
    if (color) { try { store?.setItem(RECENT_KEY, JSON.stringify(recentWith(recent(), color))); } catch { /* full or blocked */ } }
    pop.hidden = true; chip.setAttribute("aria-expanded", "false"); chip.hidden = true; cur = null;
    o.apply(withColor(o.list(), sel.field, sel.phrase, color, sel.text), { field: sel.field, phrase: sel.phrase, color, el: sel.el, start: sel.start, end: sel.end });
    if (sel.el.isConnected) { sel.el.focus({ preventScroll: true }); update(); }
  }
  const keep = e => { if (e.pointerType !== "touch" || e.target === chip || chip.contains(e.target)) e.preventDefault(); };   // the control keeps its focus and selection
  chip.addEventListener("pointerdown", keep);
  chip.addEventListener("click", () => (pop.hidden ? open() : close()));
  chip.addEventListener("keydown", e => {                 // its own keys: Esc back to the text, Enter and Space open it
    e.stopPropagation();
    if (e.key === "Escape" && cur) { e.preventDefault(); if (!pop.hidden) close(); else cur.el.focus(); }
  });
  pop.addEventListener("pointerdown", e => { if (!e.target.matches?.("input")) e.preventDefault(); });
  pop.addEventListener("click", e => {
    const t = e.target.closest?.("[data-tc], [data-tc-default], [data-tc-close]");
    if (!t) return;
    if (t.matches("[data-tc-close]")) close(); else choose(t.matches("[data-tc-default]") ? null : t.dataset.tc);
  });
  pop.addEventListener("change", e => { if (e.target.matches?.("[data-tc-pick]") && COLOR.test(e.target.value)) choose(e.target.value.toLowerCase()); });
  pop.addEventListener("input", e => {
    if (!e.target.matches?.(".tc-find")) return;
    const q = e.target.value.trim().toLowerCase();
    for (const b of e.target.closest(".tc-group").querySelectorAll(".tc-sw")) b.hidden = !!q && !b.title.toLowerCase().includes(q);
  });
  pop.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    e.stopPropagation();                             // the dialog's keys (inline.js, app.js) stay out of the palette
    const sw = [...pop.querySelectorAll(".tc-sw:not([hidden])")], i = sw.indexOf(doc.activeElement);
    if (i < 0 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const row = Math.max(1, Math.round(pop.querySelector(".tc-grid").clientWidth / (sw[0].offsetWidth + 4)));
    const j = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i - row, ArrowDown: i + row, Home: 0, End: sw.length - 1 }[e.key];
    sw[Math.max(0, Math.min(sw.length - 1, j))].focus();
  });
  const away = e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== chip && !chip.contains(e.target)) close(false); };
  pop.addEventListener("focusout", e => { if (e.relatedTarget && !pop.contains(e.relatedTarget) && e.relatedTarget !== chip) close(false); });   // Tab out of it
  const onSel = () => update(), onScroll = () => place();
  doc.addEventListener("selectionchange", onSel);
  root.addEventListener("focusin", onSel);
  root.addEventListener("input", onSel);
  root.addEventListener("focusout", e => { if (e.relatedTarget !== chip && !pop.contains(e.relatedTarget)) setTimeout(update, 0); });
  doc.addEventListener("pointerdown", away, true);
  doc.addEventListener("scroll", onScroll, true);
  addEventListener("resize", onScroll);
  return {
    close: () => close(false),
    destroy() {
      doc.removeEventListener("selectionchange", onSel); doc.removeEventListener("pointerdown", away, true); doc.removeEventListener("scroll", onScroll, true);
      removeEventListener("resize", onScroll); chip.remove(); pop.remove();
    },
    owns: el => !!el && (el === chip || chip.contains(el) || pop.contains(el)),
  };
}
