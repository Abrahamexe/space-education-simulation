import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Color, Matrix3, Uniform, Vector3, type Texture } from 'three';
import fragment from '../../shaders/postfx/blackhole.frag?raw';

/** Accretion disc look (radii in Schwarzschild radii). */
export interface DiscLook {
  inner: number;
  outer: number;
  gain: number;
  doppler: number;
  hot: Color;
  warm: Color;
}

/** Per-frame description of the hole being looked at (its own frame, Rs units). */
export interface BlackHoleView {
  camPos: Vector3;
  camRot: Matrix3;
  tanHalfFov: number;
  disc: DiscLook | null;
  sky: Texture | null;
  skyGain: number;
  skyMat: Matrix3;
  time: number;
  /** Bend light (default). Off: straight rays, only the shadow and disc are drawn. */
  lensing?: boolean;
}

/**
 * Ray-traced Schwarzschild black hole as a screen effect (see
 * blackhole.frag). Runs in its own pass; off when no hole is near.
 */
export class BlackHoleEffect extends Effect {
  constructor() {
    super('BlackHoleEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uActive', new Uniform(0)],
        ['uCamPos', new Uniform(new Vector3())],
        ['uCamRot', new Uniform(new Matrix3())],
        ['uTanHalf', new Uniform(0.4)],
        ['uR0', new Uniform(60)],
        ['uDiskOn', new Uniform(0)],
        ['uDiskIn', new Uniform(3)],
        ['uDiskOut', new Uniform(14)],
        ['uDiskGain', new Uniform(2)],
        ['uDoppler', new Uniform(0.25)],
        ['uDiskHot', new Uniform(new Color(1, 0.92, 0.8))],
        ['uDiskWarm', new Uniform(new Color(1, 0.5, 0.15))],
        ['uTime', new Uniform(0)],
        ['uSky', new Uniform(null)],
        ['uSkyOn', new Uniform(0)],
        ['uSkyGain', new Uniform(1)],
        ['uSkyMat', new Uniform(new Matrix3())],
        ['uLens', new Uniform(1)],
      ]),
    });
  }

  private u<T>(name: string): Uniform<T> {
    return this.uniforms.get(name) as Uniform<T>;
  }

  set(view: BlackHoleView | null): void {
    this.u<number>('uActive').value = view ? 1 : 0;
    if (!view) return;
    this.u<Vector3>('uCamPos').value.copy(view.camPos);
    this.u<Matrix3>('uCamRot').value.copy(view.camRot);
    this.u<number>('uTanHalf').value = view.tanHalfFov;
    this.u<number>('uTime').value = view.time;
    this.u<number>('uLens').value = view.lensing === false ? 0 : 1;
    const d = view.disc;
    this.u<number>('uDiskOn').value = d ? 1 : 0;
    if (d) {
      this.u<number>('uDiskIn').value = d.inner;
      this.u<number>('uDiskOut').value = d.outer;
      this.u<number>('uDiskGain').value = d.gain;
      this.u<number>('uDoppler').value = d.doppler;
      this.u<Color>('uDiskHot').value.copy(d.hot);
      this.u<Color>('uDiskWarm').value.copy(d.warm);
    }
    this.u<number>('uR0').value = d ? Math.max(60, d.outer * 2.5) : 40;
    this.u<Texture | null>('uSky').value = view.sky;
    this.u<number>('uSkyOn').value = view.sky ? 1 : 0;
    this.u<number>('uSkyGain').value = view.skyGain;
    this.u<Matrix3>('uSkyMat').value.copy(view.skyMat);
  }
}
