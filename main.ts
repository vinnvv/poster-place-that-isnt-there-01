// OSMARA — "The Tidal Sanctuary". Revised travel poster for a place that
// does not exist. Pure Node 22, zero dependencies. Draws the poster with
// code and writes a 1024x1024 PNG to /output/entry.png using its own encoder.
// Revision: the dark arch is shrunk to a slim sunlit band, the terraces and
// lagoon fill the frame, glowing salt-glass pavilions and tiered tidal pools
// give Osmara an invented signature, and the name is larger and bolder.
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
  const y0 = Math.max(0, Math.floor((cy - r) * SS)), y1 = Math.min(CH - 1, Math.ceil((cy + r) * SS));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const dx = xx / SS + 0.25 - cx, dy = yy / SS + 0.25 - cy;
    if (dx * dx + dy * dy <= r * r) px(xx, yy, c[0], c[1], c[2], a);
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
function strokePoly(points, width, hex, a = 1) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[i + 1];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * width / 2, ny = dx / len * width / 2;
    fillPoly([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], hex, a);
  }
  for (const [x, y] of points) fillCircle(x, y, width / 2, hex, a);
}
function glow(cx, cy, r, hex, peak = 0.5) {
  const steps = 12;
  for (let i = steps; i >= 1; i--) {
    const f = i / steps;
    fillCircle(cx, cy, r * f, hex, peak * (1 - f) * (1 - f) * 0.4);
  }
}

// ---------------- Geometric letterforms (12x16 grid, stroke polylines) ----------------
const GLYPHS = {
  A: [[[0, 16], [6, 0], [12, 16]], [[3.4, 11], [8.6, 11]]],
  C: [[[11, 2], [8, 0], [4, 0], [1, 3], [1, 13], [4, 16], [8, 16], [11, 14]]],
  D: [[[0, 0], [7, 0], [11, 4], [11, 12], [7, 16], [0, 16], [0, 0]]],
  E: [[[11, 0], [0, 0], [0, 16], [11, 16]], [[0, 8], [8, 8]]],
  H: [[[0, 0], [0, 16]], [[12, 0], [12, 16]], [[0, 8], [12, 8]]],
  I: [[[6, 0], [6, 16]], [[2, 0], [10, 0]], [[2, 16], [10, 16]]],
  L: [[[0, 0], [0, 16], [11, 16]]],
  M: [[[0, 16], [0, 0], [6, 10], [12, 0], [12, 16]]],
  N: [[[0, 16], [0, 0], [12, 16], [12, 0]]],
  O: [[[3, 0], [9, 0], [12, 3], [12, 13], [9, 16], [3, 16], [0, 13], [0, 3], [3, 0]]],
  R: [[[0, 16], [0, 0], [8, 0], [11, 3], [11, 7], [8, 10], [0, 10]], [[6.5, 10], [12, 16]]],
  S: [[[10, 2], [7, 0], [4, 0], [1, 3], [1, 6], [3, 8], [9, 8], [11, 10], [11, 13], [8, 16], [4, 16], [1, 13]]],
  T: [[[0, 0], [12, 0]], [[6, 0], [6, 16]]],
  U: [[[0, 0], [0, 12], [3, 16], [9, 16], [12, 12], [12, 0]]],
  Y: [[[0, 0], [6, 8], [12, 0]], [[6, 8], [6, 16]]],
};
function textWidth(text, size, tracking) {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += size * 0.5 + tracking;
    else w += size * 0.75 + tracking;
  }
  return w - tracking;
}
function drawText(text, x, y, size, hex, tracking = 0, strokeUnits = 3, a = 1) {
  const s = size / 16;
  const w = strokeUnits * s;
  let cx = x;
  for (const ch of text) {
    if (ch === ' ') { cx += size * 0.5 + tracking; continue; }
    const glyph = GLYPHS[ch];
    if (!glyph) { cx += size * 0.75 + tracking; continue; }
    for (const stroke of glyph) {
      const pts = stroke.map(([gx, gy]) => [cx + gx * s, y + gy * s]);
      strokePoly(pts, w, hex, a);
    }
    cx += size * 0.75 + tracking;
  }
}

// ---------------- Palette ----------------
const INDIGO = '#101828';
const VERDIGRIS = '#1E6B7B';
const SEAFOAM = '#6EE7D8';
const ALABASTER = '#F6EEDB';
const APRICOT = '#F29966';
const SAFFRON = '#E8B84B';
const VIOLET = '#2E2450';
const GOLD = '#F7C87E';
const SAND = '#D9B48A';
const TERRA = '#A06A48';
const CREAM = '#F6EBD8';
const DEEPTEAL = '#14324A';

// ---------------- Sky ----------------
function drawSky() {
  vgrad(0, 0, 1024, 600, [
    [0, VIOLET], [0.22, '#5C3A63'], [0.45, '#C96A4E'],
    [0.7, APRICOT], [0.88, GOLD], [1, '#F2C078'],
  ]);
  // Stars only in the top band, above the title.
  for (let i = 0; i < 46; i++) {
    const x = 8 + rand() * 1008;
    const y = 8 + rand() * 96;
    const r = 0.8 + rand() * 1.4;
    fillCircle(x, y, r, ALABASTER, 0.35 + rand() * 0.5);
  }
  // A few birds crossing the open sky.
  for (const [bx, by, bs] of [[300, 340, 1], [360, 372, 0.8], [700, 330, 1], [760, 366, 0.7], [520, 410, 0.9]]) {
    strokePoly([[bx - 9 * bs, by], [bx, by - 6 * bs], [bx + 9 * bs, by]], 3, '#241A44', 0.7);
  }
  // Low mist band softening the horizon.
  fillRect(0, 556, 1024, 44, '#F2C078', 0.16);
  fillRect(0, 582, 1024, 22, ALABASTER, 0.10);
}

// ---------------- Sun ----------------
function drawSun() {
  glow(640, 545, 175, GOLD, 0.55);
  fillCircle(640, 545, 52, '#F7C87E');
  fillCircle(640, 545, 40, '#FBE9B8');
}

// ---------------- Lagoon water ----------------
function drawWater() {
  vgrad(0, 600, 1024, 350, [
    [0, '#F2B06A'], [0.15, '#C98A5E'], [0.3, '#4E7A72'],
    [0.5, VERDIGRIS], [0.75, DEEPTEAL], [1, INDIGO],
  ]);
  // A low distant headland silhouette on the horizon, left of the sun.
  fillPoly([[300, 600], [360, 576], [430, 584], [480, 600]], '#3A2A44', 0.85);
  // Sun reflection: a shimmering gold column under the sun.
  for (let i = 0; i < 26; i++) {
    const y = 610 + i * 11;
    const w = 72 + 42 * Math.sin(i * 0.7) + rand() * 22;
    const a = 0.55 * (1 - i / 26) + 0.06;
    fillRect(640 - w / 2 + (rand() - 0.5) * 16, y, w, 3.5, GOLD, a);
  }
  // Ripples across the lagoon.
  for (let i = 0; i < 70; i++) {
    const y = 615 + rand() * 325;
    const x = rand() * 940;
    const len = 30 + rand() * 150;
    const col = rand() < 0.6 ? SEAFOAM : GOLD;
    fillRect(x, y, len, 2, col, 0.10 + rand() * 0.20);
  }
  // Dark reflections under the cliffs soften the waterline.
  fillRect(0, 600, 185, 96, INDIGO, 0.30);
  fillRect(839, 600, 185, 96, INDIGO, 0.30);
  // Bioluminescent shallows near the pavilions.
  glow(180, 892, 120, SEAFOAM, 0.30);
  glow(862, 872, 100, SEAFOAM, 0.28);
  // Seafoam sparkles in the twilight shallows.
  for (let i = 0; i < 42; i++) {
    const x = 220 + rand() * 600;
    const y = 800 + rand() * 140;
    fillCircle(x, y, 1 + rand() * 1.2, SEAFOAM, 0.35 + rand() * 0.45);
  }
}

// ---------------- Slim sunlit arch (top band, no longer swallowing the frame) ----------------
function archCurveY(x) {
  return 34 + 62 * Math.sin((Math.PI * x) / 1024);
}
function drawArch() {
  const pts = [[0, 0], [1024, 0], [1024, 34]];
  for (let x = 1024; x >= 0; x -= 32) pts.push([x, archCurveY(x)]);
  pts.push([0, 34]);
  fillPoly(pts, '#E8D9B8');
  // Stone shading along the inner edge and a saffron rim line.
  const curve = [];
  for (let x = 0; x <= 1024; x += 32) curve.push([x, archCurveY(x)]);
  strokePoly(curve, 12, TERRA, 0.22);
  strokePoly(curve, 3, SAFFRON, 0.85);
  // Stone seams across the band.
  for (const x of [128, 256, 384, 640, 768, 896]) {
    fillRect(x, 0, 2, archCurveY(x), TERRA, 0.18);
  }
}

// ---------------- Cliffs with terraces (sunlit limestone, mirrorable) ----------------
function dome(cx, baseY, r, hex) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI - (Math.PI * i) / 10;
    pts.push([cx + r * Math.cos(a), baseY - r * Math.sin(a)]);
  }
  pts.push([cx + r, baseY], [cx - r, baseY]);
  fillPoly(pts, hex);
}
function terraceBuilding(x, baseY, w, h, withDome) {
  fillRect(x, baseY - h, w, h, CREAM);
  fillRect(x, baseY - h, w, 4, '#FFFFFF', 0.5);
  // Arched window.
  fillRect(x + w * 0.38, baseY - h * 0.72, w * 0.24, h * 0.42, '#2A2438');
  fillCircle(x + w * 0.5, baseY - h * 0.72, w * 0.12, '#2A2438');
  // Warm window light.
  fillRect(x + w * 0.44, baseY - h * 0.60, w * 0.12, h * 0.18, SAFFRON, 0.85);
  if (withDome) {
    dome(x + w * 0.5, baseY - h, w * 0.34, VERDIGRIS);
    fillCircle(x + w * 0.5, baseY - h - w * 0.34, 2.5, SAFFRON);
  }
}
function lantern(x, y) {
  glow(x, y, 14, SAFFRON, 0.5);
  fillCircle(x, y, 3.2, SAFFRON);
}
function drawCliff(mirror) {
  const mx = (x) => (mirror ? 1024 - x : x);
  // Stepped cliff face, sunlit limestone.
  const face = [
    [0, 140], [80, 140], [80, 210], [120, 210], [120, 290], [155, 290],
    [155, 380], [185, 380], [185, 470], [210, 470], [210, 620], [0, 620],
  ].map(([x, y]) => [mx(x), y]);
  fillPoly(face, SAND);
  // Warm shadow on the inner edge, highlight on the terrace tops.
  const shade = [
    [175, 470], [210, 470], [210, 620], [0, 620], [0, 600], [175, 600],
  ].map(([x, y]) => [mx(x), y]);
  fillPoly(shade, TERRA, 0.28);
  for (const [sx, sy, ex] of [[0, 140, 80], [0, 210, 120], [0, 290, 155], [0, 380, 185], [0, 470, 210]]) {
    fillRect(Math.min(mx(sx), mx(ex)), sy, Math.abs(ex - sx), 3, ALABASTER, 0.55);
  }
  // Terrace buildings, one per step.
  const buildings = [
    [10, 210, 62, 52, true],
    [46, 290, 68, 58, true],
    [80, 380, 72, 62, true],
    [112, 470, 76, 68, true],
  ];
  for (const [bx, by, bw, bh, dm] of buildings) {
    const x0 = mirror ? 1024 - bx - bw : bx;
    terraceBuilding(x0, by, bw, bh, dm);
  }
  // Hanging walkways with lanterns between terraces.
  const walks = [
    [[72, 202], [122, 282]],
    [[118, 372], [172, 462]],
  ];
  for (const [p1, p2] of walks) {
    const a = [mx(p1[0]), p1[1]], b = [mx(p2[0]), p2[1]];
    strokePoly([a, b], 2.5, SAFFRON, 0.8);
    lantern((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 4);
  }
  lantern(mx(36), 196);
  lantern(mx(176), 456);
  lantern(mx(60), 286);
  lantern(mx(140), 376);
  // Tiered tidal pools stepped into the cliff, glowing seafoam.
  const pools = [[64, 282, 52, 10], [88, 372, 56, 10], [112, 462, 66, 10]];
  for (const [px0, py0, pw, ph] of pools) {
    const x0 = mirror ? 1024 - px0 - pw : px0;
    fillRect(x0, py0, pw, ph, SEAFOAM, 0.9);
    fillRect(x0, py0, pw, 2, '#DFFCF5', 0.9);
  }
}

// ---------------- Salt-glass pavilions (the invented signature) ----------------
function glassPavilion(x, baseY, w, h) {
  // Stone base.
  fillRect(x, baseY - 8, w, 8, '#2A2438');
  // Translucent glass walls, seafoam, with a warm interior glow.
  glow(x + w / 2, baseY - h * 0.55, w * 0.7, SAFFRON, 0.35);
  fillPoly([[x, baseY - 8], [x, baseY - h * 0.72], [x + w / 2, baseY - h], [x + w, baseY - h * 0.72], [x + w, baseY - 8]], SEAFOAM, 0.42);
  // Faceted roof ridge and glass edges.
  strokePoly([[x, baseY - h * 0.72], [x + w / 2, baseY - h], [x + w, baseY - h * 0.72]], 3, '#DFFCF5', 0.9);
  strokePoly([[x, baseY - 8], [x, baseY - h * 0.72]], 3, '#DFFCF5', 0.8);
  strokePoly([[x + w, baseY - 8], [x + w, baseY - h * 0.72]], 3, '#DFFCF5', 0.8);
  // Warm interior mullions.
  fillRect(x + w * 0.30, baseY - h * 0.66, 3, h * 0.58, SAFFRON, 0.75);
  fillRect(x + w * 0.66, baseY - h * 0.66, 3, h * 0.58, SAFFRON, 0.75);
  fillRect(x + w * 0.12, baseY - h * 0.40, w * 0.76, 3, SAFFRON, 0.6);
}
function drawPavilions() {
  // Left quay with two glass pavilions.
  fillRect(16, 884, 300, 46, '#2A2438');
  fillRect(16, 884, 300, 3, ALABASTER, 0.3);
  glassPavilion(64, 884, 92, 118);
  glassPavilion(168, 884, 68, 84);
  // Right quay with one pavilion.
  fillRect(724, 872, 260, 46, '#2A2438');
  fillRect(724, 872, 260, 3, ALABASTER, 0.3);
  glassPavilion(788, 872, 104, 128);
  // Small quay lanterns.
  lantern(28, 878);
  lantern(304, 878);
  lantern(736, 866);
  lantern(972, 866);
}

// ---------------- Skiffs ----------------
function drawSkiffs() {
  // Foreground crescent-sailed skiff in open water, sailing toward the arch.
  fillPoly([[300, 830], [380, 830], [370, 848], [312, 848]], '#3A2A20');
  strokePoly([[340, 830], [340, 762]], 4, '#3A2A20');
  fillPoly([[340, 762], [384, 822], [340, 822]], ALABASTER);
  strokePoly([[340, 762], [384, 822]], 2, SAFFRON, 0.9);
  fillPoly([[340, 762], [356, 756], [340, 750]], SAFFRON);
  // Luminous wake cutting across the water toward the viewer.
  for (let i = 0; i < 6; i++) {
    const y = 852 + i * 12;
    const len = 96 - i * 10;
    fillRect(288 - i * 8, y, len, 3, SEAFOAM, 0.75 - i * 0.09);
  }
  // Two tiny distant skiffs near the horizon.
  for (const [sx, sy, s] of [[790, 618, 1], [884, 624, 0.8]]) {
    fillRect(sx - 11 * s, sy, 22 * s, 4, '#241A33');
    fillPoly([[sx, sy], [sx, sy - 13 * s], [sx + 11 * s, sy]], ALABASTER, 0.85);
  }
}

// ---------------- Title and subtitle band ----------------
function drawTitle() {
  const size = 152;
  const tracking = 28;
  const w = textWidth('OSMARA', size, tracking);
  const x = (1024 - w) / 2;
  const y = 138;
  // Saffron edge shadow, then the alabaster letters on top.
  drawText('OSMARA', x + 6, y + 7, size, SAFFRON, tracking, 3.2);
  drawText('OSMARA', x, y, size, ALABASTER, tracking, 3.2);
}
function drawBottomBand() {
  fillRect(0, 950, 1024, 74, INDIGO);
  fillRect(0, 947, 1024, 4, SAFFRON);
  const size = 26;
  const tracking = 7;
  const w = textWidth('THE TIDAL SANCTUARY', size, tracking);
  const x = (1024 - w) / 2;
  drawText('THE TIDAL SANCTUARY', x, 972, size, ALABASTER, tracking, 2.6);
  // Saffron diamonds flanking the subtitle.
  const d1 = x - 38, d2 = x + w + 38, cy = 985;
  fillPoly([[d1, cy - 8], [d1 + 8, cy], [d1, cy + 8], [d1 - 8, cy]], SAFFRON);
  fillPoly([[d2, cy - 8], [d2 + 8, cy], [d2, cy + 8], [d2 - 8, cy]], SAFFRON);
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
  drawArch();
  drawCliff(false);
  drawCliff(true);
  drawPavilions();
  drawSkiffs();
  drawTitle();
  drawBottomBand();
  const png = encodePng(W, H, downsample());
  const outDir = '/output';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'entry.png'), png);
  console.log('wrote', path.join(outDir, 'entry.png'), png.length, 'bytes');
}

main();
