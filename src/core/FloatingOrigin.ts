import { Group, Vector3 } from 'three';

/**
 * Floating origin (PLAN §3.2).
 *
 * All celestial bodies live under `world`, positioned in absolute
 * heliocentric scene units (JS doubles). The GPU only ever sees float32, so
 * far from (0,0,0) world-space shader maths starts to jitter. To prevent
 * that, the render-space origin follows the camera's focus: `world` is
 * offset by -origin, and the camera is shifted by the same amount whenever
 * the focus drifts more than `threshold` away from (0,0,0).
 *
 * absolute = render + origin
 */
export class FloatingOrigin {
  /** Absolute coordinates of the render-space origin. */
  readonly origin = new Vector3();

  private readonly listeners = new Set<(delta: Vector3) => void>();
  private readonly tmp = new Vector3();

  constructor(
    readonly world: Group,
    public threshold: number,
  ) {}

  toRender(absolute: Vector3, out = new Vector3()): Vector3 {
    return out.copy(absolute).sub(this.origin);
  }

  toAbsolute(render: Vector3, out = new Vector3()): Vector3 {
    return out.copy(render).add(this.origin);
  }

  /**
   * Re-centre if `focusRender` (a render-space point, usually the orbit
   * target) is too far from the origin. Returns true if a shift happened.
   */
  maybeRebase(focusRender: Vector3): boolean {
    if (focusRender.lengthSq() < this.threshold * this.threshold) return false;
    this.shift(this.tmp.copy(focusRender));
    return true;
  }

  /** Move the origin by `delta` (render-space), notifying listeners. */
  shift(delta: Vector3): void {
    const d = delta.clone();
    this.origin.add(d);
    this.world.position.copy(this.origin).negate();
    this.world.updateMatrixWorld(true);
    this.listeners.forEach((fn) => fn(d));
  }

  /** Listeners must subtract `delta` from anything stored in render space. */
  onShift(fn: (delta: Vector3) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
