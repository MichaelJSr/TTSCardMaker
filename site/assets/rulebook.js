// The rulebook: chapters written as text (site/rulebook/NN-slug.md, edited on the website or in any text editor), drawn
// in the book's style. The web view flows; the TTS sheets (#/rules/print) cut the same blocks into 1080x1920 pages.
// Syntax (the editor's Syntax panel, rulebook-edit.js HELP, says the same for editors):
//   # Title                      the chapter's title, its first line
//   ## Section {.hp icon=fire}   a tabbed panel holding what follows up to the next ##, --- or page break; .hp .hp2 .def
//                                .atk .spd colour the tab, icon= puts a type icon beside it
//   ::: kind "Title" {.cls}      a fence up to its ":::" (fences nest): panel (a "Title" gives it a tab), row (side by
//   :::                          side; "::: row 3 1" sets the widths), stack, box, small, center, ability (a card's ability
//                                box, "1." a numbered bubble), contents (the chapters' list)
//   > [!kirby top] text          a mascot (any picture in img/) says it; top: above the bubble, right: floated
//   ![alt](file.webp){.right width=30}   a picture: .left .right float it (text wraps around it: a see-through one's
//                                        edges, its outline from build_site; out=45: that % of it hangs out of its
//                                        panel's side), .end puts it at the right edge, width in %;
//                                        dx=10 dy=-5 shift it (% of its size), .free x= y= place it anywhere;
//                                        in a row, anchor=bottom-left (top, center, right…) puts it there in its column
//   ![[Card]]  ![[A]] -> ![[B]]  the card's picture (a line of them is a row; -> an arrow); [[Card|label]] a link to it
//   [text]{.red}                 red green blue yellow orange purple grey white, .u .big .caps .nowrap .secret
//   **bold** *italic* ***both***, - lists, 1. / 1) / A. lists (numbers kept as typed), | tables | ({.grid cols=-,red}
//   under one), [“SHOPS”](#/rules/shops) chapter links, \ escapes, === page === (a TTS page break; the site ignores it)
// Plain text goes through the site's renderer: icons [fire], badges (OYT); card names link only as [[Card]].
import { esc } from "./text.js";

export const IMG_DIR = "rulebook/img/";          // dist path of site/rulebook/img
export const SHEET = { w: 1080, h: 1920 };       // a TTS page, as the Photoshop pages were

// ---- parse --------------------------------------------------------------------------------------------------------
const FENCE = /^\s*:{3,}\s*([a-z][\w-]*)\s*(.*)$/i;
const CLOSE = /^\s*:{3,}\s*$/;
export const LIST = /^(\s*)([-*•]|\d{1,3}[.)]|[A-Za-z][.)])\s+(.*)$/;   // a list item's line (the editor finds items by it)
const HEAD = /^(#{1,3})\s+(.*)$/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,})\s*$/;
const PAGE = /^\s*=+\s*page\s*=+\s*$/i;
const ATTRS = /\s*\{([^{}]*)\}\s*$/;
const PICTURE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*(\{[^}]*\})?\s*$/;          // a line that is only a picture: a block of its own

/** "text {.a .b k=v}" -> {text, attrs: {cls: [a, b], k: v}} */
/** {cls, k: v} back to "{.a .b k=v}" ("" when empty) */
export const attrsText = a => { const parts = [...(a.cls || []).map(c => `.${c}`), ...Object.entries(a).filter(([k]) => k !== "cls").map(([k, v]) => `${k}=${v}`)]; return parts.length ? `{${parts.join(" ")}}` : ""; };
export function splitAttrs(s) {
  const m = ATTRS.exec(s || ""), attrs = { cls: [] };
  if (!m) return { text: (s || "").trim(), attrs };
  for (const w of m[1].trim().split(/\s+/).filter(Boolean)) {
    if (w.startsWith(".")) attrs.cls.push(w.slice(1));
    else if (w.includes("=")) { const [k, ...v] = w.split("="); attrs[k] = v.join("=").replace(/^["']|["']$/g, ""); }
    else attrs.cls.push(w);
  }
  return { text: s.slice(0, m.index).trim(), attrs };
}
const unquote = s => s.replace(/^["“](.*)["”]$/, "$1");
const indentOf = line => line.match(/^\s*/)[0].replace(/\t/g, "  ").length;
const startsBlock = line => FENCE.test(line) || CLOSE.test(line) || /^>/.test(line) || HEAD.test(line) || RULE.test(line)
  || PAGE.test(line) || /^\s*\|/.test(line) || (LIST.test(line) && indentOf(line) < 2) || PICTURE.test(line.trim()) || CARDS.test(line);

/** A chapter's text -> {title, attrs, blocks}. Never throws: unknown lines are text. */
export function parse(src) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = parseBlocks(lines);
  const h1 = blocks.find(b => b.t === "h1");
  return { title: h1?.text || "", attrs: h1?.attrs || { cls: [] }, blocks: blocks.filter(b => b !== h1) };
}

function parseBlocks(lines, inRow = false, base = 0) {
  const out = [];
  let i = 0;
  const push = b => out.push(Object.assign(b, { line: base + start }));   // the source line a block starts on (the editor)
  let start = 0;
  while (i < lines.length) {
    const line = lines[i];
    start = i;
    if (!line.trim() || CLOSE.test(line)) { i++; continue; }      // a stray closing fence: nothing
    let m;
    if ((m = FENCE.exec(line))) {
      let depth = 1, j = i + 1;
      for (; j < lines.length; j++) { if (FENCE.test(lines[j])) depth++; else if (CLOSE.test(lines[j]) && !--depth) break; }
      const { text, attrs } = splitAttrs(m[2]);
      push({ t: "fence", kind: m[1].toLowerCase(), arg: unquote(text), attrs, close: base + Math.min(j, lines.length), children: parseBlocks(lines.slice(i + 1, j), m[1].toLowerCase() === "row", base + i + 1) });
      i = j + 1; continue;
    }
    if (/^>/.test(line)) {
      const body = [];
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^> ?/, ""));
      const w = /^\[!([\w-]+)((?:\s+[\w-]+)*)\]\s*(.*)$/.exec(body[0] || "");
      if (w) body[0] = w[3];
      push({ t: "say", who: w ? w[1].toLowerCase() : "", opts: w ? w[2].trim().split(/\s+/).filter(Boolean) : [], children: parseBlocks(body, false, base + start) });
      continue;
    }
    if ((m = HEAD.exec(line))) { const { text, attrs } = splitAttrs(m[2]); push({ t: `h${m[1].length}`, text, attrs }); i++; continue; }
    if (RULE.test(line)) { push({ t: "hr" }); i++; continue; }
    if (PAGE.test(line)) { push({ t: "page" }); i++; continue; }
    if (/^\s*\|/.test(line)) { const r = parseTable(lines, i); push(r.block); i = r.next; continue; }
    if (LIST.test(line) && indentOf(line) < 2) { const r = parseList(lines, i); push(r.block); i = r.next; continue; }
    if (PICTURE.test(line.trim()) || CARDS.test(line)) { push(paragraph(line)); i++; continue; }
    const para = [line];
    for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines[i]); i++) para.push(lines[i]);
    push(paragraph(para.join("\n")));
  }
  out.forEach((b, k) => { b.end = k + 1 < out.length ? out[k + 1].line : base + lines.length; });   // up to the next block (blank lines too)
  return group(out, inRow);
}

// "## Title" opens a section (a tabbed panel) that holds what follows up to the next heading or "---"; in a row, also up
// to the next column: a fence, a callout, card pictures or a picture that doesn't float
const FLOATS = ["left", "right", "end"];
const placed = b => b.t === "img" && b.attrs.cls.includes("free");   // a picture placed anywhere: out of the flow
// a panel holds its floated pictures when one is solid (no outline: a screenshot, a diagram); see-through ones alone
// hang out of it, its height its text's, as on the Photoshop pages
const isNum = v => /^-?\d+(\.\d+)?$/.test(v || "");
const sideOf = b => (b.attrs.cls.includes("left") ? "left" : b.attrs.cls.includes("right") ? "right" : "");
// {.left width=28 out=45}: that % of a floated picture hangs out of its panel's side; the panel moves in on that side
// by as much (hangOf), so the picture stays on the page, as Kirby on the Getting Started page did
const outOf = b => (b.t === "img" && !placed(b) && sideOf(b) && isNum(b.attrs.out) && isNum(b.attrs.width) ? Math.max(0, Math.min(90, +b.attrs.out)) * +b.attrs.width / 1e4 : 0);
function hangOf(kids) {                               // the panel's style: in by the part of its picture that hangs out
  const c = kids.find(outOf);
  if (!c) return "";
  const k = outOf(c);                                 // that part / the panel's text width; the panel's padding .9em a side
  return `margin-${sideOf(c)}:calc((100% - 1.8em) * ${+(k / (1 + k)).toFixed(4)})`;
}
const holds = (kids, ctx) => kids.some(c => c.t === "img" && !placed(c) && c.attrs.cls.some(k => k === "left" || k === "right") && !ctx.shape?.(c.src));
const ANCHORS = new Set(["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"]);   // a row's picture in its column
const column = b => b.t === "fence" || b.t === "say" || b.t === "cards" || (b.t === "img" && !placed(b) && !b.attrs.cls.some(c => FLOATS.includes(c)));
const holdsSection = b => b.t === "fence" && b.children.some(c => c.t === "section" || holdsSection(c));
function group(list, inRow = false) {
  const res = [];
  let sec = null;
  for (const b of list) {
    if (inRow && sec && column(b)) sec = null;
    if (b.t === "h2") { sec = { t: "section", title: b.text, attrs: b.attrs, children: [], line: b.line, end: b.end }; res.push(sec); continue; }
    if (b.t === "h1" || b.t === "hr" || b.t === "page") { sec = null; if (b.t !== "hr") res.push(b); continue; }
    if (holdsSection(b)) { sec = null; res.push(b); continue; }   // a fence holding sections (a row of them): its own
    (sec ? sec.children : res).push(b);
  }
  for (const b of res) if (b.t === "section" && b.children.length) b.end = b.children[b.children.length - 1].end ?? b.end;
  return res;
}

const CARDS = /^(?:\s*(?:!\[\[[^\]\n]+\]\]|->|→))+\s*(\{[^}]*\})?\s*$/;   // card pictures, "->" between them
function paragraph(text) {
  const img = PICTURE.exec(text.trim());
  if (img) return { t: "img", alt: img[1], src: img[2], attrs: splitAttrs(img[3] || "").attrs };
  if (CARDS.test(text)) {
    const { text: body, attrs } = splitAttrs(text);
    return { t: "cards", names: [...body.matchAll(/!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]|->|→/g)].map(m => (m[1] ? { name: m[1].trim(), label: (m[2] || "").trim() } : { arrow: true })), attrs };
  }
  return { t: "p", text };
}

function parseTable(lines, i) {
  const rows = [];
  while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
  const cells = r => r.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
  let head = null, align = [];
  if (rows.length > 1 && /^[\s|:-]+$/.test(rows[1]) && rows[1].includes("-")) {
    head = cells(rows[0]);
    align = cells(rows[1]).map(a => (a.startsWith(":") && a.endsWith(":") ? "center" : a.endsWith(":") ? "right" : a.startsWith(":") ? "left" : ""));
    rows.splice(0, 2);
  }
  let attrs = { cls: [] };
  if (i < lines.length && /^\s*\{[^}]*\}\s*$/.test(lines[i])) attrs = splitAttrs(lines[i++]).attrs;   // a "{.cls}" line under it
  return { block: { t: "table", head, align, rows: rows.map(cells), attrs }, next: i };
}

function parseList(lines, i) {
  const first = LIST.exec(lines[i]), ind = indentOf(lines[i]);
  const kind = mk => (/^[-*•]$/.test(mk) ? "ul" : /^\d/.test(mk) ? "1" : /^[A-Z]/.test(mk) ? "A" : "a");
  const type = kind(first[2]), delim = /\)$/.test(first[2]) ? ")" : ".";
  const num = mk => (/^\d/.test(mk) ? parseInt(mk, 10) : mk.toLowerCase().charCodeAt(0) - 96);   // as typed: "2) 2)" stays
  const items = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {                                // a blank line: the list goes on if an item of its kind follows
      const n = LIST.exec(lines[i + 1] || "");
      if (n && indentOf(lines[i + 1]) === ind && kind(n[2]) === type) { i++; continue; }
      break;
    }
    const m = LIST.exec(line), at = indentOf(line);
    if (m && at === ind) { if (kind(m[2]) !== type) break; items.push({ text: m[3], n: type === "ul" ? 0 : num(m[2]), children: [] }); i++; continue; }
    if (at > ind && items.length) {                     // deeper lines: the item's own lines and lists
      const sub = [];
      while (i < lines.length && (lines[i].trim() ? indentOf(lines[i]) > ind : LIST.test(lines[i + 1] || "") && indentOf(lines[i + 1]) > ind)) sub.push(lines[i++]);
      const cut = Math.min(...sub.filter(l => l.trim()).map(indentOf));
      const body = sub.map(l => l.replace(/\t/g, "  ").slice(cut));
      if (!LIST.test(body[0])) { const item = items[items.length - 1]; item.text += "\n" + body.shift().trim(); while (body.length && body[0].trim() && !LIST.test(body[0])) item.text += "\n" + body.shift().trim(); }
      items[items.length - 1].children.push(...parseBlocks(body));
      continue;
    }
    break;
  }
  return { block: { t: "list", type, delim, items }, next: i };
}

// ---- plain text (search, the bot, game.txt: site/build/build_site.py rulebook_text is the same) -------------------------
/** A chapter's words without markup: pictures dropped, card pictures and links as their names, one line per line. */
export function plainText(src) {
  const ast = typeof src === "string" ? parse(src) : src, out = [];
  const inl = s => String(s || "").replace(/\\([\\*[\]{}()!_`|])/g, "$1").replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, n, l) => l || n).replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, "")
    .replace(/\[([^[\]]+)\]\{[^}]*\}/g, "$1").replace(/\[([^[\]]+)\]\((?:https?:|#)[^)]*\)/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*([^*\s](?:[^*]*[^*\s])?)\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  const walk = list => {
    for (const b of list) {
      if (b.t === "p" || b.t === "h3") out.push(inl(b.text));
      else if (b.t === "section") { out.push(inl(b.title)); walk(b.children); }
      else if (b.t === "fence") { if (b.arg) out.push(inl(b.arg)); walk(b.children); }
      else if (b.t === "say") walk(b.children);
      else if (b.t === "cards") out.push(b.names.map(n => (n.arrow ? "->" : n.label || n.name)).join(" "));
      else if (b.t === "list") b.items.forEach(it => { out.push(`${marker(b, it)} ${inl(it.text)}`); walk(it.children); });
      else if (b.t === "table") for (const r of [...(b.head ? [b.head] : []), ...b.rows]) out.push(r.map(inl).join(" | "));
    }
  };
  walk(ast.blocks);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const marker = (b, it) => (b.type === "ul" ? "-" : `${b.type === "1" ? it.n : String.fromCharCode((b.type === "A" ? 64 : 96) + it.n)}${b.delim}`);
export const slugify = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";

// ---- draw ---------------------------------------------------------------------------------------------------------
// ctx: {render(text) -> html (the site's renderer: icons, badges, card names), card(name) -> card or null,
// cardImg(card) -> url, imgUrl(file) -> url, size(file) -> [w, h] or null, shape(file) -> a transparent picture's outline
// (polygon points in %, build_site picture_outline) or null, id: the chapter's id (section anchors)}
const COLOURS = new Set(["red", "green", "blue", "yellow", "orange", "purple", "grey", "white", "hp", "def", "atk", "spd", "u", "big", "small", "caps", "nowrap", "secret"]);
const clsOf = (attrs, keep = null) => (attrs?.cls || []).filter(c => /^[\w-]+$/.test(c) && (!keep || keep.has(c))).map(c => `rb-${c}`).join(" ");
const safeUrl = u => (/^(https?:|#|mailto:)/i.test(u) ? u : "#");

const INLINE = new RegExp([
  /(?<esc>\\[\\*[\]{}()!_`|])/.source,
  /(?<pic>!?)\[\[(?<card>[^\][|\n]+)(?:\|(?<label>[^\]\n]*))?\]\]/.source,   // ![[Card]] / [[Card|label]]
  /!\[(?<alt>[^\]\n]*)\]\((?<src>[^)\s]+)\)(?<iattrs>\{[^}\n]*\})?/.source,  // a picture in the line
  /\[(?<span>(?:[^[\]\n]|\[\[[^\]\n]+\]\])+)\]\{(?<cls>[^}\n]*)\}/.source,   // [text]{.colour} ([[Card]] inside too)
  /\[(?<ltext>[^[\]\n]+)\]\((?<href>(?:https?:|#|mailto:)[^)\s]*)\)/.source,
  /\*\*\*(?<bi>.+?)\*\*\*/.source, /\*\*(?<b>.+?)\*\*/.source, /\*(?<i>[^*\s](?:[^*\n]*[^*\s])?)\*/.source, /`(?<code>[^`\n]+)`/.source,
].join("|"), "g");

/** HTML for one line of text: markup, then the site's renderer on the plain stretches */
export function inline(text, ctx) {
  let out = "", last = 0;
  const plain = s => (s ? stars(ctx.render ? ctx.render(s) : esc(s).replace(/\n/g, "<br>")) : "");
  text = String(text || "");
  for (const m of text.matchAll(INLINE)) {
    const g = m.groups;
    out += plain(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (g.esc) out += esc(g.esc.slice(1));
    else if (g.card !== undefined) {
      const name = g.card.trim(), c = ctx.card?.(name), label = (g.label || "").trim() || name;
      out += g.pic ? cardHtml(name, "", ctx, "rb-card-inline") : c ? `<a class="card-ref" href="#/card/${esc(c.id)}" data-card="${esc(c.id)}">${esc(label)}</a>` : esc(label);
    } else if (g.src !== undefined) out += imgHtml({ alt: g.alt, src: g.src, attrs: splitAttrs(g.iattrs || "").attrs }, ctx, true);
    else if (g.span !== undefined) out += `<span class="${clsOf(splitAttrs(`{${g.cls}}`).attrs, COLOURS)}">${inline(g.span, ctx)}</span>`;
    else if (g.ltext !== undefined) out += `<a href="${esc(safeUrl(g.href))}"${/^https?:/i.test(g.href) ? ' target="_blank" rel="noopener"' : ""}${g.href.startsWith("#/rules/") ? ` data-scroll="${esc(g.href.slice(8).replace(/\//g, "--"))}"` : ""}>${inline(g.ltext, ctx)}</a>`;
    else if (g.bi !== undefined) out += `<b><i>${inline(g.bi, ctx)}</i></b>`;
    else if (g.b !== undefined) out += `<b>${inline(g.b, ctx)}</b>`;
    else if (g.i !== undefined) out += `<i>${inline(g.i, ctx)}</i>`;
    else if (g.code !== undefined) out += `<code>${esc(g.code)}</code>`;
  }
  return out + plain(text.slice(last));
}
const stars = html => html.replace(/★+/g, s => `<span class="rb-stars">${s}</span>`);

// width=40 or 37.5 (per cent of the line) or width=6em; height=2em
const sizeStyle = a => [a.width && `width:${/^\d+(\.\d+)?$/.test(a.width) ? `${a.width}%` : a.width}`, a.height && `height:${a.height}`].filter(Boolean).join(";").replace(/[^\w%.:;-]/g, "");
function imgHtml(b, ctx, inLine = false) {   // --w: its width, for one without width= (drawn its size in the page's px)
  const a = b.attrs || { cls: [] }, size = ctx.size?.(b.src), url = ctx.imgUrl ? ctx.imgUrl(b.src) : IMG_DIR + b.src, style = inLine ? sizeStyle(a) : size ? `--w:${Number(size[0])}` : "";
  const dims = size ? ` width="${size[0]}" height="${size[1]}"` : "";
  return `<img class="${inLine ? `rb-icon ${clsOf(a)}` : "rb-img"}" src="${esc(url)}" alt="${esc(b.alt)}"${dims}${style ? ` style="${style}"` : ""}${lazy(ctx)}>`;
}

function cardHtml(name, label, ctx, cls = "") {
  const c = ctx.card?.(name);
  if (!c) return `<span class="rb-card rb-missing ${cls}" title="No card named ${esc(name)}">${esc(label || name)}</span>`;
  return `<a class="rb-card ${cls}" href="#/card/${esc(c.id)}" data-card="${esc(c.id)}" title="${esc(c.name)}"><img src="${esc(ctx.cardImg(c))}" alt="${esc(c.name)}"${lazy(ctx)}>${label ? `<span>${esc(label)}</span>` : ""}</a>`;
}

const lazy = ctx => (ctx.eager ? "" : ' loading="lazy" decoding="async"');   // the TTS pages: every picture at once
const kidsHtml = (list, ctx) => list.map(b => blockHtml(b, ctx)).join("");

/** HTML for one block (draw and the paginator); ctx.lines: each block's element carries data-line (the editor's preview) */
export function blockHtml(b, ctx) {
  const html = blockInner(b, ctx);
  return ctx.lines && b.line != null && !b.cont ? html.replace(/^<([a-z][a-z0-9]*)/, `<$1 data-line="${b.line}" data-end="${b.end ?? b.line + 1}" data-kind="${b.t}"${b.t === "fence" ? ` data-fence="${b.kind}" data-close="${b.close}"` : ""}`) : html;
}
function blockInner(b, ctx) {
  switch (b.t) {
    case "p": return `<p>${inline(b.text, ctx)}</p>`;
    case "h3": return `<h4 class="rb-sub ${clsOf(b.attrs)}">${inline(b.text, ctx)}</h4>`;
    case "section": {
      const id = ctx.id ? ` id="${esc(ctx.id)}--${slugify(titleText(b.title))}"` : "";
      const icon = b.attrs?.icon && !b.cont ? ctx.icon?.(b.attrs.icon) : "";
      const pen = ctx.editable && ctx.id && b.line != null ? ` <button type="button" class="rb-sec-edit" data-action="rb-edit" data-id="${esc(ctx.id)}" data-line="${b.line}" title="Edit this section" aria-label="Edit this section">✎</button>` : "";
      return `<section class="rb-sec ${clsOf(b.attrs)}${b.cont ? " rb-cont" : ""}${icon ? " rb-has-icon" : ""}"${b.cont ? "" : id}>${icon ? `<span class="rb-sec-icon">${icon}</span>` : ""}${b.cont ? "" : `<h3 class="rb-tab">${inline(b.title, ctx)}${pen}</h3>`}<div class="rb-panel${holds(b.children, ctx) ? " rb-holds" : ""}"${hangOf(b.children) ? ` style="${hangOf(b.children)}"` : ""}>${kidsHtml(b.children, ctx)}</div></section>`;
    }
    case "fence": return fenceHtml(b, ctx);
    case "say": {
      const pic = b.who ? `<img class="rb-mascot" src="${esc(ctx.imgUrl ? ctx.imgUrl(b.who) : `${IMG_DIR}${b.who}.webp`)}" alt=""${lazy(ctx)}>` : "";
      const opts = b.opts.filter(o => /^[\w-]+$/.test(o)).map(o => `rb-say-${o}`).join(" ");
      return `<aside class="rb-say ${opts}">${pic}<div class="rb-bubble">${kidsHtml(b.children, ctx)}</div></aside>`;
    }
    case "img": {                                     // {.free x=40 y=10 width=25}: placed at x% / y% of its container;
      const num = v => /^-?\d+(\.\d+)?$/.test(v || "");   // {dx=10 dy=-5}: in the flow, shifted by % of its own size
      const at = placed(b) ? ["x", "y"].map((k, i) => (num(b.attrs[k]) ? `${i ? "top" : "left"}:${b.attrs[k]}%` : "")).filter(Boolean).join(";") : "";
      const shift = !placed(b) && (num(b.attrs.dx) || num(b.attrs.dy)) ? `transform:translate(${num(b.attrs.dx) ? b.attrs.dx : 0}%,${num(b.attrs.dy) ? b.attrs.dy : 0}%)` : "";
      const outline = !placed(b) && b.attrs.cls.some(c => c === "left" || c === "right") ? ctx.shape?.(b.src) : null;   // floated: text to its edges
      const shape = /^[\d.% ,-]+$/.test(outline || "") ? `shape-outside:polygon(${outline}) content-box` : "";
      const out = outOf(b) ? `margin-${sideOf(b)}:calc(${-+(outOf(b) * 100).toFixed(3)}% - .9em)` : "";   // out=: past its panel's padding and edge
      const st = [sizeStyle(b.attrs), at, shift, shape, out].filter(Boolean).join(";");
      return `<figure class="rb-fig ${clsOf(b.attrs)}"${st ? ` style="${st}"` : ""}>${imgHtml(b, ctx)}</figure>`;
    }
    case "cards": return `<div class="rb-cards ${clsOf(b.attrs)}">${b.names.map(n => (n.arrow ? `<span class="rb-arrow" aria-hidden="true">→</span>` : cardHtml(n.name, n.label, ctx))).join("")}</div>`;
    case "list": {
      const tag = b.type === "ul" ? "ul" : "ol";
      const digits = Math.max(1, ...b.items.map(it => String(it.n ?? "").length));   // the numbers' room: "10." needs more than "9."
      const attr = tag === "ol" ? `${b.type !== "1" ? ` type="${b.type}"` : ""}${b.delim === ")" ? ' data-delim=")"' : ""}${digits > 1 ? ` style="--digits:${digits}"` : ""}` : "";
      return `<${tag} class="rb-list"${attr}>${b.items.map(it => `<li${tag === "ol" ? ` value="${it.n}"` : ""}>${inline(it.text, ctx)}${kidsHtml(it.children, ctx)}</li>`).join("")}</${tag}>`;
    }
    case "table": {
      // cols=-,red,green: a colour per column ("-" none)
      const cols = String(b.attrs?.cols || "").split(",").map(c => (COLOURS.has(c.trim()) ? ` class="rb-${c.trim()}"` : ""));
      const al = k => `${cols[k] || ""}${b.align[k] ? ` style="text-align:${b.align[k]}"` : ""}`;
      return `<div class="rb-table-wrap"><table class="rb-table ${clsOf(b.attrs)}">${b.head ? `<thead><tr>${b.head.map((h, k) => `<th${al(k)}>${inline(h, ctx)}</th>`).join("")}</tr></thead>` : ""}
        <tbody>${b.rows.map(r => `<tr>${r.map((c, k) => `<td${al(k)}>${inline(c, ctx)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    case "page": return `<div class="rb-break" aria-hidden="true"></div>`;
    default: return "";
  }
}

function fenceHtml(b, ctx) {
  const inner = kidsHtml(b.children, ctx), cls = clsOf(b.attrs);
  switch (b.kind) {
    case "row": {
      const w = (b.arg || "").split(/[\s:]+/).map(Number).filter(n => n > 0);
      const cols = b.children.filter(c => c.t !== "page" && !placed(c));
      const at = c => (c.t === "img" && ANCHORS.has(c.attrs?.anchor) ? ` rb-col-at rb-at-${c.attrs.anchor}` : "");   // {anchor=bottom-left}: where in its column
      return `<div class="rb-row ${cls}">${cols.map((c, k) => `<div class="rb-col${at(c)}"${w[k] ? ` style="flex:${w[k]} 1 0"` : ""}>${blockHtml(c, ctx)}</div>`).join("")}${b.children.filter(placed).map(c => blockHtml(c, ctx)).join("")}</div>`;
    }
    case "ability": {                                  // a card's ability box: centred lines, "1." a numbered bubble
      const lines = b.children.flatMap(c => (c.t === "p" ? c.text.split("\n") : c.t === "list" ? c.items.map(it => (c.type === "1" ? `${it.n}. ${it.text}` : it.text)) : []));
      return `<div class="rb-ability ${cls}">${lines.map(l => { const n = /^(\d+)\.\s+(.*)$/.exec(l); return `<p>${n ? `<span class="rb-num-bubble">${n[1]}</span>` : ""}${inline(n ? n[2] : l, ctx)}</p>`; }).join("")}</div>`;
    }
    case "panel": return b.arg ? blockHtml({ t: "section", title: b.arg, attrs: b.attrs, children: b.children }, ctx) : `<div class="rb-solo-wrap"><div class="rb-panel rb-solo${holds(b.children, ctx) ? " rb-holds" : ""} ${cls}"${hangOf(b.children) ? ` style="${hangOf(b.children)}"` : ""}>${inner}</div></div>`;
    case "box": return `<div class="rb-box ${cls}">${inner}</div>`;
    case "contents": return `<ol class="rb-contents ${cls}">${(ctx.chapters || []).filter(c => Number(c.num) > 0).map(c => `<li value="${Number(c.num)}"><a href="#/rules/${esc(c.id)}" data-scroll="${esc(c.id)}">${esc(c.title)}</a></li>`).join("")}</ol>${inner}`;
    case "small": case "center": case "note": return `<div class="rb-${b.kind} ${cls}">${inner}</div>`;
    default: return `<div class="rb-${b.kind.replace(/[^\w-]/g, "")} ${cls}">${inner}</div>`;
  }
}

/** A chapter for the web: its header bar (number and title) and its blocks */
export function chapterHtml(ch, ctx) {
  const ast = ch.ast || parse(ch.source);
  const n = Number(ch.num);
  return `<header class="rb-head">${n > 0 ? `<span class="rb-num">${n}</span>` : ""}<h2>${inline(ast.title || ch.title, ctx)}</h2></header>${kidsHtml(ast.blocks, { ...ctx, id: ch.id })}`;
}

/** The sections of a chapter, for the contents: [{title, anchor}] */
export const sectionsOf = ch => (ch.ast || parse(ch.source)).blocks.flatMap(b => (b.t === "section" ? [b] : b.t === "fence" ? b.children.filter(c => c.t === "section") : []))
  .map(s => ({ title: titleText(s.title), anchor: `${ch.id}--${slugify(titleText(s.title))}` }));
/** a heading's words: markup and icon tokens dropped */
export const titleText = t => plainText({ blocks: [{ t: "p", text: String(t || "").replace(/\[[^[\]\n]{1,52}\](?![({])/g, "") }] }).replace(/\s+/g, " ").trim();

// ---- TTS sheets ---------------------------------------------------------------------------------------------------
// The book cut into SHEET-sized pages in a host element (laid out, so it can measure): each chapter starts a page; its
// first page reads "STATS", the next "STATS 2", as the Photoshop pages did, numbered 7, 7.2...; a block that overflows
// takes the rest of its page (up to the next "=== page ===") with it when the page's text a little smaller (to 80%)
// fits them all, else is kept whole that way (to 88%), else split between its children (a section's blocks, a
// list's items, a table's rows), else drawn smaller (to 70%: a row or a picture), else moved on; one taller than a whole
// page is shrunk to fit. Returns [{name, num, ch (the chapter's number as in its file), n (its page), el}].
export function paginate(host, chapters, ctx, { cover = "" } = {}) {
  host.innerHTML = "";
  const sheets = [];
  if (cover) { const el = sheetEl(""); el.classList.add("rb-cover-sheet"); el.querySelector(".rb-body").innerHTML = `<img src="${esc(cover)}" alt="">`; el.querySelector(".rb-head").remove(); host.append(el); sheets.push({ name: "Cover", num: "", el }); }
  for (const ch of chapters) {
    const ast = ch.ast || parse(ch.source), title = ast.title || ch.title, c = { ...ctx, id: "" };
    let n = 0, body = null;
    const fresh = () => {
      n++;
      const el = sheetEl(`${inline(title, c)}${n > 1 ? ` ${n}` : ""}`, Number(ch.num) > 0 ? `${Number(ch.num)}${n > 1 ? `.${n}` : ""}` : "");
      host.append(el); body = el.querySelector(".rb-body");
      const h2 = el.querySelector("h2");                 // one line: a long title is drawn smaller
      for (let f = 3.1; f > 1.6 && h2.scrollWidth > h2.clientWidth + 1; f -= 0.1) h2.style.fontSize = `${f.toFixed(1)}em`;
      sheets.push({ name: `${title}${n > 1 ? ` ${n}` : ""}`, num: Number(ch.num) > 0 ? `${Number(ch.num)}${n > 1 ? `.${n}` : ""}` : "", ch: ch.num, n, el });
    };
    fresh();
    const over = () => body.scrollHeight > body.clientHeight + 1;
    const draw = b => { const t = document.createElement("template"); t.innerHTML = blockHtml(b, c).trim(); return t.content.firstElementChild || document.createElement("div"); };
    const tryPut = b => { const el = draw(b); body.append(el); if (!over()) return true; el.remove(); return false; };
    // the largest head of b that fits ([head, tail]), or null
    const split = b => {
      const kids = kidsOf(b);
      if (!kids || kids.length < 2 && !(kids.length === 1 && kidsOf(kids[0]))) return null;
      let k = 0;
      while (k < kids.length && tryPut(withKids(b, kids.slice(0, k + 1)))) { body.lastElementChild.remove(); k++; }
      if (k === 0) {                                   // not even its first child: split that one
        const inner = split1(kids[0], b);
        return inner;
      }
      return [withKids(b, kids.slice(0, k)), k < kids.length ? withKids(b, kids.slice(k), true) : null];
    };
    const split1 = (kid, parent) => {
      const sub = kidsOf(kid);
      if (!sub || sub.length < 2) return null;
      let k = 0;
      while (k < sub.length && tryPut(withKids(parent, [withKids(kid, sub.slice(0, k + 1))]))) { body.lastElementChild.remove(); k++; }
      if (k === 0) return null;
      return [withKids(parent, [withKids(kid, sub.slice(0, k))]), withKids(parent, [withKids(kid, sub.slice(k), true), ...kidsOf(parent).slice(1)], true)];
    };
    // blocks whole on this page with the page's text a little smaller (to least): true when they fit
    const tight = (list, least) => {
      const base = parseFloat(getComputedStyle(body.parentElement).fontSize), now = parseFloat(getComputedStyle(body).fontSize) / base, was = body.style.fontSize;
      for (const f of [0.96, 0.92, 0.88, 0.84, 0.8].filter(x => x < now - 0.001 && x >= least)) {
        body.style.fontSize = `${(base * f).toFixed(1)}px`;
        const els = list.map(x => { const el = draw(x); body.append(el); return el; });
        if (!over()) return true;
        for (const el of els) el.remove();
      }
      body.style.fontSize = was; return false;
    };
    const rest = b => { const seg = [b]; for (const x of queue) { if (x.t === "page") break; seg.push(x); } return seg; };
    // a row, picture or callout drawn smaller to fit
    const squeeze = b => {
      if (kidsOf(b) || b.t === "p") return false;
      const el = draw(b); body.append(el);
      for (let z = 0.95; z > 0.69; z -= 0.05) { el.style.zoom = z.toFixed(2); if (!over()) return true; }
      el.remove(); return false;
    };
    const queue = [...ast.blocks];
    let guard = 0;
    while (queue.length && guard++ < 5000) {
      const b = queue.shift();
      if (b.t === "page") { if (body.children.length) fresh(); continue; }
      if (tryPut(b)) continue;
      const seg = rest(b);
      if (seg.length > 1 && tight(seg, 0.8)) { queue.splice(0, seg.length - 1); continue; }
      if (tight([b], 0.88)) continue;
      const parts = split(b);
      if (parts) { body.append(draw(parts[0])); if (parts[1]) queue.unshift(parts[1]); fresh(); continue; }
      if (squeeze(b)) continue;
      if (body.children.length) { fresh(); queue.unshift(b); continue; }
      const el = draw(b); body.append(el); shrink(el, over);   // taller than a page on its own
      fresh();
    }
    if (!body.children.length) { body.closest(".rb-sheet").remove(); sheets.pop(); }   // a trailing empty page
  }
  // the contents' page numbers (the PDF's, 1 the first page), for flipping to a chapter in TTS
  const first = {};
  sheets.forEach((s, k) => { if (s.ch != null && s.n === 1 && first[Number(s.ch)] == null) first[Number(s.ch)] = k + 1; });
  for (const li of host.querySelectorAll(".rb-contents li[value]")) {
    const page = first[Number(li.getAttribute("value"))];
    if (page) li.insertAdjacentHTML("beforeend", `<span class="rb-toc-page">${page}</span>`);
  }
  return sheets;
}
function sheetEl(title, num = "") {
  const t = document.createElement("template");
  t.innerHTML = `<div class="rb rb-sheet"><header class="rb-head"><h2>${title}</h2></header><div class="rb-body"></div>${num ? `<span class="rb-pnum">${esc(num)}</span>` : ""}</div>`;
  return t.content.firstElementChild;
}
const kidsOf = b => (b.t === "section" || b.t === "fence" && ["panel", "box", "small", "center", "note"].includes(b.kind) ? b.children : b.t === "list" ? b.items : b.t === "table" ? b.rows : null);
function withKids(b, kids, cont = false) {
  if (b.t === "list") return { ...b, items: kids };
  if (b.t === "table") return { ...b, rows: kids };
  return { ...b, children: kids, cont: cont || b.cont };
}
function shrink(el, over) {
  for (let z = 0.95; z > 0.3 && over(); z -= 0.05) el.style.zoom = z.toFixed(2);
}

// ---- history (app.js "rb-history"): a file's commits on GitHub, each as a git-style diff against its parent (renames
// followed), changed words marked. GitHub's API without a sign-in (60 requests an hour), the texts from raw.
const API = "https://api.github.com/repos/";
const CONTEXT = 3;                                     // unchanged lines around each change
/** The line diff of two texts: [{t: "=" | "-" | "+", a, b, text}] (a, b: 1-based line numbers; LCS) */
export function lineDiff(before, after) {
  const A = before === "" ? [] : before.replace(/\n$/, "").split("\n"), B = after === "" ? [] : after.replace(/\n$/, "").split("\n");
  const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { out.push({ t: "=", a: ++i, b: ++j, text: A[i - 1] }); }
    else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { out.push({ t: "-", a: ++i, text: A[i - 1] }); }   // - before +, as git
    else { out.push({ t: "+", b: ++j, text: B[j - 1] }); }
  }
  return out;
}
/** The changes in hunks of CONTEXT lines: [{head: "@@ -a,n +b,m @@", lines}] */
export function hunks(ops) {
  const keep = ops.map((o, k) => o.t !== "=" || ops.slice(Math.max(0, k - CONTEXT), k + CONTEXT + 1).some(x => x.t !== "="));
  const out = [];
  let cur = null;
  ops.forEach((o, k) => {
    if (!keep[k]) { cur = null; return; }
    if (!cur) { cur = { lines: [] }; out.push(cur); }
    cur.lines.push(o);
  });
  for (const h of out) {
    const a = h.lines.filter(o => o.t !== "+"), b = h.lines.filter(o => o.t !== "-");
    const a0 = a[0]?.a ?? (h.lines[0].b - 1 + 0), b0 = b[0]?.b ?? 0;
    h.head = `@@ -${a.length ? a0 : Math.max(0, a0)},${a.length} +${b.length ? b0 : 0},${b.length} @@`;
  }
  return out;
}
// two lines' changed words: [old html, new html]
function wordPair(x, y) {
  const a = x.split(/(\s+)/), b = y.split(/(\s+)/), n = a.length, m = b.length;
  if (n * m > 60000) return [esc(x), esc(y)];
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, l = "", r = "";
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { l += esc(a[i]); r += esc(b[j]); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) r += `<ins>${esc(b[j++])}</ins>`;
    else l += `<del>${esc(a[i++])}</del>`;
  }
  return [l, r];
}
/** A diff as git shows it: hunk heads, old and new line numbers, - and + lines (a changed line's words marked) */
export function diffHtml(before, after) {
  const hs = hunks(lineDiff(before, after));
  if (!hs.length) return `<p class="muted">No change to the text.</p>`;
  const row = (o, html) => `<tr class="d${o.t === "=" ? "c" : o.t === "-" ? "d" : "a"}"><td class="ln">${o.a ?? ""}</td><td class="ln">${o.b ?? ""}</td><td class="sg">${o.t === "=" ? " " : o.t}</td><td class="tx">${html}</td></tr>`;
  return `<table class="rb-diff">${hs.map(h => {
    const rows = [], L = h.lines;
    for (let k = 0; k < L.length; k++) {
      const o = L[k];
      if (o.t === "-") {                               // a run of - then + lines: pair them for the words
        let e = k; while (e < L.length && L[e].t === "-") e++;
        let f = e; while (f < L.length && L[f].t === "+") f++;
        const dels = L.slice(k, e), adds = L.slice(e, f), pairs = Math.min(dels.length, adds.length);
        const html = dels.map((d, q) => (q < pairs ? wordPair(d.text, adds[q].text) : [esc(d.text)]));
        dels.forEach((d, q) => rows.push(row(d, html[q][0])));
        adds.forEach((a, q) => rows.push(row(a, q < pairs ? html[q][1] : esc(a.text))));
        k = f - 1;
      } else rows.push(row(o, esc(o.text)));
    }
    return `<tbody><tr class="dh"><td colspan="3"></td><td>${esc(h.head)}</td></tr>${rows.join("")}</tbody>`;
  }).join("")}</table>`;
}
async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? "GitHub's hourly limit for visitors is reached: try again later, or open it on GitHub" : `GitHub ${r.status}`);
  return r.json();
}
async function rawText(repo, sha, path) {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`);
  return r.ok ? r.text() : null;
}
/** The history viewer in modal: path's commits on the left, the chosen one's diff on the right; revert (editors, app.js):
 *  an earlier version's Revert calls it with the commit and the file's text then, true once committed (the viewer closes) */
export async function openHistory({ repo, branch, path, title, modal, closeModal, dateText = d => new Date(d).toLocaleString(), revert = null }) {
  const gh = `https://github.com/${repo}/commits/${branch}/${path.split("/").map(encodeURIComponent).join("/")}`;
  modal.innerHTML = `<div class="dialog rbh" role="dialog" aria-modal="true" aria-label="History of ${esc(title)}">
    <header class="rbe-top"><h2>History: ${esc(title)}</h2><span class="rbe-state muted"><code>${esc(path)}</code></span>
      <a class="ghost button" href="${esc(gh)}" target="_blank" rel="noopener">On GitHub</a><button type="button" class="ghost icon" data-rbh="close" aria-label="Close">✕</button></header>
    <div class="rbh-cols"><nav class="rbh-list"><p class="muted">Loading the commits…</p></nav><div class="rbh-diff"></div></div></div>`;
  modal.hidden = false; document.body.style.overflow = "hidden";
  const list = modal.querySelector(".rbh-list"), pane = modal.querySelector(".rbh-diff");
  modal.querySelector('[data-rbh="close"]').addEventListener("click", () => closeModal());
  let commits;
  const url = sha => `${API}${repo}/commits?${sha ? `sha=${encodeURIComponent(sha)}&` : ""}path=${encodeURIComponent(path)}&per_page=60`;
  try { commits = await getJson(url(branch)).catch(e => (/ 404$/.test(e.message) ? getJson(url("")) : Promise.reject(e))); }   // a branch GitHub lacks: the default
  catch (e) { list.innerHTML = `<p class="muted">${esc(e.message)}.</p>`; return; }
  if (!commits.length) { list.innerHTML = `<p class="muted">No commits yet.</p>`; return; }
  list.innerHTML = commits.map((c, k) => `<button type="button" class="rbh-item${k ? "" : " on"}" data-k="${k}"><b>${esc(c.commit.message.split("\n")[0])}</b>
    <span class="muted">${esc(c.commit.author?.name || c.author?.login || "")} · ${esc(dateText(c.commit.committer?.date || c.commit.author?.date))}</span></button>`).join("");
  let shown = 0;                                       // the version picked last: a slower earlier pick never draws over it
  const show = async k => {
    shown = k;
    for (const b of list.querySelectorAll(".rbh-item")) b.classList.toggle("on", +b.dataset.k === k);
    const c = commits[k], parent = c.parents?.[0]?.sha;
    pane.innerHTML = `<p class="muted">Loading…</p>`;
    let before = parent ? await rawText(repo, parent, path) : "", from = path;
    if (before === null && parent) {                   // renamed in this commit (a chapter renumbered): its old name
      try { const f = (await getJson(`${API}${repo}/commits/${c.sha}`)).files?.find(x => x.filename === path); if (f?.previous_filename) { from = f.previous_filename; before = await rawText(repo, parent, from); } }
      catch { /* the rest still shows */ }
    }
    const text = await rawText(repo, c.sha, path), after = text ?? "";
    if (shown !== k) return;
    pane.innerHTML = `<div class="rbh-head"><b>${esc(c.commit.message.split("\n")[0])}</b><span class="muted">${esc(c.commit.author?.name || "")} · ${esc(dateText(c.commit.committer?.date || c.commit.author?.date))} ·
      <a href="${esc(c.html_url)}" target="_blank" rel="noopener"><code>${esc(c.sha.slice(0, 8))}</code></a>${from !== path ? ` · renamed from <code>${esc(from)}</code>` : ""}${before === null || !parent ? " · new file" : ""}</span>
      ${k && revert && text !== null ? `<button type="button" class="ver-revert" data-rbh="revert" title="Make this version the current one (one commit)">Revert to this version</button>` : ""}</div>
      ${diffHtml(before ?? "", after)}`;
    pane.querySelector('[data-rbh="revert"]')?.addEventListener("click", async e => {
      const b = e.currentTarget;
      b.disabled = true;
      try { if (await revert(c, text)) closeModal(); } finally { b.disabled = false; }
    });
  };
  list.addEventListener("click", e => { const b = e.target.closest(".rbh-item"); if (b) show(+b.dataset.k); });
  show(0);
}
