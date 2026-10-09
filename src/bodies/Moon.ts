import { Group, MathUtils, Matrix3, Vector3 } from 'three';
import { scale } from '../core/scale';
import type { FloatingOrigin } from '../core/FloatingOrigin';
import type { Loader } from '../core/Loader';
import type { FrameContext } from '../core/types';
import { ECLIPTIC_TO_SCENE, SCENE_TO_ECLIPTIC, poleFrameFromRaDec } from '../physics/frames';
import {
  SatelliteOrbit,
  calendarToJd,
  meanAnomalyPhase,
  orbitNormal,
  positionFromEccentricAnomaly,
  solveKepler,
  type OrbitalElements,
} from '../physics/orbits';
import { CelestialBody, type BodyDescriptor } from './CelestialBody';
import { OrbitLine } from './OrbitLine';
import type { Planet } from './Planet';
import { PLANETS } from '../config/visual';

/** One row of src/data/generated/satellites.json (JPL mean elements). */
export interface SatelliteRecord {
  name: string;
  planet: string;
  frame: string;
  epoch: string;
  aKm: number;
  e: number;
  omegaDeg: number;
  meanAnomalyDeg: number;
  iDeg: number;
  nodeDeg: number;
  periodDays: number;
  apsisPeriodYears: number | null;
  nodePeriodYears: number | null;
  laplacePoleRaDeg: number | null;
  laplacePoleDecDeg: number | null;
  meanRadiusKm: number | null;
}

export interface MoonData extends BodyDescriptor {
  parent: string;
  /** Name in JPL's tables, if it differs from `name`. */
  jplName: string;
  rotation: { kind: 'synchronous' } | { kind: 'period'; periodHours: number };
}

const M = PLANETS.moons;

/**
 * A natural satellite. Elements are JPL mean elements in their native frame
 * (local Laplace plane, parent equator or ecliptic); positions are relative
 * to the parent, with the distance compressed by the scale system.
 * Tidally locked moons keep their prime meridian on the parent's *mean*
 * direction, so the eccentric orbit produces real optical libration.
 */
export class Moon extends CelestialBody {
  /** Follows the parent's position; the moon's orbit line hangs from it. */
  readonly anchor = new Group();
  private readonly model: SatelliteOrbit;
  private readonly frame: Matrix3;
  private elements: OrbitalElements = {} as OrbitalElements;
  private readonly meanEl: OrbitalElements = {} as OrbitalElements;
  private relevance = 1;

  constructor(
    readonly data: MoonData,
    sat: SatelliteRecord,
    readonly parent: Planet | Moon | CelestialBody,
    world: Group,
    origin: FloatingOrigin,
    loader: Loader,
  ) {
    super(data, world, origin, loader);
    this.model = new SatelliteOrbit({
      aKm: sat.aKm,
      e: sat.e,
      omegaDeg: sat.omegaDeg,
      meanAnomalyDeg: sat.meanAnomalyDeg,
      iDeg: sat.iDeg,
      nodeDeg: sat.nodeDeg,
      periodDays: sat.periodDays,
      apsisPeriodYears: sat.apsisPeriodYears,
      nodePeriodYears: sat.nodePeriodYears,
      epochJd: calendarToJd(sat.epoch),
    });
    this.frame = Moon.frameFor(sat, parent);

    this.anchor.name = `${data.id}-anchor`;
    world.add(this.anchor);
    const parentKm = parent.radiusKm;
    this.orbit = new OrbitLine(
      this.model,
      data.render.orbitColor,
      (p) => {
        const km = p.length();
        p.applyMatrix3(this.frame).normalize().multiplyScalar(scale.satelliteDistance(km, parentKm));
      },
      M.orbitSegments,
    );
    this.orbit.opacity = M.orbitOpacity;
    this.anchor.add(this.orbit.line);
  }

  /** Reference frame of the elements → scene. */
  private static frameFor(sat: SatelliteRecord, parent: CelestialBody): Matrix3 {
    if (sat.frame.startsWith('ecliptic')) return ECLIPTIC_TO_SCENE.clone();
    if (sat.frame.startsWith('laplace') && sat.laplacePoleRaDeg !== null && sat.laplacePoleDecDeg !== null) {
      return poleFrameFromRaDec(sat.laplacePoleRaDeg, sat.laplacePoleDecDeg);
    }
    // "equatorial": the parent's equator (IAU pole at J2000).
    const rot = (parent as Planet).data?.rotation;
    if (rot && 'poleRaDeg' in rot) return poleFrameFromRaDec(rot.poleRaDeg[0], rot.poleDecDeg[0]);
    return ECLIPTIC_TO_SCENE.clone();
  }

  /** True heliocentric ecliptic position (km): the planet's plus the moon's offset. */
  trueHelioKm(out: Vector3): Vector3 {
    const rel = positionFromEccentricAnomaly(this.elements, solveKepler(this.elements.M, this.elements.e), new Vector3())
      .applyMatrix3(this.frame)
      .applyMatrix3(SCENE_TO_ECLIPTIC);
    const parent = this.parent as unknown as { trueHelioKm?: (o: Vector3) => Vector3 };
    return (parent.trueHelioKm ? parent.trueHelioKm(out) : out.set(0, 0, 0)).add(rel);
  }

  get orbitPhase(): number {
    return meanAnomalyPhase(this.elements.M);
  }

  protected override markerSize(): number {
    return M.markerSizePx;
  }

  protected updatePosition(d: number): void {
    this.elements = this.model.elements(d, this.elements);
    const E = solveKepler(this.elements.M, this.elements.e);
    const p = positionFromEccentricAnomaly(this.elements, E, this.tmp);
    const km = p.length();
    p.applyMatrix3(this.frame).normalize().multiplyScalar(scale.satelliteDistance(km, this.parent.radiusKm));
    this.parent.getAbsolutePosition(this.tmp2);
    this.anchor.position.copy(this.tmp2);
    this.absolutePosition.copy(this.tmp2).add(p);
    this.sunDistanceKm = this.parent.heliocentricDistanceKm;
  }

  protected updateOrientation(d: number): void {
    const n = orbitNormal(this.elements, this.tmp2).applyMatrix3(this.frame).normalize();
    const rot = this.data.rotation;
    if (rot.kind === 'synchronous') {
      // Mean (circular) position → prime meridian faces the parent from there.
      Object.assign(this.meanEl, this.elements, { e: 0 });
      const mean = positionFromEccentricAnomaly(this.meanEl, this.elements.M, this.tmp3).applyMatrix3(this.frame);
      this.setOrientBasis(n, mean.negate());
      this.spin.rotation.y = 0;
    } else {
      const ref = Math.abs(n.y) < 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
      this.setOrientBasis(n, ref);
      this.spin.rotation.y = MathUtils.degToRad(((360 * d * 24) / rot.periodHours) % 360);
    }
  }

  /**
   * Moons (and their orbits) only matter near their planet: fade them out as
   * the camera pulls back, so the overview is not a tangle of tiny rings.
   */
  override updateView(ctx: FrameContext, sunRender: Vector3, fadeNear: number): void {
    const parentPos = this.parent.getRenderPosition(this.tmp);
    const camDist = parentPos.distanceTo(ctx.cameraPosition);
    const reach = scale.satelliteDistance(this.elements.a || 1, this.parent.radiusKm);
    const x = camDist / Math.max(reach, 1e-6);
    this.relevance = 1 - MathUtils.smoothstep(x, M.fadeStartOrbits, M.fadeEndOrbits);
    super.updateView(ctx, sunRender, fadeNear);
    if (this.orbit) {
      this.orbit.line.visible = this.relevance > 0.01 && this.orbitsEnabled;
      this.orbit.opacity = M.orbitOpacity * this.relevance;
    }
  }

  orbitsEnabled = true;

  /** Visible enough to be picked / labelled. */
  get isRelevant(): boolean {
    return this.relevance > 0.05;
  }

  get relevanceWeight(): number {
    return this.relevance;
  }

  protected override markerWeight(_ctx: FrameContext): number {
    return this.relevance;
  }
}
