import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LOD,
  MathUtils,
  Matrix4,
  Mesh,
  NoColorSpace,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import planetVert from '../shaders/planet/planet.vert?raw';
import rockyFrag from '../shaders/planet/rocky.frag?raw';
import gasFrag from '../shaders/planet/gas.frag?raw';
import moonFrag from '../shaders/planet/moon.frag?raw';
import markerVert from '../shaders/orbit/marker.vert?raw';
import markerFrag from '../shaders/orbit/marker.frag?raw';
import { KM_PER_AU } from '../config/astro';
import { PLANETS } from '../config/visual';
import { sunUniforms } from '../core/lighting';
import { scale } from '../core/scale';
import type { FloatingOrigin } from '../core/FloatingOrigin';
import type { Loader, TextureOptions } from '../core/Loader';
import type { FlareOccluder } from '../core/PostFX';
import type { Focusable, FrameContext, Updatable } from '../core/types';
import { equatorialToScene } from '../physics/frames';
import { fbm3 } from '../utils/noise';
import { HighResSwap } from './HighResSwap';
import { Atmosphere } from './Atmosphere';
import type { OrbitLine } from './OrbitLine';
import { Rings } from './Rings';
import type { IauRotation, PlanetRender, ProceduralStyle, Triplet } from './planetTypes';

const G = PLANETS.geometry;
const DEG = Math.PI / 180;
const DAYS_PER_CENTURY = 36525;
/** Solar radius (km), for the real angular size of the Sun in eclipse shadows. */
const SUN_RADIUS_KM = 695_700;
const MAX_OCCLUDERS = 4;

let geoNear: SphereGeometry | null = null;
let geoFar: SphereGeometry | null = null;
/** Unit spheres shared by every body (two LOD levels). */
export function sphereGeometries(): { near: SphereGeometry; far: SphereGeometry } {
  geoNear ??= new SphereGeometry(1, G.near[0], G.near[1]);
  geoFar ??= new SphereGeometry(1, G.far[0], G.far[1]);
  return { near: geoNear, far: geoFar };
}

const ICRF_Z = equatorialToScene(0, 90);
const ICRF_X = equatorialToScene(0, 0);
// Body maps wrap in longitude: flow and cloud drift shift u past 1.
const SRGB_OPTS: TextureOptions = { wrapRepeatS: true };
const LINEAR_OPTS: TextureOptions = { colorSpace: NoColorSpace, wrapRepeatS: true };

const STYLE_IDS: Record<ProceduralStyle, number> = {
  cratered: 0,
  io: 1,
  europa: 2,
  ganymede: 3,
  titan: 4,
  enceladus: 5,
  iapetus: 6,
  triton: 7,
  miranda: 8,
  pluto: 9,
};

/** Everything a body needs from its JSON entry, whatever its kind. */
export interface BodyDescriptor {
  id: string;
  name: string;
  type: string;
  radiusKm: { equatorial: number; polar: number };
  triaxialKm?: Triplet;
  render: PlanetRender;
}

export interface Uniform<T> {
  value: T;
}

/**
 * Lumpy small body: the unit sphere displaced by fbm. Normals come from the
 * displacement function itself (not from triangles), so duplicated seam
 * vertices get identical normals and no seam shows.
 */
function irregularGeometry(amplitude: number, seed: number): SphereGeometry {
  const geo = new SphereGeometry(1, G.far[0], G.far[1]);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const nrm = geo.getAttribute('normal') as BufferAttribute;
  const radiusAt = (d: Vector3) => 1 + amplitude * fbm3(d.x * 1.8, d.y * 1.8, d.z * 1.8, 5, seed);
  const d = new Vector3();
  const t1 = new Vector3();
  const t2 = new Vector3();
  const p0 = new Vector3();
  const p1 = new Vector3();
  const p2 = new Vector3();
  const eps = 0.01;
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    t1.set(d.z, 0, -d.x);
    if (t1.lengthSq() < 1e-8) t1.set(1, 0, 0);
    t1.normalize();
    t2.crossVectors(d, t1);
    p0.copy(d).multiplyScalar(radiusAt(d));
    p1.copy(d).addScaledVector(t1, eps).normalize();
    p1.multiplyScalar(radiusAt(p1));
    p2.copy(d).addScaledVector(t2, eps).normalize();
    p2.multiplyScalar(radiusAt(p2));
    const n = p1.sub(p0).cross(p2.sub(p0)).normalize();
    if (n.dot(d) < 0) n.negate();
    pos.setXYZ(i, p0.x, p0.y, p0.z);
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  return geo;
}

/**
 * Shared machinery for every rendered body — planets, dwarf planets, moons.
 *
 * Hierarchy (root is scaled by the equatorial radius; everything inside is
 * in units of that radius):
 *   root ─┬─ orient   (+Y = north pole, +X = equator node / reference)
 *         │   ├─ spin (rotation about the pole)
 *         │   │   └─ body (flattening / tri-axial shape) → surface LOD
 *         │   ├─ atmoBody (same shape, non-spinning) → atmosphere
 *         │   └─ rings
 *         └─ marker (point of light while the disk is sub-pixel)
 *
 * Subclasses decide where the body is (heliocentric or around a parent) and
 * how it is oriented.
 */
const TIDE_AXIS = new Vector3(1, 0, 0);

export abstract class CelestialBody implements Updatable, Focusable, FlareOccluder {
  readonly id: string;
  readonly name: string;
  readonly root = new Group();
  readonly orient = new Group();
  /** Tidal stretch (playground): R·S·R⁻¹ along the pulling body, wrapping everything drawn. */
  private readonly tide = new Group();
  private readonly untide = new Group();
  readonly spin = new Group();
  readonly body = new Group();
  readonly atmoBody = new Group();
  readonly lod = new LOD();
  readonly surfaceMaterial: ShaderMaterial;
  readonly atmosphere: Atmosphere | null = null;
  readonly rings: Rings | null = null;
  readonly marker: Points<BufferGeometry, ShaderMaterial>;
  orbit: OrbitLine | null = null;
  /** Bodies whose shadows can fall on this one (moons on planets, the planet on its moons). */
  shadowCasters: CelestialBody[] = [];
  readonly satellites: CelestialBody[] = [];

  protected radius = 1;
  protected readonly flattening: number;
  protected readonly absolutePosition = new Vector3();
  /** Real heliocentric distance (km), for the Sun's angular size in shadows. */
  protected sunDistanceKm = KM_PER_AU;
  protected readonly tmp = new Vector3();
  protected readonly tmp2 = new Vector3();
  protected readonly tmp3 = new Vector3();
  private readonly basis = new Matrix4();
  private readonly basisX = new Vector3();
  private readonly basisY = new Vector3();
  private readonly basisZ = new Vector3();
  private flowDays = 0;
  private readonly occluderCandidates: { d: number; body: CelestialBody }[] = [];

  constructor(
    readonly desc: BodyDescriptor,
    world: Group,
    protected readonly origin: FloatingOrigin,
    protected readonly loader: Loader,
  ) {
    this.id = desc.id;
    this.name = desc.name;
    this.flattening = desc.radiusKm.polar / desc.radiusKm.equatorial;

    this.root.name = desc.id;
    world.add(this.root);
    this.root.add(this.tide);
    this.tide.add(this.untide);
    this.untide.add(this.orient);
    this.orient.add(this.spin, this.atmoBody);
    this.spin.add(this.body);
    const shape = this.shapeScale();
    this.body.scale.copy(shape);
    this.atmoBody.scale.copy(shape);

    // ---- Surface -------------------------------------------------------------
    this.surfaceMaterial = this.createSurfaceMaterial();
    const r = desc.render;
    if (r.irregularity && r.irregularity > 0) {
      const geo = irregularGeometry(r.irregularity, r.seed ?? 1);
      this.lod.addLevel(new Mesh(geo, this.surfaceMaterial), 0);
    } else {
      const { near, far } = sphereGeometries();
      this.lod.addLevel(new Mesh(near, this.surfaceMaterial), 0);
      this.lod.addLevel(new Mesh(far, this.surfaceMaterial), G.lodNearRadii);
    }
    this.lod.children.forEach((m) => (m.name = `${desc.id}-surface`));
    this.body.add(this.lod);

    // ---- Atmosphere & rings -------------------------------------------------------
    if (r.atmosphere) {
      this.atmosphere = new Atmosphere(r.atmosphere, desc.radiusKm.equatorial);
      this.atmosphere.attachTo(this.atmoBody);
    }
    if (r.rings) {
      this.rings = new Rings(r.rings, desc.radiusKm.equatorial, this.flattening, loader);
      this.orient.add(this.rings.mesh);
      this.bindRingShadow();
    }

    this.marker = this.createMarker();
    this.root.add(this.marker);

    this.applyScale();
    scale.onChange(() => this.applyScale());
  }

  /** Body group scale: polar flattening, or tri-axial (X long, Y polar, Z). */
  private shapeScale(): Vector3 {
    const t = this.desc.triaxialKm;
    if (t) return new Vector3(1, t[2] / t[0], t[1] / t[0]);
    return new Vector3(1, this.flattening, 1);
  }

  // ---- Materials --------------------------------------------------------------------

  protected loadTexture(path: string, linear = false): Uniform<Texture | null> {
    const uniform: Uniform<Texture | null> = { value: null };
    this.loader
      .load(path, linear ? LINEAR_OPTS : SRGB_OPTS)
      .then((t) => (uniform.value = t))
      .catch(() => undefined);
    return uniform;
  }

  /** Per-material uniforms every body shader expects (shared sun + own eclipse set). */
  protected baseUniforms(): Record<string, Uniform<unknown>> {
    return {
      ...sunUniforms,
      uShellScale: { value: 1 },
      uSunDirObj: { value: new Vector3(1, 0, 0) },
      uOccluders: { value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4()) },
      uOccluderCount: { value: 0 },
      uSunAngRadius: { value: 0.00465 },
      uHeat: { value: 0 },
    };
  }

  protected createSurfaceMaterial(): ShaderMaterial {
    const r = this.desc.render;
    const common = {
      ...this.baseUniforms(),
      uTint: { value: new Color(...(r.tint ?? [1, 1, 1])) },
    };
    if (r.shader === 'gas') {
      const f = r.flow ?? { amplitudes: [0, 0, 0, 0], frequencies: [0, 0, 0, 0], phases: [0, 0, 0, 0], turbulence: 0 };
      const calm = r.flowCalm;
      return new ShaderMaterial({
        vertexShader: planetVert,
        fragmentShader: gasFrag,
        uniforms: {
          ...common,
          uMap: this.loadTexture(r.textures!.map),
          uTime: { value: 0 },
          uFlowAmp: { value: new Vector4(...f.amplitudes) },
          uFlowFreq: { value: new Vector4(...f.frequencies) },
          uFlowPhase: { value: new Vector4(...f.phases) },
          uFlowCalm: { value: new Vector2(calm ? calm.latitudeDeg * DEG : 0, calm ? calm.widthDeg * DEG : 0) },
          uFlowDays: { value: new Vector2() },
          uFlowMix: { value: 0.5 },
          uTurbulence: { value: f.turbulence },
          uLimbDark: { value: r.limbDarkening ?? 0.4 },
          uBands: { value: r.bands ?? 0 },
          uStorms: { value: r.storms ?? 0 },
          uRingMap: { value: null },
          uRingInner: { value: 0 },
          uRingOuter: { value: 1 },
          uRingOpacity: { value: 0 },
        },
      });
    }
    if (r.shader === 'procedural') {
      const feature = (f: PlanetRender['spot']) =>
        f ? new Vector4(f.latDeg * DEG, f.lonDeg * DEG, f.radiusDeg * DEG, f.strength) : new Vector4(0, 0, 0, 0);
      return new ShaderMaterial({
        vertexShader: planetVert,
        fragmentShader: moonFrag,
        uniforms: {
          ...common,
          uStyle: { value: STYLE_IDS[r.style ?? 'cratered'] },
          uColorA: { value: new Color(...(r.colorA ?? [0.4, 0.4, 0.4])) },
          uColorB: { value: new Color(...(r.colorB ?? r.colorA ?? [0.45, 0.45, 0.45])) },
          uColorC: { value: new Color(...(r.colorC ?? [0.2, 0.2, 0.2])) },
          uRegionScale: { value: r.regionScale ?? 2.0 },
          uRegionContrast: { value: r.regionContrast ?? 0.3 },
          uCraterDensity: { value: r.craterDensity ?? 0.5 },
          uCraterScale: { value: r.craterScale ?? 3.0 },
          uRelief: { value: r.relief ?? 1.0 },
          uRimBrightness: { value: r.rimBrightness ?? 0.3 },
          uLineae: { value: r.lineae ?? 0 },
          uSpot: { value: feature(r.spot) },
          uBigCrater: { value: feature(r.bigCrater) },
          uSeed: { value: r.seed ?? 1 },
          uLommel: { value: r.lommel ?? 0.6 },
        },
      });
    }
    // Textured rocky body.
    return new ShaderMaterial({
      vertexShader: planetVert,
      fragmentShader: rockyFrag,
      uniforms: {
        ...common,
        uMap: this.loadTexture(r.textures!.map),
        uBumpStrength: { value: r.bumpStrength ?? 1 },
        uLommel: { value: r.lommel ?? 0 },
      },
    });
  }

  /** Saturn: the surface shader samples the ring profile for ring shadows. */
  private bindRingShadow(): void {
    const rings = this.rings;
    const u = this.surfaceMaterial.uniforms;
    if (!rings || !u.uRingMap) return;
    this.surfaceMaterial.defines = { ...this.surfaceMaterial.defines, RING_SHADOW: '' };
    u.uRingInner.value = rings.inner;
    u.uRingOuter.value = rings.outer;
    u.uRingOpacity.value = rings.opacity;
    // Share the very same uniform object: the texture may arrive later.
    u.uRingMap = rings.mesh.material.uniforms.uRingMap;
  }

  private createMarker(): Points<BufferGeometry, ShaderMaterial> {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const m = PLANETS.marker;
    const material = new ShaderMaterial({
      vertexShader: markerVert,
      fragmentShader: markerFrag,
      uniforms: {
        uColor: { value: new Color(...this.desc.render.markerColor).multiplyScalar(m.intensity) },
        uVisibility: { value: 1 },
        uSize: { value: this.markerSize() },
        uPixelRatio: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const p = new Points(geo, material);
    p.name = `${this.desc.id}-marker`;
    p.frustumCulled = false;
    p.renderOrder = 40;
    return p;
  }

  /** Marker size in CSS px; moons use smaller dots than planets. */
  protected markerSize(): number {
    return PLANETS.marker.sizePx;
  }

  // ---- Scale -----------------------------------------------------------------------

  protected applyScale(): void {
    this.radius = scale.radius(this.desc.radiusKm.equatorial);
    this.root.scale.setScalar(this.radius);
    const far = this.lod.levels[1];
    if (far) far.distance = this.radius * G.lodNearRadii;
  }

  // ---- Focusable / occluder -------------------------------------------------------------

  getAbsolutePosition(out: Vector3): Vector3 {
    return out.copy(this.absolutePosition);
  }

  getRenderPosition(out: Vector3): Vector3 {
    return this.origin.toRender(this.absolutePosition, out);
  }

  getRadius(): number {
    return this.radius;
  }

  /** Real distance from the Sun (km). */
  get heliocentricDistanceKm(): number {
    return this.sunDistanceKm;
  }

  /** Physical equatorial radius (km). */
  /**
   * Stretch the body along `dir` (scene frame) by `s` ≥ 1, squeezing it
   * across so the volume stays (a tidally distorted, Roche-ellipsoid-like
   * shape). s = 1 or no direction: round again.
   */
  setTide(dir: Vector3 | null, s: number): void {
    if (!dir || s <= 1.0005) {
      this.tide.quaternion.identity();
      this.tide.scale.set(1, 1, 1);
      this.untide.quaternion.identity();
      return;
    }
    this.tide.quaternion.setFromUnitVectors(TIDE_AXIS, dir);
    const k = 1 / Math.sqrt(s);
    this.tide.scale.set(s, k, k);
    this.untide.quaternion.copy(this.tide.quaternion).invert();
  }

  get radiusKm(): number {
    return this.desc.radiusKm.equatorial;
  }

  /** Current mean-anomaly phase (0..1), for the orbit trail. */
  abstract get orbitPhase(): number;

  // ---- Simulation ---------------------------------------------------------------------

  /** Sets absolutePosition (scene units) and sunDistanceKm. */
  protected abstract updatePosition(daysSinceJ2000: number): void;

  /** Sets orient/spin. */
  protected abstract updateOrientation(daysSinceJ2000: number): void;

  /**
   * Playground: heliocentric ecliptic position (AU) from the N-body
   * simulation, used instead of the orbit model while set.
   */
  simPositionAu: Vector3 | null = null;
  /** Playground: destroyed (collided, swallowed, torn apart). */
  get simGone(): boolean {
    return !this.root.visible;
  }
  set simGone(v: boolean) {
    this.root.visible = !v;
  }

  update(ctx: FrameContext): void {
    const d = ctx.time.daysSinceJ2000;
    this.updatePosition(d);
    this.root.position.copy(this.absolutePosition);
    this.updateOrientation(d);
    this.updateMaterials(ctx);
  }

  /** IAU pole + prime meridian → orient (pole/node) and spin (W). */
  protected applyIauRotation(rot: IauRotation, d: number, wOverrideDeg?: number): void {
    const T = d / DAYS_PER_CENTURY;
    const pole = equatorialToScene(
      rot.poleRaDeg[0] + rot.poleRaDeg[1] * T,
      rot.poleDecDeg[0] + rot.poleDecDeg[1] * T,
      this.tmp2,
    );
    // Ascending node of the body's equator on the ICRF equator: Q = Z_icrf × pole.
    const node = this.tmp.crossVectors(ICRF_Z, pole);
    if (node.lengthSq() < 1e-12) node.copy(ICRF_X);
    node.normalize();
    this.setOrientBasis(pole, node);
    const W = wOverrideDeg ?? (rot.w0Deg + rot.wDotDegPerDay * d) % 360;
    this.spin.rotation.y = MathUtils.degToRad(W);
  }

  /** orient: +Y = pole, +X = `reference` (projected onto the equator). */
  protected setOrientBasis(pole: Vector3, reference: Vector3): void {
    // Own scratch vectors: callers often pass tmp/tmp2/tmp3 in.
    const y = this.basisY.copy(pole).normalize();
    const x = this.basisX.copy(reference).addScaledVector(y, -reference.dot(y)).normalize();
    const z = this.basisZ.crossVectors(x, y);
    this.basis.makeBasis(x, y, z);
    this.orient.quaternion.setFromRotationMatrix(this.basis);
  }

  protected updateMaterials(ctx: FrameContext): void {
    const u = this.surfaceMaterial.uniforms;
    if (this.desc.render.shader === 'gas') {
      const f = PLANETS.flow;
      const cap = f.maxDaysPerSecond * ctx.time.delta;
      this.flowDays += MathUtils.clamp(ctx.time.simDelta, -cap, cap);
      const P = f.periodDays;
      const frac = MathUtils.euclideanModulo(this.flowDays / P, 1);
      (u.uFlowDays.value as Vector2).set(frac * P, MathUtils.euclideanModulo(frac + 0.5, 1) * P);
      u.uFlowMix.value = 1 - Math.abs(2 * frac - 1);
      u.uTime.value = ctx.time.elapsed;
    }
  }

  /**
   * View-dependent state, after the camera has moved this frame: sun and
   * camera vectors in each component's local space, eclipses, marker fade,
   * orbit trail.
   */
  updateView(ctx: FrameContext, sunRender: Vector3, fadeNear: number): void {
    this.root.updateWorldMatrix(true, true);
    const u = this.surfaceMaterial.uniforms;

    // Sun direction in the body's (shape → spherical) object space.
    const local = this.body.worldToLocal(this.tmp.copy(sunRender));
    (u.uSunDirObj.value as Vector3).copy(local).normalize();

    this.atmosphere?.updateView(ctx.cameraPosition, sunRender);
    this.rings?.updateView(ctx.cameraPosition, sunRender);
    this.updateEclipses(sunRender);

    // Marker: visible while the disk is only a pixel or two across.
    const pos = this.getRenderPosition(this.tmp);
    const dist = pos.distanceTo(ctx.cameraPosition);
    const cssHeight = ctx.viewportHeight / ctx.pixelRatio;
    const radiusPx = (this.radius / Math.max(dist, 1e-9) / Math.tan((ctx.camera.fov * DEG) / 2)) * (cssHeight / 2);
    const m = PLANETS.marker;
    const mu = this.marker.material.uniforms;
    mu.uVisibility.value = (1 - MathUtils.smoothstep(radiusPx, m.fadeFromPx, m.fadeToPx)) * this.markerWeight(ctx);
    mu.uPixelRatio.value = ctx.pixelRatio;
    this.marker.visible = mu.uVisibility.value > 0.001;

    this.orbit?.update(ctx.time.daysSinceJ2000, this.orbitPhase, fadeNear);
    this.maybeLoadHighResMap(dist);
  }

  private highRes: HighResSwap | null | undefined;

  /** Textured bodies (rocky or gas): stream the high-resolution map close up, release it when far. */
  private maybeLoadHighResMap(cameraDistance: number): void {
    if (this.highRes === undefined) {
      const r = this.desc.render;
      const path = r.texturesHigh?.map;
      this.highRes =
        (r.shader === 'rocky' || r.shader === 'gas') && path
          ? new HighResSwap(
              this.loader,
              [{ uniform: this.surfaceMaterial.uniforms.uMap as Uniform<Texture | null>, path, opts: SRGB_OPTS }],
              r.highResWithinRadii ?? 30,
            )
          : null;
    }
    this.highRes?.update(cameraDistance / this.radius);
  }

  /** 0..1 multiplier on the marker (moons hide theirs when far from the camera). */
  protected markerWeight(_ctx: FrameContext): number {
    return 1;
  }

  /** Pick up to four casters nearest the Sun line and feed the eclipse uniforms. */
  private updateEclipses(sunRender: Vector3): void {
    const u = this.surfaceMaterial.uniforms;
    u.uSunAngRadius.value = SUN_RADIUS_KM / Math.max(this.sunDistanceKm, 1);
    if (this.shadowCasters.length === 0) return;
    const me = this.getRenderPosition(this.tmp);
    const toSun = this.tmp2.copy(sunRender).sub(me).normalize();
    const cands = this.occluderCandidates;
    cands.length = 0;
    for (const c of this.shadowCasters) {
      const p = c.getRenderPosition(this.tmp3).sub(me);
      const along = p.dot(toSun);
      if (along <= 0) continue; // caster is on the night side
      const perp = p.addScaledVector(toSun, -along).length();
      if (perp > (this.radius + c.getRadius()) * 1.5) continue;
      cands.push({ d: perp, body: c });
    }
    cands.sort((a, b) => a.d - b.d);
    const occ = u.uOccluders.value as Vector4[];
    const n = Math.min(cands.length, MAX_OCCLUDERS);
    const myKm = this.desc.radiusKm.equatorial;
    for (let i = 0; i < n; i++) {
      const c = cands[i].body;
      c.getRenderPosition(this.tmp3);
      // Cinematic scale shrinks big bodies more than small ones, so a moon is
      // drawn several times too large next to its planet, and so would its
      // shadow be (a black blot instead of a dot). A smaller caster's shadow
      // therefore keeps its true size relative to the receiver. Identical in
      // real scale; planet-sized casters keep their drawn size.
      const casterKm = c.desc.radiusKm.equatorial;
      const r = casterKm < myKm ? this.radius * (casterKm / myKm) : c.getRadius();
      occ[i].set(this.tmp3.x, this.tmp3.y, this.tmp3.z, r);
    }
    u.uOccluderCount.value = n;
  }

  dispose(): void {
    this.surfaceMaterial.dispose();
    this.atmosphere?.dispose();
    this.rings?.dispose();
    this.orbit?.dispose();
    this.highRes?.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
  }
}
