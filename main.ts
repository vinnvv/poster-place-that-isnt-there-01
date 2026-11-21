// OSMARA — The Tidal Sanctuary
// A travel poster for a place that does not exist.
// Pure Node, zero dependencies, no network. Renders a 1024x1024 PNG to /output/entry.png
// with a hand-written rasterizer and a hand-written PNG encoder.
// Deterministic: every value is fixed or comes from a seeded PRNG.

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------- palette
const INDIGO = [16, 24, 40];       // Abyssal Indigo  #101828
const INDIGO2 = [22, 30, 51];      // deep cliff shadow
const VERDIGRIS = [30, 107, 123];  // Tidal Verdigris #1E6B7B
const SEAFOAM = [110, 231, 216];   // Luminous Seafoam #6EE7D8
const ALABASTER = [246, 238, 219]; // Warm Alabaster  #F6EEDB
const APRICOT = [242, 153, 102];   // Apricot Dusk    #F29966
const SAFFRON = [232, 184, 75];    // Burnished Saffron #E8B84B
const GOLD = [246, 196, 83];
const DARKWOOD = [36, 26, 18];

// ---------------------------------------------------------------- canvas (rendered at 2x, downsampled for crisp edges)
const SS = 2;
const W = 1024, H = 1024;
const DW = W * SS, DH = H * SS;
const buf = new Uint8Array(DW * DH * 3);

// Seeded PRNG (deterministic)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);

// ---------------------------------------------------------------- low-level pixel ops (device coords)
function mixPixel(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= DW || y >= DH) return;
  const i = (y * DW + x) * 3;
  if (a >= 1) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; return; }
  buf[i] = Math.round(buf[i] * (1 - a) + r * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + g * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + b * a);
}
function addPixel(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= DW || y >= DH || a <= 0) return;
  const i = (y * DW + x) * 3;
  buf[i] = Math.min(255, buf[i] + r * a);
  buf[i + 1] = Math.min(255, buf[i + 1] + g * a);
  buf[i + 2] = Math.min(255, buf[i + 2] + b * a);
}
// logical (1024-space) -> device
const D = (v) => Math.round(v * SS);

// Fill a horizontal span on one device row
function span(y, x0, x1, r, g, b, a) {
  if (y < 0 || y >= DH) return;
  let xa = Math.max(0, Math.ceil(x0)), xb = Math.min(DW - 1, Math.floor(x1));
  if (xb < xa) return;
  const row = y * DW * 3;
  for (let x = xa; x <= xb; x++) {
    const i = row + x * 3;
    if (a >= 1) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; }
    else {
      buf[i] = Math.round(buf[i] * (1 - a) + r * a);
      buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + g * a);
      buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + b * a);
    }
  }
}

// Scanline polygon fill. contours: array of point arrays [[x,y],...] in device coords.
// Even-odd rule, so a contour inside another cuts a hole (used for the O ring, crescent).
function fillPoly(contours, rgb, a = 1) {
  const [r, g, b] = rgb;
  let minY = Infinity, maxY = -Infinity;
  for (const c of contours) for (const p of c) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const y0 = Math.max(0, Math.ceil(minY - 0.5)), y1 = Math.min(DH - 1, Math.floor(maxY - 0.5));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (const c of contours) {
      for (let k = 0; k < c.length; k++) {
        const p0 = c[k], p1 = c[(k + 1) % c.length];
        if ((p0[1] <= yc && p1[1] > yc) || (p1[1] <= yc && p0[1] > yc)) {
          xs.push(p0[0] + (yc - p0[1]) * (p1[0] - p0[0]) / (p1[1] - p0[1]));
        }
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) span(y, xs[k], xs[k + 1], r, g, b, a);
  }
}

// Filled disc (device coords)
function disc(cx, cy, rad, rgb, a = 1) {
  const [r, g, b] = rgb;
  const r0 = Math.max(1, Math.ceil(rad));
  for (let dy = -r0; dy <= r0; dy++) {
    const dx = Math.sqrt(Math.max(0, rad * rad - dy * dy));
    span(Math.round(cy) + dy, cx - dx, cx + dx, r, g, b, a);
  }
}

// Soft radial glow, additive
function glow(cx, cy, rad, rgb, strength) {
  const [r, g, b] = rgb;
  const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(DW - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(DH - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / rad;
      if (d >= 1) continue;
      const t = (1 - d) * (1 - d) * strength;
      addPixel(x, y, r, g, b, t);
    }
  }
}

// Thick polyline with round joins and caps. pts in logical coords.
function strokePath(pts, width, rgb, closed = false, a = 1) {
  const w = width * SS / 2;
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const p0 = pts[k], p1 = pts[(k + 1) % n];
    const dx = (p1[0] - p0[0]) * SS, dy = (p1[1] - p0[1]) * SS;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) continue;
    const nx = -dy / len * w, ny = dx / len * w;
    const x0 = p0[0] * SS, y0 = p0[1] * SS, x1 = p1[0] * SS, y1 = p1[1] * SS;
    fillPoly([[[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]], rgb, a);
  }
  for (let k = 0; k < n; k++) {
    if (!closed && (k === 0 || k === n - 1)) disc(pts[k][0] * SS, pts[k][1] * SS, w, rgb, a);
    else disc(pts[k][0] * SS, pts[k][1] * SS, w, rgb, a);
  }
}

// Vertical gradient over a logical rect. stops: [[pos0..1, [r,g,b]], ...]
function vgrad(x0, x1, y0, y1, stops) {
  const xa = D(x0), xb = D(x1);
  for (let y = D(y0); y < D(y1); y++) {
    const t = (y / SS - y0) / (y1 - y0);
    let s0 = stops[0], s1 = stops[stops.length - 1];
    for (let k = 0; k + 1 < stops.length; k++) {
      if (t >= stops[k][0] && t <= stops[k + 1][0]) { s0 = stops[k]; s1 = stops[k + 1]; break; }
    }
    const f = s1[0] === s0[0] ? 0 : (t - s0[0]) / (s1[0] - s0[0]);
    const r = Math.round(s0[1][0] + (s1[1][0] - s0[1][0]) * f);
    const g = Math.round(s0[1][1] + (s1[1][1] - s0[1][1]) * f);
    const b = Math.round(s0[1][2] + (s1[1][2] - s0[1][2]) * f);
    span(y, xa, xb, r, g, b, 1);
  }
}

function rect(x0, y0, x1, y1, rgb, a = 1) {
  for (let y = D(y0); y < D(y1); y++) span(y, D(x0), D(x1), rgb[0], rgb[1], rgb[2], a);
}

// Ellipse outline points (logical coords)
function ellipsePts(cx, cy, rx, ry, a0, a1, steps) {
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const t = a0 + (a1 - a0) * k / steps;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}

// ---------------------------------------------------------------- scene
const HORIZON = 640;

// 1. Sky: deep indigo at top, apricot dusk at the horizon
vgrad(0, W, 0, HORIZON, [
  [0.00, [18, 24, 46]],
  [0.38, [58, 52, 84]],
  [0.62, [146, 90, 96]],
  [0.85, [240, 148, 96]],
  [1.00, [250, 190, 120]],
]);

// 2. Sun, low and warm, just right of centre
glow(640 * SS, 585 * SS, 210 * SS, APRICOT, 0.55);
glow(640 * SS, 585 * SS, 110 * SS, GOLD, 0.6);
disc(640 * SS, 585 * SS, 42 * SS, [250, 205, 118]);

// 3. Stars in the upper opening (above the title)
for (let k = 0; k < 26; k++) {
  const x = 250 + rand() * 524, y = 232 + rand() * 105;
  const r = 0.8 + rand() * 1.6;
  disc(x * SS, y * SS, r * SS, ALABASTER, 0.35 + rand() * 0.5);
  if (rand() < 0.25) glow(x * SS, y * SS, 7 * SS, ALABASTER, 0.25);
}

// 4. Distant headland ridge, right of centre, softened by mist
fillPoly([[[700, 646], [820, 616], [905, 630], [965, 620], [965, 650], [700, 650]].map(p => [D(p[0]), D(p[1])])], [27, 42, 69]);
disc(D(838), D(620), D(10), [27, 42, 69]); // tiny dome on the ridge

// 5. Horizon mist bands
for (let k = 0; k < 26; k++) {
  const y = 600 + k;
  const a = 0.30 * Math.sin(Math.PI * k / 26);
  rect(60, y, 964, y + 1, [247, 193, 143], a);
}

// 6. Lagoon: warm near the horizon, deep indigo below (the split-time water)
vgrad(0, W, HORIZON, H, [
  [0.00, [122, 90, 82]],
  [0.10, [46, 96, 104]],
  [0.35, [24, 72, 88]],
  [0.70, [16, 44, 66]],
  [1.00, [9, 18, 34]],
]);

// Sun shimmer column on the water
for (let k = 0; k < 46; k++) {
  const y = 652 + rand() * 230;
  const wHalf = 8 + rand() * 42 * (1 - (y - 652) / 260);
  const cx = 640 + (rand() - 0.5) * wHalf * 2;
  rect(cx - wHalf, y, cx + wHalf, y + 2.2, GOLD, 0.16 + rand() * 0.22);
}

// 7. The Great Arch: one big polygon, outer edge over the top, inner opening
const archOuter = [[0, H], [0, 358]]
  .concat(ellipsePts(512, 790, 640, 720, Math.PI, 2 * Math.PI, 48))
  .concat([[W, 358], [W, H]]);
const archInner = ellipsePts(512, 800, 470, 580, 2 * Math.PI, Math.PI, 48)
  .concat([[79, H], [0, H]]);
const archPoly = archOuter.concat(archInner);
fillPoly([archPoly.map(p => [D(p[0]), D(p[1])])], INDIGO);

// Inner rim light: saffron line tracing the inner curve, alabaster line just inside it
const rim = ellipsePts(512, 800, 470, 580, Math.PI * 1.02, Math.PI * 1.98, 60);
strokePath(rim, 5, SAFFRON, false, 0.85);
const rim2 = ellipsePts(512, 800, 462, 572, Math.PI * 1.04, Math.PI * 1.96, 60);
strokePath(rim2, 2, ALABASTER, false, 0.5);

// 8. Terraced pavilions on the inner curve (left and right), with domes and lanterns
function terrace(thetaDeg, flip) {
  const t = thetaDeg * Math.PI / 180;
  const cx = 512 + 470 * Math.cos(t), cy = 800 + 580 * Math.sin(t);
  const dir = flip ? -1 : 1;
  // stepped platform, jutting toward the centre
  const px0 = cx, px1 = cx + dir * 118;
  rect(Math.min(px0, px1), cy - 4, Math.max(px0, px1), cy + 6, ALABASTER, 0.96);
  rect(Math.min(px0, px1) + (flip ? 14 : 0), cy + 6, Math.max(px0, px1) - (flip ? 0 : 14), cy + 12, [214, 200, 170], 0.9);
  // small pavilion: rect + verdigris dome
  const domex = cx + dir * 34;
  rect(domex - 16, cy - 26, domex + 16, cy - 4, ALABASTER, 0.96);
  fillPoly([ellipsePts(domex, cy - 26, 17, 15, Math.PI, 2 * Math.PI, 16).map(p => [D(p[0]), D(p[1])])], VERDIGRIS);
  disc(D(domex), D(cy - 27), D(2.5), SAFFRON);
  // lanterns strung along the platform
  for (let k = 0; k < 3; k++) {
    const lx = cx + dir * (22 + k * 32), ly = cy - 12 - (k % 2) * 4;
    disc(D(lx), D(ly), D(3.2), SAFFRON);
    glow(lx * SS, ly * SS, 11 * SS, SAFFRON, 0.5);
  }
}
terrace(207, false); terrace(222, false); terrace(238, false);
terrace(333, true); terrace(318, true); terrace(302, true);

// 9. Hanging skybridges across the opening, lanterns strung along the sag
function bridge(yL, yR, sag) {
  const pts = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    pts.push([185 + (839 - 185) * t, yL + (yR - yL) * t + sag * Math.sin(Math.PI * t)]);
  }
  strokePath(pts, 3, SAFFRON, false, 0.9);
  for (let k = 2; k < 24; k += 3) {
    const p = pts[k];
    disc(D(p[0]), D(p[1] + 5), D(2.6), SAFFRON);
    glow(p[0] * SS, (p[1] + 5) * SS, 8 * SS, SAFFRON, 0.45);
  }
}
bridge(498, 492, 34);
bridge(566, 572, 26);

// 10. Water reflections of the arch pillars: dark streaks with seafoam edges
for (const [x0, x1] of [[36, 96], [928, 988]]) {
  fillPoly([[[x0, HORIZON], [x1, HORIZON], [x1 - 14, 830], [x0 + 14, 830]].map(p => [D(p[0]), D(p[1])])], [13, 20, 36], 0.85);
  strokePath([[x0 + 8, HORIZON + 6], [x0 + 18, 820]], 2, SEAFOAM, false, 0.35);
}
// Bioluminescent ripples across the lagoon
for (let k = 0; k < 34; k++) {
  const y = 668 + rand() * 330;
  const x = 90 + rand() * 844;
  const len = 26 + rand() * 90;
  rect(x, y, x + len, y + 1.8, SEAFOAM, 0.10 + rand() * 0.22);
}
// Soft seafoam glow pooling low in the water
glow(512 * SS, 940 * SS, 300 * SS, SEAFOAM, 0.10);

// 11. Distant skiff near the horizon, sailing toward the arch
(function distantSkiff() {
  const x = 712, y = 664;
  strokePath([[x - 16, y], [x + 16, y], [x + 11, y + 6], [x - 11, y + 6]], 2, [20, 28, 44]);
  fillPoly([[[x, y - 16], [x + 12, y - 1], [x, y - 1]].map(p => [D(p[0]), D(p[1])])], APRICOT, 0.9);
})();

// 12. Foreground skiff, lower left, crescent sail, luminous wake
(function skiff() {
  // wake: bright streaks trailing toward the arch (bottom right)
  const wake = [
    [[268, 936], [430, 968], [428, 976], [266, 944]],
    [[252, 946], [380, 992], [376, 1000], [248, 952]],
    [[282, 928], [470, 946], [470, 952], [284, 936]],
  ];
  for (const w of wake) fillPoly([w.map(p => [D(p[0]), D(p[1])])], SEAFOAM, 0.55);
  glow(300 * SS, 950 * SS, 60 * SS, SEAFOAM, 0.35);
  // hull
  fillPoly([[[148, 902], [292, 902], [272, 928], [172, 928]].map(p => [D(p[0]), D(p[1])])], DARKWOOD);
  strokePath([[148, 902], [292, 902]], 2.5, ALABASTER, false, 0.7);
  // mast
  strokePath([[220, 902], [220, 796]], 3.5, DARKWOOD);
  // crescent sail: ONE closed contour — outer arc down, inner arc back up
  const outer = ellipsePts(196, 852, 66, 62, -1.35, 1.15, 22);
  const inner = ellipsePts(232, 852, 58, 58, 1.15, -1.35, 22);
  const crescent = outer.concat(inner);
  fillPoly([crescent.map(p => [D(p[0]), D(p[1])])], SAFFRON);
  strokePath(ellipsePts(196, 852, 66, 62, -1.35, 1.15, 22), 2, ALABASTER, false, 0.6);
  // small sailor silhouette
  disc(D(238), D(890), D(5), DARKWOOD);
  fillPoly([[[232, 896], [244, 896], [242, 902], [234, 902]].map(p => [D(p[0]), D(p[1])])], DARKWOOD);
})();

// ---------------------------------------------------------------- typography
// Title letters drawn as thick geometric strokes (Art Deco / carved stone).
// Each letter is defined in unit space: u 0..1 across its width, v 0..1 down the cap height.
const TITLE = {
  O: { w: 0.80, strokes: [ellipsePts(0.5, 0.5, 0.36, 0.47, 0, Math.PI * 2, 26)] },
  S: { w: 0.62, strokes: [[
    [0.74, 0.03], [0.52, 0.00], [0.30, 0.05], [0.16, 0.15], [0.13, 0.28],
    [0.20, 0.40], [0.36, 0.48], [0.55, 0.52], [0.72, 0.58], [0.84, 0.70],
    [0.82, 0.84], [0.68, 0.94], [0.46, 0.98], [0.26, 0.94],
  ]] },
  M: { w: 0.92, strokes: [[[0.04, 1.0], [0.04, 0.0], [0.5, 0.60], [0.96, 0.0], [0.96, 1.0]]] },
  A: { w: 0.82, strokes: [
    [[0.06, 1.0], [0.5, 0.0], [0.94, 1.0]],
    [[0.30, 0.64], [0.70, 0.64]],
  ] },
  R: { w: 0.72, strokes: [
    [[0.07, 0.0], [0.07, 1.0]],
    [[0.07, 0.02], [0.35, 0.0], [0.62, 0.04], [0.80, 0.14], [0.84, 0.26], [0.76, 0.40], [0.58, 0.48], [0.30, 0.50], [0.07, 0.50]],
    [[0.45, 0.46], [0.70, 0.72], [0.92, 1.0]],
  ] },
};

function drawTitleLetter(ch, x0, y0, capH, rgb, dx = 0, dy = 0) {
  const def = TITLE[ch];
  const sw = capH * 0.165;
  for (const s of def.strokes) {
    const pts = s.map(p => [x0 + dx + p[0] * def.w * capH, y0 + dy + p[1] * capH]);
    const closed = ch === "O";
    strokePath(pts, sw, rgb, closed);
  }
  return def.w * capH;
}

const titleWord = "OSMARA";
const capH = 108;
const gap = 15;
let titleW = 0;
for (const ch of titleWord) titleW += TITLE[ch].w * capH;
titleW += gap * (titleWord.length - 1);
let tx = (W - titleW) / 2;
const ty = 348;
// warm saffron edge, offset down-right, then alabaster face
let cx = tx;
for (const ch of titleWord) { cx += drawTitleLetter(ch, cx, ty, capH, SAFFRON, 4, 5) + gap; }
cx = tx;
for (const ch of titleWord) { cx += drawTitleLetter(ch, cx, ty, capH, ALABASTER) + gap; }

// Subtitle: small tracked capitals from a 3x5 grid stroke font
const FONT = {
  T: [[[0, 0], [2, 0]], [[1, 0], [1, 4]]],
  H: [[[0, 0], [0, 4]], [[2, 0], [2, 4]], [[0, 2], [2, 2]]],
  E: [[[0, 0], [0, 4]], [[0, 0], [2, 0]], [[0, 2], [1.7, 2]], [[0, 4], [2, 4]]],
  I: [[[0, 0], [2, 0]], [[0, 4], [2, 4]], [[1, 0], [1, 4]]],
  D: [[[0, 0], [0, 4]], [[0, 0], [1.4, 0]], [[1.4, 0], [2, 1]], [[2, 1], [2, 3]], [[2, 3], [1.4, 4]], [[1.4, 4], [0, 4]]],
  A: [[[0, 4], [1, 0], [2, 4]], [[0.5, 2.6], [1.5, 2.6]]],
  L: [[[0, 0], [0, 4]], [[0, 4], [2, 4]]],
  S: [[[1.8, 0.3], [1, 0], [0.3, 0.5], [0.2, 1.4], [0.8, 2], [1.5, 2.2], [1.9, 3], [1.6, 3.8], [0.8, 4], [0.2, 3.7]]],
  N: [[[0, 4], [0, 0], [2, 4], [2, 0]]],
  C: [[[1.8, 0.5], [1, 0], [0.2, 0.8], [0, 2], [0.2, 3.2], [1, 4], [1.8, 3.5]]],
  U: [[[0, 0], [0, 3.2], [0.5, 4], [1.5, 4], [2, 3.2], [2, 0]]],
  R: [[[0, 0], [0, 4]], [[0, 0], [1.5, 0], [2, 1], [1.5, 2], [0, 2]], [[1, 2], [2, 4]]],
  Y: [[[0, 0], [1, 2], [2, 0]], [[1, 2], [1, 4]]],
};
function drawSmall(ch, x0, y0, h, rgb) {
  const unit = h / 4;
  for (const s of FONT[ch]) {
    strokePath(s.map(p => [x0 + p[0] * unit, y0 + p[1] * unit]), h * 0.16, rgb);
  }
}
const subtitle = "THE TIDAL SANCTUARY";
const subH = 20, subAdv = 15, subTrack = 11;
let subW = 0;
for (const ch of subtitle) subW += ch === " " ? subTrack + 6 : subAdv + subTrack;
subW -= subTrack;
let sx = (W - subW) / 2;
const sy = 972;
for (const ch of subtitle) {
  if (ch !== " ") drawSmall(ch, sx, sy, subH, ALABASTER);
  sx += ch === " " ? subTrack + 6 : subAdv + subTrack;
}
// small saffron diamonds flanking the subtitle
for (const dx of [sx - subW - 34, sx + 20]) {
  fillPoly([[[dx, sy + 10], [dx + 6, sy + 4], [dx + 12, sy + 10], [dx + 6, sy + 16]].map(p => [D(p[0]), D(p[1])])], SAFFRON);
}

// ---------------------------------------------------------------- downsample 2x -> 1024 and encode PNG
const out = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3;
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = ((y * 2 + dy) * DW + x * 2 + dx) * 3;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
    }
    out[o] = (r + 2) >> 2; out[o + 1] = (g + 2) >> 2; out[o + 2] = (b + 2) >> 2;
  }
}

// CRC32 (PNG chunk checksums)
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Filter each scanline: choose None or Up by sum of absolute byte values (heuristic)
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const row = out.subarray(y * W * 3, (y + 1) * W * 3);
  const prev = y === 0 ? null : out.subarray((y - 1) * W * 3, y * W * 3);
  let sumNone = 0, sumUp = 0;
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    sumNone += Math.abs(v < 128 ? v : v - 256);
    if (prev) { const d = v - prev[i]; sumUp += Math.abs(d < 128 ? d : d - 256); }
  }
  const off = y * (1 + W * 3);
  if (prev && sumUp < sumNone) {
    raw[off] = 2;
    for (let i = 0; i < row.length; i++) raw[off + 1 + i] = (row[i] - prev[i]) & 0xff;
  } else {
    raw[off] = 0;
    raw.set(row, off + 1);
  }
}
const idat = deflateSync(raw, { level: 9 });

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("/output", { recursive: true });
writeFileSync("/output/entry.png", png);
console.log("wrote /output/entry.png", png.length, "bytes");
