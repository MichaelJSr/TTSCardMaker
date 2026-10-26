// The cards grid's tiles, toolbar and Name order (app.js draws the grid with them).
import { esc, norm } from "./text.js";

export const KIND_LABEL = { creature: "Creature", item: "Item", field: "Field card", minion: "Minion", nme: "N.M.E. item", "aux item": "Auxiliary item",
  debuff: "Debuff", buff: "Buff", creatures: "Auxiliary creature", unknown: "Other" };
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
export const MISSING = [
  ["series", "No series", "", c => !c.series],
  ["subseries", "No subseries", "", c => !c.subseries],
  ["types", "No types", "No type icons", c => !c.types?.length],
  ["ability", "No ability", "", c => !c.ability?.trim()],
  ["author", "No author", "No one credited", c => !c.author],
  ["stars", "No stars", "", c => !c.stars],
  ["stats", "No stats", "Creatures and minions missing HP, DEF, ATK or SPD", c => ["creature", "minion", "creatures"].includes(c.type) && STATS.some(k => c[k] == null)],
  ["itemtype", "No item type", "Items without an item type", c => c.type === "item" && !c.subtype],
  ["ratings", "No ratings", "Not rated for power or favorability", c => !c.ratings?.length],
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

/** env: { thumbs, icons, dupName(id), inDeck(id) }; link: a plain link to the card's page, no flag or deck button (the
 *  tiles index.html carries before the script runs) */
export function tileHtml(c, { small = false, eager = false, css = 190, constructed = false, link = false } = {}, env) {
  const inDeck = !link && env.inDeck(c.id);
  return `${link ? `<a class="tile" href="c/${encodeURIComponent(c.id)}/" aria-label="${esc(c.name)}">` : `<article class="tile" data-open="${c.id}" tabindex="0" aria-label="${esc(c.name)}">`}
    ${c.img ? `<img class="art" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" ${imgAttrs(env.thumbs, c, small ? 120 : css)} alt="">` : `<div class="art"></div>`}
    ${link ? "" : constructed && c._banned ? `<span class="flag banned" data-tip="Banned in constructed: ${esc(c._banned)}">Banned</span>`
      : c._staged ? `<span class="flag staged" data-tip="Changed in your unpublished batch">Unpublished</span>`
      : c.hidden ? `<span class="flag" data-tip="Hidden from the website">Hidden</span>`
      : c.refused ? `<span class="flag refused" data-tip="Image update refused: ${esc(c.refused)}">Image update refused</span>`
      : c.pending?.length ? `<span class="flag pending" data-tip="${PSD_TIP}: ${esc(pendingList(c))}">PSD pending</span>`
      : c.reparsePending ? `<span class="flag" data-tip="The PSD changed since the card data was built">Re-parse pending</span>`
      : !c.parsed ? `<span class="flag" data-tip="Not in the card data yet">New</span>`
      : c._unused ? `<span class="flag unused" data-tip="No card names this status effect">Unused</span>`
      : c.dup ? `<span class="flag" data-tip="Duplicate of ${esc(env.dupName(c.dup) || "")}: same PSD">Duplicate</span>` : ""}
    ${small || link ? "" : `<button type="button" class="add${inDeck ? " in" : ""}" data-action="deck-toggle" data-id="${c.id}">${inDeck ? "✓ In deck" : "+ Deck"}</button>`}
    <div class="meta"><div class="name">${esc(c.name)}</div>
    <div class="sub">${c.stars ? `<span class="stars">${stars(c.stars)}</span>` : ""}${small ? "" : `<span>${esc(KIND_LABEL[c.type] || c.type)}</span>`}${small ? "" : (c.types || []).slice(0, 3).map(t => iconImg(env.icons, t, "")).join("")}</div></div>${link ? "</a>" : "</article>"}`;
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
