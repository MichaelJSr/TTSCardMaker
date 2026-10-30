// The rulebook editor (app.js openBookEditor): one chapter's text beside its page as the site draws it, a toolbar for the
// syntax (rulebook.js), pictures uploaded as WebP into site/rulebook/img, a draft kept in this browser until published,
// and Publish: the chapter (renamed when its number changes, removed by Delete) and its new pictures as one commit.
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
  ["**bold**  *italic*  ***both***", ""], ["- item / 1. item / 1) item", "lists keep the numbers you type"], ["| a | b |", "a table (|:-:| centres; {.grid cols=-,red,green} under it)"],
  ["[“SHOPS”](#/rules/shops)", "a link to a chapter (or #/rules/stats/health for a section)"], ["=== page ===", "starts a new TTS page here (the site ignores it)"],
];

export function open(api) {
  const { id, book } = api;
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
  ta.addEventListener("paste", e => { const f = [...(e.clipboardData?.files || [])].filter(x => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); upload(f); } });
  preview();
  ta.focus();
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
      <button type="button" class="ghost" data-ins="card" title="A card's picture">Card</button><button type="button" class="ghost" data-ins="link" title="A link to a card">Card link</button>
      <button type="button" class="ghost" data-ins="bold"><b>B</b></button><button type="button" class="ghost" data-ins="italic"><i>I</i></button>
      <button type="button" class="ghost" data-ins="red" title="Colour the selection">Colour</button>
      <button type="button" class="ghost" data-ins="page" title="Start a new TTS page here">TTS page break</button>
      <label class="ghost button" title="Upload a picture (or paste one)">Upload picture<input id="rbe-file" type="file" accept="image/*" multiple hidden></label>
      <details class="rbe-pics"><summary class="ghost button">Pictures and mascots</summary><div class="rbe-pic-grid">${pics.map(p => `<button type="button" class="ghost" data-pic="${esc(p)}" title="${esc(p)}"><img src="${esc(M.api.ctx().imgUrl(p))}" alt="" loading="lazy"><span>${esc(p.replace(/\.\w+$/, ""))}</span></button>`).join("")}</div>
        <p class="muted">Click: a picture. Alt-click: the mascot says something (&gt; [!name]).</p></details>
      <details class="rbe-help"><summary class="ghost button">Syntax</summary><table class="help-table">${HELP.map(([k, d]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(d)}</td></tr>`).join("")}</table>
        <p class="muted">Card text works as on cards: (OYT) badges, [fire] icons, card names link. Type "[" or "(" for the picker.</p></details>
    </div>
    <div class="rbe-cols"><textarea id="rbe-text" spellcheck="true" data-tokens aria-label="The chapter's text"></textarea>
      <div class="rbe-preview"><div class="rb rb-book"><article class="rb-chapter" id="rbe-page"></article></div></div></div></div>`;
}

let timer = 0;
function preview() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { api } = M, page = api.modal.querySelector("#rbe-page");
    if (!page) return;
    const base = api.ctx();
    const ctx = { ...base, imgUrl: f => { const up = [...M.uploads.keys()].find(k => k === f || k.replace(/\.\w+$/, "") === f); return up ? M.uploads.get(up).url : base.imgUrl(f); },
      size: f => (M.uploads.get(f)?.size || base.size(f)) };
    const id = M.ch ? M.ch.id : "new";
    page.innerHTML = api.RB.chapterHtml({ id, num: M.num, title: "", source: M.source }, ctx);
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
  if (act === "close") return close();
  if (act === "discard") { if (confirm("Throw away your draft of this chapter?")) { writeDraft(M.key, null); open({ ...M.api }); } return; }
  if (act === "delete") return remove();
  if (act === "publish") return publish();
}

function close() { const { api } = M; clearTimeout(timer); api.modal.removeEventListener("click", onClick); M = null; api.closeModal(); }

// a picture: resized to MAX_W at most, WebP (PNG kept for pixel art), a name of its own in img/
async function upload(files) {
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
      M.uploads.set(name, { base64, url: URL.createObjectURL(blob), size: [w, h] });
      insert(`![](${name})`);
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
