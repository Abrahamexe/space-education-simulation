// One depth slice of a volumetric picture (nebula, galaxy). Camera-relative
// (modelViewMatrix is built in double precision on the CPU), so objects
// billions of parsecs away stay steady.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uZ;        // this slice's depth (units of uZRange, -1..1)
uniform float uZRange;   // object units
uniform vec3 uZDir;      // local direction the slices are stacked along
uniform float uEye;      // camera distance along the line of sight (0: off-axis)
uniform vec2 uAnchor;    // local point on that line

varying vec2 vUv;
varying vec3 vView;
varying vec3 vNormalV;

void main() {
  vUv = uv;
  vec3 p = position;
  float dz = uZ * uZRange;
  // Seen from near Earth's side, each slice is scaled about the line of sight
  // by its depth, so all slices project onto the same picture (no radial
  // streaks from perspective); off-axis they keep their true size.
  if (uEye > 0.0) p.xy = uAnchor + (p.xy - uAnchor) * max(1.0 - dz / uEye, 0.05);
  p += uZDir * dz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = mv.xyz;
  // The picture plane's normal (normalMatrix also undoes the galaxy shear).
  vNormalV = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
