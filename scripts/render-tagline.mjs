#!/usr/bin/env node
// Renders assets/tagline-dark.svg and assets/tagline-light.svg: the one-line
// tagline under the banner as letter-spaced mono words with hairline
// separators, each word fading in once when the page loads.
//
//   node scripts/render-tagline.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORDS = ["Software Engineer", "AI", "Systems", "Full Stack", "Amsterdam"];

const W = 830, H = 36, FS = 12, LS = 3, ADV = FS * 0.6 + LS, SEP = 34;
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const widths = WORDS.map((w) => w.length * ADV - LS);
const total = widths.reduce((a, b) => a + b, 0) + SEP * (WORDS.length - 1);

function svg({ fg, line }) {
  let x = (W - total) / 2, s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${WORDS.join(", ")}">\n`;
  s += `<style>.w{opacity:0;animation:in .6s ease-out forwards}@keyframes in{to{opacity:1}}@media(prefers-reduced-motion:reduce){.w{animation:none;opacity:1}}</style>\n`;
  WORDS.forEach((w, i) => {
    s += `<text class="w" style="animation-delay:${(i * 0.18).toFixed(2)}s" x="${x.toFixed(1)}" y="23" font-family="${MONO}" font-size="${FS}" letter-spacing="${LS}" fill="${fg}">${w.toUpperCase()}</text>\n`;
    x += widths[i];
    if (i < WORDS.length - 1) { s += `<line x1="${(x + SEP / 2).toFixed(1)}" y1="11" x2="${(x + SEP / 2).toFixed(1)}" y2="25" stroke="${line}"/>\n`; x += SEP; }
  });
  return s + `</svg>\n`;
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "tagline-dark.svg"), svg({ fg: "#e6edf3", line: "#30363d" }));
writeFileSync(resolve(dir, "tagline-light.svg"), svg({ fg: "#0b0b0b", line: "#dcdcdc" }));
console.log(WORDS.join(" · "));
