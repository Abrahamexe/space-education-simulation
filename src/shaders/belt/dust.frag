// Belt points: soft dot, lit only by the Sun (no phase effects at this size).

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_planet>

uniform float uIntensity;

varying vec3 vColor;
varying float vAlpha;

void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = exp(-r2 * 4.0) * vAlpha * uIntensity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * uSunColor * a, 1.0);
}
