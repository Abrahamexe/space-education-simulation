import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
  type Group,
  type Object3D,
} from 'three';
import tailVert from '../shaders/comet/tail.vert?raw';
import tailFrag from '../shaders/comet/tail.frag?raw';
import comaVert from '../shaders/comet/coma.vert?raw';
import comaFrag from '../shaders/comet/coma.frag?raw';
import { KM_PER_AU } from '../config/astro';
import { COMET } from '../config/visual';
import { scale } from '../core/scale';
import type { FloatingOrigin } from '../core/FloatingOrigin';
import type { Loader } from '../core/Loader';
import type { FrameContext } from '../core/types';
import { ECLIPTIC_TO_SCENE } from '../physics/frames';
import { positionFromEccentricAnomaly, solveKepler, type OrbitModel } from '../physics/orbits';
import { Random } from '../utils/random';
import { Planet, type HeliocentricBodyData } from './Planet';

/**
 * A periodic comet (Halley). The nucleus is an ordinary small body; the
 * coma and the two tails switch on as it nears the Sun (activity grows
 * inside ~4 AU), the ion tail pointing straight away from the Sun and the
 * dust tail curving back along the orbit.
 */
export class Comet extends Planet {
  private readonly ion: Points<BufferGeometry, ShaderMaterial>;
  private readonly dust: Points<BufferGeometry, ShaderMaterial>;
  private readonly coma: Points<BufferGeometry, ShaderMaterial>;
  private readonly shared = {
    uNucleus: { value: new Vector3() },
    uAntiSun: { value: new Vector3(1, 0, 0) },
    uVelocity: { value: new Vector3(0, 0, 1) },
    uLength: { value: 1 },
    uWidth: { value: 0.1 },
    uActivity: { value: 0 },
    uTime: { value: 0 },
    uProjScale: { value: 1000 },
  };
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  /** Activity 0..1 (for UI/debug). */
  activity = 0;
  /** Coma + tail extent (scene units), see getViewRadius. */
  private viewRadius = 0;

  constructor(
    data: HeliocentricBodyData,
    model: OrbitModel,
    world: Group,
    origin: FloatingOrigin,
    loader: Loader,
    renderSpace: Object3D,
  ) {
    super(data, model, world, origin, loader);
    const rng = new Random(0xc0e7);
    const makeTail = (count: number, ion: boolean): Points<BufferGeometry, ShaderMaterial> => {
      const seeds = new Float32Array(count * 4);
      for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
      g.setAttribute('aSeed', new BufferAttribute(seeds, 4));
      const c = ion ? COMET.ion : COMET.dust;
      const m = new ShaderMaterial({
        vertexShader: tailVert,
        fragmentShader: tailFrag,
        defines: ion ? { ION: '' } : {},
        uniforms: {
          ...this.shared,
          uRate: { value: c.rate },
          uParticleSize: { value: 0.1 },
          uColor: { value: new Color(...c.color) },
          uIntensity: { value: c.intensity },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const p = new Points(g, m);
      p.frustumCulled = false;
      p.renderOrder = 45;
      renderSpace.add(p);
      return p;
    };
    this.ion = makeTail(COMET.ion.particles, true);
    this.dust = makeTail(COMET.dust.particles, false);

    const cg = new BufferGeometry();
    cg.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    this.coma = new Points(
      cg,
      new ShaderMaterial({
        vertexShader: comaVert,
        fragmentShader: comaFrag,
        uniforms: {
          uNucleus: this.shared.uNucleus,
          uProjScale: this.shared.uProjScale,
          uRadius: { value: 1 },
          uColor: { value: new Color(...COMET.coma.color) },
          uIntensity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.coma.frustumCulled = false;
    this.coma.renderOrder = 44;
    renderSpace.add(this.coma);
  }

  /** Heliocentric ecliptic position (AU) at day d. */
  private eclipticAt(d: number, out: Vector3): Vector3 {
    const el = this.orbitModel.elements(d);
    return positionFromEccentricAnomaly(el, solveKepler(el.M, el.e), out);
  }

  /** Active: half the tail, so framing shows coma and tail; inactive: the bare nucleus. */
  getViewRadius(): number {
    return this.viewRadius || this.getRadius();
  }

  override updateView(ctx: FrameContext, sunRender: Vector3, fadeNear: number): void {
    super.updateView(ctx, sunRender, fadeNear);
    const d = ctx.time.daysSinceJ2000;
    const rKm = this.heliocentricDistanceKm;
    const rAu = rKm / KM_PER_AU;

    // Activity ramps up inside COMET.activeWithinAu, peaking near perihelion.
    const C = COMET;
    const x = Math.min(1, Math.max(0, (C.activeWithinAu - rAu) / (C.activeWithinAu - C.peakAtAu)));
    this.activity = Math.pow(x, 1.5);

    const s = this.shared;
    const nucleus = this.getRenderPosition(s.uNucleus.value);
    s.uAntiSun.value.copy(nucleus).sub(sunRender).normalize();
    // Direction of motion from a one-day finite difference.
    this.eclipticAt(d, this.a);
    this.eclipticAt(d + 1, this.b);
    s.uVelocity.value.copy(this.b.sub(this.a)).applyMatrix3(ECLIPTIC_TO_SCENE).normalize();

    // Tail length: physical length mapped through the scale curve.
    const tailKm = this.activity * C.tailMaxAu * KM_PER_AU;
    const length = Math.max(scale.distance(rKm + tailKm) - scale.distance(rKm), 1e-6);
    s.uLength.value = length;
    s.uWidth.value = length * C.widthRatio;
    s.uActivity.value = this.activity;
    s.uTime.value = ctx.time.elapsed;
    s.uProjScale.value = ctx.viewportHeight / 2 / Math.tan((ctx.camera.fov * Math.PI) / 360);
    this.ion.material.uniforms.uParticleSize.value = length * C.ion.particleSizeRatio;
    this.dust.material.uniforms.uParticleSize.value = length * C.dust.particleSizeRatio;
    const cu = this.coma.material.uniforms;
    cu.uRadius.value = length * C.coma.radiusRatio;
    cu.uIntensity.value = this.activity * C.coma.intensity;

    const on = this.activity > 0.001;
    this.ion.visible = this.dust.visible = this.coma.visible = on;
    this.viewRadius = on ? Math.max(this.getRadius(), length * 0.5) : this.getRadius();
  }
}
