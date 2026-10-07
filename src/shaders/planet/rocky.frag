// Rocky, airless or thin-atmosphere bodies (Mercury, Mars; moons in Phase 3).
//
// - Albedo map in sRGB (decoded to linear by the sampler).
// - Relief: normals derived from the albedo's luminance gradient. Dark maria
//   and crater floors read as lower ground, which suits cratered worlds.
// - Lighting: Lambert blended with Lommel–Seeliger, so airless bodies get the
//   characteristic flat, evenly bright disk; a narrow twilight band.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_planet>

uniform sampler2D uMap;
uniform float uBumpStrength;
uniform float uLommel;
uniform vec3 uTint;

varying vec2 vUv;
varying vec3 vObjPos;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vTangentW;

void main() {
  #include <logdepthbuf_fragment>

  vec3 albedo = texture2D(uMap, vUv).rgb * uTint;

  vec3 L = normalize(uSunPosW - vPosW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 Ng = normalize(vNormalW);

  // Relief fades out once a texel is smaller than a couple of pixels, where
  // it could only alias.
  float texelsPerPx = length(fwidth(vUv * vec2(textureSize(uMap, 0))));
  float reliefFade = 1.0 - smoothstep(1.5, 4.0, texelsPerPx);
  vec3 nTs = bumpTangentNormal(uMap, vUv, normalize(vObjPos), uBumpStrength * reliefFade);
  vec3 N = applyTangentNormal(Ng, vTangentW, nTs);

  float day = softTerminator(dot(Ng, L), 0.03);
  float light = regolith(dot(N, L), dot(N, V), uLommel) * day * eclipse(vPosW);

  vec3 col = albedo * (uSunColor * uSunIntensity * light + uAmbient + starLight(vPosW, N));
  col = applyHeat(col, albedo);
  gl_FragColor = vec4(col, 1.0);
}
