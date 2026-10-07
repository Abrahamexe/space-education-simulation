// A star's surface (object space: unit sphere).

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewDir;

void main() {
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
