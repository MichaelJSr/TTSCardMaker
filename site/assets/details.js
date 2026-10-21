// The card page's Details dropdown: the PSD's structure as the bot read it (data/details/<id>.json, built from
// AutoCroissant's psd_details.json). DOM-free at import: app.js renders detailsHtml() into the dialog and mount()s it.
import { esc } from "./text.js";

const STATE_KEY = "psd-details";                         // sessionStorage: {details: open?, <section>: open?}
const STATS = [["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"]];
const ROWS = { template: "template digit row", "two-row": "Top + Bottom rows", pixel: "drawn bars, no digit rows", other: "something else", none: "none" };
const ICONS = { images: "image layers (Types/ names)", tokens: "icon-font tokens in the text", mixed: "image layers and tokens", none: "none" };
const TREE_DEPTH = 12;                                   // the record stops at 8; never recurse without end
const HEX = /^#[0-9a-f]{6}$/i;

const arr = v => (Array.isArray(v) ? v : []);
const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const ctl = s => String(s ?? "").replace(/[\x00-\x1f\x7f]+/g, " ");     // Photoshop's paragraph separators
const num = n => (Number.isFinite(+n) ? String(Math.round(+n * 100) / 100) : "");
const count = v => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : null);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const list = items => (items.length ? `<ul class="plain">${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">None.</p>`);
// a section the bot couldn't read is a short string; a missing one was never recorded
const part = (v, render) => (v === undefined ? `<p class="muted">Not recorded.</p>` : typeof v === "string" ? `<p class="muted">${esc(v)}</p>` : render(v));
const sec = (id, title, n, body, state, attrs = "") => `<details class="sec" data-sec="${id}"${state[id] ? " open" : ""}${attrs}><summary>${esc(title)}${n != null ? ` <span class="muted">${n}</span>` : ""}</summary><div>${body}</div></details>`;

export function readState(storage) {
  try { const s = JSON.parse(storage.getItem(STATE_KEY) || "{}"); return s && typeof s === "object" && !Array.isArray(s) ? s : {}; } catch { return {}; }
}
export function writeState(storage, state) {
  try { storage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage off */ }
}

/** The dropdown as the dialog renders it: closed unless the session left it open; the body is fetched on first open. */
export const detailsHtml = state => `<details class="psd-details"${state.details ? " open" : ""}><summary>Details</summary><div class="psd-body"><p class="muted">Loading…</p></div></details>`;

const fontsHtml = fonts => {
  const names = Object.keys(obj(fonts));
  if (!names.length) return `<p class="muted">No visible text layers.</p>`;
  return names.map(n => {
    const f = obj(fonts[n]), layers = arr(f.layers);
    const flag = f.supplied === false ? ` <span class="fact refused">missing from MDW/Fonts</span>` : f.supplied == null ? ` <span class="muted">not checked</span>` : "";
    return `<details class="font"><summary><code>${esc(n)}</code>${flag} <span class="muted">${plural(layers.length, "layer")}</span></summary>${list(layers)}</details>`;
  }).join("");
};
const textHtml = text => {
  const rows = arr(text).map(obj);
  if (!rows.length) return `<p class="muted">No text layers.</p>`;
  return `<div class="table-wrap"><table><tr><th>Layer</th><th>Text</th><th>Font</th><th>Size</th><th>Colour</th><th>Visible</th></tr>${rows.map(t => {
    const color = HEX.test(t.color || "") ? t.color.toLowerCase() : "";
    return `<tr${t.visible === false ? ' class="off"' : ""}><td>${esc(t.layer)}</td><td class="wrap">${esc(ctl(t.text))}</td><td><code>${esc(t.font ?? "")}</code></td><td class="num">${t.size != null ? num(t.size) : ""}</td><td>${color ? `<i class="swatch" style="background:${color}"></i>${color}` : ""}</td><td>${t.visible === false ? "hidden" : "yes"}</td></tr>`;
  }).join("")}</table></div>`;
};
const effectsHtml = effects => {
  const entries = Object.entries(obj(effects));
  if (!entries.length) return `<p class="muted">No layer effects.</p>`;
  return `<dl class="pairs">${entries.map(([layer, fx]) => `<dt>${esc(layer)}</dt><dd>${arr(fx).map(f => (/\(off\)$/.test(f) ? `<span class="muted">${esc(f)}</span>` : esc(f))).join(", ")}</dd>`).join("")}</dl>`;
};
const canvasHtml = c => {
  c = obj(c);
  return `<p>${[c.w != null && c.h != null ? `${esc(c.w)} × ${esc(c.h)} px` : "", c.mode ? esc(c.mode) : "", c.depth != null ? `${esc(c.depth)}-bit` : "",
    `ICC profile: ${c.icc ? esc(c.icc) : "none"}`].filter(Boolean).join(" · ")}</p>`;
};
const iconsHtml = icons => `<p>${esc(ICONS[icons] || icons)}</p>`;
const statsHtml = stats => {
  stats = obj(stats);
  return `<dl class="pairs">${STATS.map(([k, l]) => `<dt>${l}</dt><dd>${esc((Object.hasOwn(ROWS, stats[k]) ? ROWS[stats[k]] : stats[k]) || "not recorded")}</dd>`).join("")}</dl>`;
};
const wordsHtml = (fx, overlays) => `<p class="muted">FX layers (" FX: " in the name)</p>${part(fx, v => list(arr(v)))}<p class="muted">Overlay word layers (a short text laid over the ability box)</p>${part(overlays, v => list(arr(v)))}`;
const templateHtml = t => {
  t = obj(t);
  const dev = arr(t.deviations);
  return `<dl class="pairs"><dt>Name layer</dt><dd>${t.name_layer ? esc(t.name_layer) : `<span class="muted">none</span>`}</dd><dt>Ability layers</dt><dd>${arr(t.ability_layers).map(esc).join(", ") || `<span class="muted">none</span>`}</dd></dl>
    ${dev.length ? `<p class="muted">Deviations from the template</p>${list(dev)}` : `<p class="muted">Follows the template.</p>`}`;
};
/** What cards.json already says: the parser's notes and the PSD-vs-edited values (same wording as the card page). */
const parserHtml = (card, extras) => {
  const c = obj(card), labels = obj(extras?.labels), orig = obj(c.orig);
  const problems = arr(c.problems), edited = arr(c.edited);
  const fields = edited.filter(f => f in orig && f in labels), other = edited.filter(f => !fields.includes(f));
  const show = v => (v == null ? "—" : Array.isArray(v) ? v.join(", ") : String(v));
  const parts = [];
  if (problems.length) parts.push(`<p>Parser notes: ${problems.map(esc).join(" · ")}</p>`);
  if (fields.length) parts.push(`<table><tr><th>Field</th><th>On the card (PSD)</th><th>Edited on the website</th></tr>${fields.map(f => `<tr><td>${esc(labels[f])}</td><td class="wrap">${esc(show(orig[f]))}</td><td class="wrap">${esc(show(c[f]))}</td></tr>`).join("")}</table>`);
  if (other.length) parts.push(`<p class="muted">Also edited: ${other.map(esc).join(", ")}</p>`);
  if (extras?.badges) parts.push(`<div class="facts">${extras.badges}</div>`);
  return parts.join("") || `<p class="muted">No parser notes; nothing edited.</p>`;
};
/** The compact layer tree [name, kind, visible, children?], children bottom to top as Photoshop stacks them. */
export function treeHtml(tree, depth = 0) {
  const nodes = arr(tree);
  if (!nodes.length) return depth ? "" : `<p class="muted">Empty.</p>`;
  if (depth >= TREE_DEPTH) return `<ul class="tree"><li class="off">… more</li></ul>`;
  return `<ul class="tree">${nodes.map(n => {
    if (!Array.isArray(n)) return "";
    const [name, kind, visible, kids] = n;
    if (kind === "more") return `<li class="off">… more</li>`;
    return `<li${visible === false ? ' class="off"' : ""}>${esc(name)} <span class="kind">${esc(kind ?? "")}</span>${Array.isArray(kids) ? treeHtml(kids, depth + 1) : ""}</li>`;
  }).join("")}</ul>`;
}

/**
 * The dropdown's body: one nested <details> per section.
 * @param rec the record (data/details/<id>.json)
 * @param card the cards.json entry (parser notes, orig/edited)
 * @param extras {badges: the card page's PSD chips (html), labels: field labels}
 * @param state which sections the session left open
 */
export function bodyHtml(rec, card, extras, state = {}) {
  const r = obj(rec);
  const head = [r.at ? `PSD read ${esc(String(r.at).slice(0, 10))}` : "", r.parser != null ? `parser v${esc(r.parser)}` : "", r.path ? esc(r.path) : ""].filter(Boolean).join(" · ");
  const n = v => (typeof v === "string" ? null : count(v));
  return `${head ? `<p class="muted">${head}</p>` : ""}${[
    sec("fonts", "Fonts", n(r.fonts), part(r.fonts, fontsHtml), state),
    sec("text", "Text layers", n(r.text), part(r.text, textHtml), state),
    sec("effects", "Effects", n(r.effects), part(r.effects, effectsHtml), state),
    sec("smart", "Smart objects", n(r.smart_objects), part(r.smart_objects, v => list(arr(v))), state),
    sec("canvas", "Canvas", null, part(r.canvas, canvasHtml), state),
    sec("icons", "Type icons", null, Object.hasOwn(ICONS, r.icons) ? iconsHtml(r.icons) : part(r.icons === undefined ? undefined : String(r.icons), () => ""), state),   // a value is a string too
    sec("stats", "Stat rows", null, part(r.stats, statsHtml), state),
    sec("words", "Status-word layers", (n(r.fx) ?? 0) + (n(r.overlays) ?? 0), wordsHtml(r.fx, r.overlays), state),
    sec("template", "Template", null, part(r.template, templateHtml), state),
    sec("parser", "Parser", null, parserHtml(card, extras), state),
    sec("tree", "Layer tree", n(r.tree), state.tree ? part(r.tree, treeHtml) : `<div class="tree-slot"></div>`, state, state.tree ? ' data-done="1"' : ""),
  ].join("")}`;
}

/**
 * Wire a rendered dropdown: remember open/closed per session (the sections too), fetch the record on first open, and
 * render the layer tree only when its section opens.
 * @param el the <details class="psd-details"> element
 * @param load () => promise of the record (memoised by the caller, so a reopened dialog doesn't fetch again)
 */
export function mount(el, { card, load, storage, extras }) {
  const state = readState(storage);
  let rec = null, loading = null;
  const body = () => el.querySelector(".psd-body");
  const render = () => (loading ||= load().then(r => { rec = r; body().innerHTML = bodyHtml(r, card, extras, state); },
    e => { loading = null; body().innerHTML = `<p class="muted">Couldn't load the PSD details (${esc(e.message)}). Close and open again to retry.</p>`; }));
  el.addEventListener("toggle", e => {                   // capture: toggle doesn't bubble, so one listener serves the sections too
    const t = e.target, key = t === el ? "details" : t.dataset?.sec;
    if (!key) return;
    state[key] = !!t.open; writeState(storage, state);
    if (t === el) { if (t.open) render(); return; }
    if (key === "tree" && t.open && rec && !t.dataset.done) { t.dataset.done = "1"; const slot = t.querySelector(".tree-slot"); if (slot) slot.innerHTML = part(rec.tree, treeHtml); }
  }, true);
  if (el.open) render();
}
