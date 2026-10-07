import {
  AdditiveBlending,
  Color,
  Group,
  MathUtils,
  Mesh,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import sunData from '../data/sun.json';
import surfaceVert from '../shaders/sun/surface.vert?raw';
import surfaceFrag from '../shaders/sun/surface.frag?raw';
import coronaVert from '../shaders/sun/corona.vert?raw';
import coronaFrag from '../shaders/sun/corona.frag?raw';
import { SUN_VISUAL } from '../config/visual';
import { scale } from '../core/scale';
import type { FloatingOrigin } from '../core/FloatingOrigin';
import type { FlareSource } from '../core/PostFX';
import type { Focusable, FrameContext, Updatable } from '../core/types';
import { equatorialToScene } from '../physics/frames';
import { Random } from '../utils/random';
import { Prominences } from './Prominences';

const V = SUN_VISUAL;
const Y_AXIS = new Vector3(0, 1, 0);
const FL = V.flares;
/** Attempts at finding a flare site on the visible hemisphere before giving up this time. */
const FLARE_SITE_TRIES = 12;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Flare {
  dir: Vector3;
  age: number;
}

/**
 * The Sun (PLAN §5.1): procedural photosphere, corona + chromosphere
 * billboard, prominence loops, and the scene's only light source.
 *
 * Hierarchy (root is scaled by the solar radius; geometry is unit-sized):
 *   root ─┬─ orient (IAU pole direction)
 *         │    └─ spin (prime-meridian rotation, sim time)
 *         │         ├─ surface
 *         │         └─ prominences
 *         ├─ corona  (camera-facing, built in its shader)
 *         └─ light   (PointLight, decay 0)
 */
export class Sun implements Updatable, Focusable, FlareSource {
  readonly root = new Group();
  readonly orient = new Group();
  readonly spin = new Group();
  readonly surface: Mesh<SphereGeometry, ShaderMaterial>;
  readonly corona: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly prominences = new Prominences();
  readonly light: PointLight;

  /** Absolute heliocentric position: the origin, by definition. */
  private readonly absolutePosition = new Vector3(0, 0, 0);
  private radius = 1;
  private readonly poleWorld = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly rng = new Random(0xf1a2e);
  private readonly flares: Flare[] = [];
  private nextFlareIn = 4;

  constructor(
    world: Group,
    private readonly origin: FloatingOrigin,
  ) {
    this.root.name = 'sun';
    world.add(this.root);
    this.root.add(this.orient);
    this.orient.add(this.spin);

    // Orientation: object +Y → IAU north pole direction in scene space.
    const o = sunData.orientation;
    equatorialToScene(o.poleRaDeg, o.poleDecDeg, this.poleWorld);
    this.orient.quaternion.setFromUnitVectors(Y_AXIS, this.poleWorld);

    // ---- Photosphere -------------------------------------------------------
    const dr = sunData.differentialRotationDegPerDay;
    const band = sunData.activeLatitudeBandDeg;
    const surfaceMat = new ShaderMaterial({
      vertexShader: surfaceVert,
      fragmentShader: surfaceFrag,
      uniforms: {
        uTime: { value: 0 },
        uBrightness: { value: V.brightness },
        uColorCore: { value: new Color(...V.colorCore) },
        uColorHot: { value: new Color(...V.colorHot) },
        uColorCool: { value: new Color(...V.colorCool) },
        uLimbExp: { value: new Vector3(...V.limbExponents) },
        uGranScale: { value: V.granule.scale },
        uGranSpeed: { value: V.granule.speed },
        uGranContrast: { value: V.granule.contrast },
        uGranFine: { value: V.granule.fineWeight },
        uGranWarp: { value: V.granule.warp },
        uSuperScale: { value: V.supergranule.scale },
        uSuperStrength: { value: V.supergranule.strength },
        uSpotScale: { value: V.spots.scale },
        uSpotThreshold: { value: V.spots.threshold },
        uSpotPenumbra: { value: V.spots.penumbraWidth },
        uUmbraDark: { value: V.spots.umbraDarkness },
        uPenumbraDark: { value: V.spots.penumbraDarkness },
        uSpotTime: { value: new Vector2() },
        uSpotDays: { value: new Vector2() },
        uSpotMix: { value: 0.5 },
        uDiffRot: { value: new Vector3(dr.A, dr.B, dr.C) },
        uActiveBand: {
          value: new Vector2(MathUtils.degToRad(band[0]), MathUtils.degToRad(band[1])),
        },
        uFaculae: { value: V.faculae.strength },
        uPlageDisc: { value: V.faculae.discStrength },
        uPlasmaScale: { value: V.plasma.scale },
        uPlasmaSpeed: { value: V.plasma.speed },
        uPlasmaStrength: { value: V.plasma.strength },
        uFlares: { value: Array.from({ length: FL.maxActive }, () => new Vector4()) },
        uFlareSize: { value: FL.size },
        uFlareIntensity: { value: FL.intensity },
        uFlareColor: { value: new Color(...FL.color) },
      },
    });
    this.surface = new Mesh(new SphereGeometry(1, V.widthSegments, V.heightSegments), surfaceMat);
    this.surface.name = 'sun-surface';
    this.spin.add(this.surface);

    this.spin.add(this.prominences.group);

    // ---- Corona ------------------------------------------------------------
    const c = V.corona;
    const coronaMat = new ShaderMaterial({
      vertexShader: coronaVert,
      fragmentShader: coronaFrag,
      uniforms: {
        uTime: { value: 0 },
        uAxis: { value: this.poleWorld.clone() },
        uExtent: { value: c.extent },
        uLimbRadius: { value: 1 },
        uIntensity: { value: c.intensity },
        uFalloff: { value: c.falloff },
        uStreamerStrength: { value: c.streamerStrength },
        uStreamerSharpness: { value: c.streamerSharpness },
        uFlowSpeed: { value: c.flowSpeed },
        uColor: { value: new Color(...c.color) },
        uInnerColor: { value: new Color(...c.innerColor) },
        uChromoColor: { value: new Color(...c.chromosphereColor) },
        uChromoIntensity: { value: c.chromosphereIntensity },
        uSwirl: { value: 0 },
        uBreath: { value: 1 },
        uLoopStrength: { value: c.loopStrength },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.corona = new Mesh(new PlaneGeometry(2, 2), coronaMat);
    this.corona.name = 'sun-corona';
    this.corona.frustumCulled = false; // real extent is set in the shader
    this.corona.renderOrder = 10;
    this.root.add(this.corona);

    // ---- Light -------------------------------------------------------------
    // decay = 0: cinematic distances are compressed, so inverse-square
    // falloff would make the outer planets unreadably dark.
    this.light = new PointLight(V.light.color, V.light.intensity, 0, 0);
    this.light.name = 'sun-light';
    this.root.add(this.light);

    this.applyScale();
    scale.onChange(() => this.applyScale());
  }

  private applyScale(): void {
    this.radius = scale.radius(sunData.radiusKm);
    this.root.scale.setScalar(this.radius);
  }

  // ---- Focusable / FlareSource ---------------------------------------------
  getAbsolutePosition(out: Vector3): Vector3 {
    return out.copy(this.absolutePosition);
  }

  getRenderPosition(out: Vector3): Vector3 {
    return this.origin.toRender(this.absolutePosition, out);
  }

  getRadius(): number {
    return this.radius;
  }

  /** Scene-space direction of the Sun's north rotation pole. */
  getPole(out: Vector3): Vector3 {
    return out.copy(this.poleWorld);
  }

  // ---- Per frame ---------------------------------------------------------------
  update(ctx: FrameContext): void {
    const { time } = ctx;
    const d = time.daysSinceJ2000;
    this.root.position.copy(this.absolutePosition);

    // IAU prime meridian (rigid, equatorial rate). Wrapped in double precision.
    const o = sunData.orientation;
    const w = (o.w0Deg + o.wDotDegPerDay * d) % 360;
    this.spin.rotation.y = MathUtils.degToRad(w);

    // Sunspot evolution: two time samples crossfaded so the wrap never pops.
    const s = V.spots;
    const period = s.wrapPeriodDays;
    const f = (((d / period) % 1) + 1) % 1;
    const daysA = f * period;
    const daysB = ((f + 0.5) % 1) * period;
    const su = this.surface.material.uniforms;
    su.uTime.value = time.elapsed;
    (su.uSpotDays.value as Vector2).set(daysA, daysB);
    (su.uSpotTime.value as Vector2).set(daysA * s.evolutionPerDay, daysB * s.evolutionPerDay + 17.0);
    su.uSpotMix.value = 1 - Math.abs(2 * f - 1);

    const cu = this.corona.material.uniforms;
    const c = V.corona;
    cu.uTime.value = time.elapsed;
    cu.uSwirl.value = (time.elapsed * c.swirlSpeed) % (Math.PI * 2);
    cu.uBreath.value = 1 + c.breathAmp * Math.sin((time.elapsed * Math.PI * 2) / c.breathPeriodS);
    this.prominences.update(time.delta, time.elapsed);
    this.updateFlares(time.delta);
  }

  /**
   * Flare scheduler: every so often an active-latitude site on the side
   * facing the camera brightens (ease-out rise) and decays exponentially.
   * Real seconds, so flares stay watchable at any simulation speed.
   */
  private updateFlares(dt: number): void {
    const slots = this.surface.material.uniforms.uFlares.value as Vector4[];
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.age += dt;
      if (f.age > FL.riseS + FL.decayS * 4) this.flares.splice(i, 1);
    }
    this.nextFlareIn -= dt;
    if (this.nextFlareIn <= 0 && !reducedMotion()) {
      this.nextFlareIn = this.rng.range(FL.intervalMin, FL.intervalMax);
      if (this.flares.length < FL.maxActive) {
        const dir = this.pickFlareSite();
        if (dir) this.flares.push({ dir, age: 0 });
      }
    }
    for (let i = 0; i < slots.length; i++) {
      const f = this.flares[i];
      if (!f) {
        slots[i].w = 0;
        continue;
      }
      const rise = Math.min(1, f.age / FL.riseS);
      const env =
        f.age < FL.riseS ? 1 - Math.pow(1 - rise, 3) : Math.exp(-(f.age - FL.riseS) / FL.decayS);
      slots[i].set(f.dir.x, f.dir.y, f.dir.z, env);
    }
  }

  /** A point in the active latitude band, on the hemisphere facing the camera (rotating frame). */
  private pickFlareSite(): Vector3 | null {
    const band = sunData.activeLatitudeBandDeg;
    const view = this.prominences.localViewDir;
    for (let i = 0; i < FLARE_SITE_TRIES; i++) {
      const lat = MathUtils.degToRad(this.rng.range(band[0], band[1])) * (this.rng.next() < 0.5 ? -1 : 1);
      const lon = this.rng.range(0, Math.PI * 2);
      const v = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      if (v.dot(view) > FL.minFacing) return v;
    }
    return null;
  }

  /**
   * View-dependent state. Registered as a late update so it uses this
   * frame's final camera (after controls and origin rebasing); otherwise the
   * corona limb would lag one frame behind the sphere while zooming.
   */
  readonly viewUpdater = {
    update: (ctx: FrameContext) => this.updateView(ctx),
  };

  private updateView(ctx: FrameContext): void {
    const center = this.getRenderPosition(this.tmp);
    this.root.updateMatrixWorld(true);

    // Corona: limb radius on the billboard plane. A sphere seen from distance
    // D has its silhouette at R / sqrt(1 - (R/D)^2) in the plane through its
    // centre, slightly larger than R when close.
    const dist = center.distanceTo(ctx.cameraPosition);
    const k = Math.min(this.radius / Math.max(dist, 1e-9), 0.999);
    this.corona.material.uniforms.uLimbRadius.value = this.radius / Math.sqrt(1 - k * k);

    // Prominences: Sun centre in view space (disk test) and the camera
    // direction in the spin frame (new loops favour the visible limb).
    this.prominences.sunCenterV.value.copy(center).applyMatrix4(ctx.camera.matrixWorldInverse);
    this.prominences.sunRadius.value = this.radius;
    this.spin.getWorldQuaternion(this.tmpQ).invert();
    this.prominences.localViewDir
      .copy(ctx.cameraPosition)
      .sub(center)
      .applyQuaternion(this.tmpQ)
      .normalize();
  }

  dispose(): void {
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.corona.geometry.dispose();
    this.corona.material.dispose();
    this.prominences.dispose();
  }
}
