import {
  BackSide,
  Color,
  CustomBlending,
  FrontSide,
  Mesh,
  OneFactor,
  ShaderMaterial,
  SphereGeometry,
  SrcAlphaFactor,
  Vector3,
  type Object3D,
} from 'three';
import vertexShader from '../shaders/planet/atmosphere.vert?raw';
import fragmentShader from '../shaders/planet/atmosphere.frag?raw';
import { PLANETS } from '../config/visual';
import { sunUniforms } from '../core/lighting';
import type { AtmosphereConfig } from './planetTypes';

const G = PLANETS.geometry.atmosphere;
let sharedGeometry: SphereGeometry | null = null;

interface Coefficients {
  top: number;
  betaR: Vector3;
  betaM: number;
  hR: number;
  hM: number;
}

/**
 * Convert either config flavour to shader coefficients in planet radii.
 * Optical depth τ = β·H is what the eye sees; when the shell is exaggerated
 * for visibility the heights grow and β shrinks so τ is preserved.
 */
function coefficients(cfg: AtmosphereConfig, radiusKm: number): Coefficients {
  if ('physical' in cfg) {
    const k = cfg.visualScale;
    const hR = (cfg.rayleighHeightKm / radiusKm) * k;
    const hM = (cfg.mieHeightKm / radiusKm) * k;
    // β per planet radius = β per km × km per radius, then ÷ k.
    const perR = radiusKm / k;
    return {
      top: 1 + (cfg.topKm / radiusKm) * k,
      betaR: new Vector3(...cfg.rayleighPerKm).multiplyScalar(perR),
      betaM: cfg.miePerKm * perR,
      hR,
      hM,
    };
  }
  const hR = cfg.rayleighHeight * cfg.thickness;
  const hM = cfg.mieHeight * cfg.thickness;
  return {
    top: 1 + cfg.thickness,
    betaR: new Vector3(...cfg.rayleigh).divideScalar(hR),
    betaM: cfg.mie / hM,
    hR,
    hM,
  };
}

/**
 * Atmosphere shell (single-scattering Rayleigh + Mie). Must be parented to a
 * group whose local space is the planet's unit sphere (flattening included),
 * so the CPU can hand the shader exact camera/sun vectors in that space.
 */
export class Atmosphere {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  top: number;
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();

  constructor(cfg: AtmosphereConfig, radiusKm: number) {
    sharedGeometry ??= new SphereGeometry(1, G[0], G[1]);
    const c = coefficients(cfg, radiusKm);
    this.top = c.top;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...sunUniforms,
        uCamLocal: { value: new Vector3() },
        uSunDirLocal: { value: new Vector3(1, 0, 0) },
        uTop: { value: c.top },
        uBetaR: { value: c.betaR },
        uBetaM: { value: c.betaM },
        uHR: { value: c.hR },
        uHM: { value: c.hM },
        uG: { value: cfg.g },
        uIntensity: { value: cfg.intensity },
        uMieTint: { value: 'mieTint' in cfg ? new Color(...cfg.mieTint) : new Color(1, 1, 1) },
      },
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: SrcAlphaFactor,
      side: FrontSide,
    });
    this.mesh = new Mesh(sharedGeometry, material);
    this.mesh.name = 'atmosphere';
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
  }

  /**
   * Feed camera and sun into the shell's local space. Call after world
   * matrices are current (late update).
   */
  updateView(cameraPos: Vector3, sunPos: Vector3): void {
    const m = this.mesh;
    const u = m.material.uniforms;
    const cam = m.worldToLocal(this.tmp.copy(cameraPos));
    (u.uCamLocal.value as Vector3).copy(cam);
    const sun = m.worldToLocal(this.tmp2.copy(sunPos));
    (u.uSunDirLocal.value as Vector3).copy(sun).normalize();

    // Inside the shell the front faces vanish: draw back faces without depth
    // test so the sky around us still gets its scattering.
    const inside = cam.length() < this.top * 1.0005;
    const side = inside ? BackSide : FrontSide;
    if (m.material.side !== side) {
      m.material.side = side;
      m.material.depthTest = !inside;
      m.material.needsUpdate = true;
    }
  }

  /** Re-derive every coefficient from a config (live tuning, dev tools). */
  configure(cfg: AtmosphereConfig, radiusKm: number): void {
    const c = coefficients(cfg, radiusKm);
    const u = this.mesh.material.uniforms;
    this.top = c.top;
    u.uTop.value = c.top;
    (u.uBetaR.value as Vector3).copy(c.betaR);
    u.uBetaM.value = c.betaM;
    u.uHR.value = c.hR;
    u.uHM.value = c.hM;
    u.uG.value = cfg.g;
    u.uIntensity.value = cfg.intensity;
    if ('mieTint' in cfg) (u.uMieTint.value as Color).setRGB(...cfg.mieTint);
  }

  get intensity(): number {
    return this.mesh.material.uniforms.uIntensity.value as number;
  }

  set intensity(v: number) {
    this.mesh.material.uniforms.uIntensity.value = v;
  }

  /** Attach under the given (flattened, unit-sphere) parent. */
  attachTo(parent: Object3D): void {
    parent.add(this.mesh);
  }

  dispose(): void {
    this.mesh.material.dispose();
  }
}
