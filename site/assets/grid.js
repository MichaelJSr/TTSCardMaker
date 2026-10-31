// The cards grid's tiles, toolbar and Name order: DOM-free, so the build renders them in node to check the first screen it
// writes into index.html (build_site.py first_screen, check_first.mjs).
import { esc, norm } from "./text.js";
import { artList } from "./art.js";

export const KIND_LABEL = { creature: "Creature", item: "Item", field: "Field card", minion: "Minion", nme: "N.M.E. item", "aux item": "Auxiliary item",
  debuff: "Debuff", buff: "Buff", creatures: "Auxiliary creature", unknown: "Other" };
// the kinds that come into play only through other cards (Auxiliary/): Unused when no chain of mentions reaches one
// from a card played on its own (app.js init)
export const AUX_KINDS = ["buff", "debuff", "minion", "aux item", "creatures"];
const AUX_WORD = { buff: "status effect", debuff: "status effect", minion: "minion", "aux item": "auxiliary item", creatures: "auxiliary creature" };
export const unusedTip = c => (c._unusedBy?.length ? `Only Unused cards name this ${AUX_WORD[c.type] || "card"}: ${esc(c._unusedBy.join(", "))}`
  : `No other card names this ${AUX_WORD[c.type] || "card"}`);
// edits the pipeline bakes into the card image (build_site.py PSD_FIELDS): pending, refused, or baked but not re-parsed yet
export const FIELD_LABEL = { name: "Name", stars: "Stars", types: "Types", hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", ability: "Ability" };
export const PSD_TIP = "The card image is being regenerated with this edit";     // the one tip for a pending PSD field (edit.js too)
export const pendingList = c => (c.pending || []).map(f => FIELD_LABEL[f] || f).join(", ");
export const stars = n => (n ? "★".repeat(Math.min(n, 10)) : "");
// tile size: [--tile, the picture's css px (sizes)]
export const TILE_SIZES = { s: ["130px", 160], m: ["168px", 200], l: ["230px", 270] };

/** a card picture's URL, 240 / 360 / 720 px wide (thumbs: cards.json's tags of their settings) */
export const thumb = (thumbs, c, w) => (c.img ? `thumbs/${c.img}-${w}-${thumbs[w]}.avif` : "");
/** <img> attributes for a card image shown about `css` px wide: the browser picks 240 or 360 (or 720) px by screen density */
export const imgAttrs = (thumbs, c, css, big = false) => { const u = w => thumb(thumbs, c, w);
  return `src="${u(360)}" srcset="${u(240)} 240w, ${u(360)} 360w${big ? `, ${u(720)} 720w` : ""}" sizes="${css}px"${c.tw ? ` width="${c.tw}" height="${c.th}"` : ""}`; };
const TILE_ART = 8 / 5;                      // a tile's picture box, height / width (style.css .tile .art); its corners 11 px round (.tile's 12 less its border)
/** A card whose art hangs out of its see-through edge (cards.json hang: the card's own box in the picture, [left, top,
 *  right, bottom] in fractions; build_site OVERHANG): style.css's --hw, --hm, --ha, --hc, the picture's width, margins,
 *  aspect ratio and clip that make the card fill its frame. tall: the frame's height / width (the picture cut off below
 *  it, as object-fit cuts every tile's), else the whole card shows. Percent margins are of the frame's width. The clip
 *  rounds the card's corners (radius: the frame's) where they are the picture's own, leaving the art that hangs out. */
export function hangVars(c, tall = 0, radius = 12) {
  const [l, t, r, b] = c.hang, w = r - l, k = c.th / c.tw / w, p = n => `${+(n * 100).toFixed(3)}%`;   // k: the picture's height per frame width
  const at = (x, y, dx = 0, dy = 0) => `calc(${p(x)} + ${+dx.toFixed(2)}px) calc(${p(y)} + ${+dy.toFixed(2)}px)`;
  // a corner's arc around (x, y) + (cx, cy) px, a quarter turn from q quarter turns (y down)
  const arc = (x, y, cx, cy, q) => Array.from({ length: 9 }, (_, i) => { const a = (q + i / 8) * Math.PI / 2;
    return at(x, y, cx + radius * Math.cos(a), cy + radius * Math.sin(a)); });
  const R = radius, top = t ? [] : [at(l, 0), ...arc(l, 0, R, R, 2), ...arc(r, 0, -R, R, 3), at(r, 0)];
  const bottom = tall || b < 1 ? [] : [at(r, 1), ...arc(r, 1, -R, -R, 0), ...arc(l, 1, R, -R, 1), at(l, 1)];
  return `--hw:${p(1 / w)};--hm:${p(-t * k)} 0 ${tall ? 0 : p(-(1 - b) * k)} ${p(-l / w)};--ha:${tall ? `${+(1 / w).toFixed(4)} / ${+(tall + t * k).toFixed(4)}` : `${c.tw} / ${c.th}`}` +
    `;--hc:polygon(0% 0%, ${[...top, "100% 0%", "100% 100%", ...bottom, "0% 100%"].join(", ")})`;
}
export const hangs = c => !!(c.hang && c.tw && c.th);
export const iconImg = (icons, name, cls = "tok") => { const ic = icons[norm(name)];
  return ic ? `<img class="${cls}" loading="lazy" src="${esc(ic.file)}" alt="${esc(name)}" data-tip="${esc(name.replace(/_/g, " "))}">` : ""; };

// [key, label, dir it sets]; "created" = the creation date (first Discord post or first upload), when the build has dates
export const SORTS = [["name", "Name"], ["stars", "Stars"], ["total", "Total stats"], ["hp", "HP"], ["def", "DEF"], ["atk", "ATK"], ["spd", "SPD"],
  ["new", "Recently updated"], ["created", "Newest created", ""], ["created", "Oldest created", "asc"], ["series", "Series"], ["type", "Kind"], ["mentioned", "Most referenced"]];
export const isDesc = (sort, dir) => (dir ? dir === "desc" : ["stars", "total", "hp", "def", "atk", "spd", "new", "created", "mentioned"].includes(sort));
export const nameKey = c => c.name.toLowerCase();
/** sort by key (or keys in turn), ties by name; a card without the value (null) goes last either way, those in name order */
export const byKey = (key, desc = false) => { const keys = [].concat(key), s = desc ? -1 : 1;
  return (a, b) => {
    for (const k of keys) { const x = k(a), y = k(b);
      if (x == null || y == null) return x == null && y == null ? a.name.localeCompare(b.name) : x == null ? 1 : -1;
      if (x !== y) return x < y ? -s : s; }
    return s * a.name.localeCompare(b.name);
  }; };

const STATS = ["hp", "def", "atk", "spd"];
// the Missing filter: [param value, label, title (no data-tip: a tap would leave it up), test]; lacking = absent, null, "" or []
let rated = c => c;                       // the card whose ratings a card shows (app.js: a duplicate's original)
export const ratedBy = f => { rated = f; };
export const MISSING = [
  ["series", "No series", "", c => !c.series],
  ["subseries", "No subseries", "", c => !c.subseries],
  ["types", "No types", "No type icons", c => !c.types?.length],
  ["ability", "No ability", "", c => !c.ability?.trim()],
  ["author", "No author", "No one credited", c => !c.author],
  ["stars", "No stars", "", c => !c.stars],
  ["stats", "No stats", "Creatures and minions missing HP, DEF, ATK or SPD", c => ["creature", "minion", "creatures"].includes(c.type) && STATS.some(k => c[k] == null)],
  ["itemtype", "No item type", "Items and auxiliary items without an item type", c => (c.type === "item" || c.type === "aux item") && !c.subtype],
  ["ratings", "No ratings", "Not rated for power or favorability", c => !rated(c).ratings?.length],
  ["art", "No artwork source", "", c => !artList(c).length],
];

// exclusions (a right-click or long press in the sidebar): x<key> params drop the cards that match any of their values;
// test(card, value) per key, flags from app.js
const STATUS = new Set(["debuff", "buff"]);
export const X_TESTS = {
  kind: (c, v) => c.type === v || (v === "status" && STATUS.has(c.type)),
  stars: (c, v) => c.stars === +v,
  sub: (c, v) => c.subtype === v,
  types: (c, v) => !!c.types?.includes(v),
  missing: (c, v) => !!MISSING.find(m => m[0] === v)?.[3](c),       // xmissing=series: has a series
  series: (c, v) => c.series === v,
  subseries: (c, v) => c.subseries === v,
  author: (c, v) => c.author === v,
};
export const X_KEYS = [...Object.keys(X_TESTS), "flags"];
const csv = (p, k) => (p.get(k) ? p.get(k).split(",").filter(Boolean) : []);
export const ONE = new Set(["series", "subseries", "author"]);     // single-value selects: a comma is part of the name
/** a key's excluded values */
export const xvals = (p, k) => (ONE.has(k) ? (p.get(`x${k}`) ? [p.get(`x${k}`)] : []) : csv(p, `x${k}`));
/** list without the cards the x-params name; flags: {flag: test(card)} */
export function dropExcluded(list, p, flags = {}) {
  for (const k of X_KEYS) {
    const vs = xvals(p, k), t = k === "flags" ? (c, v) => !!flags[v]?.(c) : X_TESTS[k];
    if (vs.length) list = list.filter(c => !vs.some(v => t(c, v)));
  }
  return list;
}
/** a filter value's [include, exclude] lists after a click (neutral -> in -> neutral; excluded -> neutral) or an exclude
 *  (a right-click: in or neutral -> excluded -> neutral) */
export function flip(inc, exc, v, exclude = false) {
  if (exc.includes(v)) return [inc, exc.filter(x => x !== v)];
  if (exclude) return [inc.filter(x => x !== v), [...exc, v]];
  return [inc.includes(v) ? inc.filter(x => x !== v) : [...inc, v], exc];
}

/** env: { thumbs, icons, dupName(id), inDeck(id) }. A tile links to the card's page (a plain click opens the dialog:
 *  app.js; edit mode's markTiles drops the href). link: a plain link, no flag or deck button (the tiles index.html
 *  carries before the script runs); href false: no link (a picker's choice) */
export function tileHtml(c, { small = false, eager = false, css = 190, constructed = false, link = false, href = true } = {}, env) {
  const inDeck = !link && env.inDeck(c.id), url = `c/${encodeURIComponent(c.id)}/`, label = `aria-label="${esc(c.name)}"`;
  const hang = c.img && hangs(c), cls = `tile${hang ? " hang" : ""}`;
  return `${link ? `<a class="${cls}" href="${url}" ${label}>` : href ? `<a class="${cls}" href="${url}" data-open="${c.id}" ${label}>` : `<article class="${cls}" data-open="${c.id}" tabindex="0" ${label}>`}
    ${c.img ? `<img class="art" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" ${imgAttrs(env.thumbs, c, small ? 120 : css)}${hang ? ` style="${hangVars(c, TILE_ART, 11)}"` : ""} alt="">` : `<div class="art"></div>`}
    ${link ? "" : constructed && c._banned ? `<span class="flag banned" data-tip="Banned in constructed: ${esc(c._banned)}">Banned</span>`
      : c._staged ? `<span class="flag staged" data-tip="Changed in your unpublished batch">Unpublished</span>`
      : c.hidden ? `<span class="flag" data-tip="Hidden from the website">Hidden</span>`
      : c.refused ? `<span class="flag refused" data-tip="Image update refused: ${esc(c.refused)}">Image update refused</span>`
      : c.pending?.length ? `<span class="flag pending" data-tip="${PSD_TIP}: ${esc(pendingList(c))}">PSD pending</span>`
      : c.reparsePending ? `<span class="flag" data-tip="The PSD changed since the card data was built">Re-parse pending</span>`
      : !c.parsed ? `<span class="flag" data-tip="Not in the card data yet">New</span>`
      : c._unused ? `<span class="flag unused" data-tip="${unusedTip(c)}">Unused</span>`
      : c.dup ? `<span class="flag" data-tip="Duplicate of ${esc(env.dupName(c.dup) || "")}: the same card, counted once">Duplicate</span>` : ""}
    ${small || link ? "" : `<button type="button" class="add${inDeck ? " in" : ""}" data-action="deck-toggle" data-id="${c.id}">${inDeck ? "✓ In deck" : "+ Deck"}</button>`}
    <div class="meta"><div class="name">${esc(c.name)}</div>
    <div class="sub">${c.stars ? `<span class="stars">${stars(c.stars)}</span>` : ""}${small ? "" : `<span>${esc(KIND_LABEL[c.type] || c.type)}</span>`}${small ? "" : (c.types || []).slice(0, 3).map(t => iconImg(env.icons, t, "")).join("")}</div></div>${link || href ? "</a>" : "</article>"}`;
}

/** the grid's toolbar; sort: the shown sort, dir: the dir param, created: the build has creation dates, tail: edit mode's
 *  and Compare's controls */
export function toolbarHtml({ count, waiting = false, active = 0, sort, dir = "", created, view, size, tail = "" }) {
  return `<div class="toolbar">
        <span class="result-count">${waiting ? "…" : `${count.toLocaleString()} card${count === 1 ? "" : "s"}`}</span>
        <button type="button" class="mobile-only" data-action="toggle-filters">Filters${active ? ` (${active})` : ""}</button>
        <label class="muted">Sort <select data-action="select-param" data-key="sort">${SORTS.filter(([v]) => v !== "created" || created).map(([v, l, d]) =>
          `<option value="${v}"${d !== undefined ? ` data-dir="${d}"` : ""}${v === sort && (d === undefined || (d === "asc") !== isDesc(sort, dir)) ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <button type="button" class="ghost icon" data-action="flip-dir" title="Reverse order" aria-label="Reverse order">⇅</button>
        <span class="seg">${[["grid", "Grid"], ["table", "Table"]].map(([v, l]) => `<button type="button" class="${v === view ? "on" : ""}" data-action="set-pref" data-key="view" data-value="${v}">${l}</button>`).join("")}</span>
        ${view === "grid" ? `<span class="seg">${[["s", "S"], ["m", "M"], ["l", "L"]].map(([v, l]) => `<button type="button" class="${v === size ? "on" : ""}" data-action="set-pref" data-key="size" data-value="${v}" title="Tile size">${l}</button>`).join("")}</span>` : ""}
        <button type="button" class="ghost" data-action="random-from-list" title="Random result">Random</button>
        ${tail}
      </div>`;
}
