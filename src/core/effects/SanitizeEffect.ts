import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import fragment from '../../shaders/postfx/sanitize.frag?raw';

/** Replaces NaN / Inf HDR pixels (see sanitize.frag); runs before bloom. */
export class SanitizeEffect extends Effect {
  constructor() {
    super('SanitizeEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
    });
  }
}
