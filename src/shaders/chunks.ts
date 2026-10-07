import { ShaderChunk } from 'three';
import noise from './common/noise.glsl?raw';
import planet from './common/planet.glsl?raw';
import kepler from './common/kepler.glsl?raw';

/**
 * Registers project-wide GLSL chunks with three.js so any ShaderMaterial (and
 * postprocessing Effect, which is one under the hood) can `#include` them.
 * Must run before the first material compiles.
 */
export function registerShaderChunks(): void {
  const chunks = ShaderChunk as Record<string, string>;
  chunks['space_noise'] = noise;
  chunks['space_planet'] = planet;
  chunks['space_kepler'] = kepler;
}
