// Interstellar dust fixed in the galactic frame. position = seed in [0,1)^3;
// each particle wraps inside a box of edge uBox centred on the camera, and
// uShift (box units, computed in double precision on the CPU) carries the
// galactic drift plus the camera's own absolute position.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform vec3 uShift;
uniform vec3 uCam;
uniform float uBox;
uniform float uAlpha;
uniform float uSizePx;
uniform float uPixelRatio;

attribute float aMag;

varying float vAlpha;

void main() {
  vec3 q = fract(position - uShift) - 0.5;
  vec3 wp = uCam + q * uBox;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float edge = 1.0 - smoothstep(0.36, 0.5, max(max(abs(q.x), abs(q.y)), abs(q.z)));
  float nearFade = smoothstep(0.015, 0.06, length(q));
  vAlpha = uAlpha * edge * nearFade * aMag;
  gl_PointSize = uSizePx * uPixelRatio;
  #include <logdepthbuf_vertex>
}
