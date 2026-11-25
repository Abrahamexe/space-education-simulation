import { DM_UNKNOWNS } from '../../lab/content';
import { ParticleLayer } from '../render/ParticleLayer';
import { DM } from '../render/palette';
import type { Stage } from '../render/Stage';
import type { ChapterRuntime } from './chapters';

/** Closing card over a slowly turning, schematic dark-matter halo (cuspy, roughly NFW-like falloff). */
export async function buildUnknowns(stage: Stage, overlay: HTMLElement): Promise<ChapterRuntime> {
  const n = 6000;
  const pos = new Float32Array(n * 3);
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < n; i++) {
    // Radius from a steep power law (dense centre, long tail), direction uniform on the sphere.
    const rad = 0.15 + 3.5 * r() ** 2.2;
    const z = 2 * r() - 1;
    const phi = 2 * Math.PI * r();
    const s = Math.sqrt(1 - z * z);
    pos.set([rad * s * Math.cos(phi), rad * z * 0.85, rad * s * Math.sin(phi)], 3 * i);
  }
  const halo = new ParticleLayer({ count: n, color: DM, size: 0.5, opacity: 0.0035, kind: 'dm' });
  halo.setFrames(pos, pos, 0);
  stage.scene.add(halo.points);
  stage.camera.position.set(0, 1.2, 8);
  overlay.innerHTML = `<div class="dm-card"><h2>Bildiklerimiz, bilmediklerimiz</h2>${DM_UNKNOWNS}</div>`;
  return {
    update(_t, dt) {
      halo.points.rotation.y += dt * 0.05;
    },
    dispose() {
      stage.scene.remove(halo.points);
      halo.dispose();
      overlay.innerHTML = '';
    },
  };
}
