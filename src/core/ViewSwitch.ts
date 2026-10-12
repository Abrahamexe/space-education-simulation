import { Vector3 } from 'three';
import { KM_PER_AU } from '../config/astro';
import { GALAXY_VIEW } from '../config/galaxy';
import type { Sun } from '../bodies/Sun';
import type { GalaxyView } from '../galaxy/GalaxyView';
import { Hyperspace } from '../ui/Hyperspace';
import type { Engine } from './Engine';
import type { Navigator } from './Navigator';
import { scale } from './scale';
import type { Selection } from './Selection';

const KUIPER_KM = 50 * KM_PER_AU;

/**
 * Solar System ↔ galaxy hand-over, always under a light-speed jump that
 * stands for the trip: zooming out past a few Kuiper-belt distances (or
 * "Galaksiye çık") jumps to the galaxy along the same line of sight and
 * drops out of it already far out; going back lands straight in the
 * Solar System overview.
 */
export class ViewSwitch {
  private readonly tmp = new Vector3();
  private swapping = false;
  private readonly hyperspace = new Hyperspace();
  private readonly listeners = new Set<(galaxy: boolean) => void>();

  constructor(
    private readonly engine: Engine,
    readonly galaxy: GalaxyView,
    private readonly sun: Sun,
    private readonly nav: Navigator,
    private readonly selection: Selection,
  ) {
    galaxy.setMapMode(engine.rig.mapMode);
    engine.rig.onMapModeChange((on) => galaxy.setMapMode(on));
    galaxy.setExitHandler(() => this.transition(() => this.backToSolar()));
    engine.addLate({ update: () => this.check() }, 15);
  }

  get inGalaxy(): boolean {
    return this.galaxy.active;
  }

  onChange(fn: (galaxy: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Solar camera distance from the Sun beyond which the galaxy takes over (scene units). */
  private threshold(): number {
    return GALAXY_VIEW.enterKuiperMultiple * scale.distance(KUIPER_KM);
  }

  /** While true (playground), zooming out never switches to the galaxy. */
  blocked: () => boolean = () => false;

  private check(): void {
    const rig = this.engine.rig;
    if (this.galaxy.active || !rig.active || rig.isFlying || this.blocked()) return;
    const abs = this.engine.origin.toAbsolute(this.engine.camera.position, this.tmp);
    if (abs.length() > this.threshold()) {
      const dir = abs.clone().normalize();
      this.transition(() => this.enter(dir), () => this.galaxy.prepareEntry());
    }
  }

  /**
   * Swap views during a light-speed jump; `prepare` (loading, shader
   * compiles) runs under it first. With reduced motion: a dissolve.
   */
  private transition(swap: () => void, prepare?: () => Promise<void>): void {
    if (this.swapping) return;
    if (Hyperspace.reduced) {
      void (prepare?.() ?? Promise.resolve()).then(() => this.crossfade(swap));
      return;
    }
    this.swapping = true;
    void this.hyperspace
      .run(async () => {
        await prepare?.();
        swap();
      })
      .finally(() => (this.swapping = false));
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

  /** "Galaksiye çık": jump straight away, along the current line of sight from the Sun. */
  goToGalaxy(): void {
    if (this.galaxy.active) return;
    this.engine.rig.cancelFlight();
    const cam = this.engine.origin.toAbsolute(this.engine.camera.position, new Vector3());
    const dir = cam.lengthSq() > 0 ? cam.normalize() : new Vector3(0, 0.5, 1).normalize();
    this.transition(() => this.enter(dir), () => this.galaxy.prepareEntry());
  }

  private backToSolar(): void {
    const engine = this.engine;
    engine.setView();
    engine.postfx.setFlareSource(this.sun);
    document.body.classList.remove('mode-galaxy');
    engine.rig.active = true;
    // Out of the jump straight into the overview: no flight in from far out.
    this.nav.homeNow();
    this.listeners.forEach((fn) => fn(false));
  }
}
