#!/usr/bin/env node
// Renders assets/dragon-dark.gif and assets/dragon-light.gif: a pixel-art
// Chinese dragon chasing a pearl through your contribution calendar, eating
// the cells as it goes, then sliding out the right edge and back in on the
// left while the grid refills. Zero dependencies; only changed pixels are
// written per frame so the file stays small.
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

// ---------- path: chase the nearest pearl without crossing the body, then line up and leave right ----------
const LEN = 16, SUB = 3;              // body segments; sub-steps per cell, for smooth motion
const START_ROW = 3, XS = -1;         // the head starts one cell off the left edge
const WRAP = COLS + 24;               // cells from the start position to where the dragon re-enters on the left
const path = [[XS, START_ROW]], targets = [];
const eaten = new Uint8Array(COLS * ROWS);
const headAt = () => path[path.length - 1];
const occupied = (c, r) => { for (let i = Math.max(0, path.length - LEN); i < path.length; i++) if (path[i][0] === c && path[i][1] === r) return true; return false; };
function stepToward(tx, ty) {
  const [hx, hy] = headAt(); const dx = tx - hx, dy = ty - hy;
  const cands = [];
  if (dx) cands.push([hx + Math.sign(dx), hy]);   // across first, then along the column
  if (dy) cands.push([hx, hy + Math.sign(dy)]);
  cands.push([hx, hy + 1], [hx, hy - 1], [hx + 1, hy], [hx - 1, hy]);   // sidesteps when the body is in the way
  path.push(cands.find(([c, r]) => r >= 0 && r < ROWS && !occupied(c, r)) || cands[0]);
  const [nx, ny] = headAt(), i = nx + ny * COLS;
  if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && base[i]) eaten[i] = 1;   // anything crossed is eaten
}
// serpentine sweep: column by column, each column's cells taken from the end nearest the head, so the body never coils
for (let c = 0; c < COLS; c++) {
  const rows = []; for (let r = 0; r < ROWS; r++) if (base[c + r * COLS]) rows.push(r);
  if (!rows.length) continue;
  if (Math.abs(rows[0] - headAt()[1]) > Math.abs(rows[rows.length - 1] - headAt()[1])) rows.reverse();
  for (const r of rows) while (!eaten[c + r * COLS] && path.length < 20000) { stepToward(c, r); targets.push([c, r]); }
}
// line up with the start row while heading right, slide out, and carry on to the re-entry point
while (headAt()[1] !== START_ROW || headAt()[0] < COLS) { const [hx, hy] = headAt(); path.push(hy === START_ROW || path.length % 2 ? [hx + 1, hy] : [hx, hy + Math.sign(START_ROW - hy)]); targets.push(null); }
while (headAt()[0] < XS + WRAP) { path.push([headAt()[0] + 1, START_ROW]); targets.push(null); }
const STEPS = path.length - 1;        // step i runs path[i] -> path[i+1]; frame f sits at t = f / SUB
const FRAMES = STEPS * SUB;           // frame FRAMES would equal frame 0 shifted by WRAP, so the loop is seamless
const posAt = (t) => { if (t <= 0) return [XS + t, START_ROW]; const i = Math.min(STEPS - 1, Math.floor(t)), fr = t - i, a = path[i], b = path[i + 1]; return [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr]; };
const dirAt = (t) => { if (t < 0) return [1, 0]; const i = Math.min(STEPS - 1, Math.floor(t)), a = path[i], b = path[i + 1]; const d = [b[0] - a[0], b[1] - a[1]]; return d[0] || d[1] ? d : [1, 0]; };

// ---------- pixels ----------
const CELL = 18, GAP = 4, BLOCK = CELL - GAP, PAD = 16;
const W = COLS * CELL + PAD * 2, H = ROWS * CELL + PAD * 2;
const themes = {
  dark: { bg: [13, 17, 23], dots: [[28, 33, 40], [59, 64, 72], [110, 118, 129], [163, 170, 179], [230, 237, 243]], body: [222, 228, 235], accent: [139, 148, 158], hi: [255, 255, 255], sh: [150, 158, 168], out: [62, 70, 82] },
  light: { bg: [255, 255, 255], dots: [[235, 237, 240], [201, 201, 201], [143, 143, 143], [87, 87, 87], [31, 31, 31]], body: [118, 118, 118], accent: [170, 170, 170], hi: [160, 160, 160], sh: [72, 72, 72], out: [22, 22, 22] },
};
// palette (16 slots): 0 bg, 1..5 dot levels 0..4, 6 body, 7 accent, 8 highlight, 9 shadow, 10 outline
const BODY = 6, ACC = 7, HI = 8, SH = 9, OUT = 10;
const BLINK_EVERY = 45 * SUB, BLINK_FRAMES = 3 * SUB;
const px = new Uint8Array(W * H), prev = new Uint8Array(W * H);
const put = (x, y, i) => { if (x >= 0 && y >= 0 && x < W && y < H) px[x + y * W] = i; };
const rect = (x0, y0, w, h, i) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, i); };
const disc = (cx, cy, r, i) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) put(cx + x, cy + y, i); };
const center = ([c, r]) => [Math.round(PAD + c * CELL + BLOCK / 2), Math.round(PAD + r * CELL + BLOCK / 2)];   // cell coords may be fractional

// Head: front view, always upright, in 2x2 chunks. Drawn as the left half plus the centre column and mirrored,
// with highlights on the left turning into shadows on the right so the light comes from one side.
// O outline, # fill, * highlight, = shadow, o eye, . empty
const HALF = [
  "..O........",
  ".O*O..O....",
  ".O#O.O*O...",
  "..O#O#*#O..",
  "..O##**#O..",
  "...O###O...",
  "...O###O...",
  "...O###O.O.",
  "..OO###OOOO",
  ".O*#####*##",
  "O*#########",
  ".O#########",
  "O*##OOO####",
  ".O##O*oo###",
  "O*###Ooo###",
  ".OO###OO###",
  "..O=#######",
  "...O=######",
  "...O==#####",
  "....O==####",
  "....O=O####",
  ".....O=####",
  ".....O=O###",
  ".....OO#OO#",
  "......OOOOO",
];
const HEAD = HALF.map((l) => l + l.slice(0, 10).split("").reverse().map((ch) => (ch === "*" ? "=" : ch)).join(""));
const ANCHOR = [10, 13];   // chunk that sits on the head cell's centre (between the eyes)
function drawHead(cell, dir, blink) {
  const [cx, cy] = center(cell);
  const f = dir, p = [f[1], -f[0]];   // the snout leads: the sprite's chin points along the direction of travel, antlers trail
  for (let r = 0; r < HEAD.length; r++) for (let c = 0; c < HEAD[r].length; c++) {
    const ch = HEAD[r][c]; if (ch === ".") continue;
    const idx = ch === "#" ? BODY : ch === "*" ? HI : ch === "=" ? SH : ch === "O" ? OUT : blink ? BODY : OUT;   // eyes close to plain fill under the brow line
    const u = c - ANCHOR[0], v = r - ANCHOR[1];   // u across the face, v towards the chin
    rect(cx + (u * p[0] + v * f[0]) * 2 - 1, cy + (u * p[1] + v * f[1]) * 2 - 1, 2, 2, idx);
  }
}
// a rectangle placed along the perpendicular axis p, `dist` px out from a segment centre, `thick` along p and `width` across it
function prect(cx, cy, p, s, dist, thick, width, idx) {
  if (p[0]) rect(Math.round(cx + p[0] * s * dist - (s * p[0] > 0 ? 0 : thick)), Math.round(cy - width / 2), thick, width, idx);
  else rect(Math.round(cx - width / 2), Math.round(cy + p[1] * s * dist - (s * p[1] > 0 ? 0 : thick)), width, thick, idx);
}
const TUBE = BLOCK - 2;   // the body is slightly slimmer than a cell so neighbouring runs keep a gap between their outlines
// an axis-aligned thick line between two pixel points, square caps
function stroke(a, b, w, idx) {
  rect(Math.round(Math.min(a[0], b[0]) - w / 2), Math.round(Math.min(a[1], b[1]) - w / 2), Math.round(Math.abs(b[0] - a[0]) + w), Math.round(Math.abs(b[1] - a[1]) + w), idx);
}
// the body between path parameters ta and tb, following every corner of the path
function tube(ta, tb, shift, w, idx, edges) {
  let a = center([posAt(ta)[0] + shift, posAt(ta)[1]]);
  const pts = [];
  for (let i = Math.ceil(ta); i < tb; i++) if (i > 0 && i <= STEPS) pts.push(center([path[i][0] + shift, path[i][1]]));
  pts.push(center([posAt(tb)[0] + shift, posAt(tb)[1]]));
  for (const b of pts) {
    if (!edges) stroke(a, b, w, idx);
    else if (a[1] === b[1]) {   // horizontal run: lit on top, shaded underneath
      rect(Math.round(Math.min(a[0], b[0]) - w / 2), Math.round(a[1] - w / 2), Math.round(Math.abs(b[0] - a[0]) + w), 2, HI);
      rect(Math.round(Math.min(a[0], b[0]) - w / 2), Math.round(a[1] + w / 2) - 3, Math.round(Math.abs(b[0] - a[0]) + w), 3, SH);
    } else {                    // vertical run: lit on the left, shaded on the right
      rect(Math.round(a[0] - w / 2), Math.round(Math.min(a[1], b[1]) - w / 2), 2, Math.round(Math.abs(b[1] - a[1]) + w), HI);
      rect(Math.round(a[0] + w / 2) - 3, Math.round(Math.min(a[1], b[1]) - w / 2), 3, Math.round(Math.abs(b[1] - a[1]) + w), SH);
    }
    a = b;
  }
}
const widthAt = (k) => (k >= LEN - 2 ? (k === LEN - 1 ? 6 : 10) : TUBE);
// spikes, legs and the tail flame, drawn in `idx` grown by `grow` px so the same calls give the outline and the fill
function trim(t, shift, idx, grow) {
  for (let k = LEN - 1; k >= 1; k--) {
    const p = posAt(t - k), d = dirAt(t - k), perp = [-d[1], d[0]];
    const [cx, cy] = center([p[0] + shift, p[1]]);
    if (widthAt(k) === TUBE) {
      if (k % 2 === 0) for (const s of [1, -1]) { prect(cx, cy, perp, s, TUBE / 2 - 1, 3 + grow, 6 + 2 * grow, idx); prect(cx, cy, perp, s, TUBE / 2 + 2, 2 + grow, 2 + 2 * grow, idx); }
      if (k % 5 === 2) for (const s of [1, -1]) {
        prect(cx, cy, perp, s, TUBE / 2 - 1, 6 + grow, 2 + 2 * grow, idx);
        const lx = cx + perp[0] * s * (TUBE / 2 + 5), ly = cy + perp[1] * s * (TUBE / 2 + 5);
        stroke([lx, ly], [lx - d[0] * 4, ly - d[1] * 4], 2 + 2 * grow, idx);
      }
    }
    if (k === LEN - 1) { stroke([cx - d[0] * 6, cy - d[1] * 6], [cx - d[0] * 10, cy - d[1] * 10], 3 + 2 * grow, idx); }   // tail flame
  }
}
function drawBody(t, shift) {
  // outline pass: everything 2px fatter in the outline colour, then the fills on top, so only the silhouette keeps the line
  trim(t, shift, OUT, 2);
  for (let k = LEN - 1; k >= 1; k--) tube(t - k, t - k + 1, shift, widthAt(k) + 4, OUT);
  trim(t, shift, BODY, 0);
  for (let k = LEN - 1; k >= 1; k--) tube(t - k, t - k + 1, shift, widthAt(k), BODY);
  for (let k = LEN - 1; k >= 1; k--) if (widthAt(k) === TUBE) tube(t - k, t - k + 1, shift, TUBE, BODY, true);
  tube(t - (LEN - 3), t - 1, shift, 4, ACC);   // belly line along the whole body
  trim(t, shift, ACC, -1);                     // claws and flame tips in the accent grey
}
function frame(f) {
  px.fill(0);
  const t = f / SUB, step = Math.floor(t), hx = posAt(t)[0];
  // cells the head has reached so far
  const eatenNow = new Uint8Array(COLS * ROWS);
  for (let i = 0; i <= step; i++) { const [c, r] = path[i]; if (c >= 0 && c < COLS && r >= 0 && r < ROWS) eatenNow[c + r * COLS] = 1; }
  // once the tail has left the right edge, the grid wipes back in from the left before the head re-enters
  const wipeStart = COLS + LEN - 1, wipeEnd = XS + WRAP - 1;
  const front = hx >= wipeEnd ? COLS : hx >= wipeStart ? Math.floor(((hx - wipeStart) / (wipeEnd - wipeStart)) * COLS) : 0;
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) rect(PAD + c * CELL, PAD + r * CELL, BLOCK, BLOCK, 1 + (eatenNow[c + r * COLS] && c >= front ? 0 : base[c + r * COLS]));
  if (targets[step]) { const [tx, ty] = center(targets[step]); disc(tx, ty, 7, ACC); disc(tx, ty, 5, 0); disc(tx, ty, 3, BODY); }   // the pearl
  const blink = f > 5 && f % BLINK_EVERY < BLINK_FRAMES, head = posAt(t), dir = dirAt(t);
  for (const shift of [0, -WRAP, WRAP]) { drawBody(t, shift); drawHead([head[0] + shift, head[1]], dir, blink); }   // drawn thrice so it wraps across the edges
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
  const dbg = process.env.DEBUG_FRAME ? (process.env.DEBUG_FULL ? { w: W, h: H, s: 1 } : { w: 200, h: 100, s: 4 }) : null;   // DEBUG_FRAME=n: a still; DEBUG_FULL=1: whole grid instead of a magnified crop around the head
  push(...Buffer.from("GIF89a"));
  push(...u16(dbg ? dbg.w * dbg.s : W), ...u16(dbg ? dbg.h * dbg.s : H), 0xf3, 0, 0);   // 16-colour global table
  push(...theme.bg, ...theme.dots.flat(), ...theme.body, ...theme.accent, ...theme.hi, ...theme.sh, ...theme.out, ...new Array(5 * 3).fill(0));
  push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);
  prev.fill(255);
  const only = process.env.DEBUG_FRAME ? [Number(process.env.DEBUG_FRAME)] : null;   // DEBUG_FRAME=n writes a single still frame
  for (const f of only || Array.from({ length: FRAMES }, (_, i) => i)) {
    frame(f);
    if (dbg) {
      const hp = posAt(f / SUB), [hx, hy] = center([((hp[0] + 1) % WRAP + WRAP) % WRAP - 1, hp[1]]);
      const ox = Math.max(0, Math.min(W - dbg.w, Math.round(hx - dbg.w / 2))), oy = Math.max(0, Math.min(H - dbg.h, Math.round(hy - dbg.h / 2)));
      const rw = dbg.w * dbg.s, rh = dbg.h * dbg.s, sub = new Uint8Array(rw * rh);
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) sub[x + y * rw] = px[(ox + Math.floor(x / dbg.s)) + (oy + Math.floor(y / dbg.s)) * W];
      push(0x21, 0xf9, 4, 0x04, ...u16(100), 0, 0);
      push(0x2c, ...u16(0), ...u16(0), ...u16(rw), ...u16(rh), 0, 4);
      const data = lzw(sub, 4);
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
    push(0x21, 0xf9, 4, 0x04, ...u16(3), 0, 0);   // ~30 fps, no pause: the wrap makes the loop point invisible
    push(0x2c, ...u16(x0), ...u16(y0), ...u16(rw), ...u16(rh), 0, 4);
    const data = lzw(sub, 4);
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
