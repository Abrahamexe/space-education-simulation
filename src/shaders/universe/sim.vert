// Cosmic-web time-lapse (Zel'dovich approximation): x = q + D·ψ(q).
// KIND 0 dark matter, 1 gas, 2 galaxies. aExtra: seed density δ (0, 1) or
// the galaxy's formation scale factor (2). Points are drawn smaller where
// matter has piled up, so brightness traces density (additive blending).

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uD;
uniform float uA;
uniform float uScale;
uniform float uBrightness;
uniform float uEarly;
uniform float uSlab;    // only |z| < uSlab (0: all)

attribute vec3 aPsi;
attribute float aExtra;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 p = position + uD * aPsi;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = max(-mv.z, 1e-6);
#if KIND == 2
  // Galaxies light up at their formation time, brightest when young (quasar era).
  float on = smoothstep(aExtra, aExtra * 1.35, uA);
  float young = 1.0 + 1.5 * (1.0 - smoothstep(aExtra * 1.3, aExtra * 3.0, uA));
  vColor = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.92, 0.75), smoothstep(0.15, 0.6, uA)) * young;
  vAlpha = on * uBrightness;
  float size = 1.4;
#elif KIND == 1
  vColor = vec3(1.0, 0.42, 0.78);
  vAlpha = uBrightness;
  float size = 1.5;
#else
  // Early on: the CMB-like seed pattern (blue below the mean, orange above).
  vec3 seed = aExtra < 0.0 ? mix(vec3(0.4, 0.55, 1.0), vec3(0.1, 0.25, 1.0), clamp(-aExtra * 0.6, 0.0, 1.0))
                           : mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.4, 0.1), clamp(aExtra * 0.6, 0.0, 1.0));
  vColor = mix(vec3(0.3, 0.5, 1.0), seed, uEarly);
  vAlpha = uBrightness;
  float size = 1.1;
#endif
  if (uSlab > 0.0) vAlpha *= 1.0 - smoothstep(uSlab * 0.8, uSlab, abs(p.z));
  float px = size * uScale / d;
  if (px < 1.0) {
    vAlpha *= max(px, 0.25);
    px = 1.0;
  }
  gl_PointSize = min(px, 6.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
