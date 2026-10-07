#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;

varying float vAlpha;

void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float a = vAlpha * smoothstep(0.5, 0.15, length(c));
  if (isnan(a) || !(a >= 0.002)) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
