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
const LEN = 16, SUB = 4;              // body segments; sub-steps per cell, for smooth motion
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
const posAt = (t) => { if (t <= 0) return [XS + t, START_ROW]; const i = Math.min(STEPS - 1, Math.floor(t)), fr = t - i, a = path[i], b = path[i + 1]; return [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr]; };
const dirAt = (t) => { if (t < 0) return [1, 0]; const i = Math.min(STEPS - 1, Math.floor(t)), a = path[i], b = path[i + 1]; const d = [b[0] - a[0], b[1] - a[1]]; return d[0] || d[1] ? d : [1, 0]; };

// ---------- pearls: bites, and up to three power-up pearls per run chosen by a daily seed ----------
const bites = []; for (let i = 1; i <= STEPS; i++) if (targets[i - 1] && path[i][0] === targets[i - 1][0] && path[i][1] === targets[i - 1][1]) bites.push(i);   // steps where the head lands on a pearl
const biteSet = new Set(bites);
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const seed = (counts.reduce((a, b) => a + b, 0) * 131 + Math.floor(Date.now() / 86400000)) >>> 0;   // changes with the day, so the power-ups move on every nightly render
const rand = rng(seed);
// the ten pearl kinds and how long each effect lasts, in cells travelled
//   flame: fur flares, double speed      fire: breathes fire ahead        frost: half speed, frost trail behind the tail
//   ghost: a translucent twin follows    storm: lightning flash, glowing outline   moon: the grid dims, the eyes glow
//   growth: four more segments for good  giant: the head grows for a while        rotten: stops, shakes and blinks
//   fireworks: two rings of sparks
const KINDS = ["flame", "fire", "frost", "ghost", "storm", "moon", "growth", "giant", "rotten", "fireworks"];
const DUR = { flame: 8, fire: 6, frost: 6, ghost: 10, storm: 10, moon: 12, growth: 1e9, giant: 8, rotten: 0, fireworks: 0 };
const MAX_SPECIALS = 3, SPACING = 20;
const specials = [];   // { step, cell, kind }
{
  const pool = process.env.FORCE_KINDS ? process.env.FORCE_KINDS.split(",") : KINDS.slice(), candidates = bites.filter((i) => i > LEN + 2 && i < STEPS - 40);   // keep clear of the edges
  for (let guard = 0; specials.length < MAX_SPECIALS && pool.length && candidates.length && guard < 300; guard++) {
    const step = candidates[Math.floor(rand() * candidates.length)];
    if (specials.some((s) => Math.abs(s.step - step) < SPACING)) continue;
    specials.push({ step, cell: path[step], kind: pool.splice(Math.floor(rand() * pool.length), 1)[0] });
  }
  specials.sort((a, b) => a.step - b.step);
}
const specialAt = (step) => specials.find((s) => s.step === step);
const specialOf = (cell) => cell && specials.find((s) => s.cell[0] === cell[0] && s.cell[1] === cell[1]);
const active = (kind, t) => { const s = specials.find((x) => x.kind === kind); return s && t >= s.step && t < s.step + DUR[kind] ? t - s.step : -1; };   // age in cells, or -1
const lenAt = (t) => LEN + 4 * specials.filter((s) => s.kind === "growth" && t >= s.step).length;
const LEN_MAX = LEN + 4;
const HOLD = 12;   // frames the dragon stands still after a rotten pearl
// frame timetable: double speed during the flame surge, half speed in frost, a pause on the rotten pearl
const frames = [];
for (let i = 0; i < STEPS; i++) {
  const subs = active("flame", i) >= 0 ? SUB / 2 : active("frost", i) >= 0 ? SUB * 2 : SUB;
  const sp = specialAt(i); if (sp && sp.kind === "rotten") for (let k = 0; k < HOLD; k++) frames.push({ t: i, hold: k });
  for (let s = 0; s < subs; s++) frames.push({ t: i + s / subs });
}
const FRAMES = frames.length;         // frame FRAMES would equal frame 0 shifted by WRAP, so the loop is seamless
let FLARE = 1, HC = 2, SHAKE = [0, 0], TINT = null, MOON = false;   // fur multiplier, head chunk size, position offset, colour remap, glowing eyes

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
const put = (x, y, i) => { if (TINT) { i = TINT(i, x, y); if (i < 0) return; } if (x >= 0 && y >= 0 && x < W && y < H) px[x + y * W] = i; };
const rect = (x0, y0, w, h, i) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, i); };
const disc = (cx, cy, r, i) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) put(cx + x, cy + y, i); };
const center = ([c, r]) => [Math.round(PAD + c * CELL + BLOCK / 2) + SHAKE[0], Math.round(PAD + r * CELL + BLOCK / 2) + SHAKE[1]];   // cell coords may be fractional

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
// open mouth: a small dark gap in the middle of the snout with two long vampire fangs (T) hanging from the upper jaw
const HALF_OPEN = HALF.slice(0, 22).concat([
  ".....O=OOOO",
  ".....O=OTOO",
  ".....O=OTOO",
  "......OOOOO",
]);
const mirror = (half) => half.map((l) => l + l.slice(0, 10).split("").reverse().map((ch) => (ch === "*" ? "=" : ch)).join(""));
const HEAD = mirror(HALF), HEAD_OPEN = mirror(HALF_OPEN);
const ANCHOR = [10, 13];   // chunk that sits on the head cell's centre (between the eyes)
function drawHead(cell, dir, blink, open) {
  const [cx, cy] = center(cell);
  const f = dir, p = [f[1], -f[0]];   // the snout leads: the sprite's chin points along the direction of travel, antlers trail
  const S = open ? HEAD_OPEN : HEAD;
  for (let r = 0; r < S.length; r++) for (let c = 0; c < S[r].length; c++) {
    const ch = S[r][c]; if (ch === ".") continue;
    const idx = ch === "#" ? BODY : ch === "*" ? HI : ch === "=" ? SH : ch === "O" ? OUT : ch === "T" ? HI : blink ? (r === 13 ? BODY : OUT) : MOON ? HI : OUT;   // blinking: the eye closes to a lid line; moon: the eyes glow
    const u = c - ANCHOR[0], v = r - ANCHOR[1];   // u across the face, v towards the chin
    rect(cx + (u * p[0] + v * f[0]) * HC - 1, cy + (u * p[1] + v * f[1]) * HC - 1, HC, HC, idx);
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
const widthAt = (k, len) => (k >= len - 2 ? (k === len - 1 ? 6 : 10) : TUBE);
// spikes, legs and the tail flame, drawn in `idx` grown by `grow` px so the same calls give the outline and the fill
function trim(t, shift, idx, grow) {
  const len = lenAt(t);
  for (let k = len - 1; k >= 1; k--) {
    const p = posAt(t - k), d = dirAt(t - k), perp = [-d[1], d[0]];
    const [cx, cy] = center([p[0] + shift, p[1]]);
    if (widthAt(k, len) === TUBE) {
      // fur: two hairs per cell on each side, flowing with the body
      for (const o of [-4, 4]) for (const s of [1, -1]) {
        const bx = cx + d[0] * o, by = cy + d[1] * o;
        prect(bx, by, perp, s, TUBE / 2 - 1, Math.round((o < 0 ? 4 : 3) * FLARE) + grow, 4 + 2 * grow, idx);   // alternate long and short hairs
        if (o < 0) prect(bx, by, perp, s, TUBE / 2 - 1 + Math.round(4 * FLARE), Math.round(2 * FLARE) + grow, 2 + 2 * grow, idx);
      }
      if (k % 5 === 2) for (const s of [1, -1]) {
        prect(cx, cy, perp, s, TUBE / 2 - 1, 8 + grow, 3 + 2 * grow, idx);
        const lx = cx + perp[0] * s * (TUBE / 2 + 7), ly = cy + perp[1] * s * (TUBE / 2 + 7);
        stroke([lx, ly], [lx - d[0] * 5, ly - d[1] * 5], 3 + 2 * grow, idx);
      }
    }
    if (k === len - 1) { stroke([cx - d[0] * 6, cy - d[1] * 6], [cx - d[0] * 10, cy - d[1] * 10], 3 + 2 * grow, idx); }   // tail flame
  }
}
function drawBody(t, shift) {
  const len = lenAt(t);
  // outline pass: everything 2px fatter in the outline colour, then the fills on top, so only the silhouette keeps the line
  trim(t, shift, OUT, 2);
  for (let k = len - 1; k >= 1; k--) tube(t - k, t - k + 1, shift, widthAt(k, len) + 4, OUT);
  trim(t, shift, BODY, 0);
  for (let k = len - 1; k >= 1; k--) tube(t - k, t - k + 1, shift, widthAt(k, len), BODY);
  for (let k = len - 1; k >= 1; k--) if (widthAt(k, len) === TUBE) tube(t - k, t - k + 1, shift, TUBE, BODY, true);
  tube(t - (len - 3), t - 1, shift, 4, ACC);   // belly line along the whole body
  trim(t, shift, ACC, -1);                     // claws and flame tips in the accent grey
}
function frame(f) {
  px.fill(0);
  const fr = frames[f], t = fr.t, step = Math.floor(t), hx = posAt(t)[0];
  const age = {}; for (const k of KINDS) age[k] = active(k, t);
  FLARE = age.flame >= 0 ? 1 + 0.8 * Math.sin(Math.PI * (age.flame / DUR.flame)) : 1;
  HC = age.giant >= 0 ? 3 : 2;
  SHAKE = fr.hold !== undefined ? [fr.hold % 2 ? 1 : -1, 0] : [0, 0];
  MOON = age.moon >= 0;
  const flash = age.storm >= 0 && age.storm < 0.5;   // two frames of lightning
  // cells the head has reached so far
  const eatenNow = new Uint8Array(COLS * ROWS);
  for (let i = 0; i <= step; i++) { const [c, r] = path[i]; if (c >= 0 && c < COLS && r >= 0 && r < ROWS) eatenNow[c + r * COLS] = 1; }
  // once the tail has left the right edge, the grid wipes back in from the left before the head re-enters
  const wipeStart = COLS + LEN_MAX - 1, wipeEnd = XS + WRAP - 1;
  const front = hx >= wipeEnd ? COLS : hx >= wipeStart ? Math.floor(((hx - wipeStart) / (wipeEnd - wipeStart)) * COLS) : 0;
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    const lvl = eatenNow[c + r * COLS] && c >= front ? 0 : base[c + r * COLS];
    const idx = flash ? 5 : MOON ? (lvl ? 1 + Math.max(1, lvl - 1) : 0) : 1 + lvl;   // storm: everything white; moon: dimmed, empty cells vanish
    if (idx) rect(PAD + c * CELL, PAD + r * CELL, BLOCK, BLOCK, idx);
  }
  const blink = fr.hold !== undefined ? fr.hold % 6 < 3 : f > 5 && f % BLINK_EVERY < BLINK_FRAMES, head = posAt(t), dir = dirAt(t);
  const tg = targets[step];
  // pearls: the current one breathes and carries an orbiting glint; the power-up pearls sit on their cells from the start
  const pulse = Math.round(Math.sin(f * 0.22));
  const drawPearl = (cell, kind) => {
    const [tx, ty] = center(cell);
    const fa = Math.abs(cell[0] - head[0]) + Math.abs(cell[1] - head[1]) < 8 ? f : 0;   // pearls only animate near the dragon, so distant ones never widen the changed region
    const dot = (ang, r, idx) => rect(Math.round(tx + Math.cos(ang) * r) - 1, Math.round(ty + Math.sin(ang) * r) - 1, 2, 2, idx);
    const ring = (r) => { disc(tx, ty, r, ACC); disc(tx, ty, r - 2, 0); };
    switch (kind) {
      case "flame":
        for (let k = -2; k <= 2; k++) {   // flickering tongues of flame over the top half
          const ang = -Math.PI / 2 + k * 0.55 + (fa % 2 ? 0.12 : -0.12), len = 4 + ((fa + k + 10) % 3) * 2;
          for (let j = 0; j <= len; j += 2) rect(Math.round(tx + Math.cos(ang) * (9 + j)) - 1, Math.round(ty + Math.sin(ang) * (9 + j)) - 1, 2, 2, j < len ? HI : ACC);
        }
        ring(9); disc(tx, ty, 5, HI); break;
      case "fire": ring(8); rect(tx - 1, ty - 5, 2, 2, HI); rect(tx - 2, ty - 3, 4, 2, HI); rect(tx - 3, ty - 1, 6, 4, HI); break;                       // a small flame inside
      case "frost": ring(8); rect(tx - 1, ty - 5, 2, 10, HI); rect(tx - 5, ty - 1, 10, 2, HI); for (let k = 0; k < 4; k++) dot(k * 1.571 + 0.785, 4, HI); break;   // a snow crystal
      case "ghost": for (let k = 0; k < 24; k += 2) dot((k * 6.283) / 24 + fa * 0.05, 8, ACC); disc(tx, ty, 3, ACC); disc(tx, ty, 1, 0); break;          // dashed ring, hollow core
      case "storm": ring(8); rect(tx, ty - 5, 2, 3, HI); rect(tx - 2, ty - 2, 2, 3, HI); rect(tx, ty + 1, 2, 4, HI); break;                             // a lightning zigzag
      case "moon": ring(8); disc(tx, ty, 4, HI); disc(tx + 2, ty - 1, 3, 0); break;                                                                       // a crescent
      case "growth": ring(8); disc(tx, ty, 3, HI); for (let k = 0; k < 4; k++) dot(k * 1.571 + 0.785, 5, HI); break;                                     // a core with four satellites
      case "giant": ring(11); disc(tx, ty, 6, HI); break;                                                                                               // simply bigger
      case "rotten": for (let k = 0; k < 18; k++) if (k % 3) dot((k * 6.283) / 18, 8, ACC); disc(tx, ty, 5, SH); rect(tx - 2, ty - 1, 2, 2, 0); rect(tx + 1, ty + 1, 2, 2, 0); break;   // a broken ring, a dark core with holes
      case "fireworks": disc(tx, ty, 3, HI); for (let k = 0; k < 6; k++) dot(k * 1.047 + fa * 0.1, 7, k % 2 ? HI : ACC); break;                         // a core with orbiting sparks
      default: disc(tx, ty, 7 + pulse, ACC); disc(tx, ty, 5 + pulse, 0); disc(tx, ty, 3, BODY); dot(fa * 0.2, 6 + pulse, HI);
    }
  };
  for (const s of specials) if (!eatenNow[s.cell[0] + s.cell[1] * COLS]) drawPearl(s.cell, s.kind);
  if (tg && !specialOf(tg)) drawPearl(tg, null);
  // frost trail: crystals appear where the tail passes during the frost and fade over the next few cells
  if (specials.some((s) => s.kind === "frost")) {
    const fs = specials.find((s) => s.kind === "frost").step, len = lenAt(t);
    for (let j = fs - len; j <= fs + DUR.frost - len; j++) {
      const a = t - (j + len); if (j < 0 || j > STEPS || a < 0 || a >= 10) continue;
      const [cx, cy] = center(path[j]), idx = a < 5 ? HI : ACC;
      rect(cx - 1, cy - 4, 2, 8, idx); rect(cx - 4, cy - 1, 8, 2, idx);
      if (a < 3) for (let k = 0; k < 4; k++) rect(Math.round(cx + Math.cos(k * 1.571 + 0.785) * 4) - 1, Math.round(cy + Math.sin(k * 1.571 + 0.785) * 4) - 1, 2, 2, HI);
    }
  }
  // jaws open when a cell is within reach and stay open for a couple of frames after the bite
  const near = tg ? Math.abs(tg[0] - head[0]) + Math.abs(tg[1] - head[1]) <= 1.3 : false;
  const justAte = biteSet.has(step) && t - step < 0.7;
  const open = near || justAte;
  // ghost: a translucent twin floating a little above the track, two cells behind, checkered out as it fades
  if (age.ghost >= 0) {
    const fading = age.ghost > DUR.ghost - 3;
    TINT = (i, x, y) => (i === OUT || (fading && (x + y) % 2) ? -1 : i === 0 ? 0 : ACC);
    SHAKE = [SHAKE[0], SHAKE[1] - 12];
    drawBody(t - 2, 0); drawHead(posAt(t - 2), dirAt(t - 2), false, false);
    SHAKE = [SHAKE[0], SHAKE[1] + 12]; TINT = null;
  }
  if (age.storm >= 0 && age.storm < 3) TINT = (i) => (i === OUT ? HI : i);   // the outline glows after the lightning
  for (const shift of [0, -WRAP, WRAP]) { drawBody(t, shift); drawHead([head[0] + shift, head[1]], dir, blink, open); }   // drawn thrice so it wraps across the edges
  TINT = null;
  // fire breath: a flickering cone of sparks ahead of the jaws
  if (age.fire >= 0) {
    const [hx2, hy2] = center(head), perp = [-dir[1], dir[0]], r = rng(f * 31 + seed);
    for (let k = 0; k < 16; k++) {
      const dist = 14 + r() * 36, spread = (r() - 0.5) * dist * 0.7, size = dist < 26 ? 3 : 2;
      rect(Math.round(hx2 + dir[0] * dist + perp[0] * spread) - 1, Math.round(hy2 + dir[1] * dist + perp[1] * spread) - 1, size, size, dist < 30 ? HI : ACC);
    }
  }
  // bite burst: sparks fly from the jaws after each pearl is eaten; power-ups throw more, fireworks throw two rings
  for (const i of [step - 2, step - 1, step]) if (biteSet.has(i) && t - i >= 0) {
    const sp = specialAt(i), kind = sp ? sp.kind : null, maxAge = kind === "fireworks" ? 2.5 : 1.5, a = t - i;
    if (a >= maxAge) continue;
    const [bx, by] = center(path[i]), r0 = rng(i * 7919 + seed)(), n = kind === "fireworks" ? 12 : kind ? 10 : 5;
    for (let k = 0; k < n; k++) { const ang = r0 * 6.28 + (k * 6.28) / n, d = 4 + a * 12; rect(Math.round(bx + Math.cos(ang) * d) - 1, Math.round(by + Math.sin(ang) * d) - 1, 2, 2, a < maxAge * 0.55 ? HI : ACC); }
    if (kind === "fireworks" && a >= 0.5) for (let k = 0; k < 12; k++) { const ang = r0 * 6.28 + 0.26 + (k * 6.28) / 12, d = 4 + (a - 0.5) * 16; rect(Math.round(bx + Math.cos(ang) * d) - 1, Math.round(by + Math.sin(ang) * d) - 1, 2, 2, a < 1.6 ? HI : ACC); }
  }
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
      const hp = posAt(frames[f].t - (process.env.DEBUG_AT === "tail" ? lenAt(frames[f].t) + 3 : 0)), [hx, hy] = center([((hp[0] + 1) % WRAP + WRAP) % WRAP - 1, hp[1]]);
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
    push(0x21, 0xf9, 4, 0x04, ...u16(4), 0, 0);   // 25 fps, four sub-steps per cell: a slow, even glide; no pause, the wrap hides the loop point
    push(0x2c, ...u16(x0), ...u16(y0), ...u16(rw), ...u16(rh), 0, 4);
    const data = lzw(sub, 4);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); parts.push(Buffer.from([chunk.length, ...chunk])); }
    push(0);
  }
  push(0x3b);
  return Buffer.concat(parts);
}

console.log(`${bites.length} pearls; power-ups: ${specials.map((s) => `${s.kind}@${s.step} (frame ${frames.findIndex((x) => x.t === s.step)})`).join(", ") || "none"}`);
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });
for (const [name, theme] of Object.entries(themes)) {
  const buf = gif(theme);
  writeFileSync(resolve(dir, process.env.DEBUG_FRAME ? `dragon-debug-${name}.gif` : `dragon-${name}.gif`), buf);
  console.log(`dragon-${name}.gif  ${W}x${H}  ${FRAMES} frames  ${(buf.length / 1024).toFixed(0)} KB`);
}
