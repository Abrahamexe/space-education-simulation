import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, Points, ShaderMaterial } from 'three';
import vert from '../shaders/universe/sim.vert?raw';
import frag from '../shaders/universe/sim.frag?raw';

/**
 * How the cosmic web formed, as a time-lapse: the Zel'dovich approximation.
 * Every particle starts on a grid (q) and moves along a fixed displacement
 * ψ(q) scaled by the linear growth factor D(t):  x = q + D(t)·ψ(q). ψ comes
 * from a Gaussian random density field with a ΛCDM-like power spectrum (the
 * seeds seen in the CMB), so matter streams out of voids into sheets,
 * filaments and knots exactly as in N-body simulations, until shells cross
 * (smoothed here to delay that). Being analytic, any moment can be shown at
 * once and the time slider runs both ways.
 *
 * Three populations share the grid:
 *  - dark matter: the full displacement;
 *  - gas: the displacement smoothed over a few Mpc (pressure keeps gas from
 *    following the smallest dark-matter clumps), pink;
 *  - galaxies: the particles that end up in the densest places, lit from a
 *    formation time that comes earlier the denser their surroundings.
 */

/** Box side (comoving Mpc) and particles per side. */
export const SIM_BOX = 200;
const NG = 64;
/** Smoothing of the dark-matter field (Mpc): delays shell crossing (truncated Zel'dovich). */
const R_DM = 1.6;
/** Extra smoothing for gas (Mpc). */
const R_GAS = 3.5;
/** RMS displacement today (Mpc), ~ the observed value (≈ 9/h Mpc). */
const PSI_RMS = 9;

// ---- Cosmology (flat ΛCDM, Planck-like) -------------------------------------------------------

const OM = 0.31;
const OL = 0.69;
const H0_PER_GYR = 0.0693; // 67.7 km/s/Mpc in 1/Gyr

/** Cosmic time (Gyr) at scale factor a. */
export function ageGyr(a: number): number {
  return (2 / (3 * H0_PER_GYR * Math.sqrt(OL))) * Math.asinh(Math.sqrt(OL / OM) * a ** 1.5);
}
/** Scale factor at cosmic time t (Gyr). */
export function scaleAt(tGyr: number): number {
  return (Math.sqrt(OM / OL) * Math.sinh(1.5 * H0_PER_GYR * Math.sqrt(OL) * tGyr)) ** (2 / 3);
}
/** Linear growth factor, D(1) = 1 (Carroll, Press & Turner 1992). */
export function growth(a: number, Om = OM): number {
  const Ol = 1 - Om;
  const g = (x: number) => {
    const e = Om / x ** 3 + Ol;
    const om = Om / x ** 3 / e;
    const ol = Ol / e;
    return (2.5 * om) / (om ** (4 / 7) - ol + (1 + om / 2) * (1 + ol / 70));
  };
  return (a * g(a)) / g(1);
}
export const AGE_NOW = ageGyr(1);

// ---- FFT ------------------------------------------------------------------------------------

function fft1(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

function fft3(re: Float64Array, im: Float64Array, N: number, inverse: boolean): void {
  const r = new Float64Array(N);
  const i_ = new Float64Array(N);
  const idx = (x: number, y: number, z: number) => (z * N + y) * N + x;
  for (const axis of [0, 1, 2])
    for (let a = 0; a < N; a++)
      for (let b = 0; b < N; b++) {
        for (let k = 0; k < N; k++) {
          const p = axis === 0 ? idx(k, a, b) : axis === 1 ? idx(a, k, b) : idx(a, b, k);
          r[k] = re[p];
          i_[k] = im[p];
        }
        fft1(r, i_, inverse);
        for (let k = 0; k < N; k++) {
          const p = axis === 0 ? idx(k, a, b) : axis === 1 ? idx(a, k, b) : idx(a, b, k);
          re[p] = r[k];
          im[p] = i_[k];
        }
      }
}

/** Seeded Gaussian random numbers (Box–Muller over a small LCG). */
function gaussian(seed: number): () => number {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** BBKS transfer function, Γ = Ωm h. */
function transfer(kMpc: number, Om = OM): number {
  const q = kMpc / (Om * 0.677 * 0.677);
  return Math.log(1 + 2.34 * q) / (2.34 * q) / (1 + 3.89 * q + (16.1 * q) ** 2 + (5.46 * q) ** 3 + (6.71 * q) ** 4) ** 0.25;
}

export class CosmicWebSim {
  readonly group = new Group();
  readonly darkMatter: Points<BufferGeometry, ShaderMaterial>;
  readonly gas: Points<BufferGeometry, ShaderMaterial>;
  readonly galaxies: Points<BufferGeometry, ShaderMaterial>;
  /** Matter density and fluctuation amplitude (1 = σ8 0.81) this run was built with. */
  readonly om: number;
  readonly amp: number;

  /**
   * opts.amp scales the fluctuations (σ8 / 0.81); opts.om changes the matter
   * density (transfer function and growth). Same seed: same initial phases, so
   * runs can be compared side by side.
   */
  constructor(seed = 7, opts: { amp?: number; om?: number } = {}) {
    this.om = opts.om ?? OM;
    this.amp = opts.amp ?? 1;
    const N = NG;
    const N3 = N ** 3;
    const L = SIM_BOX;
    const rnd = gaussian(seed);
    // White noise → δ(k) = noise · √P(k), P ∝ k T(k)² (n_s = 1).
    const re = new Float64Array(N3);
    const im = new Float64Array(N3);
    for (let i = 0; i < N3; i++) re[i] = rnd();
    fft3(re, im, N, false);
    const kf = (n: number) => ((n <= N / 2 ? n : n - N) * 2 * Math.PI) / L;
    // Displacement ψ(k) = i k δ(k) / k² for dark matter and (smoothed) gas, and δ itself (CMB colouring).
    const comps = Array.from({ length: 7 }, () => [new Float64Array(N3), new Float64Array(N3)] as const);
    for (let z = 0; z < N; z++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const p = (z * N + y) * N + x;
          const kx = kf(x);
          const ky = kf(y);
          const kz = kf(z);
          const k2 = kx * kx + ky * ky + kz * kz;
          if (k2 === 0) continue;
          const k = Math.sqrt(k2);
          const amp = Math.sqrt(k) * transfer(k, this.om);
          const wDm = Math.exp(-0.5 * k2 * R_DM * R_DM);
          const wGas = wDm * Math.exp(-0.5 * k2 * R_GAS * R_GAS);
          const dr = re[p] * amp;
          const di = im[p] * amp;
          const ks = [kx, ky, kz];
          for (let c = 0; c < 3; c++) {
            // i·k_c/k² · (dr + i di) = (−di k_c/k²) + i (dr k_c/k²)
            const f = ks[c] / k2;
            comps[c][0][p] = -di * f * wDm;
            comps[c][1][p] = dr * f * wDm;
            comps[3 + c][0][p] = -di * f * wGas;
            comps[3 + c][1][p] = dr * f * wGas;
          }
          comps[6][0][p] = dr * wDm;
          comps[6][1][p] = di * wDm;
        }
    for (const [a, b] of comps) fft3(a, b, N, true);
    // Normalise: RMS dark-matter displacement today = PSI_RMS.
    let s2 = 0;
    for (let i = 0; i < N3; i++) s2 += comps[0][0][i] ** 2 + comps[1][0][i] ** 2 + comps[2][0][i] ** 2;
    const norm = (PSI_RMS * this.amp) / Math.sqrt(s2 / N3);
    let d2 = 0;
    for (let i = 0; i < N3; i++) d2 += comps[6][0][i] ** 2;
    const dNorm = 1 / Math.sqrt(d2 / N3);

    const q = new Float32Array(N3 * 3);
    const psi = new Float32Array(N3 * 3);
    const psiGas = new Float32Array(N3 * 3);
    const delta = new Float32Array(N3);
    const cell = L / N;
    // Start points jittered inside their cells: a perfect lattice shows as moiré.
    let js = seed * 97 + 13;
    const jit = () => (((js = (Math.imul(js, 1103515245) + 12345) >>> 0) / 4294967296) - 0.5) * 0.9 * cell;
    for (let z = 0, i = 0; z < N; z++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++, i++) {
          q.set([(x + 0.5) * cell - L / 2 + jit(), (y + 0.5) * cell - L / 2 + jit(), (z + 0.5) * cell - L / 2 + jit()], i * 3);
          psi.set([comps[0][0][i] * norm, comps[1][0][i] * norm, comps[2][0][i] * norm], i * 3);
          psiGas.set([comps[3][0][i] * norm, comps[4][0][i] * norm, comps[5][0][i] * norm], i * 3);
          delta[i] = comps[6][0][i] * dNorm;
        }

    // Where galaxies form: final (D = 1) density by cloud-in-cell on the grid; the densest
    // particles host galaxies, the denser the earlier (formation scale factor 0.07 … 0.5).
    const rho = new Float32Array(N3);
    const wrap = (v: number) => ((v % N) + N) % N;
    const fin = new Float32Array(N3 * 3);
    for (let i = 0; i < N3; i++) {
      for (let c = 0; c < 3; c++) fin[i * 3 + c] = q[i * 3 + c] + psi[i * 3 + c];
      const gx = Math.floor((fin[i * 3] + L / 2) / cell);
      const gy = Math.floor((fin[i * 3 + 1] + L / 2) / cell);
      const gz = Math.floor((fin[i * 3 + 2] + L / 2) / cell);
      rho[(wrap(gz) * N + wrap(gy)) * N + wrap(gx)] += 1;
    }
    const local = new Float32Array(N3);
    for (let i = 0; i < N3; i++) {
      const gx = wrap(Math.floor((fin[i * 3] + L / 2) / cell));
      const gy = wrap(Math.floor((fin[i * 3 + 1] + L / 2) / cell));
      const gz = wrap(Math.floor((fin[i * 3 + 2] + L / 2) / cell));
      local[i] = rho[(gz * N + gy) * N + gx];
    }
    const sorted = Float32Array.from(local).sort();
    const cut = sorted[Math.floor(N3 * 0.93)];
    const top = sorted[N3 - 1];
    const gal: number[] = [];
    for (let i = 0; i < N3; i++) {
      // Weak fluctuations: nothing collapses by today, no galaxies.
      if (this.amp < 0.25) break;
      if (local[i] <= cut) continue;
      // One galaxy per few particles in a dense cell, not all of them.
      if ((i * 2654435761) % 5 !== 0) continue;
      const r = Math.log(local[i] / cut) / Math.log(top / cut);
      // Weaker fluctuations collapse later (δ ∝ D ∝ a in the matter era).
      gal.push(i, (0.5 - 0.43 * Math.min(1, r)) / this.amp);
    }

    const make = (pos: Float32Array, disp: Float32Array, extra: Float32Array, kind: number) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aPsi', new BufferAttribute(disp, 3));
      g.setAttribute('aExtra', new BufferAttribute(extra, 1));
      const m = new ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        defines: { KIND: kind },
        uniforms: {
          uD: { value: 1 },
          uScale: { value: 1 },
          uBrightness: { value: 1 },
          uA: { value: 1 },
          uEarly: { value: 0 },
          uSlab: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const p = new Points(g, m);
      p.frustumCulled = false;
      return p;
    };
    this.darkMatter = make(q, psi, delta, 0);
    this.gas = make(q.slice(), psiGas, delta.slice(), 1);
    const nG = gal.length / 2;
    const gq = new Float32Array(nG * 3);
    const gp = new Float32Array(nG * 3);
    const ga = new Float32Array(nG);
    for (let j = 0; j < nG; j++) {
      const i = gal[j * 2];
      gq.set(q.subarray(i * 3, i * 3 + 3), j * 3);
      gp.set(psi.subarray(i * 3, i * 3 + 3), j * 3);
      ga[j] = gal[j * 2 + 1];
    }
    this.galaxies = make(gq, gp, ga, 2);
    this.group.add(this.gas, this.darkMatter, this.galaxies);
    this.group.visible = false;
  }

  /** Show the state at cosmic time t (Gyr). */
  setTime(tGyr: number): { a: number; z: number } {
    const a = scaleAt(Math.max(tGyr, 3.8e-4));
    const D = growth(a, this.om);
    // Before ~50 Myr the field is the CMB pattern: colour the matter by its seed density.
    const early = 1 - Math.min(1, Math.max(0, (Math.log10(tGyr) - Math.log10(0.02)) / (Math.log10(0.15) - Math.log10(0.02))));
    for (const p of [this.darkMatter, this.gas, this.galaxies]) {
      const u = p.material.uniforms;
      u.uD.value = D;
      u.uA.value = a;
      u.uEarly.value = early;
    }
    return { a, z: 1 / a - 1 };
  }

  setScale(s: number): void {
    for (const p of [this.darkMatter, this.gas, this.galaxies]) p.material.uniforms.uScale.value = s;
  }

  /** Show only a slab |z| < half (Mpc) of the box, 0 = the whole box. */
  setSlab(half: number): void {
    for (const p of [this.darkMatter, this.gas, this.galaxies]) p.material.uniforms.uSlab.value = half;
  }
}
