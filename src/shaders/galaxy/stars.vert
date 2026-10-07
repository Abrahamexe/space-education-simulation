// Galaxy-scale star particles. aSize is a physical size (pc): points shrink
// with distance; below one pixel they keep a 1 px footprint and lose
// brightness instead (no shimmer). Particles right next to the camera fade
// out so they never balloon into fake bright stars.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uScale;      // device px per unit at distance 1
uniform float uMaxPx;
uniform float uMinPx;      // floor for marker points (0 for the field)
uniform float uBrightness;
uniform float uNearFade;   // pc

attribute vec3 aColor;
attribute float aSize;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 1e-6);
  float px = aSize * uScale / d;
  float alpha = uBrightness;
  if (px < 1.0) {
    alpha *= px * px;
    px = 1.0;
  }
  px = clamp(px, uMinPx, uMaxPx);
  // smoothstep(0, 0, x) is undefined in GLSL: NaN on some GPUs (NVIDIA),
  // which showed as black squares round black holes (S-stars, gas streams).
  if (uNearFade > 0.0) alpha *= smoothstep(uNearFade * 0.5, uNearFade, length(mv.xyz));
  gl_PointSize = px;
  vColor = aColor;
  vAlpha = alpha;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
