// Scene 3 physics, off the main thread: a galaxy forming in a dark-matter halo.
//
// Real (computed) physics at low resolution:
//   * gravity   : Barnes-Hut octree (monopole, theta = 0.7), Plummer softening
//   * hydro     : SPH (cubic spline, ~32 neighbours, Monaghan viscosity + Balsara)
//   * cooling   : approximate Lambda(T) table, sub-cycled, floor 1e4 K
//   * sub-grid  : star formation (Schmidt-like) and thermal supernova feedback
//   * time      : kick-drift-kick leapfrog, one global time step
// Units: kpc, Gyr, Msun.  Everything is in this one file so a Node test can
// import the same code (the worker glue at the bottom only runs in a worker).

// ---------------------------------------------------------------------------------------
// Units and constants
// ---------------------------------------------------------------------------------------

const MSUN_G = 1.98841e33;
const KPC_CM = 3.0856776e21;
const GYR_S = 3.15576e16;
const MP = 1.67262e-24; // proton mass [g]
const KB = 1.380649e-16; // [erg/K]
/** 1 kpc/Gyr in cm/s. */
export const CMS = KPC_CM / GYR_S;
/** 1 km/s in kpc/Gyr. */
export const KMS = 1e5 / CMS;
/** G in kpc^3 Msun^-1 Gyr^-2 (= 4.498e-6). */
export const G = (6.6743e-8 * MSUN_G * GYR_S * GYR_S) / KPC_CM ** 3;
/** Msun/kpc^3 in g/cm^3. */
export const RHO_CGS = MSUN_G / KPC_CM ** 3;

const GAMMA = 5 / 3;
const MU = 0.59;
const XH = 0.76;
/** Temperature per unit of (kpc/Gyr)^2 specific energy. */
const U_TO_T = ((GAMMA - 1) * MU * MP * CMS * CMS) / KB;
const T_FLOOR = 1e4;
const U_FLOOR = T_FLOOR / U_TO_T;
/** Thermal-energy ceiling (T <= 1e7 K): hotter gas would force microscopic time steps (energy above it is dropped). */
const U_CEIL = 1e7 / U_TO_T;
/**
 * Resolution floor on the pressure of dense gas (Bate & Burkert 1997): the Jeans mass may not fall
 * below ~2 x N_ngb gas particles, i.e. the Jeans length stays >= 2.52 x the kernel support H = 2h.
 * c_s^2 >= G rho (2.52 x 2h)^2 / pi  ->  u >= JEANS_B rho h^2.
 */
const JEANS_B = (G * (2.52 * 2) ** 2) / (Math.PI * GAMMA * (GAMMA - 1));

// Cooling function: [log10 T, log10 Lambda (erg cm^3 s^-1)], ~0.3 solar, CIE (approximate).
const LAMBDA_TABLE: [number, number][] = [
  [4.0, -30],
  [4.2, -22.6],
  [4.5, -21.8],
  [5.0, -21.3],
  [5.4, -21.4],
  [5.8, -21.9],
  [6.3, -22.4],
  [7.0, -22.7],
  [7.5, -22.75],
  [8.0, -22.6],
  [8.5, -22.45],
];
const LT0 = 3.9;
const LT_STEP = 0.01;
const LAMBDA_GRID = (() => {
  const n = Math.round((9.0 - LT0) / LT_STEP) + 2;
  const g = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const lt = LT0 + k * LT_STEP;
    let v: number;
    if (lt <= LAMBDA_TABLE[0][0]) v = -40;
    else if (lt >= LAMBDA_TABLE[LAMBDA_TABLE.length - 1][0]) v = LAMBDA_TABLE[LAMBDA_TABLE.length - 1][1];
    else {
      let j = 0;
      while (LAMBDA_TABLE[j + 1][0] < lt) j++;
      const [a, ya] = LAMBDA_TABLE[j];
      const [b, yb] = LAMBDA_TABLE[j + 1];
      v = ya + ((yb - ya) * (lt - a)) / (b - a);
    }
    g[k] = 10 ** v;
  }
  return g;
})();

/** Lambda(T) in erg cm^3 s^-1 (linear interpolation in log T of log Lambda, on a fine grid). */
export function lambdaCgs(T: number): number {
  const f = (Math.log10(T) - LT0) / LT_STEP;
  if (f <= 0) return LAMBDA_GRID[0];
  const k = Math.floor(f);
  if (k >= LAMBDA_GRID.length - 1) return LAMBDA_GRID[LAMBDA_GRID.length - 1];
  const w = f - k;
  return LAMBDA_GRID[k] * (1 - w) + LAMBDA_GRID[k + 1] * w;
}

/** Cooling rate per unit mass in erg/g/s for hydrogen density nH [cm^-3] and temperature T [K]. */
export function coolRateCgs(nH: number, T: number): number {
  const rho = (nH * MP) / XH;
  return (nH * nH * lambdaCgs(T)) / rho;
}

/** erg/g/s -> (kpc/Gyr)^2 / Gyr */
const COOL_UNIT = GYR_S / (CMS * CMS);
/** d u/dt [sim] = COOL_COEF * rho[sim] * Lambda(T): (X/mp)^2 rho_cgs Lambda ... (see coolRateSim). */
const COOL_COEF = ((XH / MP) ** 2 * RHO_CGS * COOL_UNIT) * 1; // times Lambda -> erg/g/s per (rho_sim) in sim time
/** Cooling rate (positive number) in sim units for density rho [Msun/kpc^3] and specific energy u. */
export function coolRateSim(rho: number, u: number): number {
  return COOL_COEF * rho * lambdaCgs(u * U_TO_T);
}

export function temperatureOf(u: number): number {
  return u * U_TO_T;
}

// ---------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------

export interface SimOptions {
  nDm: number;
  nGas: number;
  seed: number;
  cooling: boolean;
  feedback: boolean;
  starFormation: boolean;
  /** Bullock spin parameter of the gas. */
  spin: number;
  /** Gravity opening angle. */
  theta: number;
  /** Disable SPH hydro forces (test only). */
  hydro: boolean;
}

export const DEFAULTS: SimOptions = {
  nDm: 8000,
  nGas: 6000,
  seed: 12345,
  cooling: true,
  feedback: true,
  starFormation: true,
  spin: 0.05,
  theta: 0.7,
  hydro: true,
};

// Halo parameters
export const M200 = 1e12;
export const FB = 0.15;
export const CONC = 10;
export const H0_KMS_MPC = 70;
const H0 = (H0_KMS_MPC * KMS) / 1000; // 1/Gyr
export const R200 = Math.cbrt((G * M200) / (100 * H0 * H0));
export const RS = R200 / CONC;
export const V200 = Math.sqrt((G * M200) / R200);
const mNFW = (x: number) => Math.log(1 + x) - x / (1 + x);
const M_C = mNFW(CONC);

const EPS_DM = 1.5;
const EPS_GAS = 0.7;
const NNGB = 32;
const GROUP = 16;
const DM_REFRESH_IN = 1.5e-3; // Gyr
const DM_REFRESH_OUT = 4e-3; // Gyr
/** Verlet-list skin: candidates are gathered within SKIN x the kernel support (+ an absolute margin). */
const SKIN = 1.5;
const SKIN_ABS = 0.8; // kpc, extra skin so that dense (small-h) gas keeps its list a few steps
const ALPHA = 1;
const BETA = 2;
const COURANT = 0.25;
const ETA_ACC = 0.04;
const DT_MIN = 2e-4; // 0.2 Myr
const DT_MAX = 5e-3; // 5 Myr
const SF_EPS = 0.05;
const SF_NH = 0.1; // cm^-3
const SF_TMAX = 2e4;
/** Supernova energy per unit mass of stars formed: 1e49 erg/Msun, in (kpc/Gyr)^2. */
const E_SN = 1e49 / MSUN_G / (CMS * CMS);
const COOL_OFF_GYR = 0.01;
const H_MIN = 0.8;

const KERNEL_NORM = 1 / Math.PI;

// ---------------------------------------------------------------------------------------
// Octree on flat typed arrays
// ---------------------------------------------------------------------------------------

class Tree {
  cap: number;
  n = 0;
  // construction (creation order)
  private child = new Int32Array(0);
  private body = new Int32Array(0);
  private parent = new Int32Array(0);
  private cx = new Float64Array(0);
  private cy = new Float64Array(0);
  private cz = new Float64Array(0);
  private hs = new Float64Array(0);
  private mass = new Float64Array(0);
  private mx = new Float64Array(0);
  private my = new Float64Array(0);
  private mz = new Float64Array(0);
  private e2 = new Float64Array(0);
  private px: Float64Array = new Float64Array(0);
  private py: Float64Array = new Float64Array(0);
  private pz: Float64Array = new Float64Array(0);
  // packed in depth-first order (what the walks read); the root is node 0
  /** per node, stride 8: com x, y, z, mass, softening^2, opening threshold s^2/theta^2 (-1 for a leaf) */
  pk = new Float64Array(0);
  /** per node, stride 4: cell centre x, y, z and half width */
  pg = new Float64Array(0);
  pchild = new Int32Array(0);
  pbody = new Int32Array(0);
  /** per node: first index and number of particles of its subtree in `order` */
  pstart = new Int32Array(0);
  pcnt = new Int32Array(0);
  /** particles in depth-first (spatially coherent) order */
  order = new Int32Array(0);
  nOrder = 0;
  private ord = new Int32Array(0);
  private map = new Int32Array(0);
  private st = new Int32Array(1024);

  constructor(cap: number) {
    this.cap = 0;
    this.alloc(cap);
  }

  private alloc(cap: number): void {
    const n = this.n;
    const f = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a.subarray(0, n));
      return b;
    };
    const i32 = (a: Int32Array, k = 1) => {
      const b = new Int32Array(cap * k);
      b.set(a.subarray(0, n * k));
      return b;
    };
    this.child = i32(this.child, 8);
    this.body = i32(this.body);
    this.parent = i32(this.parent);
    this.cx = f(this.cx);
    this.cy = f(this.cy);
    this.cz = f(this.cz);
    this.hs = f(this.hs);
    this.mass = f(this.mass);
    this.mx = f(this.mx);
    this.my = f(this.my);
    this.mz = f(this.mz);
    this.e2 = f(this.e2);
    this.cap = cap;
    this.pk = new Float64Array(cap * 8);
    this.pg = new Float64Array(cap * 4);
    this.pchild = new Int32Array(cap * 8);
    this.pbody = new Int32Array(cap);
    this.pstart = new Int32Array(cap);
    this.pcnt = new Int32Array(cap);
    this.ord = new Int32Array(cap);
    this.map = new Int32Array(cap);
  }

  private newNode(parent: number, oct: number): number {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    const k = this.n++;
    if (parent >= 0) {
      const h = this.hs[parent] * 0.5;
      this.hs[k] = h;
      this.cx[k] = this.cx[parent] + (oct & 1 ? h : -h);
      this.cy[k] = this.cy[parent] + (oct & 2 ? h : -h);
      this.cz[k] = this.cz[parent] + (oct & 4 ? h : -h);
    }
    this.parent[k] = parent;
    this.body[k] = -2;
    this.mass[k] = 0;
    this.mx[k] = 0;
    this.my[k] = 0;
    this.mz[k] = 0;
    this.e2[k] = 0;
    this.child.fill(-1, k * 8, k * 8 + 8);
    return k;
  }

  /** Build over the particles idx[0..count). */
  build(x: Float64Array, y: Float64Array, z: Float64Array, m: Float64Array, eps2: Float64Array, idx: Int32Array, count: number, theta: number): void {
    this.px = x;
    this.py = y;
    this.pz = z;
    this.n = 0;
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let k = 0; k < count; k++) {
      const i = idx[k];
      if (x[i] < x0) x0 = x[i];
      if (x[i] > x1) x1 = x[i];
      if (y[i] < y0) y0 = y[i];
      if (y[i] > y1) y1 = y[i];
      if (z[i] < z0) z0 = z[i];
      if (z[i] > z1) z1 = z[i];
    }
    const root = this.newNode(-1, 0);
    this.cx[root] = 0.5 * (x0 + x1);
    this.cy[root] = 0.5 * (y0 + y1);
    this.cz[root] = 0.5 * (z0 + z1);
    this.hs[root] = 0.5 * Math.max(x1 - x0, y1 - y0, z1 - z0) * 1.0001 + 1e-6;
    for (let k = 0; k < count; k++) this.insert(idx[k]);
    // Multipoles: children always have larger indices than their parents.
    const { body, parent, mass, mx, my, mz, e2 } = this;
    for (let nd = this.n - 1; nd >= 0; nd--) {
      const b = body[nd];
      if (b >= 0) {
        mass[nd] = m[b];
        mx[nd] = x[b];
        my[nd] = y[b];
        mz[nd] = z[b];
        e2[nd] = eps2[b];
      } else if (mass[nd] > 0) {
        const inv = 1 / mass[nd];
        mx[nd] *= inv;
        my[nd] *= inv;
        mz[nd] *= inv;
        e2[nd] *= inv;
      }
      const p = parent[nd];
      if (p >= 0) {
        const mm = mass[nd];
        mass[p] += mm;
        mx[p] += mm * mx[nd];
        my[p] += mm * my[nd];
        mz[p] += mm * mz[nd];
        e2[p] += mm * e2[nd];
      }
    }
    // Renumber depth-first so a walk reads memory in order, and pack what the walks need.
    const { st, ord, map, child } = this;
    let sp = 0,
      nn = 0;
    st[sp++] = 0;
    while (sp > 0) {
      const nd = st[--sp];
      map[nd] = nn;
      ord[nn++] = nd;
      for (let k = 7; k >= 0; k--) {
        const c = child[nd * 8 + k];
        if (c >= 0) st[sp++] = c;
      }
    }
    const th2 = theta * theta;
    if (this.order.length < count) this.order = new Int32Array(count);
    let no = 0;
    for (let k = 0; k < nn; k++) {
      const nd = ord[k];
      const o = k * 8;
      this.pk[o] = mx[nd];
      this.pk[o + 1] = my[nd];
      this.pk[o + 2] = mz[nd];
      this.pk[o + 3] = mass[nd];
      this.pk[o + 4] = e2[nd];
      const s = this.hs[nd] * 2;
      const b = body[nd];
      this.pk[o + 5] = b >= 0 ? -1 : (s * s) / th2;
      this.pk[o + 6] = s / theta;
      this.pstart[k] = no;
      this.pg[k * 4] = this.cx[nd];
      this.pg[k * 4 + 1] = this.cy[nd];
      this.pg[k * 4 + 2] = this.cz[nd];
      this.pg[k * 4 + 3] = this.hs[nd];
      this.pbody[k] = b;
      for (let j = 0; j < 8; j++) {
        const c = child[nd * 8 + j];
        this.pchild[o + j] = c >= 0 ? map[c] : -1;
      }
      if (b >= 0) this.order[no++] = b;
    }
    this.nOrder = no;
    for (let k = nn - 1; k >= 0; k--) {
      if (this.pbody[k] >= 0) this.pcnt[k] = 1;
      else {
        let c = 0;
        for (let j = 0; j < 8; j++) {
          const cc = this.pchild[k * 8 + j];
          if (cc >= 0) c += this.pcnt[cc];
        }
        this.pcnt[k] = c;
      }
    }
  }

  private insert(p: number): void {
    let node = 0;
    for (;;) {
      const b = this.body[node];
      if (b === -2) {
        this.body[node] = p;
        return;
      }
      if (b >= 0) {
        if (this.hs[node] < 1e-7) return; // coincident particles: ignore (never happens in practice)
        this.body[node] = -1;
        const o = this.octant(node, b);
        const c = this.newNode(node, o);
        this.body[c] = b;
        this.child[node * 8 + o] = c;
        continue;
      }
      const o = this.octant(node, p);
      const c = this.child[node * 8 + o];
      if (c < 0) {
        const nc = this.newNode(node, o);
        this.body[nc] = p;
        this.child[node * 8 + o] = nc;
        return;
      }
      node = c;
    }
  }

  private octant(node: number, p: number): number {
    return (this.px[p] > this.cx[node] ? 1 : 0) | (this.py[p] > this.cy[node] ? 2 : 0) | (this.pz[p] > this.cz[node] ? 4 : 0);
  }
}

// ---------------------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------------------

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------------------

export const NB_R = 120; // rotation-curve radial bins of 0.5 kpc
export const NB_RHO = 12; // dark-matter density shells, 1-100 kpc (log)

export interface Stats {
  t: number; // Gyr
  steps: number;
  dt: number; // Gyr
  nStars: number;
  mHot: number;
  mWarm: number;
  mCold: number;
  mStar: number;
  mGasTotal: number;
  /** star-formation rate, Msun/yr (mean of the last 100 Myr) */
  sfr: number;
  rd: number; // kpc, NaN if not measurable
  spinGas0: number; // lambda' at start (gas)
  spinBar: number; // lambda' of gas+stars now
  jRatio: number; // J(cold gas + stars) / J(initial gas) per unit mass
  jBar: number; // J_z(gas+stars) / J_z(initial gas)
  centre: [number, number, number];
  rr: Float64Array; // radii of the curves (kpc)
  vTot: Float64Array;
  vDm: Float64Array;
  vGas: Float64Array;
  vStar: Float64Array;
  rotR: Float64Array; // measured mean rotation speed points
  rotV: Float64Array;
  rhoR: Float64Array; // DM density shells
  rho: Float64Array;
  rho0: Float64Array;
  nMax: number;
  tMed: Float64Array; // gas temperature medians in 8 shells (test)
}

export class GalaxySim {
  readonly opt: SimOptions;
  readonly N: number;
  readonly nGas: number;
  readonly nDm: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
  az: Float64Array;
  m: Float64Array;
  eps2: Float64Array;
  /** 0 dark matter, 1 gas, 2 star */
  kind: Uint8Array;
  // gas
  u: Float64Array;
  du: Float64Array;
  rho: Float64Array;
  h: Float64Array;
  cs: Float64Array;
  pr: Float64Array; // P / rho^2
  bal: Float64Array;
  div: Float64Array;
  vsig: Float64Array;
  coolOff: Float64Array;
  pvx: Float64Array;
  pvy: Float64Array;
  pvz: Float64Array;
  tForm: Float64Array;
  axOld: Float64Array;
  ayOld: Float64Array;
  azOld: Float64Array;
  duOld: Float64Array;
  sax: Float64Array;
  say: Float64Array;
  saz: Float64Array;
  sdu: Float64Array;

  t = 0;
  steps = 0;
  dt = 1e-3;
  nStars = 0;
  spin0 = 0;
  j0 = 0; // initial gas J_z
  private readonly rand: () => number;
  private readonly gtree: Tree;
  private readonly stree: Tree;
  private readonly allIdx: Int32Array;
  private readonly gasIdx: Int32Array;
  private nActiveGas = 0;
  private readonly stack = new Int32Array(1024);
  private readonly gstack = new Int32Array(1024);
  private list = new Float64Array(0);
  private readonly gravActive: Uint8Array;
  private readonly gravLast: Float64Array;
  private readonly dtHist = new Int32Array(160);
  private readonly ballI = new Int32Array(2048);
  private readonly ballD = new Float64Array(2048);
  private candOk = false;
  private candList = new Int32Array(1 << 18);
  private readonly candStart: Int32Array;
  private readonly candEnd: Int32Array;
  private readonly candRad: Float64Array;
  private readonly xb: Float64Array;
  private readonly yb: Float64Array;
  private readonly zb: Float64Array;
  nRebuild = 0;
  private ngbStart: Int32Array;
  private ngbEnd: Int32Array;
  private ngbList = new Int32Array(1 << 18);
  private ngbR = new Float64Array(1 << 18);
  private sfLog: { t: number; m: number }[] = [];
  private rho0: Float64Array = new Float64Array(NB_RHO);
  private readonly mGasPart: number;
  maxN = 0; // max neighbour count seen (diagnostic)
  /** diagnostics: which criterion set dt last */
  dtWhy = '';

  constructor(options: Partial<SimOptions> = {}) {
    const o = { ...DEFAULTS, ...options };
    this.opt = o;
    this.nDm = o.nDm;
    this.nGas = o.nGas;
    const N = (this.N = o.nDm + o.nGas);
    const F = () => new Float64Array(N);
    this.x = F();
    this.y = F();
    this.z = F();
    this.vx = F();
    this.vy = F();
    this.vz = F();
    this.ax = F();
    this.ay = F();
    this.az = F();
    this.axOld = F();
    this.ayOld = F();
    this.azOld = F();
    this.m = F();
    this.eps2 = F();
    this.kind = new Uint8Array(N);
    this.u = F();
    this.du = F();
    this.duOld = F();
    this.sax = F();
    this.say = F();
    this.saz = F();
    this.sdu = F();
    this.rho = F();
    this.h = F();
    this.cs = F();
    this.pr = F();
    this.bal = F();
    this.div = F();
    this.vsig = F();
    this.coolOff = F();
    this.pvx = F();
    this.pvy = F();
    this.pvz = F();
    this.tForm = F();
    this.rand = mulberry32(o.seed);
    this.gtree = new Tree(N * 6 + 64);
    this.stree = new Tree(o.nGas * 6 + 64);
    this.gravActive = new Uint8Array(N);
    this.gravLast = new Float64Array(N);
    for (let i = 0; i < N; i++) this.gravLast[i] = -(i % 8) * (DM_REFRESH_OUT / 8); // staggered phases
    this.allIdx = new Int32Array(N);
    for (let i = 0; i < N; i++) this.allIdx[i] = i;
    this.gasIdx = new Int32Array(o.nGas);
    this.ngbStart = new Int32Array(o.nGas);
    this.ngbEnd = new Int32Array(o.nGas);
    this.candStart = new Int32Array(o.nGas);
    this.candEnd = new Int32Array(o.nGas);
    this.candRad = new Float64Array(o.nGas);
    this.xb = new Float64Array(o.nGas);
    this.yb = new Float64Array(o.nGas);
    this.zb = new Float64Array(o.nGas);
    this.mGasPart = (FB * M200) / o.nGas;
    this.initialConditions();
    this.computeForces(true);
    this.rho0 = this.dmProfile();
    this.chooseDt();
  }

  // ---- Initial conditions -----------------------------------------------------------

  private gauss(): number {
    const u1 = Math.max(this.rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * this.rand());
  }

  /** Radius (in units of r_s) enclosing a fraction f of the NFW mass inside r200. */
  private static inverseNfw(f: number): number {
    const target = f * M_C;
    let lo = 0;
    let hi = CONC;
    for (let k = 0; k < 60; k++) {
      const mid = 0.5 * (lo + hi);
      if (mNFW(mid) < target) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  private initialConditions(): void {
    const { nDm, nGas } = this;
    // Isotropic Jeans: sigma_r^2(r) rho(r) = int_r^inf rho g(s) ds, with g the (softened) gravity of the total
    // NFW mass M(<r) (M200 = 1e12; DM and gas both follow the NFW shape, so DM velocity dispersion and
    // gas pressure P/rho are the same function). The Plummer softening of the code is included as
    // g = G M r / (r^2 + eps^2)^1.5, so the cusp is in equilibrium with the force the code really uses
    // (eps ~ the pair softening felt by DM / by gas).
    const NS = 3000;
    const lmin = Math.log(1e-3);
    const lmax = Math.log(R200 * 100);
    const rhoShape = (r: number) => {
      const x = r / RS;
      return 1 / (x * (1 + x) * (1 + x));
    };
    const table = (eps: number): Float64Array => {
      const out = new Float64Array(NS);
      const f = (r: number) => {
        const Mr = (M200 * mNFW(r / RS)) / M_C;
        return rhoShape(r) * ((G * Mr * r) / (r * r + eps * eps) ** 1.5) * r; // times d ln r
      };
      let acc = 0;
      let prevF = f(Math.exp(lmax));
      for (let k = NS - 1; k >= 0; k--) {
        const r = Math.exp(lmin + ((lmax - lmin) * k) / (NS - 1));
        const fk = f(r);
        if (k < NS - 1) acc += 0.5 * (fk + prevF) * ((lmax - lmin) / (NS - 1));
        prevF = fk;
        out[k] = acc / rhoShape(r);
      }
      return out;
    };
    const sigDm = table(1.45);
    const sigGas = table(1.1);
    const sigma2At = (tab: Float64Array, r: number) => {
      const f = ((Math.log(r) - lmin) / (lmax - lmin)) * (NS - 1);
      const k = Math.max(0, Math.min(NS - 2, Math.floor(f)));
      const w = f - k;
      return tab[k] * (1 - w) + tab[k + 1] * w;
    };

    const mDm = ((1 - FB) * M200) / nDm;
    const mGas = this.mGasPart;
    for (let i = 0; i < this.N; i++) {
      const isGas = i < nGas;
      this.kind[i] = isGas ? 1 : 0;
      this.m[i] = isGas ? mGas : mDm;
      this.eps2[i] = (isGas ? EPS_GAS : EPS_DM) ** 2;
      const r = GalaxySim.inverseNfw(this.rand()) * RS;
      const ct = 2 * this.rand() - 1;
      const st = Math.sqrt(1 - ct * ct);
      const ph = 2 * Math.PI * this.rand();
      this.x[i] = r * st * Math.cos(ph);
      this.y[i] = r * st * Math.sin(ph);
      this.z[i] = r * ct;
      const s2 = sigma2At(isGas ? sigGas : sigDm, r);
      if (!isGas) {
        const s = Math.sqrt(s2);
        this.vx[i] = s * this.gauss();
        this.vy[i] = s * this.gauss();
        this.vz[i] = s * this.gauss();
      } else {
        this.u[i] = (1.5 * s2) * 1; // u = P / ((gamma-1) rho) = sigma^2 / (gamma-1)
        this.h[i] = 2;
      }
    }
    // Gas spin: v_phi = A (R/rs) / (1 + R/rs), A chosen so lambda' (Bullock+2001) = spin.
    let jUnit = 0;
    for (let i = 0; i < nGas; i++) {
      const R = Math.hypot(this.x[i], this.y[i]);
      const xr = R / RS;
      jUnit += this.m[i] * R * (xr / (1 + xr));
    }
    const jTarget = this.opt.spin * Math.SQRT2 * (FB * M200) * V200 * R200;
    const A = jTarget / jUnit;
    for (let i = 0; i < nGas; i++) {
      const R = Math.hypot(this.x[i], this.y[i]) + 1e-9;
      const xr = R / RS;
      const vphi = (A * xr) / (1 + xr);
      this.vx[i] = (-vphi * this.y[i]) / R;
      this.vy[i] = (vphi * this.x[i]) / R;
      this.vz[i] = 0;
    }
    // Remove net momentum of the DM so the halo stays centred.
    let px = 0,
      py = 0,
      pz = 0,
      mm = 0;
    for (let i = nGas; i < this.N; i++) {
      px += this.vx[i];
      py += this.vy[i];
      pz += this.vz[i];
      mm++;
    }
    for (let i = nGas; i < this.N; i++) {
      this.vx[i] -= px / mm;
      this.vy[i] -= py / mm;
      this.vz[i] -= pz / mm;
    }
    this.j0 = this.angularMomentumZ(true, true);
    this.spin0 = this.j0 / (Math.SQRT2 * FB * M200 * V200 * R200);
  }

  // ---- Gravity ----------------------------------------------------------------------

  private gravity(): void {
    const N = this.N;
    const tr = this.gtree;
    tr.build(this.x, this.y, this.z, this.m, this.eps2, this.allIdx, N, this.opt.theta);
    const { pk, pchild, pstart, pcnt, order } = tr;
    const stack = this.stack;
    const gstack = this.gstack;
    if (this.list.length < tr.n * 5) this.list = new Float64Array(tr.n * 5);
    const L = this.list;
    const { x, y, z, eps2, kind } = this;
    // Dark matter moves slowly (orbital times >> the step): its force is refreshed at most every 1.5 Myr inside
    // 40 kpc and every 4 Myr outside (every step when the step is longer than that); gas and stars every step.
    const act = this.gravActive;
    const t = this.t;
    const last = this.gravLast;
    for (let i = 0; i < N; i++) {
      if (kind[i] !== 0 || this.steps === 0) act[i] = 1;
      else {
        const every = x[i] * x[i] + y[i] * y[i] + z[i] * z[i] < 1600 ? DM_REFRESH_IN : DM_REFRESH_OUT;
        act[i] = t - last[i] >= every - 1e-9 ? 1 : 0;
      }
      if (act[i]) last[i] = t;
    }
    const ax = this.ax,
      ay = this.ay,
      az = this.az;
    // Group walk (Barnes 1990): nodes with <= GROUP particles share one interaction list.
    let gp = 0;
    gstack[gp++] = 0;
    while (gp > 0) {
      const gk = gstack[--gp];
      if (pcnt[gk] > GROUP) {
        for (let k = 0; k < 8; k++) {
          const cc = pchild[gk * 8 + k];
          if (cc >= 0) gstack[gp++] = cc;
        }
        continue;
      }
      const gx = pk[gk * 8],
        gy = pk[gk * 8 + 1],
        gz = pk[gk * 8 + 2];
      const g0 = pstart[gk],
        g1 = g0 + pcnt[gk];
      let rg2 = 0;
      for (let kk = g0; kk < g1; kk++) {
        const i = order[kk];
        const d2 = (x[i] - gx) ** 2 + (y[i] - gy) ** 2 + (z[i] - gz) ** 2;
        if (d2 > rg2) rg2 = d2;
      }
      const rg = Math.sqrt(rg2);
      let any = false;
      for (let kk = g0; kk < g1; kk++) if (act[order[kk]]) any = true;
      if (!any) continue;
      let nl = 0;
      let sp = 0;
      stack[sp++] = 0;
      while (sp > 0) {
        const nd = stack[--sp];
        const o = nd << 3;
        const s2 = pk[o + 5];
        let accept = s2 < 0;
        if (!accept) {
          const dx = pk[o] - gx,
            dy = pk[o + 1] - gy,
            dz = pk[o + 2] - gz;
          const need = rg + pk[o + 6];
          accept = dx * dx + dy * dy + dz * dz > need * need;
        }
        if (accept) {
          const q = nl * 5;
          L[q] = pk[o];
          L[q + 1] = pk[o + 1];
          L[q + 2] = pk[o + 2];
          L[q + 3] = pk[o + 3];
          L[q + 4] = pk[o + 4];
          nl++;
        } else {
          for (let k = 0; k < 8; k++) {
            const cc = pchild[o + k];
            if (cc >= 0) stack[sp++] = cc;
          }
        }
      }
      for (let kk = g0; kk < g1; kk++) {
        const i = order[kk];
        if (!act[i]) continue;
        const xi = x[i],
          yi = y[i],
          zi = z[i];
        const ei2 = eps2[i];
        let fx = 0,
          fy = 0,
          fz = 0;
        for (let q = 0, e = nl * 5; q < e; q += 5) {
          const dx = L[q] - xi;
          const dy = L[q + 1] - yi;
          const dz = L[q + 2] - zi;
          const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz + 0.5 * (ei2 + L[q + 4]));
          const f = L[q + 3] * inv * inv * inv;
          fx += f * dx;
          fy += f * dy;
          fz += f * dz;
        }
        ax[i] = G * fx;
        ay[i] = G * fy;
        az[i] = G * fz;
      }
    }
  }

  // ---- SPH --------------------------------------------------------------------------

  /** All gas particles within radius R of (x0,y0,z0) (the particle itself included). */
  private ball(x0: number, y0: number, z0: number, R: number): number {
    const tr = this.stree;
    const { pg, pk, pbody, pchild } = tr;
    const R2 = R * R;
    const stack = this.stack;
    const bi = this.ballI,
      bd = this.ballD;
    const cap = bi.length;
    let cnt = 0;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const nd = stack[--sp];
      const b = pbody[nd];
      if (b >= 0) {
        const o = nd << 3;
        const dx = pk[o] - x0,
          dy = pk[o + 1] - y0,
          dz = pk[o + 2] - z0;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= R2) {
          if (cnt >= cap) return cnt;
          bi[cnt] = b;
          bd[cnt++] = d2;
        }
        continue;
      }
      const g = nd << 2;
      const hh = pg[g + 3];
      let ex = Math.abs(x0 - pg[g]) - hh;
      let ey = Math.abs(y0 - pg[g + 1]) - hh;
      let ez = Math.abs(z0 - pg[g + 2]) - hh;
      if (ex < 0) ex = 0;
      if (ey < 0) ey = 0;
      if (ez < 0) ez = 0;
      if (ex * ex + ey * ey + ez * ez > R2) continue;
      const c = nd << 3;
      for (let k = 0; k < 8; k++) {
        const cc = pchild[c + k];
        if (cc >= 0) stack[sp++] = cc;
      }
    }
    return cnt;
  }

  /** Cubic-spline W(r, h) (support 2h). */
  private static W(r: number, h: number): number {
    const q = r / h;
    if (q >= 2) return 0;
    const n = KERNEL_NORM / (h * h * h);
    if (q < 1) return n * (1 - 1.5 * q * q + 0.75 * q * q * q);
    const t = 2 - q;
    return n * 0.25 * t * t * t;
  }

  /** dW/dr (negative). */
  private static dW(r: number, h: number): number {
    const q = r / h;
    if (q >= 2) return 0;
    const n = KERNEL_NORM / (h * h * h * h);
    if (q < 1) return n * (-3 * q + 2.25 * q * q);
    const t = 2 - q;
    return n * -0.75 * t * t;
  }

  /**
   * Neighbour lists with a "skin" (Verlet lists): every few steps a tree ball query collects all gas
   * within SKIN x the kernel support; the steps in between only filter that candidate list. The
   * smoothing length is adapted so each particle has ~NNGB neighbours within 2h.
   */
  private findNeighbours(): void {
    const { x, y, z, kind } = this;
    let nAct = 0;
    for (let i = 0; i < this.nGas; i++) if (kind[i] === 1) this.gasIdx[nAct++] = i;
    this.nActiveGas = nAct;
    let dmax = 0;
    if (this.candOk) {
      const { xb, yb, zb } = this;
      let d2m = 0;
      for (let a = 0; a < nAct; a++) {
        const i = this.gasIdx[a];
        const d2 = (x[i] - xb[i]) ** 2 + (y[i] - yb[i]) ** 2 + (z[i] - zb[i]) ** 2;
        if (d2 > d2m) d2m = d2;
      }
      dmax = Math.sqrt(d2m);
    }
    if (!this.candOk || !this.filterLists(dmax, false)) {
      this.buildCandidates();
      this.filterLists(0, true);
    }
  }

  private buildCandidates(): void {
    const { x, y, z, h } = this;
    const nAct = this.nActiveGas;
    const st = this.stree;
    st.build(x, y, z, this.m, this.eps2, this.gasIdx, nAct, 0.5);
    const bi = this.ballI;
    const K = Math.min(NNGB, nAct - 2);
    const lo = Math.max(2, Math.floor(K * 0.7));
    const hiN = Math.ceil(K * 1.5);
    let fill = 0;
    for (let a = 0; a < nAct; a++) {
      const i = st.order[a];
      let hi = h[i];
      let cnt = 0;
      let R = 0;
      let lastR = -1;
      let below = 0; // largest h seen with too few neighbours
      let above = Infinity; // smallest h seen with too many
      for (let tries = 0; tries < 14; tries++) {
        R = 2 * hi * SKIN + SKIN_ABS;
        cnt = this.ball(x[i], y[i], z[i], R);
        lastR = R;
        if (cnt >= bi.length - 1) {
          hi *= 0.7;
          continue;
        }
        const s2 = 4 * hi * hi;
        let inside = -1; // the particle itself
        for (let k = 0; k < cnt; k++) if (this.ballD[k] <= s2) inside++;
        if ((inside >= lo && inside <= hiN) || (hi <= H_MIN && inside > hiN)) break;
        if (inside < lo) below = Math.max(below, hi);
        else above = Math.min(above, hi);
        let next = hi * Math.pow(K / Math.max(inside, 0.5), 0.3333);
        if (next <= below || next >= above) {
          // the count jumps across the window (a clump just outside): settle on the larger h
          if (above - below < 0.05 * above || !Number.isFinite(above)) next = Number.isFinite(above) ? above : next;
          else next = 0.5 * (below + above);
        }
        hi = Math.max(next, H_MIN);
        if (tries === 13 && Number.isFinite(above)) hi = above;
      }
      if (2 * hi * SKIN + SKIN_ABS !== lastR) {
        R = 2 * hi * SKIN + SKIN_ABS;
        cnt = this.ball(x[i], y[i], z[i], R);
      }
      h[i] = hi;
      this.candRad[i] = R;
      this.candStart[i] = fill;
      if (fill + cnt > this.candList.length) {
        const l = new Int32Array((fill + cnt) * 2);
        l.set(this.candList.subarray(0, fill));
        this.candList = l;
      }
      const cl = this.candList;
      for (let k = 0; k < cnt; k++) if (bi[k] !== i) cl[fill++] = bi[k];
      this.candEnd[i] = fill;
      this.xb[i] = x[i];
      this.yb[i] = y[i];
      this.zb[i] = z[i];
    }
    this.candOk = true;
    this.nRebuild++;
  }

  /** Adapt h and write the neighbour lists (within 2h) from the candidates. false: candidates too stale. */
  private filterLists(dmax: number, force: boolean): boolean {
    const { x, y, z, h, kind } = this;
    const nAct = this.nActiveGas;
    const K = Math.min(NNGB, nAct - 2);
    const lo = Math.max(2, Math.floor(K * 0.7));
    const hiN = Math.ceil(K * 1.5);
    const cl = this.candList;
    let f = 0;
    for (let a = 0; a < nAct; a++) {
      const i = this.gasIdx[a];
      let hi = h[i];
      const s0 = this.candStart[i],
        s1 = this.candEnd[i];
      const xi = x[i],
        yi = y[i],
        zi = z[i];
      const reach = this.candRad[i] - 2 * dmax; // radius within which the candidates are complete
      let below = 0;
      let above = Infinity;
      for (let tries = 0; tries < 14; tries++) {
        if (2 * hi > reach) {
          if (!force) return false;
          hi = 0.5 * reach;
        }
        const s2 = 4 * hi * hi;
        let c = 0;
        for (let k = s0; k < s1; k++) {
          const j = cl[k];
          if (kind[j] !== 1) continue;
          const d2 = (x[j] - xi) ** 2 + (y[j] - yi) ** 2 + (z[j] - zi) ** 2;
          if (d2 <= s2) c++;
        }
        if ((c >= lo && c <= hiN) || (hi <= H_MIN && c > hiN) || 2 * hi >= reach) break;
        if (c < lo) below = Math.max(below, hi);
        else above = Math.min(above, hi);
        let next = hi * Math.pow(K / Math.max(c, 0.5), 0.3333);
        if (next <= below || next >= above) {
          if (above - below < 0.05 * above || !Number.isFinite(above)) next = Number.isFinite(above) ? above : next;
          else next = 0.5 * (below + above);
        }
        hi = Math.max(next, H_MIN);
        if (tries === 13 && Number.isFinite(above)) hi = above;
      }
      if (2 * hi > reach) {
        if (!force) return false;
        hi = 0.5 * reach;
      }
      h[i] = hi;
      const s2 = 4 * hi * hi;
      if (f + (s1 - s0) + 2 > this.ngbList.length) this.growNgb(f + (s1 - s0) + 2, f);
      const nl = this.ngbList,
        nr = this.ngbR;
      this.ngbStart[i] = f;
      for (let k = s0; k < s1; k++) {
        const j = cl[k];
        if (kind[j] !== 1) continue;
        const d2 = (x[j] - xi) ** 2 + (y[j] - yi) ** 2 + (z[j] - zi) ** 2;
        if (d2 > s2) continue;
        nl[f] = j;
        nr[f++] = Math.sqrt(d2);
      }
      this.ngbEnd[i] = f;
      if (f - this.ngbStart[i] > this.maxN) this.maxN = f - this.ngbStart[i];
    }
    return true;
  }

  private growNgb(need: number, used: number): void {
    let n = this.ngbList.length;
    while (n < need * 2) n *= 2;
    const l = new Int32Array(n);
    l.set(this.ngbList.subarray(0, used));
    const r = new Float64Array(n);
    r.set(this.ngbR.subarray(0, used));
    this.ngbList = l;
    this.ngbR = r;
  }

  /** Neighbours, density, pressure, divergence/curl and the SPH forces on predicted velocities. */
  private hydro(): void {
    const { x, y, z, m, h, rho, u, pvx, pvy, pvz, cs, pr, bal, div, vsig } = this;
    this.findNeighbours();
    const nAct = this.nActiveGas;
    const gi = this.gasIdx;
    const nl = this.ngbList,
      nr = this.ngbR;
    // density, pressure, balsara
    for (let a = 0; a < nAct; a++) {
      const i = gi[a];
      const hi = h[i];
      let s = m[i] * GalaxySim.W(0, hi);
      const s0 = this.ngbStart[i],
        s1 = this.ngbEnd[i];
      for (let k = s0; k < s1; k++) s += m[nl[k]] * GalaxySim.W(nr[k], hi);
      rho[i] = s;
      const uf = Math.max(U_FLOOR, JEANS_B * s * hi * hi);
      if (u[i] < uf) u[i] = uf;
      const ui = u[i];
      cs[i] = Math.sqrt(GAMMA * (GAMMA - 1) * ui);
      pr[i] = ((GAMMA - 1) * ui) / s; // P / rho^2 = (gamma-1) u / rho
      // div, curl
      let dv = 0,
        cx = 0,
        cy = 0,
        cz = 0;
      for (let k = s0; k < s1; k++) {
        const j = nl[k];
        const r = nr[k];
        if (r < 1e-12) continue;
        const g = (m[j] * GalaxySim.dW(r, hi)) / r;
        const dx = x[i] - x[j],
          dy = y[i] - y[j],
          dz = z[i] - z[j];
        const vx = pvx[j] - pvx[i],
          vy = pvy[j] - pvy[i],
          vz = pvz[j] - pvz[i];
        dv += g * (vx * dx + vy * dy + vz * dz);
        // (v_i - v_j) x grad W
        cx += g * (-vy * dz + vz * dy);
        cy += g * (-vz * dx + vx * dz);
        cz += g * (-vx * dy + vy * dx);
      }
      dv /= s;
      const curl = Math.sqrt(cx * cx + cy * cy + cz * cz) / s;
      div[i] = dv;
      bal[i] = Math.abs(dv) / (Math.abs(dv) + curl + 1e-4 * cs[i] / hi);
      vsig[i] = 2 * cs[i];
    }
    // forces (pairs, owner rule: handled once, applied to both)
    const { sax, say, saz, sdu } = this;
    for (let a = 0; a < nAct; a++) {
      const i = gi[a];
      sax[i] = 0;
      say[i] = 0;
      saz[i] = 0;
      sdu[i] = 0;
    }
    for (let a = 0; a < nAct; a++) {
      const i = gi[a];
      const hi = h[i];
      const s0 = this.ngbStart[i],
        s1 = this.ngbEnd[i];
      const Pi = pr[i];
      for (let k = s0; k < s1; k++) {
        const j = nl[k];
        const r = nr[k];
        const hj = h[j];
        if (r < 2 * hj && j < i) continue; // j handles this pair
        if (r < 1e-12) continue;
        const inv = 1 / r;
        const dx = x[i] - x[j],
          dy = y[i] - y[j],
          dz = z[i] - z[j];
        const dvx = pvx[i] - pvx[j],
          dvy = pvy[i] - pvy[j],
          dvz = pvz[i] - pvz[j];
        const vr = dvx * dx + dvy * dy + dvz * dz; // v_ij . r_ij
        const gw = 0.5 * (GalaxySim.dW(r, hi) + GalaxySim.dW(r, hj));
        const cbar = 0.5 * (cs[i] + cs[j]);
        const w = vr * inv;
        let visc = 0;
        if (vr < 0) {
          const hb = 0.5 * (hi + hj);
          const mu = (hb * vr) / (r * r + 0.01 * hb * hb);
          const rb = 0.5 * (rho[i] + rho[j]);
          visc = ((-ALPHA * cbar * mu + BETA * mu * mu) / rb) * 0.5 * (bal[i] + bal[j]);
        }
        const sg = cs[i] + cs[j] - BETA * Math.min(w, 0);
        if (sg > vsig[i]) vsig[i] = sg;
        if (sg > vsig[j]) vsig[j] = sg;
        const Pj = pr[j];
        const bi = (Pi + Pj + visc) * gw * inv;
        const fi = m[j] * bi;
        const fj = m[i] * bi;
        sax[i] -= fi * dx;
        say[i] -= fi * dy;
        saz[i] -= fi * dz;
        sax[j] += fj * dx;
        say[j] += fj * dy;
        saz[j] += fj * dz;
        const dw = gw * w;
        sdu[i] += m[j] * (Pi + 0.5 * visc) * dw;
        sdu[j] += m[i] * (Pj + 0.5 * visc) * dw;
      }
    }
  }

  /** Gravity + hydro; total acceleration into ax/ay/az, du into this.du. */
  private computeForces(init: boolean): void {
    const { nGas, kind } = this;
    if (init) {
      for (let i = 0; i < this.N; i++) {
        this.pvx[i] = this.vx[i];
        this.pvy[i] = this.vy[i];
        this.pvz[i] = this.vz[i];
      }
    }
    this.gravity();
    this.hydro();
    const { sax, say, saz, sdu } = this;
    const on = this.opt.hydro;
    for (let i = 0; i < nGas; i++) {
      if (kind[i] !== 1) continue;
      if (on) {
        this.ax[i] += sax[i];
        this.ay[i] += say[i];
        this.az[i] += saz[i];
        this.du[i] = sdu[i];
      } else this.du[i] = 0;
    }
  }

  // ---- Time step --------------------------------------------------------------------

  private chooseDt(): void {
    let dtA = Infinity;
    const { ax, ay, az, eps2, N, kind, h, vsig } = this;
    for (let i = 0; i < N; i++) {
      const a = Math.sqrt(ax[i] * ax[i] + ay[i] * ay[i] + az[i] * az[i]) + 1e-30;
      const d = Math.sqrt((2 * ETA_ACC * Math.sqrt(eps2[i])) / a);
      if (d < dtA) dtA = d;
    }
    // Courant: dt_i = C H_i / v_sig,i. A handful of shock- or supernova-heated particles would otherwise set
    // the step for everyone, so the global step is the 1st percentile of dt_i (never more than 2x the
    // smallest: the fastest particles then run at an effective C <= 0.5, still stable with the viscosity).
    const hist = this.dtHist;
    hist.fill(0);
    let dtMin = Infinity;
    let nG = 0;
    for (let i = 0; i < this.nGas; i++) {
      if (kind[i] !== 1) continue;
      const d = (COURANT * 2 * h[i]) / vsig[i];
      if (d < dtMin) dtMin = d;
      nG++;
      const b = Math.floor(Math.max(0, Math.min(hist.length - 1, 4 * Math.log2(d / 1e-5))));
      hist[b]++;
    }
    let dtC = dtMin;
    if (nG > 0) {
      let acc = 0;
      const want = 0.01 * nG;
      for (let b = 0; b < hist.length; b++) {
        acc += hist[b];
        if (acc >= want) {
          dtC = Math.min(Math.max(dtMin, 1e-5 * 2 ** ((b + 1) / 4)), 2 * dtMin);
          break;
        }
      }
    }
    let dt = Math.min(dtA, dtC);
    this.dtWhy = dtA < dtC ? 'acc' : 'courant';
    if (dt > DT_MAX) dt = DT_MAX;
    if (dt < DT_MIN) dt = DT_MIN;
    this.dt = dt;
  }

  // ---- Step -------------------------------------------------------------------------

  step(): void {
    const { N, nGas, kind } = this;
    const dt = this.dt;
    const hdt = 0.5 * dt;
    const { x, y, z, vx, vy, vz, ax, ay, az, u, du } = this;
    // kick (half), drift
    for (let i = 0; i < N; i++) {
      this.axOld[i] = ax[i];
      this.ayOld[i] = ay[i];
      this.azOld[i] = az[i];
      vx[i] += hdt * ax[i];
      vy[i] += hdt * ay[i];
      vz[i] += hdt * az[i];
      x[i] += dt * vx[i];
      y[i] += dt * vy[i];
      z[i] += dt * vz[i];
    }
    for (let i = 0; i < nGas; i++) {
      if (kind[i] !== 1) continue;
      this.duOld[i] = du[i];
      u[i] = Math.max(U_FLOOR, u[i] + hdt * du[i]);
    }
    // predicted velocities at the end of the step, for the viscosity and signal speeds
    for (let i = 0; i < N; i++) {
      this.pvx[i] = vx[i] + hdt * this.axOld[i];
      this.pvy[i] = vy[i] + hdt * this.ayOld[i];
      this.pvz[i] = vz[i] + hdt * this.azOld[i];
    }
    // u predicted to the end of the step for the pressure: u_half + hdt du_old (hydro() reads u directly).
    for (let i = 0; i < nGas; i++) if (kind[i] === 1) u[i] = Math.max(U_FLOOR, u[i] + hdt * this.duOld[i]);
    this.computeForces(false);
    // second half kick (u is currently the predicted value: undo the prediction, then kick with the new rate)
    for (let i = 0; i < N; i++) {
      vx[i] += hdt * ax[i];
      vy[i] += hdt * ay[i];
      vz[i] += hdt * az[i];
    }
    for (let i = 0; i < nGas; i++) {
      if (kind[i] !== 1) continue;
      u[i] = Math.max(U_FLOOR, u[i] - hdt * this.duOld[i] + hdt * du[i]);
    }
    this.t += dt;
    this.steps++;
    if (this.opt.cooling) this.cool(dt);
    if (this.opt.starFormation) this.formStars(dt);
    this.chooseDt();
  }

  private cool(dt: number): void {
    const { u, rho, kind, coolOff, h } = this;
    const t = this.t;
    for (let i = 0; i < this.nGas; i++) {
      if (kind[i] !== 1 || coolOff[i] > t) continue;
      let ui = u[i];
      const r = rho[i];
      const uMin = Math.max(U_FLOOR, JEANS_B * r * h[i] * h[i]);
      if (ui <= uMin * 1.0001) continue;
      let left = dt;
      for (let it = 0; it < 80 && left > 0; it++) {
        const rate = coolRateSim(r, ui);
        if (rate <= 0) break;
        const sub = Math.min(left, (0.1 * ui) / rate);
        ui -= rate * sub;
        left -= sub;
        if (ui <= uMin) {
          ui = uMin;
          break;
        }
      }
      if (left > 0 && ui > uMin) {
        // leftover time after the sub-cycles: one implicit (backward-Euler) step
        const rate = coolRateSim(r, ui);
        ui = Math.max(uMin, ui / (1 + (rate * left) / ui));
      }
      u[i] = ui;
    }
  }

  private formStars(dt: number): void {
    const { rho, u, div, kind, h } = this;
    const nHconv = (XH * RHO_CGS) / MP;
    for (let i = 0; i < this.nGas; i++) {
      if (kind[i] !== 1) continue;
      const nH = rho[i] * nHconv;
      if (nH < SF_NH || div[i] >= 0) continue;
      // cold (T < 2e4 K), or held up only by the resolution floor (gas that would be colder if it could be resolved)
      if (u[i] * U_TO_T > SF_TMAX && u[i] > 1.3 * JEANS_B * rho[i] * h[i] * h[i]) continue;
      const tff = Math.sqrt((3 * Math.PI) / (32 * G * rho[i]));
      const p = 1 - Math.exp((-SF_EPS * dt) / tff);
      if (this.rand() >= p) continue;
      kind[i] = 2;
      this.nStars++;
      this.tForm[i] = this.t;
      this.sfLog.push({ t: this.t, m: this.m[i] });
      if (this.opt.feedback) this.feedback(i);
    }
    // keep the SFR log short
    const cut = this.t - 0.2;
    if (this.sfLog.length > 4000 && this.sfLog[0].t < cut) {
      let k = 0;
      while (k < this.sfLog.length && this.sfLog[k].t < cut) k++;
      this.sfLog.splice(0, k);
    }
  }

  /** Thermal supernova energy of star particle i into its gas neighbours, kernel-weighted. */
  private feedback(i: number): void {
    const { kind, m, h, u } = this;
    const s0 = this.ngbStart[i],
      s1 = this.ngbEnd[i];
    let wsum = 0;
    const hi = h[i];
    for (let k = s0; k < s1; k++) {
      const j = this.ngbList[k];
      if (kind[j] === 1) wsum += GalaxySim.W(this.ngbR[k], hi);
    }
    if (wsum <= 0) return;
    const e = E_SN * m[i];
    for (let k = s0; k < s1; k++) {
      const j = this.ngbList[k];
      if (kind[j] !== 1) continue;
      const dE = (e * GalaxySim.W(this.ngbR[k], hi)) / wsum;
      u[j] = Math.max(u[j], Math.min(U_CEIL, u[j] + dE / m[j]));
      this.coolOff[j] = Math.max(this.coolOff[j], this.t + COOL_OFF_GYR);
    }
  }

  // ---- Diagnostics ------------------------------------------------------------------

  private angularMomentumZ(gas: boolean, cold: boolean, cx = 0, cy = 0, cvx = 0, cvy = 0): number {
    let J = 0;
    for (let i = 0; i < this.nGas; i++) {
      const k = this.kind[i];
      if (k === 0) continue;
      if (k === 1 && !gas) continue;
      if (k === 1 && !cold && this.u[i] * U_TO_T > 3e4) continue;
      J += this.m[i] * ((this.x[i] - cx) * (this.vy[i] - cvy) - (this.y[i] - cy) * (this.vx[i] - cvx));
    }
    return J;
  }

  private centre(): { c: [number, number, number]; v: [number, number, number] } {
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const R of [40, 25, 15, 10]) {
      let sx = 0,
        sy = 0,
        sz = 0,
        sm = 0;
      const R2 = R * R;
      for (let i = 0; i < this.N; i++) {
        const dx = this.x[i] - cx,
          dy = this.y[i] - cy,
          dz = this.z[i] - cz;
        if (dx * dx + dy * dy + dz * dz > R2) continue;
        sx += this.m[i] * this.x[i];
        sy += this.m[i] * this.y[i];
        sz += this.m[i] * this.z[i];
        sm += this.m[i];
      }
      if (sm > 0) {
        cx = sx / sm;
        cy = sy / sm;
        cz = sz / sm;
      }
    }
    let vx = 0,
      vy = 0,
      vz = 0,
      sm = 0;
    for (let i = 0; i < this.N; i++) {
      const dx = this.x[i] - cx,
        dy = this.y[i] - cy,
        dz = this.z[i] - cz;
      if (dx * dx + dy * dy + dz * dz > 100) continue;
      vx += this.m[i] * this.vx[i];
      vy += this.m[i] * this.vy[i];
      vz += this.m[i] * this.vz[i];
      sm += this.m[i];
    }
    if (sm > 0) {
      vx /= sm;
      vy /= sm;
      vz /= sm;
    }
    return { c: [cx, cy, cz], v: [vx, vy, vz] };
  }

  private dmProfile(): Float64Array {
    const out = new Float64Array(NB_RHO);
    const { c } = this.centre();
    const mDm = ((1 - FB) * M200) / this.nDm;
    const cnt = new Float64Array(NB_RHO);
    for (let i = this.nGas; i < this.N; i++) {
      const r = Math.hypot(this.x[i] - c[0], this.y[i] - c[1], this.z[i] - c[2]);
      if (r < 1 || r >= 100) continue;
      cnt[Math.floor((Math.log10(r) / 2) * NB_RHO)]++;
    }
    for (let k = 0; k < NB_RHO; k++) {
      const r0 = 10 ** ((2 * k) / NB_RHO);
      const r1 = 10 ** ((2 * (k + 1)) / NB_RHO);
      out[k] = (cnt[k] * mDm) / ((4 / 3) * Math.PI * (r1 ** 3 - r0 ** 3));
    }
    return out;
  }

  stats(): Stats {
    const { c, v } = this.centre();
    const nb = NB_R;
    const mDmB = new Float64Array(nb),
      mGasB = new Float64Array(nb),
      mStB = new Float64Array(nb);
    let mHot = 0,
      mWarm = 0,
      mCold = 0,
      mStar = 0;
    // disc measurements
    const NR = 30;
    const sigmaM = new Float64Array(NR);
    const sigmaN = new Float64Array(NR);
    const vphiSum = new Float64Array(NR / 2);
    const vphiN = new Float64Array(NR / 2);
    let jCold = 0,
      mColdStar = 0;
    const tShell: number[][] = [[], [], [], [], [], [], [], []];
    let nMax = 0;
    const nHconv = (XH * RHO_CGS) / MP;
    for (let i = 0; i < this.N; i++) {
      const dx = this.x[i] - c[0],
        dy = this.y[i] - c[1],
        dz = this.z[i] - c[2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const kb = Math.floor(r / 0.5);
      const k = this.kind[i];
      if (k === 0) {
        if (kb < nb) mDmB[kb] += this.m[i];
        continue;
      }
      let cold = true;
      if (k === 1) {
        const T = this.u[i] * U_TO_T;
        if (T > 3e5) {
          mHot += this.m[i];
          cold = false;
        } else if (T > 3e4) {
          mWarm += this.m[i];
          cold = false;
        } else mCold += this.m[i];
        if (kb < nb) mGasB[kb] += this.m[i];
        const sh = Math.floor(r / 25);
        if (sh < 8) tShell[sh].push(T);
        const nn = this.rho[i] * nHconv;
        if (nn > nMax) nMax = nn;
      } else {
        mStar += this.m[i];
        if (kb < nb) mStB[kb] += this.m[i];
      }
      if (cold) {
        const R = Math.hypot(dx, dy);
        const ivx = this.vx[i] - v[0],
          ivy = this.vy[i] - v[1];
        jCold += this.m[i] * (dx * ivy - dy * ivx);
        mColdStar += this.m[i];
        if (Math.abs(dz) < 4 && R > 1e-6) {
          const bR = Math.floor(R);
          if (bR < NR) {
            sigmaM[bR] += this.m[i];
            sigmaN[bR]++;
          }
          const bv = Math.floor(R / 2);
          if (bv < NR / 2) {
            vphiSum[bv] += (dx * ivy - dy * ivx) / R;
            vphiN[bv]++;
          }
        }
      }
    }
    // curves
    const rr = new Float64Array(nb),
      vTot = new Float64Array(nb),
      vDm = new Float64Array(nb),
      vGas = new Float64Array(nb),
      vStar = new Float64Array(nb);
    let cd = 0,
      cg = 0,
      cs = 0;
    for (let k = 0; k < nb; k++) {
      cd += mDmB[k];
      cg += mGasB[k];
      cs += mStB[k];
      const r = 0.5 * (k + 1);
      rr[k] = r;
      const f = Math.sqrt(G / r) / KMS;
      vDm[k] = f * Math.sqrt(cd);
      vGas[k] = f * Math.sqrt(cg);
      vStar[k] = f * Math.sqrt(cs);
      vTot[k] = f * Math.sqrt(cd + cg + cs);
    }
    const rotR: number[] = [],
      rotV: number[] = [];
    for (let b = 0; b < NR / 2; b++) {
      if (vphiN[b] >= 8) {
        rotR.push(2 * b + 1);
        rotV.push(vphiSum[b] / vphiN[b] / KMS);
      }
    }
    // disc scale length: ln Sigma(R) = a - R/Rd on R in [2, 20] kpc (annuli with >= 4 particles)
    let sw = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (let b = 2; b < 20; b++) {
      if (sigmaN[b] < 4) continue;
      const sig = sigmaM[b] / (Math.PI * ((b + 1) ** 2 - b ** 2));
      const w = sigmaN[b];
      const xx = b + 0.5;
      const yy = Math.log(sig);
      sw += w;
      sx += w * xx;
      sy += w * yy;
      sxx += w * xx * xx;
      sxy += w * xx * yy;
    }
    let rd = NaN;
    if (sw > 0) {
      const den = sw * sxx - sx * sx;
      if (den > 1e-9) {
        const slope = (sw * sxy - sx * sy) / den;
        if (slope < 0) rd = -1 / slope;
      }
    }
    // SFR over the last 100 Myr (or since the start)
    const win = Math.min(0.1, Math.max(this.t, 1e-3));
    let ms = 0;
    for (let k = this.sfLog.length - 1; k >= 0; k--) {
      if (this.sfLog[k].t < this.t - win) break;
      ms += this.sfLog[k].m;
    }
    const sfr = ms / (win * 1e9);
    const jBarNow = this.angularMomentumZ(true, true, c[0], c[1], v[0], v[1]);
    const jInit = this.j0;
    const mBar = mHot + mWarm + mCold + mStar;
    const tMed = new Float64Array(8);
    tShell.forEach((a, k) => {
      if (!a.length) return;
      a.sort((p, q) => p - q);
      tMed[k] = a[a.length >> 1];
    });
    return {
      t: this.t,
      steps: this.steps,
      dt: this.dt,
      nStars: this.nStars,
      mHot,
      mWarm,
      mCold,
      mStar,
      mGasTotal: mHot + mWarm + mCold,
      sfr,
      rd,
      spinGas0: this.spin0,
      spinBar: jBarNow / (Math.SQRT2 * mBar * V200 * R200),
      jRatio: mColdStar > 0 ? jCold / mColdStar / (jInit / (FB * M200)) : 0,
      jBar: jBarNow / jInit,
      centre: c,
      rr,
      vTot,
      vDm,
      vGas,
      vStar,
      rotR: Float64Array.from(rotR),
      rotV: Float64Array.from(rotV),
      rhoR: Float64Array.from({ length: NB_RHO }, (_, k) => 10 ** ((2 * (k + 0.5)) / NB_RHO)),
      rho: this.dmProfile(),
      rho0: this.rho0,
      nMax,
      tMed,
    };
  }

  /** Render data: positions about the centre, kind and log10 T (gas). */
  snapshot(): { px: Float32Array; py: Float32Array; pz: Float32Array; kind: Uint8Array; logT: Float32Array } {
    const { c } = this.centre();
    const N = this.N;
    const px = new Float32Array(N),
      py = new Float32Array(N),
      pz = new Float32Array(N),
      logT = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      px[i] = this.x[i] - c[0];
      py[i] = this.y[i] - c[1];
      pz[i] = this.z[i] - c[2];
      if (this.kind[i] === 1) logT[i] = Math.log10(this.u[i] * U_TO_T);
    }
    return { px, py, pz, kind: this.kind.slice(), logT };
  }
}

// ---------------------------------------------------------------------------------------
// Worker glue
// ---------------------------------------------------------------------------------------

export type ToWorker =
  | { t: 'init'; feedback: boolean; nDm?: number; nGas?: number; spin?: number }
  | { t: 'run'; run: boolean };

export interface FromWorker {
  t: 'snap';
  stats: Stats;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  kind: Uint8Array;
  logT: Float32Array;
  /** simulated Myr per wall-clock second over the last window (0 while paused) */
  speed: number;
  running: boolean;
  /** only on the first message after init */
  info: { nDm: number; nGas: number; r200: number; v200: number; rs: number; mDm: number; mGas: number; spin: number };
}

declare const WorkerGlobalScope: unknown;

if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof (WorkerGlobalScope as { new (): object })) {
  const ctx = self as unknown as {
    postMessage(m: unknown, transfer: Transferable[]): void;
    onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  };
  let sim: GalaxySim | null = null;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPost = 0;
  let speedT = 0;
  let speedWall = 0;
  let speed = 0;
  let announce = true;

  const post = () => {
    if (!sim) return;
    const now = performance.now();
    if (running) {
      if (speedWall === 0) {
        speedWall = now;
        speedT = sim.t;
      } else if (now - speedWall > 1000) {
        speed = ((sim.t - speedT) * 1000) / ((now - speedWall) / 1000);
        speedWall = now;
        speedT = sim.t;
      }
    } else {
      speed = 0;
      speedWall = 0;
    }
    const s = sim.snapshot();
    const msg: FromWorker = {
      t: 'snap',
      stats: sim.stats(),
      ...s,
      speed,
      running,
      info: {
        nDm: sim.nDm,
        nGas: sim.nGas,
        r200: R200,
        v200: V200 / KMS,
        rs: RS,
        mDm: ((1 - FB) * M200) / sim.nDm,
        mGas: (FB * M200) / sim.nGas,
        spin: sim.spin0,
      },
    };
    announce = false;
    lastPost = now;
    ctx.postMessage(msg, [s.px.buffer, s.py.buffer, s.pz.buffer, s.kind.buffer, s.logT.buffer]);
  };

  const loop = () => {
    timer = null;
    if (!running || !sim) return;
    const t0 = performance.now();
    do sim.step();
    while (performance.now() - t0 < 50);
    if (performance.now() - lastPost > 150) post();
    timer = setTimeout(loop, 0);
  };

  ctx.onmessage = (e) => {
    const m = e.data;
    if (m.t === 'init') {
      if (timer) clearTimeout(timer);
      timer = null;
      running = false;
      speed = 0;
      speedWall = 0;
      sim = new GalaxySim({ feedback: m.feedback, ...(m.nDm ? { nDm: m.nDm } : {}), ...(m.nGas ? { nGas: m.nGas } : {}), ...(m.spin ? { spin: m.spin } : {}) });
      announce = true;
      post();
    } else if (m.t === 'run') {
      if (m.run === running) return;
      running = m.run;
      if (running) {
        speedWall = 0;
        if (!timer) timer = setTimeout(loop, 0);
      } else {
        if (timer) clearTimeout(timer);
        timer = null;
        post();
      }
    }
  };
  void announce;
}
