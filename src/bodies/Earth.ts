import {
  Color,
  Mesh,
  NoColorSpace,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector3,
  type Group,
} from 'three';
import planetVert from '../shaders/planet/planet.vert?raw';
import earthFrag from '../shaders/planet/earth.frag?raw';
import cloudsFrag from '../shaders/planet/clouds.frag?raw';
import { PLANETS } from '../config/visual';
import { HighResSwap } from './HighResSwap';
import { sunUniforms } from '../core/lighting';
import type { FloatingOrigin } from '../core/FloatingOrigin';
import type { Loader } from '../core/Loader';
import type { FrameContext } from '../core/types';
import { sphereGeometries } from './CelestialBody';
import { Planet, type HeliocentricBodyData } from './Planet';
import type { OrbitModel } from '../physics/orbits';

const E = PLANETS.earth;

/** Which Earth maps hold colour (sRGB) and which hold data (linear). */
const TEXTURE_SPACES = {
  day: SRGBColorSpace,
  night: SRGBColorSpace,
  clouds: NoColorSpace,
  normal: NoColorSpace,
  specular: NoColorSpace,
} as const;
type EarthMap = keyof typeof TEXTURE_SPACES;

const UNIFORM_FOR: Record<EarthMap, string> = {
  day: 'uDay',
  night: 'uNight',
  clouds: 'uClouds',
  normal: 'uNormalMap',
  specular: 'uSpecular',
};

/**
 * Earth (PLAN §5.2): day/night shading with city lights, ocean glint,
 * land-only normal map, a separate drifting cloud shell that casts shadows,
 * and Rayleigh/Mie atmosphere (from the base class). 2K maps load at start;
 * the 4K set streams in the first time the camera comes close.
 */
export class Earth extends Planet {
  readonly clouds: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly cloudMaterial: ShaderMaterial;

  constructor(data: HeliocentricBodyData, model: OrbitModel, world: Group, origin: FloatingOrigin, loader: Loader) {
    super(data, model, world, origin, loader);

    const r = data.render;
    const su = this.surfaceMaterial.uniforms;
    this.cloudMaterial = new ShaderMaterial({
      vertexShader: planetVert,
      fragmentShader: cloudsFrag,
      uniforms: {
        ...sunUniforms,
        uShellScale: { value: 1 + (r.cloudAltitude ?? 0.008) },
        uClouds: su.uClouds, // same uniform object: texture swaps reach both
        uCloudOffset: su.uCloudOffset,
        uOpacity: { value: E.cloudOpacity as number },
        uTwilightTint: { value: new Color(...E.twilightTint) },
      },
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    this.clouds = new Mesh(sphereGeometries().near, this.cloudMaterial);
    this.clouds.name = 'earth-clouds';
    this.clouds.renderOrder = 15;
    this.body.add(this.clouds);
  }

  protected override createSurfaceMaterial(): ShaderMaterial {
    const t = this.desc.render.textures!;
    const uniforms: Record<string, { value: unknown }> = {
      ...this.baseUniforms(),
      uNormalStrength: { value: E.normalStrength as number },
      uCloudOffset: { value: 0 },
      uCloudAltitude: { value: this.desc.render.cloudAltitude ?? 0.008 },
      uCloudShadow: { value: E.cloudShadow as number },
      uNightIntensity: { value: E.nightIntensity as number },
      uNightTint: { value: new Color(...E.nightTint) },
      uSpecIntensity: { value: E.specIntensity as number },
      uSpecPower: { value: E.specPower as number },
    };
    for (const key of Object.keys(TEXTURE_SPACES) as EarthMap[]) {
      uniforms[UNIFORM_FOR[key]] = this.loadTexture(t[key], TEXTURE_SPACES[key] === NoColorSpace);
    }
    return new ShaderMaterial({ vertexShader: planetVert, fragmentShader: earthFrag, uniforms });
  }

  protected override updateMaterials(ctx: FrameContext): void {
    super.updateMaterials(ctx);
    const drift = this.desc.render.cloudDriftDegPerDay ?? 0;
    // Wrapped in double precision before it reaches the GPU.
    const offset = (((drift * ctx.time.daysSinceJ2000) / 360) % 1 + 1) % 1;
    this.surfaceMaterial.uniforms.uCloudOffset.value = offset;
  }

  override updateView(ctx: FrameContext, sunRender: Vector3, fadeNear: number): void {
    super.updateView(ctx, sunRender, fadeNear);
    this.earthHighRes ??= this.createHighResSwap();
    this.earthHighRes?.update(this.getRenderPosition(this.tmp).distanceTo(ctx.cameraPosition) / this.radius);
  }

  private earthHighRes: HighResSwap | null | undefined;

  /** 2K maps at start; the 4K set streams in close up and is released when far. */
  private createHighResSwap(): HighResSwap | null {
    const r = this.desc.render;
    if (!r.texturesHigh) return null;
    const u = this.surfaceMaterial.uniforms;
    const slots = (Object.keys(TEXTURE_SPACES) as EarthMap[])
      .filter((key) => r.texturesHigh![key])
      .map((key) => ({
        uniform: u[UNIFORM_FOR[key]] as { value: Texture | null },
        path: r.texturesHigh![key],
        opts: { colorSpace: TEXTURE_SPACES[key], wrapRepeatS: true },
      }));
    return new HighResSwap(this.loader, slots, r.highResWithinRadii ?? 40);
  }

  override dispose(): void {
    super.dispose();
    this.cloudMaterial.dispose();
    this.earthHighRes?.dispose();
  }
}
