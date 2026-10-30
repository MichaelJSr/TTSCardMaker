// The rulebook editor (app.js openBookEditor): one chapter's text beside its page as the site draws it (or as its TTS
// pages), the two linked (a click on the page goes to its line; the cursor brings its block into view), pictures moved
// on the page by dragging (and dragged in from the picture panel; a click gives side and size), a toolbar for
// the syntax (rulebook.js) and a card picker, pictures uploaded as WebP into site/rulebook/img, a draft kept in this
// browser until published, and Publish (Ctrl/Cmd+S): the chapter (renamed when its number changes, removed by Delete)
// and its new pictures as one commit.
import { esc } from "./text.js";

const DRAFTS = "rulebook-drafts";                  // {chapter id or "new": {source, num, base, at}}
const MAKE_SPACE = "rulebook-make-space";           // "1": a picture dropped goes into the page and what's around it makes room
const MAX_W = 1080;                                // an uploaded picture's widest (a TTS page's width)
let M = null;                                      // the open editor's state

const readDrafts = () => { try { return JSON.parse(localStorage.getItem(DRAFTS) || "{}"); } catch { return {}; } };
const writeDraft = (key, d) => { const all = readDrafts(); if (d) all[key] = d; else delete all[key]; try { localStorage.setItem(DRAFTS, JSON.stringify(all)); } catch { /* full */ } };

const NEW_TEXT = "# New chapter\n\n## SECTION\nWrite the rules here.\n";
const HELP = [
  ["# Title", "the chapter's title (its first line)"], ["## Section", "a tabbed panel, up to the next ## or ---; {.hp} {.def} {.atk} {.spd} colour the tab, {icon=fire} puts a type icon beside it"],
  ["---", "ends a section"], ["::: panel … :::", "a panel without a tab (::: panel \"Title\" gives it one); also box, small, center, stack"],
  ["::: row … :::", "what's inside side by side (\"::: row 3 1\" sets their widths); fences nest"],
  ["::: ability … :::", "a card's ability box: (OYT) badges, [fire] icons, \"1.\" a numbered bubble"],
  ["> [!kirby] text", "a mascot says it (any picture's name: eggman, sonic, kirby-sleepy…); [!eggman top] puts it on top, [!kirby right] floats it"],
  ["![what it shows](file.webp){.right width=30}", "a picture: .left / .right float it, .end puts it at the right edge, width in % of the line; dx=10 dy=-5 shift it (% of its size); in a row, anchor=bottom-left places it in its column"],
  ["![[Card name]]", "the card's picture (several on one line make a row; -> between them draws an arrow)"], ["[[Card name]]", "a link to the card"],
  ["[text]{.red}", "colours (the Colour menu): red green blue yellow orange purple grey white; .u underline, .big, .small, .caps, .nowrap (one line), .secret (hidden in the panel)"],
  ["**bold**  *italic*  ***both***", "Ctrl/Cmd+B, Ctrl/Cmd+I"], ["- item / 1. item / 1) item", "lists keep the numbers you type"], ["| a | b |", "a table (|:-:| centres; {.grid cols=-,red,green} under it)"],
  ["[“SHOPS”](#/rules/shops)", "a link to a chapter (or #/rules/stats/health for a section)"], ["=== page ===", "starts a new TTS page here (the site ignores it)"],
];

export function open(api) {
  const { id, book, line = null } = api;
  const ch = id ? book.chapters.find(c => c.id === id) : null;
  if (id && !ch) { api.toast("That chapter is gone"); return; }
  const key = ch ? ch.id : "new", draft = readDrafts()[key];
  const nextNum = String(Math.max(0, ...book.chapters.map(c => Number(c.num) || 0)) + 1).padStart(2, "0");
  const base = ch ? ch.source : NEW_TEXT;
  M = { api, ch, key, base, uploads: new Map(), source: draft?.source ?? base, num: draft?.num ?? (ch ? ch.num : nextNum), restored: !!draft && draft.source !== base, selLine: null, makeSpace: localStorage.getItem(MAKE_SPACE) === "1", targetEl: null, addAs: "pic" };
  M.hist = { list: [{ text: M.source, caret: 0, kind: "open", at: 0 }], i: 0 };
  api.modal.innerHTML = html();
  api.modal.hidden = false; document.body.style.overflow = "hidden";
  const ta = textBox();
  ta.value = M.source;
  ta.addEventListener("input", () => { M.source = ta.value; M.selLine = null; remember(M.nextKind || "type", ta.selectionStart); M.nextKind = null; saveDraft(); preview(); });
  ta.addEventListener("beforeinput", e => {            // the browser's own Undo (Edit menu): this editor's steps instead
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") { e.preventDefault(); travel(e.inputType === "historyUndo" ? -1 : 1); }
  });
  api.modal.querySelector("#rbe-num").addEventListener("input", e => { M.num = e.target.value.replace(/\D/g, "").slice(0, 2); saveDraft(); });
  api.modal.querySelector("#rbe-file").addEventListener("change", e => upload([...e.target.files]).finally(() => { e.target.value = ""; }));
  api.modal.addEventListener("click", onClick);
  api.modal.querySelector(".rbe").addEventListener("keydown", onKey, true);
  const menus = [...api.modal.querySelectorAll(".rbe-bar details")];
  for (const d of menus) d.addEventListener("toggle", () => {     // one open at a time, kept on screen
    if (!d.open) return;
    for (const o of menus) if (o !== d) o.open = false;
    const menu = d.querySelector(".rbe-menu"), room = document.documentElement.clientWidth - 8;
    menu.style.left = "0px";
    const r = menu.getBoundingClientRect();
    if (r.right > room) menu.style.left = `${Math.max(8 - d.getBoundingClientRect().left, room - r.right)}px`;
  });
  ta.addEventListener("drop", e => { const f = [...(e.dataTransfer?.files || [])].filter(x => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); upload(f); } });
  ta.addEventListener("paste", e => { const f = [...(e.clipboardData?.files || [])].filter(x => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); upload(f); } });
  ta.addEventListener("keydown", e => {                // Ctrl/Cmd+B bold, +I italic, +S publish
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase(), act = { b: () => insert("bold"), i: () => insert("italic"), s: () => publish() }[k];
    if (act) { e.preventDefault(); act(); }
  });
  for (const ev of ["click", "keyup"]) ta.addEventListener(ev, follow);
  const pane = api.modal.querySelector(".rbe-preview");
  pane.addEventListener("click", e => {               // a click on the page: its line in the text; a picture: its tools too
    if (e.target.closest(".rbe-pictools, .rbe-resize")) return;
    e.preventDefault();
    if (clickGone) return;
    const el = e.target.closest("[data-line]"), pic = PICTURE_KINDS.includes(el?.dataset.kind);
    if (el) jump(+el.dataset.line, !pic);
    if (pic) { select(el); pane.focus({ preventScroll: true }); return; }   // the keys move and size it
    M.selLine = null;
    aim(el);
  }, true);
  pane.querySelector(".rbe-pictools").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.space != null) {                     // remembered in this browser
      M.makeSpace = !M.makeSpace;
      try { localStorage.setItem(MAKE_SPACE, M.makeSpace ? "1" : "0"); } catch { /* private mode */ }
      return tools(M.selected);
    }
    if (b.dataset.untarget != null) { M.targetEl = null; return aim(null); }
    if (M.selected) toolClick(b, M.selected);
  });
  wireDrag(pane);
  const pick = api.modal.querySelector("#rbe-card");
  pick.addEventListener("keydown", e => {
    if (e.key !== "Enter" || !pick.value.trim()) return;
    e.preventDefault();
    insert(e.shiftKey ? `[[${pick.value.trim()}]]` : `![[${pick.value.trim()}]]`);
    pick.value = "";
  });
  render();
  undoState();
  if (line != null) jump(line); else ta.focus();
}

const textBox = () => M.api.modal.querySelector("#rbe-text");

// ---- undo and redo: this editor's own steps (the text and every change made on the page alike). A burst of typing, a
// run of arrow-key nudges or of size steps is one step; Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y, the ↶ ↷ buttons
function remember(kind, caret) {
  const h = M.hist, top = h.list[h.i], now = Date.now();
  if (top.text === M.source) return;
  h.list.length = h.i + 1;                             // a new step drops what was undone
  if (kind !== "edit" && top.kind === kind && now - top.at < 1200) Object.assign(top, { text: M.source, caret, at: now });
  else {
    h.list.push({ text: M.source, caret, kind, at: now });
    if (h.list.length > 300) h.list.shift();
    h.i = h.list.length - 1;
  }
  undoState();
}
function travel(d) {
  const h = M.hist, j = h.i + d;
  if (j < 0 || j >= h.list.length) return;
  const caret = (d < 0 ? h.list[h.i] : h.list[j]).caret ?? 0;   // where the step undone or redone happened
  h.i = j;
  const s = h.list[j];
  s.at = 0;                                            // the next edit is a step of its own
  const ta = textBox(), top = ta.scrollTop;
  ta.value = M.source = s.text;
  ta.scrollTop = top;
  ta.setSelectionRange(Math.min(caret, s.text.length), Math.min(caret, s.text.length));
  M.selLine = null;
  saveDraft(); render(); undoState();
}
function undoState() {
  const h = M.hist, u = M.api.modal.querySelector("#rbe-undo"), r = M.api.modal.querySelector("#rbe-redo");
  if (u) u.disabled = h.i === 0;
  if (r) r.disabled = h.i === h.list.length - 1;
}
// keys: undo and redo anywhere but the small fields; a selected picture: arrows move a placed one (Shift: 5%) or shift
// one in the flow (1%, Shift: 10% of its size), + and − size it, Delete or Backspace takes it out, Esc lets it go
function onKey(e) {
  if (!M) return;
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey, field = e.target.matches?.("input, select");
  if (mod && !field && /^[zy]$/i.test(e.key)) { e.preventDefault(); e.stopPropagation(); travel(e.key.toLowerCase() === "y" || e.shiftKey ? 1 : -1); return; }
  const el = M.selected;
  if (!el && e.key === "Escape" && M.targetEl && !e.target.closest?.("textarea, input, select")) { e.preventDefault(); e.stopPropagation(); M.targetEl = null; aim(null); return; }
  if (!el || mod || e.altKey || e.target.closest?.("textarea, input, select")) return;
  const line = +el.dataset.line, kind = el.dataset.kind, k = e.key;
  const done = () => { e.preventDefault(); e.stopPropagation(); };
  if (k === "Escape") { done(); M.selLine = null; tools(null); return; }
  if (k === "Delete" || k === "Backspace") { done(); takeOut(el, line, kind); return; }
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
  if (d && kind === "img") { done(); nudge(el, line, d[0], d[1], e.shiftKey); return; }
  if (["+", "=", "-", "_"].includes(k) && kind !== "say") { done(); resizeBy(el, line, k === "+" || k === "=" ? 1 : -1); }
}

// ---- pictures on the page. A picture is dragged anywhere: it is placed over the page at that spot ({.free x= y=
// width=}, in % of the panel it was dropped in); with Make space on it goes into the page there instead (floated left
// or right, or a line of its own, so the text and rows beside it make room; onto a row: a new column, the row making
// room). A click on a section, panel, box or row picks it: pictures dragged, dropped or added go into it. A picture
// that is a row's column stays in the row: dragged inside its column it is shifted there ({dx= dy=}), onto another
// column it swaps places (its width in "::: row 3 1" goes with it), dropped well away it leaves. Card rows and mascots
// are dragged between blocks. A click gives a picture its tools (the bar at the top of the page: the anchor grid, size,
// delete) and the keys; a picture has a resize handle. Each edit rewrites the chapter's text (one step of Undo), so the
// text stays the one source; the page is patched, not redrawn, so nothing flashes.
const REORDER_KINDS = ["cards", "say"];                // moved between blocks (HTML5 drag)
const PICTURE_KINDS = ["img", ...REORDER_KINDS];       // blocks with tools
const CONTAINERS = ["panel", "box", "stack", "small", "center", "note", "row"];   // fences a picture may be placed in
const SIDES = ["left", "right", "end", "free"];
const ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
const FLOW_GONE = ["x", "y", "dx", "dy", "anchor", "height"];   // what a picture put back into the flow loses
const PICTURE_LINE = /^(\s*)!\[([^\]]*)\]\(([^)\s]+)\)\s*(\{[^{}]*\})?\s*$/;
let drag = null;                                       // HTML5: {from, end} a block's lines, {pic, mascot} from the panel
let P = null;                                          // a picture's pointer drag or resize
let clickGone = false;                                 // the click after a drag is not a click
// the whole text replaced as one step; caret: the cursor's offset; sel: the line whose block is selected afterwards
function setText(text, caret, sel = null, kind = "edit") {
  const ta = textBox();
  M.selLine = sel;
  if (text !== M.source) {
    const top = ta.scrollTop;
    ta.value = M.source = text;
    ta.scrollTop = top;
    remember(kind, caret ?? 0);
    saveDraft();
  }
  if (caret != null) ta.setSelectionRange(caret, caret);
  render();
}
const offsetOf = (lines, n) => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
// the source lines a moved block takes: a picture or a card row its line, a callout its "> " lines
function extent(lines, from, kind) {
  if (kind !== "say") return [from, from + 1];
  let end = from + 1;
  while (end < lines.length && /^>/.test(lines[end])) end++;
  return [from, end];
}
const page = () => M.api.modal.querySelector("#rbe-page");
const isContainer = n => n.dataset?.kind === "section" || (n.dataset?.kind === "fence" && CONTAINERS.includes(n.dataset.fence));
const boxOf = el => (el === page() ? el : el.querySelector(":scope > .rb-panel") || el);   // where % are measured
// the containers' boxes (measured once per drag, again after a scroll)
function boxes(skip = null) {
  return [...page().querySelectorAll("[data-kind]")].filter(n => isContainer(n) && !skip?.contains(n)).map(n => ({ n, r: boxOf(n).getBoundingClientRect() }));
}
// the container a point lands in: the innermost one around it, else the nearest by height, else the chapter
function anchorAt(x, y, skip = null, list = boxes(skip)) {
  let inner = null, near = null, dist = Infinity;
  for (const b of list) {
    const { r } = b;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { if (!inner || r.width * r.height < inner.r.width * inner.r.height) inner = b; continue; }
    const d = y < r.top ? r.top - y : y - r.bottom;
    if (d < dist && x >= r.left - 40 && x <= r.right + 40) { near = b; dist = d; }
  }
  return (inner || near)?.n || page();
}
// the source line a picture placed in a container goes on: a section's end, before a fence's close, after the title
function lineFor(anchor, lines) {
  if (anchor === page()) { const h = lines.findIndex(l => /^#\s/.test(l)); return h + 1; }
  return anchor.dataset.kind === "section" ? +anchor.dataset.end : +anchor.dataset.close;
}
const round = v => Math.round(v * 2) / 2;               // widths: to 0.5%
const pos = v => Math.min(150, Math.max(-50, Math.round(v * 10) / 10));   // places: to 0.1%, within the stretch allowed
// a block that is a row's column: {row, cols, index}
function colOf(el) {
  const col = el?.parentElement, row = col?.parentElement;
  if (!col?.classList.contains("rb-col") || row?.dataset.fence !== "row" || col.firstElementChild !== el) return null;
  const cols = [...row.children].filter(c => c.classList.contains("rb-col"));
  return { row, cols, index: cols.indexOf(col) };
}
// a row's widths ("::: row 3 1", 1 for a column without one) changed by fn; even widths or one column: none written;
// a row without widths gets some only when asked (all)
const ROW_HEAD = /^(\s*:{3,}\s*row\b)([\d.\s:]*?)(\s*(?:["{].*)?)$/i;
function ratios(lines, rowLine, n, fn, all = false) {
  const m = ROW_HEAD.exec(lines[rowLine] || "");
  if (!m) return;
  const w = m[2].split(/[\s:]+/).map(Number).filter(v => v > 0);
  if (!w.length && !all) return;
  while (w.length < n) w.push(1);
  fn(w);
  lines[rowLine] = `${m[1]}${w.every(v => v === 1) ? "" : ` ${w.join(" ")}`}${m[3]}`;
}
// a picture placed at (x, y) (its top left, screen px) and w px wide: from its old line (moved; col: the row column it
// was) or new (alt, src). % of the container's inside (where CSS measures them), so it lands where it was dropped
function placeAt({ from = null, alt = "", src, col = null }, x, y, w, skip = null, into = null) {
  const lines = M.source.split("\n"), anchor = into || anchorAt(x + 8, y + 8, skip), box = boxOf(anchor), r = box.getBoundingClientRect();
  const left = r.left + box.clientLeft, top = r.top + box.clientTop, W = box.clientWidth || 1, H = box.clientHeight || 1;
  if (into && into === M.targetEl) {                   // the picked container: kept inside it
    x = Math.min(Math.max(x, left), left + Math.max(0, W - w));
    y = Math.min(Math.max(y, top), top + Math.max(0, H - 24));
  }
  let attrs = { cls: [] }, at = lineFor(anchor, lines);
  if (from != null) {
    const m = PICTURE_LINE.exec(lines[from] || "");
    if (!m) return render();
    [alt, src] = [m[2], m[3]];
    attrs = M.api.RB.splitAttrs(m[4] || "").attrs;
    lines.splice(from, 1);
    if (col) ratios(lines, +col.row.dataset.line, col.cols.length, v => v.splice(col.index, 1));
    if (at > from) at--;
  }
  attrs.cls = [...attrs.cls.filter(c => !SIDES.includes(c)), "free"];
  delete attrs.dx; delete attrs.dy; delete attrs.anchor;
  attrs.x = String(pos(((x - left) / W) * 100));
  attrs.y = String(pos(((y - top) / H) * 100));
  attrs.width = String(Math.min(100, Math.max(3, round((w / W) * 100))));
  delete attrs.height;
  lines.splice(at, 0, `![${alt}](${src}) ${M.api.RB.attrsText(attrs)}`);
  setText(lines.join("\n"), offsetOf(lines, at), at);
  settle(at, x, y);
}
// after the redraw its container may be taller or shorter (the picture left that container's flow): its place measured
// again so it stays where it was dropped (the same Undo step)
function settle(line, x, y) {
  const f = page().querySelector(`[data-line="${line}"]`), box = f?.offsetParent;
  if (!box) return;
  const r = f.getBoundingClientRect(), lines = M.source.split("\n"), m = PICTURE_LINE.exec(lines[line] || "");
  if (!m || (Math.abs(r.left - x) < 1.5 && Math.abs(r.top - y) < 1.5)) return;
  const b = box.getBoundingClientRect(), a = M.api.RB.splitAttrs(m[4] || "").attrs;
  a.x = String(pos(((x - b.left - box.clientLeft) / (box.clientWidth || 1)) * 100));
  a.y = String(pos(((y - b.top - box.clientTop) / (box.clientHeight || 1)) * 100));
  lines[line] = `${m[1]}![${m[2]}](${m[3]}) ${M.api.RB.attrsText(a)}`;
  const text = lines.join("\n"), ta = textBox(), top = ta.scrollTop, caret = ta.selectionStart;
  if (text === M.source) return;
  ta.value = M.source = M.hist.list[M.hist.i].text = text;
  ta.scrollTop = top; ta.setSelectionRange(caret, caret);
  saveDraft(); render();
}
const colsOf = row => [...row.children].filter(c => c.classList.contains("rb-col"));
const slotAt = (cols, x) => { const k = cols.findIndex(c => { const r = c.getBoundingClientRect(); return x < r.left + r.width / 2; }); return k < 0 ? cols.length : k; };
// a row's picture stays in its row unless dropped well above or below it (its height may be the row's)
const inRow = (p, x, y) => { const r = p.col.row.getBoundingClientRect(), m = Math.max(80, p.rect.height * 0.3); return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - m && y <= r.bottom + m; };
// the innermost section, panel, box or row around a point, else the chapter
function containerAt(x, y, skip = null) {
  let inner = null;
  for (const b of boxes(skip)) { const r = b.r; if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && (!inner || r.width * r.height < inner.r.width * inner.r.height)) inner = b; }
  return inner?.n || page();
}
// where in a container's flow a picture goes (Make space): before or after the block nearest the point; an empty
// container: its top or its end
function flowSpot(into, y, skip = null) {
  const box = boxOf(into), lines = M.source.split("\n");
  let best = null, dist = Infinity;
  for (const n of box.children) {
    if (n.dataset?.line == null || n.classList.contains("rb-free") || skip?.contains(n)) continue;
    const r = n.getBoundingClientRect(), d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < dist) { best = n; dist = d; }
  }
  if (!best) { const r = box.getBoundingClientRect(), top = into !== page() && y < r.top + r.height / 2; return { line: top ? +into.dataset.line + 1 : lineFor(into, lines), y: top ? r.top : r.bottom, x: r.left, w: r.width }; }
  const r = best.getBoundingClientRect(), before = y < r.top + r.height / 2;
  return { line: before ? +best.dataset.line : +best.dataset.end, y: before ? r.top : r.bottom, x: r.left, w: r.width };
}
// what a drop at (x, y) does (d: the dragged picture, if any: fig, col, rect): shifted in its column, moved in its row,
// a new column of a row or into the flow (Make space), or placed over the page; into the picked container when there is one
function plan(x, y, d = {}) {
  const t = M.targetEl;
  if (d.col && (!t || t === d.col.row) && inRow(d, x, y)) { const slot = slotAt(d.col.cols, x); return { kind: slot === d.col.index || slot === d.col.index + 1 ? "shift" : "reorder", slot }; }
  let into = t || (M.makeSpace ? containerAt(x, y, d.fig) : anchorAt(x + 8, y + 8, d.fig, d.boxes));
  if (!M.makeSpace) return { kind: "place", into };
  if (!t) into = into.closest?.('[data-fence="row"]') || into;   // anywhere over a row: a new column (a box in it: pick the box)
  if (into.dataset?.fence === "row") { const cols = colsOf(into); return { kind: "column", into, cols, slot: slotAt(cols, x) }; }
  return { kind: "flow", into, ...flowSpot(into, y, d.fig) };
}
const sideAt = (into, cx) => { const b = boxOf(into).getBoundingClientRect(), rel = (cx - b.left) / (b.width || 1); return rel < 1 / 3 ? "left" : rel > 2 / 3 ? "right" : ""; };
function nameOf(c) {                                   // a container for the bar and the label
  if (!c || c === page()) return "the chapter";
  const tab = c.querySelector(":scope > .rb-tab")?.textContent.trim();
  return tab ? `“${tab}”` : `the ${c.dataset.fence || "section"}`;
}
// the dragged or new picture put where a plan says (pic: {from, col} a moved one, else {alt, src}; x, y its top left)
function drop(pic, pl, x, y, w, skip = null) {
  if (pl.kind === "place") return placeAt(pic, x, y, w, skip, pl.into);
  const lines = M.source.split("\n");
  let { from = null, alt = "", src, col = null } = pic, attrs = { cls: [] };
  let at = pl.kind === "column" ? (pl.slot < pl.cols.length ? +pl.cols[pl.slot].firstElementChild.dataset.line : +pl.into.dataset.close) : pl.line;
  let head = pl.kind === "column" ? +pl.into.dataset.line : -1;
  if (from != null) {
    const m = PICTURE_LINE.exec(lines[from] || "");
    if (!m) return render();
    [alt, src] = [m[2], m[3]];
    attrs = M.api.RB.splitAttrs(m[4] || "").attrs;
    if (col) ratios(lines, +col.row.dataset.line, col.cols.length, v => v.splice(col.index, 1));
    lines.splice(from, 1);
    if (at > from) at--;
    if (head > from) head--;
  }
  attrs.cls = attrs.cls.filter(c => !SIDES.includes(c));
  for (const k of FLOW_GONE) delete attrs[k];
  if (pl.kind === "column") {                          // a new column as wide as the picture; the row makes room
    const avail = pl.cols.reduce((sum, c) => sum + c.getBoundingClientRect().width, 0), want = Math.min(avail * 0.5, Math.max(avail * 0.1, w));
    ratios(lines, head, pl.cols.length, v => { const sum = v.reduce((a, b) => a + b, 0); v.splice(pl.slot, 0, Math.max(0.05, +((want * sum) / (avail - want)).toFixed(2))); }, true);
    attrs.width = "100";
  } else {                                             // into the flow: floated by the side it was dropped on
    const side = sideAt(pl.into, x + w / 2);
    if (side) attrs.cls.push(side);
    attrs.width = String(Math.min(100, Math.max(3, round((w / (boxOf(pl.into).clientWidth || 1)) * 100))));
  }
  lines.splice(at, 0, `![${alt}](${src}) ${M.api.RB.attrsText(attrs)}`);
  setText(lines.join("\n"), offsetOf(lines, at), at);
}
// a row's column moved to another place in the row (slot: before that column; the count: after the last)
function moveInRow(p) {
  const { row, cols, index } = p.col, slot = p.slot;
  const lines = M.source.split("\n");
  let at = slot < cols.length ? +cols[slot].firstElementChild.dataset.line : +row.dataset.close;
  const [moved] = lines.splice(p.line, 1);
  if (at > p.line) at--;
  lines.splice(at, 0, moved);
  const to = slot > index ? slot - 1 : slot;
  ratios(lines, +row.dataset.line, cols.length, w => w.splice(to, 0, ...w.splice(index, 1)));
  setText(lines.join("\n"), offsetOf(lines, at), at);
}
// a picture in the flow shifted so its top left is at (x, y): dx, dy in % of its size (rect: where it was, shift and all)
function shiftTo(line, rect, x, y) {
  editPicture(line, a => {
    const was = k => parseFloat(a[k]) || 0, w = rect.width || 1, h = rect.height || 1;
    const dx = Math.max(-300, Math.min(300, round(was("dx") + ((x - rect.left) / w) * 100)));
    const dy = Math.max(-300, Math.min(300, round(was("dy") + ((y - rect.top) / h) * 100)));
    if (dx) a.dx = String(dx); else delete a.dx;
    if (dy) a.dy = String(dy); else delete a.dy;
  });
}
// a picture's or card row's {attrs} changed by fn (false: no change)
function editPicture(line, fn, kind = "edit") {
  const lines = M.source.split("\n"), m = /^(\s*)(.*?)(\s*\{[^{}]*\})?\s*$/.exec(lines[line] ?? ""), a = M.api.RB.splitAttrs(m[3] || "").attrs;
  if (fn(a) === false) return;
  const attrs = M.api.RB.attrsText(a);
  lines[line] = `${m[1]}${m[2]}${attrs ? ` ${attrs}` : ""}`;
  setText(lines.join("\n"), offsetOf(lines, line), line, kind);
}
function nudge(el, line, dx, dy, far) {               // a placed picture moved (% of its container), one in the flow shifted (% of its size)
  editPicture(line, a => {
    if (a.cls.includes("free")) {
      const v = (k, d) => String(pos((parseFloat(a[k]) || 0) + d * (far ? 5 : 0.5)));
      a.x = v("x", dx); a.y = v("y", dy);
      return;
    }
    for (const [k, d] of [["dx", dx], ["dy", dy]]) {
      const v = Math.max(-300, Math.min(300, round((parseFloat(a[k]) || 0) + d * (far ? 10 : 1))));
      if (v) a[k] = String(v); else delete a[k];
    }
  }, "nudge");
}
// a row's picture sized to px with the row adjusting around it: its column takes that width (its number in "::: row"
// from the other columns' share, theirs kept) and the picture fills its column
function sizeColumn(el, line, px) {
  const col = colOf(el);
  if (!col) return;
  const avail = col.cols.reduce((sum, c) => sum + c.getBoundingClientRect().width, 0), want = Math.min(avail * 0.9, Math.max(avail * 0.1, px));
  const lines = M.source.split("\n");
  ratios(lines, +col.row.dataset.line, col.cols.length, w => {
    const others = w.reduce((sum, v, i) => (i === col.index ? sum : sum + v), 0);
    w[col.index] = Math.max(0.05, +((want * others) / (avail - want)).toFixed(2));
  }, true);
  const m = /^(\s*)(.*?)(\s*\{[^{}]*\})?\s*$/.exec(lines[line] ?? ""), a = M.api.RB.splitAttrs(m[3] || "").attrs;
  a.width = "100";
  lines[line] = `${m[1]}${m[2]} ${M.api.RB.attrsText(a)}`;
  setText(lines.join("\n"), offsetOf(lines, line), line, "size");
}
const adjusts = el => M.makeSpace && el.dataset.kind === "img" && !el.classList.contains("rb-free") && colOf(el);
function resizeBy(el, line, d) {                       // 5% a step; cards: small or not; Make space: a row's picture sizes its column
  const col = adjusts(el);
  if (col) return sizeColumn(el, line, el.getBoundingClientRect().width + 0.05 * d * col.cols.reduce((sum, c) => sum + c.getBoundingClientRect().width, 0));
  editPicture(line, a => {
    if (el.dataset.kind === "cards") { a.cls = d < 0 ? [...new Set([...a.cls, "small"])] : a.cls.filter(c => c !== "small"); return; }
    const parent = (a.cls.includes("free") ? el.offsetParent : el.parentElement)?.clientWidth || 1;
    const now = /^\d+(\.\d+)?$/.test(a.width || "") ? +a.width : Math.round((el.getBoundingClientRect().width / parent) * 100);
    a.width = String(Math.min(100, Math.max(5, Math.round(now / 5) * 5 + 5 * d)));
  }, "size");
}
function takeOut(el, line, kind) {                     // a row's column takes its width with it
  const lines = M.source.split("\n"), [from, end] = extent(lines, line, kind), col = colOf(el);
  lines.splice(from, end - from);
  if (col) ratios(lines, +col.row.dataset.line, col.cols.length, w => w.splice(col.index, 1));
  setText(lines.join("\n"), offsetOf(lines, from), null);
}
function wireDrag(pane) {
  const marker = Object.assign(document.createElement("div"), { className: "rbe-drop", hidden: true });
  const colBar = Object.assign(document.createElement("div"), { className: "rbe-colbar", hidden: true });
  pane.append(marker, colBar);
  let lit = null;                                      // the container a drop would go in
  const light = el => { if (lit !== el) { lit?.classList.remove("rbe-anchor"); lit = el; el?.classList.add("rbe-anchor"); } };
  const bar = (row, cols, slot) => {                   // where a row's column would go
    if (!row) { colBar.hidden = true; return; }
    const rr = row.getBoundingClientRect(), p = pane.getBoundingClientRect(), cs = cols.map(c => c.getBoundingClientRect());
    const x = !cs.length ? rr.left : slot < cs.length ? (slot ? (cs[slot - 1].right + cs[slot].left) / 2 : cs[0].left - 6) : cs[cs.length - 1].right + 6;
    Object.assign(colBar.style, { left: `${x - p.left - 2}px`, top: `${rr.top - p.top + pane.scrollTop}px`, height: `${rr.height}px` });
    colBar.hidden = false;
  };
  const line = t => {                                  // where a picture would go into the flow
    if (!t) { marker.hidden = true; return; }
    const p = pane.getBoundingClientRect();
    Object.assign(marker.style, { top: `${t.y - p.top + pane.scrollTop - 2}px`, left: `${t.x - p.left}px`, width: `${t.w}px` });
    marker.hidden = false;
  };
  // a plan drawn: the container lit, the row's slot or the flow's line shown; its words for the label
  const show = (pl, d = {}) => {
    line(pl?.kind === "flow" ? pl : null);
    bar(pl?.kind === "reorder" ? d.col.row : pl?.kind === "column" ? pl.into : null, pl?.kind === "reorder" ? d.col.cols : pl?.cols || [], pl?.slot);
    light(!pl ? null : pl.kind === "shift" ? d.col.cols[d.col.index] : pl.kind === "reorder" ? d.col.row : pl.into);
    if (!pl) return "";
    const into = pl.into && M.targetEl ? ` into ${nameOf(pl.into)}` : "";
    return pl.kind === "shift" ? "Shift it in its column" : pl.kind === "reorder" ? "Move it here in the row"
      : pl.kind === "column" ? `Into the row here: the row makes room` : pl.kind === "flow" ? `Into the page${into}: ${({ left: "on the left", right: "on the right" })[sideAt(pl.into, d.cx)] || "on a line of its own"}, the rest makes room`
        : `Place it here${into}`;
  };
  // pictures: pointer drag anywhere (and the resize handle), drawn once a frame
  let frame = 0, last = null;
  pane.addEventListener("pointerdown", e => {
    if (M.tts || e.button !== 0) return;
    const handle = e.target.closest(".rbe-resize"), fig = handle ? M.selected : e.target.closest('[data-kind="img"]');
    if (!fig || !page().contains(fig)) return;
    e.preventDefault();
    pane.focus({ preventScroll: true });
    const r = fig.getBoundingClientRect();
    P = { fig, handle, line: +fig.dataset.line, x0: e.clientX, y0: e.clientY, gx: e.clientX - r.left, gy: e.clientY - r.top, w: r.width, rect: r, moved: false, col: handle ? null : colOf(fig) };
    try { pane.setPointerCapture(e.pointerId); } catch { /* a pointer the browser doesn't track */ }
  });
  pane.addEventListener("pointermove", e => { if (P) { last = e; frame ||= requestAnimationFrame(draw); } });
  pane.addEventListener("scroll", () => { if (P?.boxes) P.boxes = boxes(P.fig); }, { passive: true });
  function begin() {
    P.moved = true;
    if (P.handle) {                                    // resizing: the handle follows the corner and shows the width
      P.base = (P.fig.classList.contains("rb-free") ? P.fig.offsetParent : P.fig.parentElement)?.clientWidth || 1;
      const col = adjusts(P.fig);                      // Make space: its column follows, the row reflows around it
      if (col) { P.colEl = col.cols[col.index]; P.avail = col.cols.reduce((sum, c) => sum + c.getBoundingClientRect().width, 0); P.fig.style.width = "100%"; }
      return;
    }
    tools(null);
    P.boxes = boxes(P.fig);
    P.ghost = P.fig.cloneNode(true);
    Object.assign(P.ghost.style, { position: "fixed", width: `${P.w}px`, left: "0", top: "0", margin: "0", zIndex: 90, pointerEvents: "none", opacity: ".85" });
    P.ghost.className += " rbe-ghost";
    P.mode = Object.assign(document.createElement("div"), { className: "rbe-mode" });   // what a drop here does
    document.body.append(P.ghost, P.mode);
    P.fig.classList.add("rbe-moving");
  }
  function draw() {
    frame = 0;
    const e = last;
    if (!P || !e) return;
    const dx = e.clientX - P.x0, dy = e.clientY - P.y0;
    if (!P.moved) { if (Math.hypot(dx, dy) < 4) return; begin(); }
    if (P.handle && P.colEl) {
      P.px = Math.min(P.avail * 0.9, Math.max(P.avail * 0.1, P.w + dx));
      P.colEl.style.flex = `0 0 ${P.px}px`;
      const r = P.fig.getBoundingClientRect(), p = pane.getBoundingClientRect();
      Object.assign(P.handle.style, { left: `${r.right - p.left - 9}px`, top: `${r.bottom - p.top + pane.scrollTop - 9}px` });
      P.handle.dataset.size = `${Math.round((P.px / P.avail) * 100)}% of the row`;
      return;
    }
    if (P.handle) {
      const w = Math.max(20, P.w + dx);
      P.fig.style.width = `${w}px`;
      P.pct = Math.min(100, Math.max(3, round((w / P.base) * 100)));
      const r = P.fig.getBoundingClientRect(), p = pane.getBoundingClientRect();
      Object.assign(P.handle.style, { left: `${r.right - p.left - 9}px`, top: `${r.bottom - p.top + pane.scrollTop - 9}px` });
      P.handle.dataset.size = `${P.pct}%`;
      return;
    }
    const x = e.clientX - P.gx, y = e.clientY - P.gy;
    P.ghost.style.transform = `translate(${x}px, ${y}px)`;
    P.cx = x + P.w / 2;
    const pl = plan(e.clientX, e.clientY, P);
    P.mode.textContent = show(pl, P) + (P.col && pl.kind !== "shift" && pl.kind !== "reorder" ? " (out of the row)" : "");
    P.mode.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`;
  }
  const end = e => {
    if (!P) return;
    cancelAnimationFrame(frame); frame = 0; last = null;
    const p = P; P = null;
    p.ghost?.remove(); p.mode?.remove(); p.fig.classList.remove("rbe-moving"); show(null);
    if (!p.moved) return;                              // a click: the click handler gives its tools
    clickGone = true; setTimeout(() => { clickGone = false; }, 0);
    if (e.type === "pointercancel") { M.selLine = null; return render(); }
    if (p.handle) return p.colEl ? sizeColumn(p.fig, p.line, p.px) : editPicture(p.line, a => { a.width = String(p.pct); });
    const x = e.clientX - p.gx, y = e.clientY - p.gy, pl = plan(e.clientX, e.clientY, p);
    if (pl.kind === "shift") return shiftTo(p.line, p.rect, x, y);
    if (pl.kind === "reorder") { p.slot = pl.slot; return moveInRow(p); }
    drop({ from: p.line, col: p.col }, pl, x, y, p.w, p.fig);
  };
  pane.addEventListener("pointerup", end);
  pane.addEventListener("pointercancel", end);
  // card rows and mascots between blocks; pictures from the panel and from the computer placed where dropped
  const target = e => {                                // the block the pointer is over and the side it is on
    const el = e.target.closest?.("[data-line]");
    if (!el || !pane.contains(el) || (drag?.el && (drag.el === el || drag.el.contains(el)))) return null;
    const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    return { el, after, line: after ? +el.dataset.end : +el.dataset.line, y: after ? r.bottom : r.top, x: r.left, w: r.width };
  };
  pane.addEventListener("dragstart", e => {
    const el = e.target.closest?.("[data-line]");
    if (!el || !REORDER_KINDS.includes(el.dataset.kind)) return;
    const lines = M.source.split("\n"), [from, end] = extent(lines, +el.dataset.line, el.dataset.kind);
    drag = { el, from, end, boxes: boxes() };
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", lines.slice(from, end).join("\n"));
    tools(null);
  });
  M.api.modal.querySelector(".rbe-pic-grid").addEventListener("dragstart", e => {   // a picture (or its mascot: Add as) from the panel
    const b = e.target.closest("[data-pic]");
    if (!b) return;
    drag = { pic: b.dataset.pic, mascot: M.addAs === "say", boxes: boxes() };
    e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", b.dataset.pic);
  });
  const files = e => !drag && [...(e.dataTransfer?.types || [])].includes("Files");   // image files from this computer
  const free = e => files(e) || (drag?.pic && !drag.mascot);
  pane.addEventListener("dragover", e => {
    if (!drag && !files(e)) return;
    e.preventDefault();
    if (free(e)) { show(plan(e.clientX, e.clientY, { boxes: drag?.boxes }), { cx: e.clientX }); return; }
    const t = target(e);
    if (!t) { marker.hidden = true; return; }
    const p = pane.getBoundingClientRect();
    Object.assign(marker.style, { top: `${t.y - p.top + pane.scrollTop - 2}px`, left: `${t.x - p.left}px`, width: `${t.w}px` });
    marker.hidden = false;
  });
  pane.addEventListener("dragleave", e => { if (!pane.contains(e.relatedTarget)) show(null); });
  pane.addEventListener("drop", e => {
    show(null);
    if (files(e)) { e.preventDefault(); upload([...e.dataTransfer.files], { x: e.clientX, y: e.clientY }); return; }
    if (!drag) return;
    e.preventDefault();
    if (drag.pic && !drag.mascot) {                    // where it lands, a quarter of its container wide
      const pl = plan(e.clientX, e.clientY), w = boxOf(pl.into || page()).clientWidth * 0.25;
      drop({ src: drag.pic }, pl, e.clientX - w / 2, e.clientY, w);
      drag = null; return;
    }
    const t = target(e);
    if (!t) { drag = null; return; }
    const lines = M.source.split("\n");
    let at = t.line, moved;
    if (drag.mascot) moved = [`> [!${drag.pic.replace(/\.\w+$/, "")}] Text.`];
    else {
      if (at >= drag.from && at <= drag.end) { drag = null; return; }   // dropped where it is
      moved = lines.splice(drag.from, drag.end - drag.from);
      if (at > drag.from) at -= moved.length;
    }
    while (moved.length && !moved[moved.length - 1].trim()) moved.pop();
    lines.splice(at, 0, ...moved);
    drag = null;
    setText(lines.join("\n"), offsetOf(lines, at), at);
  });
  pane.addEventListener("dragend", () => { show(null); drag = null; });
}
// the selected picture: its tools, and a picture's resize handle
function select(el) { M.selLine = PICTURE_KINDS.includes(el?.dataset.kind) ? +el.dataset.line : null; tools(M.selLine != null ? el : null); }
// the container pictures go into: the section, panel, box or row clicked (clicked again: the one around it; none outside
// any); the bar's ✕ or Esc lets it go
function aim(el) {
  const pg = page();
  let c = el;
  while (c && c !== pg && !isContainer(c)) c = c.parentElement;
  if (c && c === M.targetEl) { c = c.parentElement; while (c && c !== pg && !isContainer(c)) c = c.parentElement; }
  M.targetEl = c && c !== pg ? c : null;
  mark();
  tools(null);
}
function mark() {                                      // the picked container outlined
  for (const n of page().querySelectorAll(".rbe-target")) n.classList.remove("rbe-target");
  if (M.targetEl && !(M.targetEl.isConnected && isContainer(M.targetEl))) M.targetEl = null;
  M.targetEl?.classList.add("rbe-target");
}
// the bar at the top of the page (never over it): a selected picture's anchor grid, size and delete; else the picked
// container; Make space always
function tools(el) {
  const pane = M.api.modal.querySelector(".rbe-preview"), bar = pane.querySelector(".rbe-pictools");
  pane.querySelector(".rbe-resize")?.remove();
  M.selected?.classList.remove("rbe-selected");
  M.selected = el;
  const space = `<button type="button" class="rbe-space${M.makeSpace ? " on" : ""}" data-space aria-pressed="${M.makeSpace}" title="On: a picture dropped goes into the page there (on the left, the right or a line of its own; onto a row: a new column) and what's beside it makes room; sizing a row's picture sizes its column. Off: it is placed over the page">Make space</button>`;
  if (!el) {
    bar.classList.remove("on");
    bar.innerHTML = (M.targetEl ? `<span class="rbe-into">Pictures go into ${esc(nameOf(M.targetEl))}</span><button type="button" data-untarget title="Let it go (Esc)">✕</button><span class="muted">click inside it again for the one around it</span>`
      : `<span class="muted">Click a section, panel or row to put pictures into it · click a picture for its tools</span>`) + space;
    return;
  }
  el.classList.add("rbe-selected");
  const kind = el.dataset.kind, line = +el.dataset.line;
  bar.classList.add("on");
  bar.innerHTML = (kind === "img" ? `${grid(el, line)}<span class="sep"></span><button type="button" data-size="-2" title="Smaller (−)">−</button><button type="button" data-size="2" title="Bigger (+)">+</button>`
    : kind === "cards" ? `<button type="button" data-size="-1" title="Smaller cards">−</button><button type="button" data-size="1" title="Bigger cards">+</button>`
      : `<button type="button" data-say="top" title="The mascot above the bubble">Top</button><button type="button" data-say="" title="The mascot beside it">Side</button>`)
    + `<span class="sep"></span><button type="button" data-del title="Take it out (Delete)">Delete</button>` + (kind === "img" ? space : "");
  if (kind === "img") {                                // drag the corner to resize
    const r = el.getBoundingClientRect(), p = pane.getBoundingClientRect();
    const h = Object.assign(document.createElement("div"), { className: "rbe-resize", title: "Drag to resize" });
    Object.assign(h.style, { left: `${r.right - p.left - 9}px`, top: `${r.bottom - p.top + pane.scrollTop - 9}px` });
    pane.append(h);
  }
}
// the anchor grid: a row's picture at that spot of its column; a placed one snapped to that spot of its panel; one in
// the text floated left (the left cells), right (the right cells), on a line of its own (the middle) or in the corner
function grid(el, line) {
  const m = PICTURE_LINE.exec(M.source.split("\n")[line] || ""), a = M.api.RB.splitAttrs(m?.[4] || "").attrs;
  const free = a.cls.includes("free"), col = !free && colOf(el), say = k => k.replace("-", " ");
  const now = free ? "" : col ? a.anchor || "top" : a.cls.includes("end") ? "bottom-right" : a.cls.includes("left") ? "left" : a.cls.includes("right") ? "right" : "center";
  const tip = k => (free ? `To the ${say(k)} of its panel` : col ? `At the ${say(k)} of its column` : k === "bottom-right" ? "In the bottom right corner"
    : /left$/.test(k) ? "On the left: text flows on its right" : /right$/.test(k) ? "On the right: text flows on its left" : "On a line of its own");
  return `<span class="rbe-grid" role="group" aria-label="Anchor">${ANCHORS.map(k => `<button type="button" data-anchor="${k}" class="${k === now ? "on" : ""}" title="${tip(k)}" aria-label="${tip(k)}"></button>`).join("")}</span>`;
}
function anchorTo(el, line, k) {
  const h = /left$/.test(k) ? 0 : /right$/.test(k) ? 1 : 0.5, v = /^top/.test(k) ? 0 : /^bottom/.test(k) ? 1 : 0.5;
  editPicture(line, a => {
    if (a.cls.includes("free")) {                      // snapped to that spot of its panel
      const box = el.offsetParent, r = el.getBoundingClientRect(), W = box?.clientWidth || 1, H = box?.clientHeight || 1;
      a.x = String(pos((((W - r.width) * h) / W) * 100)); a.y = String(pos((((H - r.height) * v) / H) * 100));
      return;
    }
    delete a.dx; delete a.dy;
    a.cls = a.cls.filter(c => !SIDES.includes(c));
    if (colOf(el)) { if (k === "top") delete a.anchor; else a.anchor = k; return; }
    delete a.anchor;
    if (k === "bottom-right") a.cls.push("end"); else if (h === 0) a.cls.push("left"); else if (h === 1) a.cls.push("right");
  });
}
function toolClick(b, el) {
  const kind = el.dataset.kind, line = +el.dataset.line;
  if (b.dataset.anchor) return anchorTo(el, line, b.dataset.anchor);
  if (b.dataset.del != null) return takeOut(el, line, kind);
  if (b.dataset.size) return resizeBy(el, line, +b.dataset.size);
  const lines = M.source.split("\n");                  // a mascot: > [!name opts] text
  lines[line] = (lines[line] ?? "").replace(/^>\s*\[!([\w-]+)((?:\s+[\w-]+)*)\]/, (_, who, opts) => {
    const keep = opts.trim().split(/\s+/).filter(o => o && o !== "top");
    return `> [!${[who, ...(b.dataset.say ? [b.dataset.say] : []), ...keep].join(" ")}]`;
  });
  setText(lines.join("\n"), offsetOf(lines, line), line);
}

// the text's line n at the top of the box, the cursor at its start (focus: the text box takes the keys)
function jump(n, focus = true) {
  const ta = textBox(), at = offsetOf(ta.value.split("\n"), n);
  if (focus) ta.focus();
  ta.setSelectionRange(at, at);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, n * lh - 2 * lh);           // wrapped lines make it approximate: the caret stays in view
  follow();
}
// the block under the cursor brought into view on the page, marked a moment
let followed = null;
function follow() {
  const ta = textBox(), pane = M.api.modal.querySelector(".rbe-preview");
  if (!ta || !pane || M.tts) return;
  const n = ta.value.slice(0, ta.selectionStart).split("\n").length - 1;
  let best = null;
  for (const el of pane.querySelectorAll("[data-line]")) if (+el.dataset.line <= n && (!best || +el.dataset.line >= +best.dataset.line)) best = el;
  if (!best || best === followed) return;
  followed?.classList.remove("rbe-here");
  followed = best;
  best.classList.add("rbe-here");
  const r = best.getBoundingClientRect(), p = pane.getBoundingClientRect();
  if (r.top < p.top || r.bottom > p.bottom) pane.scrollTop += r.top - p.top - 40;
}

function html() {
  const { ch, num, restored } = M, pics = Object.keys(M.api.book.images).sort();
  return `<div class="dialog rbe" role="dialog" aria-modal="true" aria-label="Edit the rulebook">
    <header class="rbe-top"><h2>${ch ? `Edit “${esc(ch.title)}”` : "New chapter"}</h2>
      <label class="rbe-num" title="The chapter's number: the book's order">No. <input id="rbe-num" inputmode="numeric" value="${esc(num)}" maxlength="2"></label>
      <span class="rbe-state muted" id="rbe-state">${restored ? "Your unpublished draft is back." : ""}</span>
      <button type="button" class="ghost icon" id="rbe-undo" data-rbe="undo" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" disabled>↶</button>
      <button type="button" class="ghost icon" id="rbe-redo" data-rbe="redo" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo" disabled>↷</button>
      <button type="button" class="primary" data-rbe="publish">Publish</button>
      ${ch ? `<button type="button" class="ghost" data-rbe="discard" title="Back to the published text">Discard draft</button><button type="button" class="ghost danger" data-rbe="delete">Delete chapter</button>` : ""}
      <button type="button" class="ghost icon" data-rbe="close" aria-label="Close (your draft stays)">✕</button></header>
    <div class="rbe-bar" role="toolbar" aria-label="Insert">
      <button type="button" class="ghost" data-ins="section" title="A tabbed panel">Section</button>
      <button type="button" class="ghost" data-ins="panel">Panel</button><button type="button" class="ghost" data-ins="row" title="Side by side">Row</button>
      <button type="button" class="ghost" data-ins="ability" title="A card's ability box">Ability box</button>
      <input id="rbe-card" class="rbe-card" list="rbe-cards" placeholder="Card…" title="Type a card's name; Enter: its picture, Shift+Enter: a link to it" autocomplete="off">
      <datalist id="rbe-cards">${(M.api.cards?.() || []).map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      <button type="button" class="ghost" data-ins="bold"><b>B</b></button><button type="button" class="ghost" data-ins="italic"><i>I</i></button>
      <details class="rbe-colours"><summary class="ghost button" title="Colour or style the selected words">Colour</summary><div class="rbe-menu">
        <div class="rbe-swatches">${COLOUR_NAMES.map(c => `<button type="button" class="rbe-swatch rb-${c}" data-colour="${c}">${c[0].toUpperCase() + c.slice(1)}</button>`).join("")}</div>
        <div class="rbe-swatches">${STYLES.map(([c, label, tip]) => `<button type="button" class="ghost rb-${c}" data-colour="${c}" title="${esc(tip)}">${label}</button>`).join("")}<button type="button" class="ghost" data-colour="" title="Colours and styles taken off">Plain</button></div>
        <p class="muted">Select words in the text (or put the cursor in coloured words), then pick. The same colour again takes it off; styles add to a colour.</p></div></details>
      <button type="button" class="ghost" data-ins="page" title="Start a new TTS page here">TTS page break</button>
      <label class="ghost button" title="Add pictures from this computer (or drop image files on the page or the text, or paste one)">Add picture<input id="rbe-file" type="file" accept="image/*" multiple hidden></label>
      <details class="rbe-pics"><summary class="ghost button">Pictures and mascots</summary><div class="rbe-menu">
        <div class="rbe-addas" role="group" aria-label="Add as">Add as <button type="button" class="on" data-addas="pic">Picture</button><button type="button" data-addas="say" title="The mascot says something (&gt; [!name])">Mascot says</button></div><div class="rbe-pic-grid">${pics.map(p => `<button type="button" class="ghost" data-pic="${esc(p)}" title="${esc(p)}" draggable="true"><img src="${esc(M.api.ctx().imgUrl(p))}" alt="" loading="lazy"><span>${esc(p.replace(/\.\w+$/, ""))}</span></button>`).join("")}</div>
        <p class="muted">Click: added under the cursor's paragraph (or into the picked section or row), ready to drag; or drag one onto the page.</p></div></details>
      <button type="button" class="ghost" data-rbe="tts" aria-pressed="false" title="Show the chapter as its TTS pages (1080x1920)">TTS pages</button>
      <details class="rbe-help"><summary class="ghost button">Syntax</summary><div class="rbe-menu"><table class="help-table">${HELP.map(([k, d]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(d)}</td></tr>`).join("")}</table>
        <p class="muted">Card text works as on cards: (OYT) badges, [fire] icons (type "[" or "(" for the picker); card names link only as [[Card]].
        Click anything on the page to go to its line. Drag a picture anywhere on the page to place it over the page there; with Make space on (in
        the bar) it goes into the page instead and the text and rows beside it make room (onto a row: a new column). Click a section, panel or row
        first to put pictures into it. A row's picture stays in its row: drag it inside its column to shift it, onto another column to swap them;
        dropped well above or below the row it leaves (the label beside the pointer says what a drop does). Drag a picture's corner to resize (Make
        space: a row's picture takes its column with it). Click a picture for its tools: the anchor grid puts it in a corner, on an edge or in the
        middle (of its column in a row, of its panel when placed; in the text: left, right or a line of its own); arrow keys move it (Shift:
        further), + and − size it, Delete takes it out, Esc lets it go. Rows of cards and mascots drag between blocks. ↶ ↷ (Ctrl/Cmd+Z,
        Ctrl/Cmd+Shift+Z) undo and redo everything. Your draft is kept in this browser until you publish (Ctrl/Cmd+S).</p></div></details>
    </div>
    <div class="rbe-cols"><textarea id="rbe-text" spellcheck="true" data-tokens aria-label="The chapter's text"></textarea>
      <div class="rbe-preview" tabindex="-1"><div class="rbe-pictools" role="toolbar" aria-label="The selected picture"></div><div class="rb rb-book"><article class="rb-chapter" id="rbe-page"></article></div><div class="rbe-sheets" hidden></div></div></div></div>`;
}

// the page drawn again: patched in place (morph), so unchanged pictures stay and nothing flashes; typing waits a moment
let timer = 0;
function preview() { clearTimeout(timer); timer = setTimeout(render, 120); }
function render() {
  clearTimeout(timer);
  if (!M) return;
  const { api } = M, page = api.modal.querySelector("#rbe-page"), sheets = api.modal.querySelector(".rbe-sheets");
  if (!page) return;
  const base = api.ctx();
  const ctx = { ...base, lines: true, eager: true, imgUrl: f => { const up = [...M.uploads.keys()].find(k => k === f || k.replace(/\.\w+$/, "") === f); return up ? M.uploads.get(up).url : base.imgUrl(f); },
    size: f => (M.uploads.get(f)?.size || base.size(f)) };
  const chapter = { id: M.ch ? M.ch.id : "new", num: M.num, title: "", source: M.source };
  page.parentElement.hidden = !!M.tts; sheets.hidden = !M.tts;
  if (M.tts) {                                         // its TTS pages, cut as Card sync's export cuts them (pictures still loading: approximate)
    sheets.className = "rbe-sheets";
    api.RB.paginate(sheets, [chapter], { ...ctx, lines: false });
    sheets.className = "rbe-sheets rb-sheets";
    tools(null);
    return;
  }
  morph(page, api.RB.chapterHtml(chapter, ctx));
  for (const el of page.querySelectorAll("[data-line]")) if (REORDER_KINDS.includes(el.dataset.kind)) el.draggable = true;
  for (const im of page.querySelectorAll("img")) im.draggable = false;   // the block moves, not the image file
  M.selected = null;
  mark();
  const sel = M.selLine != null ? page.querySelector(`[data-line="${M.selLine}"]`) : null;
  tools(sel && PICTURE_KINDS.includes(sel.dataset.kind) ? sel : null);
  if (sel) {                                           // in view (a picture just added below the fold)
    const pane = page.closest(".rbe-preview"), r = sel.getBoundingClientRect(), p = pane.getBoundingClientRect();
    if (r.bottom < p.top + 40 || r.top > p.bottom - 40) pane.scrollTop += r.top - p.top - p.height / 3;
  }
  followed = null;
  if (!sel) follow();                                  // the cursor's block in view again
}
// root's children made like html's: nodes kept where they match (tag; an image also its src), so pictures don't reload
const same = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.nodeName === b.nodeName && (a.nodeName !== "IMG" || a.getAttribute("src") === b.getAttribute("src"))));
function morph(root, html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  patchKids(root, t.content);
}
function patchKids(el, src) {
  let a = el.firstChild, b = src.firstChild;
  while (b) {
    const next = b.nextSibling;
    if (a && same(a, b)) { patch(a, b); a = a.nextSibling; }
    else if (a?.nextSibling && same(a.nextSibling, b)) { const gone = a; a = a.nextSibling; gone.remove(); patch(a, b); a = a.nextSibling; }   // one taken out
    else if (a && next && same(a, next)) el.insertBefore(b, a);   // one put in
    else if (a) { el.replaceChild(b, a); a = b.nextSibling; }
    else el.appendChild(b);
    b = next;
  }
  while (a) { const n = a.nextSibling; a.remove(); a = n; }
}
function patch(a, b) {
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of b.attributes) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  patchKids(a, b);
}

function saveDraft() {
  const same = M.source === M.base && (!M.ch || M.num === M.ch.num);
  writeDraft(M.key, same ? null : { source: M.source, num: M.num, at: Date.now() });
  const st = M.api.modal.querySelector("#rbe-state"); if (st) st.textContent = same ? "" : "Draft kept in this browser.";
}

// the Colour menu: the selected words (or the [words]{.colour} the cursor is in) given a colour, or a style added or taken
// off; Plain: back to plain words. The words stay selected, so another pick changes them
const COLOUR_NAMES = ["red", "green", "blue", "yellow", "orange", "purple", "grey", "white"];
const STYLES = [["u", "Underline", "Underlined"], ["big", "Big", "Bigger letters"], ["small", "Small", "Smaller letters"], ["caps", "Caps", "In capitals"],
  ["nowrap", "One line", "Never broken across lines"], ["secret", "Secret", "In the panel's colour: hidden until selected"]];
const SPAN = /\[([^[\]\n]*)\]\{([^{}\n]*)\}/g;
function colour(name) {
  const ta = textBox(), v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
  const hit = [...v.matchAll(SPAN)].find(m => m.index <= a && m.index + m[0].length >= b);
  const start = hit ? hit.index : a, end = hit ? hit.index + hit[0].length : b, words = hit ? hit[1] : v.slice(a, b) || "text";
  const attrs = hit ? M.api.RB.splitAttrs(`{${hit[2]}}`).attrs : { cls: [] };
  let cls = attrs.cls;
  if (!name) cls = [];
  else if (cls.includes(name)) cls = cls.filter(c => c !== name);
  else cls = [...cls.filter(c => !(COLOUR_NAMES.includes(name) && COLOUR_NAMES.includes(c))), name];   // one colour at a time
  attrs.cls = cls;
  const tail = M.api.RB.attrsText(attrs);
  ta.setRangeText(tail ? `[${words}]${tail}` : words, start, end, "end");
  const at = start + (tail ? 1 : 0);
  ta.focus(); ta.setSelectionRange(at, at + words.length);
  M.nextKind = "edit"; ta.dispatchEvent(new Event("input"));
}

// a picture or a mascot from the panel (or from this computer) as a block of its own, so it is a picture to drag, not
// an icon in the words: on the cursor's line when that is empty, else after the paragraph, list, table or callout the
// cursor is in; selected on the page
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)]|[A-Za-z][.)])\s/, BLOCK_START = /^(?::::|#{1,6}\s|>|---|===|!\[|\|)/;
function insertBlock(text) {
  const t = M.targetEl;
  if (t && text.startsWith("![")) {                    // into the picked container: a row's new column, else at its end
    const src = PICTURE_LINE.exec(text)?.[3], box = boxOf(t), w = box.clientWidth * 0.25, cols = t.dataset.fence === "row" ? colsOf(t) : null;
    return drop({ src }, cols ? { kind: "column", into: t, cols, slot: cols.length } : { kind: "flow", into: t, line: lineFor(t, M.source.split("\n")) }, box.getBoundingClientRect().left + box.clientWidth / 2 - w / 2, 0, w);
  }
  const ta = textBox(), lines = ta.value.split("\n"), n = ta.value.slice(0, ta.selectionStart).split("\n").length - 1, here = lines[n] ?? "";
  let at = n;
  if (here.trim()) {
    const t = here.trim(), more = t.startsWith(">") ? l => l.startsWith(">") : t.startsWith("|") ? l => /^(\||\{[^{}]*\}$)/.test(l)
      : LIST_LINE.test(here) ? l => LIST_LINE.test(l) || /^\s{2,}\S/.test(l) : BLOCK_START.test(t) ? () => false : l => !BLOCK_START.test(l) && !LIST_LINE.test(l);
    for (at = n + 1; at < lines.length && lines[at].trim() && more(LIST_LINE.test(here) ? lines[at] : lines[at].trim()); at++);
    lines.splice(at, 0, text);
  } else lines[at] = text;
  setText(lines.join("\n"), offsetOf(lines, at) + text.length, at);
}

// toolbar: what each button puts in (around the selection when it has one)
const SNIPPET = {
  section: () => "\n## SECTION\n", panel: () => "\n::: panel\n\n:::\n", row: () => "\n::: row\n![](picture.webp)\n\n::: panel\nText beside it.\n:::\n:::\n",
  ability: () => "\n::: ability\n1. (OYT) Ability text.\n:::\n", card: () => "![[Card name]]", link: () => "[[Card name]]", page: () => "\n=== page ===\n",
};
function insert(kind) {
  const ta = textBox(), a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b);
  const wrap = { bold: ["**", "**"], italic: ["*", "*"] }[kind];
  const text = wrap ? `${wrap[0]}${sel || "text"}${wrap[1]}` : SNIPPET[kind]?.() ?? kind;
  ta.setRangeText(text, a, b, wrap && !sel ? "select" : "end");
  if (wrap && !sel) ta.setSelectionRange(a + wrap[0].length, a + wrap[0].length + 4);
  ta.focus(); M.nextKind = "edit"; ta.dispatchEvent(new Event("input"));
}

function onClick(e) {
  const t = e.target.closest("[data-rbe], [data-ins], [data-pic], [data-colour], [data-addas]");
  if (!t || !M) return;
  e.preventDefault(); e.stopPropagation();
  if (t.dataset.ins) return insert(t.dataset.ins);
  if (t.dataset.colour != null) { t.closest("details").open = false; return colour(t.dataset.colour); }
  if (t.dataset.addas) { M.addAs = t.dataset.addas; for (const b of t.parentElement.querySelectorAll("button")) b.classList.toggle("on", b === t); return; }
  if (t.dataset.pic) {
    const name = t.dataset.pic, stem = name.replace(/\.\w+$/, "");
    t.closest("details").open = false;
    return insertBlock(M.addAs === "say" ? `> [!${stem}] Text.` : `![](${name})`);
  }
  const act = t.dataset.rbe;
  if (act === "undo" || act === "redo") return travel(act === "undo" ? -1 : 1);
  if (act === "tts") { M.tts = !M.tts; t.setAttribute("aria-pressed", String(M.tts)); t.classList.toggle("on", M.tts); render(); return; }
  if (act === "close") return close();
  if (act === "discard") { if (confirm("Throw away your draft of this chapter?")) { writeDraft(M.key, null); open({ ...M.api }); } return; }
  if (act === "delete") return remove();
  if (act === "publish") return publish();
}

function close() { const { api } = M; clearTimeout(timer); api.modal.removeEventListener("click", onClick); P = drag = M = null; api.closeModal(); }

// a picture: resized to MAX_W at most, WebP (PNG kept for pixel art), a name of its own in img/
// pictures added from this computer (the Add picture button, a paste, files dropped on the page or the text): resized to
// MAX_W, WebP, named after the file, put at the drop's line (else the cursor), and in the picture panel for reuse
async function upload(files, at = null) {
  for (const f of files.filter(x => x.type.startsWith("image/"))) {
    try {
      const bmp = await createImageBitmap(f), scale = Math.min(1, MAX_W / bmp.width);
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const cv = Object.assign(document.createElement("canvas"), { width: w, height: h });
      cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise(ok => cv.toBlob(ok, "image/webp", 0.86));
      const taken = new Set([...Object.keys(M.api.book.images), ...M.uploads.keys()]);
      let stem = f.name.replace(/\.\w+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "picture", name = `${stem}.webp`;
      for (let n = 2; taken.has(name); n++) name = `${stem}-${n}.webp`;
      const base64 = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
      const url = URL.createObjectURL(blob);
      M.uploads.set(name, { base64, url, size: [w, h] });
      if (!at) insertBlock(`![](${name})`);
      else {                                           // dropped on the page: put there, at most a third of its container
        const pl = plan(at.x, at.y), wide = Math.min(w, boxOf(pl.into || page()).clientWidth / 3);
        drop({ src: name }, pl, at.x, at.y, wide);
        at = { x: at.x + 24, y: at.y + 24 };           // several: fanned out
      }
      M.api.modal.querySelector(".rbe-pic-grid")?.insertAdjacentHTML("afterbegin", `<button type="button" class="ghost" data-pic="${esc(name)}" title="${esc(name)} (new)" draggable="true"><img src="${esc(url)}" alt=""><span>${esc(name.replace(/\.\w+$/, ""))}</span></button>`);
      M.api.toast(`${name} (${Math.round(blob.size / 1024)} KB) goes up with Publish`);
    } catch (err) { M.api.toast(`Couldn't read ${f.name} (${err.message})`); }
  }
}

const slugify = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const DIR = "site/rulebook/";

async function publish() {
  const { api, ch } = M, ast = api.RB.parse(M.source), title = ast.title.trim();
  if (!title) { api.toast("The first line needs the chapter's title: # Title"); return; }
  if (!/^\d{1,2}$/.test(M.num)) { api.toast("The chapter number: 0 to 99"); return; }
  const num = M.num.padStart(2, "0"), slug = ch ? ch.id.replace(/-\d\d$/, "") : slugify(title);
  if (!slug) { api.toast("The title needs a letter or a digit"); return; }
  if (!ch && api.book.chapters.some(c => c.id === slug)) { api.toast(`A chapter named ${slug} exists: change the title`); return; }
  const file = `${num}-${slug}.md`, source = M.source.replace(/\r\n?/g, "\n").replace(/\s*$/, "\n");
  const twin = api.book.chapters.find(c => c !== ch && c.num === num);
  if (twin && !confirm(`Number ${Number(num)} is “${twin.title}” too: both will show as ${Number(num)}. Publish anyway?`)) return;
  const missing = [...source.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1]).filter(f => !api.book.images[f] && !M.uploads.has(f));
  if (missing.length && !confirm(`No picture named ${[...new Set(missing)].join(", ")}. Publish anyway?`)) return;
  const edits = { [DIR + file]: source }, startedFrom = M.base;
  if (ch && ch.file !== file) edits[DIR + ch.file] = false;   // renumbered: the old file goes
  for (const [name, u] of M.uploads) if (source.includes(name)) edits[`${DIR}img/${name}`] = { base64: u.base64 };
  if (!api.editor.me) { api.toast("Sign in first"); return; }
  const btn = api.modal.querySelector('[data-rbe="publish"]'); btn.disabled = true; btn.textContent = "Publishing…";
  try {
    // someone else's change since this editor opened: theirs is shown first, never overwritten unasked
    if (ch) {
      const now = await api.editor.readFile(DIR + ch.file, api.branch);
      if (now != null && now.replace(/\s*$/, "\n") !== startedFrom.replace(/\s*$/, "\n") && !confirm("Someone published a change to this chapter since you opened it. Replace it with yours?")) { btn.disabled = false; btn.textContent = "Publish"; return; }
    }
    const sha = await api.editor.commit(edits, `Rulebook: ${title}`);
    const chapters = api.book.chapters.filter(c => c !== ch).map(({ ast: _a, text: _t, ...c }) => c);
    chapters.push({ id: slug, num, title, file, source });
    chapters.sort((a, b) => a.file.localeCompare(b.file));
    writeDraft(M.key, null);
    api.published({ at: Date.now(), sha, chapters, images: [...M.uploads.keys()].filter(n => source.includes(n)) });
    close();
    api.toast(sha ? "Published: the site rebuilds in a few minutes, the TTS pages with the next save update" : "Nothing changed");
    location.hash = `#/rules/${slug}`;
  } catch (err) {
    btn.disabled = false; btn.textContent = "Publish";
    api.toast(`Couldn't publish (${err.message}). Your draft is kept.`);
  }
}

async function remove() {
  const { api, ch } = M;
  if (!confirm(`Delete the chapter “${ch.title}”? Its text stays in the history on GitHub.`)) return;
  try {
    const sha = await api.editor.commit({ [DIR + ch.file]: false }, `Rulebook: delete ${ch.title}`);
    writeDraft(M.key, null);
    api.published({ at: Date.now(), sha, chapters: api.book.chapters.filter(c => c !== ch).map(({ ast: _a, text: _t, ...c }) => c), images: [] });
    close();
    api.toast("Deleted: the site rebuilds in a few minutes");
  } catch (err) { api.toast(`Couldn't delete (${err.message})`); }
}

// ---- the constructed ban list (app.js "rb-bans", admins): its notes and groups of cards with reasons, written back to
// site/Constructed Ban List.txt in its own format (build_site.py parse_banlist) as one commit
const alnum = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
let B = null;
export function openBans(api) {
  B = { api, dirty: false, notes: api.banlist.notes.join("\n"),
    groups: api.banlist.groups.map(g => ({ title: g.title, entries: g.entries.map(e => ({ name: e.name, reason: e.reason || "" })) })) };
  const cards = api.cards(), names = new Map(cards.map(c => [alnum(c.name), c]));
  B.find = n => names.get(alnum(n)) || names.get(alnum(String(n).replace(/\(.*?\)/g, ""))) || null;
  B.cardList = [...new Set(cards.map(c => c.name))].sort();
  api.modal.innerHTML = `<div class="dialog bans" role="dialog" aria-modal="true" aria-label="Edit the constructed ban list"></div>`;
  api.modal.hidden = false; document.body.style.overflow = "hidden";
  const box = api.modal.querySelector(".bans");
  box.addEventListener("input", banInput);
  box.addEventListener("click", banClick);
  drawBans();
}
function drawBans(focus = "") {
  const { groups } = B, reasons = [...new Set(groups.flatMap(g => g.entries.map(e => e.reason)).filter(Boolean))].sort();
  const row = (g, k, e) => { const known = !e.name.trim() || B.find(e.name);
    return `<div class="bans-row"><input data-g="${g}" data-k="${k}" data-f="name" value="${esc(e.name)}" list="bans-cards" placeholder="Card" class="${known ? "" : "unknown"}" title="${known ? "" : "No card by this name: it is listed as written"}">
      <input data-g="${g}" data-k="${k}" data-f="reason" value="${esc(e.reason)}" list="bans-reasons" placeholder="Reason">
      <button type="button" class="ghost icon" data-del="${g}:${k}" aria-label="Remove ${esc(e.name)}" title="Remove">✕</button></div>`; };
  B.api.modal.querySelector(".bans").innerHTML = `<header class="rbe-top"><h2>Constructed ban list</h2><span class="rbe-state muted">${B.dirty ? "Not published yet." : ""}</span>
      <button type="button" class="primary" data-bans="publish">Publish</button><button type="button" class="ghost icon" data-bans="close" aria-label="Close">✕</button></header>
    <label class="bans-notes">The notes above the list (one per line)<textarea data-f="notes" rows="4">${esc(B.notes)}</textarea></label>
    ${groups.map((g, i) => `<section class="bans-group"><div class="bans-head"><input data-g="${i}" data-f="title" value="${esc(g.title)}" placeholder="Group (e.g. 5 star creatures)">
        <button type="button" class="ghost" data-up="${i}" title="Move up"${i ? "" : " disabled"}>↑</button><button type="button" class="ghost danger" data-delg="${i}">Remove group</button></div>
      ${g.entries.map((e, k) => row(i, k, e)).join("")}<button type="button" class="ghost" data-add="${i}">+ Add a card</button></section>`).join("")}
    <button type="button" class="ghost" data-bans="group">+ Add a group</button>
    <datalist id="bans-cards">${B.cardList.map(n => `<option value="${esc(n)}">`).join("")}</datalist><datalist id="bans-reasons">${reasons.map(r => `<option value="${esc(r)}">`).join("")}</datalist>`;
  if (focus) B.api.modal.querySelector(focus)?.focus();
}
function banInput(e) {
  const t = e.target, f = t.dataset.f;
  if (!f) return;
  B.dirty = true;
  if (f === "notes") B.notes = t.value;
  else if (f === "title") B.groups[+t.dataset.g].title = t.value.replace(/:\s*$/, "");
  else {
    B.groups[+t.dataset.g].entries[+t.dataset.k][f] = t.value.replace(/\s+-\s+/g, " – ");   // " - " splits name and reason in the file
    if (f === "name") t.classList.toggle("unknown", !!t.value.trim() && !B.find(t.value));
  }
}
function banClick(e) {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.add != null) { const g = B.groups[+d.add]; g.entries.push({ name: "", reason: "" }); B.dirty = true; return drawBans(`[data-g="${d.add}"][data-k="${g.entries.length - 1}"][data-f="name"]`); }
  if (d.del) { const [g, k] = d.del.split(":").map(Number); B.groups[g].entries.splice(k, 1); B.dirty = true; return drawBans(); }
  if (d.delg != null) { const g = B.groups[+d.delg]; if (g.entries.length && !confirm(`Remove the group “${g.title}” and its ${g.entries.length} cards?`)) return; B.groups.splice(+d.delg, 1); B.dirty = true; return drawBans(); }
  if (d.up) { const i = +d.up; [B.groups[i - 1], B.groups[i]] = [B.groups[i], B.groups[i - 1]]; B.dirty = true; return drawBans(); }
  if (d.bans === "group") { B.groups.push({ title: "", entries: [] }); B.dirty = true; return drawBans(`[data-g="${B.groups.length - 1}"][data-f="title"]`); }
  if (d.bans === "close") { if (!B.dirty || confirm("Close without publishing your changes?")) { const { api } = B; B = null; api.closeModal(); } return; }
  if (d.bans === "publish") return publishBans(t);
}
async function publishBans(btn) {
  const { api } = B;
  const groups = B.groups.map(g => ({ title: g.title.trim(), entries: g.entries.map(e => ({ name: e.name.trim(), reason: e.reason.trim() })).filter(e => e.name) }))
    .filter(g => g.title || g.entries.length);
  if (groups.some(g => !g.title)) { api.toast("Every group needs a name"); return; }
  const notes = B.notes.split("\n").map(l => l.trim()).filter(Boolean).filter(l => !l.endsWith(":"));
  const text = [...notes, "", ...groups.flatMap(g => [`${g.title}:`, ...g.entries.map(e => (e.reason ? `${e.name} - ${e.reason}` : e.name)), ""])].join("\n").replace(/\n+$/, "\n");
  btn.disabled = true; btn.textContent = "Publishing…";
  try {
    const sha = await api.editor.commit({ [api.path]: text }, "Website edit: constructed ban list");
    api.published({ notes, groups: groups.map(g => ({ title: g.title, entries: g.entries.map(e => ({ ...e, id: B.find(e.name)?.id || null })) })) });
    B = null; api.closeModal();
    api.toast(sha ? "Published: the deck builder and the site follow after the rebuild (a few minutes)" : "Nothing changed");
  } catch (err) { btn.disabled = false; btn.textContent = "Publish"; api.toast(`Couldn't publish (${err.message})`); }
}
