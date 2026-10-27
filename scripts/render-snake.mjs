#!/usr/bin/env node
// Renders assets/snake-dark.gif and assets/snake-light.gif: your contribution
// calendar as grey blocks, eaten by a snake drawn as hollow rings with a solid
// head. Same pixel language as the banner, same zero-dependency GIF encoder,
// with only the changed region written per frame so the file stays small.
//
//   GH_PAT=... node scripts/render-snake.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.GITHUB_USER || "gemesquita";
const TOKEN = process.env.GH_PAT || process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error("Set GH_PAT (or GITHUB_TOKEN)."); process.exit(1); }

// ---------- calendar ----------
const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "render-snake" },
  body: JSON.stringify({ query: `query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar { weeks { contributionDays { weekday contributionCount } } } } } }`, variables: { login: USER } }),
});
const json = await res.json();
if (!json.data) { console.error(JSON.stringify(json, null, 2)); process.exit(1); }
const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
const COLS = weeks.length, ROWS = 7;
// quartile shading, like GitHub's own graph, so one huge day does not flatten the rest
const counts = weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)).filter((n) => n > 0).sort((a, b) => a - b);
const q = (p) => counts[Math.min(counts.length - 1, Math.floor(counts.length * p))] ?? 1;
const level = (n) => (n === 0 ? 0 : n <= q(0.25) ? 1 : n <= q(0.5) ? 2 : n <= q(0.75) ? 3 : 4);
const base = new Uint8Array(COLS * ROWS);
weeks.forEach((w, c) => w.contributionDays.forEach((d) => { base[c + d.weekday * COLS] = level(d.contributionCount); }));

// ---------- snake path: hunt the nearest uneaten cell, then leave to the right ----------
const LEN = 7;
const path = [];                       // head positions, one per frame
let head = [-2, 3];
const eaten = new Uint8Array(COLS * ROWS);
const food = () => { let best = null, bd = 1e9; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const i = c + r * COLS; if (base[i] && !eaten[i]) { const d = Math.abs(c - head[0]) * 1.0 + Math.abs(r - head[1]) * 1.4; if (d < bd) { bd = d; best = [c, r]; } } } return best; };
let target = food();
while (target) {
  const dx = target[0] - head[0], dy = target[1] - head[1];
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) head = [head[0] + Math.sign(dx), head[1]];
  else head = [head[0], head[1] + Math.sign(dy)];
  path.push(head);
  if (head[0] === target[0] && head[1] === target[1]) { eaten[head[0] + head[1] * COLS] = 1; target = food(); }
}
for (let i = 0; i < LEN + 2; i++) { head = [head[0] + 1, head[1]]; path.push(head); }   // slither off the edge
const FRAMES = path.length;

// ---------- pixels ----------
const CELL = 12, GAP = 3, PAD = 8;
const W = COLS * CELL + PAD * 2, H = ROWS * CELL + PAD * 2;
const themes = {
  dark: { bg: [13, 17, 23], dots: [[28, 33, 40], [59, 64, 72], [110, 118, 129], [163, 170, 179], [230, 237, 243]], snake: [230, 237, 243] },
  light: { bg: [255, 255, 255], dots: [[235, 237, 240], [201, 201, 201], [143, 143, 143], [87, 87, 87], [31, 31, 31]], snake: [118, 118, 118] },
};
// palette indices: 0 bg, 1..5 dot levels 0..4, 6 snake
const px = new Uint8Array(W * H), prev = new Uint8Array(W * H);
function cellRect(c, r, inset, idx) {
  const x0 = PAD + c * CELL + inset, y0 = PAD + r * CELL + inset, s = CELL - GAP - inset * 2;
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if (x >= 0 && y >= 0 && x < W && y < H) px[x + y * W] = idx;
}
function ring(c, r) {
  const x0 = PAD + c * CELL - 1, y0 = PAD + r * CELL - 1, s = CELL - GAP + 2;
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) {
    const edge = x - x0 < 2 || y - y0 < 2 || x0 + s - x <= 2 || y0 + s - y <= 2;
    if (x >= 0 && y >= 0 && x < W && y < H) px[x + y * W] = edge ? 6 : 0;
  }
}
function frame(f) {
  px.fill(0);
  const eatenNow = new Uint8Array(COLS * ROWS);
  for (let i = 0; i <= f; i++) { const [c, r] = path[i]; if (c >= 0 && c < COLS && r >= 0 && r < ROWS) eatenNow[c + r * COLS] = 1; }
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) cellRect(c, r, 0, 1 + (eatenNow[c + r * COLS] ? 0 : base[c + r * COLS]));
  for (let k = LEN - 1; k >= 1; k--) { const i = f - k; if (i >= 0) ring(path[i][0], path[i][1]); }
  const [hc, hr] = path[f];
  cellRect(hc, hr, -2, 6);                                       // solid head, a little larger than a cell
  const ex = PAD + hc * CELL + CELL - GAP - 2, ey = PAD + hr * CELL + 2; // eye
  if (ex >= 0 && ey >= 0 && ex < W && ey < H) px[ex + ey * W] = 0;
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
  push(...Buffer.from("GIF89a"));
  push(...u16(W), ...u16(H), 0xf2, 0, 0);
  push(...theme.bg, ...theme.dots.flat(), ...theme.snake, 0, 0, 0);   // 8 colours
  push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);
  prev.fill(255);
  for (let f = 0; f < FRAMES; f++) {
    frame(f);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = x + y * W; if (px[i] !== prev[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1, sub = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) sub[x + y * rw] = px[(x0 + x) + (y0 + y) * W];
    prev.set(px);
    const delay = f === FRAMES - 1 ? 120 : 5;                       // 20 fps, pause before the loop restarts
    push(0x21, 0xf9, 4, 0x04, ...u16(delay), 0, 0);
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
  writeFileSync(resolve(dir, `snake-${name}.gif`), buf);
  console.log(`snake-${name}.gif  ${W}x${H}  ${FRAMES} frames  ${(buf.length / 1024).toFixed(0)} KB`);
}
