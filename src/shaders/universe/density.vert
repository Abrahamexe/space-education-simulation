// Dark-matter density volume: a box in the data frame (equatorial Mpc),
// ray-marched in the fragment shader. Drawn with its back faces so it works
// from inside the box too.

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vObj;

void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
