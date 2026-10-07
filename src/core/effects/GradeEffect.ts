import { Effect } from 'postprocessing';
import { Uniform } from 'three';
import fragment from '../../shaders/postfx/grade.frag?raw';
import { POSTFX } from '../../config/visual';

/** Linear-HDR exposure and vignette, placed right before tone mapping. */
export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', fragment, {
      uniforms: new Map<string, Uniform>([
        ['uExposure', new Uniform(POSTFX.exposure)],
        ['uVignette', new Uniform(POSTFX.vignette)],
      ]),
    });
  }

  get exposure(): number {
    return (this.uniforms.get('uExposure') as Uniform<number>).value;
  }

  set exposure(v: number) {
    (this.uniforms.get('uExposure') as Uniform<number>).value = v;
  }

  get vignette(): number {
    return (this.uniforms.get('uVignette') as Uniform<number>).value;
  }

  set vignette(v: number) {
    (this.uniforms.get('uVignette') as Uniform<number>).value = v;
  }
}
