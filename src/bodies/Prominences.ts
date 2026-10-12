import {
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  FrontSide,
  Group,
  Mesh,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from 'three';
import vertexShader from '../shaders/sun/prominence.vert?raw';
import fragmentShader from '../shaders/sun/prominence.frag?raw';
import { SUN_VISUAL } from '../config/visual';
import { Random } from '../utils/random';

const P = SUN_VISUAL.prominences;
const CURVE_SAMPLES = 14;
const TUBE_SEGMENTS = 96;
const TUBE_RADIAL = 10;
/** Fraction of life spent rising / fading out. */
const GROW_FRACTION = 0.3;
const FADE_OUT_FRACTION = 0.3;
/** Share of loops spawned near the visible limb (where they read best). */
const LIMB_BIAS = 0.7;
const MAX_LATITUDE_RAD = (60 * Math.PI) / 180;

interface Loop {
  mesh: Mesh<TubeGeometry, ShaderMaterial>;
  age: number;
  life: number;
  /** Ends by lifting off and ballooning outwards instead of fading in place. */
  erupts: boolean;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Plasma loops arching above the limb. Built in the Sun's rotating,
 * unit-radius frame (the parent group is scaled by the solar radius), so
 * they turn with the surface. Each loop rises, lives, fades and respawns
 * elsewhere, preferring the limb as seen from the current camera. Some
 * loops erupt at the end of their life: the arc lifts off and balloons
 * outwards while fading (not under prefers-reduced-motion).
 */
export class Prominences {
  readonly group = new Group();
  private readonly loops: Loop[] = [];
  private readonly rng: Random;
  private readonly color: Color;
  /** Camera direction in the Sun's local frame, set each frame by Sun. */
  readonly localViewDir = new Vector3(0, 0, 1);
  /** Shared uniforms, written by Sun each frame. */
  readonly sunCenterV = { value: new Vector3() };
  readonly sunRadius = { value: 1 };
  intensity: number;
  flowSpeed: number = P.flowSpeed;

  /** Defaults are the Sun's; other stars (galaxy view) pass their own. */
  constructor(opts: { count?: number; intensity?: number; color?: Color; seed?: number } = {}) {
    this.group.name = 'prominences';
    this.rng = new Random(opts.seed ?? 0x50a7);
    this.color = opts.color ?? new Color(...P.color);
    this.intensity = opts.intensity ?? P.intensity;
    for (let i = 0; i < (opts.count ?? P.count); i++) {
      const loop = this.createLoop();
      // Stagger the initial population across their lifetimes.
      loop.age = this.rng.next() * loop.life * 0.8;
      this.loops.push(loop);
    }
  }

  private createLoop(): Loop {
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: this.rng.range(0, 100) },
        uLife: { value: 0 },
        uGrow: { value: 0 },
        uIntensity: { value: this.intensity },
        uFlowSpeed: { value: this.flowSpeed },
        uColor: { value: this.color },
        uSunCenterV: this.sunCenterV,
        uSunRadius: this.sunRadius,
        uErupt: { value: 0 },
        uEruptExpansion: { value: P.eruptExpansion },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: FrontSide,
    });
    const mesh = new Mesh(this.buildGeometry(), material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, age: 0, life: this.rng.range(P.lifeMin, P.lifeMax), erupts: this.rollEruption() };
  }

  /** Random point on the unit sphere, optionally close to the limb. */
  private pickAnchor(): Vector3 {
    const v = new Vector3();
    const n = this.localViewDir.clone().normalize();
    // (No view direction with the camera at the Sun's centre, e.g. in the galaxy view.)
    if (this.rng.next() < LIMB_BIAS && Number.isFinite(n.x + n.y + n.z) && n.lengthSq() > 0.5) {
      // Limb = great circle perpendicular to the view direction.
      const a = new Vector3(0, 1, 0).cross(n);
      if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
      a.normalize();
      const b = n.clone().cross(a).normalize();
      const phi = this.rng.range(0, Math.PI * 2);
      const tilt = this.rng.range(-0.25, 0.25); // a little in front of / behind the limb
      v.copy(a).multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi)).addScaledVector(n, tilt);
    } else {
      const z = this.rng.range(-1, 1);
      const phi = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - z * z);
      v.set(r * Math.cos(phi), z, r * Math.sin(phi));
    }
    v.normalize();
    // Keep away from the poles.
    const lat = Math.asin(v.y);
    if (Math.abs(lat) > MAX_LATITUDE_RAD) {
      v.y = Math.sin(Math.sign(lat) * MAX_LATITUDE_RAD);
      const h = Math.sqrt(1 - v.y * v.y) / Math.max(1e-6, Math.hypot(v.x, v.z));
      v.x *= h;
      v.z *= h;
    }
    return v.normalize();
  }

  private buildGeometry(): TubeGeometry {
    const rng = this.rng;
    const center = this.pickAnchor();
    // Random tangent direction for the footpoint axis.
    const t0 = new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
    const tangent = t0.sub(center.clone().multiplyScalar(t0.dot(center))).normalize();
    const side = center.clone().cross(tangent).normalize();

    const span = rng.range(P.spanMin, P.spanMax);
    const height = rng.range(P.heightMin, P.heightMax);
    const lean = rng.range(-0.5, 0.5);
    const twist = rng.range(-0.35, 0.35);

    const a = center.clone().addScaledVector(tangent, -span * 0.5).normalize();
    const b = center.clone().addScaledVector(tangent, span * 0.5).normalize();

    const pts: Vector3[] = [];
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const s = i / CURVE_SAMPLES;
      const arch = Math.pow(Math.sin(Math.PI * s), 0.8);
      const base = a.clone().lerp(b, s).normalize();
      const wobble = Math.sin(s * Math.PI * 2 + twist * 5) * twist * span * 0.35;
      const p = base
        .multiplyScalar(0.995 + height * arch)
        .addScaledVector(side, (lean * height + wobble) * arch);
      pts.push(p);
    }
    const curve = new CatmullRomCurve3(pts, false, 'centripetal');
    return new TubeGeometry(curve, TUBE_SEGMENTS, P.thickness * rng.range(0.7, 1.4), TUBE_RADIAL, false);
  }

  private rollEruption(): boolean {
    return !reducedMotion() && this.rng.next() < P.eruptFraction;
  }

  private respawn(loop: Loop): void {
    loop.mesh.geometry.dispose();
    loop.mesh.geometry = this.buildGeometry();
    loop.age = 0;
    loop.life = this.rng.range(P.lifeMin, P.lifeMax);
    loop.erupts = this.rollEruption();
    loop.mesh.material.uniforms.uSeed.value = this.rng.range(0, 100);
  }

  update(dt: number, elapsed: number): void {
    for (const loop of this.loops) {
      loop.age += dt;
      if (loop.age >= loop.life) this.respawn(loop);
      const x = loop.age / loop.life;
      const grow = Math.min(1, x / GROW_FRACTION);
      const growEased = 1 - Math.pow(1 - grow, 3);
      const fadeIn = Math.min(1, x / (GROW_FRACTION * 0.5));
      let fadeOut = 1 - Math.max(0, (x - (1 - FADE_OUT_FRACTION)) / FADE_OUT_FRACTION);
      let erupt = 0;
      if (loop.erupts) {
        // Accelerating lift-off (ease-in), dimming as the plasma thins out.
        const e = Math.max(0, (x - (1 - P.eruptFractionOfLife)) / P.eruptFractionOfLife);
        erupt = e * e;
        fadeOut = 1 - e * e * e;
      }
      const u = loop.mesh.material.uniforms;
      u.uErupt.value = erupt;
      u.uTime.value = elapsed;
      u.uGrow.value = growEased * 1.08; // overshoot so the far footpoint is reached
      u.uLife.value = fadeIn * fadeOut;
      u.uIntensity.value = this.intensity;
      u.uFlowSpeed.value = this.flowSpeed;
    }
  }

  dispose(): void {
    for (const l of this.loops) {
      l.mesh.geometry.dispose();
      l.mesh.material.dispose();
    }
  }
}
