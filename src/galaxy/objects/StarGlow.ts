import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import glowVert from '../../shaders/deepsky/glow.vert?raw';
import glowFrag from '../../shaders/deepsky/glow.frag?raw';

const QUAD = new PlaneGeometry(2, 2);

/**
 * Camera-facing star glow (a point of light with halo and faint spikes),
 * never smaller than `minPx`. Its material needs `uScale` every frame.
 */
export function makeGlow(color: Color | readonly [number, number, number], radius: number, intensity = 1.5, minPx = 6, spikes = 0.25): Mesh<PlaneGeometry, ShaderMaterial> {
  const c = color instanceof Color ? color.clone() : new Color(color[0], color[1], color[2]);
  const m = new Mesh(
    QUAD,
    new ShaderMaterial({
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      uniforms: {
        uColor: { value: c },
        uIntensity: { value: intensity },
        uSpikes: { value: spikes },
        uRadius: { value: radius },
        uMinPx: { value: minPx },
        uScale: { value: 1000 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
    }),
  );
  m.frustumCulled = false;
  m.renderOrder = 6;
  return m;
}
