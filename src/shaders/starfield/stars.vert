// Point stars.
//  - With INFINITE defined, `position` is a unit direction: the star sits at
//    infinity (no parallax), drawn just inside the far plane.
//  - Without it, `position` is a real scene position (near-star shell), so
//    the star shows parallax while travelling and is depth-tested with the
//    logarithmic depth buffer.
// Sub-pixel stars keep a 1 px footprint and lose brightness instead of
// size, which avoids shimmering.

#include <common>
#ifndef INFINITE
#include <logdepthbuf_pars_vertex>
#endif

uniform float uTime;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uBrightness;
uniform float uTwinkle;
uniform float uTwinkleSpeed;

attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;

varying vec3 vColor;
varying float vAlpha;

void main() {
#ifdef INFINITE
  vec3 viewDir = mat3(viewMatrix) * position;
  vec4 clip = projectionMatrix * vec4(viewDir, 1.0);
  // Just inside the far plane so opaque bodies (log depth) still occlude it.
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
#else
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
#endif

  // Two incommensurate sines per star: irregular, never synchronised.
  float s = uTime * uTwinkleSpeed;
  float tw = sin(s * (0.7 + aPhase) + aPhase * 43.0) * 0.6
           + sin(s * 1.9 * (0.5 + aPhase) + aPhase * 17.0) * 0.4;
  float twinkle = 1.0 + uTwinkle * tw;

  float size = aSize * uSizeScale * uPixelRatio;
  gl_PointSize = max(size, 1.5);
  // Energy-preserving shrink for sub-pixel sizes.
  float coverage = clamp(size / 1.5, 0.0, 1.0);

  vColor = aColor;
  vAlpha = uBrightness * twinkle * coverage * coverage;
}
