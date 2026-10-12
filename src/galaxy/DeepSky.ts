import { Group, MathUtils, Matrix3, PerspectiveCamera, Vector3, type ShaderMaterial, type Texture } from 'three';
import { DEEP_SKY, type Category } from '../config/deepsky';
import { EXTRAGALACTIC } from '../config/extragalactic';
import { ExtraObject } from './objects/ExtraObject';
import type { BlackHoleView } from '../core/effects/BlackHoleEffect';
import type { Loader } from '../core/Loader';
import { SCENE_TO_GALACTIC } from '../physics/frames';
import { makePoints } from './GalaxyModel';
import { Cluster } from './objects/Cluster';
import { PulsarObject } from './objects/PulsarObject';
import { SgrA } from './objects/SgrA';
import { SlicedNebula } from './objects/SlicedNebula';
import { StarSystem } from './objects/StarSystem';
import type { BlackHoleInfo, DeepObject, DeepTarget, StarPoints } from './objects/common';

export type { DeepTarget } from './objects/common';

/** Marker colours by category (the galaxy map shows where everything is). */
const CATEGORY_COLOR: Record<Category, [number, number, number]> = {
  blackhole: [1.0, 0.55, 0.2],
  galaxy: [0.85, 0.8, 1.0],
  giant: [1.0, 0.5, 0.3],
  pulsar: [0.55, 0.75, 1.0],
  nebula: [1.0, 0.45, 0.7],
  system: [1.0, 0.9, 0.6],
  cluster: [0.8, 0.9, 1.0],
};

/**
 * Every deep-sky destination, placed in the galaxy scene (pc): volumetric
 * nebulae from Hubble/Webb pictures, star systems at true scale, pulsars,
 * clusters, and the black holes the ray-traced effect renders.
 */
export class DeepSky {
  readonly group = new Group();
  readonly targets: DeepTarget[] = [];
  readonly objects: DeepObject[] = [];
  private readonly markers: StarPoints;
  private readonly tmp = new Vector3();
  private readonly camRot = new Matrix3();
  private readonly invRot = new Matrix3();

  constructor(loader: Loader) {
    this.objects.push(new SgrA());
    for (const def of DEEP_SKY) {
      if (def.kind === 'nebula') this.objects.push(new SlicedNebula(def, loader));
      else if (def.kind === 'system') this.objects.push(new StarSystem(def));
      else if (def.kind === 'pulsar') this.objects.push(new PulsarObject(def));
      else this.objects.push(new Cluster(def));
    }
    // Beyond the Milky Way, out to TON 618.
    for (const def of EXTRAGALACTIC) this.objects.push(new ExtraObject(def, loader));
    for (const o of this.objects) {
      this.group.add(o.group);
      this.targets.push(...o.targets);
    }

    // Map markers: one point per destination, coloured by category.
    const main = this.targets.filter((t) => t.category);
    const pos: number[] = [];
    const col: number[] = [];
    for (const t of main) {
      pos.push(t.position.x, t.position.y, t.position.z);
      col.push(...CATEGORY_COLOR[t.category!]);
    }
    this.markers = makePoints(pos, col, new Array(main.length).fill(1e-3), { brightness: 1.4, nearFade: 0, minPx: 3, maxPx: 3 });
    this.markers.name = 'deepsky-markers';
    this.markers.renderOrder = 7;
    this.group.add(this.markers);
  }

  scaled(): ShaderMaterial[] {
    const out: ShaderMaterial[] = [this.markers.material];
    for (const o of this.objects) out.push(...o.scaled());
    return out;
  }

  /** Every picture the objects would load seen from `from`; resolves when all have settled. */
  preload(from: Vector3): Promise<void> {
    return Promise.all(this.objects.map((o) => o.preload?.(from).catch(() => undefined))).then(() => undefined);
  }

  update(dt: number, elapsed: number, camera: PerspectiveCamera, zoom: number): void {
    for (const o of this.objects) o.update({ camera, dt, elapsed });
    // Markers guide from afar, step aside up close.
    this.markers.material.uniforms.uBrightness.value = 1.4 * MathUtils.smoothstep(zoom, 20, 400);
  }

  /**
   * The black hole worth ray-tracing this frame (largest Einstein ring on
   * screen), described in its own frame for the effect; null if none.
   */
  blackHole(camera: PerspectiveCamera, viewportCssHeight: number, sky: Texture | null, elapsed: number): BlackHoleView | null {
    const holes: BlackHoleInfo[] = [];
    for (const o of this.objects) holes.push(...o.blackHoles);
    const tanHalf = Math.tan(MathUtils.degToRad(camera.fov) / 2);
    const pxPerRad = viewportCssHeight / (2 * tanHalf);
    let best: BlackHoleInfo | null = null;
    let bestPx = 0.6;
    for (const h of holes) {
      const D = camera.position.distanceTo(h.position);
      if (!(D > 0)) continue;
      // Einstein radius for a background at infinity: sqrt(2 Rs / D).
      const px = Math.sqrt((2 * h.rsPc) / D) * pxPerRad;
      if (px < bestPx) continue;
      // Well behind the camera: skip.
      this.tmp.copy(h.position).applyMatrix4(camera.matrixWorldInverse);
      if (this.tmp.z > 0 && D > h.rsPc * 60) continue;
      best = h;
      bestPx = px;
    }
    if (!best) return null;

    this.invRot.copy(best.rot).transpose();
    const camPos = camera.position.clone().sub(best.position).applyMatrix3(this.invRot).divideScalar(best.rsPc);
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const right = new Vector3(e[0], e[1], e[2]).normalize().applyMatrix3(this.invRot);
    const up = new Vector3(e[4], e[5], e[6]).normalize().applyMatrix3(this.invRot);
    const back = new Vector3(e[8], e[9], e[10]).normalize().applyMatrix3(this.invRot);
    this.camRot.set(right.x, up.x, back.x, right.y, up.y, back.y, right.z, up.z, back.z);
    const skyMat = SCENE_TO_GALACTIC.clone().multiply(best.rot);
    return {
      camPos,
      camRot: this.camRot,
      tanHalfFov: tanHalf,
      disc: best.disc,
      sky,
      skyGain: best.skyGain ?? 1.4,
      skyMat,
      time: elapsed,
    };
  }
}
