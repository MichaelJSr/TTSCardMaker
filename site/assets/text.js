// Ability text: icon tokens, timing-tag badges, links to other cards, and word diffs.

export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
/** toLocaleDateString(undefined, opts) as a function, its Intl.DateTimeFormat made once on first use (one per call was a hotspot) */
export const dateFmt = opts => { let f = null; return d => (f ||= new Intl.DateTimeFormat(undefined, opts)).format(d); };
/** A quiet link to a card version's commit on GitHub ("" without one); label: its accessible name */
export const commitLink = (repo, sha, label) => (repo && sha ? `<a class="commit-link" href="https://github.com/${esc(repo)}/commit/${esc(sha)}" target="_blank" rel="noopener" aria-label="${esc(label)}">commit</a>` : "");
/** " · commit" after a date, the dot kept with the link when the line wraps ("" without one) */
export const commitAfter = (repo, sha, label) => { const a = commitLink(repo, sha, label); return a && ` <span class="commit-at">· ${a}</span>`; };
/** html with a short note in its tooltip (a column header or a stat's label, never each cell): the faint dotted cue (.qn) */
export const noteHtml = (html, note) => (note ? `<span class="qn" data-tip="${esc(note)}">${html}</span>` : html);
export const noted = (label, note) => noteHtml(esc(label), note);
/** a table head cell's content: text, {html}, or either with a note ({label | html, tip}) */
export const headHtml = h => (h && typeof h === "object" ? noteHtml(h.html ?? esc(h.label), h.tip) : esc(h));
export const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;              // a GitHub login (here: login.js and decks.js need it without profile.js)
export const norm = s => String(s || "").toLowerCase().replace(/[\s_\-.'’]+/g, "");

// Timing tags. Colors match the stoogedings font badges. Cooldowns and uses replaced the older tags (2026-10-21).
const FIXED = {
  OYT: ["turn", "On your turn"], AAT: ["any", "At any time"],
  BOT: ["forced", "Beginning of turn (forced)"], ENDT: ["forced", "End of turn (forced)"],
  BOGT: ["forced", "Beginning of global turn (forced)"], ENDGT: ["forced", "End of global turn (forced)"],
  OFS: ["trigger", "On first summon"], OS: ["trigger", "On summon"], OD: ["trigger", "On death"], WOF: ["trigger", "While on field"],
  Action: ["neutral", "Costs the creature's action"],   // not a timing tag
};
export const TAG = /\((-?[0-9A-Za-z/]{2,8})\)/;   // candidates, any case; tagInfo decides. Not /g: copy it to iterate
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
/** Every timing tag the stoogedings font draws (build_stoogedings.badge_tags), the cards' own first, then the old
 *  system's: n 1-20 or X (owner 2026-11-03; the old system 1-9), a/b with a from -9 up to b (and the first -1 to 9 with
 *  any b up to 9). */
export const BADGE_TAGS = (() => {
  const old = [...range(1, 9), "X"], counts = [...range(1, 20), "X"], firsts = [...range(-9, 20), "X"];
  const now = new Set(Object.keys(FIXED));
  for (const n of counts) for (const k of ["CD", "GCD", "U", "PG"]) now.add(n + k);
  for (const cd of ["CD", "GCD"]) {
    for (const a of ["-1", ...range(0, 9), "X"]) for (const b of old) now.add(`${a}/${b}${cd}`);
    for (const b of counts) for (const a of firsts) if (a === "X" || b === "X" || +a <= +b) now.add(`${a}/${b}${cd}`);
  }
  return [...now, ...old.flatMap(n => [`${n}PT`, `E${n}T`, `FTE${n}T`, `${n}PGT`, `E${n}GT`])];
})();
const KNOWN = new Set([...BADGE_TAGS.map(t => t.toUpperCase()), "Y/XCD", "Y/XGCD"]);   // + the Timing Tags chapter's family rows
// any letter case is the same tag, as in the font: "(1cd)" is (1CD), "(action)" is (Action)
const CANON = Object.fromEntries(Object.keys(FIXED).map(k => [k.toUpperCase(), k]));
const canon = tag => { const up = String(tag).toUpperCase(); return CANON[up] ?? up; };
const times = n => (n === "X" ? "X times" : n === "1" ? "once" : `${n} times`);
const count = (n, one, many = one + "s") => `${n} ${n === "1" || n === "-1" ? one : many}`;
const old = (group, meaning, multi = false) => ({ group, meaning: `Old system: ${meaning}`, multi, old: true });
/** {tag (canonical case), group, meaning, multi, old} or null. The meaning is the Timing Tags chapter's when it lists
 *  the tag, or its family with X ("XCD" for (3CD): X is 3, "turn(s)" agrees); else the one below. */
export function tagInfo(typed) {
  const tag = canon(typed), info = KNOWN.has(tag.toUpperCase()) && tagMeaning(tag);
  if (!info) return null;
  const own = chapterMeaning(tag);
  return { tag, ...info, ...(own ? { meaning: info.old && !/^old system/i.test(own) ? `Old system: ${own}` : own } : {}) };
}
let CHAPTER = {};                                  // the Timing Tags chapter's table (build_site.py tag_meanings: cards.json tagMeanings)
export const setTagMeanings = m => { CHAPTER = Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [canon(k), String(v)])); };
function chapterMeaning(tag) {
  if (CHAPTER[tag]) return CHAPTER[tag];
  const m = /^(-?[0-9]+)(?!\/)/.exec(tag.replace(/^(E|FTE)(?=\d)/, "")), n = m?.[1];
  if (!n || tag.includes("/")) return "";
  const family = tag.replace(n, "X"), text = CHAPTER[family];
  return text ? text.replace(/\bX\b/g, n).replace(/\b(-?\d+) (\w+)\(s\)/g, (_, k, w) => `${k} ${k === "1" || k === "-1" ? w : `${w}s`}`) : "";
}
function tagMeaning(tag) {
  if (FIXED[tag]) return { group: FIXED[tag][0], meaning: FIXED[tag][1], multi: false };
  let m;
  if ((m = /^(\d+|X)CD$/.exec(tag))) return { group: "turn", meaning: `Cooldown: ${count(m[1], "turn")}` };
  if ((m = /^(\d+|X)GCD$/.exec(tag))) return { group: "any", meaning: `Global cooldown: ${count(m[1], "global turn")}` };
  if ((m = /^(-?\d+|X|Y)\/(\d+|X)CD$/.exec(tag))) return { group: "turn", meaning: `Cooldown: starts with ${m[1]} of ${count(m[2], "turn")} of charge` };
  if ((m = /^(-?\d+|X|Y)\/(\d+|X)GCD$/.exec(tag))) return { group: "any", meaning: `Global cooldown: starts with ${m[1]} of ${count(m[2], "turn")} of charge` };
  if ((m = /^(\d+|X)U$/.exec(tag))) return { group: "trigger", meaning: count(m[1], "use") };
  if ((m = /^(\d+|X)PG$/.exec(tag))) return { group: "trigger", meaning: `Can only be activated ${times(m[1])} per game` };
  if ((m = /^([1-9X])PGT$/.exec(tag))) return old("any", `usable ${times(m[1])} per global turn (at any time)`);
  if ((m = /^([1-9X])PT$/.exec(tag))) return old("turn", `usable ${times(m[1])} per turn (on your turn)`);
  if ((m = /^FTE([1-9X])T$/.exec(tag))) return old("turn", `every ${m[1]} turns, starting on your 1st turn (multi-turn)`, true);
  if ((m = /^E([1-9X])GT$/.exec(tag))) return old("any", `every ${m[1]} global turns (at any time, multi-turn)`, true);
  if ((m = /^E([1-9X])T$/.exec(tag))) return old("turn", `every ${m[1]} turns, starting on turn ${m[1]} (multi-turn)`, true);
  return null;
}
export const badgeHtml = (tag, tip = true) => {   // tip false: the note is the parent's (a "3CD+" head)
  const t = tagInfo(tag);
  return t ? `<span class="badge ${t.group}"${tip ? ` data-tip="${esc(`(${t.tag}) ${t.meaning}`)}"` : ""}>${esc(t.tag.replace("-", "\u2212"))}</span>` : esc(`(${tag})`);
};

// ---- cooldown rings (owner 2026-11-04): beside each cooldown badge, (2CD), (1/2CD), (-1/1GCD), in card and rulebook
// text (the website's: the cards print the badge alone). X segments, zero at the top: the charge it starts with clockwise
// in green, a start below zero counter-clockwise in red (each turn moves it one segment clockwise: the red unwinds, then
// the green fills), each lap below zero past the first a thin red arc outside; more than 8 segments: arcs by share. In
// the middle the turns until its first full charge (X - Y): green, red when it starts below zero; it glows when that is
// 0 or 1 (ready on its first turn: charge comes in as a turn begins). X is dashed. Its tip says it in words.
const RING_RIM = { turn: "#5b8ff9", any: "#a274ff" }, RING_GREEN = "#22c55e", RING_RED = "#ef4444", RING_BODY = "#1c2030", RING_LINE = "#e5e7eb";
const arc = (r0, r1, a0, a1) => {                          // an annular sector in the ring's 22-unit box, clockwise, 0 = up
  if (a1 - a0 > 359) return arc(r0, r1, a0, a0 + 180) + arc(r0, r1, a0 + 180, a0 + 360);
  const P = (r, a) => `${(11 + r * Math.sin(a * Math.PI / 180)).toFixed(2)} ${(11 - r * Math.cos(a * Math.PI / 180)).toFixed(2)}`, big = a1 - a0 > 180 ? 1 : 0;
  return `M${P(r1, a0)}A${r1} ${r1} 0 ${big} 1 ${P(r1, a1)}L${P(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${P(r0, a0)}Z`;
};
/** The cooldown's numbers: {cap (X), start (Y), global} or null; "X" where the tag says X. */
export function cooldownOf(typed) {
  const t = tagInfo(typed)?.tag, m = t && (/^(-?\d+|X|Y)\/(\d+|X)(G?)CD$/.exec(t) || /^()(\d+|X)(G?)CD$/.exec(t));
  if (!m) return null;
  const n = v => (/^-?\d+$/.test(v) ? +v : "X");          // the chapter's family rows (Y/XCD): X
  return { cap: n(m[2]), start: m[1] === "" ? 0 : n(m[1]), global: !!m[3] };
}
/** The ring in words: its tip. */
export function ringWords({ cap, start, global }) {
  const turn = k => `${k} ${global ? "global turn" : "turn"}${k === 1 ? "" : "s"}`, every = k => (k === 1 ? `every ${global ? "global turn" : "turn"}` : `every ${turn(k)}`);
  if (cap === "X") return "Cooldown: X turns";
  if (start === "X") return `Starts with X of ${turn(cap)} of charge`;
  const wait = Math.max(0, cap - start);
  if (wait === 0) return `Fully charged from the start, then recharges in ${turn(cap)}`;
  if (wait === 1) return `Fully charged as its first ${global ? "global turn" : "turn"} begins, then ${every(cap)}`;
  if (start < 0) return `Starts ${-start} below zero: first fully charged after ${turn(wait)}, then ${every(cap)}`;
  return `First fully charged after ${turn(wait)}, then ${every(cap)}`;
}
/** A cooldown badge's ring (HTML), or "" for any other tag (tip false: the note is the parent's). */
export function ringHtml(typed, tip = true) {
  const c = cooldownOf(typed);
  if (!c) return "";
  const { cap, start } = c, R = 9.4, IN = 5.6, rim = RING_RIM[tagInfo(typed).group] || RING_LINE;
  const unknown = cap === "X" || start === "X", debt = unknown ? 0 : Math.max(0, -start), have = unknown ? 0 : Math.max(0, Math.min(start, cap));
  const wait = unknown ? "X" : Math.max(0, cap - start), red = !unknown && start < 0;
  const open = (d, dashed = false) => `<path d="${d}" fill="none" stroke="${RING_LINE}" stroke-opacity=".85" stroke-width=".9"${dashed ? ' stroke-dasharray="1.4 1.2"' : ""}/>`;
  let body = `<circle cx="11" cy="11" r="10.3" fill="${RING_BODY}" stroke="${rim}" stroke-width="1.3"/>`;
  if (cap === "X") body += open(arc(IN, R, 0, 360), true);
  else if (cap <= 8) {
    const depth = k => (debt > k ? Math.floor((debt - 1 - k) / cap) + 1 : 0);   // laps below zero over the k-th segment counter-clockwise
    for (let i = 0; i < cap; i++) {
      const a0 = i * 360 / cap + 3.5, a1 = (i + 1) * 360 / cap - 3.5, d = arc(IN, R, a0, a1), deep = depth(cap - 1 - i);
      body += start === "X" ? open(d, true) : i < have ? `<path d="${d}" fill="${RING_GREEN}"/>` : deep ? `<path d="${d}" fill="${RING_RED}"/>` : open(d);
      for (let lap = 2; lap <= deep; lap++) body += `<path d="${arc(10.9 + (lap - 2) * 1.7, 12.15 + (lap - 2) * 1.7, a0, a1)}" fill="${RING_RED}"/>`;
    }
  } else {
    body += [R, IN].map(r => `<circle cx="11" cy="11" r="${r}" fill="none" stroke="${RING_LINE}" stroke-opacity=".75" stroke-width=".8"/>`).join("");
    if (have) body += `<path d="${arc(IN, R, 0, have / cap * 360)}" fill="${RING_GREEN}"/>`;
    if (debt) body += `<path d="${arc(IN, R, 360 - Math.min(debt, cap) / cap * 360, 360)}" fill="${RING_RED}"/>`;
    for (let lap = 2, left = debt - cap; left > 0; lap++, left -= cap)
      body += `<path d="${arc(10.9 + (lap - 2) * 1.7, 12.15 + (lap - 2) * 1.7, 360 - Math.min(left, cap) / cap * 360, 360)}" fill="${RING_RED}"/>`;
  }
  const t = String(wait), size = t.length > 1 ? 6.9 : 8.6;
  body += `<text x="11" y="${(11.2 + size * .36).toFixed(2)}" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-weight="900" font-size="${size}"${t.length > 1 ? ' letter-spacing="-.45"' : ""} fill="${red ? "#ff6b6b" : "#4ade80"}" stroke="#05070b" stroke-width="${(size * .2).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${t}</text>`;
  const glow = !unknown && wait <= 1 ? " glow" : "";
  return `<span class="ring${glow}"${tip ? ` data-tip="${esc(ringWords(c))}"` : ""}><svg viewBox="0 0 22 22" aria-hidden="true">${body}</svg></span>`;
}
/** A badge as card text draws it: a cooldown with its ring, the two kept together. */
export const tagHtml = (typed, tip = true) => { const ring = ringHtml(typed, tip); return ring ? `<span class="cd">${ring}${badgeHtml(typed, tip)}</span>` : badgeHtml(typed, tip); };

// Costs in parentheses, as the stoogedings font draws them (build_stoogedings.cost_badges, owner 2026-11-03): "(2 points)"
// a green coin with the number on it and "Points", "(2 bricks)" a brown brick, "(2 SP)" or "(2 star points)" a yellow
// star and "SP" (the TTS table's counters), "(4 souls)" and "(3 counters)" (a card's own currency) a teal pill; numbers
// 0-50, halves to 9.5 and X, one space, any case. Right after a number or word it is a multiplier, not a cost (the
// font's GLUED rule): Warcraftian Rogue's "Deal 2(x counters) DMG".
export const COST = /(?<![\w.])\(((?:\d{1,2}(?:\.5)?|[Xx]) (?:points?|bricks?|SP|star points?|souls?|counters?))\)/i;
export const COST_NUMBERS = new Set([...range(0, 50), ...range(0, 9).map(n => `${n}.5`), "X"]);
const COST_KIND = { point: "points", brick: "bricks", sp: "sp", "star point": "sp", soul: "souls", counter: "counters" };
const COST_WORD = { points: ["Point", "Points"], bricks: ["Brick", "Bricks"], sp: ["SP", "SP"], souls: ["Soul", "Souls"], counters: ["Counter", "Counters"] };
const COST_TIP = { points: "your team's points (earned when enemy prime creatures are defeated, spent on abilities and the item shop)",
  bricks: "your team's BRICKS (mined by creatures, spent on field cards)",
  sp: "your team's SP, star points (set to 7 each global turn, spent to play items)", souls: "a currency of this card's own",
  counters: "a currency of this card's own" };
/** {n, kind: points | bricks | sp | souls | counters, word (the badge's: "Points", "SP")} of a cost's text ("2 points"), or null */
export function costInfo(typed) {
  const m = /^(\S+) (.+)$/.exec(String(typed));
  if (!m || !COST.test(`(${typed})`)) return null;
  const n = m[1].toUpperCase(), unit = m[2].toLowerCase(), kind = COST_KIND[unit.replace(/s$/, "")];
  if (!COST_NUMBERS.has(n) || !kind) return null;
  return { n, kind, word: COST_WORD[kind][n === "1" ? 0 : 1] };
}
export const costHtml = typed => {
  const c = costInfo(typed);
  if (!c) return esc(`(${typed})`);
  const own = c.kind === "souls" || c.kind === "counters";
  const n = c.kind === "sp" && c.n.length > 1 ? `<span class="cost-n long"><i>${esc(c.n)}</i></span>` : `<span class="cost-n">${esc(c.n)}</span>`;
  return `<span class="badge cost ${own ? "own" : c.kind}" data-tip="${esc(`${c.n} ${c.kind === "sp" ? "SP" : c.word.toLowerCase()}: ${COST_TIP[c.kind]}`)}">${n}<span class="cost-u"> ${esc(c.word)}</span></span>`;
};

// badge colour legend, one line per colour: the text of rulebook page 02 Abbreviations; colours come from tagInfo's groups
const COLOUR = { turn: "Blue", any: "Purple", forced: "Red", trigger: "Orange", neutral: "Grey" };
export const LEGEND = [
  ["on your turn", ["1CD", "1/2CD", "OYT"]], ["at any time", ["1GCD", "AAT"]], ["forced", ["BOT", "ENDT", "BOGT", "ENDGT"]],
  ["per game, uses and triggers", ["1PG", "2U", "OFS", "OS", "OD", "WOF"]], ["costs the creature's action", ["Action"]],
].map(([what, tags]) => ({ group: tagInfo(tags[0]).group, colour: COLOUR[tagInfo(tags[0]).group], what, tags }));
const COSTS = [["Green", "points", "2 points", "#00ffae"], ["Brown", "BRICKS", "2 bricks", "#a0522d"], ["Yellow", "SP (star points)", "2 SP", "#ffff00"],
  ["Teal", "a card's own currency", "4 souls", "#0f766e"]];   // style.css colours: the TTS table's counters
/** costs: the cost lines too */
export const legendHtml = (costs = false) => `<ul class="badge-legend">${LEGEND.map(l => `<li><span class="badge ${l.group} swatch" aria-hidden="true"></span><b>${l.colour}:</b> ${esc(l.what)} ${l.tags.map((t, i) => `<span class="nw">${i ? "" : "("}${badgeHtml(t)}${i < l.tags.length - 1 ? "," : ")."}</span>`).join(" ")}</li>`).join("")}${costs
  ? `${COSTS.map(([colour, what, eg, bg]) => `<li><span class="badge swatch" style="background:${bg}" aria-hidden="true"></span><b>${colour}:</b> ${esc(what)} <span class="nw">(${costHtml(eg)}).</span></li>`).join("")}` : ""}</ul>`;
/** Does a text draw any timing badge? */
export const hasBadges = text => [...String(text || "").matchAll(new RegExp(TAG.source, "g"))].some(m => tagInfo(m[1]));
/** Does a text draw any cost badge? */
export const hasCosts = text => new RegExp(COST.source, "i").test(String(text || ""));

// a lowercase one-word name after its own verb: "inflict 1T1 smeckeldorfed", "stacks of hardened", "summon a silithid"
const AMOUNT = "(?:[^\\S\\n]+[\\dX]+T[\\dX]+(?:\\([^)\\n]*\\))?)?";
const status = new RegExp(`\\b(?:inflict|cleanse|stacks? of)${AMOUNT}[^\\S\\n]+$`, "i");
const VERB = { buff: status, debuff: status, minion: /\b(?:summon|resummon|revive)(?:[^\S\n]+(?:a|an|the|\d+))?[^\S\n]+$/i };

// token variants ([fire:glow]), as the font draws them: tint and sticker take the text colour (style.css paints build_site's
// masks), glow and darkglow are images; one without its image (an older build) is the plain icon, as the parser reads it
export const VARIANT_NAMES = { tint: "text colour", sticker: "sticker", no: "crossed out", glow: "white glow", darkglow: "black glow" };
/** A token's text ("fire", "Fire:Glow") as {base, v} (v "" without a colon), or null when the font draws no such
 *  variant: [fire:], [fire:glows] and [fire: glow] print as letters (AutoCroissant psd_parser ICON_VARIANTS). */
export function splitToken(token) {
  const s = String(token ?? ""), at = s.indexOf(":");
  if (at < 0) return { base: s, v: "" };
  const v = s.slice(at + 1).toLowerCase();
  return Object.hasOwn(VARIANT_NAMES, v) ? { base: s.slice(0, at), v } : null;
}
/** The variant's image of an icon entry: icons/fire.<stamp>.webp -> icons/fire.<stamp>.glow.webp (the stamp covers the variants) */
export const variantFile = (ic, v) => ic.file.replace(/\.webp$/, `.${v}.webp`);

/** Build the renderer once per data load: knows icons (and their variants' reach, cards.json iconVariants) and which
 *  card names to link. */
export function makeRenderer({ cards, icons, variants = {} }) {
  // card names of 3+ characters by printed title or file name: any case, either apostrophe, trailing !?. optional, a
  // plural or possessive ending kept in the link ("Copper Swords", "Grodus X's")
  const fold = s => String(s || "").trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  const byName = new Map();
  const add = (n, c) => { const k = fold(n); if (k.length < 3) return; if (!byName.has(k)) byName.set(k, c); };
  const oneWord = s => !/\s/.test(String(s || "").trim());
  for (const c of cards) add(c.name, c);
  for (const c of cards) if (!oneWord(c.key) || oneWord(c.name)) add(c.key, c);   // not "Blockade" for The Wall By Ech
  for (const c of cards) add(c.name.trim().replace(/[!?.]+$/, ""), c);      // "Party" for Party!
  for (const c of cards) if (!oneWord(c.name) && /[^siu]s$/i.test(c.name.trim())) add(c.name.trim().slice(0, -1), c);   // "an X Fist"
  const isRef = (m, text, card) => {
    const t = m[1], spelt = [card.name.trim(), String(card.key || "").trim()];
    if (t === t.toUpperCase() && t !== t.toLowerCase() && !spelt.includes(t)) return false;   // capitals it doesn't print: a heading ("PANDA")
    if (/\s/.test(t)) return true;
    // one word: as spelt, capitalized ("Springtrap", never "stay") or after its VERB, whatever word comes before it
    // ("Au Dreamshield" as "bb Dreamshield"); not a label ("Cat: +2 SPD") or a verb ("Heal 2 HP")
    const after = text.slice(m.index + m[0].length), before = text.slice(0, m.index);
    if (after[0] === ":" || /^[^\S\n]+(?:\d|X\b)/.test(after)) return false;
    if (!(spelt.includes(t) && !m[2]) && !/^\p{Lu}/u.test(t)) return !!VERB[card.type]?.test(before);
    // opening a clause and followed by to/the/a…: a verb ("(BOGT) Flip to the other creature")
    return !(/(?:^|[\n.!?:)])[^\S\n]*$/.test(before) && /^[^\S\n]+(?:to|the|a|an|your|its|all|any|each|it|this|that)\b/.test(after));
  };
  const pat = k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['‘’]").replace(/ /g, "[ \\t]+");
  // one sticky regex per first word, tried at each word start: far fewer alternatives per place than one of all names
  const END = "((?:['‘’]s|(?<=s)['‘’]|e?s)(?![\\w'‘’]))?(?![\\w'‘’])", WORD = /(?<![\w'‘’])(?:[\p{L}\p{N}_]+|[^\s\w'‘’])/gu;
  const groups = new Map();
  for (const k of [...byName.keys()].sort((a, b) => b.length - a.length)) { const h = k.match(WORD)?.[0] ?? k; groups.set(h, [...(groups.get(h) || []), pat(k)]); }
  for (const [h, ps] of groups) groups.set(h, new RegExp(`(${ps.join("|")})${END}`, "iy"));
  const PIECE = new RegExp(`\\[([^\\[\\]\\n]{1,52})\\]|${TAG.source}|${COST.source}`, "gi");

  /** HTML for a token's text ("fire", "fire:glow"), null for no icon or a variant the font lacks; tip: false leaves out
   *  the tooltip */
  function icon(token, { tip = true } = {}) {
    const parts = splitToken(token), ic = parts && icons[norm(parts.base)];
    if (!ic) return null;
    const { base, v } = parts, name = base.replace(/_/g, " ");
    const drawn = v === "no" || (ic.v?.includes(v) && variants[v] !== undefined);
    const label = drawn ? `${name} (${v === "no" ? "not" : VARIANT_NAMES[v]})` : name;
    const t = tip ? ` data-tip="${esc(label)}"` : "";
    const img = `<img class="tok" src="${esc(ic.file)}" alt="${esc(drawn ? label : base)}"${t}>`;
    if (!drawn) return img;
    if (v === "no") return `<span class="tok-no">${img}</span>`;
    const file = esc(variantFile(ic, v)), mask = `-webkit-mask-image:url(&quot;${file}&quot;);mask-image:url(&quot;${file}&quot;)`;
    const r = `--r:${+variants[v]}`;
    if (v === "tint") return `<span class="tokm" role="img" aria-label="${esc(label)}" style="${mask}"${t}></span>`;
    if (v === "sticker") return `<span class="tokv" role="img" aria-label="${esc(label)}" style="${r}"${t}><span class="tokm" style="${mask}"></span><img src="${esc(ic.file)}" alt=""></span>`;
    return `<img class="tokv" src="${file}" alt="${esc(label)}" style="${r}"${t}>`;
  }

  const hasIcon = token => { const parts = splitToken(token); return !!(parts && icons[norm(parts.base)]); };   // icon(token) !== null
  // icons and badges as [index, length, html]; links as [index, length, card], judged over the whole text with each
  // icon or badge read as a space, so render and mentions agree
  // (html false: the pieces' places only, for mentions)
  function parse(text, html_ = true) {
    const pieces = [];
    for (const m of text.matchAll(PIECE)) {
      const html = !html_ ? (m[1] !== undefined ? hasIcon(m[1]) : m[3] !== undefined || !!tagInfo(m[2])) || null
        : m[1] !== undefined ? icon(m[1]) : m[3] !== undefined ? costHtml(m[3]) : (tagInfo(m[2]) ? tagHtml(m[2]) : null);
      if (html !== null) pieces.push([m.index, m[0].length, html]);
    }
    const links = [];
    let flat = text, spaced = text;                     // flat: a name never spans an icon; spaced: for isRef
    for (const [i, n] of pieces) { flat = flat.slice(0, i) + "\0".repeat(n) + flat.slice(i + n); spaced = spaced.slice(0, i) + " ".repeat(n) + spaced.slice(i + n); }
    let end = 0;
    for (const w of flat.matchAll(WORD)) {
      if (w.index < end) continue;
      const h = w[0].toLowerCase();
      let m = null;
      for (const x of h.endsWith("es") ? [h, h.slice(0, -1), h.slice(0, -2)] : h.endsWith("s") ? [h, h.slice(0, -1)] : [h]) {   // "drones", "Cabbages"
        const g = groups.get(x);
        if (g) { g.lastIndex = w.index; if ((m = g.exec(flat))) break; }
      }
      if (!m) continue;
      end = m.index + m[0].length;
      const card = byName.get(fold(m[1]));
      if (card && isRef(m, spaced, card)) links.push([m.index, m[0].length, card]);   // its own name too (owner 10-30)
    }
    return { pieces, links };
  }

  /** HTML for ability text; links: false leaves card names as text (the rulebook links its own) */
  function render(text, { links: linked = true } = {}) {
    if (!text) return "";
    const { pieces, links: found } = parse(text), links = linked ? found : [];
    const out = [];
    let last = 0;
    for (const [i, n, x] of [...pieces, ...links].sort((a, b) => a[0] - b[0])) {
      out.push(esc(text.slice(last, i)), typeof x === "string" ? x : `<a class="card-ref" href="#/card/${x.id}" data-card="${x.id}">${esc(text.slice(i, i + n))}</a>`);
      last = i + n;
    }
    out.push(esc(text.slice(last)));
    return out.join("").replace(/\n/g, "<br>");
  }

  /** Cards whose names appear in a text (for "mentions" / "mentioned by"). */
  function mentions(text) {
    return new Set(text ? parse(text, false).links.map(l => l[2].id) : []);
  }
  iconOf = icon;
  return { render, mentions, icon };
}

let iconOf = null;                                   // the last renderer's icon(): diffs draw tokens with it
/** One piece of text as HTML: its timing tags as badges and its [tokens] as icons (a diff's words) */
export function inlineHtml(text) {
  return String(text ?? "").replace(/\[([^\[\]\n]{1,52})\]|\((-?[0-9A-Za-z/]{2,8})\)|[^[(]+|[[(]/g, (all, token, tag) =>
    token !== undefined ? (iconOf?.(token) ?? esc(all)) : tag !== undefined && tagInfo(tag) ? tagHtml(tag) : esc(all));
}

/** Plain text (tokens as words), e.g. for copying. */
export function plain(text) {
  return String(text || "").replace(/\[([^\]:\n]+)(:no)?(:[a-z]+)?\]/gi, (_, n, no) => `${no ? "non-" : ""}${n.replace(/_/g, " ")}`);
}

/** Word-level diff (LCS) as HTML with <ins>/<del>, badges and icons drawn (inlineHtml). */
export function diffWords(before, after) {
  const a = String(before || "").split(/(\s+)/), b = String(after || "").split(/(\s+)/), esc = inlineHtml;
  const n = a.length, m = b.length;
  if (n * m > 400000) return esc(after).replace(/\n/g, "<br>");
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(esc(a[i])); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`<del>${esc(a[i++])}</del>`);
    else out.push(`<ins>${esc(b[j++])}</ins>`);
  }
  while (i < n) out.push(`<del>${esc(a[i++])}</del>`);
  while (j < m) out.push(`<ins>${esc(b[j++])}</ins>`);
  return out.join("").replace(/\n/g, "<br>");
}
