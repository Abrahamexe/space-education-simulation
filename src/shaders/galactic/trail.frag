// Galactic-frame trail: bright at the body, fading into the past.
// Same near/focus fades and NaN guard as the orbit lines.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uOpacity;
uniform float uFadeNear;
uniform vec3 uFocusPos;
uniform float uFocusFade;

varying float vAge;
varying float vViewDist;
varying vec3 vWorld;

void main() {
  #include <logdepthbuf_fragment>
  float trail = pow(1.0 - clamp(vAge, 0.0, 1.0), 1.6);
  float near = (uFadeNear > 0.0 ? smoothstep(uFadeNear * 0.4, uFadeNear, vViewDist) : 1.0);
  near *= (uFocusFade > 0.0 ? smoothstep(uFocusFade * 0.35, uFocusFade, distance(vWorld, uFocusPos)) : 1.0);
  float a = uOpacity * trail * near;
  if (isnan(a) || !(a >= 0.002)) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
