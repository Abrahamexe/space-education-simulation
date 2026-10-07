// Prominence loop — vertex stage. Geometry is a TubeGeometry along a plasma
// arc; uv.x runs along the loop (0..1), uv.y around the tube (0..1).

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uErupt;        // 0 (anchored loop) … 1 (fully lifted off)
uniform float uEruptExpansion;

varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;

void main() {
  vUv = uv;
  vNormalV = normalize(normalMatrix * normal);
  // Eruption: heights above the surface are multiplied, so the footpoints
  // stay anchored while the arc balloons outwards (eruptive prominence).
  float r = length(position);
  vec3 pos = position / r * (1.0 + (r - 1.0) * (1.0 + uErupt * uEruptExpansion));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
