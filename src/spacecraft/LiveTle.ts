import { OBLIQUITY_J2000_DEG } from '../config/astro';

/**
 * Earth orbiters past the end of their JPL Horizons data (Horizons predicts
 * them only a few weeks ahead): the current two-line elements from CelesTrak,
 * propagated as a Kepler orbit with the J2 drifts of the node and perigee and
 * the TLE's decay term. Not SGP4, but within tens of km over days, which is
 * far below what the view can show. Positions come out like the Horizons
 * samples: relative to the Earth, km and km/s, ecliptic J2000.
 */

const MU = 398600.4418; // km³/s²
const RE = 6378.137; // km
const J2 = 1.08262668e-3;
const DAY_S = 86400;
const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
const TDB_MINUS_UTC_S = 69.184;
/** Elements are used this many days either side of their epoch. */
export const TLE_VALID_DAYS = 30;
/** Fetched elements are kept (localStorage) and refreshed after this long (CelesTrak asks for no more than every few hours). */
const CACHE_MS = 6 * 3600 * 1000;

export interface TleElements {
  /** Epoch (Julian date, TDB). */
  epochJd: number;
  /** Radians, and mean motion in rad/s; ndot2: half the mean motion's rate (rad/s²). */
  i: number;
  raan: number;
  e: number;
  argp: number;
  m0: number;
  n: number;
  ndot2: number;
}

/** Parse a TLE (line 1, line 2). Null when the lines don't look like one. */
export function parseTle(l1: string, l2: string): TleElements | null {
  if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) return null;
  const yy = Number(l1.slice(18, 20));
  const doy = Number(l1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  // JD of Jan 0.0 of the year, plus the fractional day of year.
  // TLE epochs are UTC; the app's dates (like the Horizons samples) are TDB: 37 leap s + 32.184 s ahead.
  const epochJd = Date.UTC(year, 0, 1) / 86400000 + 2440587.5 - 1 + doy + TDB_MINUS_UTC_S / DAY_S;
  const revDay = TWO_PI / DAY_S;
  const el: TleElements = {
    epochJd,
    i: Number(l2.slice(8, 16)) * DEG,
    raan: Number(l2.slice(17, 25)) * DEG,
    e: Number(`0.${l2.slice(26, 33).trim()}`),
    argp: Number(l2.slice(34, 42)) * DEG,
    m0: Number(l2.slice(43, 51)) * DEG,
    n: Number(l2.slice(52, 63)) * revDay,
    ndot2: Number(l1.slice(33, 43)) * revDay / DAY_S,
  };
  return Object.values(el).every(Number.isFinite) && el.n > 0 ? el : null;
}

/** Precession angles (IAU 1976) from J2000 to the date, radians. */
function precession(jd: number): [number, number, number] {
  const T = (jd - 2451545) / 36525;
  const s = (Math.PI / 180) / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * s;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * s;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * s;
  return [zeta, z, theta];
}

/** Equator and equinox of date → J2000 equatorial (transpose of the precession matrix), in place. */
function toJ2000(v: number[], jd: number): void {
  const [zeta, z, th] = precession(jd);
  const cz = Math.cos(zeta), sz = Math.sin(zeta);
  const cZ = Math.cos(z), sZ = Math.sin(z);
  const ct = Math.cos(th), st = Math.sin(th);
  // P = Rz(-z) · Ry(theta) · Rz(-zeta); out = Pᵀ · v.
  const p = [
    [cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st],
    [sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st],
    [st * cz, -st * sz, ct],
  ];
  const [x, y, w] = v;
  v[0] = p[0][0] * x + p[1][0] * y + p[2][0] * w;
  v[1] = p[0][1] * x + p[1][1] * y + p[2][1] * w;
  v[2] = p[0][2] * x + p[1][2] * y + p[2][2] * w;
}

const EPS = OBLIQUITY_J2000_DEG * DEG;

/** J2000 equatorial → ecliptic, in place. */
function toEcliptic(v: number[]): void {
  const y = v[1];
  const z = v[2];
  v[1] = y * Math.cos(EPS) + z * Math.sin(EPS);
  v[2] = -y * Math.sin(EPS) + z * Math.cos(EPS);
}

/** Position (km) and velocity (km/s) relative to the Earth, ecliptic J2000, at a Julian date. */
export function tleState(el: TleElements, jd: number, r: number[], v: number[]): void {
  const dt = (jd - el.epochJd) * DAY_S;
  const n = el.n + 2 * el.ndot2 * dt;
  const a = Math.cbrt(MU / (n * n));
  const e = el.e;
  const p = a * (1 - e * e);
  const k = 1.5 * J2 * (RE / p) ** 2 * el.n;
  const si = Math.sin(el.i);
  const ci = Math.cos(el.i);
  const raan = el.raan - k * ci * dt;
  const argp = el.argp + k * (2 - 2.5 * si * si) * dt;
  const M = el.m0 + el.n * dt + el.ndot2 * dt * dt;
  // Kepler's equation.
  let E = M;
  for (let it = 0; it < 12; it++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  const cE = Math.cos(E);
  const sE = Math.sin(E);
  const sq = Math.sqrt(1 - e * e);
  // Perifocal position and velocity.
  const xp = a * (cE - e);
  const yp = a * sq * sE;
  const rr = a * (1 - e * cE);
  const vf = Math.sqrt(MU * a) / rr;
  const vxp = -vf * sE;
  const vyp = vf * sq * cE;
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const r11 = cO * cw - sO * sw * ci, r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci, r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si, r32 = cw * si;
  r[0] = r11 * xp + r12 * yp;
  r[1] = r21 * xp + r22 * yp;
  r[2] = r31 * xp + r32 * yp;
  v[0] = r11 * vxp + r12 * vyp;
  v[1] = r21 * vxp + r22 * vyp;
  v[2] = r31 * vxp + r32 * vyp;
  // TLEs are in TEME, close to the equator and equinox of date.
  toJ2000(r, jd);
  toJ2000(v, jd);
  toEcliptic(r);
  toEcliptic(v);
}

/** Current elements for a NORAD catalogue number (cached; null when offline and nothing cached). */
export async function fetchTle(norad: number): Promise<TleElements | null> {
  const key = `space.tle.${norad}`;
  let cached: { t: number; l1: string; l2: string } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    cached = null;
  }
  if (cached && Date.now() - cached.t < CACHE_MS) return parseTle(cached.l1, cached.l2);
  try {
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=TLE`);
    if (!res.ok) throw new Error(String(res.status));
    const lines = (await res.text()).split(/\r?\n/).map((s) => s.trimEnd());
    const i = lines.findIndex((s) => s.startsWith('1 '));
    const el = i >= 0 ? parseTle(lines[i], lines[i + 1] ?? '') : null;
    if (!el) throw new Error('no TLE');
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), l1: lines[i], l2: lines[i + 1] }));
    } catch {
      /* storage full or blocked: fine */
    }
    return el;
  } catch {
    return cached ? parseTle(cached.l1, cached.l2) : null;
  }
}
