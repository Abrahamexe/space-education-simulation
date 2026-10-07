// Box around the bar/bulge; the fragment shader integrates the glow along
// each view ray through a Gaussian ellipsoid.

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vObj;

void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
