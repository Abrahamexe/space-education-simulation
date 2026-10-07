// Planet marker — a single point at the body's centre, constant pixel size.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uSize;          // CSS pixels
uniform float uPixelRatio;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uPixelRatio;
  #include <logdepthbuf_vertex>
}
