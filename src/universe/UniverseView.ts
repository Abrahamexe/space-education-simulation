import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, MathUtils, PerspectiveCamera, Scene, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import gsap from 'gsap';
import { RENDER } from '../config/visual';
import { comovingMpc, LANDMARKS, SCALES, UNIVERSE_VIEW as UV, type Landmark, type Scale } from '../config/universe';
import { zoomPanPath } from '../core/CameraRig';
import type { Engine } from '../core/Engine';
import type { FrameContext, Updatable } from '../core/types';
import { EQ_TO_SCENE, radecUnit, UniverseModel } from './UniverseModel';
import { AGE_NOW, CosmicWebSim } from './CosmicWebSim';

/** Formation time-lapse: first moment shown (Gyr, the CMB) and the pace (decades of time per second). */
const SIM_T0 = 3.8e-4;
const SIM_DECADES_PER_S = 0.32;

interface Tween {
  start: number;
  duration: number;
  ease: (t: number) => number;
  step: (e: number, raw: number) => void;
  done: () => void;
}

/** A labelled place on the map, in scene Mpc. */
export interface UniverseTarget {
  def: Landmark;
  position: Vector3;
  distMpc: number;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scene direction of an equatorial RA/Dec. */
function sceneDir(ra: number, dec: number, out = new Vector3()): Vector3 {
  return radecUnit(ra, dec, out).applyMatrix4(EQ_TO_SCENE).normalize();
}

/**
 * The universe map: a third scene, in megaparsecs, with the Milky Way at
 * the origin and the same orientation as the galaxy scene, so the hand-over
 * keeps the line of sight. Orbits about the supergalactic pole (the plane
 * the nearby structures lie in). Entered from the galaxy view's "Evrene çık"
 * button only; the return flies back to the Milky Way and hands over.
 */
export class UniverseView implements Updatable {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly model = new UniverseModel();
  readonly targets: UniverseTarget[];
  /** Supergalactic north pole, scene frame. */
  readonly up = sceneDir(283.75, 15.71);
  private activeFlag = false;
  private tween: Tween | null = null;
  private readonly fns = new Set<(on: boolean) => void>();
  private readonly settingFns = new Set<() => void>();
  private exitHandler: ((dir: Vector3) => void) | null = null;
  private readonly tmp = new Vector3();
  private zoomLog = 0;
  private readonly zoomCursor = { x: 0, y: 0 };
  private clock = 0;
  private returning = false;

  /** Look: cinematic glow or a plain scientific map. */
  private scienceFlag = false;
  private darkMatterFlag = true;
  private flowFlag = true;
  private basinFlag = true;
  private galaxiesFlag = true;
  /** The formation time-lapse (built on first use). */
  private sim: CosmicWebSim | null = null;
  private simOn = false;
  private simT = SIM_T0;
  private simPlaying = true;
  readonly simLayers = { darkMatter: true, gas: true, galaxies: true, slab: true };
  private gasFlag = false;

  /** Supergalactic grid: rings every 50 Mpc in the supergalactic plane and the SGX / SGY axes. */
  readonly sgGrid = new Group();

  private buildSgGrid(): void {
    const x = sceneDir(42.31, 59.53); // SGL = 0, SGB = 0
    const z = this.up.clone();
    const y = new Vector3().crossVectors(z, x).normalize();
    const pts: number[] = [];
    for (const r of [50, 100, 150, 200]) {
      for (let i = 0; i < 128; i++) {
        const a0 = (i / 128) * Math.PI * 2;
        const a1 = ((i + 1) / 128) * Math.PI * 2;
        for (const a of [a0, a1]) {
          const p = x.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(y, Math.sin(a) * r);
          pts.push(p.x, p.y, p.z);
        }
      }
    }
    for (const ax of [x, y]) {
      const p0 = ax.clone().multiplyScalar(-220);
      const p1 = ax.clone().multiplyScalar(220);
      pts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    const lines = new LineSegments(g, new LineBasicMaterial({ color: 0x6f8fb8, transparent: true, opacity: 0.35, depthWrite: false }));
    lines.frustumCulled = false;
    this.sgGrid.add(lines);
    this.sgGrid.visible = false;
    this.sgAxes = { x, y };
  }

  /** Supergalactic X and Y directions (scene frame), for axis labels. */
  sgAxes = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0) };

  constructor(private readonly engine: Engine) {
    this.camera = new PerspectiveCamera(RENDER.fovDeg, 1, 1e-4, 1e6);
    this.camera.up.copy(this.up);
    this.scene.add(this.camera, this.model.group, this.model.sceneGroup, this.sgGrid);
    this.buildSgGrid();
    const c = new OrbitControls(this.camera, engine.canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.rotateSpeed = 0.5;
    c.enableZoom = false;
    c.screenSpacePanning = true;
    c.minDistance = UV.minMpc;
    c.maxDistance = UV.maxMpc;
    c.enabled = false;
    c.addEventListener('start', () => (this.tween = null));
    this.controls = c;
    engine.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.targets = LANDMARKS.map((def) => {
      const d = def.distMpc ?? comovingMpc(def.z ?? 0);
      return { def, distMpc: d, position: sceneDir(def.ra, def.dec).multiplyScalar(d) };
    });
    engine.addLate(this, 20);
  }

  get active(): boolean {
    return this.activeFlag;
  }

  onActiveChange(fn: (on: boolean) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  /** Look or layer switched (the HUD re-syncs its buttons). */
  onSettingsChange(fn: () => void): () => void {
    this.settingFns.add(fn);
    return () => this.settingFns.delete(fn);
  }

  setExitHandler(fn: (dir: Vector3) => void): void {
    this.exitHandler = fn;
  }

  get science(): boolean {
    return this.scienceFlag;
  }
  set science(v: boolean) {
    this.scienceFlag = v;
    this.settingFns.forEach((f) => f());
  }
  get darkMatter(): boolean {
    return this.darkMatterFlag;
  }
  set darkMatter(v: boolean) {
    this.darkMatterFlag = v;
    this.settingFns.forEach((f) => f());
  }
  get flow(): boolean {
    return this.flowFlag;
  }
  set flow(v: boolean) {
    this.flowFlag = v;
    this.settingFns.forEach((f) => f());
  }

  get simActive(): boolean {
    return this.simOn;
  }
  get simTime(): number {
    return this.simT;
  }
  set simTime(t: number) {
    this.simT = Math.min(Math.max(t, SIM_T0), AGE_NOW);
    this.settingFns.forEach((f) => f());
  }
  get simRunning(): boolean {
    return this.simPlaying;
  }
  set simRunning(v: boolean) {
    // Play from the start again once the end is reached.
    if (v && this.simT >= AGE_NOW - 1e-3) this.simT = SIM_T0;
    this.simPlaying = v;
    this.settingFns.forEach((f) => f());
  }
  setSimLayer(k: keyof UniverseView['simLayers'], v: boolean): void {
    this.simLayers[k] = v;
    this.settingFns.forEach((f) => f());
  }

  /** Open the formation time-lapse: the map gives way to a 300 Mpc box of matter. */
  enterSim(): void {
    if (this.simOn) return;
    this.sim ??= new CosmicWebSim();
    if (!this.sim.group.parent) this.scene.add(this.sim.group);
    this.simOn = true;
    this.simT = SIM_T0;
    this.simPlaying = true;
    this.sim.group.visible = true;
    this.model.group.visible = false;
    this.model.sceneGroup.visible = false;
    // Looking down on the slab (the box's z axis), slightly tilted.
    void this.flyTo(new Vector3(), 330, new Vector3(0.12, 0.2, 1).normalize(), 0);
    this.settingFns.forEach((f) => f());
  }

  /** Rebuild the time-lapse with other parameters (lab experiment) and show today. */
  rebuildSim(opts: { amp: number; om: number }): void {
    if (this.sim) {
      this.scene.remove(this.sim.group);
      for (const p of [this.sim.darkMatter, this.sim.gas, this.sim.galaxies]) {
        p.geometry.dispose();
        p.material.dispose();
      }
    }
    this.sim = new CosmicWebSim(7, opts);
    this.scene.add(this.sim.group);
    if (!this.simOn) this.enterSim();
    this.sim.group.visible = true;
    this.simT = AGE_NOW;
    this.simPlaying = false;
    this.settingFns.forEach((f) => f());
  }

  /** Parameters of the current time-lapse. */
  get simParams(): { amp: number; om: number } {
    return { amp: this.sim?.amp ?? 1, om: this.sim?.om ?? 0.31 };
  }

  exitSim(): void {
    if (!this.simOn) return;
    this.simOn = false;
    if (this.sim) this.sim.group.visible = false;
    this.model.group.visible = true;
    this.model.sceneGroup.visible = true;
    void this.goScale(SCALES[1]);
    this.settingFns.forEach((f) => f());
  }

  get galaxies(): boolean {
    return this.galaxiesFlag;
  }
  set galaxies(v: boolean) {
    this.galaxiesFlag = v;
    this.settingFns.forEach((f) => f());
  }
  get gas(): boolean {
    return this.gasFlag;
  }
  set gas(v: boolean) {
    this.gasFlag = v;
    this.settingFns.forEach((f) => f());
  }

  get basin(): boolean {
    return this.basinFlag;
  }
  set basin(v: boolean) {
    this.basinFlag = v;
    this.settingFns.forEach((f) => f());
  }

  /** Camera distance from the Milky Way (Mpc). */
  get distance(): number {
    return this.camera.position.length();
  }

  /** Camera distance to the pivot (Mpc). */
  get zoom(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Data and textures, ahead of the hand-over. */
  prepare(): Promise<void> {
    return this.model.load().then(() => this.engine.postfx.uploadTextures(this.scene));
  }

  /** Take over from the galaxy view: `dir` is Milky Way → camera (scene frame). */
  enter(dir: Vector3): void {
    if (this.activeFlag) return;
    this.activeFlag = true;
    this.returning = false;
    this.camera.position.copy(dir).normalize().multiplyScalar(UV.entryMpc);
    this.camera.up.copy(this.up);
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls.enabled = false;
    this.engine.setView(this.scene, this.camera);
    this.fns.forEach((f) => f(true));
    void this.goScale(SCALES[1], 7);
  }

  private leave(): void {
    if (!this.activeFlag) return;
    this.exitSim();
    this.activeFlag = false;
    this.tween = null;
    this.controls.enabled = false;
    const dir = this.camera.position.clone().normalize();
    this.fns.forEach((f) => f(false));
    this.exitHandler?.(dir);
  }

  /** Back to the galaxy: fly to the Milky Way, then hand over. */
  returnHome(): Promise<void> {
    if (this.returning || !this.activeFlag) return Promise.resolve();
    this.returning = true;
    const dir = this.camera.position.lengthSq() > 1e-12 ? this.camera.position.clone().normalize() : this.up.clone();
    return this.flyTo(new Vector3(), UV.entryMpc, dir, 2.5).then(() => this.leave());
  }

  /** The scale last flown to (drives the scale path). */
  scaleId: Scale['id'] = SCALES[1].id;

  goScale(s: Scale, minS = 0): Promise<void> {
    this.scaleId = s.id;
    const pivot = sceneDir(s.ra, s.dec).multiplyScalar(s.distMpc);
    // From above the supergalactic plane, a little tilted.
    const dir = s.view
      ? sceneDir(s.view[0], s.view[1])
      : this.up.clone().multiplyScalar(0.75).add(sceneDir(s.ra + 180, 0).multiplyScalar(0.66)).normalize();
    return this.flyTo(pivot, s.frameMpc, dir, minS);
  }

  goTarget(t: UniverseTarget): Promise<void> {
    if (t.def.kind === 'edge') return this.goScale(SCALES[3]);
    // Arrive from the Milky Way's side so the way home stays in view.
    const fromHome = t.position.lengthSq() > 1e-9 ? t.position.clone().normalize().negate() : this.up.clone();
    const dir = fromHome.multiplyScalar(0.6).add(this.up.clone().multiplyScalar(0.8)).normalize();
    return this.flyTo(t.position, t.def.frameMpc, dir, 0);
  }

  // ---- Camera motion ----------------------------------------------------------------------

  private readonly onWheel = (e: WheelEvent) => {
    if (!this.activeFlag) return;
    e.preventDefault();
    if (this.tween) return;
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.zoomLog = MathUtils.clamp(this.zoomLog + (MathUtils.clamp(px, -250, 250) / 100) * 0.55, -6, 6);
    this.zoomCursor.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.zoomCursor.y = -(e.clientY / window.innerHeight) * 2 + 1;
  };

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
      const ray = new Vector3(this.zoomCursor.x, this.zoomCursor.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
      const fwd = off.clone().negate().normalize();
      const t = d / Math.max(ray.dot(fwd), 0.2);
      const p = this.camera.position.clone().addScaledVector(ray, t);
      target.lerp(p, 1 - d1 / d);
    }
    off.setLength(d1);
    this.camera.position.copy(target).add(off);
  }

  /** Zoom-and-pan flight (van Wijk–Nuij), constant perceived speed. */
  private flyTo(target: Vector3, distance: number, direction: Vector3, minS: number): Promise<void> {
    const t0 = this.controls.target.clone();
    const off = this.camera.position.clone().sub(t0);
    const d0 = Math.max(off.length(), 1e-6);
    const dir0 = off.divideScalar(d0);
    const dir1 = direction.clone().normalize();
    const up0 = this.camera.up.clone();
    const wpd = 2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const path = zoomPanPath(d0 * wpd, distance * wpd, target.distanceTo(t0), 1.4);
    const reduce = reducedMotion();
    const duration = reduce ? 0.8 : MathUtils.clamp(1.6 + 0.4 * path.S, Math.max(minS, 2.5), 11);
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
          this.camera.up.copy(up0).lerp(this.up, MathUtils.smoothstep(e, 0.1, 0.8)).normalize();
          this.controls.target.copy(tgt);
          this.camera.position.copy(tgt).addScaledVector(dir, dist);
          this.camera.lookAt(tgt);
        },
        done: resolve,
      };
    });
  }

  // ---- Frame ----------------------------------------------------------------------------

  update(ctx: FrameContext): void {
    if (!this.activeFlag) return;
    const solar = this.engine.camera;
    if (this.camera.aspect !== solar.aspect) {
      this.camera.aspect = solar.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.clock += ctx.time.delta;

    const tw = this.tween;
    if (tw) {
      const raw = Math.min(1, (performance.now() - tw.start) / tw.duration);
      tw.step(tw.ease(raw), raw);
      if (raw >= 1) {
        this.tween = null;
        this.controls.enabled = true;
        tw.done();
        if (!this.activeFlag) return;
      }
    } else {
      this.controls.enabled = true;
      this.applyZoom(ctx.time.delta);
      this.controls.update();
    }

    const zoom = Math.max(this.zoom, 1e-6);
    const near = MathUtils.clamp(zoom * 0.002, 1e-5, 20);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    const scale = ctx.viewportHeight / (2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2));
    if (this.simOn && this.sim) {
      if (this.simPlaying) {
        // Logarithmic in time: the early, fast-changing epochs get their share of the show.
        const lt = Math.log10(this.simT) + ctx.time.delta * SIM_DECADES_PER_S;
        this.simT = Math.min(10 ** lt, AGE_NOW);
        if (this.simT >= AGE_NOW) {
          this.simPlaying = false;
          this.settingFns.forEach((f) => f());
        }
      }
      const s = this.sim;
      s.setTime(this.simT);
      s.setScale(scale);
      // Gas joins after recombination, falling into the wells dark matter has already dug.
      const gasIn = MathUtils.smoothstep(Math.log10(this.simT), Math.log10(0.04), Math.log10(0.6));
      s.darkMatter.material.uniforms.uBrightness.value = this.simLayers.darkMatter ? 0.42 : 0;
      s.gas.material.uniforms.uBrightness.value = this.simLayers.gas ? 0.12 * gasIn : 0;
      s.galaxies.material.uniforms.uBrightness.value = this.simLayers.galaxies ? 1.6 : 0;
      s.setSlab(this.simLayers.slab ? 22 : 0);
      s.darkMatter.visible = this.simLayers.darkMatter;
      s.gas.visible = this.simLayers.gas;
      s.galaxies.visible = this.simLayers.galaxies;
      return;
    }
    const m = this.model;
    const d = this.distance;
    const sci = this.scienceFlag;
    const fadeIn = (a: readonly [number, number]) => MathUtils.smoothstep(d, a[0], a[1]);
    const out = (a: number, b: number) => 1 - MathUtils.smoothstep(d, a, b);
    const set = (p: (typeof m.pointLayers)[number] | null, b: number, minPx: number) => {
      if (!p) return;
      const u = p.material.uniforms;
      u.uScale.value = scale;
      u.uBrightness.value = b;
      u.uCrisp.value = sci ? 1 : 0;
      u.uMinPx.value = sci ? Math.max(minPx, 1.6) : minPx;
      p.visible = b > 0.002;
    };
    // The Milky Way's glow gives way to its disc picture up close.
    set(m.milkyWay, 1.6 * MathUtils.smoothstep(d, 0.15, 1.2), 5);
    const lgK = 1 - fadeIn(UV.localGroupFade);
    for (const p of m.photos) {
      const u = p.mesh.material.uniforms;
      u.uOpacity.value = (sci ? 0.9 : 1.25) * lgK;
      p.mesh.visible = lgK > 0.002 && u.uMap.value !== null;
    }
    // Evidence pictures: from a few dozen of their own widths in (the data frame equals scene up to rotation).
    for (const p of m.evidencePhotos) {
      const dist = this.tmp.copy(p.centre).applyMatrix4(EQ_TO_SCENE).distanceTo(this.camera.position);
      const k = 1 - MathUtils.smoothstep(dist, p.widthMpc * 25, p.widthMpc * 90);
      const u = p.mesh.material.uniforms;
      u.uOpacity.value = 1.3 * k;
      p.mesh.visible = k > 0.002 && u.uMap.value !== null;
    }
    {
      const u = m.milkyWayDisc.material.uniforms;
      u.uOpacity.value = 1.1 * (1 - MathUtils.smoothstep(d, 3, 12));
      m.milkyWayDisc.visible = u.uOpacity.value > 0.002 && u.uMap.value !== null;
    }
    set(m.localGroup, (sci ? 1 : 1.6) * (1 - fadeIn(UV.localGroupFade) * 0.85), 2);
    const gal = this.galaxiesFlag ? 1 : 0;
    set(m.twoMrs, gal * (sci ? 0.6 : 1.4) * fadeIn(UV.twoMrsFade) * out(1500, 5000), 1.2);
    set(m.sdss, gal * (sci ? 1.4 : 2.4) * fadeIn(UV.sdssFade) * out(6000, 20000), 1);
    // Hot gas: soft glows, never crisp (it is diffuse even in the science look).
    if (m.gas) {
      set(m.gas, (this.gasFlag ? 1 : 0) * 1.1 * fadeIn([4, 12]) * out(8000, 25000), 3.5);
      m.gas.material.uniforms.uCrisp.value = 0;
    }

    if (m.density) {
      const k = this.darkMatterFlag ? fadeIn([6, 25]) * out(1500, 5000) : 0;
      const u = m.density.material.uniforms;
      u.uIntensity.value = (sci ? 1.6 : 1.3) * k;
      u.uScience.value = sci ? 1 : 0;
      m.toData(this.camera.position, u.uCamObj.value);
      m.density.visible = k > 0.002;
    }
    if (m.flow) {
      const k = this.flowFlag ? fadeIn(UV.flowFade) * out(900, 3000) : 0;
      const u = m.flow.material.uniforms;
      u.uOpacity.value = (sci ? 0.6 : 0.55) * k;
      u.uScience.value = sci ? 1 : 0;
      u.uTime.value = this.clock;
      // Pulses / arrows spaced for the zoom.
      u.uPeriod.value = MathUtils.clamp(zoom * 0.04, 3, 40);
      m.flow.visible = k > 0.002;
      // Drifting galaxies: the motion itself (cinematic only; the science look keeps the arrows).
      if (m.flowParticles) {
        const kp = sci ? 0 : k;
        set(m.flowParticles, 0.9 * kp, 1);
        m.updateParticles(ctx.time.delta, MathUtils.clamp(zoom / 60, 0.5, 6));
      }
    }
    if (m.basin) {
      const k = this.basinFlag ? fadeIn([20, 60]) * out(2000, 6000) : 0;
      const u = m.basin.material.uniforms;
      u.uIntensity.value = (sci ? 3 : 4) * k;
      m.toData(this.camera.position, u.uCamObj.value);
      m.basin.visible = k > 0.002;
    }
    m.cmb.material.uniforms.uOpacity.value = 0.55 * fadeIn(UV.cmbFade);
    m.cmb.visible = d > UV.cmbFade[0];
  }

  /** Screen position (CSS px) of a scene point, or null when behind the camera. */
  project(p: Vector3, w: number, h: number): { x: number; y: number } | null {
    this.tmp.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
    if (this.tmp.z >= 0) return null;
    this.tmp.copy(p).project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h };
  }

  /** The scale whose framing is closest to the current camera distance. */
  currentScale(): Scale {
    const d = Math.max(this.distance, this.zoom);
    let best = SCALES[0];
    let bd = Infinity;
    for (const s of SCALES) {
      const e = Math.abs(Math.log(d / s.frameMpc));
      if (e < bd) {
        bd = e;
        best = s;
      }
    }
    return best;
  }
}
