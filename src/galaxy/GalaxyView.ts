import { MathUtils, Mesh, MOUSE, PerspectiveCamera, Points, Quaternion, Scene, TOUCH, Vector3, type Texture } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import gsap from 'gsap';
import { ARM_LABELS, DISC_IMAGE, GALAXY_VIEW as GV, NEIGHBOURHOOD, SATELLITES, type GalaxyMarker } from '../config/galaxy';
import type { Loader } from '../core/Loader';
import type { Category, Facts } from '../config/deepsky';
import { RENDER } from '../config/visual';
import { zoomPanPath } from '../core/CameraRig';
import type { Engine } from '../core/Engine';
import type { FrameContext, Updatable } from '../core/types';
import type { Starfield } from '../bodies/Starfield';
import { GAL, GalaxyModel, imageToScene, markerPosition } from './GalaxyModel';
import { DeepSky } from './DeepSky';

/** Something a galaxy label points at. */
export interface GalaxyTarget {
  id: string;
  name: string;
  fact: string;
  kind: 'sun' | 'centre' | 'arm' | 'star' | 'satellite' | 'nebula' | 'galaxy' | 'blackhole' | 'pulsar' | 'system' | 'cluster' | 'planet';
  /** Rich card content for destinations. */
  facts?: Facts;
  category?: Category;
  /** Distance from the Sun for the card (pc). */
  distPc?: number;
  position: Vector3;
  range: readonly [number, number];
  framePc: number;
  priority: number;
  /** Arrive from this side (world, unit). */
  viewDir?: Vector3;
  /** Closest useful zoom (pc). */
  minPc?: number;
  /** Camera up on arrival (world); the Galactic pole when omitted. */
  up?: Vector3;
  /** Label only within this camera distance (pc). */
  maxDistPc?: number;
}

interface Tween {
  start: number;
  duration: number;
  ease: (t: number) => number;
  step: (e: number, raw: number) => void;
  done: () => void;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const UP_SCENE = new Vector3(0, 1, 0);
/** Below this camera distance from the Sun (pc), zooming in dives back into the Solar System. */
const DIVE_START_PC = 0.8;

/**
 * Galaxy scale (PLAN follow-up): a second scene in parsecs, centred on the
 * Sun and oriented like the solar scene, so it continues the same view
 * when the camera leaves the Solar System. Only the important parts are
 * modelled: the measured spiral arms (extended to a whole disc), the bar
 * and bulge, an old disc, a sparse halo, the satellite galaxies, nearby
 * landmark stars and the Galactic centre.
 *
 * The engine renders either the solar scene or this one. Entering pulls
 * the camera out along a zoom/pan path from the Sun to an overview of the
 * disc; zooming back towards the Sun (or the return button) dives in and
 * hands back to the solar view.
 */
export class GalaxyView implements Updatable {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly targets: GalaxyTarget[] = [];
  private activeFlag = false;
  private tween: Tween | null = null;
  private readonly sky: Mesh;
  private readonly skyStars: Points;
  readonly model = new GalaxyModel();
  readonly deep: DeepSky;
  private saved = { sky: 1, stars: 1 };
  private lastWheelIn = 0;
  private readonly enterFns = new Set<(on: boolean) => void>();
  private exitHandler: ((dir: Vector3) => void) | null = null;
  private readonly tmp = new Vector3();
  /** Position the camera follows (a target's live position), if any. */
  private follow: Vector3 | null = null;
  private readonly followLast = new Vector3();

  constructor(
    private readonly engine: Engine,
    private readonly starfield: Starfield,
    loader: Loader,
  ) {
    // Far enough for the farthest quasars (TON 618: 5.6 Gpc); log depth keeps precision.
    this.camera = new PerspectiveCamera(RENDER.fovDeg, 1, 1e-4, 1e11);
    // Orbit about the Galactic pole: the disc stays level.
    this.camera.up.copy(GAL.n);
    this.scene.add(this.camera);

    const c = new OrbitControls(this.camera, engine.canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.rotateSpeed = 0.5;
    // Zoom is ours (smooth, logarithmic, towards the cursor); see onWheel.
    c.enableZoom = false;
    c.minDistance = 0.05;
    c.maxDistance = GV.maxDistancePc;
    c.enabled = false;
    c.addEventListener('start', () => (this.tween = null));
    this.controls = c;
    engine.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    // The painted sky and the far stars, shared with the solar scene (same
    // geometry and materials): they carry on seamlessly, then fade out.
    this.sky = new Mesh(starfield.sky.geometry, starfield.sky.material);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = starfield.sky.renderOrder;
    this.skyStars = new Points(starfield.stars.geometry, starfield.stars.material);
    this.skyStars.frustumCulled = false;
    this.skyStars.renderOrder = starfield.stars.renderOrder;
    this.scene.add(this.sky, this.skyStars);

    this.scene.add(this.model.group);
    this.deep = new DeepSky(loader);
    this.scene.add(this.deep.group);
    // Disc picture: 2K first (its pixels also seed the disc stars), 4K later.
    loader
      .loadDeferred(DISC_IMAGE.low)
      .then((t) => {
        this.model.buildDiscStars(t.image as CanvasImageSource);
        this.model.setDiscTexture(t);
        return loader.loadDeferred(DISC_IMAGE.high);
      })
      .then((t) => this.model.setDiscTexture(t))
      .catch(() => {
        /* the particle halo and markers still show */
      });

    this.buildTargets();
    this.targets.push(...this.deep.targets);
    engine.addLate(this, 20);
  }

  private buildTargets(): void {
    this.targets.push({
      id: 'sun',
      name: 'Güneş · buradasınız',
      fact: "Güneş, Orion Kolu'nda, merkezden 26.700 ışık yılı uzakta; galaksinin çevresinde bir turunu yaklaşık 230 milyon yılda atar.",
      kind: 'sun',
      position: new Vector3(),
      range: [0, Infinity],
      framePc: 3,
      priority: 10,
    });
    this.targets.push({
      id: 'centre',
      name: 'Galaktik Merkez (Sgr A*)',
      fact: '4 milyon Güneş kütlesinde bir kara delik. Çevresindeki çubuk ve şişkinlik eski, sarımsı yıldızlarla dolu.',
      kind: 'centre',
      position: GAL.centre.clone(),
      range: [1500, Infinity],
      framePc: 9000,
      priority: 9,
    });
    for (const a of ARM_LABELS) {
      this.targets.push({
        id: a.id,
        name: a.name,
        fact:
          a.id === 'local'
            ? 'Güneş Sistemi bu küçük kolun içinde. Orion Bulutsusu ve Ülker de burada.'
            : a.id === 'bar'
              ? 'Merkezdeki yaklaşık 27.000 ışık yılı uzunluğunda yıldız çubuğu; yaşlı, sarımsı yıldızlardan oluşur.'
              : "Genç, mavi yıldızların ve yıldız doğum bölgelerinin yoğunlaştığı sarmal kol. Galaksinin öbür yanı tozun ardında kaldığı için henüz haritalanamadı.",
        kind: 'arm',
        position: imageToScene(a.at[0], a.at[1]),
        range: a.local ? [700, 30_000] : [3000, Infinity],
        framePc: a.local ? 2500 : 14_000,
        priority: a.local ? 6 : 5,
      });
    }
    const add = (m: GalaxyMarker, kind: GalaxyTarget['kind']) =>
      this.targets.push({
        id: m.id,
        name: m.name,
        fact: m.fact,
        kind,
        position: markerPosition(m),
        range: m.range,
        framePc: m.framePc,
        priority: m.priority,
      });
    NEIGHBOURHOOD.forEach((m) => add(m, 'star'));
    SATELLITES.forEach((m) => add(m, 'satellite'));
  }

  get active(): boolean {
    return this.activeFlag;
  }

  get isAnimating(): boolean {
    return this.tween !== null;
  }

  /** Camera distance from the Sun (pc). */
  get sunDistance(): number {
    return this.camera.position.length();
  }

  /** Zoom level: camera → pivot distance (pc). */
  // ---- Galaxy time: orbits, spins and discs of the destinations ----------------------

  private deepPausedFlag = false;
  private deepSpeedValue = 1;
  /** Animation clock (real seconds while running; stops when paused). */
  private deepClock = 0;
  private readonly timeFns = new Set<() => void>();
  static readonly SPEEDS = [1, 10, 100] as const;

  get deepPaused(): boolean {
    return this.deepPausedFlag;
  }

  set deepPaused(v: boolean) {
    this.deepPausedFlag = v;
    this.timeFns.forEach((fn) => fn());
  }

  get deepSpeed(): number {
    return this.deepSpeedValue;
  }

  /** 1× → 10× → 100× → 1×. */
  cycleDeepSpeed(): void {
    const S = GalaxyView.SPEEDS;
    this.deepSpeedValue = S[(S.indexOf(this.deepSpeedValue as (typeof S)[number]) + 1) % S.length];
    this.deepPausedFlag = false;
    this.timeFns.forEach((fn) => fn());
  }

  onTimeChange(fn: () => void): () => void {
    this.timeFns.add(fn);
    return () => this.timeFns.delete(fn);
  }

  get zoom(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  onActiveChange(fn: (on: boolean) => void): () => void {
    this.enterFns.add(fn);
    return () => this.enterFns.delete(fn);
  }

  /** Called with the Sun → camera direction when the view hands back. */
  setExitHandler(fn: (dir: Vector3) => void): void {
    this.exitHandler = fn;
  }

  /**
   * Orbit axis: the Galactic pole for the galaxy, a nebula's celestial
   * north on arrival there (its Hubble picture then stands upright).
   * OrbitControls fixes its axis at construction; re-derive it.
   */
  private setOrbitUp(up: Vector3): void {
    this.camera.up.copy(up).normalize();
    const c = this.controls as unknown as { _quat: Quaternion; _quatInverse: Quaternion };
    c._quat.setFromUnitVectors(this.camera.up, UP_SCENE);
    c._quatInverse.copy(c._quat).invert();
  }

  /** Map mode (free camera): left drag slides the view in the screen plane (up/down never dollies). */
  setMapMode(on: boolean): void {
    const c = this.controls;
    c.mouseButtons = on
      ? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
      : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    c.touches = on ? { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE } : { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    c.screenSpacePanning = true;
    c.panSpeed = on ? 1 : 0.8;
  }

  // ---- Enter / leave ------------------------------------------------------------------

  /**
   * Take over from the solar view. `dir`: Sun → camera, `quat`: the solar
   * camera's orientation, so the first galaxy frame looks the same.
   */
  enter(dir: Vector3, quat: Quaternion): void {
    if (this.activeFlag) return;
    this.activeFlag = true;
    const sm = this.starfield.sky.material.uniforms;
    const st = this.starfield.stars.material.uniforms;
    this.saved = { sky: sm.uBrightness.value as number, stars: st.uBrightness.value as number };
    this.sky.visible = this.starfield.sky.visible;

    const d0 = dir.clone().normalize();
    this.camera.position.copy(d0).multiplyScalar(GV.entryPc);
    this.camera.quaternion.copy(quat);
    this.camera.up.copy(UP_SCENE);
    this.controls.target.set(0, 0, 0);
    this.controls.enabled = false;
    this.engine.setView(this.scene, this.camera);
    this.enterFns.forEach((fn) => fn(true));
    void this.cinematicEntry();
  }

  private leave(): void {
    if (!this.activeFlag) return;
    this.activeFlag = false;
    this.tween = null;
    this.controls.enabled = false;
    this.engine.postfx.setBlackHole(null);
    const sm = this.starfield.sky.material.uniforms;
    const st = this.starfield.stars.material.uniforms;
    sm.uBrightness.value = this.saved.sky;
    st.uBrightness.value = this.saved.stars;
    const dir = this.camera.position.clone().normalize();
    this.enterFns.forEach((fn) => fn(false));
    this.exitHandler?.(dir);
  }

  // ---- Smooth zoom ------------------------------------------------------------------

  /** Pending zoom (log of the distance factor) and the cursor it heads for. */
  private zoomLog = 0;
  private readonly zoomCursor = { x: 0, y: 0 };

  private readonly onWheel = (e: WheelEvent) => {
    if (!this.activeFlag) return;
    e.preventDefault();
    if (e.deltaY < 0) this.lastWheelIn = performance.now();
    if (this.tween) return;
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.zoomLog = MathUtils.clamp(this.zoomLog + (MathUtils.clamp(px, -250, 250) / 100) * 0.55, -6, 6);
    this.zoomCursor.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.zoomCursor.y = -(e.clientY / window.innerHeight) * 2 + 1;
  };

  /**
   * Ease the pending zoom in: distance changes by e^step each frame, and
   * zooming in drifts the pivot towards the point under the cursor.
   */
  private applyZoom(dt: number): void {
    if (Math.abs(this.zoomLog) < 1e-4) {
      this.zoomLog = 0;
      return;
    }
    const step = this.zoomLog * (1 - Math.exp(-dt * 7));
    this.zoomLog -= step;
    const target = this.controls.target;
    const off = this.tmp.subVectors(this.camera.position, target);
    const d = off.length();
    const d1 = MathUtils.clamp(d * Math.exp(step), this.controls.minDistance, this.controls.maxDistance);
    if (step < 0) {
      // Point under the cursor at the pivot's depth.
      const ray = new Vector3(this.zoomCursor.x, this.zoomCursor.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
      const fwd = off.clone().negate().normalize();
      const t = d / Math.max(ray.dot(fwd), 0.2);
      const p = this.camera.position.clone().addScaledVector(ray, t);
      target.lerp(p, 1 - d1 / d);
    }
    off.setLength(d1);
    this.camera.position.copy(target).add(off);
  }

  /**
   * Leaving the Solar System: ease straight back from the Sun first (the
   * neighbourhood stars and nebulae drift past), then rise above the disc
   * and glide over to the overview — slow at both ends, never a jump.
   */
  private cinematicEntry(): Promise<void> {
    const el = MathUtils.degToRad(GV.overviewElevationDeg);
    const az = MathUtils.degToRad(-28);
    const dir1 = new Vector3()
      .addScaledVector(GAL.xs, Math.cos(el) * Math.cos(az))
      .addScaledVector(GAL.ys, Math.cos(el) * Math.sin(az))
      .addScaledVector(GAL.n, Math.sin(el));
    const dir0 = this.camera.position.clone().normalize();
    const up0 = this.camera.up.clone();
    const d0 = Math.max(this.camera.position.length(), 1e-6);
    const d1 = GV.overviewDistancePc;
    const l0 = Math.log(d0);
    const l1 = Math.log(d1);
    const dir = new Vector3();
    const tgt = new Vector3();
    const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
    const duration = reducedMotion() ? 1.2 : 10;
    this.controls.enabled = false;
    return new Promise((resolve) => {
      this.tween = {
        start: performance.now(),
        duration: duration * 1000,
        ease: (t) => t,
        step: (t) => {
          const k = smoother(t);
          // Distance in log steps, but quick through the near-empty
          // 2 pc to 2.5 kpc stretch and lingering where the disc appears.
          const keys = [
            [0, l0],
            [0.2, Math.log(2)],
            [0.42, Math.log(2500)],
            [1, l1],
          ];
          let dist: number = d1;
          for (let i = 1; i < keys.length; i++) {
            if (k <= keys[i][0]) {
              const f = (k - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
              dist = Math.exp(keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f);
              break;
            }
          }
          // The pivot slides to the centre only once we are far out.
          tgt.copy(GAL.centre).multiplyScalar(MathUtils.smoothstep(t, 0.45, 1));
          dir.copy(dir0).lerp(dir1, MathUtils.smoothstep(t, 0.3, 0.95));
          if (dir.lengthSq() < 1e-8) dir.copy(dir1);
          dir.normalize();
          this.camera.up.copy(up0).lerp(GAL.n, MathUtils.smoothstep(t, 0.2, 0.9)).normalize();
          this.controls.target.copy(tgt);
          this.camera.position.copy(tgt).addScaledVector(dir, dist);
          this.camera.lookAt(tgt);
        },
        done: resolve,
      };
    });
  }

  /** The whole disc from above, the Sun's side towards the viewer. */
  overview(fromEntry = false): Promise<void> {
    this.follow = null;
    this.controls.minDistance = 0.05;
    const el = MathUtils.degToRad(GV.overviewElevationDeg);
    const az = MathUtils.degToRad(-28);
    const dir = new Vector3()
      .addScaledVector(GAL.xs, Math.cos(el) * Math.cos(az))
      .addScaledVector(GAL.ys, Math.cos(el) * Math.sin(az))
      .addScaledVector(GAL.n, Math.sin(el));
    return this.flyTo(GAL.centre, GV.overviewDistancePc, dir, fromEntry ? GV.pullOutMinS : 0);
  }

  /** Dive to the Sun and hand back to the Solar System. */
  returnToSun(): Promise<void> {
    this.follow = null;
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) dir.copy(GAL.n);
    // Arrive from the current side, a little above the ecliptic.
    const toCam = this.camera.position.lengthSq() > 1e-12 ? this.camera.position.clone().normalize() : dir.normalize();
    return this.flyTo(new Vector3(), GV.exitPc * 0.8, toCam, 0, UP_SCENE).then(() => this.leave());
  }

  /** Fly to a label's object. */
  flyToTarget(t: GalaxyTarget): Promise<void> {
    if (t.kind === 'sun') return this.returnToSun();
    this.controls.minDistance = t.minPc ?? 0.05;
    // Keep moving targets (stars in orbit, a hole in a binary) centred.
    this.follow = t.position;
    if (t.viewDir) return this.flyTo(t.position, t.framePc, t.viewDir, 0, t.up ?? GAL.n);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    // Keep a pleasant angle on the disc: at least 25° above it.
    const minEl = Math.sin(MathUtils.degToRad(25));
    const h = dir.dot(GAL.n);
    if (h < minEl) {
      dir.addScaledVector(GAL.n, minEl - h).normalize();
    }
    return this.flyTo(t.position, t.framePc, dir, 0);
  }

  /**
   * Zoom/pan path flight (same maths as the solar camera). `up` blends the
   * camera's roll from the scene's up (solar view) to the Galactic pole,
   * or back when diving into the Solar System.
   */
  private flyTo(target: Vector3, distance: number, direction: Vector3, minS: number, upEnd = GAL.n): Promise<void> {
    const t0 = this.controls.target.clone();
    const off = this.camera.position.clone().sub(t0);
    const d0 = Math.max(off.length(), 1e-6);
    const dir0 = off.divideScalar(d0);
    const dir1 = direction.clone().normalize();
    const up0 = this.camera.up.clone();
    const wpd = 2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const travel = target.distanceTo(t0);
    const path = zoomPanPath(d0 * wpd, distance * wpd, travel, 1.4);
    const reduce = reducedMotion();
    // Unhurried: long trips take their time instead of snapping across.
    const duration = reduce ? 0.8 : MathUtils.clamp(1.6 + 0.45 * path.S, Math.max(minS, 2.5), 11);
    const uw: [number, number] = [0, 0];
    const dir = new Vector3();
    const tgt = new Vector3();
    this.controls.enabled = false;
    return new Promise((resolve) => {
      this.tween = {
        start: performance.now(),
        duration: duration * 1000,
        ease: gsap.parseEase(reduce ? 'sine.inOut' : 'power2.inOut'),
        step: (e, raw) => {
          path.at(path.S * e, uw);
          const along = raw >= 1 ? 1 : path.u1 > 0 ? MathUtils.clamp(uw[0] / path.u1, 0, 1) : e;
          tgt.copy(t0).lerp(target, along);
          dir.copy(dir0).lerp(dir1, e);
          if (dir.lengthSq() < 1e-8) dir.copy(dir1);
          dir.normalize();
          const dist = raw >= 1 ? distance : uw[1] / wpd;
          this.camera.up.copy(up0).lerp(upEnd, MathUtils.smoothstep(e, 0.15, 0.85)).normalize();
          this.controls.target.copy(tgt);
          this.camera.position.copy(tgt).addScaledVector(dir, dist);
          this.camera.lookAt(tgt);
        },
        done: resolve,
      };
    });
  }

  // ---- Frame ---------------------------------------------------------------------------

  update(ctx: FrameContext): void {
    if (!this.activeFlag) return;
    const solar = this.engine.camera;
    if (this.camera.aspect !== solar.aspect) {
      this.camera.aspect = solar.aspect;
      this.camera.updateProjectionMatrix();
    }

    // Destinations move first (orbits), so flights and following see this
    // frame's positions.
    const running = !this.deepPausedFlag;
    if (running) this.deepClock += ctx.time.delta;
    this.deep.update(running ? ctx.time.delta * this.deepSpeedValue : 0, this.deepClock, this.camera, this.zoom);

    const tw = this.tween;
    if (tw) {
      const raw = Math.min(1, (performance.now() - tw.start) / tw.duration);
      tw.step(tw.ease(raw), raw);
      if (raw >= 1) {
        this.tween = null;
        if (this.follow) this.followLast.copy(this.follow);
        this.setOrbitUp(this.camera.up);
        this.controls.enabled = true;
        tw.done();
      }
    } else {
      this.controls.enabled = true;
      this.applyZoom(ctx.time.delta);
      // Follow the target's motion (orbiting bodies), keeping the view.
      if (this.follow) {
        this.tmp.subVectors(this.follow, this.followLast);
        if (this.tmp.lengthSq() > 0) {
          this.camera.position.add(this.tmp);
          this.controls.target.add(this.tmp);
        }
        this.followLast.copy(this.follow);
      }
      this.controls.update();
      // Zooming in on the Sun: dive back into the Solar System.
      if (this.sunDistance < DIVE_START_PC && performance.now() - this.lastWheelIn < 400) void this.returnToSun();
    }

    // Near plane follows the zoom (log depth keeps precision).
    const near = MathUtils.clamp(this.zoom * 0.01, 1e-11, 50);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    // Fades: painted sky out, disc glow in, as the camera leaves the neighbourhood.
    const d = this.sunDistance;
    const skyK = 1 - MathUtils.smoothstep(d, GV.skyFade[0], GV.skyFade[1]);
    this.starfield.sky.material.uniforms.uBrightness.value = this.saved.sky * skyK;
    this.starfield.stars.material.uniforms.uBrightness.value = this.saved.stars * skyK;
    this.sky.visible = this.starfield.sky.visible && skyK > 0.001;
    this.skyStars.visible = skyK > 0.001;
    // The disc slices only make sense from outside: fade with the zoom too
    // (zoomed into a nebula or the centre the slices would cut the view).
    const discD = Math.min(d, this.zoom * 4);
    this.model.setDiscIntensity(GV.glowIntensity * MathUtils.smoothstep(discD, GV.glowFade[0], GV.glowFade[1]));
    this.model.update(this.camera);
    // Beyond the Milky Way: the distant galaxies take over as the painted sky fades.
    this.model.setDeepField(1 - skyK);

    const sky = this.starfield.sky.material.uniforms.uMap.value as Texture | null;
    this.engine.postfx.setBlackHole(this.deep.blackHole(this.camera, window.innerHeight, sky, this.deepClock));

    // Zoomed into an object the disc is only a backdrop: dimmer.
    const fieldK =
      MathUtils.smoothstep(d, GV.fieldFade[0], GV.fieldFade[1]) * MathUtils.lerp(0.3, 1, MathUtils.smoothstep(this.zoom, 60, 4000));
    // Zoomed in (inside the disc), the field is a backdrop: smaller points.
    const fieldMaxPx = MathUtils.lerp(2.2, GV.maxPointPx, MathUtils.smoothstep(this.zoom, 300, 8000));
    for (const p of this.model.field) {
      p.material.uniforms.uBrightness.value = (p.userData.baseBrightness as number) * fieldK;
      p.material.uniforms.uMaxPx.value = fieldMaxPx;
      p.visible = fieldK > 0.001;
    }

    const scale = ctx.viewportHeight / (2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2));
    for (const p of this.model.points) p.material.uniforms.uScale.value = scale;
    for (const m of this.deep.scaled()) m.uniforms.uScale.value = scale;
  }

  /** Screen position (CSS px) and depth of a scene point, or null when behind. */
  project(p: Vector3, w: number, h: number): { x: number; y: number } | null {
    this.tmp.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
    if (this.tmp.z >= 0) return null;
    this.tmp.copy(p).project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h };
  }
}
