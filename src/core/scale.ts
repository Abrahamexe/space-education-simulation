import { KM_PER_AU } from '../config/astro';

/**
 * The single place where physical sizes and distances (km) become scene
 * units. No other module may convert km → units on its own.
 *
 * Two modes (PLAN §3.1):
 *  - cinematic: sizes and distances are compressed with power laws so the
 *    whole system fits on screen and small bodies remain visible.
 *  - real: one linear factor for everything; true proportions.
 *
 * A blend factor `t` ∈ [0, 1] interpolates between the two in log space so
 * the mode switch can be animated without anything popping.
 */

export type ScaleMode = 'cinematic' | 'real';

/** Reference body for the cinematic size curve: Earth's mean radius. */
const REF_RADIUS_KM = 6371.0;

export const SCALE_CONFIG = {
  cinematic: {
    /** Earth's radius in scene units; anchors the size curve. */
    refRadiusUnits: 1.5,
    /** Size compression exponent. 1 = true ratios; Sun/Earth = 109^p. */
    radiusExponent: 0.55,
    /** Distance of 1 AU in scene units. Mercury then sits ~5 solar radii out. */
    unitsPerAu: 180,
    /** Distance compression exponent (Mercury..Neptune ≈ 0.4..30 AU). */
    distanceExponent: 0.6,
    /**
     * Satellite distances, in units of the parent's radius: true ratios up
     * to this many radii (keeps inner moons outside rings), compressed
     * beyond it.
     */
    satelliteLinearRadii: 4,
    satelliteExponent: 0.55,
  },
  real: {
    /** Same anchor as cinematic so Earth keeps its on-screen size. */
    kmPerUnit: REF_RADIUS_KM / 1.5,
  },
} as const;

function cinematicRadius(km: number): number {
  const c = SCALE_CONFIG.cinematic;
  return c.refRadiusUnits * Math.pow(km / REF_RADIUS_KM, c.radiusExponent);
}

function cinematicDistance(km: number): number {
  const c = SCALE_CONFIG.cinematic;
  if (km <= 0) return 0;
  return c.unitsPerAu * Math.pow(km / KM_PER_AU, c.distanceExponent);
}

function realLength(km: number): number {
  return km / SCALE_CONFIG.real.kmPerUnit;
}

/** Log-space interpolation; both inputs must be > 0. */
function logLerp(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
}

type Listener = () => void;

export class ScaleSystem {
  private _mode: ScaleMode = 'cinematic';
  /** 0 = cinematic, 1 = real. Animated during a mode switch. */
  private _t = 0;
  private readonly listeners = new Set<Listener>();

  get mode(): ScaleMode {
    return this._mode;
  }

  get blend(): number {
    return this._t;
  }

  /** Set the interpolation factor directly (used by mode-switch tweens). */
  setBlend(t: number): void {
    const clamped = Math.min(1, Math.max(0, t));
    if (clamped === this._t) return;
    this._t = clamped;
    this._mode = clamped >= 0.5 ? 'real' : 'cinematic';
    this.listeners.forEach((fn) => fn());
  }

  setMode(mode: ScaleMode): void {
    this.setBlend(mode === 'real' ? 1 : 0);
  }

  /** Body radius (km) → scene units. */
  radius(km: number): number {
    return logLerp(cinematicRadius(km), realLength(km), this._t);
  }

  /** Heliocentric distance (km) → scene units. */
  distance(km: number): number {
    if (km <= 0) return 0;
    return logLerp(cinematicDistance(km), realLength(km), this._t);
  }

  /**
   * Satellite distance from its parent (km) → scene units. In cinematic mode
   * the distance is measured in parent radii, kept true near the planet and
   * compressed further out, then multiplied by the parent's on-screen radius.
   */
  satelliteDistance(km: number, parentRadiusKm: number): number {
    if (km <= 0) return 0;
    const c = SCALE_CONFIG.cinematic;
    const x = km / parentRadiusKm;
    const k = c.satelliteLinearRadii;
    const f = x <= k ? x : k * Math.pow(x / k, c.satelliteExponent);
    return logLerp(f * cinematicRadius(parentRadiusKm), realLength(km), this._t);
  }

  /** Scene units → km along a radial distance (inverse of `distance`). */
  distanceToKm(units: number): number {
    if (units <= 0) return 0;
    // Bisection (in log space) on the monotone forward map keeps this exact
    // for any blend. The bracket grows until it holds the answer: the
    // playground places bodies light-years out.
    let lo = 1e-3;
    let hi = KM_PER_AU;
    while (this.distance(hi) < units && hi < 1e30) hi *= 16;
    if (this.distance(lo) >= units) return lo;
    for (let i = 0; i < 100; i++) {
      const mid = Math.sqrt(lo * hi);
      if (this.distance(mid) < units) lo = mid;
      else hi = mid;
      if (hi / lo < 1 + 1e-12) break;
    }
    return Math.sqrt(lo * hi);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const scale = new ScaleSystem();
