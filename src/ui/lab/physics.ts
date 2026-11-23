/**
 * Physical constants and small cosmology helpers for the student lab. SI
 * units inside, astronomer's units at the edges (km/s, Mpc, kpc, M☉).
 */

export const G = 6.674e-11;
export const C = 2.998e8;
export const MSUN = 1.989e30;
export const MPC = 3.0857e22;
export const KPC = 3.0857e19;
export const LY_PER_MPC = 3.2616e6;

/** Flat ΛCDM used by the worked examples (Planck-like, H0 = 70 for round numbers). */
export const COSMO = { H0: 70, Om: 0.3, OL: 0.7 };

/** Comoving distance (Mpc) to redshift z. */
export function comoving(z: number, H0 = COSMO.H0, Om = COSMO.Om): number {
  const n = 400;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const zi = ((i + 0.5) / n) * z;
    s += 1 / Math.sqrt(Om * (1 + zi) ** 3 + (1 - Om));
  }
  return ((299792.458 / H0) * s * z) / n;
}

/** Angular-diameter distance (Mpc) to z, and between z1 < z2 (flat universe). */
export function angularDiameter(z: number): number {
  return comoving(z) / (1 + z);
}
export function angularDiameterBetween(z1: number, z2: number): number {
  return (comoving(z2) - comoving(z1)) / (1 + z2);
}

/** Virial mass M ≈ 5 σ² R / G (uniform sphere), σ km/s, R Mpc → M☉. */
export function virialMass(sigmaKms: number, rMpc: number): number {
  return (5 * (sigmaKms * 1e3) ** 2 * rMpc * MPC) / G / MSUN;
}

/** Mass inside r for a circular speed: M = v² r / G (v km/s, r kpc → M☉). */
export function enclosedMass(vKms: number, rKpc: number): number {
  return ((vKms * 1e3) ** 2 * rKpc * KPC) / G / MSUN;
}

/** Circular speed (km/s) at r (kpc) for an enclosed mass (M☉). */
export function circularSpeed(mSun: number, rKpc: number): number {
  return Math.sqrt((G * mSun * MSUN) / (rKpc * KPC)) / 1e3;
}

/** NFW halo: speed at r (kpc) for V200 (km/s) and concentration c, r200 = V200 / (10 H0). */
export function nfwSpeed(rKpc: number, v200: number, c: number, H0 = COSMO.H0): number {
  const r200 = v200 / (10 * H0) * 1000; // kpc (H0 in km/s/Mpc → r200 = V200/(10 H0) Mpc)
  const x = rKpc / r200;
  const m = (y: number) => Math.log(1 + y) - y / (1 + y);
  return v200 * Math.sqrt(m(c * x) / (x * m(c)));
}

/** Einstein-radius mass (M☉) for θE (arcsec), lens and source redshifts. */
export function einsteinMass(thetaArcsec: number, zl: number, zs: number): number {
  const th = (thetaArcsec / 3600) * (Math.PI / 180);
  const Dl = angularDiameter(zl) * MPC;
  const Ds = angularDiameter(zs) * MPC;
  const Dls = angularDiameterBetween(zl, zs) * MPC;
  return ((th * th * C * C) / (4 * G)) * ((Dl * Ds) / Dls) / MSUN;
}

/** Linear growth factor D(a), D(1) = 1 (Carroll, Press & Turner 1992). */
export function growth(a: number, Om = COSMO.Om): number {
  const OL = 1 - Om;
  const g = (x: number) => {
    const e = Om / x ** 3 + OL;
    const om = Om / x ** 3 / e;
    const ol = OL / e;
    return (2.5 * om) / (om ** (4 / 7) - ol + (1 + om / 2) * (1 + ol / 70));
  };
  return (a * g(a)) / g(1);
}

/** "1,23 × 10¹⁵" style number. */
export function sci(x: number, digits = 2): string {
  if (!Number.isFinite(x) || x === 0) return String(x);
  const e = Math.floor(Math.log10(Math.abs(x)));
  const m = x / 10 ** e;
  const sup = String(e).replace(/[-0-9]/g, (c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);
  return `${m.toLocaleString('tr-TR', { maximumFractionDigits: digits })} × 10${sup}`;
}

/** Turkish decimal formatting. */
export function num(x: number, digits = 1): string {
  return x.toLocaleString('tr-TR', { maximumFractionDigits: digits });
}
