/**
 * Organic edge for photographs drawn in space (nebulae, galaxies): the photo's sky level is measured
 * and removed, and the picture fades out along the object's own structure instead of along its
 * rectangular frame. Bright gas reaches further towards the frame, dark gaps fade first, and a thin
 * fade guarantees nothing is left at the picture border.
 */

/** Box blur, `passes` times (≈ Gaussian), in place on an N×N field. */
function blur(a: Float32Array, N: number, r: number, passes = 3): Float32Array {
  const t = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < N; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[y * N + Math.min(N - 1, Math.max(0, x))];
      for (let x = 0; x < N; x++) {
        t[y * N + x] = s / (2 * r + 1);
        s += a[y * N + Math.min(N - 1, x + r + 1)] - a[y * N + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += t[Math.min(N - 1, Math.max(0, y)) * N + x];
      for (let y = 0; y < N; y++) {
        a[y * N + x] = s / (2 * r + 1);
        s += t[Math.min(N - 1, y + r + 1) * N + x] - t[Math.max(0, y - r) * N + x];
      }
    }
  }
  return a;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function quantile(a: Float32Array, q: number): number {
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * Per-pixel alpha (row 0 = top, like the input) and the sky colour to subtract, both linear.
 * `lin`: N×N linear RGB triplets.
 */
export function edgeAlpha(lin: Float32Array, N: number): { alpha: Float32Array; sky: [number, number, number] } {
  const lum = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) lum[k] = 0.3 * lin[3 * k] + 0.55 * lin[3 * k + 1] + 0.15 * lin[3 * k + 2];
  const B = blur(lum.slice(), N, Math.max(2, Math.round(N * 0.015)));
  const skyL = quantile(B, 0.2);
  const topL = quantile(B, 0.995);
  const sky: [number, number, number] = [0, 0, 0];
  let n = 0;
  for (let k = 0; k < N * N; k++) {
    if (B[k] > skyL) continue;
    sky[0] += lin[3 * k];
    sky[1] += lin[3 * k + 1];
    sky[2] += lin[3 * k + 2];
    n++;
  }
  for (let c = 0; c < 3; c++) sky[c] /= Math.max(1, n);

  const span = Math.max(1e-6, topL - skyL);
  const obj = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) obj[k] = smooth(0.02, 0.22, (B[k] - skyL) / span);
  blur(obj, N, Math.max(2, Math.round(N * 0.02)));

  const S = blur(lum.slice(), N, Math.max(3, Math.round(N * 0.04)));
  const s10 = quantile(S, 0.1);
  const s95 = quantile(S, 0.95);
  const sSpan = Math.max(1e-6, s95 - s10);

  const alpha = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      const u = (x + 0.5) / N;
      const v = (y + 0.5) / N;
      const ex = u * 2 - 1;
      const ey = v * 2 - 1;
      // Squircle distance: follows the frame more closely than a circle, so less is cut away.
      const r = Math.pow(ex ** 4 + ey ** 4, 0.25);
      const s = Math.min(1, Math.max(0, (S[k] - s10) / sSpan));
      const f = r + 0.38 * (0.55 - s);
      const border = smooth(0, 0.04, Math.min(u, 1 - u, v, 1 - v));
      alpha[k] = smooth(1.0, 0.62, f) * border * (0.35 + 0.65 * obj[k]);
    }
  }
  return { alpha, sky };
}
