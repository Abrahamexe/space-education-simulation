import { Effect } from 'postprocessing';
import { Uniform, Vector2 } from 'three';
import fragment from '../../shaders/postfx/lensflare.frag?raw';
import { LENS_FLARE } from '../../config/visual';

/** Procedural, HDR lens flare. CPU side only feeds position + visibility. */
export class LensFlareEffect extends Effect {
  constructor() {
    super('LensFlareEffect', fragment, {
      uniforms: new Map<string, Uniform>([
        ['uSunPos', new Uniform(new Vector2(0.5, 0.5))],
        ['uVisibility', new Uniform(0)],
        ['uIntensity', new Uniform(LENS_FLARE.intensity)],
        ['uGhost', new Uniform(LENS_FLARE.ghostIntensity)],
        ['uHalo', new Uniform(LENS_FLARE.haloIntensity)],
        ['uStreak', new Uniform(LENS_FLARE.streakIntensity)],
        ['uStarburst', new Uniform(LENS_FLARE.starburstIntensity)],
        ['uFlareTime', new Uniform(0)],
      ]),
    });
  }

  u<T = number>(name: string): Uniform<T> {
    return this.uniforms.get(name) as Uniform<T>;
  }
}
