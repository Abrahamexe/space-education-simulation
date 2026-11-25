import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector2 } from 'three';
import vertexShader from '../../../shaders/darkmatter/particle.vert?raw';
import fragmentShader from '../../../shaders/darkmatter/particle.frag?raw';

export type ParticleKind = 'dm' | 'gas' | 'star';

/** Per kind: sprite falloff, smallest / largest sprite on screen (px). */
const LOOK: Record<ParticleKind, { sharp: number; minPx: number; maxPx: number }> = {
  dm: { sharp: 3, minPx: 2, maxPx: 160 },
  gas: { sharp: 4, minPx: 2, maxPx: 120 },
  star: { sharp: 10, minPx: 2.2, maxPx: 10 },
};

/**
 * One population of particles (dark matter, gas or galaxies/stars), additive sprites. Positions come
 * as two frames (xyz triplets) and are blended on the GPU with `uMix`, so sparse simulation frames
 * play smoothly. Gas can carry a per-particle density that sets its brightness (overlapping sprites
 * then add up to ~ρ², like X-ray emission).
 */
export class ParticleLayer {
  readonly points: Points;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly a: BufferAttribute;
  private readonly b: BufferAttribute;
  private readonly ra: BufferAttribute;
  private readonly rb: BufferAttribute;
  private lastA: Float32Array | null = null;
  private lastB: Float32Array | null = null;
  private lastRa: Float32Array | null = null;
  private lastRb: Float32Array | null = null;

  constructor(opts: { count: number; color: Color | string; size: number; opacity: number; kind: ParticleKind }) {
    const n = opts.count;
    this.a = new BufferAttribute(new Float32Array(n * 3), 3);
    this.b = new BufferAttribute(new Float32Array(n * 3), 3);
    this.ra = new BufferAttribute(new Float32Array(n).fill(1), 1);
    this.rb = new BufferAttribute(new Float32Array(n).fill(1), 1);
    this.geometry.setAttribute('position', this.a);
    this.geometry.setAttribute('positionB', this.b);
    this.geometry.setAttribute('rhoA', this.ra);
    this.geometry.setAttribute('rhoB', this.rb);
    const look = LOOK[opts.kind];
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMix: { value: 0 },
        uSize: { value: opts.size },
        uScale: { value: 500 },
        uMinPx: { value: look.minPx },
        uMaxPx: { value: look.maxPx },
        uRhoRef: { value: 0 },
        uRhoMax: { value: 2 },
        uColor: { value: new Color(opts.color) },
        uOpacity: { value: opts.opacity },
        uSharp: { value: look.sharp },
      },
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    // Keep uScale in step with the drawing buffer and the camera.
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const fov = (camera as { fov?: number }).fov ?? 50;
      this.material.uniforms.uScale.value = renderer.getDrawingBufferSize(SIZE).y / (2 * Math.tan((fov * Math.PI) / 360));
    };
  }

  /** Frames a and b (xyz triplets, same length as the layer) and the blend; buffers upload only when an array changes. */
  setFrames(a: Float32Array, b: Float32Array, mix: number): void {
    if (a !== this.lastA) {
      (this.a.array as Float32Array).set(a.subarray(0, this.a.array.length));
      this.a.needsUpdate = true;
      this.lastA = a;
    }
    if (b !== this.lastB) {
      (this.b.array as Float32Array).set(b.subarray(0, this.b.array.length));
      this.b.needsUpdate = true;
      this.lastB = b;
    }
    this.material.uniforms.uMix.value = Math.min(1, Math.max(0, mix));
  }

  /** Per-particle densities for both frames; brightness = ρ / ref (capped). ref ≤ 0 turns it off. */
  setRho(a: Float32Array, b: Float32Array, ref: number): void {
    if (a !== this.lastRa) {
      (this.ra.array as Float32Array).set(a.subarray(0, this.ra.array.length));
      this.ra.needsUpdate = true;
      this.lastRa = a;
    }
    if (b !== this.lastRb) {
      (this.rb.array as Float32Array).set(b.subarray(0, this.rb.array.length));
      this.rb.needsUpdate = true;
      this.lastRb = b;
    }
    this.material.uniforms.uRhoRef.value = ref;
  }

  setOpacity(v: number): void {
    this.material.uniforms.uOpacity.value = v;
    this.points.visible = v > 0;
  }

  get opacity(): number {
    return this.material.uniforms.uOpacity.value;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const SIZE = new Vector2();
