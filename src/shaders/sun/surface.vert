// Sun photosphere — vertex stage.
// Passes the object-space position (rotates with the Sun, so surface
// features are anchored to it) and view-space vectors for limb darkening.

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vObjPos;   // unit-sphere position in the Sun's rotating frame
varying vec3 vNormalV;  // view-space normal
varying vec3 vViewPos;  // view-space position

void main() {
  vObjPos = normalize(position);
  vNormalV = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
