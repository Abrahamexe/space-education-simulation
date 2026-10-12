import { Color, MathUtils, Matrix3, Vector3, type Texture } from 'three';
import { KM_PER_AU } from '../config/astro';
import {
  ADD_PRESETS,
  GM_KM3S2,
  GM_KM_TO_AU,
  luminosityOf,
  massInSun,
  QUASAR_EDDINGTON,
  type AddPreset,
  type Scenario,
} from '../config/playground';
import { scale } from '../core/scale';
import { sunUniforms } from '../core/lighting';
import type { Engine } from '../core/Engine';
import type { FrameContext, Focusable } from '../core/types';
import type { Loader } from '../core/Loader';
import type { BlackHoleView, DiscLook } from '../core/effects/BlackHoleEffect';
import type { SolarSystem } from '../bodies/SolarSystem';
import type { Sun } from '../bodies/Sun';
import type { Starfield } from '../bodies/Starfield';
import type { GalacticMotion } from '../bodies/GalacticMotion';
import type { CelestialBody } from '../bodies/CelestialBody';
import { Planet } from '../bodies/Planet';
import { ECLIPTIC_TO_SCENE, SCENE_TO_ECLIPTIC, SCENE_TO_GALACTIC } from '../physics/frames';
import { positionFromEccentricAnomaly, solveKepler, type OrbitalElements } from '../physics/orbits';
import { C_AU_DAY, GM_SUN, type SimBodyInit, type SimEvent } from './nbody';
import { keplerStep, periapsis } from './kepler';
import type { BodyMeta, FromWorker, ToWorker } from './physics.worker';
import { AddedView, RS_KM_PER_SUN } from './AddedView';
import { Trails } from './Trails';
import { temperatureColor } from '../galaxy/objects/common';
import { Climate, fmtDays, quasarLuminosity } from './Climate';
import { Guides } from './Guides';
import { Outflow } from './Outflow';
import { DebrisView } from './DebrisView';
import { CAMERA } from '../config/visual';

const AU_DAY_TO_KM_S = KM_PER_AU / 86_400;
/** Slow motion after a body is torn apart: ~30 simulated minutes per second, for 5 s. */
const SLOWMO_RATE = 0.02;
const SLOWMO_MS = 5000;
/**
 * An isolated black hole would only bend the stars behind it, which is hard
 * to find in a dark sky: a faint disc of thin gas marks it (a visual aid).
 * Once it tears a star apart, the bright feeding disc takes over.
 */
const QUIET_DISC: DiscLook = {
  inner: 3,
  outer: 10,
  gain: 0.55,
  doppler: 0.2,
  hot: new Color(1.0, 0.85, 0.7),
  warm: new Color(0.9, 0.4, 0.15),
};
const QUASAR_DISC: DiscLook = {
  inner: 3,
  outer: 22,
  gain: 2.6,
  doppler: 0.35,
  hot: new Color(0.8, 0.88, 1.0),
  warm: new Color(1.0, 0.72, 0.45),
};
const FEED_DISC: DiscLook = {
  inner: 3,
  outer: 16,
  gain: 2.0,
  doppler: 0.25,
  hot: new Color(1.0, 0.92, 0.78),
  warm: new Color(1.0, 0.5, 0.16),
};

export interface AddSpec {
  preset: AddPreset;
  /** Display name (default: the preset's). */
  name?: string;
  massSun: number;
  /** Heliocentric ecliptic position, AU. */
  posAu: Vector3;
  /** Velocity relative to the Sun, ecliptic, km/s. */
  velKmS: Vector3;
}

export interface LogEntry {
  jd: number;
  text: string;
  type: SimEvent['type'] | 'added' | 'removed' | 'info' | 'radiation' | 'damage';
}

/**
 * High-energy radiation from a pulsar at the Earth. A Vela-like pulsar
 * emits ~10²⁷ W in γ- and X-rays (Fermi-LAT): 3 550 W/m² at 1 AU. Compared
 * with the Sun's X-ray + extreme-UV at the Earth (~4.6 mW/m²).
 */
const RADIATION_LEVELS = [
  'Güvenli: Güneş’in kendi X/UV ışınımından az.',
  'Ozon tabakası incelir: yüzeyde UV artar.',
  'Ozon tabakası yok olur: yüzeydeki canlılar için ölümcül UV.',
  'Yüzey sterilize olur, atmosfer aşınır.',
];

export interface EarthStatus {
  alive: boolean;
  distanceAu: number;
  aAu: number;
  e: number;
  yearDays: number;
  flux: number;
  tempC: number;
  zone: 'hz' | 'hot' | 'cold' | 'none';
  nearest: { name: string; au: number } | null;
  /** High-energy (X/γ/EUV) dose at the Earth, relative to the Sun's today. */
  radiation: { wm2: number; ratio: number; level: number; text: string } | null;
  atm: number | null;
  integrity: number;
  tide: number;
  /** Light / gravity on its way: source and days left. */
  arrivals: { name: string; days: number }[];
  /** The Solar System falling towards a heavy added body (its pull has arrived). */
  fall: FallStatus | null;
}

/** What an added body does to the Earth, in numbers (see Playground.influence). */
export interface Influence {
  /** Distance from the Sun and from the Earth, AU. */
  sunAu: number;
  earthAu: number;
  /** Days until its pull reaches the Earth (0: it has). */
  pullInDays: number;
  /** Its pull on the Earth, relative to the Sun's. */
  pull: number;
  /**
   * What actually bends the Earth's orbit: the difference between its pull
   * on the Earth and on the Sun (tide), relative to the Sun's pull.
   */
  tide: number;
  /** Closer to the Sun than this and it tears the Earth / Neptune off the Sun (AU). */
  stripEarthAu: number;
  stripNeptuneAu: number;
  /** Light at the Earth once it arrives, relative to the Sun's (0: dark). */
  light: number;
}

export interface FallStatus {
  name: string;
  distanceAu: number;
  /** Closing speed, km/s (negative: moving apart). */
  kmS: number;
  /** Days until the Sun reaches it, Infinity if their orbits never meet. */
  arriveDays: number;
  /** Closest approach of the two (AU) and when (days; 0 = already past). */
  closestAu: number;
  closestDays: number;
  /** Bound to each other (a pair orbiting each other). */
  bound: boolean;
  /** Days until its tides strip each planet from the Sun (Hill radius < orbit). */
  strips: { name: string; days: number }[];
  /** Planets already outside the Sun's Hill sphere (being stripped now). */
  stripped: string[];
}

/**
 * Playground mode ("Oyun alanı"): the Solar System as an N-body sandbox.
 * The integrator runs in a worker; each frame the scene clock follows the
 * simulated instant and the real bodies take their positions from it
 * (heliocentric, through the scale system, like their orbits normally).
 * Added bodies get their own views, everything leaves a trail, and black
 * holes are drawn by the post effect without lensing (bent light would hide
 * what happens to the planets). Leaving restores the ordinary,
 * ephemeris-driven Solar System.
 */
export class Playground {
  private activeFlag = false;
  private worker: Worker | null = null;
  private meta: BodyMeta[] = [];
  private pos: Float64Array = new Float64Array(0);
  private vel: Float64Array = new Float64Array(0);
  private alive: Uint8Array = new Uint8Array(0);
  private simJd = 0;
  private targetJd = 0;
  private busy = false;
  private entryJd = 0;
  /** Simulation start (reset returns here). */
  startJd = 0;
  private initBodies: SimBodyInit[] = [];
  private readonly real = new Map<string, CelestialBody>();
  private readonly views = new Map<string, AddedView>();
  private readonly trails: Trails;
  private readonly debris: DebrisView;
  private readonly sunAu = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmpRender = new Vector3();
  private counter = 0;
  private saved = { orbits: true, galactic: true, belts: true, rate: 1, paused: false };
  readonly log: LogEntry[] = [];
  private readonly changeFns = new Set<() => void>();
  private readonly logFns = new Set<(e: LogEntry) => void>();
  private lastNotify = 0;
  /** True while a jump forward is being integrated. */
  jumping = false;
  readonly climate = new Climate();
  private readonly guides: Guides;
  private readonly outflow: Outflow;
  /** Original atmosphere strengths (damage dims them). */
  private readonly atmBase = new Map<string, number>();

  constructor(
    private readonly engine: Engine,
    private readonly system: SolarSystem,
    private readonly sun: Sun,
    private readonly galactic: GalacticMotion,
    private readonly starfield: Starfield,
    private readonly loader: Loader,
  ) {
    this.trails = new Trails(engine.world);
    this.trails.visible = false;
    this.guides = new Guides(engine.world, engine.origin);
    this.outflow = new Outflow(engine.world);
    this.debris = new DebrisView(engine.world);
    for (const b of [...system.planets, ...system.dwarfs, ...system.comets]) this.real.set(b.id, b);
    // Before the bodies move (priority 0), after the scale transition (−10).
    engine.add({ update: (ctx) => this.update(ctx) }, -5);
    engine.addLate({ update: (ctx) => this.lateUpdate(ctx) });
    scale.onChange(() => {
      this.trails.clear();
      for (const v of this.views.values()) v.applyScale();
      if (this.activeFlag) this.engine.rig.setMaxDistance(this.farLimit());
    });
  }

  get active(): boolean {
    return this.activeFlag;
  }

  /** Simulated time since the start, days. */
  get elapsedDays(): number {
    return this.simJd - this.startJd;
  }

  get jd(): number {
    return this.simJd;
  }

  /** Pending integration, days (a jump in progress). */
  get backlogDays(): number {
    return Math.max(0, this.targetJd - this.simJd);
  }

  onChange(fn: () => void): () => void {
    this.changeFns.add(fn);
    return () => this.changeFns.delete(fn);
  }

  onLog(fn: (e: LogEntry) => void): () => void {
    this.logFns.add(fn);
    return () => this.logFns.delete(fn);
  }

  private emit(): void {
    this.changeFns.forEach((fn) => fn());
  }

  private pushLog(e: LogEntry): void {
    this.log.push(e);
    this.logFns.forEach((fn) => fn(e));
  }

  // ---- Enter / leave ----------------------------------------------------------------

  /** Camera reach in the playground: 30 light-years. */
  private farLimit(): number {
    return scale.distance(30 * 9.4607e12);
  }

  /** Undo the damage visuals. */
  private healVisuals(): void {
    this.outflow.clear();
    for (const b of this.real.values()) {
      b.setTide(null, 1);
      b.surfaceMaterial.uniforms.uHeat.value = 0;
      if (b.atmosphere && this.atmBase.has(b.id)) b.atmosphere.intensity = this.atmBase.get(b.id)!;
    }
  }

  toggle(): void {
    if (this.activeFlag) this.exit();
    else this.enter();
  }

  enter(): void {
    if (this.activeFlag) return;
    this.activeFlag = true;
    const t = this.engine.time;
    this.entryJd = t.jd;
    this.saved = { orbits: this.system.showOrbits, galactic: this.galactic.enabled, belts: this.system.showBelts, rate: t.rate, paused: t.paused };
    this.galactic.enabled = false;
    this.system.setPlayground(true);
    this.system.showBelts = false;
    this.trails.visible = true;
    this.guides.visible = true;
    this.engine.rig.setMaxDistance(this.farLimit());
    this.climate.reset();
    for (const b of this.real.values()) if (b.atmosphere) this.atmBase.set(b.id, b.atmosphere.intensity);
    t.setRate(10);
    t.paused = false;
    this.initBodies = this.realBodies(t.jd);
    this.startWorker(t.jd);
    document.body.classList.add('mode-playground');
    this.pushLog({ jd: t.jd, text: "Oyun alanı açıldı. Gezegenler artık birbirini ve eklediğin cisimleri gerçekten çekiyor.", type: 'info' });
    this.emit();
  }

  exit(): void {
    if (!this.activeFlag) return;
    this.activeFlag = false;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    for (const b of this.real.values()) {
      b.simPositionAu = null;
      b.simGone = false;
    }
    for (const m of this.system.moons) m.simGone = false;
    this.sun.root.visible = true;
    sunUniforms.uSunIntensity.value = this.sunIntensity;
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.debris.clear();
    this.debrisFocus.clear();
    this.followDebris = null;
    this.trails.clear();
    this.trails.visible = false;
    this.guides.visible = false;
    this.engine.rig.setMaxDistance(CAMERA.maxDistance);
    this.healVisuals();
    this.climate.reset();
    this.engine.postfx.setBlackHole(null);
    sunUniforms.uStarLum.value = 0;
    this.radiationLevel = 0;
    for (const el of this.labelEls.values()) el.remove();
    this.labelEls.clear();
    const t = this.engine.time;
    t.setJd(this.entryJd);
    t.setRate(this.saved.rate);
    t.paused = this.saved.paused;
    this.system.setPlayground(false);
    this.system.showBelts = this.saved.belts;
    this.galactic.enabled = this.saved.galactic;
    this.log.length = 0;
    document.body.classList.remove('mode-playground');
    this.emit();
  }

  private readonly sunIntensity = sunUniforms.uSunIntensity.value;

  /**
   * Back to the moment the playground opened, without the added bodies; or,
   * given `jd`, start over from the real Solar System at that date (today).
   */
  reset(jd?: number): void {
    if (!this.activeFlag) return;
    if (jd !== undefined) {
      this.entryJd = jd;
      this.initBodies = this.realBodies(jd);
    }
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.debris.clear();
    this.debrisFocus.clear();
    this.followDebris = null;
    this.trails.clear();
    for (const b of this.real.values()) b.simGone = false;
    for (const m of this.system.moons) m.simGone = false;
    this.sun.root.visible = true;
    sunUniforms.uSunIntensity.value = this.sunIntensity;
    this.log.length = 0;
    this.radiationLevel = 0;
    sunUniforms.uStarLum.value = 0;
    this.healVisuals();
    this.climate.reset();
    const at = jd ?? this.startJd;
    this.startWorker(at);
    this.pushLog({ jd: at, text: jd !== undefined ? 'Bugüne dönüldü: Güneş Sistemi bugünkü haliyle yeniden kuruldu.' : 'Başlangıca dönüldü.', type: 'info' });
    this.emit();
  }

  private startWorker(jd: number): void {
    this.worker?.terminate();
    this.worker = new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.simJd = this.targetJd = this.startJd = jd;
    this.busy = true;
    this.meta = [];
    this.send({ t: 'init', bodies: this.initBodies, jd });
  }

  private send(m: ToWorker): void {
    this.worker?.postMessage(m);
  }

  /** Real bodies at `jd` in a barycentric frame (AU, AU/day). */
  private realBodies(jd: number): SimBodyInit[] {
    const d = jd - 2_451_545.0;
    const out: SimBodyInit[] = [];
    const el = {} as OrbitalElements;
    const at = (b: Planet, dd: number, v: Vector3) => {
      b.orbitModel.elements(dd, el);
      return positionFromEccentricAnomaly(el, solveKepler(el.M, el.e), v);
    };
    const p = new Vector3();
    const p1 = new Vector3();
    const p2 = new Vector3();
    const h = 0.05;
    for (const b of this.real.values()) {
      if (!(b instanceof Planet)) continue;
      at(b, d, p);
      at(b, d - h, p1);
      at(b, d + h, p2);
      const v = p2.sub(p1).divideScalar(2 * h);
      const kind = this.system.planets.includes(b) ? 'planet' : this.system.comets.some((c) => c === b) ? 'comet' : 'dwarf';
      out.push({
        id: b.id,
        name: b.name,
        kind,
        mu: (GM_KM3S2[b.id] ?? 0) * GM_KM_TO_AU,
        radius: b.radiusKm / KM_PER_AU,
        pos: [p.x, p.y, p.z],
        vel: [v.x, v.y, v.z],
      });
    }
    // Heliocentric → barycentric: shift everything by the centre of mass
    // (and its velocity), the Sun included, so relative geometry is kept.
    const sunMu = GM_KM3S2.sun * GM_KM_TO_AU;
    let M = sunMu;
    const R = new Vector3();
    const V = new Vector3();
    for (const b of out) {
      M += b.mu;
      R.x += b.pos[0] * b.mu;
      R.y += b.pos[1] * b.mu;
      R.z += b.pos[2] * b.mu;
      V.x += b.vel[0] * b.mu;
      V.y += b.vel[1] * b.mu;
      V.z += b.vel[2] * b.mu;
    }
    R.divideScalar(M);
    V.divideScalar(M);
    for (const b of out) {
      b.pos = [b.pos[0] - R.x, b.pos[1] - R.y, b.pos[2] - R.z];
      b.vel = [b.vel[0] - V.x, b.vel[1] - V.y, b.vel[2] - V.z];
    }
    out.unshift({
      id: 'sun',
      name: 'Güneş',
      kind: 'star',
      mu: sunMu,
      radius: 695_700 / KM_PER_AU,
      pos: [-R.x, -R.y, -R.z],
      vel: [-V.x, -V.y, -V.z],
      lum: 1,
    });
    return out;
  }

  // ---- Adding and removing -------------------------------------------------------------

  /** Index of a body in the current state, or -1. */
  private index(id: string): number {
    return this.meta.findIndex((m) => m.id === id);
  }

  /** Heliocentric position (AU) and velocity (AU/day) of a live body. */
  stateOf(id: string, pos: Vector3, vel?: Vector3): boolean {
    const i = this.index(id);
    if (i < 0 || !this.alive[i]) return false;
    const s = this.index('sun');
    const sp = s >= 0 ? [this.pos[s * 3], this.pos[s * 3 + 1], this.pos[s * 3 + 2]] : [this.sunAu.x, this.sunAu.y, this.sunAu.z];
    pos.set(this.pos[i * 3] - sp[0], this.pos[i * 3 + 1] - sp[1], this.pos[i * 3 + 2] - sp[2]);
    if (vel) {
      const sv = s >= 0 && this.alive[s] ? [this.vel[s * 3], this.vel[s * 3 + 1], this.vel[s * 3 + 2]] : [0, 0, 0];
      vel.set(this.vel[i * 3] - sv[0], this.vel[i * 3 + 1] - sv[1], this.vel[i * 3 + 2] - sv[2]);
    }
    return true;
  }

  /** Live bodies that can serve as a reference (for the form panel). */
  references(): { id: string; name: string }[] {
    return this.meta
      .filter((m, i) => this.alive[i] && m.kind !== 'debris' && m.kind !== 'comet')
      .map((m) => ({ id: m.id, name: m.name }));
  }

  add(spec: AddSpec): string {
    const p = spec.preset;
    const id = `add-${++this.counter}`;
    const sameKind = [...this.views.values()].filter((v) => v.preset.kind === p.kind).length;
    const name = spec.name ?? (sameKind ? `${p.name} ${sameKind + 1}` : p.name);
    const mu = spec.massSun * GM_SUN;
    const radiusKm = p.look === 'hole' ? spec.massSun * RS_KM_PER_SUN : p.radiusKm;
    // Heliocentric input → the simulation's barycentric frame.
    const s = this.index('sun');
    const sp = s >= 0 && this.alive[s] ? new Vector3(this.pos[s * 3], this.pos[s * 3 + 1], this.pos[s * 3 + 2]) : this.sunAu.clone();
    const sv = s >= 0 && this.alive[s] ? new Vector3(this.vel[s * 3], this.vel[s * 3 + 1], this.vel[s * 3 + 2]) : new Vector3();
    const v = spec.velKmS.clone().divideScalar(AU_DAY_TO_KM_S).add(sv);
    const kind = p.look === 'hole' ? 'bh' : p.kind === 'ns' ? 'ns' : p.kind === 'wd' ? 'wd' : p.look === 'star' ? 'star' : 'planet';
    const lum = p.kind === 'quasar' ? quasarLuminosity(spec.massSun, QUASAR_EDDINGTON) : p.look === 'star' ? luminosityOf(radiusKm, p.tempK ?? 5772) : 0;
    this.send({
      t: 'add',
      body: {
        id,
        name,
        kind,
        mu,
        radius: p.look === 'hole' ? (2 * mu) / (C_AU_DAY * C_AU_DAY) : radiusKm / KM_PER_AU,
        pos: [spec.posAu.x + sp.x, spec.posAu.y + sp.y, spec.posAu.z + sp.z],
        vel: [v.x, v.y, v.z],
        lum,
        added: true,
      },
    });
    const view = new AddedView(id, name, p, spec.massSun, this.engine.world, this.loader);
    view.feeding = p.kind === 'quasar';
    this.views.set(id, view);
    this.placeView(view, spec.posAu);
    const massText = p.unit === 'sun' ? `${fmt(spec.massSun)} Güneş kütlesi` : p.unit === 'jup' ? `${fmt(spec.massSun / 9.5458e-4)} Jüpiter kütlesi` : `${fmt(spec.massSun / 3.003e-6)} Dünya kütlesi`;
    this.pushLog({ jd: this.simJd, text: `${name} eklendi (${massText}, Güneş'e ${fmt(spec.posAu.length())} AU, Güneş'e göre ${fmt(spec.velKmS.length())} km/s).`, type: 'added' });
    if (p.kind === 'bh')
      this.pushLog({ jd: this.simJd, text: `${name} beslenmeyen, sakin bir kara delik: ışık ve ışınım yaymaz, yalnızca kütle çekimiyle etkiler (yaklaşan bir yıldızı parçalarsa parlar). Işınımıyla yakan bir kara delik için "Kuasar" kartını seç.`, type: 'info' });
    // Once the worker has it: what to expect, in numbers.
    this.afterAdd.push(id);
    this.emit();
    return id;
  }

  /**
   * What an added body does to the Earth. A distant body pulls the Sun and
   * the planets almost equally, so they fall together and nothing changes in
   * the orbits; only the difference (the tide) bends them. The Earth leaves
   * the Sun once the body comes within d = r⊕·∛(3M/M☉) of it (the Sun's Hill
   * sphere shrinks below the Earth's orbit).
   */
  influence(id: string): Influence | null {
    const i = this.index(id);
    if (i < 0 || !this.alive[i]) return null;
    const m = this.meta[i];
    const p = new Vector3();
    const e = new Vector3();
    if (!this.stateOf(id, p)) return null;
    const earthAlive = this.stateOf('earth', e);
    if (!earthAlive) e.set(1, 0, 0);
    const sunMu = GM_SUN;
    const dS = p.length();
    const toE = p.clone().sub(e);
    const dE = toE.length();
    const aSunOnEarth = sunMu / e.lengthSq();
    // Its acceleration on the Earth minus that on the Sun (vectors).
    const aE = toE.clone().multiplyScalar(m.mu / (dE * dE * dE));
    const aS = p.clone().multiplyScalar(m.mu / (dS * dS * dS));
    const k = Math.cbrt((3 * m.mu) / sunMu);
    let pullInDays = 0;
    if (m.addPos && m.addJd !== null) {
      const ei = this.index('earth');
      const at = ei >= 0 ? [this.pos[ei * 3], this.pos[ei * 3 + 1], this.pos[ei * 3 + 2]] : [0, 0, 0];
      const d = Math.hypot(at[0] - m.addPos[0], at[1] - m.addPos[1], at[2] - m.addPos[2]);
      pullInDays = Math.max(0, d / C_AU_DAY - (this.simJd - m.addJd));
    }
    const lum = m.lum + (m.feeding ? m.feedLum : 0);
    return {
      sunAu: dS,
      earthAu: dE,
      pullInDays,
      pull: m.mu / (dE * dE) / aSunOnEarth,
      tide: aE.sub(aS).length() / aSunOnEarth,
      stripEarthAu: e.length() * k,
      stripNeptuneAu: 30 * k,
      light: lum / (dE * dE),
    };
  }

  /** One sentence on what to expect from an added body. */
  influenceText(id: string): string {
    const f = this.influence(id);
    const name = this.meta[this.index(id)]?.name ?? '';
    if (!f) return '';
    const parts: string[] = [];
    if (f.pullInDays > 0.01) parts.push(`çekimi Dünya'ya ${fmtDays(f.pullInDays)} sonra ulaşacak`);
    if (f.tide >= 0.01) parts.push(`Dünya'nın yörüngesini güçlü biçimde bozacak (gelgit: Güneş çekiminin %${fmt(f.tide * 100)}'i)`);
    else if (f.sunAu < f.stripNeptuneAu) parts.push(`dış gezegenleri Güneş'ten koparabilir; Dünya'yı etkilemesi için Güneş'e ~${fmt(f.stripEarthAu)} AU'dan yakın olmalı`);
    else
      parts.push(
        `bu uzaklıkta Güneş'i ve gezegenleri neredeyse aynı kuvvetle çeker, hepsi birlikte hareket eder: yörüngeleri bozan fark Güneş çekiminin ${sci(f.tide)}'i kadar, fark edilmez. Dünya'yı etkilemesi için Güneş'e ~${fmt(f.stripEarthAu)} AU'dan, Neptün'ü koparması için ~${fmt(f.stripNeptuneAu)} AU'dan yakın olmalı (şimdi ${fmt(f.sunAu)} AU)`,
      );
    // Heavy and far: what the Sun and it do as a pair, from their relative
    // orbit (angular momentum included): fall together, circle, or pass by.
    const mu = (this.meta[this.index(id)]?.mu ?? 0) + GM_SUN;
    const rp = new Vector3();
    const rv = new Vector3();
    if (f.tide < 0.01 && f.sunAu >= f.stripNeptuneAu && mu > 10 * GM_SUN && this.stateOf(id, rp, rv)) {
      const r = rp.toArray();
      const v = rv.toArray();
      const q = periapsis(r, v, mu);
      const inv = 2 / f.sunAu - rv.lengthSq() / mu;
      const kms = rv.length() * AU_DAY_TO_KM_S;
      const years = (d: number) => d / 365.25;
      if (q < f.stripEarthAu) {
        const fallYears = years((Math.PI / (2 * Math.SQRT2)) * Math.sqrt(f.sunAu ** 3 / mu));
        if (fallYears < 1e4)
          parts.push(`ama Güneş Sistemi'ni bütün olarak kendine çeker: çekimi geldikten sonra hepsi birlikte ~${fmt(fallYears)} yılda ona düşer; gezegenler yaklaştıkça Güneş'ten koparılır (panelin üstündeki "düşüş" satırına bak)`);
      } else if (inv > 0) {
        const period = years(2 * Math.PI * Math.sqrt((1 / inv) ** 3 / mu));
        parts.push(`Güneş'e göre ${fmt(kms)} km/s hızla verdiğin için ona düşmez: Güneş Sistemi ile birbirinin çevresinde ~${fmt(period)} yılda bir dolanırlar, en çok ${fmt(q)} AU'ya yaklaşırlar. Düşmesini görmek için "Durgun" hız seç`);
      } else parts.push(`Güneş'e göre ${fmt(kms)} km/s hızla geçip gider, en çok ${fmt(q)} AU'ya yaklaşır`);
    }
    if (f.light > 1e-4) parts.push(`ışığı Dünya'ya Güneş'inkinin ${fmt(f.light)} katı ışık getirecek`);
    else if (this.views.get(id)?.preset.look === 'hole' && f.light === 0) parts.push('ışık ve ışınım yaymaz');
    return `${name}: ${parts.join('; ')}.`;
  }

  /** Remove an added body, or a real one (e.g. the Sun). */
  remove(id: string): void {
    const i = this.index(id);
    const name = i >= 0 ? this.meta[i].name : id;
    this.send({ t: 'remove', id });
    const v = this.views.get(id);
    if (v) {
      v.dispose();
      this.views.delete(id);
    }
    this.trails.remove(id);
    this.pushLog({ jd: this.simJd, text: `${name} kaldırıldı.`, type: 'removed' });
    this.emit();
  }

  /** Add a body `distanceAu` from a reference, at an angle from the Sun→ref line. */
  addRelative(o: {
    preset: AddPreset;
    massSun: number;
    ref: string;
    distanceAu: number;
    angleDeg: number;
    heightAu?: number;
    speedKmS: number | 'circular';
    dirDeg?: number;
    velFrame?: 'ref' | 'sun';
    name?: string;
  }): string | null {
    const refPos = new Vector3();
    const refVel = new Vector3();
    if (o.ref === 'sun') {
      refPos.set(0, 0, 0);
      refVel.set(0, 0, 0);
    } else if (!this.stateOf(o.ref, refPos, refVel)) return null;
    // Ecliptic frame: x, y in the plane, z north. Angle 0 = away from the Sun.
    const base = o.ref === 'sun' ? 0 : Math.atan2(refPos.y, refPos.x);
    const a = base + MathUtils.degToRad(o.angleDeg);
    const offset = new Vector3(Math.cos(a) * o.distanceAu, Math.sin(a) * o.distanceAu, o.heightAu ?? 0);
    const pos = refPos.clone().add(offset);
    const vel = o.velFrame === 'sun' ? new Vector3() : refVel.clone().multiplyScalar(AU_DAY_TO_KM_S);
    if (o.speedKmS === 'circular') {
      const refMu = o.ref === 'sun' ? GM_SUN : (this.meta[this.index(o.ref)]?.mu ?? GM_SUN);
      const muTot = refMu + o.massSun * GM_SUN;
      const vc = Math.sqrt(muTot / Math.max(offset.length(), 1e-9)) * AU_DAY_TO_KM_S;
      // Prograde: counter-clockwise seen from the north, like the planets.
      const tangent = new Vector3(-offset.y, offset.x, 0).normalize();
      vel.addScaledVector(tangent, vc);
    } else if (o.speedKmS > 0) {
      const d = base + MathUtils.degToRad(o.dirDeg ?? 0);
      vel.add(new Vector3(Math.cos(d), Math.sin(d), 0).multiplyScalar(o.speedKmS));
    }
    return this.add({ preset: o.preset, massSun: o.massSun, posAu: pos, velKmS: vel, name: o.name });
  }

  scenario(s: Scenario): void {
    if (!this.activeFlag) this.enter();
    this.pushLog({ jd: this.simJd, text: `Senaryo: ${s.name}. ${s.text}`, type: 'info' });
    // The worker must be initialised before relative placements can read states.
    const run = () => {
      for (const id of s.remove ?? []) this.remove(id);
      for (const b of s.bodies) {
        const preset = ADD_PRESETS.find((p) => p.kind === b.kind)!;
        this.addRelative({ preset, massSun: massInSun(b.mass ?? preset.mass, preset.unit), ...b });
      }
      if (s.rateDays) this.engine.time.setRate(s.rateDays);
      this.engine.time.paused = false;
    };
    if (this.meta.length) run();
    else this.pendingRun = run;
  }

  private pendingRun: (() => void) | null = null;

  /** Integrate `days` ahead as fast as possible (the clock waits for it). */
  jump(days: number): void {
    this.targetJd = Math.max(this.targetJd, this.simJd) + days;
    this.jumping = true;
    this.emit();
  }

  /** Added bodies (for the panel's list and the camera). */
  get added(): AddedView[] {
    return [...this.views.values()];
  }

  // ---- Worker state -----------------------------------------------------------------

  private readonly afterAdd: string[] = [];

  private receive(m: FromWorker): void {
    this.busy = false;
    this.simJd = m.jd;
    this.pos = m.pos;
    this.vel = m.vel;
    this.alive = m.alive;
    if (m.meta) this.syncMeta(m.meta);
    // (A body the worker has not reported yet waits for the next state.)
    for (const id of this.afterAdd.splice(0)) {
      const text = this.influenceText(id);
      if (text) this.pushLog({ jd: this.simJd, text: `Beklenen etki — ${text}`, type: 'info' });
      else if (this.views.has(id)) this.afterAdd.push(id);
    }
    for (const e of m.events) this.handleEvent(e);
    if (this.pendingRun) {
      const run = this.pendingRun;
      this.pendingRun = null;
      run();
    }
    if (this.jumping && this.simJd >= this.targetJd - 1e-6) {
      this.jumping = false;
      this.emit();
    }
  }

  private syncMeta(meta: BodyMeta[]): void {
    this.meta = meta;
    const live = new Set(meta.filter((_, i) => this.alive[i]).map((b) => b.id));
    for (const [id, b] of this.real) {
      const gone = !live.has(id);
      if (gone && !b.simGone) this.trails.remove(id);
      b.simGone = gone;
    }
    for (const moon of this.system.moons) moon.simGone = (moon.parent as CelestialBody).simGone;
    this.sun.root.visible = live.has('sun');
    // New pieces: where they sit in the drawn body (before its view goes).
    this.registerDebris(meta);
    for (const [id, v] of this.views) {
      const i = meta.findIndex((b) => b.id === id);
      if (i < 0 || !this.alive[i]) {
        v.dispose();
        this.views.delete(id);
        this.trails.remove(id);
      } else v.feeding = meta[i].feeding || v.preset.kind === 'quasar';
    }
    this.emit();
  }

  /** Slow motion after a tearing: the rate to go back to, and when (ms). */
  private slowMo: { rate: number; until: number } | null = null;

  private handleEvent(e: SimEvent): void {
    this.pushLog({ jd: e.jd, text: e.text, type: e.type });
    // A body torn apart pours out in minutes: slow time down for a few
    // seconds so it can be seen, then go back to the chosen speed.
    if (e.type === 'disrupted' && !this.jumping) {
      const t = this.engine.time;
      if (Math.abs(t.rate) > SLOWMO_RATE) {
        this.slowMo = { rate: this.slowMo?.rate ?? t.rate, until: performance.now() + SLOWMO_MS };
        t.setRate(SLOWMO_RATE);
        // The worker stopped at the tearing: carry on from there, slowly.
        this.targetJd = this.simJd;
      } else if (this.slowMo) this.slowMo.until = performance.now() + SLOWMO_MS;
    }
    if (e.type === 'collision' && e.impact) this.climate.impact(e.ids[1], e.impact);
  }

  /**
   * Pieces that just came loose: the torn body's drawn size (the cloud is
   * never drawn smaller), its colour, and the dynamical time √(d³/GM)/3 at
   * the body tearing it (how fast the molten pieces cool on screen; a day
   * for a body shattered by heat or an impact).
   */
  /** Camera targets made for clouds (one per torn body), and one waiting to be taken over. */
  private readonly debrisFocus = new Map<string, Focusable>();
  private followDebris: Focusable | null = null;
  private debrisNeedsFrame = false;

  private registerDebris(meta: BodyMeta[]): void {
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i];
      if (m.kind !== 'debris' || !this.alive[i] || this.debris.origins.has(m.id)) continue;
      const parentId = m.id.slice(0, m.id.lastIndexOf('-d'));
      const pi = meta.findIndex((b) => b.id === parentId);
      if (pi < 0) continue;
      const parent = meta[pi];
      const real = this.real.get(parentId);
      const view = this.views.get(parentId);
      const drawn = real?.getRadius() ?? view?.radius ?? 1;
      const rgb = (real ? ((real as Planet).data?.render?.orbitColor as [number, number, number] | undefined) : view?.preset.color) ?? [0.8, 0.7, 0.6];
      // The body raising the strongest tide on it (if any) sets the pace.
      let slide = 1;
      let best = 0;
      for (let j = 0; j < meta.length; j++) {
        if (!this.alive[j] || meta[j].kind === 'debris' || meta[j].mu <= parent.mu) continue;
        const d = Math.hypot(this.pos[j * 3] - this.pos[pi * 3], this.pos[j * 3 + 1] - this.pos[pi * 3 + 1], this.pos[j * 3 + 2] - this.pos[pi * 3 + 2]);
        const tide = meta[j].mu / (d * d * d);
        if (tide > best) {
          best = tide;
          slide = Math.sqrt(1 / tide) / 3;
        }
      }
      // Shattered (no strong tide): about a day, and a cloud rather than a stream.
      const stream = best >= 1e-3;
      if (!stream) slide = 1;
      // A camera watching the body follows what is left of it.
      const focus = this.engine.rig.focusTarget;
      if (focus && (focus === real || focus === view) && !this.debrisFocus.has(parentId)) {
        const f = this.debris.focusFor(parentId, drawn);
        this.debrisFocus.set(parentId, f);
        this.followDebris = f;
      }
      const k = Number(m.id.slice(m.id.lastIndexOf('-d') + 2)) || 0;
      const hash = ((k * 2654435761) >>> 0) / 4294967296;
      this.debris.origins.set(m.id, {
        drawn,
        born: parent.goneJd ?? this.simJd,
        slide: MathUtils.clamp(slide, 0.005, 2),
        color: new Color(rgb[0], rgb[1], rgb[2]).multiplyScalar(0.7 + 0.6 * hash),
        size: drawn * 0.07 * (0.6 + 0.8 * hash),
        parent: parentId,
        order: k,
        stream,
      });
    }
  }

  /** Heliocentric ecliptic AU → absolute scene position (the orbits' mapping). */
  private toScene(au: Vector3, out: Vector3): Vector3 {
    const km = au.length() * KM_PER_AU;
    return out.copy(au).applyMatrix3(ECLIPTIC_TO_SCENE).normalize().multiplyScalar(scale.distance(km));
  }

  /** Absolute scene position → heliocentric ecliptic AU (inverse of toScene). */
  sceneToAu(p: Vector3, out = new Vector3()): Vector3 {
    const len = p.length();
    if (len < 1e-12) return out.set(0, 0, 0);
    const km = scale.distanceToKm(len);
    return out.copy(p).applyMatrix3(SCENE_TO_ECLIPTIC).normalize().multiplyScalar(km / KM_PER_AU);
  }

  private placeView(v: AddedView, au: Vector3): void {
    v.setAbsolute(this.toScene(au, this.tmp));
  }

  // ---- Frame ------------------------------------------------------------------------

  private update(ctx: FrameContext): void {
    if (!this.activeFlag || !this.worker) return;
    const t = ctx.time;
    // The scene clock follows the simulation; the user's rate sets how fast we ask.
    if (!this.jumping) {
      this.targetJd += t.simDelta;
      // Never let the request run away from what the worker manages.
      const lag = Math.max(Math.abs(t.rate) * 0.5, 1);
      if (this.targetJd - this.simJd > lag) this.targetJd = this.simJd + lag;
    }
    if (!this.busy && this.simJd < this.targetJd - 1e-9) {
      this.busy = true;
      this.send({ t: 'advance', toJd: this.targetJd, budgetMs: this.jumping ? 40 : 10, stopOnTear: !this.jumping });
    }
    t.jd = this.simJd;
    // End of a slow-motion spell (unless the user picked another speed meanwhile).
    if (this.slowMo && performance.now() > this.slowMo.until) {
      if (Math.abs(t.rate - SLOWMO_RATE) < 1e-9) t.setRate(this.slowMo.rate);
      this.slowMo = null;
    }
    this.applyState(ctx);
    const now = performance.now();
    if (now - this.lastNotify > 250) {
      this.lastNotify = now;
      this.watchRadiation();
      this.sendHitRadii();
      this.emit();
    }
  }

  private applyState(ctx: FrameContext): void {
    if (!this.meta.length) return;
    const s = this.index('sun');
    if (s >= 0 && this.alive[s]) this.sunAu.set(this.pos[s * 3], this.pos[s * 3 + 1], this.pos[s * 3 + 2]);
    const au = this.tmp;
    const scene = this.tmp2;
    const minStep = scale.distance(KM_PER_AU) * 0.004;
    for (let i = 0; i < this.meta.length; i++) {
      const m = this.meta[i];
      if (!this.alive[i] || m.id === 'sun') continue;
      au.set(this.pos[i * 3] - this.sunAu.x, this.pos[i * 3 + 1] - this.sunAu.y, this.pos[i * 3 + 2] - this.sunAu.z);
      if (m.kind === 'debris') continue;
      const body = this.real.get(m.id);
      if (body) {
        (body.simPositionAu ??= new Vector3()).copy(au);
        this.toScene(au, scene);
        if (m.kind !== 'comet') this.trails.push(m.id, scene, (body as Planet).data.render.orbitColor as [number, number, number], minStep);
        continue;
      }
      const v = this.views.get(m.id);
      if (v) {
        this.toScene(au, scene);
        v.setAbsolute(scene);
        this.trails.push(m.id, scene, v.preset.color as [number, number, number], minStep);
      }
    }
    // Hand the camera over to the cloud once it has a position (after its first update).
    if (this.followDebris && this.debrisNeedsFrame) {
      this.engine.rig.setFocus(this.followDebris);
      this.followDebris = null;
    }
    this.debrisNeedsFrame = !!this.followDebris;
    this.capHoles();
    const pxScale = ctx.viewportHeight / (2 * Math.tan(MathUtils.degToRad(ctx.camera.fov) / 2));
    this.debris.update(
      this.meta.map((m) => m.id),
      this.meta.map((m) => m.kind),
      this.alive,
      this.simJd,
      pxScale,
      (i, out) => this.toScene(au.set(this.pos[i * 3] - this.sunAu.x, this.pos[i * 3 + 1] - this.sunAu.y, this.pos[i * 3 + 2] - this.sunAu.z), out),
    );
    this.updateStarLight();
    this.stepClimate();
  }

  /**
   * After the camera has moved this frame (follow, flight, origin rebase):
   * billboards, the black hole effect and the DOM labels drawn from the
   * previous frame's camera trailed what they belong to.
   */
  private lateUpdate(ctx: FrameContext): void {
    if (!this.activeFlag || !this.worker || !this.meta.length) return;
    const pxScale = ctx.viewportHeight / (2 * Math.tan(MathUtils.degToRad(ctx.camera.fov) / 2));
    for (const v of this.views.values()) {
      for (const mat of v.scaled()) mat.uniforms.uScale.value = pxScale;
      v.update(ctx.time.delta, ctx.camera, this.engine.origin.toRender(v.getAbsolutePosition(this.tmpRender), this.tmpRender));
    }
    this.updateLensing(ctx);
    this.updateLabels(ctx);
    this.guides.update(ctx.camera, window.innerHeight);
  }

  /**
   * Collision radii as drawn: a body's on-screen radius turned back into AU
   * with the scene's local scale where it sits (cinematic scale draws
   * planets far bigger than their distances), so bodies collide when they
   * are seen to touch. In real scale these equal the true radii.
   */
  private sendHitRadii(): void {
    if (!this.meta.length) return;
    const radii: [string, number][] = [];
    const sunR = this.sun.getRadius();
    // The Sun sits at the origin of the mapping: invert it exactly.
    let lo = 1e-6;
    let hi = 10;
    for (let k = 0; k < 40; k++) {
      const mid = Math.sqrt(lo * hi);
      if (scale.distance(mid * KM_PER_AU) < sunR) lo = mid;
      else hi = mid;
    }
    radii.push(['sun', lo]);
    const local = (rAu: number): number => {
      const r = Math.max(rAu, 1e-3);
      const d = scale.distance(r * KM_PER_AU);
      const radial = (scale.distance(r * 1.01 * KM_PER_AU) - scale.distance(r * 0.99 * KM_PER_AU)) / (0.02 * r);
      return Math.sqrt((d / r) * radial);
    };
    for (let i = 0; i < this.meta.length; i++) {
      const m = this.meta[i];
      if (!this.alive[i] || m.id === 'sun' || m.kind === 'debris') continue;
      const drawn = this.real.get(m.id)?.getRadius() ?? this.views.get(m.id)?.radius;
      if (drawn === undefined) continue;
      const r = Math.hypot(this.pos[i * 3] - this.sunAu.x, this.pos[i * 3 + 1] - this.sunAu.y, this.pos[i * 3 + 2] - this.sunAu.z);
      radii.push([m.id, drawn / local(r)]);
    }
    this.send({ t: 'hit', radii });
  }

  /**
   * The cinematic scale enlarges sizes far more than distances. Fine for
   * planets; but a giant black hole (TON 618: Rs = 800 AU) would get a disc
   * wider than its distance from the Sun, and the whole Solar System would
   * sit inside it. Its drawing is kept to a fifth of that distance (disc
   * included, ~22 Rs across the outer edge).
   */
  private capHoles(): void {
    for (const v of this.views.values()) {
      if (v.preset.look !== 'hole') continue;
      const d = v.getAbsolutePosition(this.tmp).length();
      v.setCap(Math.max((0.2 * d) / 22, 1e-4));
    }
  }

  /** The most luminous added star also lights the planets (second light). */
  private updateStarLight(): void {
    let best: AddedView | null = null;
    let lum = 0;
    // Only once its light has reached the Earth (planets are lit as the Earth is).
    const ei = this.index('earth');
    for (const v of this.views.values()) {
      if (v.preset.look !== 'star') continue;
      const src = this.sourcesNow.find((s) => s.id === v.id);
      if (ei >= 0 && this.alive[ei] && (!src || !this.climate.received(src, ei, this.pos, this.simJd))) continue;
      const L = luminosityOf(v.preset.radiusKm, v.preset.tempK ?? 5772);
      if (L > lum) {
        lum = L;
        best = v;
      }
    }
    sunUniforms.uStarLum.value = best ? lum : 0;
    if (!best) return;
    this.engine.origin.toRender(best.getAbsolutePosition(this.tmpRender), sunUniforms.uStarPosW.value);
    temperatureColor(best.preset.tempK ?? 5772, sunUniforms.uStarColor.value);
    sunUniforms.uStarRef.value = scale.distance(KM_PER_AU);
  }

  // ---- Labels for added bodies ------------------------------------------------------

  private labelRoot: HTMLElement | null = null;
  private readonly labelEls = new Map<string, HTMLButtonElement>();

  private updateLabels(ctx: FrameContext): void {
    if (!this.labelRoot) {
      this.labelRoot = document.createElement('div');
      this.labelRoot.className = 'labels pg-labels';
      document.body.appendChild(this.labelRoot);
    }
    for (const [id, el] of this.labelEls) {
      if (!this.views.has(id)) {
        el.remove();
        this.labelEls.delete(id);
      }
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cam = ctx.camera;
    const p = this.tmpRender;
    // Discs of the Sun and planets on screen: a body behind one has no label.
    const focal = h / 2 / Math.tan(MathUtils.degToRad(cam.fov) / 2);
    const blockers: { x: number; y: number; r: number; z: number }[] = [];
    for (const b of [this.sun, ...this.real.values()]) {
      if ((b as { simGone?: boolean }).simGone) continue;
      this.engine.origin.toRender(b.getAbsolutePosition(p), p);
      const z = -p.clone().applyMatrix4(cam.matrixWorldInverse).z;
      if (z <= 0) continue;
      const r = (b.getRadius() / z) * focal;
      if (r < 4) continue;
      p.project(cam);
      blockers.push({ x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, r, z });
    }
    for (const v of this.views.values()) {
      let el = this.labelEls.get(v.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'label';
        el.dataset.kind = 'added';
        el.textContent = v.name;
        el.style.color = `rgb(${v.preset.color.map((c) => Math.round(c * 255)).join(',')})`;
        el.addEventListener('click', () => {
          const dir = this.engine.camera.position.clone().sub(this.engine.rig.controls.target).normalize();
          void this.engine.rig.flyTo(v, { distance: Math.max(v.getRadius() * 14, 0.5), direction: dir });
        });
        this.labelRoot.appendChild(el);
        this.labelEls.set(v.id, el);
      }
      this.engine.origin.toRender(v.getAbsolutePosition(p), p);
      const z = -p.clone().applyMatrix4(cam.matrixWorldInverse).z;
      p.project(cam);
      const sx = (p.x * 0.5 + 0.5) * w;
      const sy = (-p.y * 0.5 + 0.5) * h;
      const x = sx + 8;
      const y = sy - 9;
      const hidden = blockers.some((b) => b.z < z && Math.hypot(sx - b.x, sy - b.y) < b.r);
      const show = z > 0 && !hidden && x > -40 && x < w + 40 && y > -20 && y < h + 20;
      el.dataset.visible = String(show);
      if (show) el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  /** Light, radiation and tides on the planets; damage and its visuals. */
  private stepClimate(): void {
    if (!this.meta.length) return;
    const pulsars = new Set([...this.views.values()].filter((v) => v.preset.look === 'pulsar').map((v) => v.id));
    const tempOf = (id: string) => this.views.get(id)?.preset.tempK ?? 5772;
    const sources = this.climate.sources(this.meta, this.alive, this.pos, this.simJd, pulsars, tempOf);
    const { events, gone } = this.climate.step(this.meta, this.alive, this.pos, this.simJd, sources);
    for (const e of events) this.pushLog({ jd: e.jd ?? this.simJd, text: e.text, type: e.type as LogEntry['type'] });
    for (const g of gone) this.send({ t: 'shatter', id: g.id, text: g.text });
    // A vanished Sun still lights the Earth until the news arrives (8.3 min).
    const ei = this.index('earth');
    const sunSrc = sources.find((s) => s.id === 'sun');
    const sunLit = !!sunSrc && (ei < 0 || !this.alive[ei] || !!this.climate.received(sunSrc, ei, this.pos, this.simJd));
    sunUniforms.uSunIntensity.value = sunLit ? this.sunIntensity : this.sunIntensity * 0.04;
    for (const st of this.climate.planets.values()) {
      this.views.get(st.id)?.setHeat(st.heat);
      this.applyTide(st);
      this.applyOutflow(st);
      const b = this.real.get(st.id);
      if (!b) continue;
      b.surfaceMaterial.uniforms.uHeat.value = st.heat;
      if (b.atmosphere && this.atmBase.has(b.id)) b.atmosphere.intensity = this.atmBase.get(b.id)! * (st.atm ?? 1);
    }
    this.sourcesNow = sources;
  }

  private sourcesNow: ReturnType<Climate['sources']> = [];

  /** The gas tail of a planet losing mass to radiation (see Outflow). */
  private applyOutflow(st: { id: string; mdot: number; windFrom: [number, number, number] | null; atm: number | null }): void {
    const target = this.real.get(st.id) ?? this.views.get(st.id);
    const i = this.index(st.id);
    if (!target || i < 0 || !this.alive[i] || !st.windFrom) {
      this.outflow.hide(st.id);
      return;
    }
    const planet = target.getAbsolutePosition(new Vector3());
    const w = st.windFrom;
    const source = this.toScene(this.tmp.set(w[0] - this.sunAu.x, w[1] - this.sunAu.y, w[2] - this.sunAu.z), new Vector3());
    this.outflow.set(st.id, planet, source, target.getRadius(), st.mdot, (st.atm ?? 0) > 0.02);
  }

  /**
   * Tidal shape: a fluid body stretches towards whatever raises the tide.
   * τ = 2(M/m)(R/d)³ is the tide against the body's own gravity; at the
   * Roche limit (τ ≈ 0.14) a fluid body is a Roche ellipsoid about 1.9×
   * longer than it is round, beyond which it comes apart (the simulation's
   * disruption). Below that the stretch grows in proportion to τ.
   */
  private applyTide(st: { id: string; tau: number; tideFrom: number }): void {
    const target = this.real.get(st.id) ?? this.views.get(st.id);
    if (!target) return;
    const i = this.index(st.id);
    const j = st.tideFrom;
    const s = 1 + Math.min(st.tau / 0.14, 1) * 0.9;
    if (i < 0 || j < 0 || !this.alive[i] || !this.alive[j] || s < 1.002) {
      target.setTide(null, 1);
      return;
    }
    // Direction in the scene: from the body to the one pulling (mapped positions).
    const pa = this.toScene(this.tmp.set(this.pos[i * 3] - this.sunAu.x, this.pos[i * 3 + 1] - this.sunAu.y, this.pos[i * 3 + 2] - this.sunAu.z), new Vector3());
    const pb = this.toScene(this.tmp.set(this.pos[j * 3] - this.sunAu.x, this.pos[j * 3 + 1] - this.sunAu.y, this.pos[j * 3 + 2] - this.sunAu.z), new Vector3());
    const dir = pb.sub(pa);
    if (dir.lengthSq() < 1e-20) return;
    target.setTide(dir.normalize(), s);
  }

  private radiationLevel = 0;

  /** Log the moment a pulsar's radiation at the Earth gets worse. */
  private watchRadiation(): void {
    const r = this.earthStatus().radiation;
    const level = r ? r.level : 0;
    if (level > this.radiationLevel && r) {
      this.pushLog({ jd: this.simJd, text: `Dünya'daki yüksek enerjili ışınım Güneş'inkinin ${fmt(r.ratio)} katı. ${r.text}`, type: 'radiation' });
    }
    this.radiationLevel = level;
  }

  /** Draw the black hole whose disc is largest on screen. */
  private updateLensing(ctx: FrameContext): void {
    if (!this.engine.rig.active) return;
    const cam = ctx.camera;
    const tanHalf = Math.tan(MathUtils.degToRad(cam.fov) / 2);
    const pxPerRad = window.innerHeight / (2 * tanHalf);
    let best: AddedView | null = null;
    let bestPx = 0.6;
    const p = new Vector3();
    for (const v of this.views.values()) {
      if (v.preset.look !== 'hole') continue;
      this.engine.origin.toRender(v.getAbsolutePosition(p), p);
      const D = cam.position.distanceTo(p);
      // On-screen size of its disc (no lensing here).
      const px = ((16 * v.radius) / Math.max(D, 1e-9)) * pxPerRad;
      if (px > bestPx) {
        best = v;
        bestPx = px;
      }
    }
    if (!best) {
      this.engine.postfx.setBlackHole(null);
      return;
    }
    const rs = best.radius;
    this.engine.origin.toRender(best.getAbsolutePosition(p), p);
    // Hole frame: its disc in the ecliptic, tilted a little.
    const rot = new Matrix3().identity();
    const inv = rot.clone().transpose();
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const right = new Vector3(e[0], e[1], e[2]).normalize().applyMatrix3(inv);
    const up = new Vector3(e[4], e[5], e[6]).normalize().applyMatrix3(inv);
    const back = new Vector3(e[8], e[9], e[10]).normalize().applyMatrix3(inv);
    const view: BlackHoleView = {
      camPos: cam.position.clone().sub(p).applyMatrix3(inv).divideScalar(rs),
      camRot: new Matrix3().set(right.x, up.x, back.x, right.y, up.y, back.y, right.z, up.z, back.z),
      tanHalfFov: tanHalf,
      disc: best.preset.kind === 'quasar' ? QUASAR_DISC : best.feeding ? FEED_DISC : QUIET_DISC,
      sky: this.starfield.sky.material.uniforms.uMap.value as Texture | null,
      skyGain: 1.4,
      skyMat: SCENE_TO_GALACTIC.clone().multiply(rot),
      time: ctx.time.elapsed,
      lensing: false,
      depth: -p.clone().applyMatrix4(cam.matrixWorldInverse).z,
    };
    this.engine.postfx.setBlackHole(view);
  }

  // ---- Earth ---------------------------------------------------------------------------

  earthStatus(): EarthStatus {
    const r = new Vector3();
    const v = new Vector3();
    const empty: EarthStatus = { alive: false, distanceAu: 0, aAu: 0, e: 0, yearDays: 0, flux: 0, tempC: 0, zone: 'none', nearest: null, radiation: null, atm: null, integrity: 0, tide: 0, arrivals: [], fall: this.fallStatus() };
    if (!this.stateOf('earth', r, v)) return empty;
    const s = this.index('sun');
    const sunAlive = s >= 0 && !!this.alive[s];
    const mu = GM_SUN + (GM_KM3S2.earth ?? 0) * GM_KM_TO_AU;
    const d = r.length();
    const invA = 2 / d - v.lengthSq() / mu;
    const a = sunAlive && invA > 0 ? 1 / invA : Infinity;
    const h = new Vector3().crossVectors(r, v);
    const evec = new Vector3().crossVectors(v, h).divideScalar(mu).sub(r.clone().divideScalar(d));
    const st = this.climate.planets.get('earth');
    const S = st?.S ?? 1;
    let nearest: EarthStatus['nearest'] = null;
    for (const view of this.views.values()) {
      const p = new Vector3();
      if (!this.stateOf(view.id, p)) continue;
      const dd = p.distanceTo(r);
      if (!nearest || dd < nearest.au) nearest = { name: view.name, au: dd };
    }
    const X = st?.X ?? 1;
    const level = X < 3 ? 0 : X < 100 ? 1 : X < 1e5 ? 2 : 3;
    const ei = this.index('earth');
    const arrivals = this.sourcesNow
      .map((src) => ({ name: src.name, days: this.climate.delay(src, ei, this.pos, this.simJd) }))
      .filter((x) => x.days > 0)
      .sort((x, y) => x.days - y.days);
    return {
      alive: true,
      distanceAu: d,
      aAu: a,
      e: sunAlive ? evec.length() : 0,
      yearDays: Number.isFinite(a) ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity,
      flux: S,
      tempC: (st?.T ?? 288) - 273.15,
      zone: S >= 0.36 && S <= 1.11 ? 'hz' : S > 1.11 ? 'hot' : 'cold',
      nearest,
      radiation: X > 1.5 ? { wm2: X * 4.6e-3, ratio: X, level, text: RADIATION_LEVELS[level] } : null,
      atm: st?.atm ?? 1,
      integrity: st?.integrity ?? 1,
      tide: st?.tau ?? 0,
      arrivals,
      fall: this.fallStatus(),
    };
  }

  /**
   * The heaviest-tide added body whose pull has reached the Sun: the whole
   * Solar System falls towards it together (the planets keep their orbits),
   * until its tides start stripping planets (the Sun's Hill radius
   * d·∛(M☉/3M) shrinks below their orbits). The Sun and it follow their
   * two-body conic (angular momentum included): they meet only if it dips
   * into the hole or star; otherwise they swing past or circle each other.
   */
  fallStatus(): FallStatus | null {
    const s = this.index('sun');
    if (s < 0 || !this.alive[s]) return null;
    const sp = new Vector3(this.pos[s * 3], this.pos[s * 3 + 1], this.pos[s * 3 + 2]);
    const sv = new Vector3(this.vel[s * 3], this.vel[s * 3 + 1], this.vel[s * 3 + 2]);
    const sunMu = this.meta[s].mu;
    let best = -1;
    let tide = 0;
    for (let i = 0; i < this.meta.length; i++) {
      const m = this.meta[i];
      if (!this.alive[i] || !m.added || m.mu < sunMu * 10) continue;
      const d = Math.hypot(this.pos[i * 3] - sp.x, this.pos[i * 3 + 1] - sp.y, this.pos[i * 3 + 2] - sp.z);
      if (m.addPos && m.addJd !== null) {
        const dp = Math.hypot(sp.x - m.addPos[0], sp.y - m.addPos[1], sp.z - m.addPos[2]);
        if (dp > C_AU_DAY * (this.simJd - m.addJd)) continue;
      }
      const t = m.mu / (d * d * d);
      if (t > tide) {
        tide = t;
        best = i;
      }
    }
    if (best < 0) return null;
    const m = this.meta[best];
    const r = new Vector3(this.pos[best * 3], this.pos[best * 3 + 1], this.pos[best * 3 + 2]).sub(sp);
    const v = new Vector3(this.vel[best * 3], this.vel[best * 3 + 1], this.vel[best * 3 + 2]).sub(sv);
    const d0 = r.length();
    const vr = -r.dot(v) / d0;
    const mu = m.mu + sunMu;
    // Each planet is stripped once the Sun's Hill radius shrinks below its orbit.
    const watch: { name: string; at: number }[] = [];
    for (let i = 0; i < this.meta.length; i++) {
      const p = this.meta[i];
      if (!this.alive[i] || p.kind !== 'planet' || p.added) continue;
      const a = Math.hypot(this.pos[i * 3] - sp.x, this.pos[i * 3 + 1] - sp.y, this.pos[i * 3 + 2] - sp.z);
      watch.push({ name: p.name, at: a / Math.cbrt(sunMu / (3 * m.mu)) });
    }
    watch.sort((a, b) => b.at - a.at);
    const stripped = watch.filter((w) => d0 < w.at).map((w) => w.name);
    // Follow the relative conic to the closest approach.
    const rr = [-r.x, -r.y, -r.z];
    const vv = [-v.x, -v.y, -v.z];
    const stop = Math.max(m.radius, 1e-3) + (695_700 / KM_PER_AU);
    const q = periapsis(rr, vv, mu);
    const bound = v.lengthSq() / 2 < mu / d0;
    const strips: FallStatus['strips'] = [];
    let t = 0;
    let x = d0;
    let closestDays = 0;
    let arriveDays = Infinity;
    if (vr > 0) {
      for (let k = 0; k < 4000; k++) {
        const dt = 0.01 * Math.sqrt((x * x * x) / mu);
        if (!keplerStep(rr, vv, mu, dt)) break;
        t += dt;
        const nx = Math.hypot(rr[0], rr[1], rr[2]);
        for (const w of watch) if (nx < w.at && x >= w.at) strips.push({ name: w.name, days: t });
        if (nx <= stop) {
          arriveDays = t;
          break;
        }
        // Past the closest approach.
        if (nx > x) break;
        x = nx;
        closestDays = t;
      }
    }
    return { name: m.name, distanceAu: d0, kmS: vr * AU_DAY_TO_KM_S, arriveDays, closestAu: Math.max(q, 0), closestDays, bound, strips, stripped };
  }

  /** The real body or added view with this id (camera target). */
  focusable(id: string): CelestialBody | AddedView | undefined {
    return this.views.get(id) ?? this.real.get(id);
  }
}

function fmt(x: number): string {
  return x.toLocaleString('tr-TR', { maximumFractionDigits: x < 10 ? 2 : x < 100 ? 1 : 0 });
}

export { fmt as formatNumber, fmtDays };

/** 1,2·10⁻⁸ style. */
function sci(x: number): string {
  if (x === 0) return '0';
  if (x >= 1e-3) return `%${fmt(x * 100)}`;
  const e = Math.floor(Math.log10(x));
  const sup = String(e).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]);
  return `${(x / 10 ** e).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}·10${sup}`;
}
