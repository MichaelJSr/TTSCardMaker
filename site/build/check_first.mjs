// The first screen index.html carries, as the site's own code draws it (build_site.py first_screen checks its markup
// against this). node check_first.mjs <assets dir>, stdin {cards, icons, thumbs, n, eager}; prints {ids, tiles, toolbar}:
// the default grid's first n cards (app.js listOf with no params: the cards not hidden, Name order), each as a link tile
// (grid.js tileHtml, link: true, the first `eager` loaded eagerly) and the toolbar (Name, Grid, M).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const G = await import(pathToFileURL(join(process.argv[2], "grid.js")).href);
const { cards, icons, thumbs, n, eager } = JSON.parse(readFileSync(0, "utf8"));
const toLocale = Number.prototype.toLocaleString;     // the build writes en-US counts; a browser redraws in its own
Number.prototype.toLocaleString = function (locale, opts) { return toLocale.call(this, locale ?? "en-US", opts); };
const list = cards.filter(c => !c.hidden).sort(G.byKey(G.nameKey));
const env = { thumbs, icons, dupName: () => "", inDeck: () => false };
const css = G.TILE_SIZES.m[1];
console.log(JSON.stringify({
  ids: list.slice(0, n).map(c => c.id),
  tiles: list.slice(0, n).map((c, i) => G.tileHtml(c, { link: true, eager: i < eager, css }, env)),
  toolbar: G.toolbarHtml({ count: list.length, sort: "name", dir: null, created: cards.some(c => c.created), view: "grid", size: "m" }),
}));
