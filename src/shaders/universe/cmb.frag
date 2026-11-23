// The last-scattering sphere: WMAP ILC map, equirectangular in Galactic
// coordinates (u = l / 360°, v = 0.5 + b / 180°), sampled by direction.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uMap;
uniform mat3 uEqToGal;
uniform float uOpacity;

varying vec3 vDir;

void main() {
  #include <logdepthbuf_fragment>
  vec3 g = normalize(uEqToGal * normalize(vDir));
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  vec2 uv = vec2(fract(l / (2.0 * PI)), 0.5 + b / PI);
  vec3 c = texture2D(uMap, uv).rgb;
  gl_FragColor = vec4(c * uOpacity, 1.0);
}
