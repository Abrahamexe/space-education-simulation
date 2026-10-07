// Point stars — a sharp Gaussian core with a faint halo (the eye/optics
// point-spread function), additive and in linear HDR.

#ifndef INFINITE
#include <common>
#include <logdepthbuf_pars_fragment>
#endif

varying vec3 vColor;
varying float vAlpha;

void main() {
#ifndef INFINITE
  #include <logdepthbuf_fragment>
#endif
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;           // 0 at centre, 1 at the sprite edge
  float core = exp(-r2 * 10.0);
  float halo = exp(-r2 * 2.8) * 0.18;
  float a = (core + halo) * (1.0 - smoothstep(0.75, 1.0, r2)) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
