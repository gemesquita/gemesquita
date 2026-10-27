#!/usr/bin/env node
// Renders assets/dragon-dark.gif and assets/dragon-light.gif: a pixel-art
// Chinese dragon chasing a pearl through your contribution calendar, eating
// the cells as it goes. Zero dependencies; only changed pixels are written per
// frame so the file stays small.
//
//   GH_PAT=... node scripts/render-dragon.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.GITHUB_USER || "gemesquita";
const TOKEN = process.env.GH_PAT || process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error("Set GH_PAT (or GITHUB_TOKEN)."); process.exit(1); }

// ---------- calendar ----------
const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "render-dragon" },
  body: JSON.stringify({ query: `query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar { weeks { contributionDays { weekday contributionCount } } } } } }`, variables: { login: USER } }),
});
const json = await res.json();
if (!json.data) { console.error(JSON.stringify(json, null, 2)); process.exit(1); }
const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
const COLS = weeks.length, ROWS = 7;
const counts = weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)).filter((n) => n > 0).sort((a, b) => a - b);
const q = (p) => counts[Math.min(counts.length - 1, Math.floor(counts.length * p))] ?? 1;
const level = (n) => (n === 0 ? 0 : n <= q(0.25) ? 1 : n <= q(0.5) ? 2 : n <= q(0.75) ? 3 : 4);
const base = new Uint8Array(COLS * ROWS);
weeks.forEach((w, c) => w.contributionDays.forEach((d) => { base[c + d.weekday * COLS] = level(d.contributionCount); }));

// ---------- path: chase the nearest pearl, then leave to the right ----------
const LEN = 16;
const path = [], targets = [];
let head = [-3, 3];
const eaten = new Uint8Array(COLS * ROWS);
const nearest = () => { let best = null, bd = 1e9; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const i = c + r * COLS; if (base[i] && !eaten[i]) { const d = Math.abs(c - head[0]) + Math.abs(r - head[1]) * 1.4; if (d < bd) { bd = d; best = [c, r]; } } } return best; };
let target = nearest();
while (target) {
  const dx = target[0] - head[0], dy = target[1] - head[1];
  head = Math.abs(dx) >= Math.abs(dy) && dx !== 0 ? [head[0] + Math.sign(dx), head[1]] : [head[0], head[1] + Math.sign(dy)];
  path.push(head); targets.push(target);
  if (head[0] === target[0] && head[1] === target[1]) { eaten[head[0] + head[1] * COLS] = 1; target = nearest(); }
}
for (let i = 0; i < LEN + 3; i++) { head = [head[0] + 1, head[1]]; path.push(head); targets.push(null); }
const FRAMES = path.length;

// ---------- pixels ----------
const CELL = 18, GAP = 4, BLOCK = CELL - GAP, PAD = 16;
const W = COLS * CELL + PAD * 2, H = ROWS * CELL + PAD * 2;
const themes = {
  dark: { bg: [13, 17, 23], dots: [[28, 33, 40], [59, 64, 72], [110, 118, 129], [163, 170, 179], [230, 237, 243]], body: [230, 237, 243], accent: [139, 148, 158] },
  light: { bg: [255, 255, 255], dots: [[235, 237, 240], [201, 201, 201], [143, 143, 143], [87, 87, 87], [31, 31, 31]], body: [96, 96, 96], accent: [170, 170, 170] },
};
// palette: 0 bg, 1..5 dot levels 0..4, 6 body, 7 accent
const BODY = 6, ACC = 7;
const px = new Uint8Array(W * H), prev = new Uint8Array(W * H);
const put = (x, y, i) => { if (x >= 0 && y >= 0 && x < W && y < H) px[x + y * W] = i; };
const rect = (x0, y0, w, h, i) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, i); };
const disc = (cx, cy, r, i) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) put(cx + x, cy + y, i); };
const center = ([c, r]) => [PAD + c * CELL + BLOCK / 2, PAD + r * CELL + BLOCK / 2];

// Head, facing right, in 2x2 chunks. # body, + accent (whiskers, beard), o eye, . empty
const HEAD = [
  "....#.......#.........",
  "....##......##........",
  "....###....###........",
  ".....###..###.........",
  "......########........",
  "....############......",
  "...##############.....",
  "..####oo###########...",
  "..####oo############..",
  ".####################+",
  ".###################.+",
  "..#################...",
  "...#####..#########+..",
  "...####....########...",
  "....##......######+...",
  ".....+........###.....",
];
const ANCHOR = [7, 8];   // chunk that sits on the head cell's centre (the eye), so the open jaws reach the pearl ahead
function drawHead(cell, dir) {
  const [cx, cy] = center(cell);
  const [fx, fy] = dir;
  for (let r = 0; r < HEAD.length; r++) for (let c = 0; c < HEAD[r].length; c++) {
    const ch = HEAD[r][c]; if (ch === ".") continue;
    const idx = ch === "#" ? BODY : ch === "+" ? ACC : 0;
    const u = c - ANCHOR[0], v = r - ANCHOR[1];
    // facing right: as drawn; left: mirrored; up/down: rotated, horns staying on the outside of the turn
    const [uu, vv] = fx === -1 ? [-u, v] : [u * fx - v * fy, u * fy + v * fx];
    rect(cx + uu * 2 - 1, cy + vv * 2 - 1, 2, 2, idx);
  }
}
// a rectangle placed along the perpendicular axis p, `dist` px out from a segment centre, `thick` along p and `width` across it
function prect(cx, cy, p, s, dist, thick, width, idx) {
  if (p[0]) rect(Math.round(cx + p[0] * s * dist - (s * p[0] > 0 ? 0 : thick)), Math.round(cy - width / 2), thick, width, idx);
  else rect(Math.round(cx - width / 2), Math.round(cy + p[1] * s * dist - (s * p[1] > 0 ? 0 : thick)), width, thick, idx);
}
function drawBody(f) {
  for (let k = LEN - 1; k >= 1; k--) {
    const i = f - k; if (i < 0) continue;
    const [cx, cy] = center(path[i]);
    const prevP = path[i - 1] || [path[i][0] - 1, path[i][1]];
    const d = [path[i][0] - prevP[0], path[i][1] - prevP[1]];
    const perp = [-d[1], d[0]];
    const taper = k >= LEN - 2 ? (k === LEN - 1 ? 6 : 10) : BLOCK;
    rect(Math.round(cx - taper / 2), Math.round(cy - taper / 2), taper, taper, BODY);
    if (taper === BLOCK) {
      // belly stripe along the direction of travel
      rect(Math.round(cx - BLOCK / 2 + (d[0] ? 0 : 5)), Math.round(cy - BLOCK / 2 + (d[1] ? 0 : 5)), d[0] ? BLOCK : 4, d[1] ? BLOCK : 4, ACC);
      // dorsal spikes on alternate segments: a 4px-wide base and a 2px tip reaching across the gap
      if (i % 2 === 0) for (const s of [1, -1]) { prect(cx, cy, perp, s, BLOCK / 2, 2, 6, BODY); prect(cx, cy, perp, s, BLOCK / 2 + 2, 2, 2, BODY); }
      // legs every fifth segment: a short limb out to the side with a foot pointing backwards
      if (i % 5 === 2) for (const s of [1, -1]) {
        prect(cx, cy, perp, s, BLOCK / 2, 5, 2, BODY);
        const fx = cx + perp[0] * s * (BLOCK / 2 + 5) - d[0] * 4, fy = cy + perp[1] * s * (BLOCK / 2 + 5) - d[1] * 4;
        rect(Math.round(Math.min(fx, cx + perp[0] * s * (BLOCK / 2 + 5)) - (d[0] ? 0 : 1)), Math.round(Math.min(fy, cy + perp[1] * s * (BLOCK / 2 + 5)) - (d[1] ? 0 : 1)), d[0] ? 5 : 2, d[1] ? 5 : 2, BODY);
      }
    }
    if (k === LEN - 1) { rect(Math.round(cx - d[0] * 7 - 1), Math.round(cy - d[1] * 7 - 1), 3, 3, ACC); rect(Math.round(cx - d[0] * 10 - 1), Math.round(cy - d[1] * 10 - 1), 2, 2, ACC); }   // tail flame
  }
}
function frame(f) {
  px.fill(0);
  const eatenNow = new Uint8Array(COLS * ROWS);
  for (let i = 0; i <= f; i++) { const [c, r] = path[i]; if (c >= 0 && c < COLS && r >= 0 && r < ROWS) eatenNow[c + r * COLS] = 1; }
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) rect(PAD + c * CELL, PAD + r * CELL, BLOCK, BLOCK, 1 + (eatenNow[c + r * COLS] ? 0 : base[c + r * COLS]));
  if (targets[f]) { const [tx, ty] = center(targets[f]); disc(tx, ty, 7, ACC); disc(tx, ty, 5, 0); disc(tx, ty, 3, BODY); }   // the pearl
  drawBody(f);
  const prevH = path[f - 1] || [path[f][0] - 1, path[f][1]];
  drawHead(path[f], [path[f][0] - prevH[0], path[f][1] - prevH[1]]);
}

// ---------- GIF ----------
function lzw(pixels, minCodeSize) {
  const out = []; let cur = 0, curBits = 0;
  const CLEAR = 1 << minCodeSize, EOI = CLEAR + 1;
  let codeSize = minCodeSize + 1, next = EOI + 1, table = new Map();
  const emit = (code) => { cur |= code << curBits; curBits += codeSize; while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; } };
  emit(CLEAR);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = (prefix << 8) | k, e = table.get(key);
    if (e !== undefined) { prefix = e; continue; }
    emit(prefix);
    if (next === 4096) { emit(CLEAR); table = new Map(); next = EOI + 1; codeSize = minCodeSize + 1; }
    else { if (next >= (1 << codeSize)) codeSize++; table.set(key, next++); }
    prefix = k;
  }
  emit(prefix); emit(EOI);
  if (curBits > 0) out.push(cur & 255);
  return out;
}
const u16 = (v) => [v & 255, (v >> 8) & 255];
function gif(theme) {
  const parts = [];
  const push = (...b) => parts.push(Buffer.from(b));
  const dbg = process.env.DEBUG_FRAME ? { w: 200, h: 100, s: 4 } : null;   // magnified crop around the head
  push(...Buffer.from("GIF89a"));
  push(...u16(dbg ? dbg.w * dbg.s : W), ...u16(dbg ? dbg.h * dbg.s : H), 0xf2, 0, 0);
  push(...theme.bg, ...theme.dots.flat(), ...theme.body, ...theme.accent);
  push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);
  prev.fill(255);
  const only = process.env.DEBUG_FRAME ? [Number(process.env.DEBUG_FRAME)] : null;   // DEBUG_FRAME=n writes a single still frame
  for (const f of only || Array.from({ length: FRAMES }, (_, i) => i)) {
    frame(f);
    if (dbg) {
      const [hx, hy] = center(path[f]);
      const ox = Math.max(0, Math.min(W - dbg.w, Math.round(hx - dbg.w / 2))), oy = Math.max(0, Math.min(H - dbg.h, Math.round(hy - dbg.h / 2)));
      const rw = dbg.w * dbg.s, rh = dbg.h * dbg.s, sub = new Uint8Array(rw * rh);
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) sub[x + y * rw] = px[(ox + Math.floor(x / dbg.s)) + (oy + Math.floor(y / dbg.s)) * W];
      push(0x21, 0xf9, 4, 0x04, ...u16(100), 0, 0);
      push(0x2c, ...u16(0), ...u16(0), ...u16(rw), ...u16(rh), 0, 3);
      const data = lzw(sub, 3);
      for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); parts.push(Buffer.from([chunk.length, ...chunk])); }
      push(0);
      continue;
    }
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = x + y * W; if (px[i] !== prev[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1, sub = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) sub[x + y * rw] = px[(x0 + x) + (y0 + y) * W];
    prev.set(px);
    push(0x21, 0xf9, 4, 0x04, ...u16(f === FRAMES - 1 ? 120 : 6), 0, 0);
    push(0x2c, ...u16(x0), ...u16(y0), ...u16(rw), ...u16(rh), 0, 3);
    const data = lzw(sub, 3);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); parts.push(Buffer.from([chunk.length, ...chunk])); }
    push(0);
  }
  push(0x3b);
  return Buffer.concat(parts);
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });
for (const [name, theme] of Object.entries(themes)) {
  const buf = gif(theme);
  writeFileSync(resolve(dir, process.env.DEBUG_FRAME ? `dragon-debug-${name}.gif` : `dragon-${name}.gif`), buf);
  console.log(`dragon-${name}.gif  ${W}x${H}  ${FRAMES} frames  ${(buf.length / 1024).toFixed(0)} KB`);
}
