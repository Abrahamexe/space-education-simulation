import { BlendFunction, Effect } from 'postprocessing';
import fragment from '../../shaders/postfx/sanitize.frag?raw';

/**
 * Replaces NaN / Inf HDR pixels (see sanitize.frag). A per-pixel effect, so
 * it merges into the HDR pass instead of costing a full-screen pass.
 */
export class SanitizeEffect extends Effect {
  constructor() {
    super('SanitizeEffect', fragment, { blendFunction: BlendFunction.NORMAL });
  }
}
