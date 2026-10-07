/**
 * Circumstellar habitable zone, Kopparapu et al. 2014 (ApJL 787, L29),
 * updating Kopparapu et al. 2013 (ApJ 765, 131): effective stellar flux
 * limits as a polynomial in T = Teff − 5780 K, valid for 2600–7200 K.
 * Distance d = √(L / S_eff) AU, L in solar luminosities.
 *
 *  - conservative: runaway greenhouse (1 Earth mass) → maximum greenhouse;
 *  - optimistic:   "recent Venus" → "early Mars" (empirical limits).
 */

interface Limit {
  S0: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

const RECENT_VENUS: Limit = { S0: 1.776, a: 2.136e-4, b: 2.533e-8, c: -1.332e-11, d: -3.097e-15 };
const RUNAWAY_GREENHOUSE: Limit = { S0: 1.107, a: 1.332e-4, b: 1.58e-8, c: -8.308e-12, d: -1.931e-15 };
const MAXIMUM_GREENHOUSE: Limit = { S0: 0.356, a: 6.171e-5, b: 1.698e-9, c: -3.198e-12, d: -5.575e-16 };
const EARLY_MARS: Limit = { S0: 0.32, a: 5.547e-5, b: 1.526e-9, c: -2.874e-12, d: -5.011e-16 };

const SUN_TEFF = 5772;

function seff(l: Limit, teff: number): number {
  const T = Math.min(Math.max(teff, 2600), 7200) - 5780;
  return l.S0 + l.a * T + l.b * T * T + l.c * T ** 3 + l.d * T ** 4;
}

export interface HabitableZone {
  /** AU. */
  optimisticInner: number;
  conservativeInner: number;
  conservativeOuter: number;
  optimisticOuter: number;
}

/** Luminance (solar units) from radius (solar radii) and effective temperature. */
export function luminosity(radiusSun: number, teff: number): number {
  return radiusSun * radiusSun * (teff / SUN_TEFF) ** 4;
}

export function habitableZone(teff: number, lumSun: number): HabitableZone {
  const d = (l: Limit) => Math.sqrt(lumSun / seff(l, teff));
  return {
    optimisticInner: d(RECENT_VENUS),
    conservativeInner: d(RUNAWAY_GREENHOUSE),
    conservativeOuter: d(MAXIMUM_GREENHOUSE),
    optimisticOuter: d(EARLY_MARS),
  };
}
