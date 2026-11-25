import { AdditiveBlending, BufferAttribute, BufferGeometry, DataTexture, FloatType, LinearFilter, Object3D, Points, RGFormat, ShaderMaterial, Vector2, Vector3, type Camera } from 'three';
import vertexShader from '../../../shaders/darkmatter/lensed.vert?raw';
import fragmentShader from '../../../shaders/darkmatter/lensed.frag?raw';

const SIZE = new Vector2();
const VIEW = new Vector3();

/** Seeded random numbers, so the background is the same every time. */
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
 * Faint galaxies far behind the clusters, drawn through the weak-lensing deflection field of the
 * cluster mass (lensing.ts): each is shifted along α and stretched by its Jacobian, so around the
 * mass peaks they line up tangentially. Only meaningful seen from the observer's side (+z), so the
 * layer fades out as the camera turns away from that axis.
 */
export class LensedBackground {
  readonly object = new Object3D();
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly texture: DataTexture;
  private readonly points: Points;
  private opacity = 1;
  private n = 0;

  constructor(opts: { count: number; seed: number; half: number; depth: number }) {
    const r = rng(opts.seed);
    const n = opts.count;
    const pos = new Float32Array(n * 3);
    const shape = new Float32Array(n * 4);
    const tint = new Float32Array(n * 3);
    // Wide enough that the edge never shows from the observer's side; brightness fades toward it.
    const span = opts.half * 4;
    for (let i = 0; i < n; i++) {
      pos[3 * i] = (r() * 2 - 1) * span;
      pos[3 * i + 1] = (r() * 2 - 1) * span;
      pos[3 * i + 2] = -opts.depth;
      // Small sizes dominate: size ~ 0.025–0.09 Mpc on the sky (drawn, not to scale).
      shape[4 * i] = 0.025 + 0.065 * r() ** 2.5;
      shape[4 * i + 1] = 0.3 + 0.7 * r();
      shape[4 * i + 2] = r() * Math.PI;
      const edge = Math.max(Math.abs(pos[3 * i]), Math.abs(pos[3 * i + 1])) / span;
      shape[4 * i + 3] = (0.12 + 0.4 * r() ** 3) * (1 - edge ** 4);
      const warm = r();
      tint[3 * i] = 0.75 + 0.25 * warm;
      tint[3 * i + 1] = 0.8 + 0.1 * warm;
      tint[3 * i + 2] = 1 - 0.3 * warm;
    }
    this.geometry.setAttribute('position', new BufferAttribute(pos, 3));
    this.geometry.setAttribute('shape', new BufferAttribute(shape, 4));
    this.geometry.setAttribute('tint', new BufferAttribute(tint, 3));
    this.texture = new DataTexture(new Float32Array(2), 1, 1, RGFormat, FloatType);
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.needsUpdate = true;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uField: { value: this.texture },
        uHalf: { value: opts.half },
        uStrength: { value: 0 },
        uScale: { value: 500 },
        uOpacity: { value: 1 },
      },
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const fov = (camera as { fov?: number }).fov ?? 50;
      this.material.uniforms.uScale.value = renderer.getDrawingBufferSize(SIZE).y / (2 * Math.tan((fov * Math.PI) / 360));
      this.facing(camera);
    };
    this.object.add(this.points);
  }

  /** Deflection field (2n² values from deflectionField) covering [-half, half]² on the sky plane. */
  setField(alpha: Float32Array, n: number, half: number): void {
    if (n !== this.n) {
      this.texture.dispose();
      (this.texture as { image: unknown }).image = { data: new Float32Array(2 * n * n), width: n, height: n };
      this.n = n;
    }
    (this.texture.image.data as Float32Array).set(alpha);
    this.texture.needsUpdate = true;
    this.material.uniforms.uHalf.value = half;
  }

  /** Shift (world units) for |α| = 1: a display choice, labelled as exaggerated in the UI. */
  setStrength(s: number): void {
    this.material.uniforms.uStrength.value = s;
  }

  setOpacity(v: number): void {
    this.opacity = v;
    this.points.visible = v > 0;
  }

  /** Full within 25° of the +z (observer) axis, gone beyond 45°. */
  private facing(camera: Camera): void {
    camera.getWorldPosition(VIEW).normalize();
    const c = VIEW.z;
    const t = Math.min(1, Math.max(0, (c - Math.cos((45 * Math.PI) / 180)) / (Math.cos((25 * Math.PI) / 180) - Math.cos((45 * Math.PI) / 180))));
    this.material.uniforms.uOpacity.value = this.opacity * t * t * (3 - 2 * t);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
