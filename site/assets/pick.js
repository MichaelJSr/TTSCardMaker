// A card picker panel, mounted inside a page: a search box (search.js syntax), kind and stars chips and small tiles;
// a click or Enter on a tile chooses it. The tiles carry data-choose, never data-open or data-pick, so the document's
// click listener (app.js) leaves them alone. Used by the profile editor (edit.js); the deck builder has its own dialog.
import { esc } from "./text.js";
import { compile } from "./search.js";

export const CAP = 240;                                                   // tiles shown at most: narrow the search for the rest

/** The cards to show: those passing `filter` and the query, on the chosen kinds and stars, by name, capped.
 *  -> {list, total}; kindOf(card) groups status effects (app.js kindOf). */
export function pickList(cards, { query = "", kinds = [], stars = [], filter = null, kindOf = c => c.type, cap = CAP } = {}) {
  const pred = compile(query);
  const list = cards.filter(c => (!filter || filter(c)) && (!pred || pred(c)) && (!kinds.length || kinds.includes(kindOf(c)))
    && (!stars.length || stars.includes(c.stars))).sort((a, b) => a.name.localeCompare(b.name));
  return { list: list.slice(0, cap), total: list.length };
}

/** The chips: kinds (in `kinds` order, with counts) and stars (ascending) of the cards passing `filter`. */
export function facets(cards, { filter = null, kinds = [], kindOf = c => c.type } = {}) {
  const pool = filter ? cards.filter(filter) : cards, counts = new Map();
  for (const c of pool) counts.set(kindOf(c), (counts.get(kindOf(c)) || 0) + 1);
  return { kinds: kinds.filter(([k]) => counts.get(k)).map(([k, label]) => [k, label, counts.get(k)]),
    stars: [...new Set(pool.map(c => c.stars).filter(Boolean))].sort((a, b) => a - b) };
}

/** Render the picker into `container` (replacing its contents) and focus the search box.
 *  {cards, filter(card), onChoose(id), placeholder, tile(card) -> tile HTML (app.js tileHtml), kinds ([[kind, label]]), kindOf} */
export function mount(container, { cards, filter = null, onChoose, placeholder = "Search cards…", tile, kinds = [], kindOf = c => c.type }) {
  const state = { query: "", kinds: new Set(), stars: new Set() };
  const f = facets(cards, { filter, kinds, kindOf });
  container.innerHTML = `<div class="pick">
    <input type="search" class="pick-q" placeholder="${esc(placeholder)}" aria-label="Search cards" autocomplete="off">
    ${f.kinds.length > 1 ? `<div class="chips">${f.kinds.map(([k, label, n]) => `<button type="button" class="chip" data-kind="${esc(k)}" aria-pressed="false">${esc(label)}<span class="n">${n}</span></button>`).join("")}</div>` : ""}
    ${f.stars.length > 1 ? `<div class="chips">${f.stars.map(s => `<button type="button" class="chip" data-star="${s}" aria-pressed="false">${s}★</button>`).join("")}</div>` : ""}
    <p class="muted pick-note" aria-live="polite"></p>
    <div class="grid picker" style="--tile:120px"></div></div>`;
  const root = container.firstElementChild, input = root.querySelector(".pick-q"), note = root.querySelector(".pick-note"), grid = root.querySelector(".grid");
  const render = () => {
    const { list, total } = pickList(cards, { query: state.query, kinds: [...state.kinds], stars: [...state.stars], filter, kindOf });
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
  input.focus();
}
