import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  MathUtils,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import trailVert from '../shaders/galactic/trail.vert?raw';
import trailFrag from '../shaders/galactic/trail.frag?raw';
import dustVert from '../shaders/galactic/dust.vert?raw';
import dustFrag from '../shaders/galactic/dust.frag?raw';
import { KM_PER_AU, SECONDS_PER_DAY, SUN_GALACTIC_VELOCITY_KM_S } from '../config/astro';
import { GALACTIC, PLANETS, type RGB } from '../config/visual';
import { scale } from '../core/scale';
import type { Engine } from '../core/Engine';
import type { Focusable, FrameContext, Updatable } from '../core/types';
import { ECLIPTIC_TO_SCENE, GALACTIC_TO_SCENE } from '../physics/frames';
import { positionFromEccentricAnomaly, solveKepler, type OrbitalElements } from '../physics/orbits';
import { orbitFocusUniforms } from './OrbitLine';
import { Moon } from './Moon';
import type { Planet } from './Planet';
import { Random } from '../utils/random';

const G = GALACTIC;

/** The Sun's galactic velocity as a scene-space vector, km per day. */
const SUN_VELOCITY_KM_DAY = new Vector3(...SUN_GALACTIC_VELOCITY_KM_S)
  .applyMatrix3(GALACTIC_TO_SCENE)
  .multiplyScalar(SECONDS_PER_DAY);

/**
 * Heliocentric km (scene orientation) → scene units, through the same radial
 * mapping as the bodies, so a trail meets its planet exactly.
 */
function mapKm(p: Vector3): Vector3 {
  const km = p.length();
  return km > 0 ? p.multiplyScalar(scale.distance(km) / km) : p;
}

/** One body's path through the galactic frame. */
class Trail {
  readonly line: Line<BufferGeometry, ShaderMaterial>;
  private readonly samples: number;
  private el: OrbitalElements = {} as OrbitalElements;
  private readonly head = new Vector3();
  private readonly p = new Vector3();

  constructor(
    readonly body: Planet | null,
    color: RGB,
    periodDays: number,
  ) {
    this.samples = body
      ? MathUtils.clamp(Math.ceil((G.trailDays / periodDays) * G.samplesPerOrbit) + 16, G.minSamples, G.maxSamples)
      : 2;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.samples * 3), 3));
    const age = new Float32Array(this.samples);
    for (let i = 0; i < this.samples; i++) age[i] = i / (this.samples - 1);
    geo.setAttribute('aAge', new BufferAttribute(age, 1));
    this.line = new Line(
      geo,
      new ShaderMaterial({
        vertexShader: trailVert,
        fragmentShader: trailFrag,
        uniforms: {
          uColor: { value: new Color(...color) },
          uOpacity: { value: G.opacity as number },
          uFadeNear: { value: 10 },
          ...orbitFocusUniforms,
          uFocusFade: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.line.name = `galactic-trail-${body?.id ?? 'sun'}`;
    this.line.frustumCulled = false;
    this.line.renderOrder = 5;
  }

  /** Heliocentric position at day d, shifted back along the Sun's motion. */
  private sample(d: number, now: number, out: Vector3): Vector3 {
    if (this.body) {
      this.el = this.body.orbitModel.elements(d, this.el);
      positionFromEccentricAnomaly(this.el, solveKepler(this.el.M, this.el.e), out)
        .applyMatrix3(ECLIPTIC_TO_SCENE)
        .multiplyScalar(KM_PER_AU);
    } else out.set(0, 0, 0);
    return out.addScaledVector(SUN_VELOCITY_KM_DAY, d - now);
  }

  /**
   * Rebuild for the current instant. Vertices are stored relative to the
   * head (the body) and the line sits at the body, so float32 precision is
   * best where the camera usually is.
   */
  rebuild(now: number): void {
    const pos = this.line.geometry.getAttribute('position') as BufferAttribute;
    mapKm(this.sample(now, now, this.head));
    const step = G.trailDays / (this.samples - 1);
    for (let i = 0; i < this.samples; i++) {
      const p = mapKm(this.sample(now - i * step, now, this.p)).sub(this.head);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    this.line.position.copy(this.head);
  }

  set opacity(v: number) {
    this.line.material.uniforms.uOpacity.value = v;
  }

  set fadeNear(v: number) {
    this.line.material.uniforms.uFadeNear.value = v;
  }

  set focusFade(v: number) {
    this.line.material.uniforms.uFocusFade.value = v;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}

/** Two crossfading octaves of dust, fixed in the galactic frame. */
class Dust {
  intensity: number = G.dust.intensity;
  readonly layers: Points<BufferGeometry, ShaderMaterial>[] = [];
  /** Accumulated galactic drift of the dust relative to the Sun (scene units, double). */
  private readonly drift = new Vector3();
  private readonly camAbs = new Vector3();
  private readonly tmp = new Vector3();

  constructor() {
    const D = G.dust;
    for (let layer = 0; layer < 2; layer++) {
      const rnd = new Random(0xd057 + layer);
      const seed = new Float32Array(D.count * 3);
      const mag = new Float32Array(D.count);
      for (let i = 0; i < D.count; i++) {
        seed[i * 3] = rnd.next();
        seed[i * 3 + 1] = rnd.next();
        seed[i * 3 + 2] = rnd.next();
        mag[i] = 0.25 + 0.75 * Math.pow(rnd.next(), 2.5);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(seed, 3));
      geo.setAttribute('aMag', new BufferAttribute(mag, 1));
      const points = new Points(
        geo,
        new ShaderMaterial({
          vertexShader: dustVert,
          fragmentShader: dustFrag,
          uniforms: {
            uShift: { value: new Vector3() },
            uCam: { value: new Vector3() },
            uBox: { value: 1 },
            uAlpha: { value: 0 },
            uSizePx: { value: D.sizePx as number },
            uPixelRatio: { value: 1 },
            uColor: { value: new Color(...D.color) },
          },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      points.name = `galactic-dust-${layer}`;
      points.frustumCulled = false;
      points.renderOrder = 4;
      this.layers.push(points);
    }
  }

  update(ctx: FrameContext, engine: Engine): void {
    const cam = engine.camera.position;
    engine.origin.toAbsolute(cam, this.camAbs);

    // Drift speed in scene units: the local stretch of the distance mapping.
    const rKm = Math.max(scale.distanceToKm(this.camAbs.length()), 0.1 * KM_PER_AU);
    const unitsPerKm = (scale.distance(rKm * 1.001) - scale.distance(rKm)) / (rKm * 0.001);
    const step = this.tmp.copy(SUN_VELOCITY_KM_DAY).multiplyScalar(-ctx.time.simDelta * unitsPerKm);
    this.drift.add(step);

    const x = Math.log2(Math.max(engine.rig.distance * G.dust.boxPerDistance, 1e-9));
    const level = Math.floor(x);
    const f = x - level;
    for (let l = level; l <= level + 1; l++) {
      const box = Math.pow(2, l);
      const u = this.layers[((l % 2) + 2) % 2].material.uniforms;
      // Too fast to follow (high time rates): fade out instead of flickering.
      const speed = step.length() / box;
      const weight = l === level ? 1 - f : f;
      u.uAlpha.value = this.intensity * weight * (1 - MathUtils.smoothstep(speed, 0.004, 0.025));
      u.uBox.value = box;
      u.uCam.value.copy(cam);
      // (camera − drift) in box units, wrapped in double precision.
      const s = u.uShift.value as Vector3;
      s.set(
        MathUtils.euclideanModulo((this.camAbs.x - this.drift.x) / box, 1),
        MathUtils.euclideanModulo((this.camAbs.y - this.drift.y) / box, 1),
        MathUtils.euclideanModulo((this.camAbs.z - this.drift.z) / box, 1),
      );
      u.uPixelRatio.value = ctx.pixelRatio;
    }
  }

  set visible(v: boolean) {
    for (const p of this.layers) p.visible = v;
  }

  dispose(): void {
    for (const p of this.layers) {
      p.geometry.dispose();
      p.material.dispose();
    }
  }
}

/**
 * The Solar System is not standing still: the Sun moves through the Milky
 * Way at ≈ 248 km/s and the planets follow it. Drawn in the Sun's frame
 * (the camera rides along), that shows up as each planet's recent path
 * stretched into a helix behind the Sun, and as galactic-frame dust
 * streaming past. Heliocentric orbit ellipses are hidden meanwhile: they are
 * the view from a Sun that stands still.
 */
export class GalacticMotion implements Updatable {
  private readonly trails: Trail[] = [];
  private readonly dust = new Dust();
  private enabledFlag = false;
  private builtJd = Number.NaN;
  private builtBlend = Number.NaN;
  private readonly listeners = new Set<(on: boolean) => void>();

  constructor(
    private readonly engine: Engine,
    private readonly sun: Focusable,
    planets: readonly Planet[],
  ) {
    this.trails.push(new Trail(null, G.sunColor, 1));
    for (const p of planets) {
      const a = p.orbitModel.elements(0).a; // AU
      this.trails.push(new Trail(p, p.data.render.orbitColor as unknown as RGB, 365.25 * Math.pow(a, 1.5)));
    }
    for (const t of this.trails) engine.world.add(t.line);
    for (const d of this.dust.layers) engine.scene.add(d);
    this.apply();
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  set enabled(v: boolean) {
    if (v === this.enabledFlag) return;
    this.enabledFlag = v;
    this.builtJd = Number.NaN;
    this.apply();
    this.listeners.forEach((fn) => fn(v));
  }

  private trailOpacityValue: number = G.opacity;

  /** Live tuning (dev panel). */
  get trailOpacity(): number {
    return this.trailOpacityValue;
  }

  set trailOpacity(v: number) {
    this.trailOpacityValue = v;
    for (const t of this.trails) t.opacity = v;
  }

  get dustIntensity(): number {
    return this.dust.intensity;
  }

  set dustIntensity(v: number) {
    this.dust.intensity = v;
  }

  onChange(fn: (on: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private apply(): void {
    for (const t of this.trails) t.line.visible = this.enabledFlag;
    this.dust.visible = this.enabledFlag;
  }

  update(ctx: FrameContext): void {
    if (!this.enabledFlag) return;
    const now = ctx.time.daysSinceJ2000;
    if (now !== this.builtJd || scale.blend !== this.builtBlend) {
      for (const t of this.trails) t.rebuild(now);
      this.builtJd = now;
      this.builtBlend = scale.blend;
    }
    const rig = this.engine.rig;
    const focus = rig.focusTarget;
    // A moon's own trail is its planet's.
    const owner = focus instanceof Moon ? focus.parent : focus;
    for (const t of this.trails) {
      t.fadeNear = rig.focusRadius * PLANETS.orbit.fadeNearRadii;
      const own = !!owner && (t.body ? t.body === owner : owner === this.sun);
      t.focusFade = focus ? rig.focusRadius * (own ? PLANETS.orbit.focusFadeRadii : PLANETS.orbit.focusFadeOtherRadii) : 0;
    }
    this.dust.update(ctx, this.engine);
  }

  dispose(): void {
    for (const t of this.trails) t.dispose();
    this.dust.dispose();
  }
}
