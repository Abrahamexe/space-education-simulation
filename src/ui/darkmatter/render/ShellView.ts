import { Group } from 'three';
import { profileSampler } from '../shells';
import { ParticleLayer } from './ParticleLayer';
import { DM } from './palette';

export type ShellComponent = 'dm' | 'baryon' | 'photon' | 'neutrino';
export type ShellFields = Record<ShellComponent, Float64Array>;

export const SHELL_COLORS: Record<ShellComponent, string> = { dm: DM, baryon: '#ffd27a', photon: '#9fd8ff', neutrino: '#8fe3b0' };
const OPACITY: Record<ShellComponent, number> = { dm: 0.05, baryon: 0.14, photon: 0.1, neutrino: 0.04 };
const SIZE: Record<ShellComponent, number> = { dm: 0.18, baryon: 0.12, photon: 0.12, neutrino: 0.14 };

/** Seeded random numbers (same view every time). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The BAO model's radial profiles drawn in 3D: for each component, particles with fixed random
 * directions and fixed u in [0, 1] sit at the radius where the profile's CDF reaches u. Not a
 * simulation — a picture of the model's mass profiles (the UI says so).
 */
export class ShellView {
  readonly object = new Group();
  private readonly layers = new Map<ShellComponent, { layer: ParticleLayer; dir: Float32Array; u: Float32Array; buf: [Float32Array, Float32Array]; flip: number }>();
  private readonly areas0 = new Map<ShellComponent, number>();
  private readonly visible = new Map<ShellComponent, boolean>();

  /** `count` particles per component; `scale` scene units per Mpc. */
  constructor(private readonly radii: Float64Array, count: number, scale: number, seed = 5) {
    const r = rng(seed);
    for (const k of Object.keys(SHELL_COLORS) as ShellComponent[]) {
      const dir = new Float32Array(count * 3);
      const u = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const z = 2 * r() - 1;
        const phi = 2 * Math.PI * r();
        const s = Math.sqrt(1 - z * z);
        dir.set([s * Math.cos(phi), z, s * Math.sin(phi)], 3 * i);
        u[i] = r();
      }
      const layer = new ParticleLayer({ count, color: SHELL_COLORS[k], size: SIZE[k], opacity: OPACITY[k], kind: k === 'dm' ? 'dm' : 'gas', scale, maxPx: 40 });
      this.object.add(layer.points);
      this.layers.set(k, { layer, dir, u, buf: [new Float32Array(count * 3), new Float32Array(count * 3)], flip: 0 });
      this.visible.set(k, true);
    }
  }

  /** Per-component brightness multipliers (the film lifts the shells and dims the core). */
  gain: Partial<Record<ShellComponent, number>> = {};

  /** Redraws every component from its profile r²·δ (Mpc grid `radii`). `fade` scales all opacities. */
  set(fields: ShellFields, fade = 1): void {
    for (const [k, l] of this.layers) {
      const p = fields[k];
      let area = 0;
      for (let i = 1; i < p.length; i++) area += Math.max(0, p[i]) * (this.radii[i] - this.radii[i - 1]);
      if (!this.areas0.has(k) && area > 0) this.areas0.set(k, area);
      const sample = profileSampler(this.radii, p);
      l.flip ^= 1;
      const out = l.buf[l.flip];
      for (let i = 0; i < l.u.length; i++) {
        const rr = sample(l.u[i]);
        out[3 * i] = l.dir[3 * i] * rr;
        out[3 * i + 1] = l.dir[3 * i + 1] * rr;
        out[3 * i + 2] = l.dir[3 * i + 2] * rr;
      }
      l.layer.setFrames(out, out, 0);
      // Brightness follows how much of the component is in the perturbation (photons fade away).
      const rel = Math.min(1, area / ((this.areas0.get(k) ?? area) || 1));
      l.layer.setOpacity(this.visible.get(k) ? OPACITY[k] * (this.gain[k] ?? 1) * fade * Math.max(0.15, rel) : 0);
    }
  }

  setVisible(k: ShellComponent, on: boolean): void {
    this.visible.set(k, on);
  }

  dispose(): void {
    for (const l of this.layers.values()) l.layer.dispose();
  }
}
