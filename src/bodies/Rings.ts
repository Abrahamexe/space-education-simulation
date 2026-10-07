import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RGBAFormat,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three';
import vertexShader from '../shaders/planet/rings.vert?raw';
import fragmentShader from '../shaders/planet/rings.frag?raw';
import { PLANETS } from '../config/visual';
import { sunUniforms } from '../core/lighting';
import type { Loader } from '../core/Loader';
import type { RingConfig } from './planetTypes';

const R = PLANETS.rings;

/**
 * Builds a 1D radial profile (RGBA) for ring systems described as a list of
 * narrow ringlets — Uranus and Neptune, whose real rings are a few km wide
 * and almost black. Each ring is a soft-edged band; bands narrower than a
 * texel are widened so they can still be seen.
 */
function proceduralRingTexture(cfg: RingConfig): DataTexture {
  const w = R.proceduralWidth;
  const data = new Uint8Array(w * 4);
  const span = cfg.outerKm - cfg.innerKm;
  const kmPerTexel = span / w;
  const col = new Color(...(cfg.color ?? [1, 1, 1])).convertLinearToSRGB();
  const alpha = new Float32Array(w);
  for (const [centre, width, opacity] of cfg.procedural ?? []) {
    const halfTexels = Math.max(width / kmPerTexel, R.minWidthTexels) / 2;
    const c = (centre - cfg.innerKm) / kmPerTexel;
    const from = Math.max(0, Math.floor(c - halfTexels - 2));
    const to = Math.min(w - 1, Math.ceil(c + halfTexels + 2));
    for (let i = from; i <= to; i++) {
      const d = Math.abs(i + 0.5 - c) - halfTexels;
      const edge = d <= 0 ? 1 : Math.max(0, 1 - d); // 1-texel soft edge
      alpha[i] = Math.max(alpha[i], opacity * edge);
    }
  }
  for (let i = 0; i < w; i++) {
    data[i * 4] = Math.round(col.r * 255);
    data[i * 4 + 1] = Math.round(col.g * 255);
    data[i * 4 + 2] = Math.round(col.b * 255);
    data[i * 4 + 3] = Math.round(Math.min(1, alpha[i]) * 255);
  }
  const tex = new DataTexture(data, w, 1, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  // Mipmaps matter: ringlets are sub-pixel from most distances and would
  // otherwise alias into dashed lines.
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Ring system in the planet's equatorial plane. Geometry lives in planet
 * object space (units of equatorial radius) and must be parented to the
 * non-flattened orientation group.
 */
export class Rings {
  readonly mesh: Mesh<RingGeometry, ShaderMaterial>;
  readonly inner: number;
  readonly outer: number;
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();

  constructor(cfg: RingConfig, equatorialRadiusKm: number, flattening: number, loader: Loader) {
    this.inner = cfg.innerKm / equatorialRadiusKm;
    this.outer = cfg.outerKm / equatorialRadiusKm;
    const geo = new RingGeometry(this.inner, this.outer, PLANETS.geometry.ringSegments, 1);
    geo.rotateX(-Math.PI / 2); // XY → XZ (equatorial plane)

    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...sunUniforms,
        uRingMap: { value: null as Texture | null },
        uInner: { value: this.inner },
        uOuter: { value: this.outer },
        uOpacity: { value: cfg.opacity },
        uBrightness: { value: cfg.brightness },
        uColor: { value: new Color(1, 1, 1) },
        uSunDirObj: { value: new Vector3(1, 0, 0) },
        uCamLocal: { value: new Vector3() },
        uFlattening: { value: flattening },
      },
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geo, material);
    this.mesh.name = 'rings';
    this.mesh.renderOrder = 30;

    if (cfg.texture) {
      loader
        .load(cfg.texture, { mipmaps: true })
        .then((t) => {
          t.wrapS = ClampToEdgeWrapping;
          material.uniforms.uRingMap.value = t;
        })
        .catch(() => undefined);
    } else {
      material.uniforms.uRingMap.value = proceduralRingTexture(cfg);
    }
  }

  /** The ring texture (planet shaders sample it for the ring shadow). */
  get texture(): Texture | null {
    return this.mesh.material.uniforms.uRingMap.value as Texture | null;
  }

  get opacity(): number {
    return this.mesh.material.uniforms.uOpacity.value as number;
  }

  updateView(cameraPos: Vector3, sunPos: Vector3): void {
    const u = this.mesh.material.uniforms;
    const cam = this.mesh.worldToLocal(this.tmp.copy(cameraPos));
    (u.uCamLocal.value as Vector3).copy(cam);
    const sun = this.mesh.worldToLocal(this.tmp2.copy(sunPos));
    (u.uSunDirObj.value as Vector3).copy(sun).normalize();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture?.dispose();
  }
}
