// Planet marker: when a planet is smaller than a few pixels it is drawn as
// a soft point of light (as planets look to the eye), fading out as soon as
// the real disk becomes resolvable.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uVisibility;

void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = (exp(-r2 * 7.0) + exp(-r2 * 2.0) * 0.15) * (1.0 - smoothstep(0.8, 1.0, r2)) * uVisibility;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
