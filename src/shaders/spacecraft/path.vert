// Spacecraft path / orbit line: fades out near the camera, so an orbit that
// runs through the view (or through the craft being looked at) does not
// streak across it.

#include <common>
#include <logdepthbuf_pars_vertex>

varying float vDist;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
