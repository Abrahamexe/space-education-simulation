import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  Line,
  MathUtils,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KM_PER_AU } from '../config/astro';
import type { Axis, CraftDef } from '../config/spacecraft';
import { scale } from '../core/scale';
import type { Focusable, FrameContext } from '../core/types';
import { keplerStep } from '../playground/kepler';
import type { CraftMapper } from './CraftMapper';
import { buildSchematic } from './schematic';
import pathVert from '../shaders/spacecraft/path.vert?raw';
import pathFrag from '../shaders/spacecraft/path.frag?raw';
import { Trajectory, type CraftState, type SegmentData } from './Trajectory';

const AXES: Record<Axis, Vector3> = {
  '+x': new Vector3(1, 0, 0),
  '-x': new Vector3(-1, 0, 0),
  '+y': new Vector3(0, 1, 0),
  '-y': new Vector3(0, -1, 0),
  '+z': new Vector3(0, 0, 1),
  '-z': new Vector3(0, 0, -1),
};
const UP = new Vector3(0, 1, 0);
/** Days over which a craft eases between the cruise and the orbiter mappings. */
const BLEND_DAYS = 90;
/** Models load once the camera is this many drawn sizes away or closer. */
const MODEL_LOAD_SIZES = 4000;
/** The marker gives way to the model above this apparent radius (px). */
const MARKER_FADE_PX = [2, 6] as const;
/** Earth orbiters' paths show only near them (multiples of their distance from the centre). */
const ORBIT_SHOW_DIST = 6;
/** Paths show in overviews (camera this far from its target) or for craft near the target (multiples of that distance). */
const PATH_OVERVIEW_DIST = 40;
const PATH_NEAR_FOCUS = 6;

let dotTexture: Texture | null = null;
function dot(): Texture {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new CanvasTexture(c);
  return dotTexture;
}

/** Mapping a segment uses: about its centre body ('sat') or through the cruise curve ('helio'). */
function modeOf(s: SegmentData): 'sat' | 'helio' {
  if (s.center === 'earth') return 'sat';
  // Orbital tours (months about a planet); flybys last weeks.
  return s.center !== 'sun' && s.n * s.step > 200 ? 'sat' : 'helio';
}

/**
 * A spacecraft at its real (JPL Horizons) position: NASA model (or a
 * schematic one) at a size following the bodies' size curve, turned the way
 * the craft flies (dish to Earth, shield to the Sun), a marker while it is
 * smaller than a few pixels, and its path: the whole voyage for probes, the
 * current orbit for Earth orbiters and planetary tours. Hidden outside the
 * span of its data (before launch, after the end of the ephemeris).
 */
export class Spacecraft implements Focusable {
  readonly group = new Group();
  readonly trajectory: Trajectory;
  /** Not drawn, picked or labelled (no data for the date). */
  hidden = true;
  /** Below this the label stays hidden (Earth orbiters seen from afar). */
  labelHidden = true;
  heliocentricDistanceKm = 0;
  earthDistanceKm = 0;
  private readonly pivot = new Group();
  private model: Object3D | null = null;
  private modelState: 'none' | 'loading' | 'ready' = 'none';
  private readonly marker: Sprite;
  private readonly abs = new Vector3();
  private radius: number;
  private readonly state: CraftState = { center: 'sun', r: [0, 0, 0], v: [0, 0, 0] };
  private readonly pHelio = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly q = new Quaternion();
  /** Whole voyage (cruise and flybys), drawn once; past / future split by draw range. */
  private readonly path: { past: Line; future: Line; times: Float64Array } | null;
  private pathBuilt = false;
  /** Current orbit about the centre (orbiters, tours). */
  private readonly orbit: Line;
  private orbitJd = -Infinity;
  private emphasis = 0;
  /** Size multiplier over the bodies' size curve (developer panel). */
  private exag = 1;
  /** Developer panel: path brightness and marker size factors, every Earth orbiter's orbit on. */
  pathGain = 1;
  markerScale = 1;
  showAllOrbits = false;

  constructor(
    readonly def: CraftDef,
    track: ConstructorParameters<typeof Trajectory>[1],
    private readonly mapper: CraftMapper,
    world: Group,
    private readonly gltf: GLTFLoader,
    private readonly envMap: Texture,
  ) {
    this.trajectory = new Trajectory(def.track, track);
    this.radius = this.drawnRadius();
    this.group.name = `craft-${def.id}`;
    this.group.add(this.pivot);
    this.marker = new Sprite(
      new SpriteMaterial({ map: dot(), color: new Color(...def.color), sizeAttenuation: false, depthWrite: false, transparent: true, blending: AdditiveBlending }),
    );
    this.marker.renderOrder = 46;
    this.group.add(this.marker);
    this.group.visible = false;
    world.add(this.group);

    const lineMat = (opacity: number) =>
      new ShaderMaterial({
        vertexShader: pathVert,
        fragmentShader: pathFrag,
        uniforms: { uColor: { value: new Color(...def.color) }, uOpacity: { value: opacity }, uFade: { value: new Vector2(0, 1) } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
    const hasCruise = track.segments.some((s) => modeOf(s) === 'helio');
    if (hasCruise) {
      const g = new BufferGeometry();
      const past = new Line(g, lineMat(0.5));
      const future = new Line(g, lineMat(0.14));
      for (const l of [past, future]) {
        l.frustumCulled = false;
        l.renderOrder = 4;
        l.visible = false;
        world.add(l);
      }
      this.path = { past, future, times: new Float64Array(0) };
    } else this.path = null;
    this.orbit = new Line(new BufferGeometry(), lineMat(0.35));
    this.orbit.frustumCulled = false;
    this.orbit.renderOrder = 4;
    this.orbit.visible = false;
    world.add(this.orbit);
    scale.onChange(() => {
      this.radius = this.drawnRadius();
      this.pathBuilt = false;
      this.orbitJd = -Infinity;
      this.fitModel();
    });
  }

  get id(): string {
    return this.def.id;
  }

  private drawnRadius(): number {
    return scale.radius(this.def.sizeM / 2000) * this.exag;
  }

  set exaggeration(k: number) {
    this.exag = k;
    this.radius = this.drawnRadius();
    this.fitModel();
  }

  getAbsolutePosition(out: Vector3): Vector3 {
    return out.copy(this.abs);
  }

  getRadius(): number {
    return this.radius;
  }

  /** True heliocentric ecliptic position (km). */
  trueHelioKm(out: Vector3): Vector3 {
    return out.copy(this.pHelio);
  }

  /** Selected (1) or hovered (0.5): brighter path. */
  set highlight(v: number) {
    this.emphasis = v;
  }

  // ---- Position ---------------------------------------------------------------------

  /** Heliocentric km of a state at jd. */
  private helioOf(s: CraftState, jd: number, out: Vector3): Vector3 {
    this.mapper.helioKm(s.center, jd, out);
    return out.add(this.tmp2.set(s.r[0], s.r[1], s.r[2]));
  }

  /**
   * Scene position for a state, with the cruise ↔ orbiter blend near the
   * segment changes (arrival at a planet, Gaia leaving L2).
   */
  private place(s: CraftState, jd: number, out: Vector3): Vector3 {
    const seg = this.trajectory.segmentAt(jd);
    const mode = seg ? modeOf(seg) : 'helio';
    this.helioOf(s, jd, this.pHelio);
    if (mode === 'helio' || !seg) return this.mapper.helio(this.pHelio, jd, out);
    this.mapper.sat(s.center, this.tmp.set(s.r[0], s.r[1], s.r[2]), jd, out);
    const segs = this.trajectory.track.segments;
    const i = segs.indexOf(seg);
    const end = seg.t0 + (seg.n - 1) * seg.step;
    const B = Math.min(BLEND_DAYS, (end - seg.t0) / 3);
    let w = 1;
    if (i > 0 && modeOf(segs[i - 1]) === 'helio') w = Math.min(w, MathUtils.smoothstep(jd, seg.t0, seg.t0 + B));
    if (i < segs.length - 1 && modeOf(segs[i + 1]) === 'helio') w = Math.min(w, 1 - MathUtils.smoothstep(jd, end - B, end));
    if (w >= 1) return out;
    const h = this.mapper.helio(this.pHelio, jd, this.tmp);
    return out.lerp(h, 1 - w);
  }

  // ---- Model ------------------------------------------------------------------------

  private loadModel(): void {
    this.modelState = 'loading';
    const m = this.def.model;
    const done = (o: Object3D) => {
      o.traverse((c) => {
        const mesh = c as Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]) {
          const std = mat as Material & { envMap?: Texture | null; envMapIntensity?: number; metalness?: number; roughness?: number };
          if ('envMap' in std) {
            std.envMap = this.envMap;
            std.envMapIntensity = 0.45;
            // Fully rough metal (palette exports) reads as black: soften it.
            if (std.metalness === 1 && std.roughness === 1) std.metalness = 0.55;
            std.needsUpdate = true;
          }
        }
      });
      this.model = o;
      this.pivot.add(o);
      this.fitModel();
      this.modelState = 'ready';
    };
    if ('schematic' in m) done(buildSchematic(m.schematic));
    else
      this.gltf
        .loadAsync(`${import.meta.env.BASE_URL}models/spacecraft/${m.glb}.glb`)
        .then((g) => done(g.scene))
        .catch(() => (this.modelState = 'none'));
  }

  /** Centre the model and scale its largest dimension to the drawn size. */
  private fitModel(): void {
    const o = this.model;
    if (!o) return;
    o.position.set(0, 0, 0);
    o.scale.setScalar(1);
    // Measured on its own: setFromObject works in world space (the craft sits far out).
    const parent = o.parent;
    o.removeFromParent();
    o.updateMatrixWorld(true);
    const box = new Box3().setFromObject(o);
    parent?.add(o);
    const size = box.getSize(this.tmp);
    const k = (this.radius * 2) / Math.max(size.x, size.y, size.z, 1e-9);
    o.scale.setScalar(k);
    o.position.copy(box.getCenter(this.tmp2)).multiplyScalar(-k);
  }

  /** Turn the chosen model axis to the Sun / Earth, roll so the model's other axis leans to ecliptic north. */
  private orient(): void {
    const a = this.def.attitude;
    const to = this.tmp;
    if (a.to === 'earth') {
      this.mapper.helioToScene(this.mapper.helioKm('earth', this.jd, this.tmp2), to).sub(this.abs);
      if (to.lengthSq() < 1e-18) to.copy(this.abs).negate();
    } else to.copy(this.abs).negate();
    if (a.to === 'antisun') to.negate();
    if (to.lengthSq() < 1e-18) return;
    to.normalize();
    const axis = AXES[a.axis];
    this.q.setFromUnitVectors(axis, to);
    // Roll: bring a perpendicular model axis as close to "up" as possible.
    const perp = Math.abs(axis.y) > 0.5 ? AXES['+z'] : AXES['+y'];
    const cur = this.tmp2.copy(perp).applyQuaternion(this.q);
    const want = UP.clone().addScaledVector(to, -UP.dot(to));
    if (want.lengthSq() > 1e-8) {
      want.normalize();
      cur.addScaledVector(to, -cur.dot(to)).normalize();
      const ang = Math.atan2(to.dot(new Vector3().crossVectors(cur, want)), cur.dot(want));
      this.q.premultiply(new Quaternion().setFromAxisAngle(to, ang));
    }
    if (a.tiltDeg) {
      // Tip about the horizontal axis across the line to the target.
      const across = new Vector3().crossVectors(to, UP);
      if (across.lengthSq() > 1e-8) this.q.premultiply(new Quaternion().setFromAxisAngle(across.normalize(), MathUtils.degToRad(a.tiltDeg)));
    }
    this.pivot.quaternion.copy(this.q);
  }

  private jd = 0;

  // ---- Paths ------------------------------------------------------------------------

  /** Cruise and flyby samples through the cruise curve (once, and after scale changes). */
  private buildPath(): void {
    const p = this.path;
    if (!p) return;
    const segs = this.trajectory.track.segments.filter((s) => modeOf(s) === 'helio');
    let n = 0;
    for (const s of segs) n += s.n;
    const pos = new Float32Array(n * 3);
    const times = new Float64Array(n);
    const st: CraftState = { center: 'sun', r: [0, 0, 0], v: [0, 0, 0] };
    const v = new Vector3();
    const h = new Vector3();
    let k = 0;
    // Segments are in time order; skip samples that would double back at joins.
    for (const s of this.trajectory.track.segments) {
      if (modeOf(s) !== 'helio') continue;
      for (let i = 0; i < s.n; i++) {
        const t = s.t0 + i * s.step;
        if (k > 0 && t <= times[k - 1]) continue;
        this.trajectory.sampleAt(s, i, st);
        this.mapper.helio(this.helioOf(st, t, h), t, v);
        pos[k * 3] = v.x;
        pos[k * 3 + 1] = v.y;
        pos[k * 3 + 2] = v.z;
        times[k++] = t;
      }
    }
    const g = p.past.geometry;
    g.setAttribute('position', new BufferAttribute(pos.subarray(0, k * 3), 3));
    g.computeBoundingSphere();
    p.times = times.subarray(0, k);
    this.pathBuilt = true;
  }

  /** First sample after a time. */
  private indexAfter(jd: number): number {
    const t = this.path!.times;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= jd) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Split the voyage at now: bright behind, faint ahead (within trailYears when set). */
  private updatePathSplit(): void {
    const p = this.path!;
    const now = this.indexAfter(this.jd);
    const span = this.def.trailYears ? this.def.trailYears * 365.25 : Infinity;
    const a = Number.isFinite(span) ? this.indexAfter(this.jd - span) : 0;
    const b = Number.isFinite(span) ? this.indexAfter(this.jd + span) : p.times.length;
    p.past.geometry.setDrawRange(a, Math.max(now - a, 0));
    p.future.geometry.setDrawRange(Math.max(now - 1, 0), Math.max(b - now + 1, 0));
  }

  /** The orbit about the centre: one Kepler period, or ±120 days of samples for L2 halo orbits. */
  private updateOrbit(seg: SegmentData): void {
    const pts: number[] = [];
    const v = new Vector3();
    if (seg.interp === 'hermite') {
      const st: CraftState = { center: seg.center, r: [0, 0, 0], v: [0, 0, 0] };
      for (let d = -120; d <= 120; d += 1) {
        const t = this.jd + d;
        if (!this.trajectory.stateAt(t, st) || st.center !== seg.center) continue;
        this.mapper.sat(seg.center, v.set(st.r[0], st.r[1], st.r[2]), this.jd, v);
        pts.push(v.x, v.y, v.z);
      }
    } else {
      const r = [...this.state.r];
      const vel = [...this.state.v];
      const R = Math.hypot(r[0], r[1], r[2]);
      const V2 = vel[0] ** 2 + vel[1] ** 2 + vel[2] ** 2;
      const a = 1 / (2 / R - V2 / seg.gm);
      if (!(a > 0)) return void (this.orbit.visible = false);
      // Even steps in eccentric anomaly: dense at periapsis, where the path bends.
      const n = Math.sqrt(seg.gm / (a * a * a));
      const rv = r[0] * vel[0] + r[1] * vel[1] + r[2] * vel[2];
      const eCosE = 1 - R / a;
      const eSinE = rv / Math.sqrt(seg.gm * a);
      const e = Math.hypot(eCosE, eSinE);
      let E = Math.atan2(eSinE, eCosE);
      const N = 240;
      for (let i = 0; i <= N; i++) {
        this.mapper.sat(seg.center, v.set(r[0], r[1], r[2]), this.jd, v);
        pts.push(v.x, v.y, v.z);
        const E2 = E + (2 * Math.PI) / N;
        keplerStep(r, vel, seg.gm, (E2 - e * Math.sin(E2) - (E - e * Math.sin(E))) / n);
        E = E2;
      }
    }
    const g = this.orbit.geometry;
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    g.computeBoundingSphere();
    // Farthest point from the centre, for the inside / outside test.
    const c = this.mapper.sat(seg.center, new Vector3(), this.jd, new Vector3());
    let ext = 0;
    for (let i = 0; i < pts.length; i += 3) ext = Math.max(ext, Math.hypot(pts[i] - c.x, pts[i + 1] - c.y, pts[i + 2] - c.z));
    this.orbitExtent = ext;
  }

  /** Largest distance of the drawn orbit from its centre (scene units, 0 = not drawn yet). */
  private orbitExtent = 0;

  // ---- Frame ------------------------------------------------------------------------

  /**
   * camAbs: the camera's absolute position. view.closeUp: the camera is on a
   * spacecraft; view.focusDist: camera to orbit target. Paths of craft far
   * from what is being looked at would only streak across the view.
   */
  update(ctx: FrameContext, show: boolean, camAbs: Vector3, view: { closeUp: boolean; focusDist: number }, budget: { paths: number }): void {
    const closeUp = view.closeUp;
    const jd = ctx.time.jd;
    this.jd = jd;
    const tr = this.trajectory;
    if (!tr.loaded) {
      void tr.load();
      this.setHidden(true);
      return;
    }
    const s = show ? tr.stateAt(jd, this.state) : null;
    if (!s) {
      this.setHidden(true);
      return;
    }
    this.setHidden(false);
    this.place(s, jd, this.abs);
    this.group.position.copy(this.abs);
    this.helioOf(s, jd, this.pHelio);
    this.heliocentricDistanceKm = this.pHelio.length();
    this.earthDistanceKm = s.center === 'earth' ? Math.hypot(...s.r) : this.pHelio.distanceTo(this.mapper.helioKm('earth', jd, this.tmp));
    this.orient();

    // Apparent size → model or marker.
    const camDist = this.abs.distanceTo(camAbs);
    const focal = ctx.viewportHeight / 2 / Math.tan((ctx.camera.fov * Math.PI) / 360);
    const px = (this.radius / Math.max(camDist, 1e-12)) * focal / ctx.pixelRatio;
    if (this.modelState === 'none' && camDist < this.radius * MODEL_LOAD_SIZES) this.loadModel();
    this.pivot.visible = px > 0.5;
    const m = 1 - MathUtils.smoothstep(px, MARKER_FADE_PX[0], MARKER_FADE_PX[1]);
    this.marker.visible = m > 0.01;
    this.marker.material.opacity = m * (0.65 + 0.35 * this.emphasis);
    this.marker.scale.setScalar((0.011 + 0.004 * this.emphasis) * this.markerScale);

    // Paths.
    const seg = tr.segmentAt(jd)!;
    // Paths are built one per frame (a voyage is thousands of samples).
    if (this.path && !this.pathBuilt && budget.paths > 0) {
      budget.paths--;
      this.buildPath();
    }
    if (this.path && this.pathBuilt) {
      this.updatePathSplit();
      const o = (0.14 + 0.45 * this.emphasis) * this.pathGain;
      this.setLine(this.path.past, o);
      this.setLine(this.path.future, o * 0.3);
      // Overview, or the craft is near what the camera looks at.
      const relevant = !closeUp && (view.focusDist > PATH_OVERVIEW_DIST || camDist < view.focusDist * PATH_NEAR_FOCUS);
      this.path.past.visible = this.path.future.visible = relevant || this.emphasis > 0;
    }
    if (modeOf(seg) === 'sat') {
      const centerDist = Math.hypot(...s.r);
      const reach = scale.satelliteDistance(centerDist, this.mapper.body(seg.center)?.radiusKm ?? 6371);
      // An orbit reads as an orbit from outside it; from inside it is lines across the view.
      const extent = this.orbitExtent || reach * 1.5;
      const camToCenter = this.mapper.sat(seg.center, this.tmp2.set(0, 0, 0), jd, this.tmp).distanceTo(camAbs);
      const close = camToCenter < extent * ORBIT_SHOW_DIST;
      const pinned = this.emphasis > 0 || this.showAllOrbits;
      this.labelHidden = !(close || pinned);
      const near = pinned || (close && camToCenter > extent * 1.2 && !closeUp);
      this.orbit.visible = near;
      if (near && Math.abs(jd - this.orbitJd) > seg.step * 0.25) {
        this.orbitJd = jd;
        this.updateOrbit(seg);
      }
      this.setLine(this.orbit, (0.18 + 0.35 * this.emphasis) * this.pathGain);
    } else {
      this.labelHidden = false;
      this.orbit.visible = false;
    }
  }

  /** Line opacity, faded within a few dozen craft sizes of the camera. */
  private setLine(l: Line, opacity: number): void {
    const u = (l.material as ShaderMaterial).uniforms;
    u.uOpacity.value = opacity;
    u.uFade.value.set(this.radius * 6, this.radius * 60);
  }

  private setHidden(h: boolean): void {
    this.hidden = h;
    this.group.visible = !h;
    if (h) {
      this.orbit.visible = false;
      if (this.path) this.path.past.visible = this.path.future.visible = false;
    }
  }

  /** Kilometres → AU, for the info card. */
  get heliocentricDistanceAu(): number {
    return this.heliocentricDistanceKm / KM_PER_AU;
  }
}
