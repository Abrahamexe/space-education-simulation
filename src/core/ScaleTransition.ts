import gsap from 'gsap';
import { scale, type ScaleMode } from './scale';
import type { Updatable } from './types';

const DURATION_S = 3.2;
const DURATION_REDUCED_S = 0.8;

/**
 * Animated switch between cinematic and true scale (PLAN §3.1). The scale
 * system blends sizes and distances in log space, so moving its blend
 * factor glides every body, orbit and belt smoothly; the camera rig keeps
 * the focused body framed by following its radius. Advanced from the engine
 * frame on wall-clock time, so it always finishes on schedule.
 */
export class ScaleTransition implements Updatable {
  private target: ScaleMode = scale.mode;
  private anim: { from: number; to: number; start: number; duration: number; ease: (t: number) => number } | null =
    null;
  private readonly listeners = new Set<(mode: ScaleMode) => void>();

  get mode(): ScaleMode {
    return this.target;
  }

  get animating(): boolean {
    return this.anim !== null;
  }

  set(mode: ScaleMode): void {
    if (mode === this.target) return;
    this.target = mode;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.anim = {
      from: scale.blend,
      to: mode === 'real' ? 1 : 0,
      start: performance.now(),
      duration: (reduce ? DURATION_REDUCED_S : DURATION_S) * 1000,
      ease: gsap.parseEase(reduce ? 'sine.inOut' : 'power2.inOut'),
    };
    this.listeners.forEach((fn) => fn(mode));
  }

  toggle(): void {
    this.set(this.target === 'real' ? 'cinematic' : 'real');
  }

  onChange(fn: (mode: ScaleMode) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(): void {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, (performance.now() - a.start) / a.duration);
    scale.setBlend(a.from + (a.to - a.from) * a.ease(t));
    if (t >= 1) this.anim = null;
  }
}
