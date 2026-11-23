// Bullet Cluster collision, off the main thread.
// Particle-mesh N-body (DM + gas + massless galaxy tracers), a deliberately
// simplified gas (isothermal pressure + drag on a coarse grid) and Monte Carlo
// self-interacting dark matter. Units: Mpc, Gyr, Msun.
//
// The simulation core (BulletSim) is exported so it can be tested in Node; the
// message handler at the bottom only registers inside a real Worker.

/** G in Mpc^3 Msun^-1 Gyr^-2: 6.674e-11 * 1.989e30 * (3.156e16)^2 / (3.0857e22)^3. */
export const G = 4.498e-15;
/** 1 km/s in Mpc/Gyr. */
export const KMS = 1.0227e-3;
/** 1 cm^2/g in Mpc^2/Msun: 0.1 m^2/kg * 1.989e30 kg / (3.0857e22 m)^2. */
export const CM2_PER_G = 2.089e-16;

export type ToWorker = { type: 'init'; sigmaOverM: number } | { type: 'run' } | { type: 'pause' } | { type: 'reset'; sigmaOverM: number };

export interface BulletDiag {
  /** Separation of the two DM peaks (kpc, 3D). */
  sep: number;
  /** Subcluster gas lag behind its DM peak along x (kpc; positive = behind the direction of motion). */
  gasOff: number;
  /** Subcluster galaxy lag behind its DM peak along x (kpc). */
  galOff: number;
  /** Cumulative number of SIDM scatterings so far. */
  scatters: number;
}

export interface BulletReady {
  type: 'ready';
  /** Gas array holds `nGasMain` main-cluster particles, then the subcluster's. */
  nGasMain: number;
  mDmMain: number;
  mDmSub: number;
  mGasMain: number;
  mGasSub: number;
  tEnd: number;
}

export interface BulletFrame {
  type: 'frame';
  t: number;
  dmMain: Float32Array;
  dmSub: Float32Array;
  gas: Float32Array;
  gal: Float32Array;
  diag: BulletDiag;
}

export type FromWorker = BulletReady | BulletFrame | { type: 'done' };

// ---- Setup ------------------------------------------------------------------------------------

const N_DM_MAIN = 6000;
const N_DM_SUB = 2000;
const N_GAS_MAIN = 3000;
const N_GAS_SUB = 1000;
const N_GAL_MAIN = 300;
const N_GAL_SUB = 100;
const N = N_DM_MAIN + N_DM_SUB + N_GAS_MAIN + N_GAS_SUB + N_GAL_MAIN + N_GAL_SUB;
// Contiguous index ranges (start, end) per population.
const R_DM_MAIN: [number, number] = [0, N_DM_MAIN];
const R_DM_SUB: [number, number] = [N_DM_MAIN, N_DM_MAIN + N_DM_SUB];
const R_GAS_MAIN: [number, number] = [R_DM_SUB[1], R_DM_SUB[1] + N_GAS_MAIN];
const R_GAS_SUB: [number, number] = [R_GAS_MAIN[1], R_GAS_MAIN[1] + N_GAS_SUB];
const R_GAL_MAIN: [number, number] = [R_GAS_SUB[1], R_GAS_SUB[1] + N_GAL_MAIN];
const R_GAL_SUB: [number, number] = [R_GAL_MAIN[1], R_GAL_MAIN[1] + N_GAL_SUB];

const M_MAIN = 1.5e15;
const M_SUB = 1.5e14;
const A_MAIN = 0.35;
const A_SUB = 0.15;
const R_CUT_MAIN = 2;
const R_CUT_SUB = 1;
const GAS_FRAC = 0.15;
const GAS_EXTENT = 1.3;

/**
 * Tunable physics. Orbit: separation (Mpc), relative speed (Mpc/Gyr), impact parameter (Mpc).
 * Gas: the drag coefficient kappa (Mpc^3 Msun^-1 Gyr^-1; drag rate = kappa * rho_gas per Gyr).
 *
 * Tuning notes. The naive kappa ~ 3e-14 (streams stopped within ~0.2 Mpc) strips the subcluster gas
 * completely and leaves it >1 Mpc behind; kappa = 4e-15 gives a
 * gas-DM lag of order 200 kpc ~0.15 Gyr after pericentre, as observed. Separation 2.2 Mpc and
 * speed 3500 km/s put pericentre near 0.5 Gyr: gravity barely accelerates the pair at these
 * speeds, so 3.5 Mpc at 3000 km/s would take ~0.9 Gyr.
 */
export const params = { separation: 2.2, vRel: 3500 * KMS, impact: 0.15, kappa: 4e-15 };

export const DT = 0.002;
export const T_END = 1.2;

// PM grid: 64^3 cells over a periodic 10 Mpc cube (cell 0.156 Mpc; effective Plummer-like softening ~0.1 Mpc).
const PM_N = 64;
const PM_L = 10;
// Gas/SIDM grid: 64^3 over the central 6 Mpc (not periodic), 0.094 Mpc cells. Coarser grids (32^3, 48^3)
// underestimate the pressure gradient in the cores (about half of the needed support) and the gas collapses.
const HY_N = 64;
const HY_L = 6;

/** Density floor for ln(rho) gradients (Msun/Mpc^3): keeps sparse outskirts from blowing up. */
const RHO_FLOOR = 2e11;

// ---- Random numbers ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- FFT --------------------------------------------------------------------------------------

/** Small radix-2 complex 3D FFT on an n^3 cube stored as (i*n + j)*n + k. */
class FFT3 {
  private readonly cosT: Float64Array;
  private readonly sinT: Float64Array;
  private readonly rev: Uint32Array;
  private readonly lr: Float64Array;
  private readonly li: Float64Array;
  private readonly n: number;

  constructor(n: number) {
    this.n = n;
    this.cosT = new Float64Array(n / 2);
    this.sinT = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cosT[k] = Math.cos((2 * Math.PI * k) / n);
      this.sinT[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.lr = new Float64Array(n);
    this.li = new Float64Array(n);
  }

  private line(sign: number): void {
    const { n, lr, li, rev, cosT, sinT } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = lr[i];
        lr[i] = lr[j];
        lr[j] = t;
        t = li[i];
        li[i] = li[j];
        li[j] = t;
      }
    }
    // Stages 2 and 4 need no table lookups (twiddles are 1 and sign * i).
    for (let s = 0; s < n; s += 4) {
      const ar = lr[s] + lr[s + 1];
      const ai = li[s] + li[s + 1];
      const br = lr[s] - lr[s + 1];
      const bi = li[s] - li[s + 1];
      const cr = lr[s + 2] + lr[s + 3];
      const ci = li[s + 2] + li[s + 3];
      const er = lr[s + 2] - lr[s + 3];
      const ei = li[s + 2] - li[s + 3];
      const tr = -sign * ei;
      const ti = sign * er;
      lr[s] = ar + cr;
      li[s] = ai + ci;
      lr[s + 2] = ar - cr;
      li[s + 2] = ai - ci;
      lr[s + 1] = br + tr;
      li[s + 1] = bi + ti;
      lr[s + 3] = br - tr;
      li[s + 3] = bi - ti;
    }
    for (let size = 8; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = cosT[t];
          const wi = sign * sinT[t];
          const a = s + k;
          const b = a + half;
          const xr = lr[b] * wr - li[b] * wi;
          const xi = lr[b] * wi + li[b] * wr;
          lr[b] = lr[a] - xr;
          li[b] = li[a] - xi;
          lr[a] += xr;
          li[a] += xi;
        }
      }
    }
  }

  /** In-place transform (forward: exp(-i...)); the inverse is not normalised. */
  transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const { n, lr, li } = this;
    const sign = inverse ? 1 : -1;
    const strides = [1, n, n * n];
    for (let axis = 0; axis < 3; axis++) {
      const st = strides[axis];
      for (let p = 0; p < n; p++) {
        for (let q = 0; q < n; q++) {
          // Line start: the two other indices are (p, q).
          const base = axis === 0 ? p * n * n + q * n : axis === 1 ? p * n * n + q : p * n + q;
          for (let m = 0, o = base; m < n; m++, o += st) {
            lr[m] = re[o];
            li[m] = im[o];
          }
          this.line(sign);
          for (let m = 0, o = base; m < n; m++, o += st) {
            re[o] = lr[m];
            im[o] = li[m];
          }
        }
      }
    }
  }
}

// ---- Particle-mesh gravity --------------------------------------------------------------------

class ParticleMesh {
  private readonly n = PM_N;
  private readonly h = PM_L / PM_N;
  private readonly fft = new FFT3(PM_N);
  private readonly re = new Float64Array(PM_N ** 3);
  private readonly im = new Float64Array(PM_N ** 3);
  private readonly kernel = new Float64Array(PM_N ** 3);
  private readonly gx = new Float64Array(PM_N ** 3);
  private readonly gy = new Float64Array(PM_N ** 3);
  private readonly gz = new Float64Array(PM_N ** 3);

  constructor() {
    const { n, h } = this;
    // phi_k = 4 pi G rho_k / lambda, with lambda the eigenvalue of the 7-point Laplacian;
    // 1/h^3 converts deposited mass to density. k = 0 (mean density) is dropped: the box is
    // periodic, so only the density contrast sources gravity.
    const c = new Float64Array(n);
    for (let a = 0; a < n; a++) c[a] = (2 * Math.cos((2 * Math.PI * a) / n) - 2) / (h * h);
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++)
        for (let d = 0; d < n; d++) {
          const lam = c[a] + c[b] + c[d];
          this.kernel[(a * n + b) * n + d] = lam === 0 ? 0 : (4 * Math.PI * G) / (lam * h * h * h);
        }
  }

  /** Cloud-in-cell deposit, solve, differentiate. Positions are already wrapped into the box. */
  solve(x: Float64Array, y: Float64Array, z: Float64Array, m: Float64Array): void {
    const { n, h, re, im, kernel } = this;
    re.fill(0);
    im.fill(0);
    const mask = n - 1;
    const inv = 1 / h;
    for (let p = 0; p < x.length; p++) {
      const mp = m[p];
      if (mp === 0) continue;
      const ux = (x[p] + PM_L / 2) * inv;
      const uy = (y[p] + PM_L / 2) * inv;
      const uz = (z[p] + PM_L / 2) * inv;
      const i0 = Math.floor(ux);
      const j0 = Math.floor(uy);
      const k0 = Math.floor(uz);
      const fx = ux - i0;
      const fy = uy - j0;
      const fz = uz - k0;
      for (let a = 0; a < 2; a++) {
        const wx = a ? fx : 1 - fx;
        const ii = (i0 + a) & mask;
        for (let b = 0; b < 2; b++) {
          const wy = wx * (b ? fy : 1 - fy);
          const jj = (j0 + b) & mask;
          for (let c = 0; c < 2; c++) {
            re[(ii * n + jj) * n + ((k0 + c) & mask)] += mp * wy * (c ? fz : 1 - fz);
          }
        }
      }
    }
    this.fft.transform(re, im, false);
    for (let i = 0; i < re.length; i++) {
      re[i] *= kernel[i];
      im[i] *= kernel[i];
    }
    this.fft.transform(re, im, true);
    const norm = 1 / (n * n * n);
    // Acceleration a = -grad(phi), central differences (periodic).
    const s = n * n;
    const half = 1 / (2 * h);
    for (let i = 0; i < n; i++) {
      const ip = (i + 1) & mask;
      const im1 = (i - 1) & mask;
      for (let j = 0; j < n; j++) {
        const jp = (j + 1) & mask;
        const jm = (j - 1) & mask;
        for (let k = 0; k < n; k++) {
          const kp = (k + 1) & mask;
          const km = (k - 1) & mask;
          const o = (i * n + j) * n + k;
          this.gx[o] = -(re[ip * s + j * n + k] - re[im1 * s + j * n + k]) * half * norm;
          this.gy[o] = -(re[i * s + jp * n + k] - re[i * s + jm * n + k]) * half * norm;
          this.gz[o] = -(re[i * s + j * n + kp] - re[i * s + j * n + km]) * half * norm;
        }
      }
    }
  }

  /** CIC-interpolate the field back to every particle (same kernel as the deposit). */
  accelerations(x: Float64Array, y: Float64Array, z: Float64Array, ax: Float64Array, ay: Float64Array, az: Float64Array): void {
    const { n, h, gx, gy, gz } = this;
    const mask = n - 1;
    const inv = 1 / h;
    for (let p = 0; p < x.length; p++) {
      const ux = (x[p] + PM_L / 2) * inv;
      const uy = (y[p] + PM_L / 2) * inv;
      const uz = (z[p] + PM_L / 2) * inv;
      const i0 = Math.floor(ux);
      const j0 = Math.floor(uy);
      const k0 = Math.floor(uz);
      const fx = ux - i0;
      const fy = uy - j0;
      const fz = uz - k0;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let a = 0; a < 2; a++) {
        const wx = a ? fx : 1 - fx;
        const ii = (i0 + a) & mask;
        for (let b = 0; b < 2; b++) {
          const wy = wx * (b ? fy : 1 - fy);
          const jj = (j0 + b) & mask;
          for (let c = 0; c < 2; c++) {
            const w = wy * (c ? fz : 1 - fz);
            const o = (ii * n + jj) * n + ((k0 + c) & mask);
            sx += w * gx[o];
            sy += w * gy[o];
            sz += w * gz[o];
          }
        }
      }
      ax[p] = sx;
      ay[p] = sy;
      az[p] = sz;
    }
  }
}

// ---- Gas / SIDM grid --------------------------------------------------------------------------

/** Coarse grid holding gas and DM density and mean velocity plus the gas ln(rho) gradient. */
class HydroGrid {
  readonly n = HY_N;
  readonly h = HY_L / HY_N;
  private readonly size = HY_N ** 3;
  readonly rhoG = new Float64Array(this.size);
  readonly pxG = new Float64Array(this.size);
  readonly pyG = new Float64Array(this.size);
  readonly pzG = new Float64Array(this.size);
  readonly rhoD = new Float64Array(this.size);
  readonly pxD = new Float64Array(this.size);
  readonly pyD = new Float64Array(this.size);
  readonly pzD = new Float64Array(this.size);
  readonly glx = new Float64Array(this.size);
  readonly gly = new Float64Array(this.size);
  readonly glz = new Float64Array(this.size);
  // Stencil of the last locate().
  private base = 0;
  private fx = 0;
  private fy = 0;
  private fz = 0;

  /** Locate the particle on the grid; false if it lies outside (no hydro/SIDM there). */
  locate(x: number, y: number, z: number): boolean {
    const n = this.n;
    const inv = 1 / this.h;
    const ux = (x + HY_L / 2) * inv;
    const uy = (y + HY_L / 2) * inv;
    const uz = (z + HY_L / 2) * inv;
    if (!(ux >= 0 && uy >= 0 && uz >= 0 && ux < n - 1 && uy < n - 1 && uz < n - 1)) return false;
    const i0 = Math.floor(ux);
    const j0 = Math.floor(uy);
    const k0 = Math.floor(uz);
    this.fx = ux - i0;
    this.fy = uy - j0;
    this.fz = uz - k0;
    this.base = (i0 * n + j0) * n + k0;
    return true;
  }

  private deposit(
    x: Float64Array,
    y: Float64Array,
    z: Float64Array,
    vx: Float64Array,
    vy: Float64Array,
    vz: Float64Array,
    m: Float64Array,
    from: number,
    to: number,
    rho: Float64Array,
    px: Float64Array,
    py: Float64Array,
    pz: Float64Array,
  ): void {
    const n = this.n;
    const s = n * n;
    for (let p = from; p < to; p++) {
      if (!this.locate(x[p], y[p], z[p])) continue;
      const { base, fx, fy, fz } = this;
      const mp = m[p];
      for (let a = 0; a < 2; a++) {
        const wx = a ? fx : 1 - fx;
        for (let b = 0; b < 2; b++) {
          const wy = wx * (b ? fy : 1 - fy);
          for (let c = 0; c < 2; c++) {
            const w = mp * wy * (c ? fz : 1 - fz);
            const o = base + a * s + b * n + c;
            rho[o] += w;
            px[o] += w * vx[p];
            py[o] += w * vy[p];
            pz[o] += w * vz[p];
          }
        }
      }
    }
  }

  build(
    x: Float64Array,
    y: Float64Array,
    z: Float64Array,
    vx: Float64Array,
    vy: Float64Array,
    vz: Float64Array,
    m: Float64Array,
  ): void {
    for (const a of [this.rhoG, this.pxG, this.pyG, this.pzG, this.rhoD, this.pxD, this.pyD, this.pzD]) a.fill(0);
    this.deposit(x, y, z, vx, vy, vz, m, R_GAS_MAIN[0], R_GAS_SUB[1], this.rhoG, this.pxG, this.pyG, this.pzG);
    this.deposit(x, y, z, vx, vy, vz, m, R_DM_MAIN[0], R_DM_SUB[1], this.rhoD, this.pxD, this.pyD, this.pzD);
    // Mass -> density and momentum density.
    const inv = 1 / (this.h * this.h * this.h);
    for (const a of [this.rhoG, this.pxG, this.pyG, this.pzG, this.rhoD, this.pxD, this.pyD, this.pzD]) for (let i = 0; i < a.length; i++) a[i] *= inv;
    const n = this.n;
    const s = n * n;
    const d = 1 / (2 * this.h);
    // Unsmoothed density: any extra smoothing weakens the gradient and the gas sags below hydrostatic equilibrium.
    const f = this.rhoG;
    this.glx.fill(0);
    this.gly.fill(0);
    this.glz.fill(0);
    for (let i = 1; i < n - 1; i++)
      for (let j = 1; j < n - 1; j++)
        for (let k = 1; k < n - 1; k++) {
          const o = (i * n + j) * n + k;
          const den = 1 / (f[o] + RHO_FLOOR);
          this.glx[o] = (f[o + s] - f[o - s]) * d * den;
          this.gly[o] = (f[o + n] - f[o - n]) * d * den;
          this.glz[o] = (f[o + 1] - f[o - 1]) * d * den;
        }
  }

  /** Trilinear sample of a field at the last located stencil. */
  at(f: Float64Array): number {
    const { base, fx, fy, fz, n } = this;
    const s = n * n;
    const c00 = f[base] * (1 - fz) + f[base + 1] * fz;
    const c01 = f[base + n] * (1 - fz) + f[base + n + 1] * fz;
    const c10 = f[base + s] * (1 - fz) + f[base + s + 1] * fz;
    const c11 = f[base + s + n] * (1 - fz) + f[base + s + n + 1] * fz;
    return (c00 * (1 - fy) + c01 * fy) * (1 - fx) + (c10 * (1 - fy) + c11 * fy) * fx;
  }
}

// ---- Initial conditions -----------------------------------------------------------------------

/**
 * Plummer softening assumed for the force the particles feel, Mpc. Calibrated: the CIC/PM force of a
 * Hernquist halo keeps isolated DM in equilibrium for eps ~ 0.1 Mpc (0.2 contracts the main
 * cluster, 0.08 lets the subcluster puff up); the grid cell itself is 0.156 Mpc.
 */
const EPS = 0.1;
/** Gas temperature relative to the mean DM velocity dispersion (c_s^2 = T_FACTOR <sigma^2>). */
const T_FACTOR = 1.4;

/**
 * Isotropic 1D velocity dispersion from the Jeans equation, sigma^2 rho = int_r^inf rho g ds, for the
 * Hernquist DM density in a total enclosed mass `mEnc(r)` (DM + gas). The force is Plummer-softened,
 * so the sampled cluster is in equilibrium with the force the particles will actually feel; the closed
 * form of Hernquist (1990, eq. 10) assumes a point-mass 1/r^2 force and would leave the small
 * subcluster too hot.
 */
function jeansSigma(mDmH: number, a: number, mEnc: (r: number) => number): (r: number) => number {
  const nt = 500;
  const lo = Math.log(1e-3);
  const hi = Math.log(80);
  const dl = (hi - lo) / (nt - 1);
  const integrand = new Float64Array(nt);
  const rho = new Float64Array(nt);
  for (let i = 0; i < nt; i++) {
    const r = Math.exp(lo + i * dl);
    rho[i] = (mDmH * a) / (2 * Math.PI * r * (r + a) ** 3);
    const g = (G * mEnc(r) * r) / (r * r + EPS * EPS) ** 1.5;
    integrand[i] = rho[i] * g * r; // times d ln r
  }
  const sig = new Float64Array(nt);
  let acc = 0;
  for (let i = nt - 1; i >= 0; i--) {
    if (i < nt - 1) acc += 0.5 * (integrand[i] + integrand[i + 1]) * dl;
    sig[i] = Math.sqrt(acc / rho[i]);
  }
  return (r) => {
    const u = (Math.log(Math.max(r, 1e-3)) - lo) / dl;
    const i = Math.min(nt - 2, Math.max(0, Math.floor(u)));
    const f = u - i;
    return sig[i] * (1 - f) + sig[i + 1] * f;
  };
}

interface ClusterModel {
  /** DM (and galaxy) velocity dispersion at radius r. */
  sigma: (r: number) => number;
  /** Isothermal gas sound speed squared (Mpc/Gyr)^2. */
  cs2: number;
  /** Radius enclosing the given fraction of the gas mass. */
  gasRadius: (u: number) => number;
}

/**
 * DM Hernquist halo plus gas in hydrostatic equilibrium. The gas is isothermal with c_s^2 equal to the
 * mass-weighted mean DM velocity dispersion times T_FACTOR = 1.4, so
 * dP/dr = -rho_g g(r) gives rho_g ~ exp(-(Phi(r) - Phi(0)) / c_s^2) in the softened potential of
 * DM + gas. The gas mass enters the potential, so the profile is iterated to convergence. The gas
 * is truncated at the same radius as the DM and normalised to GAS_FRAC of the DM mass.
 */
function clusterModel(mDm: number, a: number, rcut: number): ClusterModel {
  const hMass = mDm / (rcut / (rcut + a)) ** 2; // Hernquist mass such that M(<rcut) = mDm
  const mGasTot = GAS_FRAC * mDm;
  const n = 1500;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = rcut * (i / (n - 1)) ** 2; // finer toward the centre
  const mDmEnc = (x: number) => (hMass * x * x) / (x + a) ** 2;
  // First guess of the gas enclosed mass: a Hernquist shape, a little more extended than the DM.
  const ag = a * GAS_EXTENT;
  let mGas = Float64Array.from(r, (x) => (mGasTot * (x / (x + ag)) ** 2) / (rcut / (rcut + ag)) ** 2);
  const lookup = (tab: Float64Array) => (x: number) => {
    if (x >= rcut) return tab[n - 1];
    // r is a square grid: index = (n-1) sqrt(x / rcut)
    const u = (n - 1) * Math.sqrt(x / rcut);
    const i = Math.min(n - 2, Math.floor(u));
    return tab[i] + (tab[i + 1] - tab[i]) * (u - i);
  };
  const totalEnc = (tab: Float64Array) => (x: number) => mDmEnc(Math.min(x, 1e6)) + lookup(tab)(x);
  // c_s^2 = <sigma^2> over the DM distribution (mass-weighted, inside rcut).
  const sig0 = jeansSigma(hMass, a, totalEnc(mGas));
  let num = 0;
  let den = 0;
  for (let i = 1; i < n; i++) {
    const rm = 0.5 * (r[i] + r[i - 1]);
    const dm = mDmEnc(r[i]) - mDmEnc(r[i - 1]);
    num += dm * sig0(rm) ** 2;
    den += dm;
  }
  const cs2 = T_FACTOR * (num / den);
  // Hydrostatic gas profile, iterated because the gas contributes to its own potential.
  let rhoCum = new Float64Array(n);
  for (let it = 0; it < 12; it++) {
    const enc = totalEnc(mGas);
    const dPhi = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const g0 = (G * enc(r[i - 1]) * r[i - 1]) / (r[i - 1] ** 2 + EPS * EPS) ** 1.5;
      const g1 = (G * enc(r[i]) * r[i]) / (r[i] ** 2 + EPS * EPS) ** 1.5;
      dPhi[i] = dPhi[i - 1] + 0.5 * (g0 + g1) * (r[i] - r[i - 1]);
    }
    rhoCum = new Float64Array(n);
    let prev = 0;
    for (let i = 1; i < n; i++) {
      const rho0 = Math.exp(-dPhi[i - 1] / cs2) * r[i - 1] ** 2;
      const rho1 = Math.exp(-dPhi[i] / cs2) * r[i] ** 2;
      prev += 0.5 * (rho0 + rho1) * (r[i] - r[i - 1]);
      rhoCum[i] = prev;
    }
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) next[i] = (mGasTot * rhoCum[i]) / rhoCum[n - 1];
    mGas = next;
  }
  const sigma = jeansSigma(hMass, a, totalEnc(mGas));
  const gasRadius = (u: number) => {
    // Invert the cumulative gas mass (monotonic) by bisection on the table.
    const target = u * mGasTot;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (mGas[mid] < target) lo = mid;
      else hi = mid;
    }
    const f = (target - mGas[lo]) / Math.max(mGas[hi] - mGas[lo], 1e-30);
    return r[lo] + f * (r[hi] - r[lo]);
  };
  return { sigma, cs2, gasRadius };
}

// ---- Simulation -------------------------------------------------------------------------------

export class BulletSim {
  t = 0;
  scatters = 0;
  readonly sigmaOverM: number; // Mpc^2/Msun
  readonly mDmMain = M_MAIN / N_DM_MAIN;
  readonly mDmSub = M_SUB / N_DM_SUB;
  readonly mGasMain = (GAS_FRAC * M_MAIN) / N_GAS_MAIN;
  readonly mGasSub = (GAS_FRAC * M_SUB) / N_GAS_SUB;
  readonly x = new Float64Array(N);
  readonly y = new Float64Array(N);
  readonly z = new Float64Array(N);
  readonly vx = new Float64Array(N);
  readonly vy = new Float64Array(N);
  readonly vz = new Float64Array(N);
  readonly m = new Float64Array(N);
  /** 0 main, 1 subcluster. */
  readonly cluster = new Uint8Array(N);
  /** 0 dm, 1 gas, 2 galaxy. */
  readonly kind = new Uint8Array(N);
  /** Isothermal sound speed squared per cluster, from the hydrostatic gas model. */
  readonly cs2 = [0, 0];
  private readonly ax = new Float64Array(N);
  private readonly ay = new Float64Array(N);
  private readonly az = new Float64Array(N);
  private readonly pm = new ParticleMesh();
  private readonly grid = new HydroGrid();
  private readonly rand: () => number;
  private cDmSub: [number, number, number] = [0, 0, 0];
  private cDmMain: [number, number, number] = [0, 0, 0];
  private cGas: [number, number, number] = [0, 0, 0];
  private cGal: [number, number, number] = [0, 0, 0];

  /** `sigmaOverM` in cm^2/g. The seed is fixed so runs with different sigma/m share their ICs. */
  constructor(sigmaOverMcm2g: number, seed = 20060822) {
    this.sigmaOverM = sigmaOverMcm2g * CM2_PER_G;
    this.rand = mulberry32(seed);
    this.buildInitialConditions();
    this.forces();
    this.diagnostics();
  }

  private gauss(): number {
    const u = Math.max(this.rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  private buildInitialConditions(): void {
    const mtot = (1 + GAS_FRAC) * (M_MAIN + M_SUB);
    const mMain = (1 + GAS_FRAC) * M_MAIN;
    const mSub = (1 + GAS_FRAC) * M_SUB;
    // Centre of mass at rest at the origin; relative motion along x, offset b in y.
    const xMain = (-params.separation * mSub) / mtot;
    const xSub = (params.separation * mMain) / mtot;
    const yMain = (-params.impact * mSub) / mtot;
    const ySub = (params.impact * mMain) / mtot;
    const vMain = (params.vRel * mSub) / mtot;
    const vSub = (-params.vRel * mMain) / mtot;

    const clusters = [
      { id: 0, mDm: M_MAIN, a: A_MAIN, rcut: R_CUT_MAIN, c: [xMain, yMain, 0], v: vMain, nDm: R_DM_MAIN, nGas: R_GAS_MAIN, nGal: R_GAL_MAIN, mpDm: this.mDmMain, mpGas: this.mGasMain },
      { id: 1, mDm: M_SUB, a: A_SUB, rcut: R_CUT_SUB, c: [xSub, ySub, 0], v: vSub, nDm: R_DM_SUB, nGas: R_GAS_SUB, nGal: R_GAL_SUB, mpDm: this.mDmSub, mpGas: this.mGasSub },
    ];
    for (const cl of clusters) {
      const model = clusterModel(cl.mDm, cl.a, cl.rcut);
      const sigma = model.sigma;
      this.cs2[cl.id] = model.cs2;
      const place = (i: number, a: number, kind: number, dispersion: boolean) => {
        let r = Infinity;
        if (kind === 1) {
          r = model.gasRadius(this.rand());
        } else {
          // Hernquist inverse CDF r = a sqrt(u)/(1 - sqrt(u)); resample beyond the truncation radius.
          while (r > cl.rcut) {
            const su = Math.sqrt(this.rand());
            r = (a * su) / (1 - su);
          }
        }
        const mu = 2 * this.rand() - 1;
        const ph = 2 * Math.PI * this.rand();
        const st = Math.sqrt(1 - mu * mu);
        this.x[i] = cl.c[0] + r * st * Math.cos(ph);
        this.y[i] = cl.c[1] + r * st * Math.sin(ph);
        this.z[i] = cl.c[2] + r * mu;
        const s = dispersion ? sigma(r) : 0;
        this.vx[i] = cl.v + s * this.gauss();
        this.vy[i] = s * this.gauss();
        this.vz[i] = s * this.gauss();
        this.cluster[i] = cl.id;
        this.kind[i] = kind;
      };
      for (let i = cl.nDm[0]; i < cl.nDm[1]; i++) {
        place(i, cl.a, 0, true);
        this.m[i] = cl.mpDm;
      }
      // Gas: hydrostatic isothermal profile, at rest in the cluster frame (pressure supports it).
      for (let i = cl.nGas[0]; i < cl.nGas[1]; i++) {
        place(i, cl.a, 1, false);
        this.m[i] = cl.mpGas;
      }
      // Galaxies: massless tracers of the DM distribution.
      for (let i = cl.nGal[0]; i < cl.nGal[1]; i++) {
        place(i, cl.a, 2, true);
        this.m[i] = 0;
      }
    }
  }

  /** PM gravity for everything, plus isothermal pressure on the gas. Fills ax, ay, az. */
  private forces(): void {
    const { x, y, z, vx, vy, vz, m, ax, ay, az, grid } = this;
    this.pm.solve(x, y, z, m);
    this.pm.accelerations(x, y, z, ax, ay, az);
    grid.build(x, y, z, vx, vy, vz, m);
    for (let i = R_GAS_MAIN[0]; i < R_GAS_SUB[1]; i++) {
      if (!grid.locate(x[i], y[i], z[i])) continue;
      const c2 = this.cs2[this.cluster[i]];
      ax[i] -= c2 * grid.at(grid.glx);
      ay[i] -= c2 * grid.at(grid.gly);
      az[i] -= c2 * grid.at(grid.glz);
    }
  }

  /** Gas drag toward the local mean gas velocity and Monte Carlo SIDM, using the grid from forces(). */
  private collisions(dt: number): void {
    const { x, y, z, vx, vy, vz, grid } = this;
    for (let i = R_GAS_MAIN[0]; i < R_GAS_SUB[1]; i++) {
      if (!grid.locate(x[i], y[i], z[i])) continue;
      const rho = grid.at(grid.rhoG);
      if (rho <= 0) continue;
      const ux = grid.at(grid.pxG) / rho;
      const uy = grid.at(grid.pyG) / rho;
      const uz = grid.at(grid.pzG) / rho;
      // Exact exponential relaxation (stable for any dt); momentum-conserving as the target is
      // the mass-weighted mean. The dissipated kinetic energy is simply dropped (no heating).
      const f = Math.exp(-params.kappa * rho * dt);
      vx[i] = ux + (vx[i] - ux) * f;
      vy[i] = uy + (vy[i] - uy) * f;
      vz[i] = uz + (vz[i] - uz) * f;
    }
    if (this.sigmaOverM <= 0) return;
    for (let i = R_DM_MAIN[0]; i < R_DM_SUB[1]; i++) {
      if (!grid.locate(x[i], y[i], z[i])) continue;
      const rho = grid.at(grid.rhoD);
      if (rho <= 0) continue;
      const ux = grid.at(grid.pxD) / rho;
      const uy = grid.at(grid.pyD) / rho;
      const uz = grid.at(grid.pzD) / rho;
      const wx = vx[i] - ux;
      const wy = vy[i] - uy;
      const wz = vz[i] - uz;
      const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
      // Scattering probability this step: rho (sigma/m) |v - u| dt.
      if (this.rand() >= rho * this.sigmaOverM * w * dt) continue;
      // Elastic equal-mass collision with a partner moving at the local mean velocity u:
      // v' = (v + u)/2 + (|v - u|/2) n, n isotropic (isotropic in the CM frame). The partner's
      // recoil is not applied to a specific particle; momentum is conserved only on average, as
      // the partner population scatters at the same rate (mean-field Monte Carlo).
      const mu = 2 * this.rand() - 1;
      const ph = 2 * Math.PI * this.rand();
      const st = Math.sqrt(1 - mu * mu);
      const h = 0.5 * w;
      vx[i] = ux + 0.5 * wx + h * st * Math.cos(ph);
      vy[i] = uy + 0.5 * wy + h * st * Math.sin(ph);
      vz[i] = uz + 0.5 * wz + h * mu;
      this.scatters++;
    }
  }

  /** One kick-drift-kick leapfrog step (one PM solve). */
  step(dt = DT): void {
    const { x, y, z, vx, vy, vz, ax, ay, az } = this;
    const hd = 0.5 * dt;
    for (let i = 0; i < N; i++) {
      vx[i] += ax[i] * hd;
      vy[i] += ay[i] * hd;
      vz[i] += az[i] * hd;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      z[i] += vz[i] * dt;
      // Periodic wrap of the PM box.
      x[i] -= PM_L * Math.floor((x[i] + PM_L / 2) / PM_L);
      y[i] -= PM_L * Math.floor((y[i] + PM_L / 2) / PM_L);
      z[i] -= PM_L * Math.floor((z[i] + PM_L / 2) / PM_L);
    }
    this.forces();
    for (let i = 0; i < N; i++) {
      vx[i] += ax[i] * hd;
      vy[i] += ay[i] * hd;
      vz[i] += az[i] * hd;
    }
    this.collisions(dt);
    this.t += dt;
  }

  /**
   * Shrinking-sphere centre: start with a sphere around the previous centre, recentre on the
   * enclosed particles and shrink by 5% until only `keep` of the particles remain. Robust against
   * the stripped tail and the bow-shaped gas, unlike a plain mean.
   */
  private centre(range: [number, number], keep: number, c: [number, number, number]): void {
    const { x, y, z } = this;
    const [from, to] = range;
    const first = c[0] === 0 && c[1] === 0 && c[2] === 0;
    if (first) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let i = from; i < to; i++) {
        sx += x[i];
        sy += y[i];
        sz += z[i];
      }
      const k = 1 / (to - from);
      c[0] = sx * k;
      c[1] = sy * k;
      c[2] = sz * k;
    }
    const minCount = Math.max(8, Math.round(keep * (to - from)));
    // Wide first guess; afterwards only 0.8 Mpc around the previous centre, so the peak is
    // tracked instead of jumping to a denser clump of captured/stripped particles elsewhere.
    let r = first ? 1.5 : 0.8;
    for (let it = 0; it < 200 && r > 0.03; it++) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let cnt = 0;
      const r2 = r * r;
      for (let i = from; i < to; i++) {
        const dx = x[i] - c[0];
        const dy = y[i] - c[1];
        const dz = z[i] - c[2];
        if (dx * dx + dy * dy + dz * dz < r2) {
          sx += x[i];
          sy += y[i];
          sz += z[i];
          cnt++;
        }
      }
      if (cnt < minCount) break;
      c[0] = sx / cnt;
      c[1] = sy / cnt;
      c[2] = sz / cnt;
      r *= 0.95;
    }
  }

  diagnostics(): BulletDiag {
    this.centre(R_DM_SUB, 0.1, this.cDmSub);
    this.centre(R_DM_MAIN, 0.1, this.cDmMain);
    this.centre(R_GAS_SUB, 0.1, this.cGas);
    this.centre(R_GAL_SUB, 0.2, this.cGal);
    const dx = this.cDmSub[0] - this.cDmMain[0];
    const dy = this.cDmSub[1] - this.cDmMain[1];
    const dz = this.cDmSub[2] - this.cDmMain[2];
    return {
      sep: Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000,
      // The subcluster moves toward -x, so "behind" means larger x.
      gasOff: (this.cGas[0] - this.cDmSub[0]) * 1000,
      galOff: (this.cGal[0] - this.cDmSub[0]) * 1000,
      scatters: this.scatters,
    };
  }

  /** Sky projection (x, y) of one population as a fresh Float32Array. */
  project(from: number, to: number): Float32Array {
    const out = new Float32Array((to - from) * 2);
    for (let i = from; i < to; i++) {
      out[(i - from) * 2] = this.x[i];
      out[(i - from) * 2 + 1] = this.y[i];
    }
    return out;
  }

  frame(diag: BulletDiag): BulletFrame {
    return {
      type: 'frame',
      t: this.t,
      dmMain: this.project(R_DM_MAIN[0], R_DM_MAIN[1]),
      dmSub: this.project(R_DM_SUB[0], R_DM_SUB[1]),
      gas: this.project(R_GAS_MAIN[0], R_GAS_SUB[1]),
      gal: this.project(R_GAL_MAIN[0], R_GAL_SUB[1]),
      diag,
    };
  }

  ready(): BulletReady {
    return { type: 'ready', nGasMain: N_GAS_MAIN, mDmMain: this.mDmMain, mDmSub: this.mDmSub, mGasMain: this.mGasMain, mGasSub: this.mGasSub, tEnd: T_END };
  }
}

// ---- Worker protocol --------------------------------------------------------------------------

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(m: FromWorker, transfer: Transferable[]): void;
}

/** Wall-clock time per step: ~33 s per Gyr at DT = 0.002 (slower machines just run slower). */
const STEP_MS = 66;
/** Diagnostics are refreshed every 0.01 Gyr. */
const DIAG_EVERY = 5;

if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  const ctx = self as unknown as WorkerScope;
  let sim: BulletSim | null = null;
  let running = false;
  let timer = 0;
  let diag: BulletDiag | null = null;
  let steps = 0;

  const post = (f: BulletFrame) => ctx.postMessage(f, [f.dmMain.buffer, f.dmSub.buffer, f.gas.buffer, f.gal.buffer]);

  const build = (sigma: number) => {
    clearTimeout(timer);
    running = false;
    sim = new BulletSim(sigma);
    steps = 0;
    diag = sim.diagnostics();
    ctx.postMessage(sim.ready(), []);
    post(sim.frame(diag));
  };

  const loop = () => {
    if (!running || !sim) return;
    const t0 = performance.now();
    sim.step();
    steps++;
    if (steps % DIAG_EVERY === 0 || !diag) diag = sim.diagnostics();
    post(sim.frame(diag));
    if (sim.t >= T_END - 1e-9) {
      running = false;
      ctx.postMessage({ type: 'done' }, []);
      return;
    }
    timer = setTimeout(loop, Math.max(0, STEP_MS - (performance.now() - t0))) as unknown as number;
  };

  ctx.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'init' || m.type === 'reset') build(m.sigmaOverM);
    else if (m.type === 'run') {
      if (!running && sim && sim.t < T_END - 1e-9) {
        running = true;
        loop();
      }
    } else {
      running = false;
      clearTimeout(timer);
    }
  };
}
