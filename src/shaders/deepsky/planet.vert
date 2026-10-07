#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewPos;

void main() {
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
