// Run with: node test/patterns.test.js
'use strict';
const assert = require('assert');
const Cube = require('../js/cube.js');
const Solver = require('../js/solver.js');
const { PATTERNS } = require('../js/patterns.js');

const faces = (f) => Cube.FACES.map((_, i) => f.slice(i * 9, i * 9 + 9));
const target = (p) => Cube.applyMoves(Cube.SOLVED, Cube.parseMoves(p.alg));

// Every algorithm parses and produces a valid, non-solved position.
const ids = new Set();
for (const p of PATTERNS) {
  assert.ok(!ids.has(p.id), 'duplicate id ' + p.id);
  ids.add(p.id);
  assert.ok(Cube.parseMoves(p.alg), `${p.name}: algorithm does not parse`);
  const f = target(p);
  assert.ok(!Solver.toCubie(f).error, `${p.name}: invalid cube`);
  assert.ok(!Cube.isSolved(f), `${p.name}: leaves the cube solved`);
}

// The headline patterns really have the advertised shape on all six faces.
const byId = Object.fromEntries(PATTERNS.map((p) => [p.id, target(p)]));
for (const face of faces(byId.x)) {
  const c = face[4];
  assert.ok([0, 2, 4, 6, 8].every((i) => face[i] === c), 'X: corners match center');
  assert.ok([1, 3, 5, 7].every((i) => face[i] !== c && face[i] === face[1]), 'X: edges one other color');
}
for (const face of faces(byId.plus)) {
  const c = face[4];
  assert.ok([1, 3, 5, 7].every((i) => face[i] === c), 'Plus: edges match center');
  assert.ok([0, 2, 6, 8].every((i) => face[i] !== c && face[i] === face[0]), 'Plus: corners one other color');
}
for (const face of faces(byId.checkerboard)) {
  assert.ok([0, 2, 4, 6, 8].every((i) => face[i] === face[4]) && [1, 3, 5, 7].every((i) => face[i] !== face[4]));
}
for (const [i, face] of faces(byId.superflip).entries()) {
  assert.ok([0, 2, 4, 6, 8].every((k) => face[k] === Cube.FACES[i]), 'Superflip: corners/centers solved');
}

// solveTo: from any position to any pattern.
Solver.init();
let seed = 99;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (const p of PATTERNS) {
  const start = Cube.applyMoves(Cube.SOLVED, Cube.randomScramble(20, rnd));
  const r = Solver.solveTo(start, target(p), { improveMs: 200 });
  assert.ok(!r.error, r.error);
  assert.strictEqual(Cube.applyMoves(start, r.moves), target(p), `${p.name}: solveTo from scramble`);
  const fromSolved = Solver.solveTo(Cube.SOLVED, target(p), { improveMs: 200 });
  assert.strictEqual(Cube.applyMoves(Cube.SOLVED, fromSolved.moves), target(p), `${p.name}: solveTo from solved`);
}
// Reaching a pattern you're already one move away from takes one move.
const near = Cube.applyMove(byId.checkerboard, 0);
assert.strictEqual(Solver.solveTo(near, byId.checkerboard).moves.length, 1);

console.log(`${PATTERNS.length} patterns verified; solveTo reaches each from scrambled and solved cubes.`);
console.log('All tests passed.');
