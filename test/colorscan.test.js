// Run with: node test/colorscan.test.js
'use strict';
const assert = require('assert');
const Cube = require('../js/cube.js');
const Scan = require('../js/colorscan.js');

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

// Typical cube colors as a webcam sees them (fairly muted / warm).
const BASE = {
  U: [215, 215, 205], R: [180, 30, 40], F: [20, 150, 70],
  D: [225, 210, 40], L: [235, 110, 30], B: [20, 70, 170],
};

// Hungarian sanity check
assert.deepStrictEqual(Scan.hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]);

let ok = 0;
const N = 300;
for (let t = 0; t < N; t++) {
  const state = Cube.applyMoves(Cube.SOLVED, Cube.randomScramble(25, rnd));
  // Per-face lighting: brightness and a slight warm/cool tint, plus per-sticker noise.
  const faceLight = Cube.FACES.map(() => ({
    k: 0.7 + rnd() * 0.45,
    tint: [(rnd() - 0.5) * 30, (rnd() - 0.5) * 20, (rnd() - 0.5) * 30],
  }));
  const samples = [...state].map((c, i) => {
    const L = faceLight[Math.floor(i / 9)];
    const shade = 0.88 + rnd() * 0.2;
    return BASE[c].map((v, k) => clamp(v * L.k * shade + L.tint[k] + (rnd() - 0.5) * 24));
  });
  const res = Scan.classify(samples);
  if (res.facelets === state) ok++;
}
console.log(`Synthetic scans recovered exactly: ${ok}/${N}`);
assert.ok(ok / N > 0.95, 'classification accuracy too low');
// Closest-defined-color snapping (what the live preview and thumbnails show).
let rawOk = 0, calOk = 0, total = 0;
for (let t = 0; t < 200; t++) {
  const k = 0.75 + rnd() * 0.35;
  const tint = [(rnd() - 0.5) * 30, (rnd() - 0.5) * 20, (rnd() - 0.5) * 30];
  const seen = (c) => BASE[c].map((v, i) => clamp(v * k * (0.9 + rnd() * 0.15) + tint[i] + (rnd() - 0.5) * 20));
  const centers = {};
  for (const f of Cube.FACES) centers[f] = seen(f);
  const defaults = Scan.references();
  const calibrated = Scan.references(centers);
  for (const c of Cube.FACES) {
    const rgb = seen(c);
    total++;
    if (Scan.nearestColor(rgb, defaults) === c) rawOk++;
    if (Scan.nearestColor(rgb, calibrated) === c) calOk++;
    assert.ok(Cube.FACES.includes(Scan.nearestColor(rgb, defaults)), 'always a defined color');
  }
}
console.log(`Closest-color snapping: defaults ${rawOk}/${total}, calibrated by centers ${calOk}/${total}`);
assert.ok(calOk / total > 0.97, 'calibrated snapping accuracy too low');

console.log('All tests passed.');
