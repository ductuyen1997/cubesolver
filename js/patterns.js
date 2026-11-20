/*
 * "Pretty patterns": each is a move sequence applied to a solved cube.
 * All algorithms are verified by test/patterns.test.js.
 */
(function (root) {
  'use strict';

  const PATTERNS = [
    { id: 'x', name: 'X', alg: "D2 R2 U B2 F2 L2 R2 D' F L' R' D U' B' F' D2 U2 R U2",
      desc: 'An X on every face: corners and center match, edges show a neighbouring color.' },
    { id: 'plus', name: 'Plus (+)', alg: "U F B' L2 U2 L2 F' B U2 L2 U",
      desc: 'A plus sign on every face: edges and center match, corners differ.' },
    { id: 'checkerboard', name: 'Checkerboard', alg: "R2 L2 U2 D2 F2 B2",
      desc: 'Every face alternates between two opposite colors.' },
    { id: 'spots', name: 'Six spots', alg: "U D' R L' F B' U D'",
      desc: 'Each center sits in a frame of a different color.' },
    { id: 'four-spots', name: 'Four spots', alg: "F2 B2 U D' R2 L2 U D'",
      desc: 'Spots on the four side faces; top and bottom stay solid.' },
    { id: 'cube-in-cube', name: 'Cube in a cube', alg: "F L F U' R U F2 L2 U' L' B D' B' L2 U",
      desc: 'A small 2×2 cube appears to sit in one corner.' },
    { id: 'cube-in-cube-2', name: 'Cube in a cube in a cube', alg: "U' L' U' F' R2 B' R F U B2 U B' L U' F U R F'",
      desc: 'Three nested cubes growing out of one corner.' },
    { id: 'superflip', name: 'Superflip', alg: "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2",
      desc: 'Every edge flipped in place. It famously needs 20 moves.' },
    { id: 'python', name: 'Python', alg: "L U B' U' R L' B R' F B' D R D' F'",
      desc: 'A snake winding around the cube.' },
    { id: 'tetris', name: 'Tetris', alg: "L R F B U' D' L' R'",
      desc: 'Interlocking blocks like Tetris pieces.' },
    { id: 'stripes', name: 'Stripes', alg: "F U F R L2 B D' R D2 L D' B R2 L F U F",
      desc: 'Vertical stripes around the four side faces.' },
    { id: 'kilt', name: 'Kilt', alg: "U' R2 L2 F2 B2 U' R L F B' U F2 D2 R2 L2 F2 U2 F2 U' F2",
      desc: 'A tartan-like three-color pattern on every face.' },
    { id: 'twister', name: 'Twister', alg: "F R' U L F' L' F U' R U L' U' L F'",
      desc: 'A band that twists around the cube.' },
    { id: 'worm', name: 'Worm', alg: "R U' R2 U2 F D2 R2 U' D' R D' F'",
      desc: 'A worm crawling across three faces.' },
    { id: 'six-two-one', name: 'Six-two-one', alg: "U B2 D2 L B' L' U' L' B D2 B2",
      desc: 'Blocks of six, two and one on each face.' },
  ];

  const api = { PATTERNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RubikPatterns = api;
})(typeof self !== 'undefined' ? self : this);
