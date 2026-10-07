// Gas and ice giants, and Venus' cloud deck (PLAN §5.4).
//
//  - Zonal flow: each latitude scrolls at its own speed (a smooth wind-proxy
//    profile, deg/day). Two time samples, offset by half a period and
//    crossfaded, keep the shear bounded so bands never smear into noise; a
//    "calm" latitude keeps the Great Red Spot coherent while it drifts.
//  - Turbulence: a small animated domain warp sampled on the 3D sphere
//    (seam-free) gives eddies along the band edges.
//  - Ice giants: faint procedural banding; Neptune adds bright methane storm
//    clouds that ride the same flow.
//  - Lighting: soft terminator plus limb darkening.
//  - RING_SHADOW: rays toward the Sun are intersected with the ring plane and
//    the ring opacity at that radius dims the surface (Saturn).

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>
#include <space_planet>

uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uTime;
uniform vec4 uFlowAmp;       // deg/day
uniform vec4 uFlowFreq;      // per radian of latitude
uniform vec4 uFlowPhase;
uniform vec2 uFlowCalm;      // (latitude, half-width) in radians; width 0 = none
uniform vec2 uFlowDays;      // wrapped flow time of sample A and B (days)
uniform float uFlowMix;      // weight of sample A
uniform float uTurbulence;
uniform float uLimbDark;
uniform float uBands;
uniform float uStorms;
uniform vec3 uSunDirObj;

#ifdef RING_SHADOW
uniform sampler2D uRingMap;
uniform float uRingInner;    // equatorial radii
uniform float uRingOuter;
uniform float uRingOpacity;
#endif

varying vec2 vUv;
varying vec3 vObjPos;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vTangentW;

const float DEG2RAD = 0.017453292519943295;

float zonalSpeed(float lat) {
  float v = dot(uFlowAmp, cos(uFlowFreq * lat + uFlowPhase));
  if (uFlowCalm.y > 0.0) {
    float x = (lat - uFlowCalm.x) / uFlowCalm.y;
    v *= 1.0 - exp(-x * x);
  }
  return v * cos(lat);
}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Neptune-style bright storm clouds at their latitude, advected by the flow.
float storms(vec3 p, float shiftRad) {
  vec3 q = rotateY(p, shiftRad);
  float n = fbm3(q * vec3(5.0, 14.0, 5.0) + vec3(0.0, 0.0, uTime * 0.01), 3);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float belts = exp(-pow((lat + 0.42) / 0.07, 2.0)) + 0.7 * exp(-pow((lat - 0.5) / 0.06, 2.0))
              + 0.5 * exp(-pow((lat + 1.05) / 0.05, 2.0));
  return smoothstep(0.32, 0.62, n) * belts;
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 p = normalize(vObjPos);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float v = zonalSpeed(lat);

  // Seam-free turbulence on the sphere.
  vec3 tq = p * 9.0 + vec3(0.0, 0.0, uTime * 0.015);
  vec2 warp = vec2(snoise(tq), snoise(tq + 31.7)) * uTurbulence;
  warp.y *= 0.35; // eddies are stretched along the bands

  vec2 uvA = vUv + warp + vec2(v * uFlowDays.x / 360.0, 0.0);
  vec2 uvB = vUv + warp + vec2(v * uFlowDays.y / 360.0, 0.0);
  vec3 albedo = mix(texture2D(uMap, uvB).rgb, texture2D(uMap, uvA).rgb, uFlowMix) * uTint;

  if (uBands > 0.0) {
    float band = sin(lat * 22.0 + snoise(p * 3.0) * 0.6) * 0.6 + sin(lat * 47.0) * 0.4;
    albedo *= 1.0 + uBands * band;
  }
  if (uStorms > 0.0) {
    float sA = storms(p, v * uFlowDays.x * DEG2RAD);
    float sB = storms(p, v * uFlowDays.y * DEG2RAD);
    float s = mix(sB, sA, uFlowMix);
    albedo = mix(albedo, vec3(0.92, 0.96, 1.0), s * uStorms);
  }

  vec3 L = normalize(uSunPosW - vPosW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 N = normalize(vNormalW);
  float NdotL = dot(N, L);
  float NdotV = max(dot(N, V), 0.0);

  float light = max(NdotL, 0.0) * softTerminator(NdotL, 0.05);
  light *= pow(max(NdotV, 0.02), uLimbDark) * pow(max(NdotL, 0.02), uLimbDark * 0.5);

  float shadow = 1.0;
#ifdef RING_SHADOW
  if (abs(uSunDirObj.y) > 1e-4) {
    float t = -p.y / uSunDirObj.y;
    if (t > 0.0) {
      float r = length(p.xz + uSunDirObj.xz * t);
      float u = (r - uRingInner) / (uRingOuter - uRingInner);
      if (u > 0.0 && u < 1.0) {
        float a = texture2D(uRingMap, vec2(u, 0.5)).a;
        shadow = 1.0 - a * uRingOpacity * 0.92;
      }
    }
  }
#endif

  shadow *= eclipse(vPosW);
  vec3 col = albedo * (uSunColor * uSunIntensity * light * shadow + uAmbient + starLight(vPosW, N));
  col = applyHeat(col, albedo);
  gl_FragColor = vec4(col, 1.0);
}
