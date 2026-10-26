#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uOpacity;
uniform vec2 uFade;   // fully faded at x, full at y (view distance)
uniform float uEdge;  // soft edge, in ribbon half-widths
uniform float uDash;  // dash period in samples (0 = solid)
uniform float uTaper; // opacity lost along the first sample pair (beams fade out)

varying vec3 vView;
varying float vSide;
varying float vAlong;

void main() {
  #include <logdepthbuf_fragment>
  float a = uOpacity * smoothstep(uFade.x, uFade.y, length(vView));
  a *= 1.0 - smoothstep(1.0 - uEdge, 1.0, abs(vSide));
  a *= 1.0 - uTaper * clamp(vAlong, 0.0, 1.0);
  if (uDash > 0.0) {
    float f = fract(vAlong / uDash);
    a *= smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.52, 0.6, f));
  }
  if (!(a >= 0.002)) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
