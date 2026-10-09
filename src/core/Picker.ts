import { Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { FocusEntry, SolarSystem } from '../bodies/SolarSystem';
import { Moon } from '../bodies/Moon';
import { INTERACTION } from '../config/visual';
import type { FloatingOrigin } from './FloatingOrigin';

/**
 * Finds the body under the pointer (PLAN §6.1, §6.3).
 *
 * Bodies are spheres, so picking is analytic: a ray–sphere test for disks
 * large enough to see, and a screen-space tolerance for the many bodies that
 * are only a few pixels (or a marker) wide. A direct hit always beats a
 * near miss; among hits the nearest wins, among near misses the closest to
 * the cursor.
 */
export class Picker {
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly p = new Vector3();
  private readonly oc = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly system: SolarSystem,
    private readonly origin: FloatingOrigin,
  ) {}

  pick(clientX: number, clientY: number): FocusEntry | null {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const ro = this.ray.ray.origin;
    const rd = this.ray.ray.direction;
    const halfH = rect.height / 2;
    const focal = halfH / Math.tan((this.camera.fov * Math.PI) / 360);

    let bestHit: { t: number; e: FocusEntry } | null = null;
    let bestNear: { score: number; e: FocusEntry } | null = null;

    for (const e of this.system.focusables) {
      const body = e.body;
      // Moons far from the camera are hidden; do not pick ghosts.
      if (body instanceof Moon && !body.isRelevant) continue;
      // Destroyed in the playground.
      if ((body as { simGone?: boolean }).simGone) continue;
      // A spacecraft with no data for the date.
      if ((body as { hidden?: boolean }).hidden) continue;
      const c = this.origin.toRender(body.getAbsolutePosition(this.p), this.p);
      const r = body.getRadius();
      this.oc.subVectors(c, ro);
      const along = this.oc.dot(rd);
      if (along <= 0) continue; // behind the camera

      // Analytic hit.
      const d2 = this.oc.lengthSq() - along * along;
      if (d2 <= r * r * 1.02) {
        const t = along - Math.sqrt(Math.max(r * r - d2, 0));
        if (!bestHit || t < bestHit.t) bestHit = { t, e };
        continue;
      }

      // Near miss in pixels (tiny disks, markers).
      const pxPerUnit = focal / along;
      const missPx = Math.sqrt(d2) * pxPerUnit - r * pxPerUnit;
      const tolerance = e.kind === 'moon' ? INTERACTION.pickToleranceMoonPx : INTERACTION.pickTolerancePx;
      if (missPx < tolerance) {
        const score = missPx / tolerance + (e.kind === 'moon' ? 0.15 : 0);
        if (!bestNear || score < bestNear.score) bestNear = { score, e };
      }
    }
    if (bestHit) {
      // A tiny body right next to the cursor in front of a big disk still wins.
      if (bestNear && bestNear.score < 0.4) {
        const nearDist = this.origin.toRender(bestNear.e.body.getAbsolutePosition(this.p), this.p).distanceTo(ro);
        if (nearDist < bestHit.t) return bestNear.e;
      }
      return bestHit.e;
    }
    return bestNear?.e ?? null;
  }
}
