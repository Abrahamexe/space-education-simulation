// Atmosphere shell — vertex stage. The mesh is a unit sphere scaled to the
// top of the atmosphere; everything is expressed in the planet's (flattened
// → spherical) object space, where the planet is the unit sphere.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uTop;   // top-of-atmosphere radius (planet radii)

varying vec3 vLocal;

void main() {
  vec3 p = position * uTop;
  vLocal = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}
