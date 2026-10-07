// Accretion flow around Sgr A*: a ring in the local XY plane.

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec2 vPos;

void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
