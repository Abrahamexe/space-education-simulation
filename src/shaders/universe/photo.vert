// A galaxy photo on a quad (Local Group members, the Milky Way's disc).

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
