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

function svg(sprite, t) {
  const rows = sprite.rows, w = rows[0].length * CH, h = rows.length * CH;
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
