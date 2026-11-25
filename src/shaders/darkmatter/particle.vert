// Dark-matter scenes: one particle, blended between two simulation frames on the GPU.
attribute vec3 positionB;
attribute float rhoA;
attribute float rhoB;
attribute float tA;       // log10 T (gas), used when uTemp = 1
attribute float tB;

uniform float uMix;
uniform float uSize;     // world size (Mpc)
uniform float uScale;    // px per (world unit / depth): drawing-buffer height / (2 tan(fov/2))
uniform float uMinPx;
uniform float uMaxPx;
uniform float uRhoRef;   // > 0: brightness follows density / uRhoRef
uniform float uRhoMax;
uniform float uTemp;     // 1: colour from temperature stops
uniform vec4 uStops[5];  // x: log10 T, yzw: RGB 0–1

varying float vBright;
varying vec3 vTint;

vec3 tempColour(float lt) {
  vec3 c = uStops[0].yzw;
  for (int i = 0; i < 4; i++) {
    float a = uStops[i].x;
    float b = uStops[i + 1].x;
    float w = clamp((lt - a) / max(b - a, 1e-3), 0.0, 1.0);
    if (lt >= a) c = mix(uStops[i].yzw, uStops[i + 1].yzw, w);
  }
  return c;
}

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
  vTint = uTemp > 0.5 ? tempColour(mix(tA, tB, uMix)) : vec3(1.0);
  gl_Position = projectionMatrix * mv;
}
