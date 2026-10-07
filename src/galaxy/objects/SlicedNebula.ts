import {
  AdditiveBlending,
  DataTexture,
  DataUtils,
  DoubleSide,
  Group,
  HalfFloatType,
  LinearFilter,
  MathUtils,
  Matrix4,
  Mesh,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Texture,
} from 'three';
import sliceVert from '../../shaders/deepsky/slice.vert?raw';
import sliceFrag from '../../shaders/deepsky/slice.frag?raw';
import type { DepthSpec, NebulaDef } from '../../config/deepsky';
import type { Loader } from '../../core/Loader';
import { equatorialToScene } from '../../physics/frames';
import { Random } from '../../utils/random';
import { makePoints } from '../GalaxyModel';
import { DEG, skyFrame, type BlackHoleInfo, type DeepContext, type DeepObject, type DeepTarget, type StarPoints } from './common';
import { makeGlow } from './StarGlow';
import { PulsarBeams } from './PulsarBeams';

const SLICES = 16;
const DEPTH_N = 256;

/** Image pixel as the depth models see it. */
interface Px {
  /** Centred, y up, in image widths. */
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  /** Luminance, normalised to the image maximum. */
  l: number;
}

/**
 * Up to two depth layers and a thickness (image widths, + towards the Sun)
 * for a pixel, following the object's published structure (see DepthSpec).
 */
function layers(d: DepthSpec, p: Px, ax: number, ay: number): [number, number, number] {
  // Galaxy models work about the anchor (the nucleus).
  const x = p.x - ax;
  const y = p.y - ay;
  switch (d.model) {
    case 'disc': {
      const a = d.majorDeg * DEG;
      const u = x * Math.cos(a) + y * Math.sin(a);
      const v = (-x * Math.sin(a) + y * Math.cos(a)) / Math.cos(d.incDeg * DEG);
      const r2 = (u * u + v * v) / (d.bulge * d.bulge);
      return [0, 0, d.thick + d.bulge * 0.25 * Math.exp(-r2)];
    }
    case 'edge': {
      const a = d.majorDeg * DEG;
      const u = x * Math.cos(a) + y * Math.sin(a);
      const v = -x * Math.sin(a) + y * Math.cos(a);
      // Depth of the disc along the line of sight at this point of the major axis.
      const D = d.length * Math.sqrt(Math.max(0, 1 - (u * u) / (d.length * d.length)));
      const B = d.bulge * Math.sqrt(Math.max(0, 1 - (u * u + v * v) / (d.bulge * d.bulge)));
      return [D * 0.45, -D * 0.45, Math.max(0.01, D * 0.35, B * 0.6)];
    }
    case 'ellipsoid': {
      const q = (x * x + y * y) / (d.radius * d.radius);
      return [0, 0, Math.max(0.01, d.depth * d.radius * Math.sqrt(Math.max(0, 1 - q)) * 0.6)];
    }
    case 'flat':
      return [0, 0, d.depth * (0.3 + 0.7 * p.l)];
    case 'shell': {
      const c = Math.cos(d.angleDeg * DEG);
      const s = Math.sin(d.angleDeg * DEG);
      const u = (p.x * c - p.y * s) / d.a;
      const v = (p.x * s + p.y * c) / d.b;
      const q = u * u + v * v;
      if (q >= 1) return [0, 0, 0.03];
      const z = Math.sqrt(1 - q) * d.depth;
      if (d.interiorBlue && p.b > p.r * 1.05) return [0, 0, z * 0.55 + 0.01];
      return [z, -z, 0.012 + 0.12 * z];
    }
    case 'bowl': {
      const dx = p.x - d.cx;
      const dy = p.y - d.cy;
      const z = Math.min(-d.deep + (dx * dx + dy * dy) / (2 * d.curvature), 0.25);
      return [z, z, 0.018];
    }
    case 'pillars': {
      const background = p.b > p.r * 0.95 || p.l < 0.12;
      return background ? [-0.3, -0.3, 0.06] : [0.02, 0.02, 0.025];
    }
    case 'barrel': {
      const c = Math.cos(d.angleDeg * DEG);
      const s = Math.sin(d.angleDeg * DEG);
      const u = (p.x * c - p.y * s) / d.a;
      const v = (p.x * s + p.y * c) / d.b;
      const rn = Math.sqrt(u * u + v * v);
      if (p.b > p.r && rn < 0.9) {
        const L = d.lobe * Math.sqrt(Math.max(0, 1 - rn * rn)) * d.a + 0.02;
        return [L * 0.6, -L * 0.6, L * 0.45];
      }
      return [0, 0, rn > 1.15 ? 0.07 : 0.03];
    }
    case 'bipolar': {
      const c = Math.cos(d.axisDeg * DEG);
      const s = Math.sin(d.axisDeg * DEG);
      const along = p.x * c + p.y * s;
      const across = -p.x * s + p.y * c;
      const R = d.waist + d.flare * Math.abs(along);
      if (Math.abs(across) >= R) return [0, 0, 0.03];
      const z = Math.sqrt(R * R - across * across);
      return [z * 0.85, -z * 0.85, 0.02 + 0.15 * z];
    }
    case 'sheet': {
      const dust = p.r > p.b * 1.02;
      return dust ? [0.04 + (0.5 - p.l) * 0.05, 0.04 + (0.5 - p.l) * 0.05, 0.035] : [-0.18 - p.l * 0.05, -0.18 - p.l * 0.05, 0.05];
    }
  }
}

/** 0..1: is this pixel part of the galaxy (1) or foreground stars / sky (0)? */
function galaxyMask(d: DepthSpec, p: Px, ax: number, ay: number): number {
  const x = p.x - ax;
  const y = p.y - ay;
  const fade = (q: number) => 1 - MathUtils.smoothstep(q, 0.8, 1.2);
  switch (d.model) {
    case 'disc': {
      const a = d.majorDeg * DEG;
      const u = x * Math.cos(a) + y * Math.sin(a);
      const v = (-x * Math.sin(a) + y * Math.cos(a)) / Math.cos(d.incDeg * DEG);
      return fade(Math.sqrt(u * u + v * v) / d.extent);
    }
    case 'edge': {
      const a = d.majorDeg * DEG;
      const u = (x * Math.cos(a) + y * Math.sin(a)) / (d.length * 1.1);
      const v = (-x * Math.sin(a) + y * Math.cos(a)) / Math.max(d.bulge * 1.6, d.length * 0.2);
      return fade(Math.sqrt(u * u + v * v));
    }
    case 'ellipsoid':
      return fade(Math.sqrt(x * x + y * y) / d.extent);
    default:
      return 1;
  }
}

/**
 * A nebula from its Hubble/Webb picture, made volumetric: the picture is
 * spread over a stack of slices by a depth map built from the object's
 * structure model, so it reads crisply from Earth's side and shows real
 * depth when you fly round it; soft particles from the same map keep the
 * shape at grazing angles. The 1K picture loads on approach, the 4K one
 * only up close (and is freed again when you leave).
 */
export class SlicedNebula implements DeepObject {
  readonly group = new Group();
  readonly targets: DeepTarget[] = [];
  readonly blackHoles: BlackHoleInfo[] = [];
  readonly position: Vector3;
  readonly toSun: Vector3;
  readonly frame: Matrix4;
  /**
   * Disc galaxy: local vector that the shear maps onto the unit disc normal.
   * Slices stack along the line of sight seen from Earth's side (the photo
   * stays exact) and turn to the disc normal off-axis (true thickness).
   */
  private readonly discNormalLocal: Vector3 | null = null;
  /** Anchor in centred image widths (y up). */
  private readonly ax: number;
  private readonly ay: number;
  private readonly W: number;
  private readonly H: number;
  private readonly slices: Mesh<PlaneGeometry, ShaderMaterial>[] = [];
  private readonly sliceUniforms;
  private particles: StarPoints | null = null;
  private readonly glows: Mesh<PlaneGeometry, ShaderMaterial>[] = [];
  private readonly pulsar: PulsarBeams | null = null;
  private lowState: 'none' | 'loading' | 'ready' = 'none';
  private hiState: 'none' | 'loading' | 'ready' = 'none';
  private hiTex: Texture | null = null;
  private lowTex: Texture | null = null;

  constructor(
    readonly def: NebulaDef,
    private readonly loader: Loader,
  ) {
    const dir = equatorialToScene(def.ra, def.dec);
    this.position = dir.clone().multiplyScalar(def.distPc);
    this.toSun = dir.clone().negate();
    this.frame = skyFrame(dir, this.position);
    this.W = def.widthPc;
    this.H = def.widthPc / def.aspect;
    const anchor = def.anchor ?? [0.5, 0.5];
    this.ax = anchor[0] - 0.5;
    this.ay = (0.5 - anchor[1]) / def.aspect;
    // The anchor sits at RA/Dec. A disc galaxy's picture is sheared back onto
    // its tilted plane: (x, y) -> (x, y, v tan i), v the minor-axis coordinate,
    // so from the Sun's side it is still exactly the photograph. Its slices
    // stay stacked along the line of sight (local z): the photo already holds
    // the disc's projected thickness, and Earth's view stays pin-sharp.
    const c = new Vector3(this.ax * this.W, this.ay * this.W, 0);
    const local = new Matrix4().makeTranslation(-c.x, -c.y, 0);
    if (def.depth.model === 'disc') {
      const a = def.depth.majorDeg * DEG;
      const t = Math.tan(def.depth.incDeg * DEG);
      const shear = new Matrix4().makeBasis(new Vector3(1, 0, -Math.sin(a) * t), new Vector3(0, 1, Math.cos(a) * t), new Vector3(0, 0, 1));
      const nSky = new Vector3(Math.sin(a) * t, -Math.cos(a) * t, 1).normalize();
      this.discNormalLocal = nSky.applyMatrix4(shear.clone().invert());
      local.premultiply(new Matrix4().makeTranslation(c.x, c.y, 0).multiply(shear).multiply(new Matrix4().makeTranslation(-c.x, -c.y, 0)));
    }
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(this.frame).multiply(local);
    const anchorLocal = new Vector2(c.x, c.y);
    this.group.name = `deepsky-${def.id}`;
    this.group.visible = false;

    const geo = new PlaneGeometry(this.W, this.H);
    this.sliceUniforms = {
      uMap: { value: null as Texture | null },
      uDepth: { value: null as Texture | null },
      uIntensity: { value: 0.95 * def.brightness },
      uZRange: { value: 1 },
      uZDir: { value: new Vector3(0, 0, 1) },
      uEye: { value: 0 },
      uAnchor: { value: anchorLocal },
      // Slices fade at grazing views; a tilted disc is seen at a grazing angle
      // even from Earth, so it fades only when nearly edge-on.
      uFacing: { value: def.depth.model === 'disc' ? new Vector2(0.02, 0.1) : new Vector2(0.1, 0.45) },
    };
    for (let i = 0; i < SLICES; i++) {
      const m = new Mesh(
        geo,
        new ShaderMaterial({
          vertexShader: sliceVert,
          fragmentShader: sliceFrag,
          uniforms: { ...this.sliceUniforms, uZ: { value: (i / (SLICES - 1)) * 2 - 1 } },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        }),
      );
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.visible = false;
      this.slices.push(m);
      this.group.add(m);
    }

    const at = (f: readonly [number, number]) => new Vector3((f[0] - 0.5) * this.W, (0.5 - f[1]) * this.H, 0);
    if (def.core) {
      const g = makeGlow(def.core.color, this.W * 0.004, 2.2, 5, 0.3);
      g.position.copy(at(def.core.at));
      this.glows.push(g);
      this.group.add(g);
    }
    if (def.pulsar) {
      this.pulsar = new PulsarBeams(def.pulsar, def.pulsar.beamLengthPc, [0.6, 0.78, 1.0], this.W * 0.004);
      this.pulsar.group.position.copy(at(def.pulsar.at ?? [0.5, 0.5]));
      this.group.add(this.pulsar.group);
    }

    const north = new Vector3().setFromMatrixColumn(this.frame, 1).normalize();
    this.targets.push({
      id: def.id,
      name: def.name,
      fact: def.facts.text,
      facts: def.facts,
      kind: def.category === 'galaxy' ? 'galaxy' : 'nebula',
      category: def.category,
      position: this.position,
      range: [0, Math.max(6000, def.widthPc * 2000)],
      framePc: def.framePc,
      priority: 8,
      viewDir: this.toSun,
      up: north,
      minPc: def.widthPc * 0.04,
      maxDistPc: Math.max(4000, def.widthPc * 1500),
      distPc: def.distPc,
    });
    if (def.core?.label) {
      this.targets.push({
        id: `${def.id}-core`,
        name: def.core.label,
        fact: def.facts.text,
        kind: 'star',
        position: at(def.core.at).applyMatrix4(this.frame),
        range: [0, def.widthPc * 3],
        framePc: def.widthPc * 0.4,
        priority: 4,
        maxDistPc: def.widthPc * 6,
      });
    }
  }

  scaled(): ShaderMaterial[] {
    const out: ShaderMaterial[] = this.glows.map((g) => g.material);
    if (this.particles) out.push(this.particles.material);
    if (this.pulsar) out.push(this.pulsar.glow.material);
    return out;
  }

  private loadLow(): void {
    this.lowState = 'loading';
    this.loader
      .loadDeferred(`textures/${this.def.folder ?? 'deepsky'}/${this.def.image}_1k.jpg`)
      .then((t) => {
        this.lowTex = t;
        this.buildFromImage(t.image as CanvasImageSource);
        if (this.hiState !== 'ready') this.sliceUniforms.uMap.value = t;
        this.lowState = 'ready';
      })
      .catch(() => (this.lowState = 'none'));
  }

  private loadHigh(): void {
    this.hiState = 'loading';
    this.loader
      .loadDeferred(`textures/${this.def.folder ?? 'deepsky'}/${this.def.image}_4k.jpg`)
      .then((t) => {
        // Left again while loading: drop it.
        if (this.hiState !== 'loading') {
          t.dispose();
          return;
        }
        this.hiTex = t;
        this.sliceUniforms.uMap.value = t;
        this.hiState = 'ready';
      })
      .catch(() => (this.hiState = 'none'));
  }

  private dropHigh(): void {
    if (this.hiTex) this.hiTex.dispose();
    this.hiTex = null;
    this.hiState = 'none';
    this.sliceUniforms.uMap.value = this.lowTex;
  }

  /** Depth map and particles from the 1K picture. */
  private buildFromImage(image: CanvasImageSource): void {
    const d = this.def;
    const N = DEPTH_N;
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const g2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!g2d) return;
    g2d.drawImage(image, 0, 0, N, N);
    const px = g2d.getImageData(0, 0, N, N).data;
    let maxL = 0;
    for (let i = 0; i < N * N; i++) maxL = Math.max(maxL, px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]);
    maxL = maxL / 765 || 1;
    const lin = (c: number) => Math.pow(c / 255, 2.2);
    const yScale = 1 / d.aspect;

    // Raw layers (image widths).
    const raw = new Float32Array(N * N * 3);
    const mask = new Float32Array(N * N);
    let zRange = 0.02;
    const p: Px = { x: 0, y: 0, r: 0, g: 0, b: 0, l: 0 };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        p.x = (i + 0.5) / N - 0.5;
        p.y = (0.5 - (j + 0.5) / N) * yScale;
        p.r = lin(px[k * 4]);
        p.g = lin(px[k * 4 + 1]);
        p.b = lin(px[k * 4 + 2]);
        p.l = (px[k * 4] + px[k * 4 + 1] + px[k * 4 + 2]) / 765 / maxL;
        const [z1, z2, th] = layers(d.depth, p, this.ax, this.ay);
        mask[k] = galaxyMask(d.depth, p, this.ax, this.ay);
        raw.set([z1, z2, th], k * 3);
        zRange = Math.max(zRange, Math.abs(z1) + th, Math.abs(z2) + th);
      }
    }
    // Slices are evenly spread over ±zRange; thickness never below ~half a
    // spacing so no light falls between slices. Normalisation per pixel.
    const spacing = (2 * zRange) / (SLICES - 1);
    const data = new Uint16Array(N * N * 4);
    const gss = (x: number, s: number) => Math.exp((-0.5 * x * x) / (s * s));
    for (let k = 0; k < N * N; k++) {
      const z1 = raw[k * 3] / zRange;
      const z2 = raw[k * 3 + 1] / zRange;
      const th = Math.max(raw[k * 3 + 2], spacing * 0.6) / zRange;
      let sum = 0;
      for (let s = 0; s < SLICES; s++) {
        const zs = (s / (SLICES - 1)) * 2 - 1;
        sum += gss(zs - z1, th) + gss(zs - z2, th);
      }
      // Rows flipped: texture v = 0 is the image bottom.
      const row = N - 1 - Math.floor(k / N);
      const o = (row * N + (k % N)) * 4;
      data[o] = DataUtils.toHalfFloat(z1);
      data[o + 1] = DataUtils.toHalfFloat(z2);
      data[o + 2] = DataUtils.toHalfFloat(th);
      data[o + 3] = DataUtils.toHalfFloat(mask[k] / Math.max(sum, 1e-3));
    }
    const depthTex = new DataTexture(data, N, N, RGBAFormat, HalfFloatType);
    depthTex.minFilter = LinearFilter;
    depthTex.magFilter = LinearFilter;
    depthTex.needsUpdate = true;
    this.sliceUniforms.uDepth.value = depthTex;
    this.sliceUniforms.uZRange.value = zRange * this.W;
    // uZ is in units of the range; the shader compares it with z1/z2/th, same units.
    for (const m of this.slices) m.visible = true;

    // Particles: soft splats drawn from the same layers.
    const rnd = new Random(d.id.length * 7919 + Math.round(d.distPc));
    const count = d.particles ?? 32_000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    let n = 0;
    for (let guard = 0; n < count && guard < count * 60; guard++) {
      const fx = rnd.next();
      const fy = rnd.next();
      const i = Math.min(N - 1, Math.floor(fx * N));
      const j = Math.min(N - 1, Math.floor(fy * N));
      const k = j * N + i;
      const l = (px[k * 4] + px[k * 4 + 1] + px[k * 4 + 2]) / 765 / maxL;
      const edge = MathUtils.smoothstep(Math.min(fx, 1 - fx), 0, 0.12) * MathUtils.smoothstep(Math.min(fy, 1 - fy), 0, 0.12);
      if (l < 0.07 || rnd.next() > Math.pow(l, 1.3) * edge * mask[k]) continue;
      const z = (rnd.next() < 0.5 ? raw[k * 3] : raw[k * 3 + 1]) + rnd.gaussian() * raw[k * 3 + 2];
      pos.set([(fx - 0.5) * this.W, (0.5 - fy) * this.H, z * this.W], n * 3);
      const r = lin(px[k * 4]);
      const g = lin(px[k * 4 + 1]);
      const b = lin(px[k * 4 + 2]);
      const m = Math.max(r, g, b, 1e-4);
      const kk = 0.5 + 0.5 * l;
      col.set([(r / m) * kk, (g / m) * kk, (b / m) * kk], n * 3);
      size[n] = this.W * (d.particleSize ?? 1 / 90) * rnd.range(0.6, 1.4);
      n++;
    }
    const pts = makePoints(pos.subarray(0, n * 3), col.subarray(0, n * 3), size.subarray(0, n), {
      brightness: (d.particleGain ?? 0.1) * d.brightness,
      nearFade: this.W * 0.01,
      minPx: 0,
      maxPx: 40,
    });
    pts.name = `deepsky-${d.id}-gas`;
    pts.userData.base = (d.particleGain ?? 0.1) * d.brightness;
    this.particles = pts;
    this.group.add(pts);
  }

  update(ctx: DeepContext): void {
    const cam = ctx.camera.position;
    const dist = cam.distanceTo(this.position);
    const W = this.W;
    if (this.lowState === 'none' && dist < W * 2 * (this.def.visibleWidths ?? 1500)) this.loadLow();
    if (this.hiState === 'none' && dist < W * 25) this.loadHigh();
    else if (this.hiState !== 'none' && dist > W * 120) this.dropHigh();
    this.group.visible = this.lowState === 'ready' && dist < W * (this.def.visibleWidths ?? 1500);
    if (!this.group.visible) return;
    // From the Sun's side the slices carry the crisp picture; off-axis the
    // particles take over.
    // Deep inside (at a galaxy's black hole, say) the photo means nothing: fade it.
    const inside = MathUtils.smoothstep(dist, W * 0.002, W * 0.05);
    this.sliceUniforms.uIntensity.value = 0.95 * this.def.brightness * inside;
    // Particles carry the shape off-axis; from Earth's side the photo is exact.
    const facing = Math.abs(cam.clone().sub(this.position).normalize().dot(this.toSun));
    // On (or near) the Earth-side axis: depth-scaled slices line up exactly.
    const along = cam.clone().sub(this.position).dot(this.toSun);
    const onAxis = MathUtils.smoothstep(facing, 0.9, 0.99);
    this.sliceUniforms.uEye.value = along > 0 && onAxis > 0 ? along / onAxis : 0;
    if (this.discNormalLocal) {
      const k = 1 - onAxis;
      this.sliceUniforms.uZDir.value.set(0, 0, 1).lerp(this.discNormalLocal, k);
    }
    if (this.particles) this.particles.material.uniforms.uBrightness.value = (this.particles.userData.base as number) * (0.35 + 1.4 * (1 - facing)) * inside;
    this.pulsar?.update(ctx.elapsed, ctx.camera);
  }
}
