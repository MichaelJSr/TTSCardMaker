// Artwork sources (Card Edits.json art, ability_art): the card page's two lines, each http(s) URL in them a link.
import { esc } from "./text.js";

export const ART = [["art", "Artwork source"], ["ability_art", "Ability artwork source"]];
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

/** A card's artwork source lines (data-art: inline.js edits them in place); "" when it has none. */
export const artHtml = c => ART.map(([k, label]) => (c[k] ? `<div class="art-src" data-art="${k}"><b>${label}:</b> ${linked(c[k])}</div>` : "")).join("");
