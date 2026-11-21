// OSMARA — "The Tidal Sanctuary". v3 travel poster for a place that does
// not exist. Pure Node 22, zero dependencies. Draws the poster with code and
// writes a 1024x1024 PNG to /output/entry.png using its own encoder.
// v3: one monumental backlit hero landmark dead-center (Salt-Glass and Brass
// Tidal Citadel), asymmetric dark framing cliffs, foreground skiff with a
// hatted passenger, sharp mitered Art Deco OSMARA in clean indigo sky.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------------- PNG encoder (own implementation) ----------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------- Deterministic PRNG (seeded, no Math.random) ----------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);

// ---------------- Canvas (2x supersampled, coords in 1024 space) ----------------
const W = 1024, H = 1024, SS = 2, CW = W * SS, CH = H * SS;
const pixels = new Uint8Array(CW * CH * 4);

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}
function px(x, y, r, g, b, a) {
  if (x < 0 || x >= CW || y < 0 || y >= CH || a <= 0) return;
  const i = (y * CW + x) * 4;
  if (a >= 1) { pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255; return; }
  const ia = 1 - a;
  pixels[i] = Math.round(r * a + pixels[i] * ia);
  pixels[i + 1] = Math.round(g * a + pixels[i + 1] * ia);
  pixels[i + 2] = Math.round(b * a + pixels[i + 2] * ia);
  pixels[i + 3] = 255;
}
function fillRect(x, y, w, h, hex, a = 1) {
  const c = rgb(hex);
  const x0 = Math.max(0, Math.floor(x * SS)), x1 = Math.min(CW - 1, Math.ceil((x + w) * SS));
  const y0 = Math.max(0, Math.floor(y * SS)), y1 = Math.min(CH - 1, Math.ceil((y + h) * SS));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) px(xx, yy, c[0], c[1], c[2], a);
}
function vgrad(x, y, w, h, stops) {
  const cols = stops.map(([t, hex]) => [t, rgb(hex)]);
  const x0 = Math.max(0, Math.floor(x * SS)), x1 = Math.min(CW - 1, Math.ceil((x + w) * SS));
  const y0 = Math.max(0, Math.floor(y * SS)), y1 = Math.min(CH - 1, Math.ceil((y + h) * SS));
  for (let yy = y0; yy <= y1; yy++) {
    const t = (yy / SS - y) / h;
    let c;
    if (t <= cols[0][0]) c = cols[0][1];
    else if (t >= cols[cols.length - 1][0]) c = cols[cols.length - 1][1];
    else {
      for (let i = 0; i < cols.length - 1; i++) {
        if (t >= cols[i][0] && t <= cols[i + 1][0]) {
          const f = (t - cols[i][0]) / (cols[i + 1][0] - cols[i][0]);
          c = mix(cols[i][1], cols[i + 1][1], f);
          break;
        }
      }
    }
    for (let xx = x0; xx <= x1; xx++) px(xx, yy, c[0], c[1], c[2], 1);
  }
}
function fillCircle(cx, cy, r, hex, a = 1) {
  const c = rgb(hex);
  const x0 = Math.max(0, Math.floor((cx - r) * SS)), x1 = Math.min(CW - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS)), y1 = Math.min(CW - 1, Math.ceil((cy + r) * SS));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const dx = xx / SS + 0.25 - cx, dy = yy / SS + 0.25 - cy;
    if (dx * dx + dy * dy <= r * r) px(xx, yy, c[0], c[1], c[2], a);
  }
}
function fillEllipse(cx, cy, rx, ry, hex, a = 1) {
  const c = rgb(hex);
  const x0 = Math.max(0, Math.floor((cx - rx) * SS)), x1 = Math.min(CW - 1, Math.ceil((cx + rx) * SS));
  const y0 = Math.max(0, Math.floor((cy - ry) * SS)), y1 = Math.min(CW - 1, Math.ceil((cy + ry) * SS));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const dx = (xx / SS + 0.25 - cx) / rx, dy = (yy / SS + 0.25 - cy) / ry;
    if (dx * dx + dy * dy <= 1) px(xx, yy, c[0], c[1], c[2], a);
  }
}
function fillPoly(points, hex, a = 1) {
  const c = rgb(hex);
  const pts = points.map(([x, y]) => [x * SS, y * SS]);
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(CH - 1, Math.ceil(maxY));
  for (let yy = minY; yy <= maxY; yy++) {
    const yc = yy + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) xs.push(x1 + (yc - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(CW - 1, Math.floor(xs[k + 1]));
      for (let xx = x0; xx <= x1; xx++) px(xx, yy, c[0], c[1], c[2], a);
    }
  }
}
// Sharp miter-join polyline stroke with butt caps (Art Deco, no round joins).
function strokePoly(points, width, hex, a = 1, closed = false) {
  const n = points.length;
  if (n < 2) return;
  const hw = width / 2;
  const segNorm = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    segNorm.push([-dy / len, dx / len]);
  }
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    let nx, ny;
    if (!closed && i === 0) { [nx, ny] = segNorm[0]; }
    else if (!closed && i === n - 1) { [nx, ny] = segNorm[segs - 1]; }
    else {
      const [a1x, a1y] = segNorm[(i - 1 + segs) % segs];
      const [a2x, a2y] = segNorm[i % segs];
      let mx = a1x + a2x, my = a1y + a2y;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml; my /= ml;
      const d = mx * a1x + my * a1y;
      let scale = hw / Math.max(0.45, d);
      scale = Math.min(scale, hw * 2.6);
      nx = mx * scale; ny = my * scale;
      left.push([points[i][0] + nx, points[i][1] + ny]);
      right.push([points[i][0] - nx, points[i][1] - ny]);
      continue;
    }
    left.push([points[i][0] + nx * hw, points[i][1] + ny * hw]);
    right.push([points[i][0] - nx * hw, points[i][1] - ny * hw]);
  }
  fillPoly([...left, ...right.reverse()], hex, a);
}
function glow(cx, cy, r, hex, peak = 0.5) {
  const steps = 14;
  for (let i = steps; i >= 1; i--) {
    const f = i / steps;
    fillCircle(cx, cy, r * f, hex, peak * (1 - f) * (1 - f) * 0.35);
  }
}

// ---------------- Art Deco geometric letterforms (10x18 grid, 1:1.8) ----------------
// Sharp mitered polylines, butt caps. y runs 0 (cap top) to 18 (baseline).
const GLYPHS = {
  O: [[[2, 0], [8, 0], [10, 3], [10, 15], [8, 18], [2, 18], [0, 15], [0, 3], [2, 0]]],
  S: [[[9, 2], [6, 0], [3, 0], [1, 2], [1, 5], [2, 7], [4, 8], [6, 9], [8, 10], [9, 12], [9, 16], [7, 18], [4, 18], [1, 16]]],
  M: [[[0, 18], [0, 0], [5, 10], [10, 0], [10, 18]]],
  A: [[[0, 18], [5, 0], [10, 18]], [[2.6, 13], [7.4, 13]]],
  R: [[[0, 18], [0, 0], [7, 0], [9, 2], [9, 6], [7, 8], [0, 8]], [[5, 8], [10, 18]]],
  T: [[[0, 0], [10, 0]], [[5, 0], [5, 18]]],
  H: [[[0, 0], [0, 18]], [[10, 0], [10, 18]], [[0, 9], [10, 9]]],
  E: [[[10, 0], [0, 0], [0, 18], [10, 18]], [[0, 9], [7, 9]]],
  I: [[[5, 0], [5, 18]], [[2, 0], [8, 0]], [[2, 18], [8, 18]]],
  D: [[[0, 0], [6, 0], [9, 3], [9, 15], [6, 18], [0, 18], [0, 0]]],
  L: [[[0, 0], [0, 18], [9, 18]]],
  N: [[[0, 18], [0, 0], [10, 18], [10, 0]]],
  C: [[[9, 2], [7, 0], [3, 0], [1, 3], [1, 15], [3, 18], [7, 18], [9, 16]]],
  U: [[[0, 0], [0, 14], [2, 18], [8, 18], [10, 14], [10, 0]]],
  Y: [[[0, 0], [5, 9], [10, 0]], [[5, 9], [5, 18]]],
};
function textWidth(text, size, tracking) {
  const adv = size * (10 / 18);
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += adv * 0.5 + tracking;
    else w += adv + tracking;
  }
  return w - tracking;
}
function drawText(text, x, y, size, hex, tracking = 0, strokeUnits = 1.8, a = 1) {
  const s = size / 18;
  const w = strokeUnits * s;
  const adv = size * (10 / 18);
  let cx = x;
  for (const ch of text) {
    if (ch === ' ') { cx += adv * 0.5 + tracking; continue; }
    const glyph = GLYPHS[ch];
    if (!glyph) { cx += adv + tracking; continue; }
    for (const stroke of glyph) {
      const closed = stroke.length > 2 && stroke[0][0] === stroke[stroke.length - 1][0] && stroke[0][1] === stroke[stroke.length - 1][1];
      const use = closed ? stroke.slice(0, -1) : stroke;
      const pts = use.map(([gx, gy]) => [cx + gx * s, y + gy * s]);
      strokePoly(pts, w, hex, a, closed);
    }
    cx += adv + tracking;
  }
}

// ---------------- Palette ----------------
const INDIGO = '#101828';
const VERDIGRIS = '#1E6B7B';
const SEAFOAM = '#6EE7D8';
const ALABASTER = '#F6EEDB';
const APRICOT = '#F29966';
const SAFFRON = '#E8B84B';
const TWILIGHT = '#2B234A';
const GOLD = '#F7C87E';
const PEACH = '#F2C078';
const AMBER = '#D97B3F';
const DARKSTONE = '#1E2436';
const HULL = '#241A33';

// ---------------- Sky ----------------
function drawSky() {
  vgrad(0, 0, 1024, 620, [
    [0, INDIGO], [0.18, TWILIGHT], [0.32, '#5C3A63'], [0.5, '#C96A4E'],
    [0.72, APRICOT], [0.88, GOLD], [1, PEACH],
  ]);
  // Sparse twilight stars, strictly in the dark top band.
  for (let i = 0; i < 40; i++) {
    const x = 10 + rand() * 1004;
    const y = 10 + rand() * 165;
    const r = 0.8 + rand() * 1.3;
    fillCircle(x, y, r, ALABASTER, 0.3 + rand() * 0.45);
  }
}

// ---------------- Backlit sun and halo ----------------
function drawSun() {
  glow(512, 525, 260, GOLD, 0.72);
  glow(512, 525, 150, APRICOT, 0.55);
  fillCircle(512, 525, 92, '#FBE9B8');
  fillCircle(512, 525, 80, ALABASTER);
}

// ---------------- Lagoon water ----------------
function drawWater() {
  vgrad(0, 620, 1024, 330, [
    [0, '#F2B06A'], [0.12, '#C98A5E'], [0.28, '#4E7A72'],
    [0.5, VERDIGRIS], [0.78, '#14324A'], [1, INDIGO],
  ]);
  // Golden shimmer bars under the sun.
  for (let i = 0; i < 24; i++) {
    const y = 628 + i * 12;
    const w = 90 + 46 * Math.sin(i * 0.65) + rand() * 24;
    const a = 0.5 * (1 - i / 24) + 0.05;
    fillRect(512 - w / 2 + (rand() - 0.5) * 18, y, w, 3.5, GOLD, a);
  }
  // Tall tapered bioluminescent seafoam reflection column under the citadel.
  for (let i = 0; i < 20; i++) {
    const y = 722 + i * 11;
    const w = 150 - i * 4.5 + (rand() - 0.5) * 14;
    const a = 0.34 * (1 - i / 20) + 0.04;
    fillRect(512 - w / 2, y, w, 4, SEAFOAM, a);
  }
  // Ripples across the lagoon.
  for (let i = 0; i < 60; i++) {
    const y = 640 + rand() * 290;
    const x = rand() * 940;
    const len = 30 + rand() * 140;
    const col = rand() < 0.6 ? SEAFOAM : GOLD;
    fillRect(x, y, len, 2, col, 0.08 + rand() * 0.18);
  }
  // Dark reflections under the cliffs soften the waterline.
  fillRect(0, 620, 195, 90, INDIGO, 0.3);
  fillRect(850, 620, 174, 90, INDIGO, 0.3);
}

// ---------------- Asymmetric framing cliffs ----------------
function drawCliffs() {
  // Taller dramatic left coastal cliff.
  fillPoly([
    [0, 240], [58, 240], [88, 296], [118, 318], [138, 398], [158, 428],
    [172, 516], [184, 556], [190, 700], [186, 900], [0, 900],
  ], INDIGO);
  // Apricot rim-light on the inner sun-facing contour.
  strokePoly([
    [58, 240], [88, 296], [118, 318], [138, 398], [158, 428],
    [172, 516], [184, 556], [190, 700],
  ], 3, APRICOT, 0.9);
  strokePoly([
    [58, 240], [88, 296], [118, 318], [138, 398], [158, 428],
    [172, 516], [184, 556], [190, 700],
  ], 7, GOLD, 0.25);
  // Lower receding right sea-stack.
  fillPoly([
    [1024, 460], [956, 470], [926, 530], [906, 600], [890, 680],
    [882, 760], [886, 850], [1024, 850],
  ], INDIGO);
  strokePoly([
    [956, 470], [926, 530], [906, 600], [890, 680], [882, 760],
  ], 3, APRICOT, 0.9);
  strokePoly([
    [956, 470], [926, 530], [906, 600], [890, 680], [882, 760],
  ], 7, GOLD, 0.25);
}

// ---------------- Hero landmark: Salt-Glass and Brass Tidal Citadel ----------------
function glassBay(x0, x1, yTop, yBot, glowHex, glowA) {
  // Warm interior glow behind the glass.
  fillRect(x0 + 3, yTop + 16, x1 - x0 - 6, yBot - yTop - 16, glowHex, glowA);
  // Pointed-arch salt-glass bay, semi-transparent pale seafoam.
  const cx = (x0 + x1) / 2;
  fillPoly([
    [x0, yBot], [x0, yTop + 22], [cx, yTop], [x1, yTop + 22], [x1, yBot],
  ], SEAFOAM, 0.42);
  // Cream highlight on the sun-facing facet.
  fillPoly([
    [x0 + 2, yBot], [x0 + 2, yTop + 26], [cx - 6, yTop + 8], [cx - 2, yTop + 24], [cx - 2, yBot],
  ], ALABASTER, 0.22);
  // Crisp brass mullions: pointed-arch outline + center vertical.
  strokePoly([[x0, yBot], [x0, yTop + 22], [cx, yTop], [x1, yTop + 22], [x1, yBot]], 3, SAFFRON, 0.95);
  strokePoly([[cx, yTop + 4], [cx, yBot]], 2, SAFFRON, 0.8);
}
function terraceRing(x0, x1, y) {
  fillRect(x0 - 6, y, x1 - x0 + 12, 4, SAFFRON, 0.95);
  fillRect(x0 - 6, y + 4, x1 - x0 + 12, 2, '#8A6A2A', 0.6);
}
function drawCitadel() {
  // Dark stepped stone plinth rising from the lagoon.
  fillRect(340, 655, 344, 20, DARKSTONE);
  fillRect(325, 675, 374, 20, DARKSTONE);
  fillRect(310, 695, 404, 20, DARKSTONE);
  fillRect(340, 655, 344, 3, '#3A4560', 0.8);
  fillRect(325, 675, 374, 3, '#3A4560', 0.8);
  // Tier 1: four broad glass bays.
  const t1 = [[352, 434], [434, 516], [516, 598], [598, 672]];
  for (const [bx0, bx1] of t1) glassBay(bx0, bx1, 560, 655, AMBER, 0.72);
  terraceRing(346, 678, 556);
  // Tier 2: three bays.
  const t2 = [[392, 466], [466, 558], [558, 632]];
  for (const [bx0, bx1] of t2) glassBay(bx0, bx1, 470, 556, AMBER, 0.68);
  terraceRing(386, 638, 466);
  // Tier 3: two bays.
  const t3 = [[428, 512], [512, 596]];
  for (const [bx0, bx1] of t3) glassBay(bx0, bx1, 395, 466, GOLD, 0.68);
  terraceRing(422, 602, 391);
  // Crown: stepped dome of faceted glass.
  fillRect(448, 370, 128, 21, AMBER, 0.55);
  fillPoly([[448, 391], [448, 378], [468, 370], [556, 370], [576, 378], [576, 391]], SEAFOAM, 0.5);
  strokePoly([[448, 391], [448, 378], [468, 370], [556, 370], [576, 378], [576, 391]], 3, SAFFRON, 0.95);
  fillRect(468, 350, 88, 20, AMBER, 0.55);
  fillPoly([[468, 370], [468, 358], [490, 350], [534, 350], [556, 358], [556, 370]], SEAFOAM, 0.5);
  strokePoly([[468, 370], [468, 358], [490, 350], [534, 350], [556, 358], [556, 370]], 3, SAFFRON, 0.95);
  // Slender brass finial, capped at y 315.
  strokePoly([[512, 350], [512, 318]], 4, SAFFRON, 1);
  fillCircle(512, 316, 5, SAFFRON, 1);
  fillCircle(512, 316, 2.5, GOLD, 1);
  // Tiny glowing deck lanterns on the terraces.
  for (const [lx, ly] of [[360, 552], [512, 552], [664, 552], [400, 462], [624, 462], [512, 387]]) {
    glow(lx, ly, 10, SAFFRON, 0.55);
    fillCircle(lx, ly, 2.5, SAFFRON, 1);
  }
  // Sweeping curved brass skybridge off the right flank toward the water.
  strokePoly([[668, 600], [712, 626], [752, 656], [792, 692]], 3, SAFFRON, 0.9);
  for (const [hx, hy] of [[700, 618], [736, 642], [768, 670]]) {
    strokePoly([[hx, hy], [hx, hy + 14]], 2, SAFFRON, 0.7);
  }
  fillCircle(792, 692, 3, SAFFRON, 1);
}

// ---------------- Waterline contact ripples ----------------
function drawRipples() {
  for (let i = 0; i < 8; i++) {
    const y = 708 + i * 5;
    const w = 380 - i * 22;
    fillRect(512 - w / 2 + (rand() - 0.5) * 10, y, w, 2, SEAFOAM, 0.4 - i * 0.04);
  }
  fillRect(160, 716, 60, 2, GOLD, 0.4);
  fillRect(880, 716, 60, 2, GOLD, 0.4);
}

// ---------------- Foreground skiff and passenger ----------------
function drawSkiff() {
  // Luminous teal wake trailing behind the stern first.
  for (let i = 0; i < 7; i++) {
    const y = 874 + i * 4;
    const len = 110 - i * 10;
    fillRect(163 - len + i * 6, y, len, 3, SEAFOAM, 0.7 - i * 0.08);
  }
  // Dark hull angled diagonally toward the citadel, gold rim on the top edge.
  fillPoly([[171, 862], [367, 828], [375, 846], [187, 884]], HULL);
  fillPoly([[171, 862], [367, 828], [371, 834], [179, 868]], '#3A2A4A');
  strokePoly([[171, 862], [367, 828]], 2, SAFFRON, 0.8);
  // Mast and warm cream crescent sail with saffron rim-light.
  strokePoly([[273, 854], [273, 788]], 4, HULL);
  fillPoly([[273, 788], [307, 806], [333, 822], [347, 840], [273, 854]], ALABASTER);
  strokePoly([[273, 788], [307, 806], [333, 822], [347, 840]], 2, SAFFRON, 0.9);
  fillPoly([[273, 788], [290, 784], [273, 780]], SAFFRON);
  // Two-piece silhouetted passenger with wide-brimmed hat, near the stern.
  fillPoly([[198, 832], [214, 832], [212, 856], [200, 856]], HULL);
  fillCircle(206, 826, 6, HULL);
  fillEllipse(206, 824, 15, 4, HULL);
}

// ---------------- Title OSMARA in pure indigo sky ----------------
function drawTitle() {
  const size = 130;
  const tracking = 40;
  const w = textWidth('OSMARA', size, tracking);
  const x = (1024 - w) / 2;
  const y = 70;
  // Hard saffron offset shadow, then warm alabaster letters on top.
  drawText('OSMARA', x + 4, y + 4, size, SAFFRON, tracking, 1.8);
  drawText('OSMARA', x, y, size, ALABASTER, tracking, 1.8);
}

// ---------------- Bottom banner ----------------
function drawBottomBand() {
  fillRect(0, 950, 1024, 74, INDIGO);
  fillRect(0, 950, 1024, 2, SAFFRON);
  const size = 26;
  const tracking = 8;
  const w = textWidth('THE TIDAL SANCTUARY', size, tracking);
  const x = (1024 - w) / 2;
  drawText('THE TIDAL SANCTUARY', x, 972, size, SAFFRON, tracking, 1.6);
  // Thin brass hairlines flanking the subtitle.
  fillRect(64, 984, x - 64 - 36, 2, SAFFRON, 0.85);
  fillRect(x + w + 36, 984, 1024 - 64 - (x + w + 36), 2, SAFFRON, 0.85);
  fillRect(x - 28, 984, 10, 2, SAFFRON, 0.85);
  fillRect(x + w + 18, 984, 10, 2, SAFFRON, 0.85);
}

// ---------------- Downsample and write ----------------
function downsample() {
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i0 = ((y * SS) * CW + x * SS) * 4;
      const i1 = i0 + 4, i2 = i0 + CW * 4, i3 = i2 + 4;
      const o = (y * W + x) * 4;
      out[o] = (pixels[i0] + pixels[i1] + pixels[i2] + pixels[i3] + 2) >> 2;
      out[o + 1] = (pixels[i0 + 1] + pixels[i1 + 1] + pixels[i2 + 1] + pixels[i3 + 1] + 2) >> 2;
      out[o + 2] = (pixels[i0 + 2] + pixels[i1 + 2] + pixels[i2 + 2] + pixels[i3 + 2] + 2) >> 2;
      out[o + 3] = 255;
    }
  }
  return out;
}

function main() {
  drawSky();
  drawSun();
  drawWater();
  drawCliffs();
  drawCitadel();
  drawRipples();
  drawSkiff();
  drawTitle();
  drawBottomBand();
  const png = encodePng(W, H, downsample());
  const outDir = '/output';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'entry.png'), png);
  console.log('wrote', path.join(outDir, 'entry.png'), png.length, 'bytes');
}

main();
