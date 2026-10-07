// Camera-facing glow around a star: a quad in view space, at least
// uMinPx pixels across so a star never vanishes.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uRadius;   // glow radius, object units
uniform float uMinPx;
uniform float uScale;    // px per unit at distance 1

varying vec2 vQuad;

void main() {
  vQuad = position.xy;
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float d = max(-c.z, 1e-12);
  // Object-space radius → view space (the group may be scaled, e.g. AU → pc).
  float sx = length(modelViewMatrix[0].xyz);
  float r = max(uRadius * sx, uMinPx * d / uScale);
  c.xy += position.xy * r;
  gl_Position = projectionMatrix * c;
  #include <logdepthbuf_vertex>
}
