// Exoplanet: lit by its star (uLightPos, view space), with soft surface
// variation so close-ups are not flat discs.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>

uniform vec3 uColor;
uniform vec3 uLightColor;
uniform vec3 uLightPosV;

varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewPos;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalV);
  vec3 l = normalize(uLightPosV - vViewPos);
  float diff = max(dot(n, l), 0.0);
  vec3 p = normalize(vPos);
  float var = 0.75 + 0.25 * snoise(p * 3.0) + 0.1 * snoise(p * 11.0);
  vec3 c = uColor * var * uLightColor * (diff + 0.02);
  gl_FragColor = vec4(c, 1.0);
}
