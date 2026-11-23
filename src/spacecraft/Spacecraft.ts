import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
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
import { ribbonData, ribbonGeometry, setRibbonRange, writeRibbon, type RibbonData } from './Ribbon';
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
/** Inside this multiple of its drawn size an orbit is lines across the view: hidden then. */
const ORBIT_INSIDE = 1.2;
/** Ribbon width (CSS px): resting, and for the selected craft. */
const LINE_PX = [1.8, 2.6] as const;
/** The live-observation beam (CSS px). */
const BEAM_PX = 3.2;
/** The future of a voyage is dashed: one dash per this many samples. */
const FUTURE_DASH = 6;
/** Path and orbit opacity: at rest, and for the selected craft (hovered: halfway). */
const PATH_REST = 0.16;
const PATH_LIT = 0.9;
const ORBIT_REST = 0.24;
const ORBIT_LIT = 0.92;
/**
 * Voyage paths follow the craft's own interpolation between the data
 * samples: an interval is halved while its midpoint strays from the chord by
 * more than this fraction of the chord (scene units), up to PATH_MAX_DEPTH
 * times (2^6 = 64 pieces: Parker's perihelion passes, flybys).
 */
const PATH_TOLERANCE = 0.006;
const PATH_MAX_DEPTH = 6;

/** A double-precision position as two float32 parts (see path.vert, RTE). */
function splitCamera(p: Vector3, hi: Vector3, lo: Vector3): void {
  hi.set(Math.fround(p.x), Math.fround(p.y), Math.fround(p.z));
  lo.set(p.x - hi.x, p.y - hi.y, p.z - hi.z);
}

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
  private readonly path: {
    past: Mesh;
    future: Mesh;
    /** Last sample before now, the craft, first sample after: the line runs exactly through it. */
    pastTip: Mesh;
    futureTip: Mesh;
    tip: RibbonData;
    times: Float64Array;
    points: Float64Array;
    /** Dash coordinate per point, in data samples (dashes keep their spacing where the path is refined). */
    along: Float64Array;
  } | null;
  private pathBuilt = false;
  /** Path being built, a slice per frame (see buildPath). */
  private builder: Generator<void, void> | null = null;
  /** Current orbit about the centre (orbiters, tours). */
  private readonly orbit: Mesh;
  private orbitJd = -Infinity;
  private emphasis = 0;
  /** Size multiplier over the bodies' size curve (developer panel). */
  private exag = 1;
  /** Where the telescope points (live observation): a beam from the craft along this direction. */
  private beam: Mesh | null = null;
  private pointing: Vector3 | null = null;
  /** Developer panel: path brightness and marker size factors, every Earth orbiter's orbit on. */
  pathGain = 1;
  markerScale = 1;
  showAllOrbits = false;
  /** Paths and orbits drawn at all (the orbit toggle in spacecraft mode). */
  pathsOn = true;

  constructor(
    readonly def: CraftDef,
    track: ConstructorParameters<typeof Trajectory>[1],
    private readonly mapper: CraftMapper,
    world: Group,
    private readonly gltf: GLTFLoader,
    private readonly envMap: Texture,
  ) {
    this.trajectory = new Trajectory(def.track, track, def.norad);
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

    // rte: absolute vertices drawn relative to the camera (voyage paths).
    const lineMat = (opacity: number, dash = 0, rte = false) =>
      new ShaderMaterial({
        vertexShader: pathVert,
        fragmentShader: pathFrag,
        defines: rte ? { RTE: '' } : {},
        uniforms: {
          uColor: { value: new Color(...def.color) },
          uOpacity: { value: opacity },
          uFade: { value: new Vector2(0, 1) },
          uHalf: { value: 0 },
          uEdge: { value: 0.5 },
          uDash: { value: dash },
          uTaper: { value: 0 },
          uCamHi: { value: new Vector3() },
          uCamLo: { value: new Vector3() },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
    const hasCruise = track.segments.some((s) => modeOf(s) === 'helio');
    if (hasCruise) {
      // Separate geometries: each carries its own draw range (past / future).
      const past = new Mesh(new BufferGeometry(), lineMat(0.5, 0, true));
      const future = new Mesh(new BufferGeometry(), lineMat(0.14, FUTURE_DASH, true));
      const tip = ribbonData(new Float64Array(9));
      const pastTip = new Mesh(ribbonGeometry(tip, 0, 2), past.material);
      const futureTip = new Mesh(ribbonGeometry(tip, 1, 3), future.material);
      for (const l of [past, future, pastTip, futureTip]) {
        l.frustumCulled = false;
        l.renderOrder = 4;
        l.visible = false;
        world.add(l);
      }
      this.path = { past, future, pastTip, futureTip, tip, times: new Float64Array(0), points: new Float64Array(0), along: new Float64Array(0) };
    } else this.path = null;
    this.orbit = new Mesh(new BufferGeometry(), lineMat(0.35));
    this.orbit.frustumCulled = false;
    this.orbit.renderOrder = 4;
    this.orbit.visible = false;
    world.add(this.orbit);
    scale.onChange(() => {
      this.radius = this.drawnRadius();
      this.pathBuilt = false;
      this.builder = null;
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

  /** Beam along a scene direction (null = off). */
  setPointing(dir: Vector3 | null): void {
    this.pointing = dir ? dir.clone().normalize() : null;
    if (!this.pointing) {
      if (this.beam) this.beam.visible = false;
      return;
    }
    if (!this.beam) {
      const m = new ShaderMaterial({
        vertexShader: pathVert,
        fragmentShader: pathFrag,
        uniforms: {
          uColor: { value: new Color(0.7, 0.9, 1) },
          uOpacity: { value: 1 },
          // Never faded by distance (negative edges: fully on at any range).
          uFade: { value: new Vector2(-2, -1) },
          uHalf: { value: 0 },
          uEdge: { value: 0.5 },
          uDash: { value: 0 },
          uTaper: { value: 0.85 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      // Unit segment along +Z, turned and scaled each frame.
      this.beam = new Mesh(ribbonGeometry(ribbonData(new Float32Array([0, 0, 0, 0, 0, 1]))), m);
      this.beam.frustumCulled = false;
      this.beam.renderOrder = 47;
      this.group.add(this.beam);
    }
    this.beam.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), this.pointing);
    this.beam.visible = true;
  }

  /** Path / marker colour as a CSS rgb() string (labels and menus carry it as a swatch). */
  get swatch(): string {
    return `rgb(${this.def.color.map((c) => Math.round(c * 255)).join(',')})`;
  }

  /**
   * Where the voyage path is named: the middle of the part already flown
   * (absolute scene units). Null for craft without a voyage path, or while it
   * is not drawn.
   */
  pathLabelAnchor(out: Vector3): Vector3 | null {
    const p = this.path;
    if (!p || !this.pathBuilt || !p.past.visible || this.hidden) return null;
    const now = this.indexAfter(this.jd);
    const span = this.def.trailYears ? this.def.trailYears * 365.25 : Infinity;
    const a = Number.isFinite(span) ? this.indexAfter(this.jd - span) : 0;
    const mid = (a + now) >> 1;
    if (mid <= a || mid * 3 + 2 >= p.points.length) return null;
    return out.set(p.points[mid * 3], p.points[mid * 3 + 1], p.points[mid * 3 + 2]);
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
      const hide = 'glb' in m ? (m.hide ?? []) : [];
      if (hide.length) {
        const drop: Object3D[] = [];
        o.traverse((c) => {
          if (hide.some((h) => c.name.startsWith(h))) drop.push(c);
        });
        for (const c of drop) c.removeFromParent();
      }
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

  /**
   * Cruise and flyby path through the cruise curve (once, and after scale
   * changes): the data samples plus as many points between them as the
   * curve needs, each from the same interpolation that places the craft, so
   * the craft always sits on its line.
   */
  private *buildPath(): Generator<void, void> {
    const p = this.path;
    if (!p) return;
    const pts: number[] = [];
    const times: number[] = [];
    const along: number[] = [];
    const st: CraftState = { center: 'sun', r: [0, 0, 0], v: [0, 0, 0] };
    const h = new Vector3();
    const at = (t: number, out: Vector3): Vector3 | null => {
      if (!this.trajectory.stateAt(t, st)) return null;
      return this.mapper.helio(this.helioOf(st, t, h), t, out);
    };
    const chordMid = new Vector3();
    // Points after (t0, a) up to (t1, b), refined where the curve bends.
    const refine = (t0: number, a: Vector3, t1: number, b: Vector3, k0: number, k1: number, depth: number): void => {
      if (depth < PATH_MAX_DEPTH) {
        const tm = (t0 + t1) / 2;
        const m = at(tm, new Vector3());
        if (m) {
          const chord = a.distanceTo(b);
          const off = chordMid.addVectors(a, b).multiplyScalar(0.5).distanceTo(m);
          if (off > chord * PATH_TOLERANCE) {
            const km = (k0 + k1) / 2;
            refine(t0, a, tm, m, k0, km, depth + 1);
            refine(tm, m, t1, b, km, k1, depth + 1);
            return;
          }
        }
      }
      pts.push(b.x, b.y, b.z);
      times.push(t1);
      along.push(k1);
    };
    let prev = new Vector3();
    let k = 0;
    // Segments are in time order; skip samples that would double back at joins.
    for (const s of this.trajectory.track.segments) {
      if (modeOf(s) !== 'helio') continue;
      for (let i = 0; i < s.n; i++, k++) {
        // A voyage is thousands of samples: hand the frame back now and then.
        if ((k & 127) === 127) yield;
        const t = s.t0 + i * s.step;
        const last = times.length ? times[times.length - 1] : -Infinity;
        if (t <= last) continue;
        this.trajectory.sampleAt(s, i, st);
        const cur = this.mapper.helio(this.helioOf(st, t, h), t, new Vector3());
        // Refine only inside a segment (across a gap the craft coasts on the nearer end's conic).
        if (i > 0 && times.length) refine(last, prev, t, cur, k - 1, k, 0);
        else {
          pts.push(cur.x, cur.y, cur.z);
          times.push(t);
          along.push(k);
        }
        prev = cur;
      }
    }
    p.points = Float64Array.from(pts);
    p.times = Float64Array.from(times);
    p.along = Float64Array.from(along);
    const al = p.along;
    const data = ribbonData(p.points, (i) => al[i]);
    for (const m of [p.past, p.future]) {
      m.geometry.dispose();
      m.geometry = ribbonGeometry(data, 0, 0);
    }
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

  /**
   * Split the voyage at now: bright behind, faint ahead (within trailYears
   * when set), joined at the craft itself by the two tip pieces.
   */
  private updatePathSplit(onPath: boolean): void {
    const p = this.path!;
    const now = this.indexAfter(this.jd);
    const n = p.times.length;
    const span = this.def.trailYears ? this.def.trailYears * 365.25 : Infinity;
    const a = Number.isFinite(span) ? this.indexAfter(this.jd - span) : 0;
    const b = Number.isFinite(span) ? this.indexAfter(this.jd + span) : n;
    const tips = onPath && now > 0 && now < n;
    setRibbonRange(p.past.geometry, a, tips ? now : Math.min(now + 1, n));
    setRibbonRange(p.future.geometry, tips ? now : Math.max(now - 1, 0), b);
    p.pastTip.userData.on = p.futureTip.userData.on = tips;
    if (!tips) return;
    const i0 = (now - 1) * 3;
    const i1 = now * 3;
    const pt = p.points;
    const f = (this.jd - p.times[now - 1]) / Math.max(p.times[now] - p.times[now - 1], 1e-12);
    const k0 = p.along[now - 1];
    const k1 = p.along[now];
    this.tipPts.set([pt[i0], pt[i0 + 1], pt[i0 + 2], this.abs.x, this.abs.y, this.abs.z, pt[i1], pt[i1 + 1], pt[i1 + 2]]);
    writeRibbon(p.tip, this.tipPts, (i) => (i === 0 ? k0 : i === 2 ? k1 : k0 + (k1 - k0) * f));
  }

  private readonly tipPts = new Float64Array(9);

  /** The orbit about the centre: one Kepler period, or ±120 days of samples for L2 halo orbits. */
  private updateOrbit(seg: SegmentData): void {
    const pts: number[] = [];
    const v = new Vector3();
    // Points are offsets from the centre's drawn position: the mesh follows the
    // centre each frame, so the orbit never lags the planet it circles.
    const c = this.mapper.sat(seg.center, new Vector3(), this.jd, new Vector3());
    if (seg.interp === 'hermite') {
      const st: CraftState = { center: seg.center, r: [0, 0, 0], v: [0, 0, 0] };
      for (let d = -120; d <= 120; d += 1) {
        const t = this.jd + d;
        if (!this.trajectory.stateAt(t, st) || st.center !== seg.center) continue;
        this.mapper.sat(seg.center, v.set(st.r[0], st.r[1], st.r[2]), this.jd, v).sub(c);
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
        this.mapper.sat(seg.center, v.set(r[0], r[1], r[2]), this.jd, v).sub(c);
        pts.push(v.x, v.y, v.z);
        const E2 = E + (2 * Math.PI) / N;
        keplerStep(r, vel, seg.gm, (E2 - e * Math.sin(E2) - (E - e * Math.sin(E))) / n);
        E = E2;
      }
    }
    this.orbit.geometry.dispose();
    this.orbit.geometry = ribbonGeometry(ribbonData(new Float32Array(pts)));
    // Farthest point from the centre, for the inside / outside test.
    let ext = 0;
    for (let i = 0; i < pts.length; i += 3) ext = Math.max(ext, Math.hypot(pts[i], pts[i + 1], pts[i + 2]));
    this.orbitExtent = ext;
  }

  /** Largest distance of the drawn orbit from its centre (scene units, 0 = not drawn yet). */
  private orbitExtent = 0;

  // ---- Frame ------------------------------------------------------------------------

  /**
   * camAbs: the camera's absolute position. view.closeUp: the camera is on a
   * spacecraft (only its own path is drawn then).
   */
  update(ctx: FrameContext, show: boolean): void {
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
  }

  /**
   * Everything that depends on where the camera is, run after the camera has
   * moved this frame (a fast craft followed at real scale moves many of its
   * own sizes per frame: last frame's camera would be far off).
   */
  updateView(ctx: FrameContext, camAbs: Vector3, view: { closeUp: boolean }, budget: { until: number }): void {
    if (this.hidden) return;
    const closeUp = view.closeUp;
    const jd = this.jd;
    const tr = this.trajectory;
    const s = this.state;

    // Apparent size → model or marker.
    const camDist = this.abs.distanceTo(camAbs);
    const focal = ctx.viewportHeight / 2 / Math.tan((ctx.camera.fov * Math.PI) / 360);
    const px = (this.radius / Math.max(camDist, 1e-12)) * focal / ctx.pixelRatio;
    if (this.modelState === 'none' && camDist < this.radius * MODEL_LOAD_SIZES) this.loadModel();
    this.pivot.visible = px > 0.5;
    if (this.beam && this.pointing) {
      // Long enough to reach across the view from wherever the camera is.
      this.beam.scale.setScalar(Math.max(camDist * 0.9, this.radius * 12));
      const bu = (this.beam.material as ShaderMaterial).uniforms;
      bu.uHalf.value = (BEAM_PX * ctx.pixelRatio) / 2 / Math.max(ctx.viewportHeight, 1);
      bu.uEdge.value = Math.min(1, 2 / Math.max(BEAM_PX * ctx.pixelRatio, 2));
    }
    const m = 1 - MathUtils.smoothstep(px, MARKER_FADE_PX[0], MARKER_FADE_PX[1]);
    this.marker.visible = m > 0.01;
    this.marker.material.opacity = m * (0.65 + 0.35 * this.emphasis);
    this.marker.scale.setScalar((0.011 + 0.004 * this.emphasis) * this.markerScale);

    // Paths.
    const seg = tr.segmentAt(jd)!;
    // Paths are built a few milliseconds per frame (a voyage is thousands of samples).
    if (this.path && !this.pathBuilt && performance.now() < budget.until) {
      this.builder ??= this.buildPath();
      while (performance.now() < budget.until) {
        if (this.builder.next().done) {
          this.builder = null;
          break;
        }
      }
    }
    if (this.path && this.pathBuilt) {
      this.updatePathSplit(modeOf(seg) === 'helio');
      // Faint at rest so a crowd of paths stays readable; the chosen craft's stands out.
      const o = (PATH_REST + (PATH_LIT - PATH_REST) * this.emphasis) * this.pathGain;
      this.setLine(ctx, this.path.past, o);
      this.setLine(ctx, this.path.future, o * 0.8);
      for (const m of [this.path.past, this.path.future]) {
        const u = (m.material as ShaderMaterial).uniforms;
        splitCamera(camAbs, u.uCamHi.value, u.uCamLo.value);
      }
      // The layer is a mode of its own (planet lines hidden): every path shows,
      // except on a craft close-up, where only its own does.
      const on = this.pathsOn && (!closeUp || this.emphasis > 0);
      this.path.past.visible = this.path.future.visible = on;
      this.path.pastTip.visible = this.path.futureTip.visible = on && this.path.pastTip.userData.on === true;
    }
    if (modeOf(seg) === 'sat') {
      const centerDist = Math.hypot(...s.r);
      const reach = scale.satelliteDistance(centerDist, this.mapper.body(seg.center)?.radiusKm ?? 6371);
      // An orbit reads as an orbit from outside it; from inside it is lines across the view.
      const extent = this.orbitExtent || reach * 1.5;
      const centre = this.mapper.sat(seg.center, this.tmp2.set(0, 0, 0), jd, this.tmp);
      this.orbit.position.copy(centre);
      const camToCenter = centre.distanceTo(camAbs);
      const inside = camToCenter < extent * ORBIT_INSIDE;
      const near = this.pathsOn && (this.emphasis > 0 || this.showAllOrbits || (!inside && !closeUp));
      this.orbit.visible = near;
      if (near && Math.abs(jd - this.orbitJd) > seg.step * 0.25) {
        this.orbitJd = jd;
        this.updateOrbit(seg);
      }
      this.setLine(ctx, this.orbit, (ORBIT_REST + (ORBIT_LIT - ORBIT_REST) * this.emphasis) * this.pathGain);
    } else {
      this.orbit.visible = false;
    }
  }

  /** Line opacity and width, faded within a few dozen craft sizes of the camera. */
  private setLine(ctx: FrameContext, l: Mesh, opacity: number): void {
    const u = (l.material as ShaderMaterial).uniforms;
    u.uOpacity.value = opacity;
    u.uFade.value.set(this.radius * 6, this.radius * 60);
    const px = (LINE_PX[0] + (LINE_PX[1] - LINE_PX[0]) * this.emphasis) * ctx.pixelRatio;
    u.uHalf.value = px / 2 / Math.max(ctx.viewportHeight, 1);
    // One device pixel of soft edge, in half-widths.
    u.uEdge.value = Math.min(1, 2 / Math.max(px, 2));
  }

  private setHidden(h: boolean): void {
    this.hidden = h;
    this.group.visible = !h;
    if (h) {
      this.orbit.visible = false;
      if (this.path) this.path.past.visible = this.path.future.visible = this.path.pastTip.visible = this.path.futureTip.visible = false;
    }
  }

  /** Kilometres → AU, for the info card. */
  get heliocentricDistanceAu(): number {
    return this.heliocentricDistanceKm / KM_PER_AU;
  }
}
