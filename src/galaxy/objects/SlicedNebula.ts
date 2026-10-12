import {
  AdditiveBlending,
  DataTexture,
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
import type { NebulaDef } from '../../config/deepsky';
import type { Loader } from '../../core/Loader';
import { equatorialToScene } from '../../physics/frames';
import { makePoints } from '../GalaxyModel';
import { DEG, skyFrame, type BlackHoleInfo, type DeepContext, type DeepObject, type DeepTarget, type StarPoints } from './common';
import { makeGlow } from './StarGlow';
import { PulsarBeams } from './PulsarBeams';
import { DetailWindow } from './DetailWindow';
import { buildNebula, type NebulaBuildInput, type NebulaBuildOutput } from './nebulaBuild';

const SLICES = 16;
const DEPTH_N = 512;

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
  /** Full-resolution tiles streamed in up close (when built: npm run hires). */
  private readonly detail: DetailWindow;
  /** Depth map built (slices may show). */
  private depthReady = false;

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
    this.detail = new DetailWindow(loader.renderer, def.image, this.W, this.H);
    this.sliceUniforms = {
      ...this.detail.uniforms,
      uMap: { value: null as Texture | null },
      uDepth: { value: null as Texture | null },
      uIntensity: { value: 0.95 * def.brightness },
      uZRange: { value: 1 },
      uZDir: { value: new Vector3(0, 0, 1) },
      uEye: { value: 0 },
      uAnchor: { value: anchorLocal },
      uCollapse: { value: 0 },
      // Slices fade at grazing views; a tilted disc is seen at a grazing angle
      // even from Earth, so it fades only when nearly edge-on.
      uFacing: { value: def.depth.model === 'disc' ? new Vector2(0.02, 0.1) : new Vector2(0.5, 0.88) },
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

  /**
   * Fetch (and decode) now what update() would ask for seen from `from`,
   * so entering the galaxy finds the pictures ready instead of loading them
   * over the first seconds.
   */
  preload(from: Vector3): Promise<void> {
    const dist = from.distanceTo(this.position);
    const W = this.W;
    const jobs: Promise<void>[] = [];
    if (this.lowState === 'none' && dist < W * 2 * (this.def.visibleWidths ?? 1500)) jobs.push(this.loadLow());
    if (this.hiState === 'none' && dist < W * 25) jobs.push(this.loadHigh());
    return Promise.all(jobs).then(() => undefined);
  }

  private loadLow(): Promise<void> {
    this.lowState = 'loading';
    return this.loader
      .loadDeferred(`textures/${this.def.folder ?? 'deepsky'}/${this.def.image}_1k.jpg`)
      .then((t) => {
        this.lowTex = t;
        this.buildFromImage(t.image as CanvasImageSource);
        if (this.hiState !== 'ready') this.sliceUniforms.uMap.value = t;
        this.lowState = 'ready';
      })
      .catch(() => {
        this.lowState = 'none';
      });
  }

  private loadHigh(): Promise<void> {
    this.hiState = 'loading';
    return this.loader
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
      .catch(() => {
        this.hiState = 'none';
      });
  }

  private dropHigh(): void {
    if (this.hiTex) this.hiTex.dispose();
    this.hiTex = null;
    this.hiState = 'none';
    this.sliceUniforms.uMap.value = this.lowTex;
    this.detail.dispose();
  }

  /** Depth map and particles from the 1K picture (computed in a worker). */
  private buildFromImage(image: CanvasImageSource): void {
    const d = this.def;
    const N = DEPTH_N;
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const g2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!g2d) return;
    g2d.drawImage(image, 0, 0, N, N);
    const input: NebulaBuildInput = {
      px: g2d.getImageData(0, 0, N, N).data,
      N,
      slices: SLICES,
      depth: d.depth,
      ax: this.ax,
      ay: this.ay,
      aspect: d.aspect,
      W: this.W,
      H: this.H,
      seed: d.id.length * 7919 + Math.round(d.distPc),
      count: d.particles ?? 120_000,
      particleSize: d.particleSize ?? 1 / 160,
    };
    void buildNebula(input).then((out) => this.applyBuild(out));
  }

  private applyBuild(out: NebulaBuildOutput): void {
    const d = this.def;
    const N = DEPTH_N;
    const depthTex = new DataTexture(out.depth, N, N, RGBAFormat, HalfFloatType);
    depthTex.minFilter = LinearFilter;
    depthTex.magFilter = LinearFilter;
    depthTex.needsUpdate = true;
    this.sliceUniforms.uDepth.value = depthTex;
    this.sliceUniforms.uZRange.value = out.zRange * this.W;
    // uZ is in units of the range; the shader compares it with z1/z2/th, same units.
    for (const m of this.slices) m.visible = true;
    this.depthReady = true;

    // Many fine splats read as gas from the side; a few large ones as blobs.
    const pts = makePoints(out.pos, out.col, out.size, {
      brightness: (d.particleGain ?? 0.12) * d.brightness,
      nearFade: this.W * 0.01,
      minPx: 0,
      maxPx: 40,
    });
    pts.name = `deepsky-${d.id}-gas`;
    pts.userData.base = (d.particleGain ?? 0.12) * d.brightness;
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
    // Exactly on axis the stack collapses onto one slice (slice.frag sums the weights).
    const collapse = onAxis >= 0.999 && along > 0;
    this.sliceUniforms.uCollapse.value = collapse ? 1 : 0;
    if (this.depthReady) this.slices.forEach((m, i) => (m.visible = !collapse || i === SLICES / 2));
    if (this.discNormalLocal) {
      const k = 1 - onAxis;
      this.sliceUniforms.uZDir.value.set(0, 0, 1).lerp(this.discNormalLocal, k);
    }
    // Seen from Earth's side the photograph is exact and the particles only
    // add grain: they fade in as the view turns away from that axis.
    const offAxis = 1 - MathUtils.smoothstep(facing, 0.8, 0.97);
    if (this.particles) {
      const pts = this.particles;
      const b = (pts.userData.base as number) * 1.75 * (1 - facing) * offAxis * inside;
      // Off (on the Earth-side axis, say): skip the 120k vertices altogether.
      pts.visible = b > 1e-5;
      // Small on screen: a random subset (samples are in random order) carries
      // the same light; the full cloud only when it spans ~600 px.
      const count = pts.geometry.getAttribute('position').count;
      const px = (W / Math.max(dist, 1e-9)) * (window.innerHeight / 2) / Math.tan(MathUtils.degToRad(ctx.camera.fov) / 2);
      const n = Math.min(count, Math.max(6000, Math.round(count * (px / 600) ** 2)));
      pts.geometry.setDrawRange(0, n);
      pts.material.uniforms.uBrightness.value = b * (count / n);
    }
    if (this.hiState === 'ready') this.detail.update(ctx.camera, this.group, ctx.dt);
    this.pulsar?.update(ctx.elapsed, ctx.camera);
  }
}
