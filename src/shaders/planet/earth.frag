// Earth surface (PLAN §5.2 — the reference quality bar).
//
//  - Day albedo with a soft terminator.
//  - City lights only on the night side, dimmed under clouds, warm sodium
//    tint, HDR so the densest metros bloom slightly.
//  - Ocean: sun glint (Blinn–Phong + Fresnel) masked to water; land gets the
//    tangent-space normal map, oceans stay smooth.
//  - Cloud shadows: the cloud map is sampled where the sun ray through this
//    point crosses the cloud shell, using the same drift offset as the
//    cloud layer, so shadows line up with the clouds above.
// The atmosphere shell, drawn afterwards, adds Rayleigh haze, blue limb and
// sunset reddening on top of this.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_planet>

uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform sampler2D uNormalMap;
uniform sampler2D uSpecular;     // white = ocean
uniform float uNormalStrength;
uniform float uCloudOffset;      // cloud drift, u units (wrapped)
uniform float uCloudAltitude;    // shell height in planet radii
uniform float uCloudShadow;
uniform float uNightIntensity;
uniform vec3 uNightTint;
uniform float uSpecIntensity;
uniform float uSpecPower;
uniform vec3 uSunDirObj;         // sun direction in object space (set per frame)

varying vec2 vUv;
varying vec3 vObjPos;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vTangentW;

void main() {
  #include <logdepthbuf_fragment>

  vec3 L = normalize(uSunPosW - vPosW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 Ng = normalize(vNormalW);

  float ocean = texture2D(uSpecular, vUv).r;
  vec3 day = texture2D(uDay, vUv).rgb;
  vec3 nightLights = texture2D(uNight, vUv).rgb;

  // Relief on land only.
  vec3 nTs = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
  nTs.xy *= uNormalStrength * (1.0 - ocean);
  vec3 N = applyTangentNormal(Ng, vTangentW, normalize(nTs));

  float NgL = dot(Ng, L);
  float dayMask = softTerminator(NgL, 0.06);
  float diffuse = max(dot(N, L), 0.0) * dayMask;

  // ---- Cloud shadows ----------------------------------------------------------
  // Offset along the sun direction projected on the local tangent plane.
  vec3 n = normalize(vObjPos);
  vec3 T;
  vec3 B;
  sphereTangents(n, T, B);
  vec3 Lobj = uSunDirObj;
  float cosLat = max(length(n.xz), 0.05);
  vec2 shadowShift = vec2(dot(Lobj, T) / (6.2831853 * cosLat), dot(Lobj, B) / 3.14159265)
                   * uCloudAltitude / max(dot(Lobj, n), 0.15);
  float cloudAbove = texture2D(uClouds, vUv + vec2(uCloudOffset, 0.0)).r;
  float cloudShadow = texture2D(uClouds, vUv + vec2(uCloudOffset, 0.0) + shadowShift).r;
  float shadow = (1.0 - uCloudShadow * smoothstep(0.1, 0.8, cloudShadow)) * eclipse(vPosW);

  vec3 col = day * uSunColor * uSunIntensity * diffuse * shadow;

  // ---- Ocean glint ------------------------------------------------------------
  vec3 H = normalize(L + V);
  float NdotH = max(dot(Ng, H), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  float glint = pow(max(NdotH, 0.0), uSpecPower) * (0.4 + fresnel) + pow(max(NdotH, 0.0), uSpecPower * 0.08) * 0.04;
  col += uSunColor * uSunIntensity * glint * uSpecIntensity * ocean * dayMask * shadow;

  // ---- City lights ----------------------------------------------------------------
  float nightMask = 1.0 - smoothstep(-0.18, 0.02, NgL);
  float lum = dot(nightLights, vec3(0.2126, 0.7152, 0.0722));
  vec3 lights = uNightTint * pow(max(lum, 0.0), 1.4) * uNightIntensity;
  col += lights * nightMask * (1.0 - 0.75 * smoothstep(0.2, 0.7, cloudAbove));

  col += day * (uAmbient + starLight(vPosW, Ng));
  col = applyHeat(col, day);
  gl_FragColor = vec4(col, 1.0);
}
