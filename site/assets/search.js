// Query language: the same syntax as AutoCroissant's /query_ability, plus names/aliases and a few extras.
//   fire              text in the ability, name or aliases (any case)
//   "draw 2"          whole-word match
//   !die              exclude (works on any term here, e.g. !type==creature)
//   a & b   a | b     both / either  (| binds looser than &, as in the bot)
//   hp>5  def<=3  atk==2  spd>=7  stars<4  total>=24        numbers
//   type==creature  series~kirby  subseries~door  author==chestnut  types~fire  subtype==equip  name~knight
//   is:unparsed  has:history  has:problems  has:alias  has:details

export const total = c => (c.hp ?? 0) + (c.def ?? 0) + (c.atk ?? 0) + (c.spd ?? 0);
const hasStats = c => c.hp != null || c.def != null || c.atk != null || c.spd != null;

const NUM = {
  hp: c => c.hp, def: c => c.def, atk: c => c.atk, spd: c => c.spd, stars: c => c.stars,
  total: c => (hasStats(c) ? total(c) : null),
};
const STR = {
  type: c => c.type, subtype: c => c.subtype, series: c => c.series, subseries: c => c.subseries, author: c => c.author,
  path: c => c.psd || c.png, ability: c => c.ability, types: c => (c.types || []).join(" "),
  name: c => c.name, alias: c => (c.aliases || []).join(" "), aliases: c => (c.aliases || []).join(" "),
};
export const FLAGS = {
  "is:unparsed": c => !c.parsed, "has:history": c => !!c.hv,
  "has:problems": c => !!(c.problems && c.problems.length), "has:alias": c => !!(c.aliases && c.aliases.length),
  "has:details": c => !!c.details,                       // a PSD details record (the card page's Details dropdown)
};

export function haystack(c) {
  if (c._hay === undefined) c._hay = [c.name, ...(c.aliases || []), c.ability || ""].join("\n").toLowerCase();
  return c._hay;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compile a query into a predicate (card) => boolean, or null for an empty query. */
export function compile(query) {
  const q = (query || "").trim();
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

  let m = lower.match(/^(\w+)\s*(<=|>=|==|<|>)\s*(-?\d+)$/);
  if (m && NUM[m[1]]) {
    const get = NUM[m[1]], v = Number(m[3]);
    const op = { "<": (a, b) => a < b, "<=": (a, b) => a <= b, "==": (a, b) => a === b, ">=": (a, b) => a >= b, ">": (a, b) => a > b }[m[2]];
    return c => { const x = get(c); return x != null && op(x, v); };
  }
  m = q.match(/^(\w+)\s*(==|~)\s*(.+)$/);
  if (m && STR[m[1].toLowerCase()]) {
    const get = STR[m[1].toLowerCase()], v = m[3].trim().toLowerCase().replace(/^"(.*)"$/, "$1");
    if (m[2] === "==") return c => (get(c) || "").toString().toLowerCase() === v;
    return c => (get(c) || "").toString().toLowerCase().includes(v);
  }
  if (q.length > 1 && q.startsWith('"') && q.endsWith('"')) {
    const re = new RegExp(`(?:^|\\s|\\b)${escapeRe(lower.slice(1, -1))}(?:$|\\s|\\b)`);
    return c => re.test(haystack(c));
  }
  return c => haystack(c).includes(lower);
}

/** Closest card names for "did you mean" (bigram similarity). */
export function suggest(query, cards, n = 5) {
  const grams = s => { s = ` ${s.toLowerCase()} `; const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const qg = grams(query);
  return cards.map(c => {
    const cg = grams(c.name); let inter = 0;
    for (const g of qg) if (cg.has(g)) inter++;
    return [2 * inter / (qg.size + cg.size), c];
  }).filter(([s]) => s > 0.35).sort((a, b) => b[0] - a[0]).slice(0, n).map(([, c]) => c);
}

export const SEARCH_HELP = [
  ["fire", "In the ability, name or aliases"],
  ['"draw 2"', "Whole words only"],
  ["!die", "Exclude (any term)"],
  ["fire & type==creature", "Both must match"],
  ["fire | ice", "Either (| binds looser than &)"],
  ["hp>7 · def<=3 · atk==2 · spd>=8", "Stat comparisons"],
  ["stars<=3 · total>=25", "Stars and total stats"],
  ["type==creature · subtype==equip", "Exact value"],
  ["series~kirby · author~chestnut · types~undead", "Contains"],
  ["series==mario & subseries~door", "Series and subseries"],
  ["is:unparsed · has:history · has:alias", "Card flags"],
  ["has:details", "Cards with PSD details"],
];
