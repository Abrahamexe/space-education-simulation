import { Vector3 } from 'three';
import planetsData from '../data/planets.json';
import moonsData from '../data/moons.json';
import dwarfData from '../data/dwarf-planets.json';
import cometData from '../data/comets.json';
import satellitesData from '../data/generated/satellites.json';
import smallBodiesData from '../data/generated/small-bodies.json';
import { PLANETS, BELTS } from '../config/visual';
import { QUALITY_PRESETS, type QualityLevel } from '../config/quality';
import { sunUniforms } from '../core/lighting';
import type { Engine } from '../core/Engine';
import type { Loader } from '../core/Loader';
import type { Focusable, FrameContext } from '../core/types';
import { OsculatingOrbit, TableOrbit, type OsculatingElementsData } from '../physics/orbits';
import { Random } from '../utils/random';
import { Belt, kuiperBelt, mainBelt } from './Belt';
import type { CelestialBody } from './CelestialBody';
import { Comet } from './Comet';
import { Earth } from './Earth';
import { Moon, type MoonData, type SatelliteRecord } from './Moon';
import { orbitFocusUniforms } from './OrbitLine';
import { Planet, type HeliocentricBodyData } from './Planet';
import type { PlanetData } from './planetTypes';
import type { Sun } from './Sun';

export type BodyKind = 'star' | 'planet' | 'dwarf' | 'moon' | 'comet';

export interface FocusEntry {
  id: string;
  name: string;
  kind: BodyKind;
  body: Focusable;
  /** Parent id for moons. */
  parent?: string;
}

/** Update priorities: parents must move before their moons. */
const PRIORITY_HELIOCENTRIC = 0;
const PRIORITY_MOON = 1;

/**
 * Builds the whole system from the data files (adding a body = adding a JSON
 * entry) and owns the per-frame plumbing shared by all bodies: sunlight
 * uniforms, view-dependent updates, eclipses, orbit visibility, belts.
 */
export class SolarSystem {
  readonly planets: Planet[] = [];
  readonly dwarfs: Planet[] = [];
  readonly moons: Moon[] = [];
  readonly comets: Comet[] = [];
  readonly asteroidBelt: Belt;
  readonly kuiperBelt: Belt;
  private readonly byId = new Map<string, CelestialBody>();
  private readonly entries: FocusEntry[] = [];
  private readonly sunRender = new Vector3();
  private orbitsVisible = true;
  /** Galactic motion shown: heliocentric ellipses would contradict the trails. */
  private galacticFrame = false;
  private readonly tmp = new Vector3();
  private get origin() {
    return this.engine.origin;
  }

  constructor(
    private readonly engine: Engine,
    loader: Loader,
    private readonly sun: Sun,
  ) {
    this.entries.push({ id: 'sun', name: 'Güneş', kind: 'star', body: sun });

    // ---- Planets (JPL approximate elements) -----------------------------------
    for (const data of planetsData.planets as unknown as PlanetData[]) {
      const model = new TableOrbit(data.orbit);
      const desc = data as unknown as HeliocentricBodyData;
      const planet =
        data.render.shader === 'earth'
          ? new Earth(desc, model, engine.world, engine.origin, loader)
          : new Planet(desc, model, engine.world, engine.origin, loader);
      this.register(planet, 'planet', PRIORITY_HELIOCENTRIC);
      this.planets.push(planet);
    }

    // ---- Dwarf planets and comets (JPL SBDB osculating elements) ----------------
    const sb = new Map(smallBodiesData.bodies.map((b) => [b.id, b as unknown as OsculatingElementsData]));
    for (const data of dwarfData.bodies as unknown as HeliocentricBodyData[]) {
      const el = sb.get(data.id);
      if (!el) throw new Error(`No SBDB elements for ${data.id}`);
      const dwarf = new Planet(data, new OsculatingOrbit(el), engine.world, engine.origin, loader);
      dwarf.orbit!.opacity = PLANETS.orbit.minorOpacity;
      this.register(dwarf, 'dwarf', PRIORITY_HELIOCENTRIC);
      this.dwarfs.push(dwarf);
    }
    for (const data of cometData.comets as unknown as HeliocentricBodyData[]) {
      const el = sb.get(data.id);
      if (!el) throw new Error(`No SBDB elements for ${data.id}`);
      const comet = new Comet(data, new OsculatingOrbit(el), engine.world, engine.origin, loader, engine.scene);
      comet.orbit!.opacity = PLANETS.orbit.minorOpacity;
      this.register(comet, 'comet', PRIORITY_HELIOCENTRIC);
      this.comets.push(comet);
    }

    // ---- Moons (JPL satellite mean elements) ---------------------------------------
    const sats = satellitesData.satellites as unknown as SatelliteRecord[];
    for (const data of moonsData.moons as unknown as MoonData[]) {
      const parent = this.byId.get(data.parent);
      const sat = sats.find((s) => s.name === data.jplName);
      if (!parent || !sat) throw new Error(`Moon ${data.id}: missing parent or elements`);
      const moon = new Moon(data, sat, parent, engine.world, engine.origin, loader);
      parent.satellites.push(moon);
      // Mutual eclipses: the moon shades its planet, the planet shades the moon.
      parent.shadowCasters.push(moon);
      moon.shadowCasters.push(parent);
      this.register(moon, 'moon', PRIORITY_MOON, data.parent);
      this.moons.push(moon);
    }

    // ---- Belts ----------------------------------------------------------------------
    const q = QUALITY_PRESETS.ultra;
    const A = BELTS.asteroid;
    const K = BELTS.kuiper;
    this.asteroidBelt = new Belt('asteroid-belt', mainBelt(q.asteroids, new Random(0xa57e)), engine.world, {
      sizeBoost: A.sizeBoost,
      dustSizePx: A.dustSizePx,
      dustIntensity: A.dustIntensity,
      seed: 7,
    });
    this.kuiperBelt = new Belt('kuiper-belt', kuiperBelt(q.kuiper, new Random(0x6b17)), engine.world, {
      sizeBoost: K.sizeBoost,
      dustSizePx: K.dustSizePx,
      dustIntensity: K.dustIntensity,
      seed: 11,
    });
    engine.add(this.asteroidBelt);
    engine.add(this.kuiperBelt);

    engine.addLate({ update: (ctx) => this.updateView(ctx) });
    this.applyOrbitVisibility();
  }

  private register(body: CelestialBody, kind: BodyKind, priority: number, parent?: string): void {
    this.byId.set(body.id, body);
    this.entries.push({ id: body.id, name: body.name, kind, body, parent });
    this.engine.add(body, priority);
    this.engine.postfx.addOccluder(body);
  }

  /** Distance from a render-space point to the nearest body surface (free camera, near plane). */
  surfaceDistance(renderPos: Vector3): number {
    let best = Infinity;
    for (const e of this.entries) {
      const p = this.origin.toRender(e.body.getAbsolutePosition(this.tmp), this.tmp);
      const d = p.distanceTo(renderPos) - e.body.getRadius();
      if (d < best) best = d;
    }
    return Math.max(best, 0);
  }

  get(id: string): CelestialBody | undefined {
    return this.byId.get(id);
  }

  /** Every focusable body, Sun first, then planets, dwarfs, comets, moons. */
  get focusables(): FocusEntry[] {
    return this.entries;
  }

  get bodies(): CelestialBody[] {
    return [...this.byId.values()];
  }

  /** Apply a quality preset's body counts. */
  applyQuality(level: QualityLevel): void {
    const q = QUALITY_PRESETS[level];
    this.asteroidBelt.setCount(q.asteroids);
    this.kuiperBelt.setCount(q.kuiper);
  }

  setOrbitsVisible(v: boolean): void {
    this.orbitsVisible = v;
    this.applyOrbitVisibility();
  }

  /**
   * Planet orbits follow the toggle. Dwarf-planet and comet orbits are long,
   * steep ellipses that cut across every view, so they only appear for the
   * body (or a moon of it) that is selected or under the pointer.
   */
  private applyOrbitVisibility(): void {
    const v = this.orbitsVisible;
    const sel = this.selectedId ? this.entries.find((e) => e.id === this.selectedId) : undefined;
    const relevant = new Set([this.selectedId, this.hoveredId, sel?.parent]);
    for (const b of this.byId.values()) {
      if (b instanceof Moon) b.orbitsEnabled = v;
      else if (b.orbit) {
        const minor = this.dwarfs.includes(b as Planet) || this.comets.includes(b as Comet);
        b.orbit.line.visible = v && !this.galacticFrame && !this.playground && (!minor || relevant.has(b.id));
      }
    }
  }

  /** Playground: Kepler ellipses no longer hold; trails replace them. */
  private playground = false;

  setPlayground(on: boolean): void {
    this.playground = on;
    this.applyOrbitVisibility();
  }

  /** Hide the Sun-centred orbit ellipses while the galactic trails are shown. */
  setGalacticFrame(on: boolean): void {
    this.galacticFrame = on;
    this.applyOrbitVisibility();
  }

  get showOrbits(): boolean {
    return this.orbitsVisible;
  }

  set showOrbits(v: boolean) {
    this.setOrbitsVisible(v);
  }

  get showBelts(): boolean {
    return this.asteroidBelt.visible;
  }

  set showBelts(v: boolean) {
    this.asteroidBelt.visible = v;
    this.kuiperBelt.visible = v;
  }

  private selectedId: string | null = null;
  private hoveredId: string | null = null;

  /** Emphasise the selected orbit fully and the hovered one a little. */
  highlight(id: string | null): void {
    this.selectedId = id;
    this.applyHighlights();
  }

  hoverHighlight(id: string | null): void {
    this.hoveredId = id;
    this.applyHighlights();
  }

  private applyHighlights(): void {
    for (const b of this.byId.values()) {
      if (!b.orbit) continue;
      b.orbit.highlight = b.id === this.selectedId ? 1 : b.id === this.hoveredId ? 0.5 : 0;
    }
    this.applyOrbitVisibility();
  }

  private updateView(ctx: FrameContext): void {
    // The Sun is the heliocentric origin; in render space it sits at -origin.
    this.sun.getRenderPosition(this.sunRender);
    sunUniforms.uSunPosW.value.copy(this.sunRender);

    const rig = this.engine.rig;
    const fadeNear = rig.focusRadius * PLANETS.orbit.fadeNearRadii;
    const focus = rig.focusTarget;
    if (focus) {
      orbitFocusUniforms.uFocusPos.value.copy(this.origin.toRender(focus.getAbsolutePosition(this.tmp), this.tmp));
      // The focused body's own path (and its planet's, for a moon) would run
      // straight through the view: fade it widely. Others only right at the body.
      const focused = focus as CelestialBody;
      const parent = focused instanceof Moon ? focused.parent : null;
      for (const b of this.byId.values()) {
        if (!b.orbit) continue;
        const own = b === focused || b === parent;
        b.orbit.focusFade = rig.focusRadius * (own ? PLANETS.orbit.focusFadeRadii : PLANETS.orbit.focusFadeOtherRadii);
      }
    }
    for (const b of this.byId.values()) b.updateView(ctx, this.sunRender, fadeNear);
  }
}
