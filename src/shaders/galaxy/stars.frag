#include <common>
#include <logdepthbuf_pars_fragment>

varying vec3 vColor;
varying float vAlpha;

void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  float a = vAlpha * exp(-r2 * 3.0) * step(r2, 1.0);
  if (isnan(a) || !(a >= 0.001)) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
