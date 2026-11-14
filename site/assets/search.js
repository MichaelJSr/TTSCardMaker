// Query language: the same syntax as AutoCroissant's /query_ability, plus names/aliases and a few extras.
//   fire              text in the ability, name or aliases (any case); also a name without its punctuation or a series
//   damage            also finds DMG (defense DEF, speed SPD, health HP, star points SP, primary field PF,
//                     counter damage CDMG; and back), as the bot
//   "draw 2"          whole-word match
//   !die              exclude (works on any term here, e.g. !type==creature)
//   a & b   a | b     both / either  (| binds looser than &, as in the bot)
//   hp>5  def<=3  atk==2  spd>=7  stars<4  total>=24        numbers
//   type==creature  series~kirby  subseries~door  author==chestnut  types~fire  subtype==equip  name~knight
//   created>=2025  created==2023-10  created<2021-06-01                   dates at the precision given (as the bot)
//   has:alias  flag:hand  flag:bars  flag:name  flag:any
import { flagged, hasFlag } from "./flags.js";
import { norm } from "./text.js";

export const total = c => (c.hp ?? 0) + (c.def ?? 0) + (c.atk ?? 0) + (c.spd ?? 0);
const hasStats = c => c.hp != null || c.def != null || c.atk != null || c.spd != null;

const NUM = {
  hp: c => c.hp, def: c => c.def, atk: c => c.atk, spd: c => c.spd, stars: c => c.stars,
  total: c => (hasStats(c) ? total(c) : null),
};
const DATE = { created: c => c.created };                // "YYYY-MM-DD"
const OPS = { "<": (a, b) => a < b, "<=": (a, b) => a <= b, "==": (a, b) => a === b, ">=": (a, b) => a >= b, ">": (a, b) => a > b };
const STR = {
  type: c => c.type, subtype: c => c.subtype, series: c => c.series, subseries: c => c.subseries, author: c => c.author,
  path: c => c.psd || c.png, ability: c => c.ability, types: c => (c.types || []).join(" "),
  name: c => c.name, alias: c => (c.aliases || []).join(" "), aliases: c => (c.aliases || []).join(" "), created: c => c.created,
};
export const FLAGS = {
  "has:alias": c => !!(c.aliases && c.aliases.length),
  "flag:hand": c => hasFlag(c, "hand"), "flag:bars": c => hasFlag(c, "bars"), "flag:name": c => hasFlag(c, "name"), "flag:any": flagged,
};

export function haystack(c) {
  if (c._hay === undefined) c._hay = [c.name, ...(c.aliases || []), ...(c.was || []), (c.ability || "").replace(/\s+/g, " ")].join("\n").toLowerCase();
  return c._hay;
}

const squash = s => String(s || "").normalize("NFD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");   // letters and digits: "Mom's Knife" momsknife
/** Names, aliases and old names squashed, one per line, and the names a typed series may be: whole, without a leading
 *  The or a closing number, or a part split at : or / ("Dark Souls III": dark souls; "Undertale/Deltarune") */
function squashed(c) {
  if (c._sq === undefined) {
    const ser = new Set(), s = c.series || "";
    for (const part of [s, ...s.split(/[:/]+/)])
      for (const v of [part, part.replace(/^\s*the\s+/i, "").replace(/\s+(?:[ivx]+|\d+)$/i, "")]) if (squash(v)) ser.add(squash(v));
    c._sq = { names: `\n${[c.name, ...(c.aliases || []), ...(c.was || [])].map(squash).join("\n")}\n`, ser };
  }
  return c._sq;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SYNONYMS = { damage: "dmg", dmg: "damage", defense: "def", def: "defense", speed: "spd", spd: "speed", health: "hp", hp: "health",
  "star points": "sp", sp: "star points", "primary field": "pf", pf: "primary field", "counter damage": "cdmg", cdmg: "counter damage" };
const SYNONYM_WORDS = new RegExp(`\\b(${Object.keys(SYNONYMS).sort((a, b) => b.length - a.length).join("|")})\\b`);   // longest key first

/** A text term's regex as the bot's _text_pattern (query_card.py), each synonym also finding the other; null without one. */
function synonymRe(t) {
  const parts = t.split(SYNONYM_WORDS);                  // the words at odd places
  if (parts.length < 2) return null;
  return new RegExp(parts.map((p, i) => {
    if (i % 2 === 0) return escapeRe(p);
    const o = SYNONYMS[p];
    return `(?:${p}|${o.length < p.length ? `\\b${o}\\b` : o})`;   // dmg as a word, not in "admg"
  }).join(""));
}

/** Compile a query into a predicate (card) => boolean, or null for an empty query. */
export function compile(query) {
  const q = (query || "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();   // phones type curly quotes; a space finds a line break
  if (!q) return null;
  if (q.includes("|")) {
    const parts = q.split("|").map(compile).filter(Boolean);
    return c => parts.some(p => p(c));
  }
  if (q.includes("&")) {
    const parts = q.split("&").map(compile).filter(Boolean);
    return c => parts.every(p => p(c));
  }
  if (q.startsWith("!")) {
    const inner = compile(q.slice(1));
    return inner ? c => !inner(c) : null;
  }
  const lower = q.toLowerCase();
  if (FLAGS[lower]) return FLAGS[lower];

  let m = lower.match(/^(\w+)\s*(<=|>=|==|<|>)\s*(\d{4}(?:-\d{2}){0,2})$/);
  if (m && DATE[m[1]]) {                                  // created>2023: after 2023; created==2023-10: in October 2023
    const get = DATE[m[1]], v = m[3], op = OPS[m[2]];
    return c => { const x = get(c); return x != null && op(x.slice(0, v.length), v); };
  }
  m = lower.match(/^(\w+)\s*(<=|>=|==|<|>)\s*(-?\d+)$/);
  if (m && NUM[m[1]]) {
    const get = NUM[m[1]], v = Number(m[3]), op = OPS[m[2]];
    return c => { const x = get(c); return x != null && op(x, v); };
  }
  m = q.match(/^(\w+)\s*(==|~)\s*(.+)$/);
  if (m && STR[m[1].toLowerCase()]) {
    const get = STR[m[1].toLowerCase()], v = m[3].trim().toLowerCase().replace(/^"(.*)"$/, "$1");
    if (m[2] === "==") return c => (get(c) || "").toString().toLowerCase() === v;
    return c => (get(c) || "").toString().toLowerCase().includes(v);
  }
  if (q.length > 1 && q.startsWith('"') && q.endsWith('"')) {
    const t = lower.slice(1, -1), edge = ch => (ch && /\w/.test(ch) ? "\\b" : "");   // a word's edge; a tag's ( and ) are their own
    const re = new RegExp(`${edge(t[0])}${escapeRe(t)}${edge(t.slice(-1))}`);
    return c => re.test(haystack(c));
  }
  const re = synonymRe(lower), sq = squash(lower), probe = sq.length > 3 ? sq : `\n${sq}\n`;   // 3 letters or fewer: a whole name
  const more = c => !!sq && (squashed(c).names.includes(probe) || squashed(c).ser.has(sq));   // a name without its punctuation, a series
  if (re) return c => re.test(haystack(c)) || more(c);
  return c => haystack(c).includes(lower) || more(c);
}

/** The cards whose name, an alias or an old name is the query (text.js norm: case, spaces and dots aside; quotes allowed). */
export function exactOf(query, cards) {
  const q = norm((query || "").trim().replace(/^"(.*)"$/, "$1"));
  return q ? cards.filter(c => norm(c.name) === q || [...(c.aliases || []), ...(c.was || [])].some(a => norm(a) === q)) : [];
}
/** list with exactOf's cards first, whatever the sort; the rest keep their order. */
export function exactFirst(list, query) {
  const top = new Set(exactOf(query, list));
  return top.size ? [...list.filter(c => top.has(c)), ...list.filter(c => !top.has(c))] : list;
}

/** Closest card names for "did you mean" (bigram similarity). */
export function suggest(query, cards) {
  const grams = s => { s = ` ${s.toLowerCase()} `; const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const qg = grams(query);
  return cards.map(c => {
    const cg = grams(c.name); let inter = 0;
    for (const g of qg) if (cg.has(g)) inter++;
    return [2 * inter / (qg.size + cg.size), c];
  }).filter(([s]) => s > 0.35).sort((a, b) => b[0] - a[0]).slice(0, 5).map(([, c]) => c);
}

export const SEARCH_HELP = [
  ["fire", "In the ability, name or aliases"],
  ["hollow knight · moms knife", "A series' cards; names without punctuation"],
  ["damage · star points", "Damage/DMG, defense/DEF, speed/SPD, health/HP, star points/SP, primary field/PF, counter damage/CDMG find each other"],
  ['"draw 2"', "Whole words only"],
  ["!die", "Exclude (any term)"],
  ["fire & type==creature", "Both must match"],
  ["fire | ice", "Either (| binds looser than &)"],
  ["hp>7 · def<=3 · atk==2 · spd>=8", "Stat comparisons"],
  ["stars<=3 · total>=25", "Stars and total stats"],
  ["type==creature · subtype==equip", "Exact value"],
  ["series~kirby · author~chestnut · types~undead", "Contains"],
  ["series==mario & subseries~door", "Series and subseries"],
  ["created>=2025 · created==2023-10", "Creation date (first Discord post or upload)"],
  ["has:alias", "Cards with aliases"],
  ["flag:hand · flag:bars · flag:name · flag:any", "Cards that need handling"],
];
