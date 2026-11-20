// Run with: node test/solver.test.js
'use strict';
const assert = require('assert');
const Cube = require('../js/cube.js');
const Solver = require('../js/solver.js');

// Every face turn has order 4 and moves exactly 20 stickers.
for (let f = 0; f < 6; f++) {
  let s = Cube.SOLVED;
  for (let k = 0; k < 4; k++) s = Cube.applyMove(s, f * 3);
  assert.strictEqual(s, Cube.SOLVED, `face ${f} order`);
  const once = Cube.applyMove(Cube.SOLVED, f * 3);
  const moved = [...once].filter((c, i) => c !== Cube.SOLVED[i]).length;
  assert.strictEqual(moved, 12, `face ${f} visible change`);
}
// Known identity: (R U R' U') x6 = identity
const sexy = Cube.parseMoves("R U R' U'");
let s = Cube.SOLVED;
for (let k = 0; k < 6; k++) s = Cube.applyMoves(s, sexy);
assert.strictEqual(s, Cube.SOLVED, 'sexy move order 6');

// Superflip known facelet string sanity: U R F D L B face order of a single R move
assert.strictEqual(Cube.applyMove(Cube.SOLVED, 3),
  'UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB', 'R move facelets');

let t = Date.now();
Solver.init();
console.log(`init: ${Date.now() - t} ms`);

// Invalid cubes are rejected
const twisted = Cube.SOLVED.split('');
[twisted[8], twisted[9], twisted[20]] = [twisted[9], twisted[20], twisted[8]];
assert.ok(Solver.solve(twisted.join('')).error, 'twisted corner rejected');
const flipped = Cube.SOLVED.split('');
[flipped[5], flipped[10]] = [flipped[10], flipped[5]];
assert.ok(Solver.solve(flipped.join('')).error, 'flipped edge rejected');
assert.deepStrictEqual(Solver.solve(Cube.SOLVED).moves, [], 'solved cube');

const noRedundancyLater = (moves) => moves.every((m, i) => i === 0 ||
  (Math.floor(m / 3) !== Math.floor(moves[i - 1] / 3) && Math.floor(m / 3) !== Math.floor(moves[i - 1] / 3) - 3));
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const N = 20;
let total = 0, maxLen = 0, maxMs = 0;
t = Date.now();
for (let i = 0; i < N; i++) {
  const scramble = Cube.randomScramble(25, rnd);
  const f = Cube.applyMoves(Cube.SOLVED, scramble);
  const r = Solver.solve(f);
  assert.ok(!r.error, r.error);
  assert.ok(Cube.isSolved(Cube.applyMoves(f, r.moves)), 'solution solves cube');
  assert.ok(noRedundancyLater(r.moves), 'redundant moves: ' + r.moves.map(Cube.moveToString).join(' '));
  total += r.moves.length;
  maxLen = Math.max(maxLen, r.moves.length);
  maxMs = Math.max(maxMs, r.ms);
}
console.log(`${N} random cubes solved; avg length ${(total / N).toFixed(1)}, max ${maxLen}; ` +
  `avg ${((Date.now() - t) / N).toFixed(0)} ms, max ${maxMs} ms`);
// No wasted moves: short scrambles must get a solution no longer than the scramble,
// proven shortest, and every solution must be free of redundant move pairs.
const noRedundancy = (moves) => moves.every((m, i) => {
  if (i === 0) return true;
  const f = Math.floor(m / 3), p = Math.floor(moves[i - 1] / 3);
  if (f === p) return false; // e.g. R R' or R R2
  if (f === p - 3) return false; // opposite faces out of order (e.g. D U)
  return i < 2 || !(f === Math.floor(moves[i - 2] / 3) && Math.abs(f - p) === 3); // e.g. R L R
});
for (let n = 1; n <= 10; n++) {
  for (let k = 0; k < 6; k++) {
    const scramble = Cube.randomScramble(n, rnd);
    const r = Solver.solve(Cube.applyMoves(Cube.SOLVED, scramble));
    assert.ok(Cube.isSolved(Cube.applyMoves(Cube.applyMoves(Cube.SOLVED, scramble), r.moves)));
    assert.ok(r.moves.length <= n, `scramble of ${n} solved in ${r.moves.length}: ${scramble.map(Cube.moveToString).join(' ')}`);
    assert.ok(r.optimal, 'short solution should be proven shortest');
    assert.ok(noRedundancy(r.moves), 'redundant moves: ' + r.moves.map(Cube.moveToString).join(' '));
  }
}
assert.deepStrictEqual(
  Solver.solve(Cube.applyMoves(Cube.SOLVED, Cube.parseMoves('R U F'))).moves.map(Cube.moveToString),
  ["F'", "U'", "R'"]);
console.log('Short scrambles: all solved optimally with no redundant moves.');
console.log('All tests passed.');
