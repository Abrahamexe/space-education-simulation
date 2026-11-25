import { Color, HalfFloatType, NoToneMapping, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import './stage.css';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BlendFunction, BloomEffect, EffectComposer, EffectPass, NoiseEffect, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { QUALITY_PRESETS, type QualityLevel } from '../../../config/quality';
import { SanitizeEffect } from '../../../core/effects/SanitizeEffect';
import { holdMainRender, mainQuality } from '../gate';
import { BG } from './palette';

type Update = (dt: number, time: number) => void;

/**
 * A self-contained 3D view for the dark-matter scenes (lab cards and the film): its own renderer,
 * camera, orbit controls and a cinematic post chain (sanitize → bloom → ACES → vignette → grain).
 * While started it holds the main engine stopped (gate.ts), so only one heavy scene renders.
 */
export class Stage {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly updates = new Set<Update>();
  private readonly ro: ResizeObserver;
  private readonly level: QualityLevel;
  private raf = 0;
  private last = 0;
  private time = 0;
  private release: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    opts: { level?: QualityLevel; fov?: number } = {},
  ) {
    this.level = opts.level ?? mainQuality();
    const q = QUALITY_PRESETS[this.level];
    this.renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: false });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.setClearColor(new Color(BG), 1);
    this.renderer.domElement.className = 'dm-stage-canvas';
    host.classList.add('dm-stage');
    host.appendChild(this.renderer.domElement);
    this.scene.background = new Color(BG);

    this.camera = new PerspectiveCamera(opts.fov ?? 45, 16 / 9, 0.01, 200);
    this.camera.position.set(0, 1.3, 5.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 16;
    this.controls.target.set(0, 0, 0);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.55, luminanceSmoothing: 0.4, intensity: 0.9, radius: 0.75, levels: q.bloomLevels });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    noise.blendMode.opacity.value = 0.035 * 4;
    this.composer.addPass(
      new EffectPass(
        this.camera,
        new SanitizeEffect(),
        bloom,
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
        new VignetteEffect({ darkness: 0.55, offset: 0.3 }),
        noise,
      ),
    );

    if (import.meta.env.DEV) (window as unknown as { __dmStage?: Stage }).__dmStage = this;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  /** Called every frame while started, before rendering. Returns an unsubscribe function. */
  onUpdate(fn: Update): () => void {
    this.updates.add(fn);
    return () => this.updates.delete(fn);
  }

  get running(): boolean {
    return this.raf !== 0;
  }

  start(): void {
    if (this.disposed || this.raf) return;
    this.release ??= holdMainRender();
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.time += dt;
      for (const fn of this.updates) fn(dt, this.time);
      this.render(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.release?.();
    this.release = null;
  }

  render(dt = 0): void {
    this.controls.update(dt);
    this.composer.render(dt);
  }

  /**
   * Fills the window; Esc leaves. The host moves to <body> meanwhile (a placeholder keeps its
   * place): inside the lab panel a fixed box would be clipped by the panel's zoom/transform.
   */
  setFullscreen(on: boolean): void {
    if (on === this.fullscreen) return;
    if (on) {
      this.host.replaceWith(this.placeholder);
      document.body.appendChild(this.host);
      document.addEventListener('keydown', this.onKey);
    } else {
      this.placeholder.replaceWith(this.host);
      document.removeEventListener('keydown', this.onKey);
    }
    this.host.classList.toggle('dm-stage-full', on);
    this.onFullscreen?.(on);
    this.resize();
  }

  /** Told when fullscreen changes (also by Esc). */
  onFullscreen: ((on: boolean) => void) | null = null;
  private readonly placeholder = document.createComment('dm-stage');

  get fullscreen(): boolean {
    return this.host.classList.contains('dm-stage-full');
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.setFullscreen(false);
    }
  };

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.raf && !this.disposed) this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.setFullscreen(false);
    this.stop();
    this.disposed = true;
    document.removeEventListener('keydown', this.onKey);
    this.ro.disconnect();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.host.classList.remove('dm-stage', 'dm-stage-full');
  }
}
