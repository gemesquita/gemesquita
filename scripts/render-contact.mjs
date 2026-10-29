#!/usr/bin/env node
// Renders assets/contact-<name>-dark.svg and -light.svg: the contact links as
// hand-drawn pixel sprites in the dragon's language (dark outline, fill,
// top-left highlight, bottom-right shadow), with a small label under each.
// The README wraps each one in a link.
//
//   node scripts/render-contact.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O outline, # fill, * highlight, = shadow, . empty
const SPRITES = {
  linkedin: {
    label: "LinkedIn",
    rows: [
      ".OOOO..........",
      ".O*#O..........",
      ".O*#O..........",
      ".OOOO..........",
      "...............",
      ".OOOO.OOOOOOOOO",
      ".O*#O.O*######O",
      ".O*#O.O*#O.O#=O",
      ".O*#O.O*#O.O#=O",
      ".O*#O.O*#O.O#=O",
      ".O*#O.O*#O.O#=O",
      ".O*#O.O*#O.O#=O",
      ".OOOO.OOOO.OOOO",
    ],
  },
  email: {
    label: "Email",
    rows: [
      "OOOOOOOOOOOOOOO",
      "O*############O",
      "O*O#########O#O",
      "O*#O#######O##O",
      "O*##O#####O###O",
      "O*###O###O####O",
      "O*####O#O#####O",
      "O*#####O######O",
      "O*############O",
      "O=############O",
      "O=============O",
      "OOOOOOOOOOOOOOO",
    ],
  },
  instagram: {
    label: "Instagram",
    rows: [
      "..OOOOOOOOOOO..",
      ".O*#########=O.",
      "O*##########O=O",
      "O*####OOO####=O",
      "O*###O###O###=O",
      "O*##O##*##O##=O",
      "O*##O#*###O##=O",
      "O*##O#####O##=O",
      "O*###O###O###=O",
      "O*####OOO####=O",
      "O*###########=O",
      "O*###########=O",
      "O=###########=O",
      ".O===========O.",
      "..OOOOOOOOOOO..",
    ],
  },
};

const THEMES = {
  dark: { out: "#3e4652", fill: "#dee4eb", hi: "#ffffff", sh: "#969ea8", mute: "#8b949e" },
  light: { out: "#161616", fill: "#767676", hi: "#a0a0a0", sh: "#484848", mute: "#6f6f6c" },
};
const CH = 3, W = 96, ART = 48, H = 72;   // 3px chunks; sprites sit in a 48px box, label below
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Lighting is computed from the silhouette rather than placed by hand: fill chunks on the outer top or left
// edge are lit, fill chunks on the outer bottom or right edge are shaded (bottom/right wins at a corner).
function shade(rows) {
  const Hh = rows.length, Ww = rows[0].length;
  const at = (c, r) => (c < 0 || r < 0 || c >= Ww || r >= Hh ? "." : rows[r][c] === "*" || rows[r][c] === "=" ? "#" : rows[r][c]);
  // flood the outside from the border through empty cells
  const outside = new Set(); const stack = [];
  for (let r = -1; r <= Hh; r++) for (let c = -1; c <= Ww; c++) if ((r < 0 || r >= Hh || c < 0 || c >= Ww)) stack.push([c, r]);
  while (stack.length) { const [c, r] = stack.pop(); const k = `${c},${r}`; if (outside.has(k) || c < -1 || r < -1 || c > Ww || r > Hh || at(c, r) !== ".") continue; outside.add(k); stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]); }
  const outer = (c, r) => outside.has(`${c},${r}`) || (at(c, r) === "O" && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => outside.has(`${c + dx},${r + dy}`)));
  return rows.map((row, r) => [...row].map((ch, c) => {
    if (at(c, r) !== "#") return at(c, r);
    if (outer(c, r + 1) || outer(c + 1, r)) return "=";
    if (outer(c, r - 1) || outer(c - 1, r)) return "*";
    return "#";
  }).join(""));
}
function svg(sprite, t) {
  const rows = shade(sprite.rows), w = rows[0].length * CH, h = rows.length * CH;
  const x0 = Math.round((W - w) / 2), y0 = Math.round((ART - h) / 2);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${sprite.label}" shape-rendering="crispEdges">\n`;
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const fill = ch === "O" ? t.out : ch === "#" ? t.fill : ch === "*" ? t.hi : ch === "=" ? t.sh : null;
    if (fill) s += `<rect x="${x0 + c * CH}" y="${y0 + r * CH}" width="${CH}" height="${CH}" fill="${fill}"/>\n`;
  }));
  s += `<text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-family="${MONO}" font-size="9.5" letter-spacing="2" fill="${t.mute}">${sprite.label.toUpperCase()}</text>\n`;
  return s + `</svg>\n`;
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });
for (const [name, sprite] of Object.entries(SPRITES)) {
  const widths = new Set(sprite.rows.map((r) => r.length));
  if (widths.size !== 1) throw new Error(`${name}: rows differ in width`);
  for (const [theme, t] of Object.entries(THEMES)) writeFileSync(resolve(dir, `contact-${name}-${theme}.svg`), svg(sprite, t));
}
console.log(Object.keys(SPRITES).join(", "));
