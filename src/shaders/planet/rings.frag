// Planetary rings (PLAN §5.3).
//
//  - Radial colour/opacity profile from a 1D texture (u = radius).
//  - Planet shadow: ray from the ring point towards the Sun tested against
//    the (flattened) planet, with a soft penumbra.
//  - Lit face vs unlit face: seen from the sunlit side the rings reflect;
//    seen from the dark side only light diffusing *through* them arrives, so
//    thin regions (C ring, Cassini Division) glow and the dense B ring goes
//    dark — the inverted look of Cassini's backlit images. Looking towards
//    the Sun adds forward scattering.
//  - Fine radial ringlets appear only when they are resolvable on screen.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>
#include <space_planet>

uniform sampler2D uRingMap;
uniform float uInner;        // equatorial radii
uniform float uOuter;
uniform float uOpacity;
uniform float uBrightness;
uniform vec3 uColor;         // multiplies the texture colour
uniform vec3 uSunDirObj;     // towards the Sun, object space (unit)
uniform vec3 uCamLocal;      // camera, object space
uniform float uFlattening;   // polar / equatorial radius

varying vec3 vLocal;

void main() {
  #include <logdepthbuf_fragment>

  float r = length(vLocal.xz);
  float u = (r - uInner) / (uOuter - uInner);
  if (u < 0.0 || u > 1.0) discard;

  vec4 tex = texture2D(uRingMap, vec2(u, 0.5));
  float alpha = tex.a * uOpacity;

  // Ringlets: only where a fine radial structure would be at least ~2 px.
  float fw = fwidth(r);
  float ringletAA = 1.0 - smoothstep(0.0004, 0.002, fw);
  float ringlets = snoise(vec3(r * 900.0, 0.0, 0.0)) * 0.6 + snoise(vec3(r * 2600.0, 3.0, 0.0)) * 0.4;
  alpha *= 1.0 + 0.22 * ringlets * ringletAA;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha < 0.003) discard;

  // ---- Planet shadow -------------------------------------------------------------
  vec3 ps = vec3(vLocal.x, vLocal.y / uFlattening, vLocal.z);
  vec3 ds = normalize(vec3(uSunDirObj.x, uSunDirObj.y / uFlattening, uSunDirObj.z));
  float b = dot(ps, ds);
  float shadow = 1.0;
  if (b < 0.0) {
    float closest = length(ps - ds * b);
    shadow = smoothstep(0.985, 1.02, closest);
  }

  // ---- Which face are we looking at? ------------------------------------------------
  float sunSide = sign(uSunDirObj.y);
  float camSide = sign(uCamLocal.y);
  float mu0 = abs(uSunDirObj.y);
  vec3 V = normalize(uCamLocal - vLocal);
  float towardsSun = max(dot(-V, uSunDirObj), 0.0);

  vec3 base = tex.rgb * uColor;
  vec3 lit;
  if (sunSide == camSide) {
    // Reflection. Rings stay fairly bright even at low sun elevation
    // (multiple scattering between particles).
    lit = base * (0.3 + 0.7 * sqrt(mu0));
  } else {
    // Diffuse transmission: strongest at intermediate optical depth.
    float trans = 4.0 * alpha * (1.0 - alpha);
    lit = base * trans * (0.35 + 1.4 * pow(max(towardsSun, 0.0), 6.0)) * (0.3 + 0.7 * sqrt(mu0));
  }

  vec3 col = lit * uSunColor * uSunIntensity * uBrightness * shadow + base * uAmbient;
  gl_FragColor = vec4(col * alpha, alpha);
}
