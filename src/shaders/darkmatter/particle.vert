// Dark-matter scenes: one particle, blended between two simulation frames on the GPU.
attribute vec3 positionB;
attribute float rhoA;
attribute float rhoB;

uniform float uMix;
uniform float uSize;     // world size (Mpc)
uniform float uScale;    // px per (world unit / depth): drawing-buffer height / (2 tan(fov/2))
uniform float uMinPx;
uniform float uMaxPx;
uniform float uRhoRef;   // > 0: brightness follows density / uRhoRef
uniform float uRhoMax;

varying float vBright;

void main() {
  vec3 p = mix(position, positionB, uMix);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = max(-mv.z, 1e-3);
  float px = uSize * uScale / depth;
  gl_PointSize = clamp(px, uMinPx, uMaxPx);
  // Sprites clamped below their true size would brighten when far: keep the energy constant.
  float shrink = px / gl_PointSize;
  vBright = clamp(shrink * shrink, 0.0, 1.0);
  if (uRhoRef > 0.0) vBright *= min(mix(rhoA, rhoB, uMix) / uRhoRef, uRhoMax);
  gl_Position = projectionMatrix * mv;
}
