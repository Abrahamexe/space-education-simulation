/**
 * Semi-analytic model behind the BAO lab scene and the film's first chapter: a point-like
 * adiabatic overdensity whose dark-matter, baryon, photon and neutrino mass profiles r²·δ(r)
 * are followed in time (after Eisenstein, Seo & White 2007, ApJ 664, 675, Fig. 1).
 * Shapes and the ~150 Mpc scale come from the cosmology below; amplitudes are representative.
 */

// ---------------------------------------------------------------- cosmology

export const C_KMS = 299792.458;
export const h = 0.677;
export const OM = 0.31;
export const OB = 0.049;
export const OC = OM - OB;
export const OG = 2.47e-5 / (h * h); // photons
export const OR = OG * (1 + 0.2271 * 3.046); // photons + massless neutrinos
export const OL = 1 - OM - OR;
export const H0 = 100 * h; // km/s/Mpc
export const A_EQ = OR / OM;
export const FB = OB / OM; // baryon fraction of the clustering matter
export const FC = OC / OM;
export const Z_D = 1060; // drag epoch
export const R_COEF = (3 * OB) / (4 * OG); // R(z) = R_COEF / (1 + z)
export const YR_PER_MPC_KMS = 3.08568e19 / 3.15576e7; // (Mpc / (km/s)) in years

export const hubble = (z: number): number => H0 * Math.sqrt(OR * (1 + z) ** 4 + OM * (1 + z) ** 3 + OL);
export const soundSpeed = (z: number): number => C_KMS / Math.sqrt(3 * (1 + R_COEF / (1 + z)));

/**
 * Integrals over redshift tabulated in u = ln(1+z): the integrands span many
 * decades in z, so equal steps in u keep a plain trapezoid rule accurate.
 * Each table holds the integral from u up to z = 1e8 (everything earlier is
 * negligible: the light horizon there is ~5·10⁻³ Mpc).
 */
export const N_STEPS = 2000;
export const U_MAX = Math.log(1e8 + 1);
export const DU = U_MAX / N_STEPS;

export interface Tables {
  rs: Float64Array; // sound horizon (Mpc)
  chi: Float64Array; // comoving light horizon (Mpc)
  age: Float64Array; // cosmic time (yr)
}

export function cumulate(f: (z: number) => number): Float64Array {
  const out = new Float64Array(N_STEPS + 1);
  const g = (i: number): number => {
    const z = Math.exp(i * DU) - 1;
    return f(z) * (1 + z); // dz = (1+z) du
  };
  let prev = g(N_STEPS);
  for (let i = N_STEPS - 1; i >= 0; i--) {
    const cur = g(i);
    out[i] = out[i + 1] + 0.5 * (cur + prev) * DU;
    prev = cur;
  }
  return out;
}

let tables: Tables | null = null;
export function getTables(): Tables {
  tables ??= {
    rs: cumulate((z) => soundSpeed(z) / hubble(z)),
    chi: cumulate((z) => C_KMS / hubble(z)),
    age: cumulate((z) => YR_PER_MPC_KMS / ((1 + z) * hubble(z))),
  };
  return tables;
}

export function lookup(tab: Float64Array, z: number): number {
  const x = Math.min(Math.max(Math.log(1 + z) / DU, 0), N_STEPS);
  const i = Math.min(Math.floor(x), N_STEPS - 1);
  return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
}

export const soundHorizon = (z: number): number => lookup(getTables().rs, z);
export const lightHorizon = (z: number): number => lookup(getTables().chi, z);
export const cosmicAge = (z: number): number => lookup(getTables().age, z);

/** Scale factor at which the sound horizon equalled `r` (0 if r <= 0). */
export function scaleFactorAtSoundHorizon(r: number): number {
  if (r <= 0) return 0;
  const tab = getTables().rs; // decreasing with index
  let lo = 0;
  let hi = N_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab[mid] > r) lo = mid;
    else hi = mid;
  }
  return Math.exp(-(lo + (tab[lo] - r) / (tab[lo] - tab[hi])) * DU);
}

/** Eisenstein & Hu (1998) eq. 26 fitting formula for the sound horizon at drag (Mpc). */
export const EH98_RS = (44.5 * Math.log(9.83 / (OM * h * h))) / Math.sqrt(1 + 10 * (OB * h * h) ** 0.75);

// ------------------------------------------------------------------ growth

/** Carroll, Press & Turner (1992) suppression factor g(a) for matter + Λ (g = 1 deep in the matter era). */
export function cptSuppression(a: number): number {
  const e = OM / a ** 3 + OL;
  const om = OM / a ** 3 / e;
  const ol = OL / e;
  return (2.5 * om) / (om ** (4 / 7) - ol + (1 + om / 2) * (1 + ol / 70));
}

/** Meszaros solution: growth of dark matter through matter-radiation equality. */
export const meszaros = (a: number): number => 1 + (1.5 * a) / A_EQ;

/** Growth factor G(a) for the clustering matter after decoupling (Meszaros × CPT; ∝ a near a_d). */
export const growthFactor = (a: number): number => meszaros(a) * cptSuppression(a);

// ---------------------------------------------------------- profile shapes

export const R_MAX = 220;
export const R_STEP = 0.5;
export const NR = Math.round(R_MAX / R_STEP) + 1;
export const RADII = Float64Array.from({ length: NR }, (_, i) => i * R_STEP);
export const SIGMA0 = 6; // initial Gaussian width (Mpc)
export const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Abramowitz & Stegun 7.1.26 error function (|error| < 1.5e-7). */
export function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
export const normCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));
export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / SQRT_2PI;

/**
 * Adds the mass profile r²·δ of a Gaussian shell (δ ∝ exp(-(r-μ)²/2w²)) with
 * total "mass" ∫r²δ dr = mass. The integral over r ≥ 0 is exact, so a shell
 * sitting at the origin (μ = 0, the initial condition) is also normalised.
 */
export function addShell(out: Float64Array, mu: number, w: number, mass: number): void {
  const m = mu / w;
  const integral = w * SQRT_2PI * ((mu * mu + w * w) * normCdf(m) + mu * w * normPdf(m));
  const k = mass / integral;
  for (let i = 0; i < NR; i++) {
    const r = RADII[i];
    const d = (r - mu) / w;
    out[i] += k * r * r * Math.exp(-0.5 * d * d);
  }
}

/** Approximate Silk damping width (Mpc): 8 Mpc at the drag epoch, scaling as r_s^1.5. */
export const silkWidth = (z: number): number => Math.max(2, 8 * (soundHorizon(z) / soundHorizon(Z_D)) ** 1.5);

export interface Fields {
  dm: Float64Array;
  baryon: Float64Array;
  photon: Float64Array;
  neutrino: Float64Array;
  centralGrowth: number; // dark-matter central amplitude relative to the start
}

export const zeros = (): Float64Array => new Float64Array(NR);

/** Neutrinos free-stream from the start: a broad shell at the light horizon, small amplitude. */
export function neutrinoShell(z: number): Float64Array {
  const chi = lightHorizon(z);
  const out = zeros();
  addShell(out, chi, Math.hypot(SIGMA0, 0.3 * chi), 0.6);
  return out;
}

/** Before the drag epoch: baryons and photons are one fluid carrying a sound shell. */
export function fieldsBeforeDrag(z: number): Fields {
  const a = 1 / (1 + z);
  const D = meszaros(a);
  const rs = soundHorizon(z);
  const w = Math.hypot(SIGMA0, silkWidth(z));
  // Baryons are pressure-supported, so only a modest part follows the deepening
  // dark-matter well at the centre (representative amplitude).
  const centralBaryon = 0.25 * FC * (1 - 1 / D);
  // The shell pulls the dark matter it passes: the wake grows by the extra
  // growth accumulated since the shell was one width further in.
  const aCross = scaleFactorAtSoundHorizon(rs - w);
  const wake = FB * (1 - meszaros(aCross) / D) * (1 - centralBaryon);

  const dm = zeros();
  addShell(dm, 0, SIGMA0, D);
  addShell(dm, rs, w, wake);
  const baryon = zeros();
  addShell(baryon, rs, w, 1 - centralBaryon);
  addShell(baryon, 0, SIGMA0, centralBaryon);
  const photon = zeros();
  addShell(photon, rs, w, 4 / 3); // adiabatic: δ_γ = (4/3) δ_b
  return { dm, baryon, photon, neutrino: neutrinoShell(z), centralGrowth: D };
}

let atDrag: Fields | null = null;

/** After the drag epoch: both matter components are pressureless and converge. */
export function fieldsAfterDrag(z: number): Fields {
  atDrag ??= fieldsBeforeDrag(Z_D);
  const d = atDrag;
  const aD = 1 / (1 + Z_D);
  const a = 1 / (1 + z);
  const f = growthFactor(a) / growthFactor(aD);
  const dm = zeros();
  const baryon = zeros();
  for (let i = 0; i < NR; i++) {
    const mean = FC * d.dm[i] + FB * d.baryon[i]; // δ_m at z_d
    const diff = d.baryon[i] - d.dm[i]; // Δ = δ_b - δ_c, frozen
    dm[i] = f * mean - FB * diff;
    baryon[i] = f * mean + FC * diff;
  }
  // Photons leave at c from the stalled shell and fade; they also spread out.
  const dChi = Math.max(lightHorizon(z) - lightHorizon(Z_D), 0);
  const photon = zeros();
  const w = Math.hypot(Math.hypot(SIGMA0, silkWidth(Z_D)), 0.35 * dChi);
  addShell(photon, soundHorizon(Z_D) + dChi, w, (4 / 3) * (aD / a));
  return { dm, baryon, photon, neutrino: neutrinoShell(z), centralGrowth: growthFactor(a) };
}

export function fieldsAt(z: number): Fields {
  return z > Z_D ? fieldsBeforeDrag(z) : fieldsAfterDrag(z);
}

