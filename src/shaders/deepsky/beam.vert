// Pulsar beam: an open cone along +Y from the apex at the origin.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uLength;

varying float vAlong;
varying vec3 vWorld;
varying vec3 vNormalW;

void main() {
  vAlong = clamp(abs(position.y) / uLength, 0.0, 1.0);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
