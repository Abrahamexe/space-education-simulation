// Universe map: one point per galaxy. aSize is the galaxy's own size (Mpc),
// so near galaxies grow; below a pixel they keep 1 px and lose brightness.
// Cinematic: soft additive glow. Science (uCrisp = 1): small hard dots that
// never fall below uMinPx, so sparse structure stays readable.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uScale;      // device px per unit at distance 1
uniform float uMinPx;
uniform float uMaxPx;
uniform float uBrightness;

attribute vec3 aColor;
attribute float aSize;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 1e-6);
  float px = aSize * uScale / d;
  float alpha = uBrightness;
  if (px < 1.0) {
    alpha *= max(px, 0.18);
    px = 1.0;
  }
  px = clamp(px, uMinPx, uMaxPx);
  // Right next to the camera a point would fill the view: fade it.
  alpha *= smoothstep(aSize * 2.0, aSize * 8.0, d);
  gl_PointSize = px;
  vColor = aColor;
  vAlpha = alpha;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
