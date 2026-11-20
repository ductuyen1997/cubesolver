/*
 * Kociemba two-phase solver.
 *
 * Phase 1 brings the cube into the subgroup G1 = <U, D, R2, L2, F2, B2>
 * (all orientations solved, UD-slice edges in the slice). Phase 2 solves
 * the cube using only G1 moves. Both phases are IDA* searches over small
 * coordinates with precomputed move and pruning tables.
 */
(function (root) {
  'use strict';

  const Cube = root.RubikCube || (typeof require === 'function' ? require('./cube.js') : null);

  // Cubie positions: corners URF UFL ULB UBR DFR DLF DBL DRB,
  // edges UR UF UL UB DR DF DL DB FR FL BL BR.
  const CORNER_FACELET = [
    [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
    [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
  ];
  const EDGE_FACELET = [
    [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
    [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
  ];
  const CORNER_COLOR = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
  const EDGE_COLOR = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

  const N_TWIST = 2187;
  const N_FLIP = 2048;
  const N_SLICE = 495;
  const N_PERM8 = 40320;
  const N_PERM4 = 24;
  const N_MOVE = 18;
  const PHASE2_MOVES = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16]; // U U2 U' R2 F2 D D2 D' L2 B2
  const MAX_PHASE2 = 14;

  // ---------- facelets -> cubies ----------

  function parity(perm) {
    let p = 0;
    for (let i = 0; i < perm.length; i++) {
      for (let j = i + 1; j < perm.length; j++) if (perm[i] > perm[j]) p ^= 1;
    }
    return p;
  }

  /** Convert a facelet string to a cubie cube, or { error } if it is not a legal cube. */
  function toCubie(f) {
    if (typeof f !== 'string' || f.length !== 54) return { error: 'The cube needs exactly 54 stickers.' };
    for (let i = 0; i < 6; i++) {
      if (f[i * 9 + 4] !== Cube.FACES[i]) return { error: 'Center stickers are not in the standard position.' };
    }
    for (const c of Cube.FACES) {
      const n = f.split(c).length - 1;
      if (n !== 9) return { error: `There are ${n} ${c}-face stickers (need exactly 9 of each color).` };
    }

    const cp = [], co = [], ep = [], eo = [];
    for (let i = 0; i < 8; i++) {
      let ori = 0;
      while (ori < 3 && f[CORNER_FACELET[i][ori]] !== 'U' && f[CORNER_FACELET[i][ori]] !== 'D') ori++;
      if (ori === 3) return { error: 'A corner has an impossible color combination.' };
      const c1 = f[CORNER_FACELET[i][(ori + 1) % 3]];
      const c2 = f[CORNER_FACELET[i][(ori + 2) % 3]];
      cp[i] = -1;
      for (let j = 0; j < 8; j++) {
        if (CORNER_COLOR[j][1] === c1 && CORNER_COLOR[j][2] === c2) {
          cp[i] = j;
          co[i] = ori;
          break;
        }
      }
      if (cp[i] < 0) return { error: 'A corner has an impossible color combination.' };
    }
    for (let i = 0; i < 12; i++) {
      const a = f[EDGE_FACELET[i][0]];
      const b = f[EDGE_FACELET[i][1]];
      ep[i] = -1;
      for (let j = 0; j < 12; j++) {
        if (EDGE_COLOR[j][0] === a && EDGE_COLOR[j][1] === b) { ep[i] = j; eo[i] = 0; break; }
        if (EDGE_COLOR[j][0] === b && EDGE_COLOR[j][1] === a) { ep[i] = j; eo[i] = 1; break; }
      }
      if (ep[i] < 0) return { error: 'An edge has an impossible color combination.' };
    }

    if (new Set(cp).size !== 8) return { error: 'Some corner appears twice (and another is missing).' };
    if (new Set(ep).size !== 12) return { error: 'Some edge appears twice (and another is missing).' };
    if (co.reduce((a, b) => a + b, 0) % 3 !== 0) return { error: 'One corner is twisted — this position is unsolvable.' };
    if (eo.reduce((a, b) => a + b, 0) % 2 !== 0) return { error: 'One edge is flipped — this position is unsolvable.' };
    if (parity(cp) !== parity(ep)) return { error: 'Two pieces are swapped (parity error) — this position is unsolvable.' };
    return { cp, co, ep, eo };
  }

  /** a * b: apply b to a. */
  function multiply(a, b) {
    const cp = [], co = [], ep = [], eo = [];
    for (let i = 0; i < 8; i++) {
      cp[i] = a.cp[b.cp[i]];
      co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
    }
    for (let i = 0; i < 12; i++) {
      ep[i] = a.ep[b.ep[i]];
      eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2;
    }
    return { cp, co, ep, eo };
  }

  // ---------- coordinates ----------

  function rankPerm(p, n) {
    let r = 0;
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let j = i + 1; j < n; j++) if (p[j] < p[i]) c++;
      r = r * (n - i) + c;
    }
    return r;
  }

  function unrankPerm(r, n) {
    const digits = [];
    for (let i = n - 1; i >= 0; i--) {
      digits[i] = r % (n - i);
      r = Math.floor(r / (n - i));
    }
    const avail = [];
    for (let i = 0; i < n; i++) avail.push(i);
    return digits.map((d) => avail.splice(d, 1)[0]);
  }

  const MASK_TO_SLICE = new Int16Array(4096).fill(-1);
  const SLICE_MASKS = [];
  for (let m = 0; m < 4096; m++) {
    let bits = 0;
    for (let k = 0; k < 12; k++) if (m & (1 << k)) bits++;
    if (bits === 4) {
      MASK_TO_SLICE[m] = SLICE_MASKS.length;
      SLICE_MASKS.push(m);
    }
  }
  const SLICE_SOLVED = MASK_TO_SLICE[0xf00];

  const getTwist = (co) => { let t = 0; for (let i = 0; i < 7; i++) t = t * 3 + co[i]; return t; };
  const getFlip = (eo) => { let t = 0; for (let i = 0; i < 11; i++) t = t * 2 + eo[i]; return t; };
  const getSlice = (ep) => { let m = 0; for (let i = 0; i < 12; i++) if (ep[i] >= 8) m |= 1 << i; return MASK_TO_SLICE[m]; };

  function setTwist(t) {
    const co = [];
    let s = 0;
    for (let i = 6; i >= 0; i--) { co[i] = t % 3; s += co[i]; t = Math.floor(t / 3); }
    co[7] = (3 - (s % 3)) % 3;
    return co;
  }

  function setFlip(t) {
    const eo = [];
    let s = 0;
    for (let i = 10; i >= 0; i--) { eo[i] = t % 2; s += eo[i]; t = Math.floor(t / 2); }
    eo[11] = s % 2;
    return eo;
  }

  function setSlice(idx) {
    const mask = SLICE_MASKS[idx];
    const ep = [];
    let other = 0, slice = 8;
    for (let i = 0; i < 12; i++) ep[i] = mask & (1 << i) ? slice++ : other++;
    return ep;
  }

  // ---------- tables ----------

  let ready = false;
  let MOVES, twistMove, flipMove, sliceMove, cpermMove, epermMove, spermMove;
  let pruneSliceTwist, pruneSliceFlip, pruneCpermSperm, pruneEpermSperm;

  function buildPrune(n1, n2, move1, move2, moves, solved1, solved2) {
    const size = n1 * n2;
    const table = new Int8Array(size).fill(-1);
    table[solved1 * n2 + solved2] = 0;
    let depth = 0, filled = 1;
    while (filled < size) {
      let found = 0;
      for (let i = 0; i < size; i++) {
        if (table[i] !== depth) continue;
        const c1 = (i / n2) | 0, c2 = i % n2;
        for (const m of moves) {
          const j = move1[c1 * N_MOVE + m] * n2 + move2[c2 * N_MOVE + m];
          if (table[j] === -1) { table[j] = depth + 1; filled++; found++; }
        }
      }
      if (!found) break;
      depth++;
    }
    return table;
  }

  function init() {
    if (ready) return;
    const base = [];
    for (let f = 0; f < 6; f++) base.push(toCubie(Cube.applyMove(Cube.SOLVED, f * 3)));
    MOVES = [];
    for (let f = 0; f < 6; f++) {
      let c = base[f];
      for (let p = 0; p < 3; p++) { MOVES[f * 3 + p] = c; c = multiply(c, base[f]); }
    }
    const ALL = [];
    for (let m = 0; m < N_MOVE; m++) ALL.push(m);

    twistMove = new Uint16Array(N_TWIST * N_MOVE);
    for (let t = 0; t < N_TWIST; t++) {
      const co = setTwist(t);
      for (const m of ALL) {
        const mv = MOVES[m];
        twistMove[t * N_MOVE + m] = getTwist(mv.cp.map((c, i) => (co[c] + mv.co[i]) % 3));
      }
    }
    flipMove = new Uint16Array(N_FLIP * N_MOVE);
    for (let t = 0; t < N_FLIP; t++) {
      const eo = setFlip(t);
      for (const m of ALL) {
        const mv = MOVES[m];
        flipMove[t * N_MOVE + m] = getFlip(mv.ep.map((e, i) => (eo[e] + mv.eo[i]) % 2));
      }
    }
    sliceMove = new Uint16Array(N_SLICE * N_MOVE);
    for (let s = 0; s < N_SLICE; s++) {
      const ep = setSlice(s);
      for (const m of ALL) sliceMove[s * N_MOVE + m] = getSlice(MOVES[m].ep.map((e) => ep[e]));
    }
    cpermMove = new Uint16Array(N_PERM8 * N_MOVE);
    epermMove = new Uint16Array(N_PERM8 * N_MOVE);
    for (let r = 0; r < N_PERM8; r++) {
      const p = unrankPerm(r, 8);
      for (const m of PHASE2_MOVES) {
        const mv = MOVES[m];
        cpermMove[r * N_MOVE + m] = rankPerm(mv.cp.map((c) => p[c]), 8);
        epermMove[r * N_MOVE + m] = rankPerm(mv.ep.slice(0, 8).map((e) => p[e]), 8);
      }
    }
    spermMove = new Uint16Array(N_PERM4 * N_MOVE);
    for (let r = 0; r < N_PERM4; r++) {
      const p = unrankPerm(r, 4);
      for (const m of PHASE2_MOVES) {
        spermMove[r * N_MOVE + m] = rankPerm(MOVES[m].ep.slice(8).map((e) => p[e - 8]), 4);
      }
    }

    pruneSliceTwist = buildPrune(N_SLICE, N_TWIST, sliceMove, twistMove, ALL, SLICE_SOLVED, 0);
    pruneSliceFlip = buildPrune(N_SLICE, N_FLIP, sliceMove, flipMove, ALL, SLICE_SOLVED, 0);
    pruneCpermSperm = buildPrune(N_PERM8, N_PERM4, cpermMove, spermMove, PHASE2_MOVES, 0, 0);
    pruneEpermSperm = buildPrune(N_PERM8, N_PERM4, epermMove, spermMove, PHASE2_MOVES, 0, 0);
    ready = true;
  }

  // ---------- search ----------

  const TIMEOUT = { timeout: true };

  function searchWithLimit(cc, limit, deadline, budget) {
    const path1 = new Int8Array(40);
    const path2 = new Int8Array(40);
    let nodes = 0;
    let result = null;

    const tick = () => {
      if ((++nodes & 0x3fff) === 0 && (Date.now() > deadline || (budget.nodes -= 0x4000) <= 0)) throw TIMEOUT;
    };

    function phase2(cperm, eperm, sperm, depth, togo, lastFace) {
      tick();
      if (togo === 0) return cperm === 0 && eperm === 0 && sperm === 0;
      for (const m of PHASE2_MOVES) {
        const f = (m / 3) | 0;
        if (f === lastFace || f === lastFace - 3) continue;
        const nc = cpermMove[cperm * N_MOVE + m];
        const ne = epermMove[eperm * N_MOVE + m];
        const ns = spermMove[sperm * N_MOVE + m];
        const h = Math.max(pruneCpermSperm[nc * N_PERM4 + ns], pruneEpermSperm[ne * N_PERM4 + ns]);
        if (h > togo - 1) continue;
        path2[depth] = m;
        if (phase2(nc, ne, ns, depth + 1, togo - 1, f)) return true;
      }
      return false;
    }

    function startPhase2(d1) {
      let cp = cc.cp, ep = cc.ep;
      for (let k = 0; k < d1; k++) {
        const mv = MOVES[path1[k]];
        cp = mv.cp.map((c) => cp[c]);
        ep = mv.ep.map((e) => ep[e]);
      }
      const cperm = rankPerm(cp, 8);
      const eperm = rankPerm(ep, 8);
      const sperm = rankPerm(ep.slice(8).map((e) => e - 8), 4);
      const maxD2 = Math.min(limit - d1, MAX_PHASE2);
      const h = Math.max(pruneCpermSperm[cperm * N_PERM4 + sperm], pruneEpermSperm[eperm * N_PERM4 + sperm]);
      const lastFace = d1 > 0 ? (path1[d1 - 1] / 3) | 0 : -1;
      for (let d2 = h; d2 <= maxD2; d2++) {
        if (phase2(cperm, eperm, sperm, 0, d2, lastFace)) {
          result = Array.from(path1.slice(0, d1)).concat(Array.from(path2.slice(0, d2)));
          return true;
        }
      }
      return false;
    }

    function phase1(twist, flip, slice, depth, togo, lastFace) {
      tick();
      if (togo === 0) {
        if (twist !== 0 || flip !== 0 || slice !== SLICE_SOLVED) return false;
        if (depth > 0) {
          // The last move must leave G1 -> G1 only via a quarter turn of R, F, L or B;
          // otherwise the previous position was already in G1 (redundant).
          const m = path1[depth - 1];
          if (((m / 3) | 0) % 3 === 0 || m % 3 === 1) return false;
        }
        return startPhase2(depth);
      }
      for (let f = 0; f < 6; f++) {
        if (f === lastFace || f === lastFace - 3) continue;
        for (let p = 0; p < 3; p++) {
          const m = f * 3 + p;
          const t = twistMove[twist * N_MOVE + m];
          const fl = flipMove[flip * N_MOVE + m];
          const s = sliceMove[slice * N_MOVE + m];
          const h = Math.max(pruneSliceTwist[s * N_TWIST + t], pruneSliceFlip[s * N_FLIP + fl]);
          if (h > togo - 1) continue;
          path1[depth] = m;
          if (phase1(t, fl, s, depth + 1, togo - 1, f)) return true;
        }
      }
      return false;
    }

    const t0 = getTwist(cc.co), f0 = getFlip(cc.eo), s0 = getSlice(cc.ep);
    const h0 = Math.max(pruneSliceTwist[s0 * N_TWIST + t0], pruneSliceFlip[s0 * N_FLIP + f0]);
    for (let d1 = h0; d1 <= limit; d1++) {
      if (phase1(t0, f0, s0, 0, d1, -1)) return result;
    }
    return null;
  }

  /**
   * Solve a facelet string.
   * Returns { moves: number[], optimal: boolean, ms } or { error: string }.
   *
   * The first two-phase solution is often longer than necessary (phase 1 may
   * pick a G1 entry that phase 2 then has to undo), so the search is repeated
   * with the length limit lowered by one each time until either
   *   - a search at length L exhausts without a result: the previous solution
   *     (length L + 1) is proven shortest, or
   *   - the time budget runs out: the best solution found so far is returned.
   * Searching at length L is exhaustive whenever L - h0 <= MAX_PHASE2, because
   * every solution splits into a phase-1 prefix (at least h0 moves, ending
   * with the last quarter turn of R/F/L/B) and a G1-only suffix.
   *
   * options.improveMs: time budget for shortening the first solution (default 1500).
   * options.timeoutMs: hard limit for finding any solution (default 15000).
   */
  function solve(facelets, options = {}) {
    init();
    const cc = toCubie(facelets);
    if (cc.error) return { error: cc.error };
    const start = Date.now();
    const s0 = getSlice(cc.ep), t0 = getTwist(cc.co), f0 = getFlip(cc.eo);
    const lowerBound = Math.max(pruneSliceTwist[s0 * N_TWIST + t0], pruneSliceFlip[s0 * N_FLIP + f0]);
    let deadline = start + (options.timeoutMs ?? 15000);
    let limit = 24;
    let best = null;
    let optimal = false;
    // Work cap alongside the clock, so the search always ends even if the clock stalls.
    // (~2.4M nodes/s, so the default 25M is about 10 s of work and never hit in normal use.)
    const budget = { nodes: options.maxNodes ?? 25e6 };
    for (;;) {
      let res;
      try {
        res = searchWithLimit(cc, limit, deadline, budget);
      } catch (e) {
        if (e === TIMEOUT) break;
        throw e;
      }
      if (!res) {
        optimal = best !== null && limit - lowerBound <= MAX_PHASE2;
        break;
      }
      if (!best) deadline = Date.now() + (options.improveMs ?? 1500);
      best = res;
      if (res.length <= lowerBound) {
        optimal = true;
        break;
      }
      limit = res.length - 1;
    }
    if (!best) return { error: 'Could not find a solution in time.' };
    return { moves: best, optimal, ms: Date.now() - start };
  }

  /** Cubie cube -> facelet string (inverse of toCubie). */
  function toFacelets(c) {
    const f = Cube.SOLVED.split('');
    for (let i = 0; i < 8; i++) {
      for (let n = 0; n < 3; n++) f[CORNER_FACELET[i][(n + c.co[i]) % 3]] = CORNER_COLOR[c.cp[i]][n];
    }
    for (let i = 0; i < 12; i++) {
      for (let n = 0; n < 2; n++) f[EDGE_FACELET[i][(n + c.eo[i]) % 2]] = EDGE_COLOR[c.ep[i]][n];
    }
    return f.join('');
  }

  function inverse(c) {
    const cp = [], co = [], ep = [], eo = [];
    for (let i = 0; i < 8; i++) { cp[c.cp[i]] = i; co[c.cp[i]] = (3 - c.co[i]) % 3; }
    for (let i = 0; i < 12; i++) { ep[c.ep[i]] = i; eo[c.ep[i]] = c.eo[i]; }
    return { cp, co, ep, eo };
  }

  /**
   * Find moves that turn the `current` cube into the `target` cube (both facelet strings).
   * We need M with current * M = target, i.e. M = current^-1 * target. solve(X)
   * returns X^-1, so we solve X = target^-1 * current.
   */
  function solveTo(current, target, options) {
    init();
    const c = toCubie(current);
    if (c.error) return { error: c.error };
    const t = toCubie(target);
    if (t.error) return { error: 'Target pattern is invalid: ' + t.error };
    return solve(toFacelets(multiply(inverse(t), c)), options);
  }

  const api = { init, solve, solveTo, toCubie, toFacelets, isReady: () => ready };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RubikSolver = api;
})(typeof self !== 'undefined' ? self : this);
