import { MathUtils, Vector3 } from 'three';
import { DAYS_PER_JULIAN_YEAR } from '../config/astro';

/**
 * Keplerian orbits (PLAN §3.4, §13 Faz 2).
 *
 * Elements follow JPL's "Keplerian Elements for Approximate Positions of the
 * Major Planets" (Standish): each element is [value at J2000, rate per Julian
 * century]. Output is heliocentric ecliptic J2000 in AU (X towards the
 * equinox, Z towards the ecliptic north pole) — convert to scene axes with
 * ECLIPTIC_TO_SCENE.
 */

export type ElementPair = readonly [number, number];

export interface OrbitalElementsData {
  a: ElementPair; // semi-major axis, AU
  e: ElementPair; // eccentricity
  I: ElementPair; // inclination, deg
  L: ElementPair; // mean longitude, deg
  varpi: ElementPair; // longitude of perihelion, deg
  Omega: ElementPair; // longitude of the ascending node, deg
}

/** Elements evaluated at one instant (radians, AU). */
export interface OrbitalElements {
  a: number;
  e: number;
  I: number;
  Omega: number;
  /** Argument of perihelion ω = ϖ − Ω. */
  omega: number;
  /** Mean anomaly M = L − ϖ, wrapped to [-π, π). */
  M: number;
}

const DEG = Math.PI / 180;
const DAYS_PER_CENTURY = DAYS_PER_JULIAN_YEAR * 100;
const KEPLER_TOLERANCE = 1e-12;
const KEPLER_MAX_ITER = 30;

function wrapPi(x: number): number {
  const t = (x + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Evaluate the elements `daysSinceJ2000` days after J2000. */
export function elementsAt(data: OrbitalElementsData, daysSinceJ2000: number, out?: OrbitalElements): OrbitalElements {
  const T = daysSinceJ2000 / DAYS_PER_CENTURY;
  const val = (p: ElementPair) => p[0] + p[1] * T;
  const varpi = val(data.varpi) * DEG;
  const Omega = val(data.Omega) * DEG;
  const L = val(data.L) * DEG;
  const o = out ?? ({} as OrbitalElements);
  o.a = val(data.a);
  o.e = val(data.e);
  o.I = val(data.I) * DEG;
  o.Omega = Omega;
  o.omega = varpi - Omega;
  o.M = wrapPi(L - varpi);
  return o;
}

/** Solve Kepler's equation M = E − e·sin E (Newton–Raphson). */
export function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let i = 0; i < KEPLER_MAX_ITER; i++) {
    const f = E - e * Math.sin(E) - M;
    const d = f / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < KEPLER_TOLERANCE) break;
  }
  return E;
}

/**
 * Heliocentric ecliptic position (AU) for eccentric anomaly E.
 * Standard perifocal → ecliptic rotation by ω, I, Ω.
 */
export function positionFromEccentricAnomaly(el: OrbitalElements, E: number, out = new Vector3()): Vector3 {
  const { a, e, I, Omega, omega } = el;
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cO = Math.cos(Omega);
  const sO = Math.sin(Omega);
  const cI = Math.cos(I);
  const sI = Math.sin(I);

  return out.set(
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  );
}

/** Heliocentric ecliptic J2000 position in AU at the given instant. */
export function heliocentricEcliptic(data: OrbitalElementsData, daysSinceJ2000: number, out = new Vector3()): Vector3 {
  const el = elementsAt(data, daysSinceJ2000);
  return positionFromEccentricAnomaly(el, solveKepler(el.M, el.e), out);
}

/** Orbit-plane normal (ecliptic frame): the direction of orbital angular momentum. */
export function orbitNormal(el: OrbitalElements, out = new Vector3()): Vector3 {
  return out.set(Math.sin(el.I) * Math.sin(el.Omega), -Math.sin(el.I) * Math.cos(el.Omega), Math.cos(el.I));
}

/** Sidereal orbital period in days from the mean-longitude rate. */
export function orbitalPeriodDays(data: OrbitalElementsData): number {
  return (360 / data.L[1]) * DAYS_PER_CENTURY;
}

/** Mean anomaly as a 0..1 phase (used to animate orbit trails). */
export function meanAnomalyPhase(M: number): number {
  return MathUtils.euclideanModulo(M / (2 * Math.PI), 1);
}

// ---------------------------------------------------------------------------
// Orbit models. Every model yields elements at an instant; positions then come
// from positionFromEccentricAnomaly in the model's reference frame.
// ---------------------------------------------------------------------------

export interface OrbitModel {
  /** Elements at `daysSinceJ2000`. `a` is in AU for heliocentric models, km for satellites. */
  elements(daysSinceJ2000: number, out?: OrbitalElements): OrbitalElements;
}

/** JPL "approximate positions" table: value at J2000 + rate per century. */
export class TableOrbit implements OrbitModel {
  constructor(private readonly data: OrbitalElementsData) {}
  elements(d: number, out?: OrbitalElements): OrbitalElements {
    return elementsAt(this.data, d, out);
  }
}

export interface OsculatingElementsData {
  aAu: number;
  e: number;
  iDeg: number;
  nodeDeg: number;
  periDeg: number;
  meanAnomalyDeg: number;
  epochJd: number;
  meanMotionDegPerDay: number;
}

/** Fixed osculating elements at an epoch (JPL SBDB), mean anomaly advancing at n. */
export class OsculatingOrbit implements OrbitModel {
  private readonly epochDays: number;
  constructor(private readonly el: OsculatingElementsData) {
    this.epochDays = el.epochJd - JD_J2000_LOCAL;
  }
  elements(d: number, out?: OrbitalElements): OrbitalElements {
    const o = out ?? ({} as OrbitalElements);
    o.a = this.el.aAu;
    o.e = this.el.e;
    o.I = this.el.iDeg * DEG;
    o.Omega = this.el.nodeDeg * DEG;
    o.omega = this.el.periDeg * DEG;
    o.M = wrapPi((this.el.meanAnomalyDeg + this.el.meanMotionDegPerDay * (d - this.epochDays)) * DEG);
    return o;
  }
}

export interface SatelliteElementsData {
  aKm: number;
  e: number;
  omegaDeg: number;
  meanAnomalyDeg: number;
  iDeg: number;
  nodeDeg: number;
  periodDays: number;
  apsisPeriodYears: number | null;
  nodePeriodYears: number | null;
  /** Epoch as JD. */
  epochJd: number;
}

/**
 * JPL planetary-satellite mean elements: the node regresses and the line of
 * apsides advances with the tabulated periods; the mean anomaly follows the
 * orbital period.
 */
export class SatelliteOrbit implements OrbitModel {
  private readonly epochDays: number;
  constructor(private readonly el: SatelliteElementsData) {
    this.epochDays = el.epochJd - JD_J2000_LOCAL;
  }
  elements(d: number, out?: OrbitalElements): OrbitalElements {
    const t = d - this.epochDays;
    const years = t / DAYS_PER_JULIAN_YEAR;
    const node = this.el.nodeDeg - (this.el.nodePeriodYears ? (360 * years) / this.el.nodePeriodYears : 0);
    const varpi =
      this.el.nodeDeg + this.el.omegaDeg + (this.el.apsisPeriodYears ? (360 * years) / this.el.apsisPeriodYears : 0);
    const o = out ?? ({} as OrbitalElements);
    o.a = this.el.aKm;
    o.e = this.el.e;
    o.I = this.el.iDeg * DEG;
    o.Omega = node * DEG;
    o.omega = (varpi - node) * DEG;
    o.M = wrapPi((this.el.meanAnomalyDeg + (360 / this.el.periodDays) * t) * DEG);
    return o;
  }
}

const JD_J2000_LOCAL = 2_451_545.0;

/** "2000-01-01.5" (TDB calendar date with fractional day) → Julian Date. */
export function calendarToJd(s: string): number {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(\.\d+)?$/);
  if (!m) throw new Error(`Bad epoch: ${s}`);
  const day = Number(m[3]) + (m[4] ? Number(m[4]) : 0);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) / 86_400_000 + 2_440_587.5 + (day - 1);
}
