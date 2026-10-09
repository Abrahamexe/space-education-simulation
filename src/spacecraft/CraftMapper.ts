import { MathUtils, Vector3 } from 'three';
import { JD_J2000, KM_PER_AU } from '../config/astro';
import { scale } from '../core/scale';
import { ECLIPTIC_TO_SCENE } from '../physics/frames';
import { positionFromEccentricAnomaly, solveKepler, type OrbitalElements } from '../physics/orbits';
import type { Planet } from '../bodies/Planet';
import type { SolarSystem } from '../bodies/SolarSystem';
import type { CraftCenter } from './Trajectory';

const BODIES = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const;

/**
 * Where a spacecraft is drawn. The cinematic scale compresses heliocentric
 * distances and, separately, satellite systems around enlarged planets, so
 * one mapping cannot serve both:
 *  - 'helio' (cruise, flybys): the heliocentric position through the same
 *    curve as the planets, pushed just outside a planet's enlarged disc (and
 *    Saturn's rings) when the true path passes closer than that. Continuous
 *    and only bends paths right at a planet.
 *  - 'sat' (Earth orbiters, L2, orbital tours): about the centre body
 *    through the moons' curve, so Hubble sits above the drawn Earth, Webb
 *    beyond the drawn Moon and Cassini meets the drawn Titan.
 * The craft blends between the two when it switches (arrival at Jupiter).
 */
export class CraftMapper {
  private readonly bodies = new Map<string, Planet>();
  private readonly el: OrbitalElements = { a: 0, e: 0, I: 0, Omega: 0, omega: 0, M: 0 };
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmp3 = new Vector3();

  constructor(system: SolarSystem) {
    for (const id of BODIES) {
      const b = system.get(id) as Planet | undefined;
      if (b?.orbitModel) this.bodies.set(id, b);
    }
  }

  body(id: string): Planet | undefined {
    return this.bodies.get(id);
  }

  /** Heliocentric ecliptic position (km) of a planet at a Julian date (the Sun: 0). */
  helioKm(id: CraftCenter | string, jd: number, out: Vector3): Vector3 {
    const b = this.bodies.get(id);
    if (!b) return out.set(0, 0, 0);
    const el = b.orbitModel.elements(jd - JD_J2000, this.el);
    return positionFromEccentricAnomaly(el, solveKepler(el.M, el.e), out).multiplyScalar(KM_PER_AU);
  }

  /** Heliocentric ecliptic km → scene (absolute), the planets' own curve. */
  helioToScene(pKm: Vector3, out: Vector3): Vector3 {
    const d = pKm.length();
    if (d === 0) return out.set(0, 0, 0);
    return out.copy(pKm).applyMatrix3(ECLIPTIC_TO_SCENE).multiplyScalar(scale.distance(d) / d);
  }

  /** Scene distance range from the Sun each planet's orbit spans (pre-check for the push). */
  private shells(jd: number): Map<string, [number, number]> {
    const c = this.shellCache;
    if (c && Math.abs(jd - c.jd) < 3650 && c.blend === scale.blend && c.version === scale.version) return c.map;
    const map = new Map<string, [number, number]>();
    for (const [id, b] of this.bodies) {
      const el = b.orbitModel.elements(jd - JD_J2000, this.el);
      map.set(id, [scale.distance(el.a * (1 - el.e) * KM_PER_AU), scale.distance(el.a * (1 + el.e) * KM_PER_AU)]);
    }
    this.shellCache = { jd, blend: scale.blend, version: scale.version, map };
    return map;
  }

  private shellCache: { jd: number; blend: number; version: number; map: Map<string, [number, number]> } | null = null;

  /** Cruise / flyby mapping (see class notes). */
  helio(pKm: Vector3, jd: number, out: Vector3): Vector3 {
    this.helioToScene(pKm, out);
    const D = out.length();
    const shells = this.shells(jd);
    let best: { p: Vector3; R: number; L: number; h: number } | null = null;
    for (const [id, b] of this.bodies) {
      // Rings count as part of the disc to stay clear of.
      const R = b.getRadius() * (b.rings ? b.rings.outer : 1) * 1.15;
      const L = 2.4 * R;
      const sh = shells.get(id)!;
      if (D < sh[0] - L || D > sh[1] + L) continue;
      const p = this.helioToScene(this.helioKm(id, jd, this.tmp2), this.tmp3);
      const h = p.distanceTo(out);
      if (h < L && (!best || h / L < best.h / best.L)) best = { p: p.clone(), R, L, h };
    }
    if (!best || best.h < 1e-12) return out;
    // Monotone push: m(h) = h + R (1 - smoothstep(h, 0, L)), dm/dh > 0 for L ≥ 1.5 R.
    const m = best.h + best.R * (1 - MathUtils.smoothstep(best.h, 0, best.L));
    return out.sub(best.p).multiplyScalar(m / best.h).add(best.p);
  }

  /** Orbiter mapping: relative position (km, ecliptic) about the centre's drawn position. */
  sat(center: CraftCenter, rKm: Vector3, jd: number, out: Vector3): Vector3 {
    const b = this.bodies.get(center);
    const base = this.helioToScene(this.helioKm(center, jd, this.tmp), this.tmp);
    const d = rKm.length();
    if (!b || d === 0) return out.copy(base);
    return out
      .copy(rKm)
      .applyMatrix3(ECLIPTIC_TO_SCENE)
      .multiplyScalar(scale.satelliteDistance(d, b.radiusKm) / d)
      .add(base);
  }
}
