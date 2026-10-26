// Spacecraft path / orbit ribbon: a polyline extruded to a constant pixel width
// facing the camera (see spacecraft/Ribbon.ts). Fades out near the camera, so an
// orbit that runs through the view (or through the craft being looked at) does
// not streak across it.
//
// RTE (relative to eye): the voyage paths span thousands of scene units while
// a close-up looks at a few thousandths of one, far finer than a float32 holds
// at that distance. Their vertices are absolute positions split into a float32
// part and its remainder; the camera's absolute position is split the same way
// (uCamHi / uCamLo, from doubles on the CPU). The difference is then exact
// where it matters, near the camera.

#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 tangent;
attribute float side;
attribute float along;

uniform float uHalf;   // half the ribbon width, as a fraction of the viewport height

#ifdef RTE
attribute vec3 positionLow;
uniform vec3 uCamHi;
uniform vec3 uCamLo;
#endif

// View-space position: the fragment takes its distance from it. (The distance
// itself, interpolated between two far-apart samples, misses a line passing
// close to the eye.)
varying vec3 vView;
varying float vSide;
varying float vAlong;

void main() {
#ifdef RTE
  mat3 rot = mat3(viewMatrix);
  vec4 mv = vec4(rot * ((position - uCamHi) + (positionLow - uCamLo)), 1.0);
  vec3 t = rot * tangent;
#else
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 t = (modelViewMatrix * vec4(tangent, 0.0)).xyz;
#endif
  vec3 n = cross(t, mv.xyz);
  float nl = length(n);
  // Looking straight along the line: no width to give.
  n = nl > 1e-12 ? n / nl : vec3(0.0);
  float depth = abs(mv.z);
  mv.xyz += n * (side * uHalf * 2.0 * depth / projectionMatrix[1][1]);
  vView = mv.xyz;
  vSide = side;
  vAlong = along;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
