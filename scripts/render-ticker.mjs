#!/usr/bin/env node
// Renders assets/ticker-dark.svg and assets/ticker-light.svg: the tech stack as
// monochrome brand logos sliding in an endless loop. The SVG animates with its
// own CSS, which GitHub plays when the file is embedded as an image.
//
//   node scripts/render-ticker.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// [label, simple-icons slug or null for a text-only tile]
const STACK = [
  ["TypeScript", "typescript"], ["JavaScript", "javascript"], ["Kotlin", "kotlin"], ["Scala", "scala"],
  ["Python", "python"], ["C", "c"], ["Dart", "dart"], ["SQL", "postgresql"], ["Bash", "gnubash"],
  ["React", "react"], ["Next.js", "nextdotjs"], ["Tailwind", "tailwindcss"], ["Vite", "vite"], ["TanStack", "tanstack"],
  ["Node.js", "nodedotjs"], ["Express", "express"], ["Spring Boot", "springboot"], ["Prisma", "prisma"],
  ["PostgreSQL", "postgresql"], ["MongoDB", "mongodb"], ["Convex", "convex"], ["Firebase", "firebase"], ["Trigger.dev", null],
  ["Google Cloud", "googlecloud"], ["Docker", "docker"], ["Linux", "linux"], ["Vercel", "vercel"], ["Amazon SES", null],
  ["Stripe", "stripe"], ["Clerk", "clerk"], ["n8n", "n8n"], ["Notion API", "notion"], ["Git", "git"],
  ["GitHub Actions", "githubactions"], ["Postman", "postman"], ["Playwright", null], ["OpenAI", null], ["Claude", "claude"],
];

const VERSIONS = ["latest", "16", "15", "14"];
async function icon(slug) {
  for (const v of VERSIONS) {
    const r = await fetch(`https://cdn.jsdelivr.net/npm/simple-icons@${v}/icons/${slug}.svg`);
    if (!r.ok) continue;
    const m = (await r.text()).match(/<path d="([^"]+)"/);
    if (m) return m[1];
  }
  console.warn(`no icon for ${slug}, using text`);
  return null;
}

const items = [];
for (const [label, slug] of STACK) items.push({ label, path: slug ? await icon(slug) : null });

const W = 880, H = 76, STEP = 96, ICON = 26;
const span = items.length * STEP;                 // width of one full set
const SECONDS = Math.round(items.length * 1.6);   // ~1.6 s per tile

function tile(it, i, ink) {
  const x = i * STEP + STEP / 2;
  const sans = "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif";
  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  let s = "";
  if (it.path) {
    const k = ICON / 24;
    s += `<path transform="translate(${(x - ICON / 2).toFixed(1)} 14) scale(${k.toFixed(3)})" d="${it.path}" fill="${ink}"/>`;
  } else {
    s += `<text x="${x}" y="31" text-anchor="middle" font-family="${sans}" font-size="15" font-weight="800" letter-spacing="-0.5" fill="${ink}">${it.label}</text>`;
  }
  s += `<text x="${x}" y="60" text-anchor="middle" font-family="${mono}" font-size="9.5" letter-spacing="1" fill="${ink}" opacity="0.6">${it.label.toUpperCase()}</text>`;
  return s;
}

function svg(ink) {
  const set = items.map((it, i) => tile(it, i, ink)).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tech stack: ${items.map((i) => i.label).join(", ")}">
<style>
  .rail { animation: slide ${SECONDS}s linear infinite; }
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(-${span}px); } }
  @media (prefers-reduced-motion: reduce) { .rail { animation: none; } }
</style>
<defs>
  <linearGradient id="fade" x1="0" x2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.08" stop-color="#fff" stop-opacity="1"/>
    <stop offset="0.92" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <mask id="edge"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
</defs>
<g mask="url(#edge)">
  <g class="rail">
${set}
<g transform="translate(${span} 0)">
${set}
</g>
  </g>
</g>
</svg>
`;
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "ticker-dark.svg"), svg("#e6edf3"));
writeFileSync(resolve(dir, "ticker-light.svg"), svg("#0b0b0b"));
console.log(`${items.length} tiles, ${items.filter((i) => i.path).length} with logos, ${SECONDS}s loop`);
