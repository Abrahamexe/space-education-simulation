// Milky Way sky sphere — fragment stage.
//
// The panorama is an equirectangular map in galactic coordinates (galactic
// centre in the middle, longitude increasing to the left). The scene uses
// ecliptic axes, so each view direction is rotated into the galactic frame
// before the lookup. This puts Sagittarius, Orion and the Magellanic Clouds
// where they really are relative to the planets' orbital plane.
//
// Two layers from the same panorama:
//  - sharp: full resolution, explicit LOD 0 (stars, dust-lane detail);
//  - glow:  a heavily mip-filtered copy, i.e. the diffuse light of the
//           unresolved disc. Boosting it brightens the band without blowing
//           up the individual stars.
// Explicit LODs also avoid the derivative seam at the u = 0/1 wrap.
// The bulge gets a warm tint (old, cool stars; the texture is too blue) and
// a faint procedural nebula adds colour depth along the plane (baked once
// into uNebulaMap by nebula-bake.frag, same uv mapping as the panorama).

#include <common>

uniform sampler2D uMap;
uniform sampler2D uGlowMap;
uniform sampler2D uNebulaMap;
uniform mat3 uSceneToGalactic;
uniform float uBrightness;      // sharp layer
uniform float uContrast;
uniform float uSaturation;
uniform float uGlow;            // diffuse layer strength
uniform float uGlowLod;
uniform float uGlowFloor;      // glow below this stays black (empty sky)
uniform vec3 uBulgeTint;
uniform float uNebula;

varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  vec3 g = uSceneToGalactic * dir;
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  vec2 uv = vec2(0.5 - l / (2.0 * PI), 0.5 - b / PI);

  vec3 sharp = textureLod(uMap, uv, 0.0).rgb;
  vec3 glow = textureLod(uGlowMap, uv, uGlowLod).rgb;

  // Deepen the blacks, keep stars crisp.
  vec3 c = pow(max(sharp, vec3(0.0)), vec3(uContrast)) * uBrightness;
  // Floor-subtracted: lifts the band, leaves empty sky dark.
  vec3 glowC = max(glow - vec3(uGlowFloor), vec3(0.0)) * uGlow;
  float glowL = dot(glowC, vec3(0.2126, 0.7152, 0.0722));
  // Unresolved starlight is closer to neutral-warm than the panorama's blue;
  // the bulge (old, cool stars) is distinctly golden.
  float bulge = exp(-(l * l) / 0.35 - (b * b) / 0.05);
  vec3 discTint = vec3(1.0, 0.95, 0.88);
  glowC = mix(glowC, glowL * discTint, 0.5);
  glowC = mix(glowC, glowL * uBulgeTint, bulge * 0.85);
  c = mix(c, dot(c, vec3(0.2126, 0.7152, 0.0722)) * uBulgeTint, bulge * 0.5);
  c += glowC;

  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(luma), c, uSaturation), vec3(0.0));

  // Procedural nebula colour, concentrated along the galactic plane.
  float band = exp(-b * b / 0.08);
  c += textureLod(uNebulaMap, uv, 0.0).rgb * uNebula * (0.35 + band);

  gl_FragColor = vec4(c, 1.0);
}
