#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uOpacity;
uniform vec2 uFade;   // fully faded at x, full at y (view distance)

varying float vDist;

void main() {
  #include <logdepthbuf_fragment>
  float a = uOpacity * smoothstep(uFade.x, uFade.y, vDist);
  if (!(a >= 0.002)) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
