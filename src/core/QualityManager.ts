import { QUALITY_ORDER, QUALITY_PRESETS, type QualityLevel } from '../config/quality';
import { runtime } from '../config/runtime';
import type { SolarSystem } from '../bodies/SolarSystem';
import type { Starfield } from '../bodies/Starfield';
import type { Engine } from './Engine';

/** Frame-time governor: window length and the FPS it defends. */
const WINDOW_MS = 3000;
const MIN_FPS = 40;
const STRIKES_TO_DROP = 2;
/** Ignore the first seconds (shader compile, texture uploads, intro). */
const WARMUP_MS = 12000;
/**
 * A gap this long between frames is not rendering cost: the tab was hidden,
 * the window lost focus and got throttled, or a texture was decoding. A
 * window containing one says nothing about the device, so it is discarded.
 */
const STALL_MS = 200;

type Listener = (level: QualityLevel, reason: 'user' | 'auto') => void;

/**
 * Quality levels (PLAN §9): render resolution, bloom depth, belt and star
 * counts, high-resolution textures. Picks a starting level from a quick
 * device heuristic, and — while "auto" is on — steps down one level when
 * the frame rate stays below MIN_FPS. It never steps up on its own, which
 * would make the image pump between levels.
 */
export class QualityManager {
  private _level: QualityLevel;
  auto = true;
  private readonly listeners = new Set<Listener>();
  private frames = 0;
  private windowStart = performance.now();
  private strikes = 0;
  private readonly startedAt = performance.now();
  private lastFrame = performance.now();
  private stalled = false;

  constructor(
    private readonly engine: Engine,
    private readonly system: SolarSystem,
    private readonly starfield: Starfield,
  ) {
    this._level = QualityManager.detect(engine);
    this.apply(this._level);
    engine.onFrame(() => this.sample());
  }

  /** Coarse device guess: mobile and integrated GPUs start one or two notches lower. */
  static detect(engine: Engine): QualityLevel {
    const gl = engine.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '').toLowerCase();
    const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    if (mobile || mem <= 4 || /mali|adreno|powervr|apple gpu/.test(gpu)) return 'low';
    if (/intel|swiftshader|llvmpipe|basic render/.test(gpu)) return 'medium';
    return 'high';
  }

  get level(): QualityLevel {
    return this._level;
  }

  set(level: QualityLevel, reason: 'user' | 'auto' = 'user'): void {
    if (level === this._level) return;
    this._level = level;
    this.apply(level);
    this.strikes = 0;
    this.listeners.forEach((fn) => fn(level, reason));
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private apply(level: QualityLevel): void {
    const q = QUALITY_PRESETS[level];
    this.engine.setResolution(q.pixelRatio, q.renderScale);
    this.engine.postfx.setBloomLevels(q.bloomLevels);
    this.engine.postfx.setAntialias(q.antialias);
    this.engine.postfx.blackHole.stepScale = q.lensStep;
    this.system.applyQuality(level);
    this.starfield.setStarCount(q.stars);
    runtime.highResTextures = q.highResTextures;
  }

  private sample(): void {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFrame > STALL_MS) this.stalled = true;
    this.lastFrame = now;
    const span = now - this.windowStart;
    if (span < WINDOW_MS) return;
    const fps = (this.frames * 1000) / span;
    this.frames = 0;
    this.windowStart = now;
    const stalled = this.stalled;
    this.stalled = false;
    // Hidden tabs and throttled windows are not slow devices.
    if (!this.auto || stalled || document.hidden || now - this.startedAt < WARMUP_MS || fps < 5) return;
    this.strikes = fps < MIN_FPS ? this.strikes + 1 : 0;
    if (this.strikes >= STRIKES_TO_DROP) {
      const i = QUALITY_ORDER.indexOf(this._level);
      if (i > 0) this.set(QUALITY_ORDER[i - 1], 'auto');
      this.strikes = 0;
    }
  }
}
