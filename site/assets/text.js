// Ability text: icon tokens, timing-tag badges, links to other cards, and word diffs.

export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
export const norm = s => String(s || "").toLowerCase().replace(/[\s_\-.'’]+/g, "");

// Timing tags. Colors match the stoogedings font badges. Cooldowns and uses replaced the older tags on the cards
// (2026-10-21); the rulebook pages still use the old ones.
const FIXED = {
  OYT: ["turn", "On your turn"], AAT: ["any", "At any time"],
  BOT: ["forced", "Beginning of turn (forced)"], ENDT: ["forced", "End of turn (forced)"],
  BOGT: ["forced", "Beginning of global turn (forced)"], ENDGT: ["forced", "End of global turn (forced)"],
  OFS: ["trigger", "On first summon"], OS: ["trigger", "On summon"], OD: ["trigger", "On death"], WOF: ["trigger", "While on field"],
};
export const TAG = /\((-?[0-9A-Z/]{2,6})\)/;   // candidates; tagInfo decides. Not /g: copy it to iterate
const times = n => (n === "X" ? "X times" : n === "1" ? "once" : `${n} times`);
const count = (n, one, many = one + "s") => `${n} ${n === "1" || n === "-1" ? one : many}`;
const old = (group, meaning, multi = false) => ({ group, meaning: `Old system: ${meaning}`, multi, old: true });
export function tagInfo(tag) {
  if (FIXED[tag]) return { group: FIXED[tag][0], meaning: FIXED[tag][1], multi: false };
  let m;
  if ((m = /^([1-9X])CD$/.exec(tag))) return { group: "turn", meaning: `Cooldown: ${count(m[1], "turn")}` };
  if ((m = /^([1-9X])GCD$/.exec(tag))) return { group: "any", meaning: `Global cooldown: ${count(m[1], "global turn")}` };
  if ((m = /^(-1|[0-9X])\/([1-9X])CD$/.exec(tag))) return { group: "turn", meaning: `Cooldown: ${count(m[1], "turn")}, then ${m[2]}` };
  if ((m = /^(-1|[0-9X])\/([1-9X])GCD$/.exec(tag))) return { group: "any", meaning: `Global cooldown: ${count(m[1], "global turn")}, then ${m[2]}` };
  if ((m = /^([1-9X])U$/.exec(tag))) return { group: "trigger", meaning: count(m[1], "use") };
  if ((m = /^([1-9X])PG$/.exec(tag))) return { group: "trigger", meaning: `Can only be activated ${times(m[1])} per game` };
  if ((m = /^([1-9X])PGT$/.exec(tag))) return old("any", `usable ${times(m[1])} per global turn (at any time)`);
  if ((m = /^([1-9X])PT$/.exec(tag))) return old("turn", `usable ${times(m[1])} per turn (on your turn)`);
  if ((m = /^FTE([1-9X])T$/.exec(tag))) return old("turn", `every ${m[1]} turns, starting on your 1st turn (multi-turn)`, true);
  if ((m = /^E([1-9X])GT$/.exec(tag))) return old("any", `every ${m[1]} global turns (at any time, multi-turn)`, true);
  if ((m = /^E([1-9X])T$/.exec(tag))) return old("turn", `every ${m[1]} turns, starting on turn ${m[1]} (multi-turn)`, true);
  return null;
}
export const GROUP_NAMES = { turn: "On your turn", any: "At any time", forced: "Forced", trigger: "Per game & triggers" };
export const badgeHtml = tag => {
  const t = tagInfo(tag);
  return t ? `<span class="badge ${t.group}" data-tip="${esc(`(${tag}) ${t.meaning}`)}">${esc(tag.replace("-", "\u2212"))}</span>` : esc(`(${tag})`);
};

// words a one-word name may follow: verbs and little words ("Summon Jetpack", "If Gasoline"; "Evil Quote" is something else)
const LEAD = /^(?:Summon|Resummon|Equip|Create|Cleanse|Inflict|Draw|Acquire|Revive|Gain|Give|Steal|Copy|Become|Remove|Destroy|Discard|Use|Play|Return|Swap|Choose|Target|If|When|Whenever|While|Once|Until|Unless|After|Before|Then|And|Or|A|An|The|This|That|These|Each|Every|Any|Your|Its)$/;

/** Build the renderer once per data load: knows icons and which card names to link. */
export function makeRenderer({ cards, icons }) {
  // card names of 3+ characters by printed title or file name: any case, either apostrophe, trailing !?. optional, a
  // plural or possessive ending kept in the link ("Copper Swords", "Grodus X's")
  const fold = s => String(s || "").trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  const byName = new Map();
  const add = (n, c) => { const k = fold(n); if (k.length >= 3 && !byName.has(k)) byName.set(k, c); };
  const oneWord = s => !/\s/.test(String(s || "").trim());
  for (const c of cards) add(c.name, c);
  for (const c of cards) if (!oneWord(c.key) || oneWord(c.name)) add(c.key, c);   // not "Blockade" for The Wall By Ech
  for (const c of cards) add(c.name.trim().replace(/[!?.]+$/, ""), c);      // "Party" for Party!
  for (const c of cards) if (!oneWord(c.name) && /[^siu]s$/i.test(c.name.trim())) add(c.name.trim().slice(0, -1), c);   // "an X Fist"
  const isRef = (m, text, card) => {
    const t = m[1], spelt = [card.name.trim(), String(card.key || "").trim()];
    if (t === t.toUpperCase() && t !== t.toLowerCase() && !spelt.includes(t)) return false;   // capitals it doesn't print: a heading ("PANDA")
    if (/\s/.test(t)) return true;
    // one word: as spelt or capitalized ("Springtrap", never "stay"), not a label ("Cat: +2 SPD"), after a LEAD word or a card
    if (!(spelt.includes(t) && !m[2]) && !/^\p{Lu}/u.test(t)) return false;
    const after = text.slice(m.index + m[0].length);
    if (after[0] === ":") return false;
    const before = text.slice(0, m.index), w = /(?:^|[\s(“"‘'])(\p{Lu}[\p{L}\p{N}_'’-]*)[^\S\n]+$/u.exec(before);
    if (w) return LEAD.test(w[1]) || byName.has(fold(w[1]));
    // opening a clause and followed by to/the/a…: a verb ("(BOGT) Flip to the other creature")
    return !(/(?:^|[\n.!?:)])[^\S\n]*$/.test(before) && /^[^\S\n]+(?:to|the|a|an|your|its|all|any|each|it|this|that)\b/.test(after));
  };
  const pat = k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['‘’]").replace(/ /g, "[ \\t]+");
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(pat);
  const nameRe = names.length ? new RegExp(`(?<![\\w'‘’])(${names.join("|")})((?:['‘’]s|(?<=s)['‘’]|e?s)(?![\\w'‘’]))?(?![\\w'‘’])`, "gi") : null;
  const PIECE = new RegExp(`\\[([^\\[\\]\\n]{1,48})\\]|${TAG.source}`, "g");

  function icon(token) {
    const [base, variant] = token.split(":");
    const ic = icons[norm(base)];
    if (!ic) return null;
    const img = `<img class="tok" src="${esc(ic.file)}" alt="${esc(base)}" data-tip="${esc(base.replace(/_/g, " "))}${variant === "no" ? " (not)" : ""}">`;
    return variant && variant.trim().toLowerCase() === "no" ? `<span class="tok-no">${img}</span>` : img;
  }

  // icons and badges as [index, length, html]; links as [index, length, card], judged over the whole text with each
  // icon or badge read as a space, so render and mentions agree
  function parse(text, selfName) {
    const pieces = [];
    for (const m of text.matchAll(PIECE)) {
      const html = m[1] !== undefined ? icon(m[1]) : (tagInfo(m[2]) ? badgeHtml(m[2]) : null);
      if (html !== null) pieces.push([m.index, m[0].length, html]);
    }
    const links = [];
    if (nameRe) {
      let flat = text, spaced = text;                   // flat: a name never spans an icon; spaced: for isRef
      for (const [i, n] of pieces) { flat = flat.slice(0, i) + "\0".repeat(n) + flat.slice(i + n); spaced = spaced.slice(0, i) + " ".repeat(n) + spaced.slice(i + n); }
      for (const m of flat.matchAll(nameRe)) {
        const card = byName.get(fold(m[1]));
        if (card && card.name !== selfName && isRef(m, spaced, card)) links.push([m.index, m[0].length, card]);
      }
    }
    return { pieces, links };
  }

  /** HTML for ability text. */
  function render(text, selfName = "") {
    if (!text) return "";
    const { pieces, links } = parse(text, selfName);
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
  function mentions(text, selfName = "") {
    return new Set(text ? parse(text, selfName).links.map(l => l[2].id) : []);
  }
  return { render, mentions, icon };
}

/** Plain text (tokens as words), e.g. for copying. */
export function plain(text) {
  return String(text || "").replace(/\[([^\]:\n]+)(:no)?(:[a-z]+)?\]/gi, (_, n, no) => `${no ? "non-" : ""}${n.replace(/_/g, " ")}`);
}

/** Word-level diff (LCS) as HTML with <ins>/<del>. */
export function diffWords(before, after) {
  const a = String(before || "").split(/(\s+)/), b = String(after || "").split(/(\s+)/);
  const n = a.length, m = b.length;
  if (n * m > 400000) return esc(after);
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
