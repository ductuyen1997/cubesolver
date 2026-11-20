/*
 * Facelet-level Rubik's cube model.
 *
 * Facelet string layout (Kociemba convention), 54 chars, faces in order U R F D L B:
 *
 *              |U1 U2 U3|
 *              |U4 U5 U6|
 *              |U7 U8 U9|
 *    |L1 L2 L3 |F1 F2 F3|R1 R2 R3|B1 B2 B3|
 *    |L4 L5 L6 |F4 F5 F6|R4 R5 R6|B4 B5 B6|
 *    |L7 L8 L9 |F7 F8 F9|R7 R8 R9|B7 B8 B9|
 *              |D1 D2 D3|
 *              |D4 D5 D6|
 *              |D7 D8 D9|
 *
 * Index = faceIndex * 9 + row * 3 + col, with U=0 R=1 F=2 D=3 L=4 B=5.
 * Each char names the face whose center has that color.
 *
 * Moves are integers 0..17: face * 3 + power, power 0 = clockwise quarter,
 * 1 = half turn, 2 = counter-clockwise (prime).
 */
(function (root) {
  'use strict';

  const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  // World axes: x to the right (R), y up (U), z toward the viewer (F).
  const NORMALS = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0, -1]];
  const SOLVED = FACES.map((f) => f.repeat(9)).join('');

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  /** Facelet index of the sticker on cubie position p facing outward along n. */
  function faceletIndex(p, n) {
    const [x, y, z] = p;
    if (n[1] === 1) return 0 + (z + 1) * 3 + (x + 1);
    if (n[0] === 1) return 9 + (1 - y) * 3 + (1 - z);
    if (n[2] === 1) return 18 + (1 - y) * 3 + (x + 1);
    if (n[1] === -1) return 27 + (1 - z) * 3 + (x + 1);
    if (n[0] === -1) return 36 + (1 - y) * 3 + (z + 1);
    if (n[2] === -1) return 45 + (1 - y) * 3 + (1 - x);
    throw new Error('bad normal');
  }

  /** Rotate v by -90 degrees about unit axis n (clockwise when looking at that face). */
  function rotateCW(v, n) {
    const c = cross(n, v);
    const d = dot(n, v);
    return [n[0] * d - c[0], n[1] * d - c[1], n[2] * d - c[2]];
  }

  const STICKERS = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const pos = [x, y, z];
        NORMALS.forEach((n, f) => {
          if (dot(pos, n) === 1) STICKERS.push({ pos, normal: n, face: f, index: faceletIndex(pos, n) });
        });
      }
    }
  }

  // QUARTER[f][i] = where the sticker at index i goes after a clockwise turn of face f.
  const QUARTER = NORMALS.map((n) => {
    const to = [];
    for (let i = 0; i < 54; i++) to[i] = i;
    for (const s of STICKERS) {
      if (dot(s.pos, n) === 1) to[s.index] = faceletIndex(rotateCW(s.pos, n), rotateCW(s.normal, n));
    }
    return to;
  });

  /** Apply move m to a facelet string or array; returns the same kind. */
  function applyMove(facelets, m) {
    const isStr = typeof facelets === 'string';
    let cur = isStr ? facelets.split('') : facelets.slice();
    const to = QUARTER[Math.floor(m / 3)];
    const times = (m % 3) + 1;
    for (let k = 0; k < times; k++) {
      const next = cur.slice();
      for (let i = 0; i < 54; i++) next[to[i]] = cur[i];
      cur = next;
    }
    return isStr ? cur.join('') : cur;
  }

  function applyMoves(facelets, moves) {
    return moves.reduce((f, m) => applyMove(f, m), facelets);
  }

  const SUFFIX = ['', '2', "'"];

  function moveToString(m) {
    return FACES[Math.floor(m / 3)] + SUFFIX[m % 3];
  }

  /** Parse "R U' F2 ..." into move integers. Returns null on invalid input. */
  function parseMoves(str) {
    const tokens = str.trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (const t of tokens) {
      const match = /^([URFDLB])(2'?|'2?|)$/i.exec(t);
      if (!match) return null;
      const f = FACES.indexOf(match[1].toUpperCase());
      const s = match[2];
      out.push(f * 3 + (s.includes('2') ? 1 : s === "'" ? 2 : 0));
    }
    return out;
  }

  function invertMove(m) {
    return Math.floor(m / 3) * 3 + [2, 1, 0][m % 3];
  }

  function randomScramble(length = 25, rnd = Math.random) {
    const moves = [];
    let last = -1;
    while (moves.length < length) {
      const f = Math.floor(rnd() * 6);
      if (f === last || f === last - 3) continue; // same face, or opposite face in wrong order
      moves.push(f * 3 + Math.floor(rnd() * 3));
      last = f;
    }
    return moves;
  }

  function isSolved(facelets) {
    const s = typeof facelets === 'string' ? facelets : facelets.join('');
    for (let f = 0; f < 6; f++) {
      const c = s[f * 9 + 4];
      for (let i = 0; i < 9; i++) if (s[f * 9 + i] !== c) return false;
    }
    return true;
  }

  const api = {
    FACES, NORMALS, SOLVED, STICKERS,
    faceletIndex, applyMove, applyMoves, moveToString, parseMoves, invertMove, randomScramble, isSolved,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RubikCube = api;
})(typeof self !== 'undefined' ? self : this);
