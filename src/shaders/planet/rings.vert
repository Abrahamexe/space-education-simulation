// Planetary rings — flat annulus in the planet's equatorial plane (y = 0),
// in planet object space (units of equatorial radius).

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vLocal;

void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
