// Galactic-frame trail. aAge: 0 at the body, 1 at the oldest point.

#include <common>
#include <logdepthbuf_pars_vertex>

attribute float aAge;

varying float vAge;
varying float vViewDist;
varying vec3 vWorld;

void main() {
  vAge = aAge;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
