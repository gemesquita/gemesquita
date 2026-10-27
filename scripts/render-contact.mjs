#!/usr/bin/env node
// Renders assets/contact-<name>-dark.svg and -light.svg: large outlined tiles
// for the contact links at the bottom of the README, each with a glyph and a
// small label. The README wraps each one in a link.
//
//   node scripts/render-contact.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LINKS = [
  { name: "linkedin", label: "LinkedIn", slug: null },      // LinkedIn's mark is not in the icon set, so it gets an original "in" lettermark
  { name: "email", label: "Email", slug: "gmail" },
  { name: "instagram", label: "Instagram", slug: "instagram" },
];

async function icon(slug) {
  for (const v of ["latest", "16", "15"]) {
    const r = await fetch(`https://cdn.jsdelivr.net/npm/simple-icons@${v}/icons/${slug}.svg`);
    if (!r.ok) continue;
    const m = (await r.text()).match(/<path d="([^"]+)"/);
    if (m) return m[1];
  }
  throw new Error(`no icon for ${slug}`);
}

const W = 96, H = 110, TILE = 64, X = (W - TILE) / 2;
const SANS = "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
function svg(link, path, { fg, mute, line }) {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${link.label}">\n`;
  if (path) s += `<path transform="translate(${X + 14} 14) scale(${(36 / 24).toFixed(3)})" d="${path}" fill="${fg}"/>\n`;
  else s += `<text x="${W / 2}" y="46" text-anchor="middle" font-family="${SANS}" font-size="38" font-weight="800" letter-spacing="-2" fill="${fg}">in</text>\n`;
  s += `<text x="${W / 2}" y="92" text-anchor="middle" font-family="${MONO}" font-size="9.5" letter-spacing="2" fill="${mute}">${link.label.toUpperCase()}</text>\n`;
  return s + `</svg>\n`;
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });
for (const link of LINKS) {
  const path = link.slug ? await icon(link.slug) : null;
  writeFileSync(resolve(dir, `contact-${link.name}-dark.svg`), svg(link, path, { fg: "#e6edf3", mute: "#8b949e", line: "#30363d" }));
  writeFileSync(resolve(dir, `contact-${link.name}-light.svg`), svg(link, path, { fg: "#0b0b0b", mute: "#6f6f6c", line: "#dcdcdc" }));
}
console.log(LINKS.map((l) => l.name).join(", "));
