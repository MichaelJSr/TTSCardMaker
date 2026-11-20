// cards.json's mentions (build_site.py mention_lists), as app.js derive() finds them: text.js over the cards not hidden.
// node mentions.mjs <assets dir>, stdin {cards, icons, iconVariants}; prints per card [index of a card it names, ...] or 0.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { makeRenderer } = await import(pathToFileURL(join(process.argv[2], "text.js")).href);
const { cards, icons, iconVariants } = JSON.parse(readFileSync(0, "utf8"));
const at = new Map(cards.map((c, i) => [c.id, i]));
const r = makeRenderer({ cards: cards.filter(c => !c.hidden), icons, variants: iconVariants });
const named = c => (c.hidden ? [] : [...r.mentions(c.ability)].map(id => at.get(id)));
console.log(JSON.stringify(cards.map(c => { const m = named(c); return m.length ? m : 0; })));
