// Ability text: icon tokens, timing-tag badges, links to other cards, and word diffs.

export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const LUM = new Map();
const lum = c => { let v = LUM.get(c); if (v === undefined) { const [r, g, b] = [1, 3, 5].map(i => { const x = parseInt(c.slice(i, i + 2), 16) / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); LUM.set(c, v = 0.2126 * r + 0.7152 * g + 0.0722 * b); } return v; };
const BOXES = { d: ["#232321", "#1a1a19"].map(lum), l: ["#f0efec", "#fcfcfb"].map(lum) };   // style.css --surface-2 (ability, note), --surface (title)
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** " lo-d" and/or " lo-l": the themes whose boxes a colour is too close to (under 3:1), where it gets an outline (style.css). */
export const lowOn = c => Object.entries(BOXES).map(([k, boxes]) => (boxes.some(b => ratio(b, lum(c)) < 3) ? ` lo-${k}` : "")).join("");
/** Escaped text[a:b] with its colour runs ([{start, end, color}]: textcolor.js wordColors, colorRanges) as spans; a
 *  colour is "#rrggbb" or left out, the text escaped. */
export function paintHtml(text, ranges, a = 0, b = String(text ?? "").length) {
  text = String(text ?? "");
  let out = "", at = a;
  for (const r of ranges || []) {
    const s = Math.max(r.start, a), e = Math.min(r.end, b);
    if (e <= s || !/^#[0-9a-f]{6}$/.test(r.color)) continue;
    out += esc(text.slice(at, s)) + `<span class="tc${lowOn(r.color)}" style="color:${r.color}">${esc(text.slice(s, e))}</span>`;
    at = e;
  }
  return out + esc(text.slice(at, b));
}
/** toLocaleDateString(undefined, opts) as a function, its Intl.DateTimeFormat made once on first use (one per call was a hotspot) */
export const dateFmt = opts => { let f = null; return d => (f ||= new Intl.DateTimeFormat(undefined, opts)).format(d); };
let HEAVY = new Set();                               // commits GitHub's page can't show (cards.json heavy, 12-char shas)
export const setHeavy = shas => { HEAVY = new Set(shas || []); };
/** A quiet link to a card version's commit on GitHub ("" without one); label: its accessible name. A heavy commit links
 *  the card's history from it (path: its PNG then), or nothing without a path */
export const commitLink = (repo, sha, label, path) => {
  const href = !sha ? "" : !HEAVY.has(String(sha).slice(0, 12)) ? `commit/${esc(sha)}` : path ? `commits/${esc(sha)}/${esc(path.split("/").map(encodeURIComponent).join("/"))}` : "";
  return repo && href ? `<a class="commit-link" href="https://github.com/${esc(repo)}/${href}" target="_blank" rel="noopener" aria-label="${esc(label)}">commit</a>` : "";
};
/** " · commit" after a date, the dot kept with the link when the line wraps ("" without one) */
export const commitAfter = (repo, sha, label, path) => { const a = commitLink(repo, sha, label, path); return a && ` <span class="commit-at">· ${a}</span>`; };
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
export const setTagMeanings = m => { CHAPTER = Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [canon(k), String(v)])); DIFFS.clear(); };
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
export const badgeHtml = (tag, tip = true, ring = "") => {   // tip false: the note is the parent's (a "3CD+" head); ring: its left end
  const t = tagInfo(tag);
  const label = t?.tag.replace("-", "\u2212");
  return t ? `<span class="badge ${t.group}${ring ? " ringed" : ""}" style="--ink:${inkShift(label)}"${tip ? ` data-tip="${esc(`(${t.tag}) ${t.meaning}`)}"` : ""}>${ring}<span class="bl">${esc(label)}</span></span>` : esc(`(${tag})`);
};

// ---- cooldown rings (owner 2026-11-04, design B): each cooldown badge's round left end, (2CD), (1/2CD), (-1/1GCD), in
// card and rulebook text, the same drawing as the cards' (build_stoogedings ring_parts) and the mock-up's (ringParts). X
// segments, zero at the top, parallel-sided slots between them: the charge it starts with clockwise in green, a start
// below zero counter-clockwise in red (each turn moves it one segment clockwise: the red unwinds, then the green fills; a
// whole ring or more below zero is all red; more than a whole ring: the band thinner, DEEP_IN, and inside it a thin red
// lap ring per further ring over the segments that deep, up to 2, LAPS), the rest hollow (outlined inside its own
// footprint); more than 8 segments: arcs by share; X two dashed circles (green when full: (X/XCD)). In the middle the
// turns until its first full charge (X - Y), in Roboto Black's figures as on the cards, its ink centred (a 1 optically:
// ONE): green when that is 0 or 1 (ready on its first turn: charge comes in as a turn begins), red when it starts below
// zero ((-1/XCD) too), else light grey (X too). No glow (owner 2026-11-04). Nothing reaches past the pill. Its tip says
// it in words. The rim (top, bottom: style.css .ring's gradient too) shades as the pill does.
const RING_RIM = { turn: ["#92b4fa", "#5b8ff9"], any: ["#c7a6ff", "#a274ff"] }, RING_GREEN = "#4ade80", RING_RED = "#ef4444", RING_BODY = "#1c2030";
const RING_HOLLOW = "#c7c9cf", RING_FAINT = "#b3b5bc", RING_NUMBER = ["#4ade80", "#ff6b6b", "#e5e7eb"];
const IN = 6.2, OUT = 9.4, SALT_OUT = 9.0, SLOT = 1.1, W = 0.9, SALT_BAND = 1.4, DASH = [2.6, 0.54], ONE = [-0.3, -0.15];
const DEEP_IN = 7.25, LAPS = [[6.1, 6.7], [5.18, 5.65]];   // more than a whole ring below zero (build_stoogedings RING_DEEP_IN, RING_LAPS)
const LINE = 50 * 22 / 950, DIV = [22 - LINE, 22 + 16 * 22 / 950];   // the salt outline; its divider's sides (build_stoogedings SALT_DIVIDER)
/** x to move a number by so that a leading 1 sits optically centred, at capitals caps tall (build_stoogedings
 *  _one_nudge: the ring's lone 1 0.3 box units, a leading one 0.15, at their capitals 7.8 and 5.7). */
const oneNudge = (t, caps) => (t[0] === "1" ? ONE[+(t.length > 1)] / (t.length > 1 ? 5.7 : 7.8) * caps : 0);
/** Roboto Black's figures and X as badges set them (build_stoogedings ring_number, LABEL_METRICS: its 1 and X re-spaced;
 *  MDW/Fonts/stoogedings-src/badge_web_font.py prints this): [advance, ink x0, y0, x1, y1, outline], font units, y down
 *  from the baseline; RING_CAP its capital height. */
const RING_CAP = 1456;
const RING_DIGITS = {"0":[1187,86,-1476,1101,20,"M1101 -861V-595Q1101 -438 1064.5 -322Q1028 -206 960.5 -130Q893 -54 800 -17Q707 20 595 20Q505 20 427 -3.5Q349 -27 286.5 -75.5Q224 -124 179 -197Q134 -270 110 -369.5Q86 -469 86 -595V-861Q86 -1019 122.5 -1134.5Q159 -1250 227 -1326Q295 -1402 388 -1439Q481 -1476 593 -1476Q683 -1476 760.5 -1452.5Q838 -1429 901 -1380.5Q964 -1332 1008.5 -1259Q1053 -1186 1077 -1086.5Q1101 -987 1101 -861ZM764 -554V-904Q764 -974 756.5 -1026Q749 -1078 734.5 -1114Q720 -1150 699 -1172.5Q678 -1195 651.5 -1205.5Q625 -1216 593 -1216Q553 -1216 521.5 -1199.5Q490 -1183 468 -1147Q446 -1111 434.5 -1051Q423 -991 423 -904V-554Q423 -483 430.5 -430.5Q438 -378 452.5 -341.5Q467 -305 488 -282.5Q509 -260 536 -250Q563 -240 595 -240Q634 -240 665 -256Q696 -272 718.5 -308.5Q741 -345 752.5 -405.5Q764 -466 764 -554Z"],"1":[880,100,-1456,769,0,"M769 -1456V0H432V-1076L100 -979V-1235L738 -1456Z"],"2":[1187,60,-1477,1106,0,"M1106 -260V0H90V-220L558 -712Q620 -783 658 -839.5Q696 -896 713.5 -942Q731 -988 731 -1025Q731 -1088 712.5 -1130.5Q694 -1173 658.5 -1195Q623 -1217 571 -1217Q519 -1217 480 -1187Q441 -1157 419.5 -1105Q398 -1053 398 -988H60Q60 -1122 125.5 -1233Q191 -1344 308 -1410.5Q425 -1477 579 -1477Q740 -1477 849 -1427Q958 -1377 1013.5 -1282.5Q1069 -1188 1069 -1055Q1069 -979 1045 -909Q1021 -839 976 -770.5Q931 -702 866.5 -630Q802 -558 720 -477L532 -260Z"],"3":[1187,48,-1477,1106,20,"M397 -869H561Q624 -869 664.5 -891.5Q705 -914 725 -955.5Q745 -997 745 -1054Q745 -1098 726.5 -1135Q708 -1172 670 -1194.5Q632 -1217 573 -1217Q533 -1217 495 -1200.5Q457 -1184 432.5 -1154Q408 -1124 408 -1081H70Q70 -1205 138.5 -1293.5Q207 -1382 319.5 -1429.5Q432 -1477 562 -1477Q717 -1477 834 -1429.5Q951 -1382 1016.5 -1289.5Q1082 -1197 1082 -1061Q1082 -986 1047 -920Q1012 -854 949 -804Q908.2 -771.6 858.3 -748.2Q921.8 -725.3 971 -689Q1036 -641 1071 -570.5Q1106 -500 1106 -409Q1106 -307 1065 -227Q1024 -147 950 -92Q876 -37 777 -8.5Q678 20 562 20Q471 20 380 -4.5Q289 -29 214 -80.5Q139 -132 93.5 -212.5Q48 -293 48 -405H386Q386 -359 411.5 -321.5Q437 -284 480 -262Q523 -240 573 -240Q635 -240 678.5 -263.5Q722 -287 745 -327Q768 -367 768 -416Q768 -490 743.5 -534Q719 -578 672.5 -598Q626 -618 561 -618H397Z"],"4":[1187,59,-1456,1127,0,"M1127 -569V-309H980V0H643V-309H79L59 -515L643 -1454.4V-1456H980V-569ZM643 -569V-1019L621 -983L381 -569H643Z"],"5":[1187,81,-1456,1099,20,"M378 -649 110 -712 198 -1456H1049V-1194H473L440 -905Q464 -919 521.5 -938.5Q579 -958 649 -958Q757 -958 840.5 -925.5Q924 -893 982 -830.5Q1040 -768 1069.5 -677Q1099 -586 1099 -469Q1099 -375 1068.5 -287.5Q1038 -200 975.5 -130.5Q913 -61 818 -20.5Q723 20 593 20Q496 20 404 -10Q312 -40 238.5 -96.5Q165 -153 122.5 -233.5Q80 -314 81 -414H420Q423 -361 445 -322Q467 -283 504.5 -261.5Q542 -240 591 -240Q641 -240 674 -260Q707 -280 726 -315Q745 -350 753 -395.5Q761 -441 761 -492Q761 -546 749.5 -589Q738 -632 713 -662.5Q688 -693 648.5 -709Q609 -725 554 -725Q481 -725 439 -700Q397 -675 378 -649Z"],"6":[1187,84,-1477,1129,20,"M849 -1477H903V-1212H885Q788 -1212 703.5 -1185Q619 -1158 555.5 -1103.5Q492 -1049 456.5 -966Q437.8 -922.3 428.9 -870.5Q476 -917.6 543 -948Q618 -982 717 -982Q817 -982 893.5 -944Q970 -906 1022.5 -838Q1075 -770 1102 -679Q1129 -588 1129 -482Q1129 -375 1091.5 -283.5Q1054 -192 986 -124Q918 -56 825 -18Q732 20 620 20Q505 20 407.5 -19.5Q310 -59 237.5 -134.5Q165 -210 124.5 -319Q84 -428 84 -566V-689Q84 -876 145.5 -1022Q207 -1168 313.5 -1269.5Q420 -1371 558 -1424Q696 -1477 849 -1477ZM421 -618V-516Q421 -446 433 -394Q445 -342 469 -308Q493 -274 528.5 -257Q564 -240 611 -240Q650 -240 683 -258Q716 -276 740.5 -309Q765 -342 778 -386Q791 -430 791 -482Q791 -538 777 -583Q763 -628 737.5 -659.5Q712 -691 676.5 -707.5Q641 -724 599 -724Q535 -724 490.5 -695.5Q446 -667 423.5 -623Q422.2 -620.5 421 -618Z"],"7":[1187,52,-1456,1102,0,"M1102 -1456V-1276L558 0H202L747 -1196H52V-1456Z"],"8":[1187,85,-1477,1101,20,"M1101 -401Q1101 -262 1035.5 -168Q970 -74 855.5 -27Q741 20 595 20Q450 20 334.5 -27Q219 -74 152 -168Q85 -262 85 -401Q85 -496 123.5 -571.5Q162 -647 231 -700Q268.9 -729.1 313.9 -750.7Q229.1 -795.7 177.5 -867.5Q116 -953 116 -1067Q116 -1201 177.5 -1292Q239 -1383 347 -1430Q455 -1477 593 -1477Q733 -1477 841 -1430Q949 -1383 1010 -1292Q1071 -1201 1071 -1067Q1071 -953 1010.5 -867.5Q959.4 -795.2 874.6 -750.1Q975 -701.7 1035 -619Q1101 -528 1101 -401ZM762 -428Q762 -488 741 -529.5Q720 -571 682 -593Q644 -615 593 -615Q543 -615 504.5 -593Q466 -571 444.5 -529.5Q423 -488 423 -428Q423 -370 445 -327.5Q467 -285 505.5 -262.5Q544 -240 595 -240Q646 -240 683.5 -262.5Q721 -285 741.5 -327.5Q762 -370 762 -428ZM734 -1049Q734 -1101 718 -1138.5Q702 -1176 671 -1196.5Q640 -1217 593 -1217Q548 -1217 517 -1197Q486 -1177 470 -1139.5Q454 -1102 454 -1049Q454 -997 470 -958Q486 -919 517.5 -897Q549 -875 595 -875Q642 -875 672.5 -897Q703 -919 718.5 -958Q734 -997 734 -1049Z"],"9":[1187,80,-1477,1096,20,"M303 -250H323Q423 -250 503 -272Q583 -294 640 -340.5Q697 -387 727.5 -461.5Q745.8 -506.3 753.1 -562.4Q707.1 -521 649.5 -495Q583 -465 509 -465Q410 -465 330.5 -500Q251 -535 195 -600Q139 -665 109.5 -755.5Q80 -846 80 -957Q80 -1064 117 -1158Q154 -1252 222 -1323.5Q290 -1395 383 -1436Q476 -1477 587 -1477Q692 -1477 784 -1437.5Q876 -1398 946 -1322Q1016 -1246 1056 -1135Q1096 -1024 1096 -881V-765Q1096 -610 1058 -485Q1020 -360 950 -265.5Q880 -171 784.5 -107.5Q689 -44 573.5 -12Q458 20 329 20H303ZM758 -802.6V-943Q758 -1013 746 -1064.5Q734 -1116 711 -1150Q688 -1184 656 -1200.5Q624 -1217 584 -1217Q544 -1217 513.5 -1194.5Q483 -1172 461.5 -1134.5Q440 -1097 429 -1050.5Q418 -1004 418 -957Q418 -904 429.5 -858.5Q441 -813 463.5 -779.5Q486 -746 520.5 -727Q555 -708 601 -708Q647 -708 680.5 -724.5Q714 -741 736 -768.5Q749 -784.8 758 -802.6Z"],"X":[1404,70,-1456,1369,0,"M482 -1456 720 -972 958 -1456H1358L952 -734L1369 0H965L720 -493L475 0H70L488 -734L81 -1456Z"]};
const deg = Math.PI / 180, P = (r, a) => `${(11 + r * Math.sin(a * deg)).toFixed(3)} ${(11 - r * Math.cos(a * deg)).toFixed(3)}`;   // 3 places: a half ring's arc keeps the font's centre
const side = (r, a, d) => a + Math.asin(d / r) / deg;          // the line d from the radial at a, parallel to it, at radius r
const A = (r, a0, a1) => `A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${P(r, a1)}`;
/** An annular sector in the ring's 22-unit box, clockwise from a0 to a1 (0 = up), its sides d inside the radials and
 *  parallel to them: SVG path data. */
const seg = (r0, r1, a0, a1, d = 0) => {
  if (!d && a1 - a0 > 359) return seg(r0, r1, a0, a0 + 180) + seg(r0, r1, a0 + 180, a0 + 360);
  const b0 = side(r1, a0, d), b1 = side(r1, a1, -d), c0 = side(r0, a0, d), c1 = side(r0, a1, -d);
  return `M${P(r1, b0)}${A(r1, b0, b1)}L${P(r0, c1)}${A(r0, c1, c0)}Z`;
};
const hollow = (r0, r1, a0, a1, d) => {                    // seg's outline, W wide inside it
  const q0 = r0 + W, q1 = r1 - W, e = d + W, b0 = side(q1, a0, e), b1 = side(q1, a1, -e), c0 = side(q0, a0, e), c1 = side(q0, a1, -e);
  return seg(r0, r1, a0, a1, d) + `M${P(q1, b1)}${A(q1, b1, b0)}L${P(q0, c0)}${A(q0, c0, c1)}Z`;
};
const annulus = (r0, r1) => `M${P(r1, 0)}${A(r1, 0, 180)}${A(r1, 180, 360)}ZM${P(r0, 0)}${A(r0, 360, 180)}${A(r0, 180, 0)}Z`;
const dashN = r => 2 * Math.max(1, Math.round(2 * Math.PI * r / DASH[0] / 2));
const dashCircle = (r, w) => {                             // dashes evenly round, a gap centred at the top
  const n = dashN(r), lit = DASH[1] * 180 / n;
  return Array.from({ length: n }, (_, k) => seg(r - w / 2, r + w / 2, (k + 0.5) * 360 / n - lit, (k + 0.5) * 360 / n + lit)).join("");
};
const poly = pts => {                                      // clockwise, as seg: overlapping pieces add up under nonzero (build _clockwise)
  if (pts.reduce((s, [x, y], i) => s + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0) < 0) pts = [...pts].reverse();
  return `M${pts.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join("L")}Z`;
};
const dashSeg = (r0, r1, a0, a1, d) => {                   // a start-X segment: its outline dashed, a dash centred on each corner
  const h = W / 2, R1 = r1 - h, R0 = r0 + h, e = d + h, xy = (r, a) => [11 + r * Math.sin(a * deg), 11 - r * Math.cos(a * deg)];
  const b0 = side(R1, a0, e), b1 = side(R1, a1, -e), c0 = side(R0, a0, e), c1 = side(R0, a1, -e);
  let out = "";
  for (const [r, f0, f1] of [[R1, b0, b1], [R0, c1, c0]]) {
    const n = Math.max(1, Math.round(Math.abs((f1 - f0) * deg) * r / DASH[0])), lit = DASH[1] / 2 * (f1 - f0) / n;
    for (let k = 0; k <= n; k++) {
      const m = f0 + k * (f1 - f0) / n, u = Math.max(Math.min(m - lit, m + lit), Math.min(f0, f1)), v = Math.min(Math.max(m - lit, m + lit), Math.max(f0, f1));
      out += seg(r - h, r + h, u, v);
    }
  }
  for (const [p, q] of [[xy(R1, b1), xy(R0, c1)], [xy(R0, c0), xy(R1, b0)]]) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]), tx = (q[0] - p[0]) / L, ty = (q[1] - p[1]) / L, n = Math.max(1, Math.round(L / DASH[0])), lit = DASH[1] / 2 * L / n;
    const at = s => [p[0] + tx * s, p[1] + ty * s];
    for (let k = 0; k <= n; k++) {
      const a = at(Math.max(0, k * L / n - lit)), b = at(Math.min(L, k * L / n + lit));
      out += poly([[a[0] - ty * h, a[1] + tx * h], [b[0] - ty * h, b[1] + tx * h], [b[0] + ty * h, b[1] - tx * h], [a[0] + ty * h, a[1] - tx * h]]);
    }
    for (const [cx, cy] of [p, q]) out += poly([[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sy]) => [cx + h * (sx * tx - sy * ty), cy + h * (sx * ty + sy * tx)]));
  }
  return out;
};
/** The cooldown's numbers: {cap (X), start (Y), global, y (the chapter's Y/X family row)} or null; "X" where the tag says
 *  X (or Y). */
export function cooldownOf(typed) {
  const t = tagInfo(typed)?.tag, m = t && (/^(-?\d+|X|Y)\/(\d+|X)(G?)CD$/.exec(t) || /^()(\d+|X)(G?)CD$/.exec(t));
  if (!m) return null;
  const n = v => (/^-?\d+$/.test(v) ? +v : "X");          // the chapter's family rows (Y/XCD): X
  return { cap: n(m[2]), start: m[1] === "" ? 0 : n(m[1]), global: !!m[3], y: m[1] === "Y" };
}
/** The ring of a cooldown ({cap, start}: cooldownOf) as {parts: [[paint, SVG path data]] in drawing order in its 22-unit
 *  box (paint body, rim, green, red, hollow, faint, or one (salt): ink), number: [[path, x, y, k]] (Roboto Black outlines,
 *  each at its origin and scale), colour (the number's), ready}; one: the salt drawing, in one colour inside the pill's
 *  outline, no body or rim (build_stoogedings ring_parts, ring_number). The web draws the body and rim as circles. */
export function ringParts({ cap, start, y }, one = false) {
  const full = cap === "X" && start === "X" && !y, unknown = (cap === "X" || start === "X") && !full;   // (X/XCD): fully charged, a green 0
  const debt = unknown || full ? 0 : Math.max(0, -start), have = unknown || full ? 0 : Math.max(0, Math.min(start, cap));
  const wait = unknown ? "X" : full ? 0 : Math.max(0, cap - start), ready = !unknown && wait <= 1, r0 = cap !== "X" && debt > cap ? DEEP_IN : IN, r1 = one ? SALT_OUT : OUT, d = SLOT / 2;
  const ink = p => (one ? "ink" : p), parts = [];
  if (cap === "X") parts.push([ink(full ? "green" : "hollow"), dashCircle(r1 - W / 2, W) + dashCircle(r0 + W / 2, W)]);
  else if (cap <= 8) {
    for (let i = 0; i < cap; i++) {
      const a0 = i * 360 / cap, a1 = (i + 1) * 360 / cap;
      if (start === "X") parts.push([ink("hollow"), dashSeg(r0, r1, a0, a1, d)]);
      else if (i < have) parts.push([ink("green"), seg(r0, r1, a0, a1, d)]);
      else if (debt > cap - 1 - i) {                      // counter-clockwise from the top; salt: a band along the inside
        parts.push(one ? ["ink", seg(r0, r0 + SALT_BAND, a0, a1, d)] : ["red", seg(r0, r1, a0, a1, d)]);
        for (const lap of LAPS.slice(0, Math.floor((debt - cap + i) / cap))) parts.push([ink("red"), seg(...lap, a0, a1, d)]);   // its further rings below zero
      }
      else parts.push([ink("hollow"), hollow(r0, r1, a0, a1, d)]);
    }
  } else {
    const due = 360 - Math.min(debt, cap) / cap * 360;      // below zero from here round to the top; salt: no outer edge over it
    parts.push(one && debt ? ["ink", annulus(r0, r0 + 0.8) + (due > 0 ? seg(r1 - 0.8, r1, 0, due) : "")] : [ink("faint"), annulus(r1 - 0.8, r1) + annulus(r0, r0 + 0.8)]);
    if (have) parts.push([ink("green"), seg(r0, r1, 0, have / cap * 360)]);
    if (debt) parts.push([ink("red"), seg(r0, one ? r0 + SALT_BAND : r1, due, 360)]);
    LAPS.forEach((lap, j) => { if (debt > (j + 1) * cap) parts.push([ink("red"), seg(...lap, 360 - Math.min(debt - (j + 1) * cap, cap) / cap * 360, 360)]); });   // by share
  }
  if (one) parts.push(["ink", poly([[DIV[0], LINE], [DIV[1], LINE], [DIV[1], 22 - LINE], [DIV[0], 22 - LINE]])]);   // salt: a divider after the ring, the outline mirrored
  const t = String(wait), k = (t.length > 1 ? 5.7 : 7.8) / RING_CAP, track = t.length > 1 ? -0.45 : 0, g = [...t].map(c => RING_DIGITS[c]), xs = [];
  let x = 0;
  for (const c of g) { xs.push(x); x += c[0] * k + track; }
  const x0 = xs[0] + g[0][1] * k, x1 = xs[xs.length - 1] + g[g.length - 1][3] * k, y0 = Math.min(...g.map(c => c[2])) * k, y1 = Math.max(...g.map(c => c[4])) * k;
  const dx = 11 - (x0 + x1) / 2 + oneNudge(t, t.length > 1 ? 5.7 : 7.8), base = 11 - (y0 + y1) / 2;      // the ink box centred in the ring
  const number = g.map((c, i) => [c[5], dx + xs[i], base, k]);
  return { parts, number, colour: ready ? RING_NUMBER[0] : start !== "X" && start < 0 ? RING_NUMBER[1] : RING_NUMBER[2], ready };
}
export const RING_PAINT = { body: RING_BODY, green: RING_GREEN, red: RING_RED, hollow: RING_HOLLOW, faint: RING_FAINT, rim: RING_RIM };
/** The ring in words: its tip. The turn its first full charge comes on, as the rulebook counts it ((2CD): its 2nd). */
export function ringWords({ cap, start, global, y }) {
  const unit = global ? "global turn" : "turn", turns = k => `${k} ${unit}${k === 1 ? "" : "s"}`, every = k => (k === 1 ? `every ${unit}` : `every ${turns(k)}`);
  const nth = k => `${k}${k % 100 > 10 && k % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th"} ${unit}`;
  if (cap === "X" && start === "X" && !y) return `Fully charged from the start, then every X ${unit}s: a number the card sets`;
  if (cap === "X") return start === 0 ? `Charge needed: X ${unit}s, a number the card sets` : y ? `Starts with Y of X ${unit}s: numbers the card sets`
    : start < 0 ? `Starts ${-start} below zero, X a number the card sets` : `Starts with ${start} of X ${unit}s, X a number the card sets`;
  if (start === "X") return `Starts with X of ${turns(cap)}: a number the card sets`;
  const wait = Math.max(0, cap - start);
  if (wait === 0) return `Fully charged from the start, then ${every(cap)}`;
  if (wait === 1) return `Fully charged as its first ${unit} begins, then ${every(cap)}`;
  if (start < 0) return `Starts ${-start} below zero: first fully charged on its ${nth(wait)}, then ${every(cap)}`;
  return `First fully charged on its ${nth(wait)}, then ${every(cap)}`;
}
/** A cooldown badge's ring (HTML), or "" for any other tag (tip false: the note is the parent's). */
export function ringHtml(typed, tip = true) {
  const c = cooldownOf(typed);
  if (!c) return "";
  const { parts, number, colour } = ringParts(c);   // the rim: .ring's gradient disc, the pill's edge over its outside
  let body = `<circle cx="11" cy="11" r="9.9" fill="${RING_BODY}"/>`;
  body += parts.map(([p, d]) => `<path d="${d}" fill="${RING_PAINT[p]}"/>`).join("");
  body += `<g fill="${colour}">${number.map(([d, x, y, k]) => `<path transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${k.toFixed(6)})" d="${d}"/>`).join("")}</g>`;
  return `<span class="ring"${tip ? ` data-tip="${esc(ringWords(c))}"` : ""}><svg viewBox="0 0 22 22" aria-hidden="true">${body}</svg></span>`;
}
/** A badge as card text draws it: a cooldown's with its ring as its left end. */
export const tagHtml = (typed, tip = true) => badgeHtml(typed, tip, ringHtml(typed, tip));
// a label's ink centred as the font centres it (_tag_badges, cost_badge's own currency): (its last character's right
// side-bearing - its first's left) / 2, Roboto Black units at 540/1456 of the 950-unit pill (1.45em); style.css .badge
// and .badge.ringed take --ink. LSB, RSB: the characters badge labels start and end with, as badges set them
// (badge_web_font.py prints them).
const LSB = {"0":86,"1":100,"2":60,"3":48,"4":59,"5":81,"6":84,"7":52,"8":85,"9":80,"A":-4,"B":111,"E":111,"F":111,"O":70,"W":22,"X":70,"Y":-4,"\u2212":135};
const RSB = {"D":71,"F":35,"G":94,"S":70,"T":38,"U":109,"l":112,"n":92,"r":21,"s":62};
const INK_EM = 540 / 1456 * 1.45 / 950;
const inkShift = label => `${(((RSB[label.at(-1)] ?? 0) - (LSB[label[0]] ?? 0)) / 2 * INK_EM).toFixed(4)}em`;

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
// an icon's number: its ink centred on the icon as the font centres it (--nx; a 1 optically), on the star a long one shrunk to 0.88 of its
// radius (--k); Roboto Black figures (RING_DIGITS) and point at capitals 440/950 of the pill, 10/950 between them
const NUM_U = 440 / 1456, U_EM = 1.45 / 950, POINT = [620, 117, 0, 489], fig = ch => (ch === "." ? POINT : RING_DIGITS[ch]);
export const costHtml = typed => {
  const c = costInfo(typed);
  if (!c) return esc(`(${typed})`);
  const own = c.kind === "souls" || c.kind === "counters";
  const tip = ` data-tip="${esc(`${c.n} ${c.kind === "sp" ? "SP" : c.word.toLowerCase()}: ${COST_TIP[c.kind]}`)}"`;
  if (own) return `<span class="badge cost own" style="--ink:${inkShift(`${c.n} ${c.word}`)}"${tip}><span class="bl"><span class="cost-n">${esc(c.n)}</span><span class="cost-u"> ${esc(c.word)}</span></span></span>`;
  const f = [...c.n].map(fig), nw = f.reduce((w, g) => w + g[0], 0) * NUM_U + 10 * (f.length - 1);
  const k = c.kind === "sp" ? Math.min(1, 528 / nw) : 1, nx = ((f.at(-1)[0] - f.at(-1)[3] - f[0][1]) / 2 * NUM_U + oneNudge(c.n, 440)) * k * U_EM;
  const look = `--nx:${nx.toFixed(4)}em${k < 1 ? `;--k:${k.toFixed(4)}` : ""}`;
  return `<span class="badge cost ${c.kind}"${tip}><span class="cost-n"><i style="${look}">${esc(c.n)}</i></span><span class="cost-u">${esc(c.word)}</span></span>`;
};

// badge colour legend, one line per colour: the text of rulebook page 02 Abbreviations; colours come from tagInfo's groups
const COLOUR = { turn: "Blue", any: "Purple", forced: "Red", trigger: "Orange", neutral: "Grey" };
export const LEGEND = [
  ["on your turn", ["1CD", "1/2CD", "OYT"]], ["at any time", ["1GCD", "AAT"]], ["forced", ["BOT", "ENDT", "BOGT", "ENDGT"]],
  ["per game, uses and triggers", ["1PG", "2U", "OFS", "OS", "OD", "WOF"]], ["costs the creature's action", ["Action"]],
].map(([what, tags]) => ({ group: tagInfo(tags[0]).group, colour: COLOUR[tagInfo(tags[0]).group], what, tags }));
const COSTS = [["Green", "points", "2 points", "#00ffae"], ["Brown", "BRICKS", "2 bricks", "#a0522d"], ["Yellow", "SP (star points)", "2 SP", "#ffff00"],
  ["Teal", "a card's own currency", "4 souls", "#0f766e"]];   // style.css colours: the TTS table's counters (build_site COUNTER_COLORS)
/** costs: the cost lines too */
export const legendHtml = (costs = false) => `<ul class="badge-legend">${LEGEND.map(l => `<li><span class="badge ${l.group} swatch" aria-hidden="true"></span><b>${l.colour}:</b> ${esc(l.what)} ${l.tags.map((t, i) => `<span class="nw">${i ? "" : "("}${tagHtml(t)}${i < l.tags.length - 1 ? "," : ")."}</span>`).join(" ")}</li>`).join("")}${costs
  ? `${COSTS.map(([colour, what, eg, bg]) => `<li><span class="badge swatch" style="background:${bg}" aria-hidden="true"></span><b>${colour}:</b> ${esc(what)} <span class="nw">(${costHtml(eg)}).</span></li>`).join("")}` : ""}${RING_LINE}</ul>`;
const RING_LINE = `<li><b>Cooldowns:</b> the ring counts the charge (<a href="#/rules/timing-tags/reading-the-ring">Reading the ring</a>).</li>`;
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
    const lo = /^[dl]{1,2}$/.test(ic.lo || "") ? [...ic.lo].map(k => ` lo-${k}`).join("") : "";   // build_site icon_low
    const img = `<img class="tok${lo}" src="${esc(ic.file)}" alt="${esc(drawn ? label : base)}"${t}>`;
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

  /** HTML for ability text; links: false leaves card names as text (the rulebook links its own); colors: its colour
   *  runs (textcolor.js wordColors: the site's palette), on the letters only (icons and badges keep their look) */
  function render(text, { links: linked = true, colors = null } = {}) {
    if (!text) return "";
    const { pieces, links: found } = parse(text), links = linked ? found : [];
    const out = [], seg = (a, b) => (colors?.length ? paintHtml(text, colors, a, b) : esc(text.slice(a, b)));
    let last = 0;
    for (const [i, n, x] of [...pieces, ...links].sort((a, b) => a[0] - b[0])) {
      out.push(seg(last, i), typeof x === "string" ? x : `<a class="card-ref" href="c/${encodeURIComponent(x.id)}/" data-card="${x.id}">${seg(i, i + n)}</a>`);
      last = i + n;
    }
    out.push(seg(last, text.length));
    return out.join("").replace(/\n/g, "<br>");
  }

  /** Cards whose names appear in a text (for "mentions" / "mentioned by"). */
  function mentions(text) {
    return new Set(text ? parse(text, false).links.map(l => l[2].id) : []);
  }
  iconOf = icon; DIFFS.clear();                      // diffs drawn with the old icons
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

const DIFFS = new Map();                             // diffWords' HTML by before + "\0" + after (the oldest goes past 2000)
/** Word-level diff (LCS) as HTML with <ins>/<del>, badges and icons drawn (inlineHtml); remembered between redraws. */
export function diffWords(before, after) {
  const k = String(before || "") + "\u0000" + String(after || "");
  let v = DIFFS.get(k);
  if (v === undefined) { v = diffOnce(before, after); DIFFS.set(k, v); if (DIFFS.size > 2000) DIFFS.delete(DIFFS.keys().next().value); }
  return v;
}
function diffOnce(before, after) {
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
