// The rulebook editor (app.js openBookEditor): one chapter's text beside its page as the site draws it (or as its TTS
// pages), the two linked (a click on the page goes to its line; the cursor brings its block into view), pictures moved
// on the page by dragging (and dragged in from the picture panel; a click gives side and size), a toolbar for
// the syntax (rulebook.js) and a card picker, pictures uploaded as WebP into site/rulebook/img, a draft kept in this
// browser until published, and Publish (Ctrl/Cmd+S): the chapter (renamed when its number changes, removed by Delete)
// and its new pictures as one commit.
import { esc } from "./text.js";

const DRAFTS = "rulebook-drafts";                  // {chapter id or "new": {source, num, base, at}}
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
  ["![what it shows](file.webp){.right width=30}", "a picture: .left / .right float it, .end puts it at the right edge, width in % of the line"],
  ["![[Card name]]", "the card's picture (several on one line make a row; -> between them draws an arrow)"], ["[[Card name]]", "a link to the card"],
  ["[text]{.red}", "colours: red green blue yellow orange purple grey; .u underline, .big, .secret (hidden in the panel)"],
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
  M = { api, ch, key, base, uploads: new Map(), source: draft?.source ?? base, num: draft?.num ?? (ch ? ch.num : nextNum), restored: !!draft && draft.source !== base };
  api.modal.innerHTML = html();
  api.modal.hidden = false; document.body.style.overflow = "hidden";
  const ta = api.modal.querySelector("#rbe-text");
  ta.value = M.source;
  ta.addEventListener("input", () => { M.source = ta.value; saveDraft(); preview(); });
  api.modal.querySelector("#rbe-num").addEventListener("input", e => { M.num = e.target.value.replace(/\D/g, "").slice(0, 2); saveDraft(); });
  api.modal.querySelector("#rbe-file").addEventListener("change", e => upload([...e.target.files]).finally(() => { e.target.value = ""; }));
  api.modal.addEventListener("click", onClick);
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
    if (e.target.closest(".rbe-pictools")) return;
    const el = e.target.closest("[data-line]");
    e.preventDefault();
    if (el) jump(+el.dataset.line);
    tools(PICTURE_KINDS.includes(el?.dataset.kind) ? el : null);
  }, true);
  wireDrag(pane);
  const pick = api.modal.querySelector("#rbe-card");
  pick.addEventListener("keydown", e => {
    if (e.key !== "Enter" || !pick.value.trim()) return;
    e.preventDefault();
    insert(e.shiftKey ? `[[${pick.value.trim()}]]` : `![[${pick.value.trim()}]]`);
    pick.value = "";
  });
  preview();
  if (line != null) jump(line); else ta.focus();
}

// ---- pictures on the page: drag to move (or drag one in from the picture panel), click for side and size. Each edit
// rewrites the chapter's text (one undo step: Ctrl/Cmd+Z), so the text stays the one source.
const PICTURE_KINDS = ["img", "cards", "say"];         // rulebook.js block kinds a drag moves
let drag = null;                                       // {from, end} moving a block's lines, or {text} a new picture
function setText(text, caret) {                        // the whole text replaced as one undoable edit
  const ta = M.api.modal.querySelector("#rbe-text");
  ta.focus(); ta.select();
  if (!document.execCommand?.("insertText", false, text)) ta.value = text;
  if (caret != null) ta.setSelectionRange(caret, caret);
  M.source = ta.value; saveDraft(); preview();
}
const offsetOf = (lines, n) => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
// the source lines a moved block takes: a picture or a card row its line, a callout its "> " lines
function extent(lines, from, kind) {
  if (kind !== "say") return [from, from + 1];
  let end = from + 1;
  while (end < lines.length && /^>/.test(lines[end])) end++;
  return [from, end];
}
function wireDrag(pane) {
  const marker = Object.assign(document.createElement("div"), { className: "rbe-drop", hidden: true });
  pane.append(marker);
  const target = e => {                                // the block the pointer is over and the side it is on
    const el = e.target.closest?.("[data-line]");
    if (!el || !pane.contains(el) || (drag?.el && (drag.el === el || drag.el.contains(el)))) return null;
    const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    return { el, after, line: after ? +el.dataset.end : +el.dataset.line, y: after ? r.bottom : r.top, x: r.left, w: r.width };
  };
  pane.addEventListener("dragstart", e => {
    const el = e.target.closest?.("[data-line]");
    if (!el || !PICTURE_KINDS.includes(el.dataset.kind)) return;
    const lines = M.source.split("\n"), [from, end] = extent(lines, +el.dataset.line, el.dataset.kind);
    drag = { el, from, end };
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", lines.slice(from, end).join("\n"));
    tools(null);
  });
  M.api.modal.querySelector(".rbe-pic-grid").addEventListener("dragstart", e => {   // a new picture from the panel
    const b = e.target.closest("[data-pic]");
    if (!b) return;
    drag = { text: e.altKey ? `> [!${b.dataset.pic.replace(/\.\w+$/, "")}] Text.` : `![](${b.dataset.pic})` };
    e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", drag.text);
  });
  const files = e => !drag && [...(e.dataTransfer?.types || [])].includes("Files");   // image files from this computer
  pane.addEventListener("dragover", e => {
    if (!drag && !files(e)) return;
    const t = target(e);
    if (!t) { marker.hidden = true; return; }
    e.preventDefault();
    const p = pane.getBoundingClientRect();
    Object.assign(marker.style, { top: `${t.y - p.top + pane.scrollTop - 2}px`, left: `${t.x - p.left}px`, width: `${t.w}px` });
    marker.hidden = false;
  });
  pane.addEventListener("dragleave", e => { if (!pane.contains(e.relatedTarget)) marker.hidden = true; });
  pane.addEventListener("drop", e => {
    if (files(e)) {                                    // a new picture at the drop (the end when it misses a block)
      e.preventDefault(); marker.hidden = true;
      const t = target(e);
      upload([...e.dataTransfer.files], t ? t.line : M.source.split("\n").length);
      return;
    }
    const t = drag && target(e);
    marker.hidden = true;
    if (!t) { drag = null; return; }
    e.preventDefault();
    const lines = M.source.split("\n");
    let at = t.line, moved;
    if (drag.text) moved = [drag.text];
    else {
      if (at >= drag.from && at <= drag.end) { drag = null; return; }   // dropped where it is
      moved = lines.splice(drag.from, drag.end - drag.from);
      if (at > drag.from) at -= moved.length;
    }
    while (moved.length && !moved[moved.length - 1].trim()) moved.pop();
    lines.splice(at, 0, ...moved);
    drag = null;
    setText(lines.join("\n"), offsetOf(lines, at));
  });
  pane.addEventListener("dragend", () => { marker.hidden = true; drag = null; });
}
// a clicked picture's tools: side (left, centre, right, the corner), size, delete
function tools(el) {
  const pane = M.api.modal.querySelector(".rbe-preview");
  pane.querySelector(".rbe-pictools")?.remove();
  if (!el) return;
  const kind = el.dataset.kind, line = +el.dataset.line, box = document.createElement("div");
  box.className = "rbe-pictools";
  box.innerHTML = (kind === "img" ? `<button type="button" data-side="left" title="Text flows on its right">Left</button><button type="button" data-side="" title="On a line of its own">Center</button>
    <button type="button" data-side="right" title="Text flows on its left">Right</button><button type="button" data-side="end" title="At the bottom right">Corner</button>
    <button type="button" data-size="-1" title="Smaller">−</button><button type="button" data-size="1" title="Bigger">+</button>`
    : kind === "cards" ? `<button type="button" data-size="-1" title="Smaller cards">−</button><button type="button" data-size="1" title="Bigger cards">+</button>`
      : `<button type="button" data-say="top" title="The mascot above the bubble">Top</button><button type="button" data-say="" title="The mascot beside it">Side</button>`)
    + `<button type="button" data-del title="Take it out">Delete</button>`;
  const r = el.getBoundingClientRect(), p = pane.getBoundingClientRect();
  pane.append(box);
  const left = Math.min(r.left - p.left + 4, pane.clientWidth - box.offsetWidth - 6);   // inside the pane
  Object.assign(box.style, { top: `${r.top - p.top + pane.scrollTop + 4}px`, left: `${Math.max(4, left)}px` });
  box.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const lines = M.source.split("\n"), text = lines[line] ?? "";
    if (b.dataset.del != null) {
      const [from, end] = extent(lines, line, kind);
      lines.splice(from, end - from);
      tools(null);
      return setText(lines.join("\n"), offsetOf(lines, from));
    }
    if (kind === "say") {                              // > [!name opts] text
      lines[line] = text.replace(/^>\s*\[!([\w-]+)((?:\s+[\w-]+)*)\]/, (_, who, opts) => {
        const keep = opts.trim().split(/\s+/).filter(o => o && o !== "top");
        return `> [!${[who, ...(b.dataset.say ? [b.dataset.say] : []), ...keep].join(" ")}]`;
      });
    } else {
      const m = /^(\s*)(.*?)(\s*\{[^{}]*\})?\s*$/.exec(text), a = M.api.RB.splitAttrs(m[3] || "").attrs;
      if (b.dataset.side != null) { a.cls = a.cls.filter(c => !["left", "right", "end"].includes(c)); if (b.dataset.side) a.cls.push(b.dataset.side); }
      if (b.dataset.size) {
        if (kind === "cards") a.cls = +b.dataset.size < 0 ? [...new Set([...a.cls, "small"])] : a.cls.filter(c => c !== "small");
        else {
          const parent = el.parentElement.getBoundingClientRect().width || 1;
          const now = /^\d+$/.test(a.width || "") ? +a.width : Math.round((el.getBoundingClientRect().width / parent) * 100);
          a.width = String(Math.min(100, Math.max(5, Math.round(now / 5) * 5 + 10 * +b.dataset.size)));
        }
      }
      const attrs = M.api.RB.attrsText(a);
      lines[line] = `${m[1]}${m[2]}${attrs ? ` ${attrs}` : ""}`;
    }
    setText(lines.join("\n"), offsetOf(lines, line));
    setTimeout(() => tools(M.api.modal.querySelector(`.rbe-preview [data-line="${line}"]`)), 250);   // after the redraw
  });
}

// the text's line n at the top of the box, the cursor at its start
function jump(n) {
  const ta = M.api.modal.querySelector("#rbe-text"), lines = ta.value.split("\n");
  const at = lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
  ta.focus();
  ta.setSelectionRange(at, at);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, n * lh - 2 * lh);           // wrapped lines make it approximate: the caret stays in view
  follow();
}
// the block under the cursor brought into view on the page, marked a moment
let followed = null;
function follow() {
  const ta = M.api.modal.querySelector("#rbe-text"), pane = M.api.modal.querySelector(".rbe-preview");
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
      <button type="button" class="ghost" data-ins="red" title="Colour the selection">Colour</button>
      <button type="button" class="ghost" data-ins="page" title="Start a new TTS page here">TTS page break</button>
      <label class="ghost button" title="Add pictures from this computer (or drop image files on the page or the text, or paste one)">Add picture<input id="rbe-file" type="file" accept="image/*" multiple hidden></label>
      <details class="rbe-pics"><summary class="ghost button">Pictures and mascots</summary><div class="rbe-pic-grid">${pics.map(p => `<button type="button" class="ghost" data-pic="${esc(p)}" title="${esc(p)}" draggable="true"><img src="${esc(M.api.ctx().imgUrl(p))}" alt="" loading="lazy"><span>${esc(p.replace(/\.\w+$/, ""))}</span></button>`).join("")}</div>
        <p class="muted">Click: a picture at the cursor; drag one onto the page to put it there. Alt: the mascot says something (&gt; [!name]).</p></details>
      <button type="button" class="ghost" data-rbe="tts" aria-pressed="false" title="Show the chapter as its TTS pages (1080x1920)">TTS pages</button>
      <details class="rbe-help"><summary class="ghost button">Syntax</summary><table class="help-table">${HELP.map(([k, d]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(d)}</td></tr>`).join("")}</table>
        <p class="muted">Card text works as on cards: (OYT) badges, [fire] icons (type "[" or "(" for the picker); card names link only as [[Card]].
        Click anything on the page to go to its line. Drag a picture, a row of cards or a mascot on the page to move it; click a picture for its side
        and size. Drop image files from your computer onto the page to add them there. Your draft is kept in this browser until you publish (Ctrl/Cmd+S); Ctrl/Cmd+Z undoes.</p></details>
    </div>
    <div class="rbe-cols"><textarea id="rbe-text" spellcheck="true" data-tokens aria-label="The chapter's text"></textarea>
      <div class="rbe-preview"><div class="rb rb-book"><article class="rb-chapter" id="rbe-page"></article></div><div class="rbe-sheets" hidden></div></div></div></div>`;
}

let timer = 0;
function preview() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { api } = M, page = api.modal.querySelector("#rbe-page"), sheets = api.modal.querySelector(".rbe-sheets");
    if (!page) return;
    const base = api.ctx();
    const ctx = { ...base, lines: true, eager: true, imgUrl: f => { const up = [...M.uploads.keys()].find(k => k === f || k.replace(/\.\w+$/, "") === f); return up ? M.uploads.get(up).url : base.imgUrl(f); },
      size: f => (M.uploads.get(f)?.size || base.size(f)) };
    const chapter = { id: M.ch ? M.ch.id : "new", num: M.num, title: "", source: M.source };
    page.parentElement.hidden = !!M.tts; sheets.hidden = !M.tts;
    if (M.tts) {                                       // its TTS pages, cut as Card sync's export cuts them (pictures still loading: approximate)
      sheets.className = "rbe-sheets";
      api.RB.paginate(sheets, [chapter], { ...ctx, lines: false });
      sheets.className = "rbe-sheets rb-sheets";
    } else {
      page.innerHTML = api.RB.chapterHtml(chapter, ctx);
      for (const el of page.querySelectorAll("[data-line]")) if (PICTURE_KINDS.includes(el.dataset.kind)) el.draggable = true;
      for (const im of page.querySelectorAll("img")) im.draggable = false;   // the block moves, not the image file
      followed = null;
      follow();                                        // the cursor's block in view again
    }
  }, 150);
}

function saveDraft() {
  const same = M.source === M.base && (!M.ch || M.num === M.ch.num);
  writeDraft(M.key, same ? null : { source: M.source, num: M.num, at: Date.now() });
  const st = M.api.modal.querySelector("#rbe-state"); if (st) st.textContent = same ? "" : "Draft kept in this browser.";
}

// toolbar: what each button puts in (around the selection when it has one)
const SNIPPET = {
  section: () => "\n## SECTION\n", panel: () => "\n::: panel\n\n:::\n", row: () => "\n::: row\n![](picture.webp)\n\n::: panel\nText beside it.\n:::\n:::\n",
  ability: () => "\n::: ability\n1. (OYT) Ability text.\n:::\n", card: () => "![[Card name]]", link: () => "[[Card name]]", page: () => "\n=== page ===\n",
};
function insert(kind) {
  const ta = M.api.modal.querySelector("#rbe-text"), a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b);
  const wrap = { bold: ["**", "**"], italic: ["*", "*"], red: ["[", "]{.red}"] }[kind];
  const text = wrap ? `${wrap[0]}${sel || "text"}${wrap[1]}` : SNIPPET[kind]?.() ?? kind;
  ta.setRangeText(text, a, b, wrap && !sel ? "select" : "end");
  if (wrap && !sel) ta.setSelectionRange(a + wrap[0].length, a + wrap[0].length + 4);
  ta.focus(); ta.dispatchEvent(new Event("input"));
}

function onClick(e) {
  const t = e.target.closest("[data-rbe], [data-ins], [data-pic]");
  if (!t) return;
  e.preventDefault(); e.stopPropagation();
  if (t.dataset.ins) return insert(t.dataset.ins);
  if (t.dataset.pic) {
    const name = t.dataset.pic, stem = name.replace(/\.\w+$/, "");
    t.closest("details").open = false;
    return insert(e.altKey ? `\n> [!${stem}] ` : `![](${name})`);
  }
  const act = t.dataset.rbe;
  if (act === "tts") { M.tts = !M.tts; t.setAttribute("aria-pressed", String(M.tts)); t.classList.toggle("on", M.tts); preview(); return; }
  if (act === "close") return close();
  if (act === "discard") { if (confirm("Throw away your draft of this chapter?")) { writeDraft(M.key, null); open({ ...M.api }); } return; }
  if (act === "delete") return remove();
  if (act === "publish") return publish();
}

function close() { const { api } = M; clearTimeout(timer); api.modal.removeEventListener("click", onClick); M = null; api.closeModal(); }

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
      if (at == null) insert(`![](${name})`);
      else { const lines = M.source.split("\n"); lines.splice(at, 0, `![](${name})`); setText(lines.join("\n"), offsetOf(lines, at)); at++; }
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
