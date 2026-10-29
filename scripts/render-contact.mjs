#!/usr/bin/env node
// Renders assets/contact-<name>-dark.svg and -light.svg: the contact links as
// pixel sprites in the dragon's language. Each icon is a hand-drawn stroke
// mask; the script wraps every stroke in a dark outline and lights it from
// the top-left, so the result reads like the dragon's own pixel work.
// The README wraps each one in a link.
//
//   node scripts/render-contact.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// # stroke, . empty. Outline and lighting are added by the script.
const SPRITES = {
  linkedin: {
    label: "LinkedIn",
    mask: [
      "##...........",
      "##...........",
      ".............",
      "##...########",
      "##...########",
      "##...##....##",
      "##...##....##",
      "##...##....##",
      "##...##....##",
      "##...##....##",
    ],
  },
  email: {
    label: "Email",
    mask: [
      "###############",
      "#.............#",
      "##...........##",
      "#.#.........#.#",
      "#..#.......#..#",
      "#...#.....#...#",
      "#....#...#....#",
      "#.....#.#.....#",
      "#......#......#",
      "#.............#",
      "###############",
    ],
  },
  instagram: {
    label: "Instagram",
    mask: [
      "..###########..",
      ".#...........#.",
      "#..........#..#",
      "#.............#",
      "#.....###.....#",
      "#....#...#....#",
      "#...#.....#...#",
      "#...#.....#...#",
      "#...#.....#...#",
      "#....#...#....#",
      "#.....###.....#",
      "#.............#",
      "#.............#",
      ".#...........#.",
      "..###########..",
    ],
  },
};

const THEMES = {
  dark: { out: "#3e4652", fill: "#dee4eb", hi: "#ffffff", sh: "#969ea8", mute: "#8b949e" },
  light: { out: "#161616", fill: "#767676", hi: "#9a9a9a", sh: "#484848", mute: "#6f6f6c" },
};
const CH = 4, W = 96, ART = 76, H = 100;   // 4px chunks; sprites sit in a 76px box, label below
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// stroke chunks: lit when their top or left neighbour is empty, shaded when their bottom or right is, plain inside;
// empty chunks touching a stroke (8 neighbours) become the dark outline
function cells(mask) {
  const Hh = mask.length, Ww = mask[0].length;
  const on = (c, r) => c >= 0 && r >= 0 && c < Ww && r < Hh && mask[r][c] === "#";
  const out = [];
  for (let r = -1; r <= Hh; r++) for (let c = -1; c <= Ww; c++) {
    let kind = null;
    if (on(c, r)) kind = !on(c - 1, r) || !on(c, r - 1) ? "hi" : !on(c + 1, r) || !on(c, r + 1) ? "sh" : "fill";
    else if ([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].some(([dx, dy]) => on(c + dx, r + dy))) kind = "out";
    if (kind) out.push([c + 1, r + 1, kind]);
  }
  return { cells: out, w: Ww + 2, h: Hh + 2 };
}

function svg(sprite, t) {
  const { cells: cs, w, h } = cells(sprite.mask);
  const x0 = Math.round((W - w * CH) / 2), y0 = Math.round((ART - h * CH) / 2);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${sprite.label}" shape-rendering="crispEdges">\n`;
  for (const [c, r, kind] of cs) s += `<rect x="${x0 + c * CH}" y="${y0 + r * CH}" width="${CH}" height="${CH}" fill="${t[kind]}"/>\n`;
  s += `<text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-family="${MONO}" font-size="9.5" letter-spacing="2" fill="${t.mute}">${sprite.label.toUpperCase()}</text>\n`;
  return s + `</svg>\n`;
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });
for (const [name, sprite] of Object.entries(SPRITES)) {
  if (new Set(sprite.mask.map((r) => r.length)).size !== 1) throw new Error(`${name}: rows differ in width`);
  for (const [theme, t] of Object.entries(THEMES)) writeFileSync(resolve(dir, `contact-${name}-${theme}.svg`), svg(sprite, t));
}
console.log(Object.keys(SPRITES).join(", "));
