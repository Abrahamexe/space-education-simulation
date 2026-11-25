/**
 * Weak gravitational lensing for the dark-matter scenes. The sky plane is (x, y); the observer
 * looks along -z from +z. Thin-lens deflection of a surface density Σ:
 *   α(θ) ∝ Σ_k Σ_k A (θ − θ_k) / (|θ − θ_k|² + soft²),
 * pointing toward the mass, then normalised so the largest |α| is 1 (the drawn strength is a
 * display choice and is labelled as such in the UI).
 */

/** CIC surface density on the sky plane, n×n cells over [-half, half]², mass per unit area. */
export function projectSigma(pos: Float32Array, ranges: { from: number; to: number; mass: number }[], n: number, half: number): Float32Array {
  const out = new Float32Array(n * n);
  const cell = (2 * half) / n;
  for (const { from, to, mass } of ranges) {
    const w = mass / (cell * cell);
    for (let p = from; p < to; p++) {
      const gx = (pos[3 * p] + half) / cell - 0.5;
      const gy = (pos[3 * p + 1] + half) / cell - 0.5;
      const i0 = Math.floor(gx);
      const j0 = Math.floor(gy);
      if (i0 < -1 || j0 < -1 || i0 >= n || j0 >= n) continue;
      const fx = gx - i0;
      const fy = gy - j0;
      for (let b = 0; b < 2; b++) {
        const j = j0 + b;
        if (j < 0 || j >= n) continue;
        for (let a = 0; a < 2; a++) {
          const i = i0 + a;
          if (i < 0 || i >= n) continue;
          out[j * n + i] += w * (b ? fy : 1 - fy) * (a ? fx : 1 - fx);
        }
      }
    }
  }
  return out;
}

/** Deflection (αx, αy) per cell, 2n² values, max |α| = 1 (all zero for an empty map). */
export function deflectionField(sigma: Float32Array, n: number, half: number, soft: number): Float32Array {
  const cell = (2 * half) / n;
  const s2 = soft * soft;
  const out = new Float32Array(2 * n * n);
  // Only cells with mass contribute: gather them once.
  const src: number[] = [];
  for (let k = 0; k < n * n; k++) if (sigma[k] > 0) src.push(k);
  let max = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let ax = 0;
      let ay = 0;
      for (const k of src) {
        const dx = (i - (k % n)) * cell;
        const dy = (j - Math.floor(k / n)) * cell;
        const w = sigma[k] / (dx * dx + dy * dy + s2);
        ax -= w * dx;
        ay -= w * dy;
      }
      const o = 2 * (j * n + i);
      out[o] = ax;
      out[o + 1] = ay;
      max = Math.max(max, Math.hypot(ax, ay));
    }
  }
  if (max > 0) for (let k = 0; k < out.length; k++) out[k] /= max;
  return out;
}
