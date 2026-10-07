import {
  Group,
  NoToneMapping,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CAMERA, RENDER } from '../config/visual';
import { CameraRig } from './CameraRig';
import { FloatingOrigin } from './FloatingOrigin';
import { PostFX } from './PostFX';
import { Time } from './Time';
import type { FrameContext, Updatable } from './types';

/** Easing rate (1/s) of the panel-driven view shift. */
const VIEW_SHIFT_RATE = 6;

interface Entry {
  item: Updatable;
  priority: number;
}

/**
 * Renderer, scene graph, the single requestAnimationFrame loop (PLAN §9),
 * and resize handling.
 *
 * Scene graph:
 *   scene
 *   ├─ sky        (infinitely distant: Milky Way, point stars)
 *   └─ world      (heliocentric bodies; offset by the floating origin)
 *
 * Frame order: time → updatables (bodies) → camera rig (follow, controls,
 * origin rebase, clipping) → late updatables → post-FX → render.
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly sky = new Group();
  readonly world = new Group();
  readonly camera: PerspectiveCamera;
  readonly time = new Time();
  readonly origin: FloatingOrigin;
  readonly rig: CameraRig;
  readonly postfx: PostFX;

  private readonly updatables: Entry[] = [];
  private readonly lateUpdatables: Entry[] = [];
  private readonly ctx: FrameContext;
  private readonly frameListeners = new Set<() => void>();
  private readonly contextLostFns = new Set<() => void>();
  private rafId = 0;
  private running = false;
  private width = 1;
  private height = 1;
  private pixelRatioCap: number = RENDER.maxPixelRatio;
  /** Principal-point shift (CSS px) so the focus centres in the free area beside a panel. */
  private readonly viewShift = { x: 0, y: 0, tx: 0, ty: 0 };
  private renderScale = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // SMAA in post
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping; // done by ToneMappingEffect
    this.renderer.setClearColor(RENDER.clearColor, 1);

    this.camera = new PerspectiveCamera(RENDER.fovDeg, 1, RENDER.minNear, RENDER.far);
    this.scene.add(this.sky, this.world, this.camera);
    this.sky.name = 'sky';
    this.world.name = 'world';

    this.origin = new FloatingOrigin(this.world, CAMERA.originRebaseDistance);
    this.rig = new CameraRig(this.camera, canvas, this.origin);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);

    this.ctx = {
      time: this.time,
      camera: this.camera,
      cameraPosition: this.camera.position,
      viewportHeight: 1,
      pixelRatio: this.renderer.getPixelRatio(),
    };

    // GPU reset / driver crash: stop drawing; a restore reloads the page,
    // the only way to rebuild every custom texture and render target safely.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
      this.contextLostFns.forEach((fn) => fn());
    });
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  /** Register a per-frame update. Lower priority runs first. */
  add(item: Updatable, priority = 0): void {
    this.updatables.push({ item, priority });
    this.updatables.sort((a, b) => a.priority - b.priority);
  }

  /** Updates that need the final camera of this frame (billboards, flare). */
  addLate(item: Updatable, priority = 0): void {
    this.lateUpdatables.push({ item, priority });
    this.lateUpdatables.sort((a, b) => a.priority - b.priority);
  }

  /** Called after each rendered frame (stats, tests). */
  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  onContextLost(fn: () => void): () => void {
    this.contextLostFns.add(fn);
    return () => this.contextLostFns.delete(fn);
  }

  /** Render-space → absolute (heliocentric) position. */
  toAbsolute(render: Vector3, out = new Vector3()): Vector3 {
    return this.origin.toAbsolute(render, out);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /**
   * Which scene the frame shows: the solar scene (default) or another view
   * with its own camera (the galaxy). Post-processing follows.
   */
  setView(scene: Scene = this.scene, camera: PerspectiveCamera = this.camera): void {
    this.postfx.composer.setMainScene(scene);
    this.postfx.composer.setMainCamera(camera);
  }

  /** Render one frame synchronously (used to warm up shaders under the loader). */
  renderOnce(): void {
    this.frame(performance.now());
  }

  private frame(now: number): void {
    this.time.tick(now);
    const ctx = this.ctx;

    for (const e of this.updatables) e.item.update(ctx);

    this.rig.update();
    this.applyViewShift();
    this.camera.updateMatrixWorld();

    for (const e of this.lateUpdatables) e.item.update(ctx);

    this.postfx.update(ctx);
    this.postfx.render(this.time.delta);

    this.frameListeners.forEach((fn) => fn());
  }

  /**
   * Shift the image centre by (x, y) CSS px — e.g. half the info panel's width
   * — so the focused body sits in the middle of the uncovered area.
   * Eased over a few frames; the projection includes it, so picking, labels
   * and the lens flare stay consistent.
   */
  setViewShift(x: number, y: number): void {
    this.viewShift.tx = x;
    this.viewShift.ty = y;
  }

  private applyViewShift(force = false): void {
    const v = this.viewShift;
    if (!force && v.x === v.tx && v.y === v.ty) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const k = reduce ? 1 : 1 - Math.exp(-this.time.delta * VIEW_SHIFT_RATE);
    v.x += (v.tx - v.x) * k;
    v.y += (v.ty - v.y) * k;
    if (Math.abs(v.tx - v.x) < 0.5) v.x = v.tx;
    if (Math.abs(v.ty - v.y) < 0.5) v.y = v.ty;
    if (v.x === 0 && v.y === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(this.width, this.height, v.x, v.y, this.width, this.height);
  }

  /** Quality presets: cap on devicePixelRatio and fraction of it to render at. */
  setResolution(pixelRatioCap: number, renderScale: number): void {
    this.pixelRatioCap = pixelRatioCap;
    this.renderScale = renderScale;
    this.resize(true);
  }

  private resize(force = false): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    if (!force && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio, this.pixelRatioCap) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.postfx.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyViewShift(true);
    this.ctx.viewportHeight = h * pr;
    this.ctx.pixelRatio = pr;
  }
}
