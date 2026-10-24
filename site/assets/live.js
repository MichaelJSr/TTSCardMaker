// The Edit dialog's live preview: the card as it will look once published, from the form's op. NOTES.md §21.
import { esc } from "./text.js";

const STATS = ["hp", "def", "atk", "spd"];
// printed on the card image (edit.js FROM "PSD", build_site.py PSD_FIELDS): an edit there waits for the image ("PSD pending")
export const PSD_FIELDS = ["name", "stars", "types", "hp", "def", "atk", "spd", "ability"];
const LABEL = { name: "Name", stars: "Stars", types: "Types", hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", ability: "Ability" };
const typeKey = t => String(t).toLowerCase().replace(/[\s_]+/g, "");
const sameValue = (f, a, b) => (f === "types" ? JSON.stringify([...(a || [])].map(typeKey).sort()) === JSON.stringify([...(b || [])].map(typeKey).sort())
  : f === "ability" ? String(a ?? "").replace(/\r/g, "").trim() === String(b ?? "").replace(/\r/g, "").trim() : JSON.stringify(a ?? null) === JSON.stringify(b ?? null));

/** The published card b with the form's values: {field: value} (edit.js readForm's set, its unset fields as their PSD
 *  values), author (op.author: undefined = unchanged, null = from git). psd(f): field f's PSD value, for "PSD pending"
 *  (the card's own pending fields stay unless the form puts them back). Applies the values as edit.js setField does,
 *  without the side data (duplicate links, the ban list). */
export function previewCard(b, values, author, psd = () => undefined) {
  const p = structuredClone(b);
  for (const [f, v] of Object.entries(values)) {
    if (f === "creatures") { if (v?.length > 1) { p.creatures = v; for (const k of STATS) p[k] = v[0][k] ?? undefined; } else delete p.creatures; }
    else if (f === "aliases") { const bot = (b.aliases || []).filter(a => !(b.webAliases || []).includes(a)); p.webAliases = v || []; p.aliases = [...bot, ...(v || []).filter(a => !bot.includes(a))]; }
    else if (f === "dup_of") continue;
    else if (v == null || v === false) delete p[f];
    else p[f] = Array.isArray(v) ? [...v] : v;
  }
  if (author !== undefined) p.author = author || b.author;
  const pending = new Set(b.pending || []);
  for (const f of PSD_FIELDS) if (f in values) { if (values[f] != null && !sameValue(f, values[f], psd(f))) pending.add(f); else pending.delete(f); }
  if (pending.size) p.pending = PSD_FIELDS.filter(f => pending.has(f)); else delete p.pending;
  return p;
}
/** The fields the preview marks as changed: those in values that differ from the published card's, and the author. */
export const changedFields = (b, values, author) => new Set([...Object.entries(values).filter(([f, v]) => !sameValue(f, v, f === "aliases" ? b.webAliases : b[f])).map(([f]) => (STATS.includes(f) || f === "creatures" ? "stats" : f)),
  ...(author !== undefined ? ["author"] : [])]);

/** The preview's markup for card p. changed: changedFields. ctx: {render(text, name), statBars(c), iconFor(name) ->
 *  {file}, kindLabel {type: label}, image(c) -> url or ""}. */
export function previewHtml(p, changed, ctx) {
  const mark = (f, cls = "") => `${cls}${changed.has(f) ? `${cls ? " " : ""}lp-changed` : ""}`;
  const fact = (f, html) => (html ? `<span class="fact${changed.has(f) ? " lp-changed" : ""}">${html}</span>` : "");
  const src = ctx.image(p);
  const types = (p.types || []).map(t => { const ic = ctx.iconFor(t); return ic ? `<img src="${esc(ic.file)}" alt="${esc(t)}" title="${esc(t.replace(/_/g, " "))}">` : `<span class="fact">${esc(t)}</span>`; }).join("");
  const pending = (p.pending || []).map(f => LABEL[f] || f).join(", ");
  return `<div class="lp-card">
    <div class="lp-top">${src ? `<img class="lp-img" src="${esc(src)}" alt="" data-preview-image>` : ""}
      <div class="lp-head"><h2 class="${mark("name", "lp-name")}">${esc(p.name)}</h2>
        <div class="facts">${fact("type", esc(ctx.kindLabel[p.type] || p.type || ""))}${fact("subtype", p.subtype ? esc(p.subtype[0].toUpperCase() + p.subtype.slice(1)) : "")}
          ${fact("stars", p.stars ? `<span class="stars">${"★".repeat(Math.min(p.stars, 10))}</span> ${p.stars}-star` : "")}${fact("series", esc(p.series || ""))}${fact("subseries", esc(p.subseries || ""))}
          ${fact("author", p.author ? `by ${esc(p.author)}` : "")}${p.hidden ? `<span class="fact${changed.has("hidden") ? " lp-changed" : ""}">Hidden</span>` : ""}
          ${pending ? `<span class="fact pending">PSD pending: ${esc(pending)}</span>` : ""}</div></div></div>
    ${types ? `<div class="${mark("types", "ctypes")}">${types}</div>` : changed.has("types") ? `<p class="muted lp-changed">No types.</p>` : ""}
    <div class="${mark("stats", "lp-stats")}">${ctx.statBars(p)}</div>
    ${p.ability ? `<div class="${mark("ability", "ability")}">${ctx.render(p.ability, p.name)}</div>` : `<p class="muted lp-noability${changed.has("ability") ? " lp-changed" : ""}">No ability text.</p>`}
    ${p.note ? `<div class="${mark("note", "note")}"><b>Note</b> ${ctx.render(p.note, p.name)}</div>` : ""}
    ${p.aliases?.length ? `<p class="muted lp-aka${changed.has("aliases") ? " lp-changed" : ""}">Also known as: ${p.aliases.map(esc).join(", ")}</p>` : ""}
  </div>`;
}
// the preview's block for each form field (#ef-<field>), shown when that field is typed in
const BLOCK = { name: "h2", ability: ".ability, .lp-noability", note: ".note", types: ".ctypes", hp: ".lp-stats", def: ".lp-stats", atk: ".lp-stats", spd: ".lp-stats",
  stars: ".facts", type: ".facts", subtype: ".facts", series: ".facts", subseries: ".facts", author: ".facts", aliases: ".lp-aka" };
/** The preview's selector for form field f (null: none). */
export const blockOf = f => BLOCK[f] || (f === "creatures" ? ".lp-stats" : null);
/** Scroll the pane so field f's block shows (it scrolls when the preview is longer than its box: always on narrow screens). */
export function reveal(pane, f) {
  const sel = blockOf(f), el = sel && pane?.querySelector(`#lp-body ${sel.split(", ").join(", #lp-body ")}`);
  if (!el) return;
  const box = [pane.querySelector("#lp-body"), pane].find(x => x && x.scrollHeight > x.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(x).overflowY));
  if (!box) return;
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - 8;
}
/** The pane around it: a heading (on narrow screens a button that opens and closes it), the card image's viewer (viewer: the
 *  image URL, ar: its "w/h"; preview.js adds the tabs) and the body. */
export const paneHtml = (open = false, { viewer = "", ar = "" } = {}) => `<aside class="lp-pane${open ? " open" : ""}" aria-label="Preview">
  <button type="button" class="lp-toggle ghost" aria-expanded="${open}" aria-controls="lp-body"><span>Preview</span> <span class="muted">as it will look once published</span><span class="lp-caret" aria-hidden="true">${open ? "▾" : "▸"}</span></button>
  <h3 class="egroup lp-title">Preview <span class="muted">as it will look once published</span></h3>
  ${viewer ? `<div class="iv iv-pane"><div class="iv-stage"><div class="iv-orig"><img src="${esc(viewer)}" alt=""${ar ? ` style="aspect-ratio:${esc(ar)}"` : ""}></div></div></div>` : ""}
  <div id="lp-body" class="lp-body" aria-live="off"></div></aside>`;
