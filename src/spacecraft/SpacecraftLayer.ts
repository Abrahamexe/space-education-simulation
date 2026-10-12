import { AmbientLight, DirectionalLight, PMREMGenerator, Vector3, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import trackData from '../data/generated/spacecraft.json';
import { SPACECRAFT } from '../config/spacecraft';
import type { Engine } from '../core/Engine';
import type { FrameContext } from '../core/types';
import type { SolarSystem } from '../bodies/SolarSystem';
import { CraftMapper } from './CraftMapper';
import { Spacecraft } from './Spacecraft';
import type { CraftTrackData } from './Trajectory';

/**
 * Telescopes and probes (config/spacecraft.ts) in the solar-system view:
 * builds them, registers them for search, labels, picking and the info
 * card, lights the nearest one from the Sun and hides them all in the
 * playground (its bodies no longer follow the ephemerides) or when the
 * layer is switched off (U).
 */
export class SpacecraftLayer {
  readonly crafts: Spacecraft[] = [];
  /** Off at start: switched on, the view becomes a spacecraft mode (Hud hides the planets' lines). */
  private on = false;
  private hiddenByPlayground = false;
  private readonly light = new DirectionalLight(0xffffff, 2.2);
  private readonly ambient = new AmbientLight(0xffffff, 0.05);
  private readonly camAbs = new Vector3();
  private readonly tmp = new Vector3();
  private readonly listeners = new Set<(on: boolean) => void>();

  constructor(
    private readonly engine: Engine,
    system: SolarSystem,
  ) {
    const mapper = new CraftMapper(system);
    const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const pmrem = new PMREMGenerator(engine.renderer);
    const env: Texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    engine.scene.add(this.light, this.light.target, this.ambient);
    const tracks = (trackData as unknown as { craft: Record<string, CraftTrackData> }).craft;
    for (const def of SPACECRAFT) {
      const track = tracks[def.track];
      if (!track) continue;
      const craft = new Spacecraft(def, track, mapper, engine.world, gltf, env);
      this.crafts.push(craft);
      system.addFocusable({ id: def.id, name: def.name, kind: 'craft', body: craft });
    }
    // After planets and moons have moved this frame.
    engine.add({ update: (ctx) => this.update(ctx) }, 2);
  }

  get visible(): boolean {
    return this.on;
  }

  set visible(v: boolean) {
    if (v === this.on) return;
    this.on = v;
    this.listeners.forEach((fn) => fn(v));
  }

  /** Spacecraft mode in effect (layer on, not hidden by the playground). */
  get active(): boolean {
    return this.on && !this.hiddenByPlayground;
  }

  onChange(fn: (on: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Developer panel: model size multiplier (1 = the bodies' size curve). */
  set exaggeration(k: number) {
    this.exag = k;
    for (const c of this.crafts) c.exaggeration = k;
  }

  get exaggeration(): number {
    return this.exag;
  }

  private exag = 1;

  /** Developer panel: path brightness, marker size, all orbits. */
  tune(o: { pathGain?: number; markerScale?: number; showAllOrbits?: boolean }): void {
    for (const c of this.crafts) Object.assign(c, o);
  }

  setPlayground(active: boolean): void {
    this.hiddenByPlayground = active;
  }

  highlight(selectedId: string | null, hoveredId: string | null): void {
    for (const c of this.crafts) c.highlight = c.id === selectedId ? 1 : c.id === hoveredId ? 0.5 : 0;
  }

  private update(ctx: FrameContext): void {
    if (!this.engine.rig.active) return;
    const show = this.on && !this.hiddenByPlayground;
    const focus = this.engine.rig.focusTarget;
    const closeUp = !!focus && this.crafts.includes(focus as Spacecraft);
    this.engine.origin.toAbsolute(ctx.cameraPosition, this.camAbs);
    const budget = { paths: 1 };
    const view = { closeUp };
    let nearest: Spacecraft | null = null;
    let best = Infinity;
    for (const c of this.crafts) {
      c.update(ctx, show, this.camAbs, view, budget);
      if (c.hidden) continue;
      const d = c.getAbsolutePosition(this.tmp).distanceTo(this.camAbs) / c.getRadius();
      if (d < best) {
        best = d;
        nearest = c;
      }
    }
    // Sunlight on the craft nearest the camera (in its own size units).
    if (nearest) {
      const abs = nearest.getAbsolutePosition(this.tmp);
      const render = this.engine.origin.toRender(abs, new Vector3());
      const toSun = abs.lengthSq() > 0 ? abs.clone().negate().normalize() : new Vector3(0, 1, 0);
      this.light.position.copy(render).add(toSun);
      this.light.target.position.copy(render);
      this.light.target.updateMatrixWorld();
    }
  }
}
