#!/usr/bin/env node
// Renders assets/banner.gif: a greyscale ASCII polar scene (aurora, swell,
// drifting icebergs) as a seamless loop. Zero dependencies: block glyphs are
// drawn as pixel patterns and the GIF is LZW-encoded by hand.
//
//   node scripts/render-banner.mjs            -> assets/banner.gif
//   node scripts/render-banner.mjs out.gif    -> custom path

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COLS = 110, ROWS = 28;          // character grid
const CW = 8, CH = 16;                // pixels per cell
const FRAMES = 72, DELAY = 10;        // 10 fps, 7.2 s seamless loop
const LEVELS = 7;                     // grey ramp steps above the background
const BG = [13, 17, 23];              // GitHub dark canvas, so the banner melts into it
const FG = [230, 237, 243];

const W = COLS * CW, H = ROWS * CH;
const out = resolve(process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "banner.gif"));

// ---------- noise ----------
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function noise2(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 3, s = 0) { let v = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { v += a * noise2(x * f, y * f, s + i); n += a; a *= 0.5; f *= 2; } return v / n; }
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

// ---------- scene (all motion is periodic in FRAMES so the loop is seamless) ----------
const ch = new Array(COLS * ROWS).fill(" ");
const lv = new Float32Array(COLS * ROWS);
const set = (x, y, c, l) => { if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return; ch[x + y * COLS] = c; lv[x + y * COLS] = l; };
// overlay layer: stars and light smears sit on top of the base cell instead of replacing it
const ov = new Array(COLS * ROWS).fill(" ");
const ovl = new Float32Array(COLS * ROWS);
const setOv = (x, y, c, l) => { if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return; ov[x + y * COLS] = c; ovl[x + y * COLS] = l; };

const HZ = Math.floor(ROWS * 0.6);
const r = rng(61);
const stars = Array.from({ length: Math.floor(COLS * 0.6) }, () => [Math.floor(r() * COLS), Math.floor(r() * HZ * 0.9), r(), r() * 6.28]);
const bergs = [[0.22, 0.16, 0.42, 1, 0], [0.62, 0.09, 0.24, 2, 2], [0.84, 0.12, 0.36, 3, 4], [0.44, 0.04, 0.12, 4, 1]].map(([cx, w0, h0, s, ph]) => {
  const Wb = Math.max(2, Math.round(w0 * COLS)), Hb = h0 * HZ;
  const prof = [];
  for (let i = -Wb; i <= Wb; i++) {
    const u = i / Wb;
    const base = Hb * Math.pow(Math.max(0, 1 - u * u), 0.35) * (0.6 + 0.45 * noise2(i * 0.2, s * 3, 4));
    const jag = (noise2(i * 0.5, s * 10, 7) - 0.5) * Hb * 0.3;
    prof.push(Math.max(0, base + jag));
  }
  return { cx: Math.round(cx * COLS), W: Wb, prof, ph };
});

function scene(frame) {
  ch.fill(" "); lv.fill(0); ov.fill(" "); ovl.fill(0);
  const p = (Math.PI * 2 * frame) / FRAMES, cp = Math.cos(p), sp = Math.sin(p);

  // night sky with a faint aurora curtain
  for (let y = 0; y < HZ; y++) for (let x = 0; x < COLS; x++) {
    const v = y / HZ;
    const curtainY = HZ * 0.22 + Math.sin(x * 0.06 + p) * 2.5 + Math.sin(x * 0.021 - 2 * p) * 2;
    const rays = fbm(x * 0.25 + 1.5 * cp, 1.5 * sp, 2, 13);
    const a = Math.exp(-(((y - curtainY) / (3 + rays * 3)) ** 2)) * (0.3 + rays) * (0.65 + 0.35 * Math.sin(2 * p + x * 0.03));
    if (a > 0.32) set(x, y, a > 0.75 ? "▓" : a > 0.5 ? "▒" : "░", 0.26 + a * 0.36);
    else set(x, y, v > 0.6 ? "▒" : "░", 0.08 + v * 0.16);
  }
  // a distant dragon, hazy and a shade lighter than the sky, crossing right to left once per loop
  {
    const L = 16, hx = (COLS + 30) * (1 - frame / FRAMES) - 15, baseY = 5.5 + Math.sin(p) * 1.5;
    const ghost = (x, y, c, lift) => { if (x < 0 || y < 0 || x >= COLS || y >= HZ) return; const i = x + y * COLS; if (lv[i] < 0.5) set(x, y, c, lv[i] + lift); };
    for (let i = 0; i < L; i++) {
      const x = Math.round(hx + i), y = Math.round(baseY + 2 * Math.sin(i * 0.5 - frame * 0.35));
      ghost(x, y - 1, "░", 0.12); ghost(x, y + 1, "░", 0.12);                 // soft halo
      ghost(x, y, i === 0 ? "▓" : i > L - 4 ? "▒" : "▓", i === 0 ? 0.42 : 0.32);   // head, body, tapering tail
      if (i === 5 || i === 10) { const up = (Math.floor(frame / 6) + (i === 5 ? 0 : 1)) % 2 === 0; ghost(x, y + (up ? -2 : 2), "▒", 0.26); ghost(x + 1, y + (up ? -3 : 3), "░", 0.18); }   // slow wingbeats
    }
    if (hx > -L && hx < COLS) { const x = Math.round(hx), y = Math.round(baseY + 2 * Math.sin(-frame * 0.35)); ghost(x - 1, y - 1, "·", 0.12); }   // a horn
  }
  for (const [sx, sy, b, ph] of stars) if (Math.sin(3 * p + ph) > -0.3) setOv(sx, sy, b > 0.85 ? "*" : "·", b > 0.6 ? 0.9 : 0.6);

  // the sea: rolling swell with aurora light smeared on it
  for (let y = HZ; y < ROWS; y++) {
    const d = (y - HZ) / (ROWS - HZ);
    for (let x = 0; x < COLS; x++) {
      const w2 = fbm(x * 0.06 + 2 * cp, y * 0.5 + 2 * sp, 3, 3);
      const swell = Math.sin(x * 0.12 + y * 0.9 - 3 * p) * 0.15;
      const aur = Math.exp(-(((x - COLS / 2 - sp * COLS * 0.2) / (COLS * 0.3)) ** 2)) * (w2 > 0.55 ? 1 : 0) * (1 - d);
      const v = clamp(0.35 + d * 0.3 + (w2 - 0.5) * 0.7 + swell);
      set(x, y, v > 0.6 ? "▓" : v > 0.35 ? "▒" : "░", 0.1 + v * 0.32);
      if (aur > 0.45) setOv(x, y, "-", 0.6);
    }
  }

  // icebergs: lit from the left, bobbing, with a submerged shelf
  for (const b of bergs) {
    const bob = Math.sin(2 * p + b.ph) * 0.6, drift = Math.sin(p + b.ph) * 3;
    for (let i = 0; i < b.prof.length; i++) {
      const x = Math.round(b.cx + drift) + i - b.W;
      const top = HZ - b.prof[i] + bob;
      const slope = b.prof[Math.min(b.prof.length - 1, i + 1)] - b.prof[Math.max(0, i - 1)];
      for (let y = Math.floor(top); y < HZ; y++) {
        const depthIn = y - top, u = (i - b.W) / b.W;
        const lit = clamp(0.62 - u * 0.4 - depthIn * 0.035 + slope * 0.06 + (noise2(x * 0.4, y * 0.7, 3) - 0.5) * 0.3 + (y === Math.floor(top) ? 0.2 : 0));
        set(x, y, lit > 0.75 ? "█" : lit > 0.45 ? "▓" : "▒", 0.45 + lit * 0.55);
      }
      const shelf = Math.round(b.prof[i] * 0.5);
      for (let y = HZ; y < Math.min(ROWS, HZ + shelf); y++) {
        const wob = Math.sin(y * 2 + 4 * p + x * 0.3) > 0.2;
        set(x + (wob ? 1 : 0), y, wob ? "▒" : "░", y - HZ < 2 ? 0.5 : 0.35);
      }
      if (b.prof[i] > 0) set(x, HZ, "▀", 0.9);
    }
  }
}

// ---------- glyphs as pixel patterns (px, py inside a CW x CH cell) ----------
const cx = CW / 2, cy = CH / 2;
function glyph(c, px, py) {
  switch (c) {
    case "█": return true;
    case "▓": return !((px & 1) && (py & 1));
    case "▒": return ((px + py) & 1) === 0;
    case "░": return (px & 1) === 0 && (py & 1) === 0;
    case "▀": return py < cy;
    case "·": return Math.abs(px - cx + 0.5) <= 1 && Math.abs(py - cy + 0.5) <= 1;
    case "*": { const dx = Math.abs(px - cx + 0.5), dy = Math.abs(py - cy + 0.5); return (dx <= 0.5 && dy <= 2.5) || (dy <= 0.5 && dx <= 2.5); }
    case "-": return Math.abs(py - cy + 0.5) <= 0.5 && px >= 1 && px < CW - 1;
    default: return false;
  }
}

function rasterize() {
  const px = new Uint8Array(W * H);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = ch[x + y * COLS]; if (c === " ") continue;
    const q = Math.max(1, Math.min(LEVELS, Math.round(lv[x + y * COLS] * LEVELS)));
    for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) if (glyph(c, i, j)) px[(x * CW + i) + (y * CH + j) * W] = q;
  }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = ov[x + y * COLS]; if (c === " ") continue;
    const q = Math.max(1, Math.min(LEVELS, Math.round(ovl[x + y * COLS] * LEVELS)));
    for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) if (glyph(c, i, j)) px[(x * CW + i) + (y * CH + j) * W] = q;
  }
  return px;
}

// ---------- GIF (LZW) ----------
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

const parts = [];
const push = (...b) => parts.push(Buffer.from(b));
const u16 = (v) => [v & 255, (v >> 8) & 255];

push(...Buffer.from("GIF89a"));
push(...u16(W), ...u16(H), 0xf2, 0, 0);           // global table of 8 colours
const pal = [BG];
for (let i = 1; i <= LEVELS; i++) pal.push(BG.map((c, k) => Math.round(c + (FG[k] - c) * (i / LEVELS))));
push(...pal.flat());
push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);  // loop forever

const only = process.env.DEBUG_FRAME ? [Number(process.env.DEBUG_FRAME)] : null;   // DEBUG_FRAME=n writes a single still frame
for (const f of only || Array.from({ length: FRAMES }, (_, i) => i)) {
  scene(f);
  const data = lzw(rasterize(), 3);
  push(0x21, 0xf9, 4, 0x04, ...u16(DELAY), 0, 0);
  push(0x2c, ...u16(0), ...u16(0), ...u16(W), ...u16(H), 0, 3);
  for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); parts.push(Buffer.from([chunk.length, ...chunk])); }
  push(0);
  process.stdout.write(`\rframe ${f + 1}/${FRAMES}`);
}
push(0x3b);

mkdirSync(dirname(out), { recursive: true });
const gif = Buffer.concat(parts);
writeFileSync(out, gif);
console.log(`\n${out}  ${W}x${H}  ${(gif.length / 1024).toFixed(0)} KB`);
