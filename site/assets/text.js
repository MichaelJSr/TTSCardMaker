// Ability text: icon tokens, timing-tag badges, links to other cards, and word diffs.

export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
export const norm = s => String(s || "").toLowerCase().replace(/[\s_\-.'’]+/g, "");

// Timing tags from the rulebook's "02 Abbreviations" page. Colors match the stoogedings font badges.
const FIXED = {
  OYT: ["turn", "On your turn"], AAT: ["any", "At any time"],
  BOT: ["forced", "Beginning of turn (forced)"], ENDT: ["forced", "End of turn (forced)"],
  BOGT: ["forced", "Beginning of global turn (forced)"], ENDGT: ["forced", "End of global turn (forced)"],
  OFS: ["trigger", "On first summon"], OS: ["trigger", "On summon"], OD: ["trigger", "On death"], WOF: ["trigger", "While on field"],
};
const times = n => (n === "X" ? "X times" : n === "1" ? "once" : `${n} times`);
export function tagInfo(tag) {
  if (FIXED[tag]) return { group: FIXED[tag][0], meaning: FIXED[tag][1], multi: false };
  let m;
  if ((m = /^([1-9X])PGT$/.exec(tag))) return { group: "any", meaning: `Usable ${times(m[1])} per global turn (at any time)` };
  if ((m = /^([1-9X])PT$/.exec(tag))) return { group: "turn", meaning: `Usable ${times(m[1])} per turn (on your turn)` };
  if ((m = /^FTE([1-9X])T$/.exec(tag))) return { group: "turn", meaning: `Every ${m[1]} turns, starting on your 1st turn (multi-turn)`, multi: true };
  if ((m = /^E([1-9X])GT$/.exec(tag))) return { group: "any", meaning: `Every ${m[1]} global turns (at any time, multi-turn)`, multi: true };
  if ((m = /^E([1-9X])T$/.exec(tag))) return { group: "turn", meaning: `Every ${m[1]} turns, starting on turn ${m[1]} (multi-turn)`, multi: true };
  if ((m = /^([1-9X])PG$/.exec(tag))) return { group: "trigger", meaning: `Can only be activated ${times(m[1])} per game` };
  return null;
}
export const GROUP_NAMES = { turn: "On your turn", any: "At any time", forced: "Forced", trigger: "Per game & triggers" };
export const badgeHtml = tag => {
  const t = tagInfo(tag);
  return t ? `<span class="badge ${t.group}" data-tip="${esc(`(${tag}) ${t.meaning}`)}">${esc(tag)}</span>` : esc(`(${tag})`);
};

/** Build the renderer once per data load: knows icons and which card names to link. */
export function makeRenderer({ cards, icons }) {
  // link card names of 3+ characters, matched case-sensitively. A one-word name ("Rope", "Bomb") doesn't count at the
  // start of a sentence or right after another capitalized word ("Flame Bomb" is something else).
  const byName = new Map();
  for (const c of cards) {
    const n = c.name.trim();
    if (n.length < 3 || byName.has(n)) continue;
    byName.set(n, c);
  }
  const isRef = (name, text, i) => {
    if (/\s/.test(name)) return true;
    const before = text.slice(0, i).trimEnd();
    return !!before && !/[.!?:\n]$/.test(before) && !/(?:^|[\s(])[A-Z][\w'’-]*$/.test(before);
  };
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const nameRe = names.length ? new RegExp(`(?<![\\w'’])(${names.join("|")})(?![\\w'’])`, "g") : null;
  const PIECE = /\[([^\[\]\n]{1,48})\]|\(([0-9A-Z]{2,6})\)/g;

  function icon(token) {
    const [base, variant] = token.split(":");
    const ic = icons[norm(base)];
    if (!ic) return null;
    const img = `<img class="tok" src="${esc(ic.file)}" alt="${esc(base)}" data-tip="${esc(base.replace(/_/g, " "))}${variant === "no" ? " (not)" : ""}">`;
    return variant && variant.trim().toLowerCase() === "no" ? `<span class="tok-no">${img}</span>` : img;
  }

  function linkNames(text, selfName, out) {
    if (!nameRe) { out.push(esc(text)); return; }
    let last = 0;
    nameRe.lastIndex = 0;
    for (const m of text.matchAll(nameRe)) {
      const name = m[1], card = byName.get(name), i = m.index;
      if (!card || name === selfName || !isRef(name, text, i)) continue;
      out.push(esc(text.slice(last, i)), `<a class="card-ref" href="#/card/${card.id}" data-card="${card.id}">${esc(name)}</a>`);
      last = i + name.length;
    }
    out.push(esc(text.slice(last)));
  }

  /** HTML for ability text. */
  function render(text, selfName = "") {
    if (!text) return "";
    const out = [];
    let last = 0;
    for (const m of text.matchAll(PIECE)) {
      const html = m[1] !== undefined ? icon(m[1]) : (tagInfo(m[2]) ? badgeHtml(m[2]) : null);
      if (html === null) continue;
      linkNames(text.slice(last, m.index), selfName, out);
      out.push(html);
      last = m.index + m[0].length;
    }
    linkNames(text.slice(last), selfName, out);
    return out.join("").replace(/\n/g, "<br>");
  }

  /** Cards whose names appear in a text (for "mentions" / "mentioned by"). */
  function mentions(text, selfName = "") {
    const found = new Set();
    if (!text || !nameRe) return found;
    const flat = text.replace(PIECE, " ");
    for (const m of flat.matchAll(nameRe)) {
      const card = byName.get(m[1]);
      if (card && m[1] !== selfName && isRef(m[1], flat, m.index)) found.add(card.id);
    }
    return found;
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
