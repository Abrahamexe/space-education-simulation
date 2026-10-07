// ---------------------------------------------------------------------------
// GPU Kepler propagation + the scale system's distance/size curves
// (registered as ShaderChunk "space_kepler"). Mirrors physics/orbits.ts and
// core/scale.ts so instanced bodies land exactly where CPU bodies would.
// ---------------------------------------------------------------------------

#ifndef SPACE_KEPLER_GLSL
#define SPACE_KEPLER_GLSL

uniform float uDays;            // days since J2000 (sim time)
uniform mat3 uEclToScene;
uniform float uUnitsPerAu;      // cinematic distance curve
uniform float uDistExp;
uniform float uRefRadiusUnits;  // cinematic size curve (Earth radius → units)
uniform float uRadiusExp;
uniform float uKmPerUnit;       // real scale
uniform float uScaleBlend;      // 0 cinematic … 1 real

const float KM_PER_AU = 149597870.7;
const float REF_RADIUS_KM = 6371.0;

float logLerp(float a, float b, float t) {
  return exp(mix(log(a), log(b), t));
}

float sceneDistance(float km) {
  float cin = uUnitsPerAu * pow(km / KM_PER_AU, uDistExp);
  return logLerp(cin, km / uKmPerUnit, uScaleBlend);
}

float sceneRadius(float km) {
  float cin = uRefRadiusUnits * pow(km / REF_RADIUS_KM, uRadiusExp);
  return logLerp(cin, km / uKmPerUnit, uScaleBlend);
}

// o1 = (a [AU], e, i, node), o2 = (argument of perihelion, M0, n [rad/day], -)
// Returns the heliocentric ecliptic position in AU.
vec3 keplerEcliptic(vec4 o1, vec4 o2) {
  float a = o1.x;
  float e = o1.y;
  float M = mod(o2.y + o2.z * uDays, 6.2831853);
  float E = M + e * sin(M);
  for (int k = 0; k < 5; k++) {
    E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  }
  float xp = a * (cos(E) - e);
  float yp = a * sqrt(max(1.0 - e * e, 0.0)) * sin(E);
  float cw = cos(o2.x), sw = sin(o2.x);
  float cO = cos(o1.w), sO = sin(o1.w);
  float cI = cos(o1.z), sI = sin(o1.z);
  return vec3(
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp
  );
}

// Absolute scene position (before the floating-origin offset in modelMatrix).
vec3 keplerScene(vec4 o1, vec4 o2) {
  vec3 ecl = keplerEcliptic(o1, o2);
  float rAu = length(ecl);
  vec3 dir = uEclToScene * (ecl / max(rAu, 1e-9));
  return dir * sceneDistance(rAu * KM_PER_AU);
}

#endif
