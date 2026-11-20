/*
 * Sticker color classification for scanned cube faces.
 *
 * Input: 54 RGB samples in facelet order (U R F D L B, 9 each).
 * The six center samples act as the reference colors (they were captured
 * under the same lighting as everything else). Stickers are assigned to
 * colors with an optimal assignment (Hungarian algorithm) that enforces
 * exactly 9 stickers per color, then references are re-estimated from the
 * assigned stickers and the assignment repeated a few times.
 */
(function (root) {
  'use strict';

  const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function rgbToLab(rgb) {
    const r = srgbToLinear(rgb[0]), g = srgbToLinear(rgb[1]), b = srgbToLinear(rgb[2]);
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /**
   * Color distance in LCh terms. Lightness and chroma vary with shading and
   * lighting, so they are down-weighted; hue (what separates red from orange,
   * white from yellow) is weighted up.
   */
  function distance(p, q) {
    const c1 = Math.hypot(p[1], p[2]), c2 = Math.hypot(q[1], q[2]);
    const dl = p[0] - q[0], dc = c1 - c2;
    const da = p[1] - q[1], db = p[2] - q[2];
    const dh2 = Math.max(0, da * da + db * db - dc * dc); // squared hue difference
    return Math.sqrt(0.25 * dl * dl + 0.5 * dc * dc + 2 * dh2);
  }

  /** Minimum-cost assignment for a square cost matrix. Returns col index for each row. */
  function hungarian(cost) {
    const n = cost.length;
    const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
    const p = new Int32Array(n + 1), way = new Int32Array(n + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Float64Array(n + 1).fill(Infinity);
      const used = new Uint8Array(n + 1);
      do {
        used[j0] = 1;
        const i0 = p[j0];
        let delta = Infinity, j1 = 0;
        for (let j = 1; j <= n; j++) {
          if (used[j]) continue;
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else { minv[j] -= delta; }
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0);
    }
    const result = new Array(n);
    for (let j = 1; j <= n; j++) result[p[j] - 1] = j - 1;
    return result;
  }

  /**
   * Classify 54 RGB samples. Returns { facelets: string, uncertain: number[] }
   * where `uncertain` lists sticker indices whose color was a close call.
   */
  function classify(samples) {
    const labs = samples.map(rgbToLab);
    let refs = FACES.map((_, f) => labs[f * 9 + 4]);
    let colorOf = new Array(54);
    const BIG = 1e6;

    for (let iter = 0; iter < 4; iter++) {
      const cost = [];
      for (let i = 0; i < 54; i++) {
        const row = new Array(54);
        const isCenter = i % 9 === 4;
        for (let c = 0; c < 6; c++) {
          const d = isCenter ? (c === Math.floor(i / 9) ? 0 : BIG) : distance(labs[i], refs[c]);
          for (let k = 0; k < 9; k++) row[c * 9 + k] = d;
        }
        cost.push(row);
      }
      const assign = hungarian(cost);
      colorOf = assign.map((slot) => Math.floor(slot / 9));
      // Re-estimate each reference as the mean of its stickers (robust to logo centers).
      refs = FACES.map((_, c) => {
        const members = labs.filter((_, i) => colorOf[i] === c);
        return [0, 1, 2].map((k) => members.reduce((s, m) => s + m[k], 0) / members.length);
      });
    }

    const uncertain = [];
    for (let i = 0; i < 54; i++) {
      if (i % 9 === 4) continue;
      const ds = refs.map((r) => distance(labs[i], r));
      const own = ds[colorOf[i]];
      const other = Math.min(...ds.filter((_, c) => c !== colorOf[i]));
      if (other < own * 1.35) uncertain.push(i);
    }
    return { facelets: colorOf.map((c) => FACES[c]).join(''), uncertain };
  }

  /** Median RGB of a square region of ImageData-like { data, width }. */
  function sampleRegion(img, x0, y0, size) {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let count = 0;
    const x1 = Math.min(img.width, Math.round(x0 + size));
    const y1 = Math.min(img.height, Math.round(y0 + size));
    for (let y = Math.max(0, Math.round(y0)); y < y1; y++) {
      for (let x = Math.max(0, Math.round(x0)); x < x1; x++) {
        const o = (y * img.width + x) * 4;
        hist[0][img.data[o]]++;
        hist[1][img.data[o + 1]]++;
        hist[2][img.data[o + 2]]++;
        count++;
      }
    }
    if (!count) return [0, 0, 0];
    return hist.map((h) => {
      let acc = 0;
      for (let v = 0; v < 256; v++) {
        acc += h[v];
        if (acc * 2 >= count) return v;
      }
      return 255;
    });
  }

  /** The six defined cube colors, as a typical camera sees them. */
  const DEFAULT_RGB = {
    U: [220, 220, 215], // white
    R: [185, 30, 40], // red
    F: [25, 155, 75], // green
    D: [225, 210, 45], // yellow
    L: [240, 115, 30], // orange
    B: [25, 75, 175], // blue
  };

  /**
   * Reference colors (Lab) for the six defined colors. Any captured center
   * replaces its default, so matching adapts to the actual cube and lighting.
   * centers: { U: [r,g,b], ... } (may be partial or empty)
   */
  function references(centers = {}) {
    return FACES.map((f) => rgbToLab(centers[f] || DEFAULT_RGB[f]));
  }

  /** Snap one RGB sample to the closest defined color; returns a face letter. */
  function nearestColor(rgb, refs) {
    const lab = rgbToLab(rgb);
    let best = 0, bestD = Infinity;
    refs.forEach((r, c) => {
      const d = distance(lab, r);
      if (d < bestD) { bestD = d; best = c; }
    });
    return FACES[best];
  }

  const api = { rgbToLab, distance, hungarian, classify, sampleRegion, references, nearestColor, FACES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RubikColorScan = api;
})(typeof self !== 'undefined' ? self : this);
