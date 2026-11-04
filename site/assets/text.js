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
export const TAG = /\((-?[0-9A-Za-z/]{2,6})\)/;   // candidates, any case; tagInfo decides. Not /g: copy it to iterate
// any letter case is the same tag, as in the font: "(1cd)" is (1CD), "(action)" is (Action)
const CANON = Object.fromEntries(Object.keys(FIXED).map(k => [k.toUpperCase(), k]));
const canon = tag => { const up = String(tag).toUpperCase(); return CANON[up] ?? up; };
const times = n => (n === "X" ? "X times" : n === "1" ? "once" : `${n} times`);
const count = (n, one, many = one + "s") => `${n} ${n === "1" || n === "-1" ? one : many}`;
const old = (group, meaning, multi = false) => ({ group, meaning: `Old system: ${meaning}`, multi, old: true });
/** {tag (canonical case), group, meaning, multi, old} or null. The meaning is the Timing Tags chapter's when it lists
 *  the tag, or its family with X ("XCD" for (3CD): X is 3, "turn(s)" agrees); else the one below. */
export function tagInfo(typed) {
  const tag = canon(typed), info = tagMeaning(tag);
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
  if ((m = /^([1-9X])CD$/.exec(tag))) return { group: "turn", meaning: `Cooldown: ${count(m[1], "turn")}` };
  if ((m = /^([1-9X])GCD$/.exec(tag))) return { group: "any", meaning: `Global cooldown: ${count(m[1], "global turn")}` };
  if ((m = /^(-1|[0-9XY])\/([1-9X])CD$/.exec(tag))) return { group: "turn", meaning: `Cooldown: starts with ${m[1]} of ${count(m[2], "turn")} of charge` };
  if ((m = /^(-1|[0-9XY])\/([1-9X])GCD$/.exec(tag))) return { group: "any", meaning: `Global cooldown: starts with ${m[1]} of ${count(m[2], "turn")} of charge` };
  if ((m = /^([1-9X])U$/.exec(tag))) return { group: "trigger", meaning: count(m[1], "use") };
  if ((m = /^([1-9X])PG$/.exec(tag))) return { group: "trigger", meaning: `Can only be activated ${times(m[1])} per game` };
  if ((m = /^([1-9X])PGT$/.exec(tag))) return old("any", `usable ${times(m[1])} per global turn (at any time)`);
  if ((m = /^([1-9X])PT$/.exec(tag))) return old("turn", `usable ${times(m[1])} per turn (on your turn)`);
  if ((m = /^FTE([1-9X])T$/.exec(tag))) return old("turn", `every ${m[1]} turns, starting on your 1st turn (multi-turn)`, true);
  if ((m = /^E([1-9X])GT$/.exec(tag))) return old("any", `every ${m[1]} global turns (at any time, multi-turn)`, true);
  if ((m = /^E([1-9X])T$/.exec(tag))) return old("turn", `every ${m[1]} turns, starting on turn ${m[1]} (multi-turn)`, true);
  return null;
}
export const GROUP_NAMES = { turn: "On your turn", any: "At any time", forced: "Forced", trigger: "Per game, uses & triggers", neutral: "Other tags" };
export const badgeHtml = (tag, tip = true) => {   // tip false: the note is the parent's (a "3CD+" head)
  const t = tagInfo(tag);
  return t ? `<span class="badge ${t.group}"${tip ? ` data-tip="${esc(`(${t.tag}) ${t.meaning}`)}"` : ""}>${esc(t.tag.replace("-", "\u2212"))}</span>` : esc(`(${tag})`);
};

// Costs in parentheses, drawn by the site only (the font has no such badge): "(2 points)", "(1 point)", "(1.5 points)",
// "(X bricks)", "(2 SP)", "(1 star point)" (the team's points, BRICKS and star points, rulebook 04 Table), "(4 souls)",
// "(3 counters)" (a card's own currency).
// html[data-costs="icons"] (the Badges panel's switch, localStorage "costs") draws points as a coin, bricks as a brick.
// Right after a number or word it is a multiplier, not a cost: Warcraftian Rogue's "Deal 2(x counters) DMG".
export const COST = /(?<![\w.])\(((?:\d+(?:\.\d+)?|[Xx])[^\S\n]+(?:points?|bricks?|SP|star[^\S\n]+points?|souls?|(?:[A-Za-z][\w'’-]*[^\S\n]+)?counters?))\)/i;
const COST_TIP = { points: "your team's points (earned when enemy prime creatures are defeated, spent on abilities and the item shop)",
  bricks: "your team's BRICKS (mined by creatures, spent on field cards)",
  sp: "your team's star points (set to 7 each global turn, spent to play items)", own: "a currency of this card's own" };
/** {n, unit (as typed), kind: points | bricks | own} of a cost's text ("2 points"), or null */
export function costInfo(typed) {
  const m = /^((?:\d+(?:\.\d+)?|[Xx]))[^\S\n]+(.+)$/.exec(String(typed).trim());
  if (!m || !COST.test(`(${typed})`)) return null;
  const unit = m[2].replace(/\s+/g, " "), kind = /^points?$/i.test(unit) ? "points" : /^bricks?$/i.test(unit) ? "bricks"
    : /^(?:sp|star points?)$/i.test(unit) ? "sp" : "own";
  return { n: m[1].toUpperCase(), unit, kind };
}
export const costHtml = typed => {
  const c = costInfo(typed);
  if (!c) return esc(`(${typed})`);
  const unit = c.kind === "sp" && /^sp$/i.test(c.unit) ? "SP" : c.unit.replace(/(^|\s)\p{Ll}/gu, x => x.toUpperCase());   // "2 Points", "3 Ritual Counters"
  return `<span class="badge cost ${c.kind}" data-tip="${esc(`${c.n} ${c.unit.toLowerCase()}: ${COST_TIP[c.kind]}`)}"><span class="cost-n">${esc(c.n)}</span><span class="cost-u"> ${esc(unit)}</span></span>`;
};
export const COST_STYLES = [["text", "Text"], ["icons", "Coins and bricks"]];
export const costStyle = () => (document.documentElement.dataset.costs === "icons" ? "icons" : "text");

// badge colour legend, one line per colour: the text of rulebook page 02 Abbreviations; colours come from tagInfo's groups
const COLOUR = { turn: "Blue", any: "Purple", forced: "Red", trigger: "Orange", neutral: "Grey" };
export const LEGEND = [
  ["on your turn", ["1CD", "1/2CD", "OYT"]], ["at any time", ["1GCD", "AAT"]], ["forced", ["BOT", "ENDT", "BOGT", "ENDGT"]],
  ["per game, uses and triggers", ["1PG", "2U", "OFS", "OS", "OD", "WOF"]], ["costs the creature's action", ["Action"]],
].map(([what, tags]) => ({ group: tagInfo(tags[0]).group, colour: COLOUR[tagInfo(tags[0]).group], what, tags }));
const COSTS = [["Gold", "points", "2 points", "#f2c230"], ["Brown", "BRICKS", "2 bricks", "#8a4b2a"], ["Teal", "a card's own currency", "4 souls", "#0f766e"]];   // style.css colours
/** costs: the cost lines too, with the Text / Coins and bricks switch (data-action="cost-style") */
export const legendHtml = (costs = false) => `<ul class="badge-legend">${LEGEND.map(l => `<li><span class="badge ${l.group} swatch" aria-hidden="true"></span><b>${l.colour}:</b> ${esc(l.what)} ${l.tags.map((t, i) => `<span class="nw">${i ? "" : "("}${badgeHtml(t)}${i < l.tags.length - 1 ? "," : ")."}</span>`).join(" ")}</li>`).join("")}${costs
  ? `${COSTS.map(([colour, what, eg, bg]) => `<li><span class="badge swatch" style="background:${bg}" aria-hidden="true"></span><b>${colour}:</b> ${esc(what)} <span class="nw">(${costHtml(eg)}).</span></li>`).join("")}<li class="cost-switch">Points and bricks as ${COST_STYLES.map(([v, l]) => `<button type="button" class="chip${costStyle() === v ? " on" : ""}" data-action="cost-style" data-value="${v}" aria-pressed="${costStyle() === v}">${l}</button>`).join(" ")}</li>` : ""}</ul>`;
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

// true: a card name links (and counts as a mention) only typed in its own letter case (on 2026-10-30, off 11-01)
const EXACT_CASE = false;

/** Build the renderer once per data load: knows icons (and their variants' reach, cards.json iconVariants) and which
 *  card names to link. */
export function makeRenderer({ cards, icons, variants = {} }) {
  // card names of 3+ characters by printed title or file name: any case, either apostrophe, trailing !?. optional, a
  // plural or possessive ending kept in the link ("Copper Swords", "Grodus X's")
  const fold = s => String(s || "").trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  const same = s => String(s || "").trim().replace(/[‘’]/g, "'").replace(/\s+/g, " ");   // fold, letter case kept
  const byName = new Map(), spelt = new Map();         // spelt: fold -> the spellings in their own case (EXACT_CASE)
  const add = (n, c) => { const k = fold(n); if (k.length < 3) return; if (!byName.has(k)) byName.set(k, c); (spelt.get(k) || spelt.set(k, new Set()).get(k)).add(same(n)); };
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
        : m[1] !== undefined ? icon(m[1]) : m[3] !== undefined ? costHtml(m[3]) : (tagInfo(m[2]) ? badgeHtml(m[2]) : null);
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
      if (EXACT_CASE && !spelt.get(fold(m[1]))?.has(same(m[1]))) continue;
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
  return String(text ?? "").replace(/\[([^\[\]\n]{1,52})\]|\((-?[0-9A-Za-z/]{2,6})\)|[^[(]+|[[(]/g, (all, token, tag) =>
    token !== undefined ? (iconOf?.(token) ?? esc(all)) : tag !== undefined && tagInfo(tag) ? badgeHtml(tag) : esc(all));
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
