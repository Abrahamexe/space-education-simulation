// Orbit path. aPhase is the mean-anomaly phase (0..1) of each vertex; the
// trail brightens just behind the planet and fades ahead of it, which shows
// the direction of motion without arrows.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uPlanetPhase;

attribute float aPhase;

varying float vTrail;     // 0 at the planet, → 1 going backwards round the orbit
varying float vViewDist;
varying vec3 vWorld;

void main() {
  vTrail = fract(uPlanetPhase - aPhase);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
