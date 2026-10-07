import type { PerspectiveCamera, Vector3 } from 'three';
import type { Time } from './Time';

/** Everything a per-frame update may need. */
export interface FrameContext {
  time: Time;
  camera: PerspectiveCamera;
  /** Render-space camera position (same as camera.position). */
  cameraPosition: Vector3;
  /** Drawing-buffer height in device pixels (for pixel-size maths). */
  viewportHeight: number;
  pixelRatio: number;
}

export interface Updatable {
  update(ctx: FrameContext): void;
}

/** Something the camera can orbit and follow. */
export interface Focusable {
  /** Absolute (heliocentric) scene position. */
  getAbsolutePosition(out: Vector3): Vector3;
  /** Physical radius in scene units (for min distance / near plane). */
  getRadius(): number;
  /**
   * Radius of everything worth looking at, when larger than the body itself
   * (an active comet's coma and tail). Framing and the free-camera release
   * use it; defaults to getRadius().
   */
  getViewRadius?(): number;
}
