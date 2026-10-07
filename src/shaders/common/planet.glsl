// ---------------------------------------------------------------------------
// Shared planet helpers  (registered as ShaderChunk "space_planet")
//
// Conventions:
//  - "object space" = the planet's rotating, unflattened unit sphere
//    (+Y = north pole, +X = prime meridian, east = increasing u).
//  - World/render space is camera-relative thanks to the floating origin.
// ---------------------------------------------------------------------------

#ifndef SPACE_PLANET_GLSL
#define SPACE_PLANET_GLSL

// Sunlight shared by every body (one set of uniforms, updated once a frame).
uniform vec3 uSunPosW;       // Sun centre, render space
uniform vec3 uSunColor;      // linear RGB
uniform float uSunIntensity; // scalar multiplier
uniform float uAmbient;      // faint starlight so night sides keep a silhouette

// A second star added in the playground (uStarLum = 0: none). Its light
// falls off with distance (inverse square, in scene units scaled so that
// uStarRef is "1 AU"), capped so a body right next to it is not blown out.
uniform vec3 uStarPosW;
uniform vec3 uStarColor;
uniform float uStarLum;
uniform float uStarRef;
uniform float uStarGain;   // the Sun's base intensity (kept when the Sun is gone)

// Playground damage: 0 = intact, 1 = molten. The surface darkens and its
// darker regions (seas, cracks, lowlands) glow like lava.
uniform float uHeat;

vec3 applyHeat(vec3 col, vec3 albedo) {
  if (uHeat <= 0.0) return col;
  float l = dot(albedo, vec3(0.3, 0.59, 0.11));
  float lava = 0.2 + 1.3 * (1.0 - smoothstep(0.02, 0.5, l));
  vec3 glow = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.55, 0.15), uHeat) * lava * uHeat * uHeat * 2.4;
  return col * (1.0 - 0.6 * uHeat) + glow;
}

vec3 starLight(vec3 P, vec3 N) {
  if (uStarLum <= 0.0) return vec3(0.0);
  vec3 d = uStarPosW - P;
  float r2 = max(dot(d, d), 1e-12);
  float flux = min(uStarLum * uStarRef * uStarRef / r2, 6.0);
  return uStarColor * uStarGain * flux * max(dot(N, normalize(d)), 0.0);
}

// Tangent frame on the unit sphere. Returns east (T) and north (B) for the
// object-space unit normal n; degenerate exactly at the poles, so nudge.
void sphereTangents(vec3 n, out vec3 T, out vec3 B) {
  vec3 t = vec3(n.z, 0.0, -n.x);
  float l = length(t);
  T = l > 1e-5 ? t / l : vec3(1.0, 0.0, 0.0);
  B = cross(n, T);
}

// Tangent-space normal (x = east, y = north, z = up) from a height field
// sampled in uv. The gradient uses fixed texel offsets, which is stable at
// any distance (no screen-space derivative noise). n = object-space normal.
vec3 bumpTangentNormal(sampler2D tex, vec2 uv, vec3 n, float strength) {
  vec2 texel = 1.0 / vec2(textureSize(tex, 0));
  float hL = dot(texture2D(tex, uv - vec2(texel.x, 0.0)).rgb, vec3(0.333));
  float hR = dot(texture2D(tex, uv + vec2(texel.x, 0.0)).rgb, vec3(0.333));
  float hD = dot(texture2D(tex, uv - vec2(0.0, texel.y)).rgb, vec3(0.333));
  float hU = dot(texture2D(tex, uv + vec2(0.0, texel.y)).rgb, vec3(0.333));
  // A longitude texel is narrower towards the poles: steeper gradient there.
  float cosLat = max(length(n.xz), 0.05);
  float du = (hR - hL) / cosLat;
  float dv = (hU - hD);
  // Height texels are ~1/2048 of the circumference; scale to unit-ish slopes.
  return normalize(vec3(-strength * du, -strength * dv, 1.0));
}

// Tangent-space normal → render space, given the interpolated geometric
// normal and east tangent (both render space).
vec3 applyTangentNormal(vec3 Ng, vec3 Tw, vec3 nTs) {
  vec3 T = normalize(Tw - Ng * dot(Tw, Ng));
  vec3 B = cross(Ng, T);
  return normalize(T * nTs.x + B * nTs.y + Ng * nTs.z);
}

// Smooth day/night transition. `w` widens the twilight band (radians-ish).
float softTerminator(float NdotL, float w) {
  return smoothstep(-w, w * 2.0, NdotL);
}

// Lommel–Seeliger (airless regolith) blended with Lambert. Airless bodies
// look flat-lit with little limb darkening; mix = 0 → pure Lambert.
float regolith(float NdotL, float NdotV, float mixLS) {
  float lambert = max(NdotL, 0.0);
  float mu0 = max(NdotL, 0.0);
  float mu = max(NdotV, 1e-3);
  float ls = 2.0 * mu0 / (mu0 + mu);
  return mix(lambert, ls * 0.5, mixLS);
}

// ---- Eclipses -------------------------------------------------------------------
// Up to four spheres (moons on a planet, the planet on a moon) can block the
// Sun. Sizes and positions are the scene's, but the Sun's angular radius is
// the *real* one at that distance, so shadows are as crisp as in reality
// (cinematic scaling would otherwise blur them into faint smudges).
#define MAX_OCCLUDERS 4
uniform vec4 uOccluders[MAX_OCCLUDERS]; // xyz render-space centre, w radius
uniform int uOccluderCount;
uniform float uSunAngRadius;            // radians

float eclipse(vec3 P) {
  vec3 L = normalize(uSunPosW - P);
  float vis = 1.0;
  for (int i = 0; i < MAX_OCCLUDERS; i++) {
    if (i >= uOccluderCount) break;
    vec3 toOcc = uOccluders[i].xyz - P;
    if (dot(toOcc, L) <= 0.0) continue;          // occluder is behind us
    float dist = length(toOcc);
    float occ = asin(min(uOccluders[i].w / dist, 1.0));
    float sep = acos(clamp(dot(toOcc / dist, L), -1.0, 1.0));
    float rs = max(uSunAngRadius, 1e-5);
    // Fraction of the solar disk covered, with a smooth penumbra.
    float overlap = 1.0 - smoothstep(abs(occ - rs), occ + rs, sep);
    float maxCover = min(1.0, (occ * occ) / (rs * rs));
    vis *= 1.0 - overlap * maxCover;
  }
  return vis;
}

// Ray / sphere (centred at origin). Returns (tNear, tFar); tNear > tFar = miss.
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

#endif
