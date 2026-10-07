import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineLoop,
  ShaderMaterial,
  Vector3,
} from 'three';
import vertexShader from '../shaders/orbit/orbit.vert?raw';
import fragmentShader from '../shaders/orbit/orbit.frag?raw';
import { PLANETS } from '../config/visual';
import { scale } from '../core/scale';
import {
  meanAnomalyPhase,
  positionFromEccentricAnomaly,
  type OrbitModel,
  type OrbitalElements,
} from '../physics/orbits';
import type { Triplet } from './planetTypes';

const O = PLANETS.orbit;

/** Shared by every orbit line: where the camera's focus is (set once per frame). */
export const orbitFocusUniforms = {
  uFocusPos: { value: new Vector3() },
};

/** Maps a point from the orbit's reference frame (AU or km) to scene units, in place. */
export type OrbitPointMapper = (p: Vector3) => void;

/**
 * An orbit drawn through the same frame → scene mapping as its body (so in
 * cinematic mode the compressed ellipse still passes exactly through it).
 * Sampled uniformly in eccentric anomaly; each vertex carries its
 * mean-anomaly phase for the fading trail. Planets draw in absolute world
 * space; moons draw relative to an anchor that follows their parent.
 */
export class OrbitLine {
  readonly line: LineLoop<BufferGeometry, ShaderMaterial>;
  private builtAtDays = Number.NaN;
  private readonly tmp = new Vector3();
  private el: OrbitalElements = {} as OrbitalElements;

  constructor(
    private readonly model: OrbitModel,
    color: Triplet,
    private readonly mapPoint: OrbitPointMapper,
    private readonly segments: number = O.segments,
  ) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(segments * 3), 3));
    geo.setAttribute('aPhase', new BufferAttribute(new Float32Array(segments), 1));
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: new Color(...color) },
        uOpacity: { value: O.opacity as number },
        uHighlight: { value: 0 },
        uPlanetPhase: { value: 0 },
        uFadeNear: { value: 10 },
        ...orbitFocusUniforms,
        uFocusFade: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.line = new LineLoop(geo, material);
    this.line.name = 'orbit';
    this.line.frustumCulled = false;
    this.line.renderOrder = 5;
    scale.onChange(() => (this.builtAtDays = Number.NaN));
  }

  private rebuild(daysSinceJ2000: number): void {
    this.el = this.model.elements(daysSinceJ2000, this.el);
    const el = this.el;
    const pos = this.line.geometry.getAttribute('position') as BufferAttribute;
    const phase = this.line.geometry.getAttribute('aPhase') as BufferAttribute;
    const p = this.tmp;
    for (let i = 0; i < this.segments; i++) {
      const E = (i / this.segments) * Math.PI * 2;
      positionFromEccentricAnomaly(el, E, p);
      this.mapPoint(p);
      pos.setXYZ(i, p.x, p.y, p.z);
      phase.setX(i, meanAnomalyPhase(E - el.e * Math.sin(E)));
    }
    pos.needsUpdate = true;
    phase.needsUpdate = true;
    this.builtAtDays = daysSinceJ2000;
  }

  update(daysSinceJ2000: number, planetPhase: number, fadeNear: number): void {
    if (!(Math.abs(daysSinceJ2000 - this.builtAtDays) < O.rebuildEveryDays)) this.rebuild(daysSinceJ2000);
    const u = this.line.material.uniforms;
    u.uPlanetPhase.value = planetPhase;
    u.uFadeNear.value = fadeNear;
  }

  set highlight(v: number) {
    this.line.material.uniforms.uHighlight.value = v;
  }

  /** Distance from the focused body within which this line fades out. */
  set focusFade(v: number) {
    this.line.material.uniforms.uFocusFade.value = v;
  }

  set opacity(v: number) {
    this.line.material.uniforms.uOpacity.value = v;
  }

  get opacity(): number {
    return this.line.material.uniforms.uOpacity.value as number;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}
