import { FFT3 } from './fft.ts';

/**
 * A cosmic web in the Zel'dovich approximation: particles start on a grid q and move along a fixed
 * displacement field ψ(q) scaled by the growth factor D, x = q + D·ψ. ψ comes from a Gaussian random
 * density field with a BBKS (Bardeen et al. 1986) power spectrum: ψ_k = i k δ_k / k². The gas follows
 * the same field smoothed on a pressure scale (`gasScale`, Mpc). Amplitude: rms |ψ| = PSI_RMS Mpc at D = 1.
 */
export interface Web {
  n: number;
  box: number;
  /** Grid positions, xyz triplets (Mpc, centred on 0). */
  q: Float32Array;
  /** Displacement per unit D, xyz triplets (Mpc). */
  psi: Float32Array;
  psiGas: Float32Array;
}

/** rms displacement (Mpc) at D = 1: a display normalisation, shell crossing sets in around D ≈ 1. */
const PSI_RMS = 9;
const OM_H = 0.21; // Γ = Ω_m h

function bbks(k: number): number {
  const q = k / OM_H;
  if (q <= 0) return 0;
  return Math.log(1 + 2.34 * q) / (2.34 * q) / (1 + 3.89 * q + (16.1 * q) ** 2 + (5.46 * q) ** 3 + (6.71 * q) ** 4) ** 0.25;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeWeb(opts: { n: number; box: number; seed: number; gasScale: number }): Web {
  const { n, box, gasScale } = opts;
  const N = n ** 3;
  const r = rng(opts.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
  const fft = new FFT3(n);
  // White noise -> Fourier space.
  const dRe = new Float64Array(N);
  const dIm = new Float64Array(N);
  for (let i = 0; i < N; i++) dRe[i] = gauss();
  fft.transform(dRe, dIm, false);
  const kOf = (i: number) => ((2 * Math.PI) / box) * (i < n / 2 ? i : i - n);
  const comps = [0, 1, 2].map(() => [new Float64Array(N), new Float64Array(N)] as const);
  const compsGas = [0, 1, 2].map(() => [new Float64Array(N), new Float64Array(N)] as const);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let l = 0; l < n; l++) {
        const o = (i * n + j) * n + l;
        // Drop the k = 0 mode and the Nyquist planes (keeps the result real and zero-mean).
        if (i === n / 2 || j === n / 2 || l === n / 2 || (i | j | l) === 0) continue;
        const k = [kOf(i), kOf(j), kOf(l)];
        const k2 = k[0] * k[0] + k[1] * k[1] + k[2] * k[2];
        const kk = Math.sqrt(k2);
        const amp = Math.sqrt(kk * bbks(kk) ** 2); // √P(k), P ∝ k T²(k)
        const re = dRe[o] * amp;
        const im = dIm[o] * amp;
        const smooth = Math.exp(-0.5 * k2 * gasScale * gasScale);
        for (let a = 0; a < 3; a++) {
          // ψ_k = i k_a δ_k / k²  ->  (−k_a Im δ, k_a Re δ) / k²
          comps[a][0][o] = (-k[a] * im) / k2;
          comps[a][1][o] = (k[a] * re) / k2;
          compsGas[a][0][o] = comps[a][0][o] * smooth;
          compsGas[a][1][o] = comps[a][1][o] * smooth;
        }
      }
  const psi = new Float32Array(3 * N);
  const psiGas = new Float32Array(3 * N);
  for (let a = 0; a < 3; a++) {
    fft.transform(comps[a][0], comps[a][1], true);
    fft.transform(compsGas[a][0], compsGas[a][1], true);
    for (let o = 0; o < N; o++) {
      psi[3 * o + a] = comps[a][0][o];
      psiGas[3 * o + a] = compsGas[a][0][o];
    }
  }
  // Normalise both with the dark matter's rms, so the gas keeps its smaller amplitude.
  let s = 0;
  for (let i = 0; i < psi.length; i++) s += psi[i] * psi[i];
  const norm = PSI_RMS / Math.sqrt((s / N) || 1);
  for (let i = 0; i < psi.length; i++) {
    psi[i] *= norm;
    psiGas[i] *= norm;
  }
  const q = new Float32Array(3 * N);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let l = 0; l < n; l++) {
        const o = 3 * ((i * n + j) * n + l);
        q[o] = ((i + 0.5) / n - 0.5) * box;
        q[o + 1] = ((j + 0.5) / n - 0.5) * box;
        q[o + 2] = ((l + 0.5) / n - 0.5) * box;
      }
  return { n, box, q, psi, psiGas };
}

/** x = q + D·ψ for the dark matter and q + Dgas·ψ_gas for the gas, wrapped into the periodic box. */
export function positionsAt(web: Web, D: number, Dgas: number, out: Float32Array, outGas: Float32Array): void {
  const { q, psi, psiGas, box } = web;
  const half = box / 2;
  const wrap = (v: number) => (v >= half ? v - box : v < -half ? v + box : v);
  for (let i = 0; i < q.length; i++) {
    out[i] = wrap(q[i] + D * psi[i]);
    outGas[i] = wrap(q[i] + Dgas * psiGas[i]);
  }
}
