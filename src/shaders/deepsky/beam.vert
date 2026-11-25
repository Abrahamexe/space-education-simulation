// Pulsar beam (and SS 433 jet): an open cone along +Y from the apex at the origin.
// Computed in view space: modelViewMatrix is formed on the CPU in double precision, so tiny cones
// (AU-sized jets) far from the world origin keep their shape; world-space float32 would collapse them.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uLength;

varying float vAlong;
varying vec3 vView;
varying vec3 vNormalV;

void main() {
  vAlong = clamp(abs(position.y) / uLength, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
