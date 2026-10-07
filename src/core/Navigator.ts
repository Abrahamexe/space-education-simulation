import { MathUtils, Vector3 } from 'three';
import { CelestialBody } from '../bodies/CelestialBody';
import { Moon } from '../bodies/Moon';
import type { FocusEntry, SolarSystem } from '../bodies/SolarSystem';
import { INTERACTION } from '../config/visual';
import type { Engine } from './Engine';
import type { Selection } from './Selection';
import type { Focusable } from './types';

const F = INTERACTION.flight;

/** The main stops, from the Sun outwards (navigation bar, number keys, ← →). */
export const MAIN_BODIES = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const UP = new Vector3(0, 1, 0);

/**
 * High-level navigation: what "go to Saturn", "back" and "home" mean in
 * camera terms. Chooses framing distances (rings need more room), a sunlit
 * viewing side with a pleasing phase angle, and keeps the selection in sync.
 */
export class Navigator {
  private readonly tmp = new Vector3();

  constructor(
    private readonly engine: Engine,
    private readonly system: SolarSystem,
    private readonly selection: Selection,
  ) {
    selection.onSelect((e) => system.highlight(e && e.id !== 'sun' ? e.id : null));
    selection.onHover((e) => system.hoverHighlight(e?.id ?? null));
  }

  entry(id: string): FocusEntry | undefined {
    return this.system.focusables.find((f) => f.id === id);
  }

  /** Comfortable viewing distance for a body (scene units). */
  framingDistance(e: FocusEntry): number {
    // Framing is tuned for landscape; a portrait screen has a narrower
    // horizontal field of view, so back off accordingly.
    const aspect = this.engine.camera.aspect;
    return this.baseFraming(e) * (aspect < 1 ? Math.min(1 / aspect, 2.2) * 0.9 : 1);
  }

  private baseFraming(e: FocusEntry): number {
    const body = e.body;
    const view = body.getViewRadius?.() ?? body.getRadius();
    if (e.kind === 'comet' && view > body.getRadius() * 1.01) return view * F.cometTailFraming;
    if (body instanceof CelestialBody && body.rings) {
      return body.getRadius() * Math.max(F.ringFramingRadii, body.rings.outer * 2.6);
    }
    return body.getRadius() * F.framingRadii[e.kind];
  }

  /** Viewing direction: from the body towards the Sun, swung to show the terminator. */
  private sunlitDirection(body: Focusable): Vector3 {
    const pos = body.getAbsolutePosition(this.tmp.clone());
    if (pos.lengthSq() === 0) {
      // The Sun itself: keep the current viewing direction.
      return this.engine.camera.position.clone().sub(this.engine.rig.controls.target).normalize();
    }
    const dir = pos.negate().normalize();
    dir.applyAxisAngle(UP, MathUtils.degToRad(F.phaseDeg));
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const el = MathUtils.degToRad(F.elevationDeg);
    return new Vector3((dir.x / flat) * Math.cos(el), Math.sin(el), (dir.z / flat) * Math.cos(el));
  }

  /** Click, label, navigation bar, search, keys: cinematic flight to the body. */
  flyTo(e: FocusEntry): Promise<void> {
    this.selection.select(e);
    return this.engine.rig.flyTo(e.body, {
      distance: this.framingDistance(e),
      direction: this.sunlitDirection(e.body),
    });
  }

  /** H: overview of the inner system. */
  home(): Promise<void> {
    const sun = this.entry('sun')!;
    this.selection.select(null);
    const h = INTERACTION.home;
    const el = MathUtils.degToRad(h.elevationDeg);
    const az = MathUtils.degToRad(h.azimuthDeg);
    const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    return this.engine.rig.flyTo(sun.body, { distance: sun.body.getRadius() * h.radii, direction: dir });
  }

  /**
   * ← / →: the previous / next stop. Among a planet's moons while a moon is
   * selected, along the main bodies otherwise (wrapping at both ends).
   */
  step(dir: 1 | -1): Promise<void> {
    const cur = this.selection.selected;
    const ring = cur?.parent
      ? this.system.focusables.filter((f) => f.parent === cur.parent)
      : MAIN_BODIES.map((id) => this.entry(id)).filter((e): e is FocusEntry => !!e);
    let i = cur ? ring.findIndex((e) => e.id === cur.id) : -1;
    if (i < 0) {
      // A dwarf planet or the comet: continue from the Sun.
      i = dir > 0 ? -1 : 0;
    }
    const next = ring[(i + dir + ring.length) % ring.length];
    return this.flyTo(next);
  }

  /** Esc: moon → its planet, anything else → home. */
  back(): Promise<void> {
    const cur = this.selection.selected;
    if (cur?.body instanceof Moon) {
      const parent = this.entry((cur.body.parent as CelestialBody).id);
      if (parent) return this.flyTo(parent);
    }
    return this.home();
  }
}
