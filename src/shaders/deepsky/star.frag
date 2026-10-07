// Star surface: blackbody colour, limb darkening and boiling convection.
// uCells sets the granulation scale: fine for dwarfs, a few giant cells for
// red supergiants such as Betelgeuse.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>

uniform vec3 uColor;
uniform float uBrightness;
uniform float uTime;
uniform float uCells;
uniform float uContrast;

varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewDir;

void main() {
  #include <logdepthbuf_fragment>
  float mu = clamp(dot(normalize(vNormalV), normalize(vViewDir)), 0.0, 1.0);
  vec3 p = normalize(vPos);
  float t = uTime * 0.05;
  float n = snoise(vec4(p * uCells, t)) * 0.6 + snoise(vec4(p * uCells * 2.3, t * 1.7)) * 0.3 + snoise(vec4(p * uCells * 5.1, t * 2.3)) * 0.1;
  float cells = 1.0 + uContrast * n;
  // Per-channel limb darkening: the edge reddens.
  vec3 limb = pow(vec3(max(mu, 0.0)), vec3(0.45, 0.6, 0.85));
  vec3 c = uColor * uBrightness * cells * limb;
  gl_FragColor = vec4(c, 1.0);
}
