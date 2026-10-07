import { MathUtils, MOUSE, PerspectiveCamera, Plane, Quaternion, Ray, TOUCH, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import gsap from 'gsap';
import { CAMERA, INTERACTION, RENDER } from '../config/visual';
import type { FloatingOrigin } from './FloatingOrigin';
import type { Focusable } from './types';

/** Spherical camera placement around a focus, angles in radians. */
export interface OrbitPose {
  distance: number;
  azimuth: number;
  elevation: number;
}

function poseToOffset(p: OrbitPose, out: Vector3): Vector3 {
  const ce = Math.cos(p.elevation);
  return out.set(
    p.distance * ce * Math.sin(p.azimuth),
    p.distance * Math.sin(p.elevation),
    p.distance * ce * Math.cos(p.azimuth),
  );
}

export function directionToPose(dir: Vector3, distance: number): OrbitPose {
  const d = dir.clone().normalize();
  return {
    distance,
    azimuth: Math.atan2(d.x, d.z),
    elevation: Math.asin(MathUtils.clamp(d.y, -1, 1)),
  };
}

/**
 * Optimal zoom-and-pan path (van Wijk & Nuij, "Smooth and efficient zooming
 * and panning", InfoVis 2003). From view width w0 to w1 across a pan of u1:
 * `at(s)` gives the pan covered and the view width at path parameter
 * s ∈ [0, S]. rho trades zooming against panning (√2 is the paper's
 * comfortable default; larger pulls back further). asinh keeps it exact for
 * pans millions of view widths long.
 */
export function zoomPanPath(w0: number, w1: number, u1: number, rho: number) {
  const r2 = rho * rho;
  if (u1 < 1e-9 * Math.max(w0, w1)) {
    // Pure zoom.
    const k = Math.sign(w1 - w0);
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    return {
      S,
      u1: 0,
      at: (s: number, out: [number, number]) => ((out[0] = 0), (out[1] = w0 * Math.exp(k * rho * s)), out),
    };
  }
  const b0 = (w1 * w1 - w0 * w0 + r2 * r2 * u1 * u1) / (2 * w0 * r2 * u1);
  const b1 = (w1 * w1 - w0 * w0 - r2 * r2 * u1 * u1) / (2 * w1 * r2 * u1);
  const r0 = -Math.asinh(b0);
  const r1 = -Math.asinh(b1);
  const c0 = Math.cosh(r0);
  const s0 = Math.sinh(r0);
  return {
    S: (r1 - r0) / rho,
    u1,
    at: (s: number, out: [number, number]) => {
      const x = rho * s + r0;
      out[0] = (w0 / r2) * (c0 * Math.tanh(x) - s0);
      out[1] = (w0 * c0) / Math.cosh(x);
      return out;
    },
  };
}

/** A scripted camera move, advanced by the engine's frame loop. */
interface Animation {
  start: number;
  duration: number;
  ease: (t: number) => number;
  step: (eased: number, raw: number) => void;
  done: () => void;
}

export interface FlyOptions {
  /** Final camera distance from the body's centre (scene units). */
  distance: number;
  /** Final direction from the body to the camera (render-space, unit). */
  direction: Vector3;
  /** Seconds; computed from the travel when omitted. */
  duration?: number;
  /** 0 = plain retarget without the lift and FOV kick. */
  arc?: number;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const FREE = CAMERA.free;
const GRAB_VELOCITY_WINDOW_MS = 100;
/** Free flight keys (physical positions) → camera-space directions. R/F: up/down (E is the labels toggle). */
const FLY_KEYS: Record<string, readonly [number, number, number]> = {
  KeyW: [0, 0, -1],
  KeyS: [0, 0, 1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyR: [0, 1, 0],
  KeyF: [0, -1, 0],
};

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/**
 * Owns the camera (PLAN §6): orbit controls with damping, smooth logarithmic
 * zoom (wheel and pinch) towards the focus, following a moving focus body,
 * dynamic near plane, and scripted flights. All scripted motion is advanced
 * inside the engine frame (not GSAP's ticker) so it stays in lock-step with
 * body motion and floating-origin rebases, and any user input interrupts it.
 *
 * Two modes. Focused: the camera orbits and follows a body; the wheel zooms
 * towards it. Free (no focus): entered when the body shrinks to a few
 * pixels or a flight key is pressed. The wheel then flies towards the point
 * under the cursor and W A S D / R F move the camera; both are scaled by the
 * distance to the nearest body surface. Clicking a body focuses it again.
 *
 * Free camera ("Serbest", map mode) is mouse-only and works on what is under
 * the cursor, as 3D viewers like Sketchfab and SketchUp do: left drag on a
 * body turns the view round that body, left drag on empty sky turns the view
 * itself (the sky stays under the cursor), right drag slides the scene, the
 * wheel flies towards the cursor in steps of the distance left to the body
 * there, a click selects and a double click flies. Turns keep their momentum.
 */
export class CameraRig {
  readonly controls: OrbitControls;
  private focus: Focusable | null = null;
  private readonly focusRender = new Vector3();
  private readonly lastFocusRender = new Vector3();
  private anim: Animation | null = null;
  private zoomTargetLog: number | null = null;
  private lastUpdate = performance.now();
  private readonly baseFov: number;
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly pinch = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private readonly interruptFns = new Set<() => void>();
  /** Focus radius last frame: the scale transition grows/shrinks bodies. */
  private lastFocusRadius = 0;
  /** Distance from a render-space point to the nearest body surface (set by the app). */
  private surfaceQuery: ((renderPos: Vector3) => number) | null = null;
  /** Free mode: wheel travel still to apply (log units) and its direction. */
  private freeZoomLog = 0;
  private readonly freeZoomDir = new Vector3(0, 0, -1);
  private readonly flyKeys = new Set<string>();
  private flyBoost = false;
  private readonly releaseFns = new Set<() => void>();
  /** Map mode: left drag grabs the scene and slides it, nothing is followed. */
  private mapModeFlag = false;
  private readonly mapModeFns = new Set<(on: boolean) => void>();
  private grab: { id: number; plane: Plane; point: Vector3; lastT: number } | null = null;
  /** Free camera left drag: turning round `pivot` (a body), or the view itself (null). */
  private turn: { id: number; x: number; y: number; pivot: Focusable | null; lastT: number; samples: { t: number; yaw: number; pitch: number }[] } | null = null;
  /** Turn momentum after letting go (rad/s). */
  private readonly spin = { yaw: 0, pitch: 0, pivot: null as Focusable | null };
  /** Body the wheel is flying towards (its surface sets the step). */
  private zoomBody: Focusable | null = null;
  /** Body under a screen point (set by the app). */
  private pickQuery: ((clientX: number, clientY: number) => Focusable | null) | null = null;
  /** Recent grab steps (time, translation), for the release velocity. */
  private grabSamples: { t: number; d: Vector3 }[] = [];
  /** Map pan inertia (render units per second). */
  private readonly panVelocity = new Vector3();
  private readonly ray = new Ray();
  /** False while another view (the galaxy) owns the screen and the input. */
  private activeFlag = true;
  /** Farthest the camera may go from the Sun (playground raises it to light-years). */
  private maxDist: number = CAMERA.maxDistance;

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly origin: FloatingOrigin,
  ) {
    this.baseFov = camera.fov;
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = CAMERA.dampingFactor;
    c.rotateSpeed = CAMERA.rotateSpeed;
    c.panSpeed = CAMERA.panSpeed;
    c.screenSpacePanning = true;
    c.maxDistance = CAMERA.maxDistance;
    c.enableZoom = false; // replaced by the smooth logarithmic zoom below
    this.controls = c;

    // Any user input cancels a scripted move immediately.
    c.addEventListener('start', () => this.interrupt());
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerdown', this.onGrabStart);
    dom.addEventListener('pointermove', this.onGrabMove);
    dom.addEventListener('pointerup', this.onGrabEnd);
    dom.addEventListener('pointercancel', this.onGrabEnd);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    origin.onShift((delta) => {
      this.camera.position.sub(delta);
      this.controls.target.sub(delta);
      this.lastFocusRender.sub(delta);
      // Keep the cached focus in the same (shifted) frame, or the near plane
      // is computed against a stale point right after a rebase.
      this.focusRender.sub(delta);
      // A drag in progress keeps hold of the same absolute point.
      if (this.grab) {
        this.grab.point.sub(delta);
        this.grab.plane.translate(this.tmpC.copy(delta).negate());
      }
    });
  }

  // ---- State ------------------------------------------------------------------------

  get isFlying(): boolean {
    return this.anim !== null;
  }

  get focusTarget(): Focusable | null {
    return this.focus;
  }

  /** Radius of the focused body (scene units), 1 if none. */
  get focusRadius(): number {
    return this.focus ? this.focus.getRadius() : 1;
  }

  /** Current camera → orbit target distance. */
  get distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** No body is being followed (free camera). */
  /** Input and camera updates on/off (off while the galaxy view is shown). */
  get active(): boolean {
    return this.activeFlag;
  }

  set active(v: boolean) {
    this.activeFlag = v;
    this.controls.enabled = v;
    if (!v) {
      this.flyKeys.clear();
      this.grab = null;
      this.panVelocity.set(0, 0, 0);
      this.freeZoomLog = 0;
      this.zoomTargetLog = null;
      this.turn = null;
      this.spin.yaw = this.spin.pitch = 0;
    }
  }

  get mapMode(): boolean {
    return this.mapModeFlag;
  }

  /**
   * Map mode (free camera, PLAN follow-up): left drag grabs the point under
   * the cursor and slides the view like a map; right drag turns the view;
   * the wheel flies towards the cursor. Nothing is followed until a flight
   * (search, navigation bar, "Yaklaş") picks a body again.
   */
  set mapMode(on: boolean) {
    if (on === this.mapModeFlag) return;
    this.mapModeFlag = on;
    const c = this.controls;
    // The free camera handles the mouse itself (touch stays with the controls).
    c.mouseButtons = on ? { LEFT: null, MIDDLE: null, RIGHT: null } : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    c.touches = on ? { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE } : { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    c.screenSpacePanning = true;
    if (on) {
      this.interrupt();
      this.release();
    }
    this.grab = null;
    this.turn = null;
    this.spin.yaw = this.spin.pitch = 0;
    this.panVelocity.set(0, 0, 0);
    this.dom.style.cursor = '';
    this.mapModeFns.forEach((fn) => fn(on));
  }

  onMapModeChange(fn: (on: boolean) => void): () => void {
    this.mapModeFns.add(fn);
    return () => this.mapModeFns.delete(fn);
  }

  get isFree(): boolean {
    return this.focus === null;
  }

  /** Called when the camera lets go of its body (zoomed far out, or flight keys). */
  onRelease(fn: () => void): () => void {
    this.releaseFns.add(fn);
    return () => this.releaseFns.delete(fn);
  }

  /** Body under a screen point (free camera pivots and wheel steps). */
  setPickQuery(fn: (clientX: number, clientY: number) => Focusable | null): void {
    this.pickQuery = fn;
  }

  /** Distance from a render-space point to the nearest body surface. */
  setSurfaceQuery(fn: (renderPos: Vector3) => number): void {
    this.surfaceQuery = fn;
  }

  /** Stop following the focus; the orbit pivot stays where it is. */
  release(): void {
    if (!this.focus) return;
    // An ongoing zoom-out carries on as free motion, straight back.
    if (this.zoomTargetLog !== null) {
      this.freeZoomLog = this.zoomTargetLog - Math.log(Math.max(this.distance, 1e-9));
      this.camera.getWorldDirection(this.freeZoomDir);
      this.zoomTargetLog = null;
    }
    this.focus = null;
    this.controls.minDistance = RENDER.minNear * 10;
    this.releaseFns.forEach((fn) => fn());
  }

  onInterrupt(fn: () => void): () => void {
    this.interruptFns.add(fn);
    return () => this.interruptFns.delete(fn);
  }

  private interrupt(): void {
    if (this.anim) {
      this.anim = null;
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
      this.lastFocusRender.copy(this.focusRender);
      this.interruptFns.forEach((fn) => fn());
    }
  }

  cancelFlight(): void {
    this.interrupt();
  }

  /** Switch the followed body without moving the camera. */
  setFocus(target: Focusable): void {
    this.focus = target;
    target.getAbsolutePosition(this.tmpA);
    this.origin.toRender(this.tmpA, this.focusRender);
    this.lastFocusRender.copy(this.focusRender);
    this.controls.target.copy(this.focusRender);
    this.controls.minDistance = target.getRadius() * CAMERA.minDistanceRadii;
    this.lastFocusRadius = target.getRadius();
  }

  /** Place the camera instantly at a pose around the focus. */
  setPose(pose: OrbitPose): void {
    poseToOffset(pose, this.tmpA);
    this.camera.position.copy(this.focusRender).add(this.tmpA);
    this.controls.target.copy(this.focusRender);
    this.camera.lookAt(this.focusRender);
  }

  // ---- Scripted motion -------------------------------------------------------------------

  private run(duration: number, ease: string, step: Animation['step']): Promise<void> {
    this.anim = null;
    this.zoomTargetLog = null;
    return new Promise((resolve) => {
      this.anim = {
        start: performance.now(),
        duration: Math.max(duration, 0.001) * 1000,
        ease: gsap.parseEase(ease),
        step,
        done: resolve,
      };
    });
  }

  /**
   * Opening shot: between two poses around the current focus. Distance in
   * log space (constant perceived speed) and angles linearly → a gentle arc.
   */
  flyPose(from: OrbitPose, to: OrbitPose, durationS: number, ease = 'power3.out'): Promise<void> {
    if (reducedMotion() || durationS <= 0) {
      this.setPose(to);
      return Promise.resolve();
    }
    const pose: OrbitPose = { ...from };
    const lf = Math.log(from.distance);
    const lt = Math.log(to.distance);
    return this.run(durationS, ease, (t) => {
      pose.distance = Math.exp(lf + (lt - lf) * t);
      pose.azimuth = from.azimuth + (to.azimuth - from.azimuth) * t;
      pose.elevation = from.elevation + (to.elevation - from.elevation) * t;
      this.setPose(pose);
    });
  }

  /**
   * Cinematic flight to a (moving) body (PLAN §6.2). The camera follows the
   * van Wijk–Nuij "smooth and efficient" zoom-and-pan path: it pulls back
   * until both ends of the trip fit in view, crosses while far away, then
   * dives in, at a constant perceived speed throughout. (A straight slide at
   * close range covers millions of km in a second and reads as a teleport.)
   * The view swings to the chosen side on the way, with a small lift and FOV
   * kick. Everything is recomputed from the body's live position each frame,
   * so orbital motion during the flight is tracked.
   */
  flyTo(target: Focusable, opts: FlyOptions): Promise<void> {
    const F = INTERACTION.flight;
    const startTargetAbs = this.origin.toAbsolute(this.controls.target, new Vector3());
    const startCamAbs = this.origin.toAbsolute(this.camera.position, new Vector3());
    const startOffset = startCamAbs.clone().sub(startTargetAbs);
    const d0 = Math.max(startOffset.length(), 1e-6);
    const dir0 = startOffset.clone().divideScalar(d0);
    const dir1 = opts.direction.clone().normalize();
    const d1 = opts.distance;
    const endAbs = target.getAbsolutePosition(new Vector3());
    const travel = endAbs.distanceTo(startTargetAbs);

    this.focus = target;
    this.controls.minDistance = target.getRadius() * CAMERA.minDistanceRadii;
    this.lastFocusRadius = target.getRadius();

    // Two separate concerns: reduced motion shortens and flattens everything;
    // arc: 0 (a plain retarget) only drops the lift and FOV kick.
    const reduce = reducedMotion();
    const straight = reduce || opts.arc === 0;
    // View width per unit of camera distance: the path works in view widths.
    const widthPerDist = 2 * Math.tan(MathUtils.degToRad(this.baseFov) / 2);
    const path = zoomPanPath(d0 * widthPerDist, d1 * widthPerDist, travel, F.rho);
    const duration = reduce ? 0.6 : (opts.duration ?? MathUtils.clamp(F.baseS + F.secondsPerS * path.S, F.minS, F.maxS));
    const up = new Vector3(0, 1, 0);
    const bodyAbs = new Vector3();
    const tAbs = new Vector3();
    const dir = new Vector3();
    const uw: [number, number] = [0, 0];

    const ease = reduce ? 'sine.inOut' : 'power2.inOut';
    return this.run(duration, ease, (e, raw) => {
      target.getAbsolutePosition(bodyAbs);
      path.at(path.S * e, uw);
      // Fraction of the way across; exactly 1 at the end even if the body moved.
      const along = raw >= 1 ? 1 : path.u1 > 0 ? MathUtils.clamp(uw[0] / path.u1, 0, 1) : e;
      tAbs.copy(startTargetAbs).lerp(bodyAbs, along);
      // Direction: spherical blend plus an upward lift peaking mid-flight.
      dir.copy(dir0).lerp(dir1, e);
      if (dir.lengthSq() < 1e-8) dir.copy(dir1);
      dir.normalize().addScaledVector(up, straight ? 0 : Math.sin(Math.PI * raw) * F.liftMax).normalize();
      const dist = raw >= 1 ? d1 : uw[1] / widthPerDist;
      this.origin.toRender(tAbs, this.controls.target);
      this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
      this.camera.lookAt(this.controls.target);
      this.camera.fov = this.baseFov + (straight ? 0 : F.fovKickDeg * Math.sin(Math.PI * raw));
      this.camera.updateProjectionMatrix();
    });
  }

  // ---- Zoom ---------------------------------------------------------------------------

  private minDistance(): number {
    return Math.max(this.controls.minDistance, RENDER.minNear * 10);
  }

  /** Is the screen point on (or close to) the followed body's disc? */
  private cursorOverFocus(clientX: number, clientY: number): boolean {
    if (!this.focus) return false;
    const toBody = this.tmpA.subVectors(this.focusRender, this.camera.position);
    const dist = toBody.length();
    const r = this.focus.getViewRadius?.() ?? this.focus.getRadius();
    if (dist <= r) return true;
    const ray = this.cursorDirection(clientX, clientY, this.tmpB);
    const sep = Math.acos(MathUtils.clamp(ray.dot(toBody.divideScalar(dist)), -1, 1));
    // Angular radius plus ~24 px of slack.
    const pxAngle = MathUtils.degToRad(this.camera.fov) / this.dom.clientHeight;
    return sep < Math.asin(r / dist) * 1.3 + 24 * pxAngle;
  }

  private zoomBy(logDelta: number, clientX?: number, clientY?: number): void {
    this.interrupt();
    // Map mode zooms towards the cursor: off the followed body, let go of it.
    if (this.focus && this.mapModeFlag && clientX !== undefined && clientY !== undefined && !this.cursorOverFocus(clientX, clientY)) {
      this.release();
      this.freeZoomLog = 0;
    }
    if (!this.focus) {
      const m = FREE.maxPendingLog;
      this.freeZoomLog = MathUtils.clamp(this.freeZoomLog + logDelta, -m, m);
      if (clientX !== undefined && clientY !== undefined) {
        this.cursorDirection(clientX, clientY, this.freeZoomDir);
        // Flying in towards a body: steps are fractions of the way left to it.
        this.zoomBody = logDelta < 0 && this.pickQuery ? this.pickQuery(clientX, clientY) : null;
      } else {
        this.camera.getWorldDirection(this.freeZoomDir);
        this.zoomBody = null;
      }
      return;
    }
    const cur = this.zoomTargetLog ?? Math.log(this.distance);
    this.zoomTargetLog = MathUtils.clamp(cur + logDelta, Math.log(this.minDistance()), Math.log(this.maxDist));
  }

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.activeFlag) return;
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.zoomBy((MathUtils.clamp(px, -250, 250) / 100) * INTERACTION.zoomStep, e.clientX, e.clientY);
  };

  // ---- Map mode: grab and slide ---------------------------------------------------------

  /** Render-space ray under a screen point. */
  private rayAt(clientX: number, clientY: number): Ray {
    this.ray.origin.copy(this.camera.position);
    this.cursorDirection(clientX, clientY, this.ray.direction);
    return this.ray;
  }

  /**
   * The surface the cursor grabs: a plane facing the camera through the
   * pivot. Dragging up and down slides the view up and down; it never
   * pulls the camera forward (an ecliptic "table" plane did, seen obliquely).
   */
  private grabPlane(): Plane {
    const normal = this.camera.getWorldDirection(this.tmpA).negate();
    return new Plane().setFromNormalAndCoplanarPoint(normal.clone(), this.controls.target);
  }

  private readonly onGrabStart = (e: PointerEvent) => {
    if (!this.activeFlag || !this.mapModeFlag || e.pointerType === 'touch') return;
    const body = this.pickQuery?.(e.clientX, e.clientY) ?? null;
    if (e.button === 0) {
      this.interrupt();
      this.spin.yaw = this.spin.pitch = 0;
      this.panVelocity.set(0, 0, 0);
      this.turn = { id: e.pointerId, x: e.clientX, y: e.clientY, pivot: body, lastT: performance.now(), samples: [] };
      return;
    }
    if (e.button !== 2) return;
    // Right drag grabs the point under the cursor, at the depth of the body there.
    let plane = this.grabPlane();
    if (body) {
      const c = this.origin.toRender(body.getAbsolutePosition(this.tmpA), this.tmpA);
      plane = new Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(this.tmpB).negate().clone(), c);
    }
    const point = this.rayAt(e.clientX, e.clientY).intersectPlane(plane, new Vector3());
    if (!point) return;
    this.interrupt();
    this.grab = { id: e.pointerId, plane, point, lastT: performance.now() };
    this.grabSamples = [];
    this.panVelocity.set(0, 0, 0);
    this.dom.style.cursor = 'grabbing';
  };

  private readonly onGrabMove = (e: PointerEvent) => {
    const tr = this.turn;
    if (tr && e.pointerId === tr.id) {
      const dx = e.clientX - tr.x;
      const dy = e.clientY - tr.y;
      if (dx === 0 && dy === 0) return;
      // A press that has not moved yet may still be a click.
      if (!tr.samples.length && Math.hypot(dx, dy) < 3) return;
      tr.x = e.clientX;
      tr.y = e.clientY;
      this.dom.style.cursor = 'grabbing';
      // Round a body: half a turn per screen height. The view itself: the sky sticks to the cursor.
      const k = tr.pivot ? Math.PI / this.dom.clientHeight : MathUtils.degToRad(this.camera.fov) / this.dom.clientHeight;
      const yaw = dx * k;
      const pitch = dy * k;
      this.turnBy(yaw, pitch, tr.pivot);
      const now = performance.now();
      tr.lastT = now;
      tr.samples.push({ t: now, yaw, pitch });
      while (tr.samples.length > 1 && now - tr.samples[0].t > GRAB_VELOCITY_WINDOW_MS) tr.samples.shift();
      return;
    }
    const g = this.grab;
    if (!g || e.pointerId !== g.id) return;
    const hit = this.rayAt(e.clientX, e.clientY).intersectPlane(g.plane, this.tmpC);
    if (!hit) return;
    // The first real move lets go of a followed body.
    if (this.focus) this.release();
    const delta = this.tmpA.subVectors(g.point, hit);
    // Never jump to the horizon on a grazing ray.
    const maxStep = this.camera.position.distanceTo(this.controls.target) * 0.5;
    if (delta.length() > maxStep) delta.setLength(maxStep);
    this.translate(delta, 1);
    const now = performance.now();
    g.lastT = now;
    this.grabSamples.push({ t: now, d: delta.clone() });
    while (this.grabSamples.length > 1 && now - this.grabSamples[0].t > GRAB_VELOCITY_WINDOW_MS) this.grabSamples.shift();
  };

  private readonly onGrabEnd = (e: PointerEvent) => {
    const tr = this.turn;
    if (tr && e.pointerId === tr.id) {
      this.turn = null;
      const now = performance.now();
      const recent = tr.samples.filter((s) => now - s.t <= GRAB_VELOCITY_WINDOW_MS);
      this.spin.yaw = this.spin.pitch = 0;
      if (recent.length > 1 && now - tr.lastT < 80) {
        const span = Math.max((now - recent[0].t) / 1000, 0.016);
        for (const s of recent.slice(1)) {
          this.spin.yaw += s.yaw / span;
          this.spin.pitch += s.pitch / span;
        }
        this.spin.pivot = tr.pivot;
      }
      this.dom.style.cursor = '';
      return;
    }
    const g = this.grab;
    if (!g || e.pointerId !== g.id) return;
    this.grab = null;
    // Release velocity: travel over the last ~100 ms (robust to any mouse
    // polling rate). A pause before letting go means "stop here".
    const now = performance.now();
    const recent = this.grabSamples.filter((s) => now - s.t <= GRAB_VELOCITY_WINDOW_MS);
    this.panVelocity.set(0, 0, 0);
    if (recent.length > 1 && now - g.lastT < 80) {
      const span = Math.max((now - recent[0].t) / 1000, 0.016);
      for (const s of recent.slice(1)) this.panVelocity.add(s.d);
      this.panVelocity.divideScalar(span);
    }
    this.grabSamples = [];
    this.dom.style.cursor = '';
  };

  /**
   * Turn the free camera by a drag. With a pivot body the camera swings
   * round it (the body stays where it is on screen, its far side comes
   * into view); without one the camera turns where it stands. Up stays up
   * (the ecliptic north) and the view never tips over the poles.
   */
  private turnBy(yaw: number, pitch: number, pivot: Focusable | null): void {
    const up = this.camera.up;
    const fwd = this.camera.getWorldDirection(this.tmpA);
    const right = this.tmpB.crossVectors(fwd, up);
    if (right.lengthSq() < 1e-12) right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.normalize();
    const LIMIT = 1.5;
    const q = new Quaternion();
    const qp = new Quaternion();
    if (pivot) {
      // A body other than the followed one: stop following.
      if (this.focus && this.focus !== pivot) this.release();
      const p = this.origin.toRender(pivot.getAbsolutePosition(this.tmpC), this.tmpC);
      const off = this.camera.position.clone().sub(p);
      const elev = Math.asin(MathUtils.clamp(off.clone().normalize().dot(up), -1, 1));
      const b = MathUtils.clamp(pitch, -LIMIT - elev, LIMIT - elev);
      q.setFromAxisAngle(up, -yaw).multiply(qp.setFromAxisAngle(right, -b));
      off.applyQuaternion(q);
      this.camera.position.copy(p).add(off);
      fwd.applyQuaternion(q);
    } else {
      if (this.focus) this.release();
      const elev = Math.asin(MathUtils.clamp(fwd.dot(up), -1, 1));
      const b = MathUtils.clamp(pitch, -LIMIT - elev, LIMIT - elev);
      q.setFromAxisAngle(up, yaw).multiply(qp.setFromAxisAngle(right, b));
      fwd.applyQuaternion(q);
    }
    if (pivot && pivot === this.focus) {
      // The followed body stays the orbit target (wherever it sits on screen).
      this.controls.target.copy(this.tmpC);
      this.camera.quaternion.premultiply(q);
      return;
    }
    const reach = pivot ? this.camera.position.distanceTo(this.tmpC) : Math.max(this.distance, RENDER.minNear * 100);
    this.controls.target.copy(this.camera.position).addScaledVector(fwd, reach);
    this.camera.lookAt(this.controls.target);
  }

  /** Turn momentum after a flick, decaying. */
  private applySpin(dt: number): void {
    if (this.turn || (this.spin.yaw === 0 && this.spin.pitch === 0)) return;
    this.turnBy(this.spin.yaw * dt, this.spin.pitch * dt, this.spin.pivot);
    const k = Math.exp(-dt * CAMERA.map.glideDecay);
    this.spin.yaw *= k;
    this.spin.pitch *= k;
    if (Math.abs(this.spin.yaw) + Math.abs(this.spin.pitch) < 1e-3) this.spin.yaw = this.spin.pitch = 0;
  }

  /** Glide after a throw, decaying like a map. */
  private applyPanInertia(dt: number): void {
    if (this.grab || this.panVelocity.lengthSq() === 0) return;
    this.translate(this.tmpA.copy(this.panVelocity), dt);
    this.panVelocity.multiplyScalar(Math.exp(-dt * CAMERA.map.glideDecay));
    if (this.panVelocity.length() * 0.05 < RENDER.minNear) this.panVelocity.set(0, 0, 0);
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch.size === 2) this.pinchDist = this.pinchSpan();
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !this.pinch.has(e.pointerId)) return;
    this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch.size === 2) {
      const span = this.pinchSpan();
      if (this.pinchDist > 0 && span > 0) {
        const [a, b] = [...this.pinch.values()];
        this.zoomBy(-Math.log(span / this.pinchDist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      this.pinchDist = span;
    }
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    this.pinch.delete(e.pointerId);
    this.pinchDist = 0;
  };

  /** Unit render-space direction of the ray under a screen point. */
  private cursorDirection(clientX: number, clientY: number, out: Vector3): Vector3 {
    const rect = this.dom.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return out.set(x, y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
  }

  // ---- Free flight ------------------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.flyBoost = e.shiftKey;
    if (!this.activeFlag) return;
    if (!(e.code in FLY_KEYS) || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.focus) {
      this.interrupt();
      this.release();
    }
    this.flyKeys.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.flyBoost = e.shiftKey;
    this.flyKeys.delete(e.code);
  };

  private readonly onBlur = () => {
    this.flyKeys.clear();
    this.flyBoost = false;
  };

  /** Length scale of free motion: distance to the nearest body surface. */
  private freeScale(): number {
    const d = this.surfaceQuery ? this.surfaceQuery(this.camera.position) : this.distance;
    return Math.max(d, RENDER.minNear * 100);
  }

  /** Raise or restore the distance limit (scene units). */
  setMaxDistance(d: number): void {
    this.maxDist = Math.max(d, CAMERA.maxDistance);
    this.controls.maxDistance = this.maxDist;
  }

  /** Move camera and pivot together, never beyond the distance limit from the Sun. */
  private translate(dir: Vector3, amount: number): void {
    this.camera.position.addScaledVector(dir, amount);
    this.controls.target.addScaledVector(dir, amount);
    const abs = this.origin.toAbsolute(this.camera.position, this.tmpC);
    const over = abs.length() - this.maxDist;
    if (over > 0) {
      const back = abs.normalize().multiplyScalar(-over);
      this.camera.position.add(back);
      this.controls.target.add(back);
    }
  }

  /** After free motion: orbit about a point as far ahead as the nearest surface. */
  private repivot(): void {
    this.camera.getWorldDirection(this.tmpB);
    this.controls.target.copy(this.camera.position).addScaledVector(this.tmpB, this.freeScale());
  }

  private applyFreeZoom(dt: number): void {
    if (Math.abs(this.freeZoomLog) < 1e-4) {
      this.freeZoomLog = 0;
      return;
    }
    const k = 1 - Math.exp(-dt * INTERACTION.zoomSmoothing);
    const step = this.freeZoomLog * k;
    this.freeZoomLog -= step;
    // Zooming in by e^step towards the body under the cursor (or the
    // nearest surface): a fraction of the way left, so it never goes in.
    let scale = this.freeScale();
    if (this.zoomBody) {
      // Stop as close as a focused camera may come (its minimum distance).
      const r = this.zoomBody.getRadius();
      const c = this.origin.toRender(this.zoomBody.getAbsolutePosition(this.tmpC), this.tmpC);
      scale = Math.max(this.camera.position.distanceTo(c) - r * CAMERA.minDistanceRadii, 0);
      if (scale === 0 && step < 0) {
        this.freeZoomLog = 0;
        return;
      }
    }
    this.translate(this.freeZoomDir, scale * (1 - Math.exp(step)));
    this.repivot();
  }

  private applyFly(dt: number): void {
    if (this.focus || this.flyKeys.size === 0) return;
    const v = this.tmpA.set(0, 0, 0);
    for (const code of this.flyKeys) {
      const [x, y, z] = FLY_KEYS[code];
      v.x += x;
      v.y += y;
      v.z += z;
    }
    if (v.lengthSq() === 0) return;
    v.normalize().applyQuaternion(this.camera.quaternion);
    const speed = this.freeScale() * FREE.flySpeed * (this.flyBoost ? FREE.boost : 1);
    this.translate(v, speed * dt);
    this.repivot();
  }

  /** Let go of a body that has shrunk to a few pixels. */
  private checkRelease(): void {
    if (!this.focus) return;
    const r = this.focus.getViewRadius?.() ?? this.focus.getRadius();
    const halfFov = MathUtils.degToRad(this.camera.fov) / 2;
    const px = (r / Math.max(this.distance, 1e-9) / Math.tan(halfFov)) * (this.dom.clientHeight / 2);
    if (px < FREE.releasePx) this.release();
  }

  private pinchSpan(): number {
    const [a, b] = [...this.pinch.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  // ---- Frame -----------------------------------------------------------------------------

  /** Call once per frame, after bodies have moved and before rendering. */
  update(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastUpdate) / 1000, 0.1);
    this.lastUpdate = now;
    // Another view owns the screen: hold still (no follow, no release).
    if (!this.activeFlag) return;

    if (this.focus) {
      this.focus.getAbsolutePosition(this.tmpA);
      this.origin.toRender(this.tmpA, this.focusRender);
    }

    if (this.anim) {
      const a = this.anim;
      const raw = Math.min(1, (now - a.start) / a.duration);
      a.step(a.ease(raw), raw);
      if (raw >= 1) {
        this.anim = null;
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
        this.lastFocusRender.copy(this.focusRender);
        a.done();
      }
    } else {
      // Follow the (possibly orbiting) focus by translating camera + target
      // by its frame-to-frame motion. Preserves damping momentum.
      if (this.focus) {
        this.tmpB.subVectors(this.focusRender, this.lastFocusRender);
        if (this.tmpB.lengthSq() > 0) {
          this.camera.position.add(this.tmpB);
          this.controls.target.add(this.tmpB);
        }
        this.lastFocusRender.copy(this.focusRender);
      }
      this.keepFraming();
      this.applyZoom(dt);
      this.applyFly(dt);
      this.applySpin(dt);
      this.applyPanInertia(dt);
      this.controls.update();
      this.checkRelease();
    }

    // Rebase the floating origin around the orbit target if it drifted.
    this.origin.maybeRebase(this.controls.target);
    this.updateClipping();
  }

  /**
   * When the focused body changes size (cinematic ↔ real scale), scale the
   * camera distance with it so the framing is preserved.
   */
  private keepFraming(): void {
    if (!this.focus) return;
    const r = this.focus.getRadius();
    const last = this.lastFocusRadius;
    this.lastFocusRadius = r;
    if (last <= 0 || Math.abs(r - last) < last * 1e-9) return;
    const k = r / last;
    const offset = this.tmpC.subVectors(this.camera.position, this.controls.target).multiplyScalar(k);
    this.camera.position.copy(this.controls.target).add(offset);
    if (this.zoomTargetLog !== null) this.zoomTargetLog += Math.log(k);
    this.controls.minDistance = r * CAMERA.minDistanceRadii;
  }

  private applyZoom(dt: number): void {
    if (!this.focus) {
      this.applyFreeZoom(dt);
      return;
    }
    if (this.zoomTargetLog === null) return;
    const offset = this.tmpC.subVectors(this.camera.position, this.controls.target);
    const cur = Math.log(Math.max(offset.length(), 1e-9));
    const k = 1 - Math.exp(-dt * INTERACTION.zoomSmoothing);
    const next = cur + (this.zoomTargetLog - cur) * k;
    offset.setLength(Math.exp(next));
    this.camera.position.copy(this.controls.target).add(offset);
    if (Math.abs(this.zoomTargetLog - next) < 1e-4) this.zoomTargetLog = null;
  }

  /**
   * Near plane tracks the distance to the nearest surface. With a
   * logarithmic depth buffer precision is not the issue; this mostly keeps
   * close-up geometry from being clipped.
   */
  private updateClipping(): void {
    const dist = this.camera.position.distanceTo(this.focus ? this.focusRender : this.controls.target);
    const radius = this.focus ? this.focus.getRadius() : 0;
    let surface = this.focus ? Math.max(dist - radius, 0) : dist;
    // Any other body may be nearer (a moon passing by, free flight past a planet).
    if (this.surfaceQuery) surface = Math.min(surface, this.surfaceQuery(this.camera.position));
    const near = MathUtils.clamp(surface * RENDER.nearToSurfaceRatio, RENDER.minNear, RENDER.maxNear);
    const far = Math.max(RENDER.far, this.maxDist * 4);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.01 || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    this.interrupt();
    this.controls.dispose();
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointercancel', this.onPointerUp);
    this.dom.removeEventListener('pointerdown', this.onGrabStart);
    this.dom.removeEventListener('pointermove', this.onGrabMove);
    this.dom.removeEventListener('pointerup', this.onGrabEnd);
    this.dom.removeEventListener('pointercancel', this.onGrabEnd);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
