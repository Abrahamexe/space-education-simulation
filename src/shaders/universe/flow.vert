// Galaxy flow lines (linear theory). aAlong: distance along the line (Mpc),
// aSpeed: flow speed (km/s).

#include <common>
#include <logdepthbuf_pars_vertex>

attribute float aAlong;
attribute float aSpeed;

varying float vAlong;
varying float vSpeed;
varying float vDist;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vAlong = aAlong;
  vSpeed = aSpeed;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
