// Query language: the same syntax as AutoCroissant's /query_ability, plus names/aliases and a few extras.
//   fire              text in the ability, name or aliases (any case); also a name without its punctuation or a (sub)series
//   cant  nme         also can't, N.M.E. (a word typed without ' or . finds it printed with them; digits never)
//   heal a machine    an icon as its word too: heal a [machine] (dark matter, darkmatter: [darkmatter]; the bot too)
//   spongebob         text no card has: the (sub)series whose name has it as whole words (bySeries)
//   defensive minion  text no card has, a type's name (letters and digits only: N.M.E.): that type's cards (byType)
//   damage            also finds DMG (defense DEF, speed SPD, health HP, star points SP, primary field PF,
//                     counter damage CDMG; and back), as the bot; after a number attack ATK too (+1 attack)
//   "draw 2" 'draw 2' whole-word match ('draw 2' also a series or name, as draw 2)
//   !die              exclude (works on any term here, e.g. !type==creature)
//   a & b   a | b     both / either  (| binds looser than &, as in the bot; inside "quotes" they are text)
//   hp>5  def<=3  atk==2  spd>=7  stars<4  total>=24        numbers
//   type==creature  series~kirby  subseries~door  author==chestnut  types~fire  subtype==equip  name~knight
//                   (series== and series~ match a subseries too; a known field's lone = reads as ==)
//   alias==zote  alias~clot                                 any one alias (as the bot)
//   types==fire  types==defensive minion                    any one type, or the whole list (letters and digits: dark matter)
//   type==field cards  type==status effect                  a Kind label too (dots and a closing s aside; as the bot)
//   subtype==infliction                                     any one item type (Salt: heal, infliction; as the bot)
//   created>=2025  created==2023-10  created<2021-06-01                   dates at the precision given (as the bot)
//   has:alias  flag:hand  flag:bars  flag:name  flag:any
import { flagged, hasFlag } from "./flags.js";
import { norm } from "./text.js";
import { itemTypes } from "./grid.js";

export const total = c => (c.hp ?? 0) + (c.def ?? 0) + (c.atk ?? 0) + (c.spd ?? 0);
const hasStats = c => c.hp != null || c.def != null || c.atk != null || c.spd != null;

const NUM = {
  hp: c => c.hp, def: c => c.def, atk: c => c.atk, spd: c => c.spd, stars: c => c.stars,
  total: c => (hasStats(c) ? total(c) : null),
};
const DATE = { created: c => c.created };                // "YYYY-MM-DD"
const OPS = { "<": (a, b) => a < b, "<=": (a, b) => a <= b, "==": (a, b) => a === b, ">=": (a, b) => a >= b, ">": (a, b) => a > b };
const STR = {
  type: c => c.type, subtype: itemTypes, series: c => c.series, subseries: c => c.subseries, author: c => c.author,
  path: c => c.psd || c.png, ability: c => c.ability, types: c => { const ts = (c.types || []).map(t => t.replace(/_/g, " ")); return [ts.join(" "), ...ts]; },
  name: c => c.name, alias: c => c.aliases || [], aliases: c => c.aliases || [], created: c => (c.createdBefore ? `before ${c.createdBefore}` : c.created),   // aliases, item types: each its own
};
export const FLAGS = {
  "has:alias": c => !!(c.aliases && c.aliases.length),
  "flag:hand": c => hasFlag(c, "hand"), "flag:bars": c => hasFlag(c, "bars"), "flag:name": c => hasFlag(c, "name"), "flag:any": flagged,
};

// an icon token ([fire], [fire:no]; text.js), and joined type names as words (the bot's query_card ICON, ICON_SPELLED)
const ICON = /\[([0-9a-z_ ]+)(?::(?:no|tint|sticker|glow|darkglow))?\]/gi;
const ICON_SPELLED = new Map([["darkmatter", "dark matter"], ["buffstack", "buff stack"], ["debuffstack", "debuff stack"],
  ["debuffupgrade", "debuff upgrade"]]);
/** text with each icon token as its word ([machine] machine, [offensive_minion] offensive minion, [fire:no] fire); a
 *  joined type name both ways, a line each ([darkmatter] darkmatter, dark matter); "" when it has none (the bot's icon_words) */
export function iconWords(text) {
  const t = String(text || ""), word = w => w.replace(/_/g, " ");
  if (!t.match(ICON)) return "";
  const words = t.replace(ICON, (_, w) => word(w)), spelled = t.replace(ICON, (_, w) => ICON_SPELLED.get(w.toLowerCase()) ?? word(w));
  return spelled === words ? words : `${words}\n${spelled}`;
}

/** [what a text term searches, the same with abilities as printed only], lowercased: names, aliases, old names, the
 *  ability (space runs as one space), then on a line of its own the ability with its icons as words (iconWords), so no
 *  phrase spans the two (the bot's _haystack) */
function hays(c) {
  if (c._hay === undefined) {
    const text = (c.ability || "").replace(/\s+/g, " "), words = iconWords(text);
    const printed = [c.name, ...(c.aliases || []), ...(c.was || []), text].join("\n").toLowerCase();
    c._hay = [words ? `${printed}\n${words.toLowerCase()}` : printed, printed];
  }
  return c._hay;
}
export const haystack = c => hays(c)[0];

const squash = s => String(s || "").normalize("NFD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");   // letters and digits: "Mom's Knife" momsknife
/** Names, aliases and old names squashed, one per line, and the names a typed series or subseries may be: whole, without
 *  a leading The or a closing number, or a part split at : or / ("Dark Souls III": dark souls; "Undertale/Deltarune") */
function squashed(c) {
  if (c._sq === undefined) {
    const ser = new Set();
    for (const s of [c.series || "", c.subseries || ""]) for (const part of [s, ...s.split(/[:/]+/)])
      for (const v of [part, part.replace(/^\s*the\s+/i, "").replace(/\s+(?:[ivx]+|\d+)$/i, "")]) if (squash(v)) ser.add(squash(v));
    c._sq = { names: `\n${[c.name, ...(c.aliases || []), ...(c.was || [])].map(squash).join("\n")}\n`, ser };
  }
  return c._sq;
}

// type==: the website's Kind labels too, dots and a closing s aside (the bot's KIND_NAMES); creatures stays as stored
const KIND_NAMES = new Map([["field card", ["field"]], ["minion", ["minion"]], ["item", ["item"]], ["auxiliary item", ["aux item"]],
  ["auxiliary creature", ["creatures"]], ["nme item", ["nme"]], ["nme", ["nme"]], ["buff", ["buff"]], ["debuff", ["debuff"]],
  ["status", ["buff", "debuff"]], ["status effect", ["buff", "debuff"]]]);
/** the type values type==v finds: a Kind label's (field cards: field; status effect: buff, debuff), else v (the bot's kind_values) */
const kindValues = v => { const k = v.replace(/\./g, "").split(/\s+/).filter(Boolean).join(" ");
  return KIND_NAMES.get(k) || (k.endsWith("s") && KIND_NAMES.get(k.slice(0, -1))) || [v]; };
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SYNONYMS = { damage: "dmg", dmg: "damage", defense: "def", def: "defense", speed: "spd", spd: "speed", health: "hp", hp: "health",
  "star points": "sp", sp: "star points", "primary field": "pf", pf: "primary field", "counter damage": "cdmg", cdmg: "counter damage" };
const AFTER_NUMBER = { attack: "atk", atk: "attack" };   // only after a number (+1 attack: +1 ATK); attack alone stays a word
const SYNONYM_WORDS = new RegExp(`\\b(${[...Object.keys(SYNONYMS).sort((a, b) => b.length - a.length),   // longest key first
  ...Object.keys(AFTER_NUMBER).map(w => `(?<=[\\d%] )${w}`)].join("|")})\\b`);

const PUNCT = "[.'\u2019]", ABBR_END = "(?:(?<=\\.[a-z])\\.)?";   // after the last letter: only an abbreviation's '.'
const WORD_END = "(?:['\u2019]|(?<=\\.[a-z])\\.)?";   // before the next word: a ' or ABBR_END, never a sentence's end
const JOIN = "[.'\u2019-]", HYPHEN = "(?<![.'\u2019])-";   // the rulebook's PUNCT: a '-' too; a lone '-' as a gap, just after a letter
const LETTER = /\p{L}/u, isLetter = ch => !!ch && LETTER.test(ch);
/** text as a regex source (the bot's query_card.loose): a word typed without ' ’ or . also finds one printed between
 *  its letters (cant: can't), a ' or an abbreviation's . at its end (nme shop: N.M.E. shop; never 'other. creature');
 *  digits never (05 is not 0.5); a word typed with one is exact. gap: a space run's source (else itself); hyphen (the
 *  rulebook's): - too, and a lone - between two words' letters (multihit, multi hit: multi-hit) */
export function loose(t, gap = null, hyphen = false) {
  const words = t.split(/(\s+)/), punct = hyphen ? JOIN : PUNCT, typed = new RegExp(punct);
  return words.map((w, at) => {
    if (at % 2) {
      const space = gap || escapeRe(w);
      return hyphen && isLetter([...words[at - 1]].pop()) && isLetter([...words[at + 1]][0]) ? `(?:${space}|${HYPHEN})` : space;
    }
    return [...w].map((ch, i, a) => {
      if (!LETTER.test(ch) || typed.test(w)) return escapeRe(ch);
      return escapeRe(ch) + (a[i + 1] ? (LETTER.test(a[i + 1]) ? `${punct}?` : "") : at + 1 < words.length ? WORD_END : ABBR_END);
    }).join("");
  }).join("");
}

/** A text term's regex as the bot's _text_pattern (query_card.py): loose, each synonym also finding the other (attack
 *  ATK after a number). */
function textRe(t) {
  return new RegExp(t.split(SYNONYM_WORDS).map((p, i) => {   // the words at odd places
    if (i % 2 === 0) return loose(p);
    const o = SYNONYMS[p] || AFTER_NUMBER[p];
    return `(?:${p}|${o.length < p.length ? `\\b${o}\\b` : o})`;   // dmg as a word, not in "admg"
  }).join(""));
}

/** q split on sep, except inside "double quotes" (the bot's _split_unquoted: subseries=="mario & luigi") */
function splitOut(q, sep) {
  const parts = [];
  let at = 0, quoted = false;
  for (let i = 0; i < q.length; i++) {
    if (q[i] === '"') quoted = !quoted;
    else if (q[i] === sep && !quoted) { parts.push(q.slice(at, i)); at = i + 1; }
  }
  return [...parts, q.slice(at)];
}
const NOT_TERM = /(?:^|[&|])\s*!/;                       // a term starting with !
/** pred, and the cards a name, alias, old name or (sub)series is q, squashed (the bot's _named): typed with & or |
 *  ("Kirby & The Amazing Mirror", "Mario & Luigi"), its cards too; not with quotes or a !term */
function named(q, pred) {
  const sq = squash(q);
  if (!sq || q.includes('"') || NOT_TERM.test(q)) return pred;
  return c => pred(c) || squashed(c).names.includes(`\n${sq}\n`) || squashed(c).ser.has(sq);
}

/** curly quotes as plain ones (phones type them), one character each */
export const straight = s => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');

const STOP = new Set(["the", "of", "and", "at", "a", "an", "in", "to", "vs", "series"]);
const NUMBER = /^[0-9]+$/;
/** words as the series fallback compares them: case and accents aside, apostrophes kept ("dont" is not Don't Starve),
 *  stopwords and words under 3 letters left out, numbers kept ("freddy's 2") (the bot's series_words) */
export const seriesWords = s => straight(String(s || "")).normalize("NFD").toLowerCase().replace(/\p{M}+/gu, "")
  .split(/[^\p{L}\p{N}']+/u).map(w => w.replace(/^'+|'+$/g, "")).filter(w => (w.length > 2 || NUMBER.test(w)) && !STOP.has(w));
const WORDS = new Map();                                 // a series name's words
const holds = (name, run) => { let w = WORDS.get(name);
  if (!w) WORDS.set(name, w = seriesWords(name));
  return w.some((_, i) => run.every((x, j) => w[i + j] === x)); };
/** A plain term no card's text has, as whole words of series' or subseries' names ("spongebob", "five nights"): a
 *  predicate for their cards, its note [term, series, subseries]; else null */
function bySeries(q, cards) {
  const run = seriesWords(q);
  if (run.every(w => NUMBER.test(w))) return null;      // a word, not only numbers
  const found = k => [...new Set(cards.map(c => c[k]).filter(n => n && holds(n, run)))].sort();
  const ser = found("series"), names = new Set(ser);
  const sub = found("subseries").filter(n => !names.has(n) && cards.some(c => c.subseries === n && !names.has(c.series)));   // none a found series holds
  for (const n of sub) names.add(n);
  if (!names.size) return null;
  const pred = c => names.has(c.series) || names.has(c.subseries);
  pred.notes = [[q, ser, sub]];
  return pred;
}
/** the types q is the name of, squashed ("defensive minion", "N.M.E.", "debuff stack": the font's aliases too) (the
 *  bot's _type_names) */
const typeNames = (q, cards) => { const sq = squash(q);
  return new Set(sq ? [...new Set(cards.flatMap(c => c.types || []))].filter(t => squash(t) === sq) : []); };
/** A plain term no card's text has that is a type's name (typeNames): a predicate for that type's cards, its note
 *  [term, [], [], types]; else null (the bot's _by_type) */
function byType(q, cards) {
  const names = typeNames(q, cards);
  if (!names.size) return null;
  const pred = c => (c.types || []).some(t => names.has(t));
  pred.notes = [[q, [], [], [...new Set([...names].map(t => t.replace(/_/g, " ")))].sort()]];
  return pred;
}
const notesOf = ps => ps.flatMap(p => p.notes || []);
/** a fallback's note: No card's text has “x”: the series A and B; the type nme (types==nme) */
export const seriesNote = ([q, ser, sub, kinds = []]) => { const and = xs => (xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const ts = kinds.map(t => `${t} (types==${t})`);
  return `No card's text has “${q}”: ${[ser.length && `the series ${and(ser)}`, sub.length && `the subseries ${and(sub)}`,
    ts.length && `the type${ts.length > 1 ? "s" : ""} ${and(ts)}`].filter(Boolean).join(" and ")}`; };
/** whether q's & or | parts may fall back: not when q itself names one of the cards ("mario & luigi") */
const partsFall = (q, cards) => !(cards && cards.some(named(q, () => false)));

/** Compile a query into a predicate (card) => boolean, or null for an empty query. cards: the cards searched, so a
 *  plain term none of them has falls back to series' words, else a type's name (bySeries, byType; the notes say so);
 *  fall: false, never (the bot's by_series) */
export function compile(query, cards = null, fall = true) {
  const q = straight(query || "").replace(/\s+/g, " ").trim();   // a space finds a line break
  if (!q) return null;
  let parts = splitOut(q, "|");
  if (parts.length > 1) {
    const of = fall && partsFall(q, cards);
    parts = parts.map(x => compile(x, cards, of)).filter(Boolean);
    return Object.assign(named(q, c => parts.some(p => p(c))), { notes: notesOf(parts) });
  }
  parts = splitOut(q, "&");
  if (parts.length > 1) {
    const of = fall && partsFall(q, cards);
    parts = parts.map(x => compile(x, cards, of)).filter(Boolean);
    return Object.assign(named(q, c => parts.every(p => p(c))), { notes: notesOf(parts) });
  }
  if (q.startsWith("!")) {
    const inner = compile(q.slice(1), cards, fall);
    return inner ? Object.assign(c => !inner(c), { notes: notesOf([inner]) }) : null;
  }
  const lower = q.toLowerCase();
  if (FLAGS[lower]) return FLAGS[lower];

  let m = lower.match(/^(\w+)\s*(<=|>=|==?|<|>)\s*(\d{4}(?:-\d{2}){0,2})$/);   // a lone = reads as ==
  if (m && DATE[m[1]]) {                                  // created>2023: after 2023; created==2023-10: in October 2023
    const get = DATE[m[1]], v = m[3], op = OPS[m[2]] || OPS["=="];
    return c => {                                         // "before 2020" (no day): only a < or <= it surely meets
      if (c.createdBefore && m[1] === "created") return (m[2] === "<" || m[2] === "<=") && op(`${c.createdBefore - 1}-12-31`.slice(0, v.length), v);
      const x = get(c); return x != null && op(x.slice(0, v.length), v);
    };
  }
  m = lower.match(/^(\w+)\s*(<=|>=|==?|<|>)\s*(-?\d+)$/);
  if (m && NUM[m[1]]) {
    const get = NUM[m[1]], v = Number(m[3]), op = OPS[m[2]] || OPS["=="];
    const meets = c => { const x = get(c); return x != null && op(x, v); };
    if (m[1] === "stars") return meets;
    return c => (c.creatures?.length ? c.creatures.some(meets) : meets(c));   // several creatures: any one (the bot too)
  }
  m = q.match(/^(\w+)\s*(==?|~)\s*(.+)$/);
  if (m && STR[m[1].toLowerCase()]) {
    const k = m[1].toLowerCase(), typed = m[3].trim().toLowerCase().replace(/^"(.*)"$/, "$1");
    const fold = k === "types" && squash(typed) ? squash : x => x;   // a type: letters and digits (dark matter, n.m.e.; the bot too)
    const v = fold(k === "types" ? typed.replace(/_/g, " ") : typed);
    const gets = k === "series" ? [STR.series, STR.subseries] : [STR[k]];   // a subseries counts as a series
    const kinds = k === "type" ? kindValues(v) : [v];   // type==field card, ==status effect
    const ok = m[2] === "~" ? x => x.includes(v) : x => kinds.includes(x);
    return c => gets.flatMap(get => get(c)).some(x => ok(fold((x || "").toString().toLowerCase())));
  }
  const edge = ch => (ch && /\w/.test(ch) ? "\\b" : "");   // a word's edge; a tag's ( and ) are their own
  const whole = t => `${edge(t[0])}${escapeRe(t)}${edge(t.slice(-1))}`;
  if (q.length > 1 && q.startsWith('"') && q.endsWith('"')) {
    const re = new RegExp(whole(lower.slice(1, -1)));
    return c => re.test(haystack(c));
  }
  let re = textRe(lower);
  if (q.length > 2 && q[0] === "'" && q.endsWith("'")) re = new RegExp(`(?:${whole(lower.slice(1, -1))})|(?:${re.source})`);   // also whole words (the bot)
  const sq = squash(lower), probe = sq.length > 3 ? sq : `\n${sq}\n`;   // 3 letters or fewer: a whole name
  const more = c => !!sq && (squashed(c).names.includes(probe) || squashed(c).ser.has(sq));   // a name without its punctuation, a series
  const at = cards && typeNames(q, cards).size ? 1 : 0;   // a type's name: abilities as printed (else its type's cards)
  const plain = c => re.test(hays(c)[at]) || more(c);
  return (cards && fall && !cards.some(plain) && (bySeries(q, cards) || byType(q, cards))) || plain;
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
  ["hollow knight · moms knife", "A series' or subseries' cards; names without punctuation"],
  ["cant · nme", "Also can't, N.M.E.: a word typed without ' or . finds it printed with them"],
  ["spongebob · five nights", "A series by words of its name, when no card's text has them"],
  ["defensive minion · N.M.E.", "A type's cards by its name, when no card's text has it"],
  ["damage · star points · +1 attack", "Damage/DMG, defense/DEF, speed/SPD, health/HP, star points/SP, primary field/PF, counter damage/CDMG find each other; after a number, attack/ATK too"],
  ['"heal 2"', "Whole words only"],
  ["'heal 2'", "Whole words, and a series' or name's cards"],
  ["!die", "Exclude (any term)"],
  ["fire & type==creature", "Both must match"],
  ["fire | ice", "Either (| binds looser than &)"],
  ["hp>7 · def<=3 · atk==2 · spd>=8", "Stat comparisons"],
  ["stars<=3 · total>=25", "Stars and total stats"],
  ["type==creature · subtype=equip", "Exact value (= or ==)"],
  ["series~kirby · author~chestnut · types~undead", "Contains"],
  ["types==fire · type==status effects", "Any one type; a kind by its label too (Field cards, Minions...)"],
  ["series==mario & subseries~door", "Series and subseries (series== and series~ find a subseries too)"],
  ["created>=2025 · created==2023-10", "Creation date (first Discord post or upload)"],
  ["has:alias", "Cards with aliases"],
  ["flag:hand · flag:bars · flag:name · flag:any", "Cards that need handling"],
];
