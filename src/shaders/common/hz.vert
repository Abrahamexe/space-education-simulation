// Habitable-zone band: a flat annulus; vR is the radius in the band's own
// units so the fragment shader can shade by the zone limits.

#include <common>
#include <logdepthbuf_pars_vertex>

varying float vR;

void main() {
  vR = length(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
