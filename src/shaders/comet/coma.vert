// Coma sprite at the nucleus; size given in scene units, projected to px.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform vec3 uNucleus;
uniform float uRadius;       // scene units
uniform float uProjScale;

void main() {
  vec4 mv = modelViewMatrix * vec4(uNucleus, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  gl_PointSize = clamp(uRadius * 2.0 / max(-mv.z, 1e-6) * uProjScale, 2.0, 1024.0);
}
