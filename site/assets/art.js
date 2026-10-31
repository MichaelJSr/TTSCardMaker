// Artwork sources (Card Edits.json art: a list, one string in older entries; the retired ability_art goes last): the
// card page's lines, each http(s) URL in them a link.
import { esc } from "./text.js";

export const ART_MAX = 500;                            // characters a source (build_site ART_MAX, the bot's card_edits.ART_MAX)
/** A card's (or entry's) artwork sources, in order. */
export const artList = c => [...(Array.isArray(c?.art) ? c.art : c?.art ? [c.art] : []), ...(c?.ability_art ? [c.ability_art] : [])]
  .map(s => String(s).replace(/\s+/g, " ").trim()).filter(Boolean);
/** "Artwork source #2" (n of `of`; one alone: "Artwork source"). */
export const artLabel = (n, of = 2) => (of > 1 ? `Artwork source #${n}` : "Artwork source");
/** The sources' error ("" when fine): at most ART_MAX characters each, an emoji counting one (Python's len). */
export const artError = list => { const i = list.findIndex(s => [...s].length > ART_MAX); return i < 0 ? "" : `${artLabel(i + 1)}: at most ${ART_MAX} characters`; };
const URL_RE = /https?:\/\/[^\s<>[\]"'`]+/g;
/** A matched URL without its trailing punctuation, or a ")" it doesn't open (wiki/Kirby_(series) keeps its own). */
export function trimUrl(url) {
  for (;;) {
    const t = url.replace(/[.,;:!?]+$/, "");
    const open = (t.match(/\(/g) || []).length, close = (t.match(/\)/g) || []).length;
    const next = t.endsWith(")") && close > open ? t.slice(0, -1) : t;
    if (next === url) return url;
    url = next;
  }
}

/** text escaped, each http(s) URL a link opening in a new tab (trailing punctuation left out). */
export function linked(text) {
  const s = String(text ?? "");
  let out = "", at = 0;
  for (const m of s.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    out += `${esc(s.slice(at, m.index))}<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
    at = m.index + url.length;
  }
  return out + esc(s.slice(at));
}

/** A card's artwork source lines (data-art: the number, inline.js edits them in place); "" when it has none. */
export const artHtml = c => { const list = artList(c);
  return list.map((s, i) => `<div class="art-src" data-art="${i + 1}"><b>${artLabel(i + 1, list.length)}:</b> ${linked(s)}</div>`).join(""); };
