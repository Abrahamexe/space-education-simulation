// Belt as points of light: what the belt looks like from afar, where each
// rock is far below a pixel. Fades out as the real rocks become resolvable,
// so the two layers hand over smoothly.

#include <common>
#include <logdepthbuf_pars_vertex>
#include <space_kepler>

uniform float uPointSize;     // CSS px
uniform float uPixelRatio;
uniform float uSizeBoost;
uniform float uViewportHalfHeight;   // device px
uniform float uTanHalfFov;
uniform float uDt;             // days since the CPU solve

attribute float aSize;         // diameter, km (position = centre at the epoch)
attribute vec3 aVelocity;      // scene units per day at the epoch
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 centre = position + aVelocity * uDt;
  vec4 mv = modelViewMatrix * vec4(centre, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>

  // Apparent radius of the actual rock in device pixels.
  float r = sceneRadius(aSize) * uSizeBoost;
  float rPx = r / max(-mv.z, 1e-6) / uTanHalfFov * uViewportHalfHeight;
  vAlpha = 1.0 - smoothstep(0.6, 2.0, rPx);
  gl_PointSize = uPointSize * uPixelRatio;
  vColor = aColor;
}
