import { MathUtils, Vector3, type Group } from 'three';
import { KM_PER_AU } from '../config/astro';
import { scale } from '../core/scale';
import type { FloatingOrigin } from '../core/FloatingOrigin';
import type { Loader } from '../core/Loader';
import { ECLIPTIC_TO_SCENE } from '../physics/frames';
import {
  meanAnomalyPhase,
  orbitNormal,
  positionFromEccentricAnomaly,
  solveKepler,
  type OrbitModel,
  type OrbitalElements,
} from '../physics/orbits';
import { CelestialBody, type BodyDescriptor } from './CelestialBody';
import { OrbitLine } from './OrbitLine';
import type { RotationData } from './planetTypes';

export interface HeliocentricBodyData extends BodyDescriptor {
  rotation: RotationData;
}

/**
 * A body orbiting the Sun — the eight planets (JPL approximate elements) and
 * dwarf planets (SBDB osculating elements). Heliocentric ecliptic position
 * → scene direction, with the distance mapped by the scale system.
 */
export class Planet extends CelestialBody {
  protected elements: OrbitalElements = {} as OrbitalElements;
  private readonly normal = new Vector3();

  constructor(
    readonly data: HeliocentricBodyData,
    readonly orbitModel: OrbitModel,
    world: Group,
    origin: FloatingOrigin,
    loader: Loader,
  ) {
    super(data, world, origin, loader);
    this.orbit = new OrbitLine(orbitModel, data.render.orbitColor, (p) => {
      const km = p.length() * KM_PER_AU;
      p.applyMatrix3(ECLIPTIC_TO_SCENE).normalize().multiplyScalar(scale.distance(km));
    });
    world.add(this.orbit.line);
  }

  get orbitPhase(): number {
    return meanAnomalyPhase(this.elements.M);
  }

  protected updatePosition(d: number): void {
    this.elements = this.orbitModel.elements(d, this.elements);
    const p = this.simPositionAu
      ? this.tmp.copy(this.simPositionAu)
      : positionFromEccentricAnomaly(this.elements, solveKepler(this.elements.M, this.elements.e), this.tmp);
    const km = p.length() * KM_PER_AU;
    this.sunDistanceKm = km;
    p.applyMatrix3(ECLIPTIC_TO_SCENE).normalize().multiplyScalar(scale.distance(km));
    this.absolutePosition.copy(p);
  }

  protected updateOrientation(d: number): void {
    const rot = this.data.rotation;
    if ('poleRaDeg' in rot) {
      const r = this.data.render;
      // Venus: the visible cloud deck super-rotates far faster than the ground.
      const w = r.cloudRotationDays ? (rot.w0Deg + (360 / r.cloudRotationDays) * d) % 360 : undefined;
      this.applyIauRotation(rot, d, w);
      return;
    }
    // No published pole: spin about the orbit normal (approximation).
    const n = orbitNormal(this.elements, this.normal).applyMatrix3(ECLIPTIC_TO_SCENE);
    this.setOrientBasis(n, Math.abs(n.y) < 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1));
    if (rot.kind === 'period') {
      this.spin.rotation.y = MathUtils.degToRad(((360 * d * 24) / rot.periodHours) % 360);
    }
  }
}
