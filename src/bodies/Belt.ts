import {
  BufferAttribute,
  BufferGeometry,
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
  AdditiveBlending,
  DynamicDrawUsage,
  type Group,
} from 'three';
import rockVert from '../shaders/belt/rock.vert?raw';
import rockFrag from '../shaders/belt/rock.frag?raw';
import dustVert from '../shaders/belt/dust.vert?raw';
import dustFrag from '../shaders/belt/dust.frag?raw';
import { BELTS } from '../config/visual';
import { KM_PER_AU } from '../config/astro';
import { sunUniforms } from '../core/lighting';
import { SCALE_CONFIG, scale } from '../core/scale';
import type { FrameContext, Updatable } from '../core/types';
import { ECLIPTIC_TO_SCENE } from '../physics/frames';
import { fbm3 } from '../utils/noise';
import { Random } from '../utils/random';

const DEG = Math.PI / 180;
/** Floats per body in the element table. */
const ELEM_STRIDE = 10;
/** Gaussian gravitational constant: mean motion n = k / a^1.5 (rad/day, a in AU). */
const GAUSS_K = 0.01720209895;
/**
 * Between exact Kepler solves the GPU extrapolates each body along its
 * velocity. Re-solve once the fastest body has swept this much mean anomaly:
 * the chord error grows as r·Δ²/2, i.e. ≈ 0.1 % of the orbit radius here,
 * well below a pixel at any distance from which the belt is a belt.
 */
const MAX_EXTRAPOLATION_RAD = 0.045;
/** Relative step for the numeric slope of the scale curve (mid-transition only). */
const SCALE_SLOPE_STEP = 1e-4;
/**
 * Draw a rock mesh only if that rock could be at least this many device
 * pixels in radius at the nearest point of the belt. Below that the dust
 * layer alone carries it (dust.vert hands over between 0.6 and 2 px), and
 * the mesh is pure vertex cost. Bodies are stored largest first, so the
 * drawable ones are always a prefix and the instance count does the culling.
 */
const ROCKS_MIN_RADIUS_PX = 0.6;

export interface BeltBody {
  a: number;
  e: number;
  i: number;
  node: number;
  peri: number;
  M0: number;
  /** Diameter, km. */
  sizeKm: number;
  color: [number, number, number];
}

/** A Rayleigh-distributed sample with scale σ. */
function rayleigh(rng: Random, sigma: number): number {
  return sigma * Math.sqrt(-2 * Math.log(1 - rng.next()));
}

/** Size–frequency power law N(>D) ∝ D^-q between dMin and dMax. */
function powerLawSize(rng: Random, dMin: number, dMax: number, q: number): number {
  const u = rng.next();
  const lo = Math.pow(dMax, -q);
  const hi = Math.pow(dMin, -q);
  return Math.pow(hi - u * (hi - lo), -1 / q);
}

/**
 * Main belt between Mars and Jupiter. Semi-major axes avoid the Kirkwood
 * gaps (3:1, 5:2, 7:3, 2:1 resonances with Jupiter); eccentricities and
 * inclinations follow Rayleigh distributions; a share of bodies are Jupiter
 * Trojans librating around L4/L5 (±60° from Jupiter).
 */
export function mainBelt(count: number, rng: Random): BeltBody[] {
  const C = BELTS.asteroid;
  const out: BeltBody[] = [];
  const gaps = C.kirkwoodGapsAu;
  const jupiterL0 = C.jupiterMeanLongitudeDeg * DEG;
  while (out.length < count) {
    const trojan = rng.next() < C.trojanFraction;
    let a: number;
    let node = rng.range(0, Math.PI * 2);
    let peri = rng.range(0, Math.PI * 2);
    let M0 = rng.range(0, Math.PI * 2);
    let e: number;
    let i: number;
    if (trojan) {
      a = C.jupiterAu * (1 + rng.gaussian() * 0.004);
      e = Math.min(rayleigh(rng, 0.05), 0.2);
      i = rayleigh(rng, 12 * DEG);
      const side = rng.next() < 0.5 ? 1 : -1;
      const L = jupiterL0 + side * 60 * DEG + rng.gaussian() * 12 * DEG;
      M0 = L - node - peri;
    } else {
      a = rng.range(C.innerAu, C.outerAu);
      // Density peaks mid-belt; reject near resonances.
      const centre = 1 - Math.abs((a - 2.7) / 0.7);
      if (rng.next() > 0.35 + 0.65 * centre) continue;
      if (gaps.some((g) => Math.abs(a - g) < C.gapHalfWidthAu * (0.6 + rng.next()))) continue;
      e = Math.min(rayleigh(rng, 0.07), 0.32);
      i = rayleigh(rng, 7 * DEG);
    }
    const kind = rng.next();
    const color: [number, number, number] =
      kind < 0.6 ? [0.07, 0.068, 0.065] : kind < 0.9 ? [0.17, 0.14, 0.11] : [0.13, 0.13, 0.13];
    const tint = 0.85 + rng.next() * 0.3;
    out.push({
      a,
      e,
      i,
      node,
      peri,
      M0,
      sizeKm: powerLawSize(rng, C.sizeMinKm, C.sizeMaxKm, 1.8),
      color: [color[0] * tint, color[1] * tint, color[2] * tint],
    });
  }
  return out;
}

/**
 * Kuiper belt: resonant plutinos at 39.4 AU (3:2 with Neptune), a cold
 * classical disc at 42–47 AU (low e, low i) and a hot, scattered population.
 */
export function kuiperBelt(count: number, rng: Random): BeltBody[] {
  const C = BELTS.kuiper;
  const out: BeltBody[] = [];
  for (let n = 0; n < count; n++) {
    const r = rng.next();
    let a: number;
    let e: number;
    let i: number;
    if (r < 0.3) {
      a = 39.4 + rng.gaussian() * 0.2;
      e = rng.range(0.08, 0.3);
      i = rayleigh(rng, 10 * DEG);
    } else if (r < 0.75) {
      a = rng.range(42, 47);
      e = Math.min(rayleigh(rng, 0.04), 0.1);
      i = rayleigh(rng, 2.5 * DEG);
    } else {
      a = rng.range(40, 55);
      e = Math.min(rayleigh(rng, 0.12), 0.35);
      i = rayleigh(rng, 16 * DEG);
    }
    const red = rng.next();
    const color: [number, number, number] = [0.32 + 0.2 * red, 0.27 + 0.1 * red, 0.24 + 0.02 * red];
    out.push({
      a,
      e,
      i,
      node: rng.range(0, Math.PI * 2),
      peri: rng.range(0, Math.PI * 2),
      M0: rng.range(0, Math.PI * 2),
      sizeKm: powerLawSize(rng, C.sizeMinKm, C.sizeMaxKm, 2.0),
      color,
    });
  }
  return out;
}

/** A lumpy, faceted rock: subdivided icosahedron displaced by fbm. */
function rockGeometry(seed: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, 1);
  const pos = g.getAttribute('position') as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = 1 + 0.32 * fbm3(v.x * 1.6, v.y * 1.6, v.z * 1.6, 4, seed);
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  g.computeVertexNormals(); // non-indexed → faceted, rocky shading
  return g;
}

/**
 * One belt (main or Kuiper): instanced rocks (Kepler on the CPU at an epoch,
 * extrapolated on the GPU in between), plus a
 * point layer that carries the look from far away.
 */
export class Belt implements Updatable {
  readonly rocks: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly dust: Points<BufferGeometry, ShaderMaterial>;
  private readonly keplerUniforms = {
    uEclToScene: { value: new Matrix3().copy(ECLIPTIC_TO_SCENE) },
    uUnitsPerAu: { value: SCALE_CONFIG.cinematic.unitsPerAu as number },
    uDistExp: { value: SCALE_CONFIG.cinematic.distanceExponent as number },
    uRefRadiusUnits: { value: SCALE_CONFIG.cinematic.refRadiusUnits as number },
    uRadiusExp: { value: SCALE_CONFIG.cinematic.radiusExponent as number },
    uKmPerUnit: { value: SCALE_CONFIG.real.kmPerUnit as number },
    uScaleBlend: { value: 0 },
    uSizeBoost: { value: 1 },
  };
  private readonly capacity: number;
  private count: number;
  /** Per body: a, e, M0, n, P.xyz, Q.xyz (doubles). */
  private readonly elements: Float64Array;
  private readonly centers: Float32Array;
  /** Scene units per day at the epoch, for GPU extrapolation. */
  private readonly velocities: Float32Array;
  private readonly rockAttrs: InstancedBufferAttribute[];
  private readonly dustAttrs: BufferAttribute[];
  /** Fastest mean motion among the bodies (rad/day). */
  private readonly maxMeanMotion: number;
  /** Time (days since J2000) the centres were solved for. */
  private epochDays = Number.NaN;
  private epochBlend = Number.NaN;
  private readonly extrapolation = { value: 0 };
  /** User toggle (belts on/off); rocks additionally depend on distance. */
  private enabled = true;
  /** Belt extent in scene units at the epoch: radial range in the ecliptic plane, half-thickness. */
  private readonly extent = { inner: 0, outer: 0, halfHeight: 0 };
  /** Diameters (km), descending. */
  private readonly sizes: Float32Array;
  /** Scene-unit radii for the current scale blend (refreshed with each solve). */
  private readonly sceneRadii: Float32Array;
  private readonly camAbs = new Vector3();

  constructor(
    readonly name: string,
    bodies: BeltBody[],
    private readonly world: Group,
    opts: { sizeBoost: number; dustSizePx: number; dustIntensity: number; seed: number },
  ) {
    bodies = [...bodies].sort((a, b) => b.sizeKm - a.sizeKm);
    this.capacity = bodies.length;
    this.count = bodies.length;
    this.keplerUniforms.uSizeBoost.value = opts.sizeBoost;
    const n = bodies.length;
    this.elements = new Float64Array(n * ELEM_STRIDE);
    this.centers = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    this.sizes = sizes;
    this.sceneRadii = new Float32Array(n);
    const spin = new Float32Array(n * 4);
    const shape = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const rng = new Random(opts.seed);
    const axis = new Vector3();
    const P = new Vector3();
    const Q = new Vector3();
    bodies.forEach((b, k) => {
      // Perifocal axes P (towards perihelion) and Q, in scene coordinates.
      const cw = Math.cos(b.peri), sw = Math.sin(b.peri);
      const cO = Math.cos(b.node), sO = Math.sin(b.node);
      const cI = Math.cos(b.i), sI = Math.sin(b.i);
      P.set(cw * cO - sw * sO * cI, cw * sO + sw * cO * cI, sw * sI).applyMatrix3(ECLIPTIC_TO_SCENE);
      Q.set(-sw * cO - cw * sO * cI, -sw * sO + cw * cO * cI, cw * sI).applyMatrix3(ECLIPTIC_TO_SCENE);
      this.elements.set(
        [b.a, b.e, b.M0, GAUSS_K / Math.pow(b.a, 1.5), P.x, P.y, P.z, Q.x, Q.y, Q.z],
        k * ELEM_STRIDE,
      );
      sizes[k] = b.sizeKm;
      axis.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
      spin.set([axis.x, axis.y, axis.z, rng.range(0.05, 0.6) * (rng.next() < 0.5 ? -1 : 1)], k * 4);
      shape.set([rng.range(0.7, 1.3), rng.range(0.55, 1.0), rng.range(0.7, 1.2)], k * 3);
      const c = new Color(...b.color);
      color.set([c.r, c.g, c.b], k * 3);
    });
    let maxN = 0;
    for (let k = 0; k < n; k++) maxN = Math.max(maxN, this.elements[k * ELEM_STRIDE + 3]);
    this.maxMeanMotion = maxN;

    // ---- Rocks ----------------------------------------------------------------
    const base = rockGeometry(opts.seed);
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    const rockCenters = new InstancedBufferAttribute(this.centers, 3).setUsage(DynamicDrawUsage);
    const rockVel = new InstancedBufferAttribute(this.velocities, 3).setUsage(DynamicDrawUsage);
    this.rockAttrs = [rockCenters, rockVel];
    geo.setAttribute('aCenter', rockCenters);
    geo.setAttribute('aVelocity', rockVel);
    geo.setAttribute('aSize', new InstancedBufferAttribute(sizes, 1));
    geo.setAttribute('aSpin', new InstancedBufferAttribute(spin, 4));
    geo.setAttribute('aShape', new InstancedBufferAttribute(shape, 3));
    geo.setAttribute('aColor', new InstancedBufferAttribute(color, 3));
    geo.instanceCount = n;
    this.rocks = new Mesh(
      geo,
      new ShaderMaterial({
        vertexShader: rockVert,
        fragmentShader: rockFrag,
        uniforms: { ...sunUniforms, ...this.keplerUniforms, uTime: { value: 0 }, uDt: this.extrapolation },
      }),
    );
    this.rocks.name = `${name}-rocks`;
    this.rocks.frustumCulled = false;
    world.add(this.rocks);

    // ---- Dust (distant look) ------------------------------------------------------
    const dgeo = new BufferGeometry();
    // Same centre array as the rocks, exposed as point positions.
    const dustCenters = new BufferAttribute(this.centers, 3).setUsage(DynamicDrawUsage);
    const dustVel = new BufferAttribute(this.velocities, 3).setUsage(DynamicDrawUsage);
    this.dustAttrs = [dustCenters, dustVel];
    dgeo.setAttribute('position', dustCenters);
    dgeo.setAttribute('aVelocity', dustVel);
    dgeo.setAttribute('aSize', new BufferAttribute(sizes, 1));
    dgeo.setAttribute('aColor', new BufferAttribute(color, 3));
    this.dust = new Points(
      dgeo,
      new ShaderMaterial({
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        uniforms: {
          ...sunUniforms,
          ...this.keplerUniforms,
          uDt: this.extrapolation,
          uPointSize: { value: opts.dustSizePx },
          uPixelRatio: { value: 1 },
          uViewportHalfHeight: { value: 500 },
          uTanHalfFov: { value: 0.4 },
          uIntensity: { value: opts.dustIntensity },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.dust.name = `${name}-dust`;
    this.dust.frustumCulled = false;
    world.add(this.dust);
  }

  /** Show only the first `n` bodies, i.e. the largest (quality presets). */
  setCount(n: number): void {
    const c = Math.max(0, Math.min(n, this.capacity));
    this.count = c;
    this.epochDays = Number.NaN; // solve the newly visible ones
    this.rocks.geometry.instanceCount = c;
    this.dust.geometry.setDrawRange(0, c);
  }

  set visible(v: boolean) {
    this.enabled = v;
    this.rocks.visible = v;
    this.dust.visible = v;
  }

  get visible(): boolean {
    return this.enabled;
  }

  /**
   * Kepler's equation once per body (double precision) at an epoch, plus the
   * body's scene-space velocity. The vertex shaders extrapolate linearly from
   * there, so the full solve runs only every ~MAX_EXTRAPOLATION_RAD of orbit
   * (hundreds of frames at everyday time rates) instead of every frame, and
   * never per vertex.
   */
  private propagate(days: number): void {
    const el = this.elements;
    const out = this.centers;
    const vel = this.velocities;
    // At the end points of the blend the km → units curve is a single power
    // law (cinematic, s = k·r^p) or a constant factor (real); only frames
    // mid-transition need the general path. g(r) = s(r)/r scales the
    // perifocal position; dg/dr feeds the velocity.
    const blend = scale.blend;
    const cin = SCALE_CONFIG.cinematic;
    const realK = KM_PER_AU / SCALE_CONFIG.real.kmPerUnit;
    const p = cin.distanceExponent;
    const TWO_PI = Math.PI * 2;
    const gOf = (r: number): number => scale.distance(r * KM_PER_AU) / r;
    let inner = Infinity;
    let outer = 0;
    let halfHeight = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * ELEM_STRIDE;
      const a = el[o];
      const e = el[o + 1];
      const n = el[o + 3];
      const M = (el[o + 2] + n * days) % TWO_PI;
      let E = M + e * Math.sin(M);
      for (let it = 0; it < 4; it++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const sinE = Math.sin(E);
      const cosE = Math.cos(E);
      const b = a * Math.sqrt(1 - e * e);
      const x = a * (cosE - e);
      const y = b * sinE;
      const Edot = n / (1 - e * cosE);
      const xd = -a * sinE * Edot;
      const yd = b * cosE * Edot;
      const r = Math.sqrt(x * x + y * y); // Math.hypot is slow in V8
      let g: number;
      let dg: number; // dg/dr
      if (blend === 0) {
        g = cin.unitsPerAu * Math.pow(r, p - 1);
        dg = ((p - 1) * g) / r;
      } else if (blend === 1) {
        g = realK;
        dg = 0;
      } else {
        g = gOf(r);
        dg = (gOf(r * (1 + SCALE_SLOPE_STEP)) - g) / (r * SCALE_SLOPE_STEP);
      }
      const rd = (x * xd + y * yd) / r;
      const px = x * g;
      const py = y * g;
      const vx = xd * g + x * dg * rd;
      const vy = yd * g + y * dg * rd;
      const j = i * 3;
      out[j] = el[o + 4] * px + el[o + 7] * py;
      out[j + 1] = el[o + 5] * px + el[o + 8] * py;
      out[j + 2] = el[o + 6] * px + el[o + 9] * py;
      vel[j] = el[o + 4] * vx + el[o + 7] * vy;
      vel[j + 1] = el[o + 5] * vx + el[o + 8] * vy;
      vel[j + 2] = el[o + 6] * vx + el[o + 9] * vy;
      const rho = Math.sqrt(out[j] * out[j] + out[j + 2] * out[j + 2]);
      if (rho < inner) inner = rho;
      if (rho > outer) outer = rho;
      const h = Math.abs(out[j + 1]);
      if (h > halfHeight) halfHeight = h;
    }
    this.extent.inner = inner;
    this.extent.outer = outer;
    this.extent.halfHeight = halfHeight;
    for (const attr of [...this.rockAttrs, ...this.dustAttrs]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * 3);
      attr.needsUpdate = true;
    }
    if (blend !== this.epochBlend) {
      for (let i = 0; i < this.capacity; i++) this.sceneRadii[i] = scale.radius(this.sizes[i]);
    }
    this.epochDays = days;
    this.epochBlend = blend;
  }

  /**
   * Length of the prefix (largest rocks first) that contains every rock
   * spanning ROCKS_MIN_RADIUS_PX. Quick exit when even the largest rock at
   * the belt's nearest point (an annulus around the ecliptic) is too small;
   * otherwise each rock's extrapolated distance is checked (cheap: no trig).
   */
  private resolvableRocks(ctx: FrameContext): number {
    const c = this.camAbs.copy(ctx.cameraPosition).sub(this.world.position); // heliocentric scene
    const rho = Math.hypot(c.x, c.z);
    const { inner, outer, halfHeight } = this.extent;
    const dr = Math.max(inner - rho, 0, rho - outer);
    const dy = Math.max(Math.abs(c.y) - halfHeight, 0);
    const d = Math.max(Math.hypot(dr, dy), 1e-6);
    // Smallest scene radius that still reaches the pixel threshold at d.
    const minR = (ROCKS_MIN_RADIUS_PX * d * Math.tan((ctx.camera.fov * Math.PI) / 360)) / (ctx.viewportHeight / 2);
    const boost = this.keplerUniforms.uSizeBoost.value;
    // Binary search the descending size list for the first rock below it.
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sceneRadii[mid] * boost >= minR) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    // Per rock: is it within the distance at which its radius still reaches
    // the threshold? Squared distances, no square roots.
    const k = minR / d; // threshold radius per unit distance
    const cen = this.centers;
    const vel = this.velocities;
    const dt = this.extrapolation.value;
    let last = -1;
    for (let i = 0; i < lo; i++) {
      const j = i * 3;
      const x = cen[j] + vel[j] * dt - c.x;
      const y = cen[j + 1] + vel[j + 1] * dt - c.y;
      const z = cen[j + 2] + vel[j + 2] * dt - c.z;
      const maxDist = (this.sceneRadii[i] * boost) / k;
      if (x * x + y * y + z * z <= maxDist * maxDist) last = i;
    }
    return last + 1;
  }

  update(ctx: FrameContext): void {
    const k = this.keplerUniforms;
    k.uScaleBlend.value = scale.blend;
    const days = ctx.time.daysSinceJ2000;
    if (this.enabled) {
      const stale =
        !(Math.abs(days - this.epochDays) * this.maxMeanMotion <= MAX_EXTRAPOLATION_RAD) || // NaN-safe
        scale.blend !== this.epochBlend;
      if (stale) this.propagate(days);
      this.extrapolation.value = days - this.epochDays;
      const drawn = this.resolvableRocks(ctx);
      this.rocks.geometry.instanceCount = drawn;
      this.rocks.visible = drawn > 0;
    }
    this.rocks.material.uniforms.uTime.value = ctx.time.elapsed;
    const du = this.dust.material.uniforms;
    du.uPixelRatio.value = ctx.pixelRatio;
    du.uViewportHalfHeight.value = ctx.viewportHeight / 2;
    du.uTanHalfFov.value = Math.tan((ctx.camera.fov * Math.PI) / 360);
  }

  dispose(): void {
    this.rocks.geometry.dispose();
    this.rocks.material.dispose();
    this.dust.geometry.dispose();
    this.dust.material.dispose();
  }
}
