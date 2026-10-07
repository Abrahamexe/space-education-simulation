// Comet tail particle: soft gaussian, additive HDR.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uIntensity;

varying vec3 vColor;
varying float vAlpha;

void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 14.0) * vAlpha * uIntensity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
