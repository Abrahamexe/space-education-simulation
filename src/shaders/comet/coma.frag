// Coma: the diffuse gas/dust cloud around an active nucleus, as one large
// camera-facing sprite with a 1/r-like profile and a bright inner core.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uIntensity;

void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float profile = (1.0 / (1.0 + r * 18.0) - 1.0 / 19.0) * 1.06 + exp(-r * r * 300.0) * 0.6;
  gl_FragColor = vec4(uColor * profile * uIntensity, 1.0);
}
