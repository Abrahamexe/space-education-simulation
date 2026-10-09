import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  FXAAEffect,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import {
  HalfFloatType,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { LENS_FLARE, POSTFX } from '../config/visual';
import { GradeEffect } from './effects/GradeEffect';
import { BlackHoleEffect, type BlackHoleView } from './effects/BlackHoleEffect';
import { LensFlareEffect } from './effects/LensFlareEffect';
import { SanitizeEffect } from './effects/SanitizeEffect';
import type { FrameContext } from './types';

/** A bright source that drives the lens flare (the Sun). */
export interface FlareSource {
  getRenderPosition(out: Vector3): Vector3;
  getRadius(): number;
}

/** A sphere that can block the flare source (planets, moons — Phase 2+). */
export interface FlareOccluder {
  getRenderPosition(out: Vector3): Vector3;
  getRadius(): number;
}

/**
 * Post-processing chain (PLAN §5.6), all in a half-float HDR target:
 *
 *   RenderPass ─▶ [Sanitize → Bloom → LensFlare → Grade(exposure, vignette) → ToneMapping]
 *              ─▶ [SMAA | FXAA]  (anti-aliasing on the tone-mapped, display-range image)
 *
 * The renderer's own tone mapping stays off; ToneMappingEffect does it so
 * bloom and flare operate on true HDR values.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly blackHole = new BlackHoleEffect();
  private readonly lensPass: EffectPass;
  readonly bloom: BloomEffect;
  readonly flare: LensFlareEffect;
  readonly grade: GradeEffect;
  readonly toneMapping: ToneMappingEffect;
  readonly smaa: SMAAEffect;
  private readonly smaaPass: EffectPass;
  private readonly fxaaPass: EffectPass;

  private flareSource: FlareSource | null = null;
  private readonly occluders = new Set<FlareOccluder>();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmpView = new Vector3();

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      multisampling: 0,
    });

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: POSTFX.bloom.intensity,
      luminanceThreshold: POSTFX.bloom.luminanceThreshold,
      luminanceSmoothing: POSTFX.bloom.luminanceSmoothing,
      radius: POSTFX.bloom.radius,
      levels: POSTFX.bloom.levels,
    });
    this.flare = new LensFlareEffect();
    this.grade = new GradeEffect();
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    // Bloom builds its mip chain from the raw render: keep NaN / Inf out of it
    // (the image itself is scrubbed by the SanitizeEffect in the same pass).
    const lum = this.bloom.luminanceMaterial;
    lum.fragmentShader = lum.fragmentShader.replace(
      'vec4 texel=texture2D(inputBuffer,vUv);',
      'vec4 texel=texture2D(inputBuffer,vUv);if(any(equal(floatBitsToUint(texel)&0x7f800000u,uvec4(0x7f800000u))))texel=vec4(0.0);texel=clamp(texel,0.0,3.0e4);',
    );
    lum.needsUpdate = true;
    // The bright-pass feeds a blur that starts at half resolution anyway.
    this.bloom.luminancePass.resolution.scale = 0.5;

    const hdrPass = new EffectPass(camera, new SanitizeEffect(), this.bloom, this.flare, this.grade, this.toneMapping);
    // Antialiasing: SMAA (three passes) on high / ultra, FXAA (one) below.
    this.smaaPass = new EffectPass(camera, this.smaa);
    this.fxaaPass = new EffectPass(camera, new FXAAEffect());
    this.fxaaPass.enabled = false;
    // Breaks up banding in dark sky gradients.
    this.smaaPass.dithering = this.fxaaPass.dithering = true;

    this.composer.addPass(new RenderPass(scene, camera));
    // Ray-traced black hole (galaxy view): its own pass so the lensed image
    // feeds bloom and the rest; off unless a hole is near.
    this.lensPass = new EffectPass(camera, this.blackHole);
    this.lensPass.enabled = false;
    this.composer.addPass(this.lensPass);
    this.composer.addPass(hdrPass);
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.fxaaPass);
  }

  /** Antialiasing level (quality presets): 0–1 FXAA, 2–3 SMAA high / ultra. */
  setAntialias(level: number): void {
    const smaa = level >= 2;
    this.smaaPass.enabled = smaa;
    this.fxaaPass.enabled = !smaa;
    if (smaa) this.smaa.applyPreset(level);
  }

  /** Bloom mip chain depth (quality presets). */
  setBloomLevels(levels: number): void {
    if (this.bloom.mipmapBlurPass.levels !== levels) this.bloom.mipmapBlurPass.levels = levels;
  }

  /** The black hole in view this frame, or null to switch the pass off. */
  setBlackHole(view: BlackHoleView | null): void {
    this.blackHole.set(view);
    this.lensPass.enabled = view !== null;
  }

  setFlareSource(src: FlareSource | null): void {
    this.flareSource = src;
  }

  addOccluder(o: FlareOccluder): void {
    this.occluders.add(o);
  }

  removeOccluder(o: FlareOccluder): void {
    this.occluders.delete(o);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  update(ctx: FrameContext): void {
    this.flare.u('uFlareTime').value = ctx.time.elapsed;
    this.flare.u('uVisibility').value = this.computeFlareVisibility();
  }

  render(deltaS: number): void {
    this.composer.render(deltaS);
  }

  /**
   * 0..1: is the source in front of the camera, on (or just off) screen,
   * and not hidden behind an occluding sphere?
   */
  private computeFlareVisibility(): number {
    const src = this.flareSource;
    if (!src) return 0;
    const cam = this.camera;
    const pos = src.getRenderPosition(this.tmp);

    // Behind the camera → no flare.
    this.tmpView.copy(pos).applyMatrix4(cam.matrixWorldInverse);
    if (this.tmpView.z >= 0) return 0;

    // Inside the source (should not happen thanks to minDistance).
    const dist = pos.distanceTo(cam.position);
    if (dist <= src.getRadius()) return 0;

    const ndc = this.tmp2.copy(pos).project(cam);
    this.flare.u<Vector2>('uSunPos').value.set(
      ndc.x * 0.5 + 0.5,
      ndc.y * 0.5 + 0.5,
    );
    const over = Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) - 1;
    let vis = 1 - MathUtils.smoothstep(over, 0, LENS_FLARE.edgeFade);

    // Sphere occlusion: compare angular separation with angular radii.
    if (vis > 0 && this.occluders.size > 0) {
      const toSrc = this.tmp2.copy(pos).sub(cam.position).normalize();
      const srcAng = Math.asin(Math.min(1, src.getRadius() / dist));
      for (const o of this.occluders) {
        const op = o.getRenderPosition(this.tmpView);
        const od = op.distanceTo(cam.position);
        if (od >= dist || od <= o.getRadius()) continue;
        const occAng = Math.asin(Math.min(1, o.getRadius() / od));
        const sep = Math.acos(MathUtils.clamp(op.sub(cam.position).normalize().dot(toSrc), -1, 1));
        // Fully hidden when sep + srcAng < occAng, free when sep > occAng + srcAng.
        const cover = 1 - MathUtils.smoothstep(sep, occAng - srcAng, occAng + srcAng);
        vis *= 1 - cover;
        if (vis <= 0) break;
      }
    }
    return vis;
  }
}
