import { Vector3 } from 'three';
import type { Sun } from '../bodies/Sun';
import type { GalaxyView } from '../galaxy/GalaxyView';
import type { UniverseView } from '../universe/UniverseView';
import { UNIVERSE_VIEW } from '../config/universe';
import { KM_PER_AU } from '../config/astro';
import { directionToPose } from './CameraRig';
import type { Engine } from './Engine';
import type { Navigator } from './Navigator';
import { scale } from './scale';
import type { Selection } from './Selection';
import { routeTo, runRoute, type Level, type UniverseScale } from '../ui/scalePath';
import { SCALES } from '../config/universe';

/** Solar camera distance from the Sun where the trip hands over to the galaxy (AU, scene-mapped). */
const HANDOVER_AU = 8000;
/** Solar part of the trip out / back in (s). */
const OUT_S = 3;
const IN_S = 3.6;

/**
 * Solar System ↔ galaxy as one trip. Only the "Galaksiye çık" button leaves
 * (zooming out never switches): the camera speeds away from the Sun along
 * its line of sight, the galaxy view takes over behind a short dissolve
 * near the Sun and keeps pulling out. Back: the galaxy camera closes in on
 * the Sun, then the solar camera comes in from far out to the overview.
 */
export class ViewSwitch {
  private swapping = false;
  private leaving = false;
  private readonly listeners = new Set<(galaxy: boolean) => void>();
  private universe: UniverseView | null = null;

  constructor(
    private readonly engine: Engine,
    readonly galaxy: GalaxyView,
    private readonly sun: Sun,
    private readonly nav: Navigator,
    private readonly selection: Selection,
  ) {
    galaxy.setMapMode(engine.rig.mapMode);
    engine.rig.onMapModeChange((on) => galaxy.setMapMode(on));
    galaxy.setExitHandler((dir) => this.transition(() => this.backToSolar(dir)));
    // Any user move during the trip out cancels it.
    engine.rig.onInterrupt(() => (this.leaving = false));
  }

  get inGalaxy(): boolean {
    return this.galaxy.active;
  }

  onChange(fn: (galaxy: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Swap views behind a dissolve, after `prepare` (loading, shader compiles) is done. */
  private transition(swap: () => void, prepare?: () => Promise<void>): void {
    if (this.swapping) return;
    this.swapping = true;
    void (prepare?.() ?? Promise.resolve()).then(() => {
      this.swapping = false;
      this.crossfade(swap, 900);
    });
  }

  /**
   * Swap views behind a dissolve: right after this frame is drawn, copy it
   * to an overlay, switch, and fade the copy out over the new view.
   */
  private crossfade(swap: () => void, ms = 1500): void {
    if (this.swapping) return;
    this.swapping = true;
    const off = this.engine.onFrame(() => {
      off();
      const src = this.engine.canvas;
      const shot = document.createElement('canvas');
      shot.width = src.width;
      shot.height = src.height;
      shot.getContext('2d')?.drawImage(src, 0, 0);
      shot.className = 'view-dissolve';
      shot.style.transitionDuration = `${ms}ms`;
      document.body.appendChild(shot);
      swap();
      this.swapping = false;
      requestAnimationFrame(() => requestAnimationFrame(() => (shot.style.opacity = '0')));
      window.setTimeout(() => shot.remove(), ms + 200);
    });
  }

  private enter(dir: Vector3): void {
    this.selection.select(null);
    this.engine.rig.active = false;
    this.engine.postfx.setFlareSource(null);
    document.body.classList.add('mode-galaxy');
    this.galaxy.enter(dir, this.engine.camera.quaternion);
    this.listeners.forEach((fn) => fn(true));
  }

  /**
   * The universe map above the galaxy: "Evrene çık" pulls the galaxy camera
   * out to the Local Group, the map takes over behind a dissolve and keeps
   * pulling out to Laniakea; the way back mirrors it.
   */
  attachUniverse(u: UniverseView): void {
    this.universe = u;
    u.setExitHandler((dir) =>
      this.transition(() => {
        document.body.classList.remove('mode-universe');
        this.galaxy.resumeFromFar(dir, UNIVERSE_VIEW.entryMpc * 1e6);
      }),
    );
  }

  /** Where the camera is on the scale path. */
  get level(): Level {
    if (this.universe?.active) return this.universe.scaleId as UniverseScale;
    return this.galaxy.active ? 'milkyWay' : 'solar';
  }

  private routeToken = 0;
  /** Scale-path hook for the universe HUD (fly + show the scale card); defaults to a plain flight. */
  scaleHandler: ((id: UniverseScale) => Promise<void>) | null = null;

  /** Stop a scale-path trip between legs (Esc, a new trip). */
  cancelRoute(): void {
    this.routeToken++;
  }

  /**
   * Go to any level of the scale path, through as many views as it takes (solar → galaxy →
   * universe → a scale), one leg after another; a new trip or Esc stops it between legs.
   */
  navigateTo(to: Level): void {
    const token = ++this.routeToken;
    const settled = (ok: () => boolean) => this.waitUntil(() => ok() && !this.swapping && !this.leaving);
    void runRoute(
      routeTo(this.level, to),
      {
        toGalaxy: () => (this.goToGalaxy(), settled(() => this.galaxy.active)),
        toUniverse: () => (this.goToUniverse(), settled(() => this.inUniverse)),
        toSolar: () => (void this.galaxy.returnToSun(), settled(() => !this.galaxy.active && !this.inUniverse)),
        toGalaxyFromUniverse: () => (void this.universe?.returnHome(), settled(() => this.galaxy.active && !this.inUniverse)),
        scale: (id) => {
          if (this.scaleHandler) return this.scaleHandler(id);
          const s = SCALES.find((x) => x.id === id);
          return s && this.universe ? this.universe.goScale(s) : Promise.resolve();
        },
      },
      () => token !== this.routeToken,
    );
  }

  /** Resolves once `ok()` holds (checked each frame), or after `timeoutMs`. */
  private waitUntil(ok: () => boolean, timeoutMs = 45000): Promise<void> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const off = this.engine.onFrame(() => {
        if (ok() || performance.now() - t0 > timeoutMs) {
          off();
          resolve();
        }
      });
    });
  }

  get inUniverse(): boolean {
    return !!this.universe?.active;
  }

  goToUniverse(): void {
    const u = this.universe;
    if (!u || !this.galaxy.active || this.swapping || this.leaving) return;
    this.leaving = true;
    const ready = u.prepare();
    void this.galaxy.pullOut(UNIVERSE_VIEW.entryMpc * 1e6).then(() => {
      this.leaving = false;
      if (!this.galaxy.active) return;
      const dir = this.galaxy.camera.position.clone().normalize();
      this.transition(() => {
        this.galaxy.suspend();
        document.body.classList.add('mode-universe');
        u.enter(dir);
      }, () => ready.catch(() => undefined));
    });
  }

  /** Far end of the solar part of the trip (scene units from the Sun). */
  private handoverDistance(): number {
    return scale.distance(HANDOVER_AU * KM_PER_AU);
  }

  /** "Galaksiye çık": speed away from the Sun along the current line of sight, then hand over. */
  goToGalaxy(): void {
    if (this.galaxy.active || this.leaving || this.swapping) return;
    const rig = this.engine.rig;
    rig.cancelFlight();
    const sunAbs = this.sun.getAbsolutePosition(new Vector3());
    const off = this.engine.origin.toAbsolute(this.engine.camera.position, new Vector3()).sub(sunAbs);
    const d0 = off.length();
    const dir = d0 > 0 ? off.divideScalar(d0) : new Vector3(0, 0.5, 1).normalize();
    // Loading and shader uploads start now, while the camera is on its way.
    const ready = this.galaxy.prepareEntry();
    const far = Math.max(this.handoverDistance(), d0 * 4);
    this.selection.select(null);
    rig.setFocus(this.sun);
    this.leaving = true;
    void rig.flyPose(directionToPose(dir, d0), directionToPose(dir, far), OUT_S, 'power2.in').then(() => {
      if (!this.leaving) return;
      this.leaving = false;
      this.transition(() => this.enter(dir), () => ready);
    });
  }

  private backToSolar(dir: Vector3): void {
    const engine = this.engine;
    engine.setView();
    engine.postfx.setFlareSource(this.sun);
    document.body.classList.remove('mode-galaxy');
    engine.rig.active = true;
    // Come in from far out along the galaxy camera's line of sight.
    void this.nav.homeFrom(dir, this.handoverDistance(), IN_S);
    this.listeners.forEach((fn) => fn(false));
  }
}
