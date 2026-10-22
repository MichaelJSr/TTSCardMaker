// A card picker panel, mounted inside a page: a search box (search.js syntax), kind and stars chips and small tiles;
// a click or Enter on a tile chooses it. The tiles carry data-choose, never data-open or data-pick, so the document's
// click listener (app.js) leaves them alone. Used by the profile editor (edit.js) and the deck builder's dialog (app.js).
import { esc } from "./text.js";
import { compile } from "./search.js";

export const CAP = 240;                                                   // tiles shown at most: narrow the search for the rest
const byName = (a, b) => { const x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name); };   // as app.js sortCards

/** The cards to show: those passing `filter` and the query, on the chosen kinds and stars, by name, capped.
 *  -> {list, total}; kindOf(card) groups status effects (app.js kindOf). */
export function pickList(cards, { query = "", kinds = [], stars = [], filter = null, kindOf = c => c.type, cap = CAP } = {}) {
  const pred = compile(query);
  const list = cards.filter(c => (!filter || filter(c)) && (!pred || pred(c)) && (!kinds.length || kinds.includes(kindOf(c)))
    && (!stars.length || stars.includes(c.stars))).sort(byName);
  return { list: list.slice(0, cap), total: list.length };
}

/** The chips: kinds (in `kinds` order, with counts) and stars (ascending) of the cards passing `filter`. */
export function facets(cards, { filter = null, kinds = [], kindOf = c => c.type } = {}) {
  const pool = filter ? cards.filter(filter) : cards, counts = new Map();
  for (const c of pool) counts.set(kindOf(c), (counts.get(kindOf(c)) || 0) + 1);
  return { kinds: kinds.filter(([k]) => counts.get(k)).map(([k, label]) => [k, label, counts.get(k)]),
    stars: [...new Set(pool.map(c => c.stars).filter(Boolean))].sort((a, b) => a - b) };
}

/** The picker's search and chips as shown in `container` (the typed text even before the debounce), or null: mount's `initial`. */
export function read(container) {
  const root = container?.querySelector(".pick");
  if (!root) return null;
  const on = a => [...root.querySelectorAll(`.chip.on[data-${a}]`)].map(b => b.dataset[a]);
  return { query: root.querySelector(".pick-q").value, kinds: on("kind"), stars: on("star").map(Number) };
}

/** Render the picker into `container` (replacing its contents) and focus the search box (unless `focus` is false).
 *  {cards (or a function returning them: read on each search), filter(card), onChoose(id), placeholder, tile(card) -> tile HTML (app.js tileHtml), kinds ([[kind, label]]), kindOf,
 *  initial: {query, kinds, stars} (read() of an earlier panel)} */
export function mount(container, { cards, filter = null, onChoose, placeholder = "Search… (the search box's syntax)", tile, kinds = [], kindOf = c => c.type, initial = null, focus = true }) {
  const all = typeof cards === "function" ? cards : () => cards;
  const f = facets(all(), { filter, kinds, kindOf });
  const state = { query: initial?.query || "", kinds: new Set((initial?.kinds || []).filter(k => f.kinds.some(([x]) => x === k))),   // only chips shown
    stars: new Set((initial?.stars || []).filter(s => f.stars.includes(s))) };
  const chip = (attr, v, set, label) => `<button type="button" class="chip${set.has(v) ? " on" : ""}" data-${attr}="${esc(v)}" aria-pressed="${set.has(v)}">${label}</button>`;
  container.innerHTML = `<div class="pick">
    <input type="search" class="pick-q" placeholder="${esc(placeholder)}" value="${esc(state.query)}" aria-label="Search cards" autocomplete="off">
    ${f.kinds.length > 1 ? `<div class="chips">${f.kinds.map(([k, label, n]) => chip("kind", k, state.kinds, `${esc(label)}<span class="n">${n}</span>`)).join("")}</div>` : ""}
    ${f.stars.length > 1 ? `<div class="chips">${f.stars.map(s => chip("star", s, state.stars, `${s}★`)).join("")}</div>` : ""}
    <p class="muted pick-note" aria-live="polite"></p>
    <div class="grid picker" style="--tile:120px"></div></div>`;
  const root = container.firstElementChild, input = root.querySelector(".pick-q"), note = root.querySelector(".pick-note"), grid = root.querySelector(".grid");
  const render = () => {
    const { list, total } = pickList(all(), { query: state.query, kinds: [...state.kinds], stars: [...state.stars], filter, kindOf });
    note.textContent = !total ? "Nothing matches." : total > list.length ? `Showing ${list.length} of ${total}: narrow the search.` : `${total} card${total === 1 ? "" : "s"}`;
    grid.innerHTML = list.map(c => tile(c).replace('data-open="', 'data-choose="')).join("");
  };
  let t = null;
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.query = input.value; render(); }, 120); });
  root.addEventListener("click", e => {
    const chosen = e.target.closest("[data-choose]");
    if (chosen) { onChoose(chosen.dataset.choose); return; }
    const chip = e.target.closest("[data-kind], [data-star]");
    if (!chip) return;
    const set = chip.dataset.kind !== undefined ? state.kinds : state.stars, v = chip.dataset.kind ?? Number(chip.dataset.star);
    set.has(v) ? set.delete(v) : set.add(v);
    chip.classList.toggle("on", set.has(v)); chip.setAttribute("aria-pressed", String(set.has(v)));
    render();
  });
  root.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const chosen = e.target.closest("[data-choose]");
    if (chosen) { e.preventDefault(); onChoose(chosen.dataset.choose); } else if (e.target === input) e.preventDefault();   // not the form's submit
  });
  render();
  if (focus) input.focus();
}
