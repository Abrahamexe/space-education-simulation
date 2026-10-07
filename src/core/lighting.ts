import { Color, Vector3 } from 'three';
import { PLANETS } from '../config/visual';

/**
 * Sunlight uniforms shared by every body material (one object, referenced by
 * all ShaderMaterials, so a single per-frame write updates them all).
 * Matches the uniform block declared in shaders/common/planet.glsl.
 */
export const sunUniforms = {
  uSunPosW: { value: new Vector3() },
  uSunColor: { value: new Color(...PLANETS.sunlight.color) },
  uSunIntensity: { value: PLANETS.sunlight.intensity as number },
  uAmbient: { value: PLANETS.sunlight.ambient as number },
  // A second star (playground): position, colour and luminosity (L☉);
  // uStarRef = scene distance at which it gives the Sun's light (1 AU × √L).
  uStarPosW: { value: new Vector3() },
  uStarColor: { value: new Color(1, 1, 1) },
  uStarLum: { value: 0 },
  uStarRef: { value: 1 },
  uStarGain: { value: PLANETS.sunlight.intensity as number },
};
