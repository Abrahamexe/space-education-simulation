// Habitable zone: the conservative band (runaway → maximum greenhouse) in
// green, the optimistic margins (recent Venus, early Mars) fainter, with
// thin edge lines so the limits read clearly.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uOptIn;
uniform float uConsIn;
uniform float uConsOut;
uniform float uOptOut;
uniform float uOpacity;

varying float vR;

void main() {
  #include <logdepthbuf_fragment>
  float r = vR;
  float w = fwidth(r) * 1.5;
  float cons = smoothstep(uConsIn - w, uConsIn + w, r) * (1.0 - smoothstep(uConsOut - w, uConsOut + w, r));
  float opt = smoothstep(uOptIn - w, uOptIn + w, r) * (1.0 - smoothstep(uOptOut - w, uOptOut + w, r));
  float edge = 0.0;
  edge += 1.0 - smoothstep(0.0, w * 1.2, abs(r - uConsIn));
  edge += 1.0 - smoothstep(0.0, w * 1.2, abs(r - uConsOut));
  vec3 c = vec3(0.25, 0.85, 0.45) * (cons * 0.09 + (opt - cons) * 0.035 + edge * 0.4);
  c *= uOpacity;
  if (!(max(c.g, 0.0) >= 0.002)) discard;
  gl_FragColor = vec4(c, 1.0);
}
