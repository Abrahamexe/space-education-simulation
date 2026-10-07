// Orbit path — thin, additive, tinted with the planet's colour.
// Fades near the camera so a line never slices through a close-up view.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uOpacity;
uniform float uHighlight;    // 0 normal, 1 selected
uniform float uFadeNear;     // view distance below which the line fades out
uniform vec3 uFocusPos;      // focused body, render space
uniform float uFocusFade;    // lines fade within this distance of it

varying float vTrail;
varying float vViewDist;
varying vec3 vWorld;

void main() {
  #include <logdepthbuf_fragment>
  float trail = mix(0.22, 1.0, pow(max(1.0 - vTrail, 0.0), 2.2));
  float near = (uFadeNear > 0.0 ? smoothstep(uFadeNear * 0.4, uFadeNear, vViewDist) : 1.0);
  // Never draw a line straight through the body we are looking at.
  near *= (uFocusFade > 0.0 ? smoothstep(uFocusFade * 0.35, uFocusFade, distance(vWorld, uFocusPos)) : 1.0);
  float a = uOpacity * trail * near * (1.0 + uHighlight * 1.5);
  // A far-away orbit collapses to a few pixels; for near-zero-length line
  // segments some drivers (ANGLE / D3D11) hand the fragment NaN varyings.
  // One NaN pixel in the HDR buffer becomes black blocks after bloom, so
  // test in a form NaN cannot pass (every comparison with NaN is false).
  if (isnan(a) || !(a >= 0.002)) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
