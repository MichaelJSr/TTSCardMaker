// The token picker: typing "[" in card text suggests the stoogedings icons with their pictures, and after "name:" that
// icon's variants; "(" and the start of a timing tag ("(1") suggests the tags. Typing narrows, Backspace widens. The
// helpers above `install` are pure (AutoCroissant tests/test_token_picker.py runs them in node); install wires them to
// the text fields marked data-tokens (edit.js, inline.js). The same list suggests known names in the fields marked
// data-suggest="series|subseries|author" (suggestNames), whose whole value is the query; a pick fires "suggest-pick".
import { esc, norm, tagInfo, badgeHtml, VARIANT_NAMES, variantFile } from "./text.js";

export const MAX_TOKEN = 52;                     // text.js PIECE: [thunderfury blessed blade of the starseeker:darkglow]
export const VARIANTS = ["tint", "sticker", "no", "glow", "darkglow"];   // the font's (AutoCroissant ICON_VARIANTS)
export const ROWS = 8;                           // rows shown at once; more scroll
const LIMIT = 120;                               // rows at most (91 icons, an exact one's variants)

// Every timing tag the font draws (build_stoogedings.badge_tags): the cards' own first, then the rulebook's old ones
const NUMS = [..."123456789X"], FIRSTS = ["-1", ..."0123456789", "X"];
export const TAGS = (() => {
  const now = ["OYT", "AAT", "BOT", "ENDT", "BOGT", "ENDGT", "OFS", "OS", "OD", "WOF", "Action"];
  for (const n of NUMS) now.push(`${n}CD`, `${n}GCD`, `${n}U`, `${n}PG`);
  for (const cd of ["CD", "GCD"]) for (const a of FIRSTS) for (const b of NUMS) now.push(`${a}/${b}${cd}`);
  const old = NUMS.flatMap(n => [`${n}PT`, `E${n}T`, `FTE${n}T`, `${n}PGT`, `E${n}GT`]);
  return [...now, ...old].filter(t => tagInfo(t));
})();

/** The icons as one entry each, from cards.json icons ({normalized spelling: {file, name, kind, v}}): [{name, kind,
 *  file, v, keys, uses}], keys = its other spellings (aliases), normalized; uses = its tokens in texts (the cards'). */
export function vocabulary(icons, texts = []) {
  const by = new Map();
  for (const [key, ic] of Object.entries(icons || {})) {
    if (!by.has(ic.file)) by.set(ic.file, { name: ic.name, kind: ic.kind, file: ic.file, v: ic.v || [], keys: [], uses: 0 });
    if (key !== norm(ic.name)) by.get(ic.file).keys.push(key);
  }
  for (const t of texts) for (const m of String(t || "").matchAll(/\[([^\[\]\n:]{1,52})(?::[a-z]*)?\]/gi)) {
    const ic = icons[norm(m[1])];
    if (ic) by.get(ic.file).uses++;
  }
  return [...by.values()];
}

const NAME = /^[\p{L}\p{N} _\-.'’]*$/u;          // a token's name as typed (norm drops the separators)
const TAG_TEXT = /^-?[0-9A-Za-z/]{0,6}$/;         // text.js TAG: (-1/2GCD) is the longest
const REST_ICON = /^[\p{L}\p{N} _\-.'’:]*\]/u, REST_TAG = /^[-0-9A-Za-z/]*\)/;
/** The token being typed at the caret, or null. {type: "icon", start, end, close, base, variant, tail} (variant null
 *  before a ":") or {type: "tag", start, end, close, text}; start: its "[" or "(", end: the caret, close: where a
 *  choice's text ends: the caret, or past the rest of a token the caret is inside when its "]" or ")" closes it on
 *  this line ("Heal [fi|re] now"); text after the caret that nothing closes stays ("[fi|and ice"). tail: that rest's
 *  ":variant]", kept when a plain icon is chosen. Only on the caret's line. A "(" opens a tag only when the text after
 *  it could start one and does not start in lower case: "(see below)" is words. */
export function openToken(text, caret) {
  text = String(text ?? "");
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null;
  const line = text.lastIndexOf("\n", caret - 1) + 1, before = text.slice(line, caret), after = text.slice(caret);
  const sq = before.lastIndexOf("["), pa = before.lastIndexOf("(");
  if (sq > before.lastIndexOf("]") && sq >= pa) {
    const seg = before.slice(sq + 1), colon = seg.indexOf(":");
    const base = colon < 0 ? seg : seg.slice(0, colon), variant = colon < 0 ? null : seg.slice(colon + 1);
    if (seg.length > MAX_TOKEN || !NAME.test(base) || (variant !== null && !/^[a-z]*$/i.test(variant))) return null;
    let rest = (colon < 0 ? REST_ICON : /^[a-z]*\]/i).exec(after)?.[0] ?? "";
    if (seg.length + rest.length - 1 > MAX_TOKEN) rest = "";
    const at = colon < 0 ? rest.indexOf(":") : -1;
    return { type: "icon", start: line + sq, end: caret, close: caret + rest.length, base, variant, tail: at < 0 ? "" : rest.slice(at) };
  }
  if (pa > before.lastIndexOf(")") && pa > sq) {
    const seg = before.slice(pa + 1);
    if (!seg || !TAG_TEXT.test(seg) || /^[a-z]/.test(seg)) return null;
    let rest = REST_TAG.exec(after)?.[0] ?? "";
    if (!TAG_TEXT.test(seg + rest.slice(0, -1))) rest = "";
    return { type: "tag", start: line + pa, end: caret, close: caret + rest.length, text: seg };
  }
  return null;
}

/** The fewest edits (a letter added, dropped, changed, or two swapped) from q to the start of s */
function slips(q, s) {
  let prev2 = null, prev = Array.from({ length: s.length + 1 }, (_, j) => j);
  for (let i = 1; i <= q.length; i++) {
    const row = [i];
    for (let j = 1; j <= s.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (q[i - 1] === s[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && q[i - 1] === s[j - 2] && q[i - 2] === s[j - 1]) row[j] = Math.min(row[j], prev2[j - 2] + 1);
    }
    prev2 = prev; prev = row;
  }
  return Math.min(...prev);
}

const KIND_ORDER = { type: 0, star: 1 };
/** Icons matching q (normalized): exact name or alias, then name prefix, alias prefix, then (2+ letters) inside the
 *  name, inside an alias; with none of those (3+ letters), a slip of the keys: names or aliases that start one edit
 *  away (two from 6 letters), the fewest first. Types before stars, then the most used in the cards, then by name.
 *  [{e, exact}] */
function rank(vocab, q) {
  let out = [];
  for (const e of vocab) {
    const n = norm(e.name), long = q.length > 1;
    const tier = n === q || e.keys.includes(q) ? 0 : n.startsWith(q) ? 1 : e.keys.some(k => k.startsWith(q)) ? 2
      : long && n.includes(q) ? 3 : long && e.keys.some(k => k.includes(q)) ? 4 : -1;
    if (tier >= 0) out.push({ e, tier, exact: tier === 0 });
  }
  if (!out.length && q.length > 2) {
    const most = q.length > 5 ? 2 : 1;
    for (const e of vocab) {
      const d = Math.min(...[norm(e.name), ...e.keys].map(k => slips(q, k)));
      if (d <= most) out.push({ e, tier: 5 + d, exact: false });
    }
  }
  return out.sort((a, b) => a.tier - b.tier || (KIND_ORDER[a.e.kind] ?? 2) - (KIND_ORDER[b.e.kind] ?? 2)
    || (b.e.uses || 0) - (a.e.uses || 0) || a.e.name.localeCompare(b.e.name));
}

/** A row: {token, label (its plain name), kind ("type", "star", "timing tag"), image (a picture's file; none for a
 *  tag), variant, note (what the variant does, or the tag's meaning), tag, group, old}. */
function iconItem(e, v = "") {
  return { token: `[${e.name}${v ? `:${v}` : ""}]`, label: e.name.replace(/_/g, " "), kind: e.kind, variant: v,
    note: v ? VARIANT_NAMES[v] : "", image: v && e.v.includes(v) ? variantFile(e, v) : e.file };
}
function tagItem(tag) {
  const t = tagInfo(tag);
  return { token: `(${t.tag})`, label: t.meaning, kind: "timing tag", image: "", note: "", tag: t.tag, group: t.group, old: !!t.old };
}
const variantsLike = q => [...VARIANTS.filter(v => v.startsWith(q)), ...VARIANTS.filter(v => !v.startsWith(q) && v.includes(q))];

/** Rows for an open token (openToken), best first. "[" + a name: the matching icons, an exact one followed by its
 *  variants; "[" + name + ":": the variants (of that icon when the name is exact, else of every match); "(": the tags
 *  starting with the text (any case), an exact one first, the old ones last. */
export function suggest(open, vocab) {
  if (!open) return [];
  if (open.type === "tag") {
    const up = open.text.toUpperCase(), hits = TAGS.filter(t => t.toUpperCase().startsWith(up));
    return hits.sort((a, b) => (b.toUpperCase() === up) - (a.toUpperCase() === up)).map(tagItem);
  }
  const ranked = rank(vocab || [], norm(open.base)), out = [];
  if (open.variant === null) {
    for (const r of ranked) {
      out.push(iconItem(r.e));
      if (r === ranked[0] && r.exact) out.push(...VARIANTS.map(v => iconItem(r.e, v)));
    }
  } else {
    const vs = variantsLike(open.variant.toLowerCase());
    for (const r of ranked.some(r => r.exact) ? ranked.filter(r => r.exact) : ranked) out.push(...vs.map(v => iconItem(r.e, v)));
  }
  return out.slice(0, LIMIT);
}

/** The text with the open token (start..close) replaced by a row's token, a plain icon keeping the ":variant" the
 *  caret was in front of: {text, caret (just past it), start, end (the range replaced), insert}. */
export function applyChoice(text, open, item) {
  text = String(text ?? "");
  const insert = open.tail && open.type === "icon" && !item.variant ? item.token.slice(0, -1) + open.tail : item.token;
  const before = text.slice(0, open.start), after = text.slice(open.close);
  return { text: before + insert + after, caret: open.start + insert.length, start: open.start, end: open.close, insert };
}

const words = v => String(v).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Known names for a typed q, best first: entries [{value, n (cards), note, own (the card's own series), kind, series}].
 *  Empty q: own first, then the most cards, then by name. Else: same name, prefix, a word's prefix, inside (2+ letters),
 *  then (3+ letters, nothing else) one slip (two from 6 letters); ties: own, most cards, name. At most LIMIT rows. */
export function suggestNames(q, entries) {
  q = norm(q);
  const long = q.length > 1, out = [];
  for (const e of entries || []) {
    const n = norm(e.value);
    const tier = !q || n === q ? 0 : n.startsWith(q) ? 1 : words(e.value).some(w => w.startsWith(q)) ? 2 : long && n.includes(q) ? 3 : -1;
    if (tier >= 0) out.push({ e, tier });
  }
  if (!out.length && q.length > 2) {
    const most = q.length > 5 ? 2 : 1;
    for (const e of entries || []) {
      const d = Math.min(...[norm(e.value), ...words(e.value)].map(k => slips(q, k)));
      if (d <= most) out.push({ e, tier: 4 + d });
    }
  }
  return out.sort((a, b) => a.tier - b.tier || !!b.e.own - !!a.e.own || (b.e.n || 0) - (a.e.n || 0) || a.e.value.localeCompare(b.e.value))
    .slice(0, LIMIT).map(({ e }) => ({ token: e.value, label: e.value, kind: e.kind || "", note: e.note || "", plain: true, value: e.value, series: e.series || "" }));
}

// ---- the dropdown, in the browser
const FIELD = "[data-tokens], [data-suggest]";
const LIST_LABEL = { series: "Series", subseries: "Subseries", author: "Authors" };
const COPY = ["boxSizing", "width", "height", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize",
  "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize", "wordBreak"];
let A = null;                                    // {vocab: () => vocabulary, icon: (token, opts) => html, names: el => entries}, from install
let list = null, status = null;                  // the listbox and its live count
let field = null, open = null, items = [], active = 0;
let dismissed = null;                            // {el, start}: Esc closed the picker for this token
let pressing = false;                            // a press on the list: the field's blur is not a close
let picking = false;                             // a name going in: its input event doesn't open the list again

const shown = () => !!list && !list.hidden && list.isConnected && !!field?.isConnected;
/** Where text position pos of a textarea or input is on screen: {left, top, bottom} (a mirror of the field) */
function caretBox(el, pos) {
  const cs = getComputedStyle(el), m = document.createElement("div"), area = el.tagName === "TEXTAREA";
  for (const p of COPY) m.style[p] = cs[p];
  Object.assign(m.style, { position: "fixed", visibility: "hidden", top: "0", left: "-9999px", overflow: "hidden",
    whiteSpace: area ? "pre-wrap" : "pre", overflowWrap: area ? "break-word" : "normal" });
  if (area && el.scrollHeight > el.clientHeight) m.style.overflowY = "scroll";
  m.textContent = el.value.slice(0, pos);
  const mark = document.createElement("span");
  mark.textContent = el.value.slice(pos) || ".";
  m.append(mark);
  document.body.append(m);
  const r = el.getBoundingClientRect(), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  const left = r.left + mark.offsetLeft - el.scrollLeft, top = r.top + mark.offsetTop - el.scrollTop;
  m.remove();
  const y = Math.min(Math.max(top, r.top), r.bottom - lh);   // a line scrolled out of the field: its edge
  return { left: Math.min(Math.max(left, r.left), r.right), top: y, bottom: y + lh };
}
function place() {
  if (list && !list.hidden && !field?.isConnected) { close(); return; }   // its field is gone: so is the list
  if (!shown()) return;
  const vv = window.visualViewport, top = vv ? vv.offsetTop : 0, bottom = vv ? vv.offsetTop + vv.height : innerHeight;
  const width = vv ? vv.offsetLeft + vv.width : innerWidth, at = caretBox(field, open.start);
  const below = bottom - at.bottom - 8, above = at.top - top - 8, row = list.firstElementChild?.offsetHeight || 40;
  const up = below < Math.min(list.scrollHeight, row * 3) && above > below;
  list.style.maxHeight = `${Math.max(row, Math.min(row * ROWS + 8, up ? above : below))}px`;
  const w = list.offsetWidth, h = list.offsetHeight;
  list.style.left = `${Math.max(8, Math.min(at.left - 8, width - w - 8))}px`;
  list.style.top = `${up ? at.top - h - 4 : at.bottom + 4}px`;
}
function rowHtml(it, i) {
  const pic = it.plain ? "" : it.tag ? badgeHtml(it.tag).replace(/ data-tip="[^"]*"/, "") : (A.icon(it.token.slice(1, -1), { tip: false }) || "");
  const sub = it.plain ? it.note : it.note ? `${it.label} · ${it.note}` : it.label;
  return `<li id="tok-pick-${i}" role="option" aria-selected="${i === active}" data-i="${i}"${i === active ? ' class="on"' : ""}>`
    + `<span class="tp-pic" aria-hidden="true">${pic.replace(/<img /g, '<img loading="lazy" ')}</span>`
    + `<span class="tp-text"><span class="tp-token${it.plain ? " tp-value" : ""}">${esc(it.token)}</span><span class="tp-name">${esc(sub)}</span></span>`
    + `<span class="tp-kind">${esc(it.kind)}</span></li>`;
}
function setActive(i, scroll = true) {
  if (!items.length) return;
  active = (i + items.length) % items.length;
  for (const li of list.children) { const on = +li.dataset.i === active; li.classList.toggle("on", on); li.setAttribute("aria-selected", on); }
  field.setAttribute("aria-activedescendant", `tok-pick-${active}`);
  const li = list.children[active];
  if (scroll && li) {
    if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop - 4;
    else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight + 4;
  }
}
function show(el, o, found, typed) {
  const same = field === el && open?.start === o.start && shown();
  if (field && field !== el) close();
  field = el; open = o; items = found;
  active = o.type === "name" && !o.text ? -1 : typed || !same ? 0 : Math.min(active, items.length - 1);   // an empty name: no row until an arrow
  const host = el.closest('[role="dialog"]') || document.body;   // inside an aria-modal dialog, or readers skip it
  if (list.parentNode !== host) host.append(list, status);
  list.innerHTML = items.map(rowHtml).join("");
  list.hidden = false;
  list.setAttribute("aria-label", o.type === "name" ? LIST_LABEL[el.dataset.suggest] || "Names" : o.type === "tag" ? "Timing tags" : "Icons");
  list.classList.toggle("names", o.type === "name");
  el.setAttribute("aria-expanded", "true");
  el.setAttribute("aria-controls", list.id);
  if (active < 0) { el.removeAttribute("aria-activedescendant"); list.scrollTop = 0; } else setActive(active);
  status.textContent = `${items.length} suggestion${items.length === 1 ? "" : "s"}`;
  place();
}
function close() {
  if (field) { field.setAttribute("aria-expanded", "false"); field.removeAttribute("aria-activedescendant"); field.removeAttribute("aria-controls"); }
  if (list && !list.hidden) { list.hidden = true; list.innerHTML = ""; if (status) status.textContent = ""; }
  field = null; open = null; items = [];
}
/** Look at the token at el's caret again; typed: by input (else a caret move only updates an open picker). */
function refresh(el, typed) {
  if (el.matches("[data-suggest]")) { names(el, typed); return; }
  const o = el.selectionStart === el.selectionEnd ? openToken(el.value, el.selectionStart) : null;
  if (dismissed && (dismissed.el !== el || o?.start !== dismissed.start)) dismissed = null;
  if (!o || dismissed) { if (field === el) close(); return; }
  const same = field === el && open?.start === o.start && shown();
  if (!typed && !same) { if (field === el) close(); return; }
  if (!typed && open.end === o.end) { open = o; return; }       // the caret did not move: nothing to redo
  const found = suggest(o, A.vocab());
  if (found.length) show(el, o, found, typed); else if (field === el) close();
}
function names(el, typed) {                      // a name field: its whole value is the query; a caret move changes nothing
  if (!typed) return;
  dismissed = null;                              // Esc shut it until the next key
  const found = suggestNames(el.value, A.names?.(el) || []);
  if (found.length) show(el, { type: "name", start: 0, end: el.value.length, close: el.value.length, text: el.value }, found, true);
  else if (field === el) close();
}
function accept(i) {
  const it = items[i], el = field, o = open;
  if (!it || !el) return;
  const want = applyChoice(el.value, o, it);
  close();
  el.setSelectionRange(want.start, want.end);
  picking = !!it.plain;
  let done = false;
  try { done = document.execCommand("insertText", false, want.insert) && el.value === want.text; } catch { done = false; }   // keeps undo
  if (!done) {                                   // the input event (edit.js's live preview) comes from execCommand, or here
    el.value = want.text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(want.caret, want.caret);
  picking = false;
  if (it.plain) el.dispatchEvent(new CustomEvent("suggest-pick", { bubbles: true, detail: it }));   // a name: the editor saves it
}
/** Close the list (an editor closing). */
export function dismiss() { close(); }
const stop = e => { e.preventDefault(); e.stopImmediatePropagation(); };
function onKey(e) {                              // capture: before inline.js and app.js (Esc there cancels the edit)
  if (!shown() || e.target !== field || e.isComposing || e.keyCode === 229) return;   // 229: an IME's key (Safari's commit)
  const plainKey = !e.altKey && !e.ctrlKey && !e.metaKey;
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && plainKey) { stop(e); setActive(active < 0 && e.key === "ArrowDown" ? 0 : active + (e.key === "ArrowDown" ? 1 : -1)); }
  else if ((e.key === "PageDown" || e.key === "PageUp") && plainKey) { stop(e); setActive(Math.max(0, Math.min(items.length - 1, active + (e.key === "PageDown" ? ROWS : -ROWS)))); }
  else if ((e.key === "Enter" || e.key === "Tab") && plainKey && !e.shiftKey) { if (active < 0) { close(); return; } stop(e); accept(active); }   // no row: the key goes on
  else if (e.key === "Escape") { stop(e); dismissed = { el: field, start: open.start }; close(); }   // only the picker
}

/** Once at boot. api = {vocab: () => vocabulary(icons) of the loaded data, icon: (token text, {tip}) => html or null,
 *  names: a data-suggest field => suggestNames' entries}. */
export function install(api) {
  A = api;
  list = document.createElement("ul");
  list.id = "tok-picker"; list.className = "tok-picker"; list.hidden = true;
  list.setAttribute("role", "listbox");
  status = document.createElement("div");
  status.className = "tok-status"; status.setAttribute("aria-live", "polite");
  document.body.append(list, status);
  list.addEventListener("pointerdown", () => { pressing = true; });
  list.addEventListener("mousedown", e => e.preventDefault());                    // the field keeps the focus (and its caret)
  list.addEventListener("click", e => {
    e.stopPropagation();
    pressing = false;
    const li = e.target.closest("[data-i]"), el = field;
    if (!li || !el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    accept(+li.dataset.i);
  });
  list.addEventListener("pointermove", e => { const li = e.target.closest("[data-i]"); if (li && +li.dataset.i !== active) setActive(+li.dataset.i, false); });
  for (const ev of ["pointerup", "pointercancel"]) document.addEventListener(ev, () => { setTimeout(() => { pressing = false; }); }, true);
  document.addEventListener("input", e => { if (e.target.matches?.(FIELD) && !e.isComposing && !picking) refresh(e.target, true); }, true);
  document.addEventListener("compositionend", e => { if (e.target.matches?.(FIELD)) refresh(e.target, true); }, true);
  document.addEventListener("focusin", e => { if (!e.target.matches?.(FIELD)) return;
    e.target.setAttribute("aria-autocomplete", "list");
    if (e.target.matches("[data-suggest]") && !e.target.value) refresh(e.target, true); }, true);   // an empty name field lists the names at once
  document.addEventListener("pointerdown", e => { if (shown() && !list.contains(e.target) && e.target !== field) close(); }, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", e => { if (e.target.matches?.(FIELD) && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) refresh(e.target, false); }, true);
  document.addEventListener("pointerup", e => { if (e.target.matches?.(FIELD)) setTimeout(() => refresh(e.target, false)); }, true);
  document.addEventListener("focusout", e => { if (e.target === field && !pressing) close(); }, true);
  addEventListener("resize", place);
  addEventListener("scroll", e => { if (e.target !== list) place(); }, true);
  window.visualViewport?.addEventListener("resize", place);
  window.visualViewport?.addEventListener("scroll", place);
}
