// Relativistic jet: a tube along +Y whose rings are spaced logarithmically
// from a few Schwarzschild radii to kiloparsecs. Camera-relative.

#include <common>
#include <logdepthbuf_pars_vertex>

attribute float aAlong;   // 0 at the base .. 1 at the tip (log of distance)

varying float vAlong;
varying vec3 vView;
varying vec3 vNormalV;

void main() {
  vAlong = aAlong;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
