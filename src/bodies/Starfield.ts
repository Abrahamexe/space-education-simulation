import {
  AdditiveBlending,
  HalfFloatType,
  LinearFilter,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  WebGLRenderTarget,
  type WebGLRenderer,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector3,
} from 'three';
import milkyVert from '../shaders/starfield/milkyway.vert?raw';
import milkyFrag from '../shaders/starfield/milkyway.frag?raw';
import nebulaBakeVert from '../shaders/starfield/nebula-bake.vert?raw';
import nebulaBakeFrag from '../shaders/starfield/nebula-bake.frag?raw';
import starsVert from '../shaders/starfield/stars.vert?raw';
import starsFrag from '../shaders/starfield/stars.frag?raw';
import { KM_PER_AU } from '../config/astro';
import { STARFIELD } from '../config/visual';
import { scale } from '../core/scale';
import type { FrameContext, Updatable } from '../core/types';
import { SCENE_TO_GALACTIC, galacticToScene } from '../physics/frames';
import { blackbodyLinear, saturate } from '../utils/color';
import { Random } from '../utils/random';

const S = STARFIELD;
const DEG = Math.PI / 180;

/** Sky sphere tessellation: smooth enough for per-pixel direction lookup. */
const SKY_SEGMENTS_W = 64;
const SKY_SEGMENTS_H = 32;
/** Baked nebula map (equirectangular, galactic). Its noise tops out at ~2 cycles/rad, so this is ample. */
const NEBULA_MAP_W = 1024;
const NEBULA_MAP_H = 512;
/** Draw order: sky first, then stars, then everything else. */
const ORDER_SKY = -1000;
const ORDER_STARS = -900;

/**
 * Temperature mix of naked-eye stars (rough spectral-class census:
 * K and G giants dominate, few hot O/B stars). Kelvin and weights.
 */
const STAR_TEMPERATURES = [3300, 4200, 5000, 5800, 6600, 7800, 9800, 14000, 24000];
const STAR_TEMPERATURE_WEIGHTS = [10, 24, 20, 14, 11, 8, 8, 4, 1];
/** How much of the blackbody colour survives (the eye sees stars paler). */
const STAR_SATURATION = 0.75;

/** Apparent-magnitude range and slope of the cumulative count law N(<m) ∝ 10^(k·m). */
const MAG_BRIGHT = -1.0;
const MAG_FAINT = 7.0;
const MAG_SLOPE = 0.45;
/** Magnitude whose flux maps to intensity 1. */
const MAG_REFERENCE = 3.0;

interface StarBuffers {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
}

function makeStarMaterial(infinite: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: starsVert,
    fragmentShader: starsFrag,
    defines: infinite ? { INFINITE: '' } : {},
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uSizeScale: { value: 1 },
      uBrightness: { value: S.stars.brightness },
      // Reduced motion: steady stars (no perpetual twinkle).
      uTwinkle: { value: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : S.stars.twinkleAmount },
      uTwinkleSpeed: { value: S.stars.twinkleSpeed },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
  });
}

/**
 * Background sky (PLAN §4.6):
 *  - Milky Way panorama mapped in true galactic orientation;
 *  - thousands of point stars at infinity, coloured by temperature, denser
 *    along the galactic plane, twinkling subtly;
 *  - a sparse shell of nearer stars at finite distance for parallax.
 */
export class Starfield implements Updatable {
  readonly sky: Mesh<SphereGeometry, ShaderMaterial>;
  readonly stars: Points<BufferGeometry, ShaderMaterial>;
  readonly nearStars: Points<BufferGeometry, ShaderMaterial>;
  private readonly rng = new Random(0x57a2);
  private nearDirections: Float32Array = new Float32Array(0);
  private nearDistancesAu: Float32Array = new Float32Array(0);

  constructor(skyGroup: Group, world: Group) {
    // ---- Milky Way sphere ----------------------------------------------------
    const mw = S.milkyWay;
    const skyMat = new ShaderMaterial({
      vertexShader: milkyVert,
      fragmentShader: milkyFrag,
      uniforms: {
        uMap: { value: null },
        uGlowMap: { value: null },
        uGlow: { value: mw.glow },
        uGlowLod: { value: mw.glowLod },
        uGlowFloor: { value: mw.glowFloor },
        uBulgeTint: { value: new Color(...mw.bulgeTint) },
        uSceneToGalactic: { value: SCENE_TO_GALACTIC },
        uBrightness: { value: mw.brightness },
        uContrast: { value: mw.contrast },
        uSaturation: { value: mw.saturation },
        uNebula: { value: mw.nebulaStrength },
        uNebulaMap: { value: null },
      },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.sky = new Mesh(new SphereGeometry(1, SKY_SEGMENTS_W, SKY_SEGMENTS_H), skyMat);
    this.sky.name = 'milky-way';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = ORDER_SKY;
    this.sky.visible = false; // until the texture arrives
    skyGroup.add(this.sky);

    // ---- Point stars at infinity ----------------------------------------------
    const far = this.generateStars(S.stars.count, true);
    this.stars = new Points(this.toGeometry(far), makeStarMaterial(true));
    this.stars.name = 'stars';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = ORDER_STARS;
    skyGroup.add(this.stars);

    // ---- Near-star shell (parallax) -------------------------------------------
    const near = this.generateStars(S.parallax.count, false);
    this.nearStars = new Points(this.toGeometry(near), makeStarMaterial(false));
    this.nearStars.name = 'near-stars';
    this.nearStars.frustumCulled = false;
    this.nearStars.renderOrder = ORDER_STARS;
    world.add(this.nearStars);
    this.layoutNearStars();
    scale.onChange(() => this.layoutNearStars());
  }

  /**
   * Render the static procedural nebula into a texture once (the sky shader
   * used to evaluate it per pixel per frame, ~2 ms on integrated GPUs).
   */
  bakeNebula(renderer: WebGLRenderer): void {
    const rt = new WebGLRenderTarget(NEBULA_MAP_W, NEBULA_MAP_H, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
    rt.texture.wrapS = RepeatWrapping; // longitude wraps: no seam at u = 0/1
    const mat = new ShaderMaterial({
      vertexShader: nebulaBakeVert,
      fragmentShader: nebulaBakeFrag,
      uniforms: { uSceneToGalactic: { value: SCENE_TO_GALACTIC } },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new Scene().add(quad);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
    renderer.setRenderTarget(prev);
    quad.geometry.dispose();
    mat.dispose();
    const u = this.sky.material.uniforms.uNebulaMap;
    (u.value as Texture | null)?.dispose();
    u.value = rt.texture;
  }

  /** Show only the first n point stars (quality presets). */
  setStarCount(n: number): void {
    this.stars.geometry.setDrawRange(0, Math.max(0, Math.floor(n)));
  }

  /** Sharp layer: swapped from 2K to 8K once the latter arrives. */
  setMilkyWayTexture(tex: Texture): void {
    const u = this.sky.material.uniforms.uMap;
    const old = u.value as Texture | null;
    u.value = tex;
    this.sky.visible = this.sky.material.uniforms.uGlowMap.value !== null;
    if (old && old !== tex) old.dispose();
  }

  /** Diffuse layer: a mipmapped (low-res) copy of the panorama. */
  setMilkyWayGlowTexture(tex: Texture): void {
    this.sky.material.uniforms.uGlowMap.value = tex;
    this.sky.visible = this.sky.material.uniforms.uMap.value !== null;
  }

  private sampleDirection(out: Vector3): Vector3 {
    const rng = this.rng;
    if (rng.next() < S.stars.discFraction) {
      // Disc population: thin in galactic latitude, a bit denser towards
      // the bulge (l = 0).
      const towardsBulge = rng.next() < 0.3;
      const l = towardsBulge ? rng.gaussian() * 35 * DEG : rng.range(0, Math.PI * 2);
      const b = rng.laplace(S.stars.discSpreadDeg * DEG);
      return galacticToScene(l, Math.max(-Math.PI / 2, Math.min(Math.PI / 2, b)), out);
    }
    const z = rng.range(-1, 1);
    const phi = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(phi), z, r * Math.sin(phi));
  }

  /** Inverse-CDF sample of N(<m) ∝ 10^(k m) between MAG_BRIGHT and MAG_FAINT. */
  private sampleMagnitude(): number {
    const lo = Math.pow(10, MAG_SLOPE * (MAG_BRIGHT - MAG_FAINT));
    const u = lo + (1 - lo) * this.rng.next();
    return MAG_FAINT + Math.log10(u) / MAG_SLOPE;
  }

  private generateStars(count: number, infinite: boolean): StarBuffers {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const dir = new Vector3();
    const col = new Color();
    const near: number[] = [];

    for (let i = 0; i < count; i++) {
      if (infinite) this.sampleDirection(dir);
      else {
        const z = this.rng.range(-1, 1);
        const phi = this.rng.range(0, Math.PI * 2);
        const r = Math.sqrt(1 - z * z);
        dir.set(r * Math.cos(phi), z, r * Math.sin(phi));
        // Uniform in volume between the shell radii.
        const a3 = S.parallax.minAu ** 3;
        const b3 = S.parallax.maxAu ** 3;
        near.push(Math.cbrt(a3 + (b3 - a3) * this.rng.next()));
      }
      positions.set([dir.x, dir.y, dir.z], i * 3);

      const m = this.sampleMagnitude();
      const flux = Math.pow(10, -0.4 * (m - MAG_REFERENCE));
      // Perceived brightness grows slower than flux; bright stars get
      // bigger instead of just hotter, like a real exposure.
      const intensity = Math.min(2.2, 0.08 + 0.55 * Math.pow(flux, 0.5));
      const t = (MAG_FAINT - m) / (MAG_FAINT - MAG_BRIGHT);
      sizes[i] = S.stars.sizeMin + (S.stars.sizeMax - S.stars.sizeMin) * Math.pow(t, 2.2);

      const temp = this.rng.weighted(STAR_TEMPERATURES, STAR_TEMPERATURE_WEIGHTS) * this.rng.range(0.92, 1.08);
      saturate(blackbodyLinear(temp, col), STAR_SATURATION).multiplyScalar(intensity);
      colors.set([col.r, col.g, col.b], i * 3);
      phases[i] = this.rng.next();
    }

    if (!infinite) {
      this.nearDirections = positions.slice();
      this.nearDistancesAu = Float32Array.from(near);
    }
    return { positions, colors, sizes, phases };
  }

  private toGeometry(b: StarBuffers): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(b.positions, 3));
    g.setAttribute('aColor', new BufferAttribute(b.colors, 3));
    g.setAttribute('aSize', new BufferAttribute(b.sizes, 1));
    g.setAttribute('aPhase', new BufferAttribute(b.phases, 1));
    return g;
  }

  /** Place the near shell through the scale system (it changes with the mode). */
  private layoutNearStars(): void {
    const pos = this.nearStars.geometry.getAttribute('position') as BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.nearDistancesAu.length; i++) {
      const d = scale.distance(this.nearDistancesAu[i] * KM_PER_AU);
      arr[i * 3] = this.nearDirections[i * 3] * d;
      arr[i * 3 + 1] = this.nearDirections[i * 3 + 1] * d;
      arr[i * 3 + 2] = this.nearDirections[i * 3 + 2] * d;
    }
    pos.needsUpdate = true;
    this.nearStars.geometry.computeBoundingSphere();
  }

  update(ctx: FrameContext): void {
    for (const m of [this.stars.material, this.nearStars.material]) {
      m.uniforms.uTime.value = ctx.time.elapsed;
      m.uniforms.uPixelRatio.value = ctx.pixelRatio;
    }
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.nearStars.geometry.dispose();
    this.nearStars.material.dispose();
  }
}
