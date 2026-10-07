// Procedural moons and dwarf planets (bodies without a licensed global map).
//
// Everything is generated on the unit sphere in object space (seam-free):
//  - regions: low-frequency fbm blends colour A and B;
//  - craters: three octaves of a cellular crater field. Each crater has a
//    parabolic bowl, a raised rim and an analytic slope, so relief costs no
//    extra noise evaluations; fresh small craters get bright rims;
//  - a style switch adds each world's signature feature (documented per case).
// Object space convention for synchronous moons: +X faces the parent planet
// (longitude 0), +Z is the leading hemisphere (90° W), +Y the north pole.
// Lighting matches rocky.frag: Lambert / Lommel–Seeliger, soft terminator,
// eclipses.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>
#include <space_planet>

#define STYLE_CRATERED 0
#define STYLE_IO 1
#define STYLE_EUROPA 2
#define STYLE_GANYMEDE 3
#define STYLE_TITAN 4
#define STYLE_ENCELADUS 5
#define STYLE_IAPETUS 6
#define STYLE_TRITON 7
#define STYLE_MIRANDA 8
#define STYLE_PLUTO 9

uniform int uStyle;
uniform vec3 uColorA;          // dominant surface
uniform vec3 uColorB;          // secondary regions
uniform vec3 uColorC;          // accent (spots, lineae, poles)
uniform float uRegionScale;
uniform float uRegionContrast;
uniform float uCraterDensity;  // 0..1 share of cells holding a crater
uniform float uCraterScale;    // cells per radius (largest octave)
uniform float uRelief;
uniform float uRimBrightness;
uniform float uLineae;         // crack network strength
uniform vec4 uSpot;            // lat, lon (rad), angular radius (rad), strength
uniform vec4 uBigCrater;       // lat, lon (rad), angular radius (rad), depth
uniform float uSeed;
uniform float uLommel;

varying vec2 vUv;
varying vec3 vObjPos;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vTangentW;

vec3 latLonToVec(float lat, float lon) {
  // East longitude increases towards -Z (matches the sphere's u direction).
  float c = cos(lat);
  return vec3(c * cos(lon), sin(lat), -c * sin(lon));
}

// One crater octave. Accumulates height (radius units), object-space slope
// and an albedo modifier.
void craterOctave(vec3 p, vec3 n, float scale, float density, float seed, float aa,
                  inout float h, inout vec3 slope, inout float alb) {
  if (aa <= 0.0) return;
  vec3 q = p * scale;
  vec3 id = floor(q);
  vec3 f = fract(q);
  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 g = vec3(float(i), float(j), float(k));
        vec3 rnd = hash33(id + g + seed);
        if (rnd.z > density) continue;
        vec3 c = g + 0.2 + 0.6 * hash33(id + g + seed + 17.31);
        float R = mix(0.22, 0.5, rnd.x * rnd.x);
        vec3 d = f - c;
        d -= n * dot(d, n);                     // keep the crater on the surface
        float dl = length(d);
        float r = dl / R;
        if (r > 1.7) continue;
        float rim = exp(-pow((r - 1.0) / 0.2, 2.0));
        float bowl = r < 1.0 ? r * r - 1.0 : 0.0;
        float depth = 0.35 * aa;
        h += (bowl * 0.7 + rim * 0.3) * depth * (R / scale);
        float dpdr = (r < 1.0 ? 1.4 * r : 0.0) + rim * 0.3 * (-2.0 * (r - 1.0) / 0.04);
        slope += (d / max(dl, 1e-5)) * dpdr * depth;
        // Fresh craters: bright rims and floors on some, darker floors on others.
        float fresh = step(0.7, rnd.y);
        alb += aa * (rim * uRimBrightness * (0.4 + fresh) + (r < 1.0 ? (fresh * 0.12 - 0.05) : 0.0));
      }
    }
  }
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 p = normalize(vObjPos);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  vec3 seedV = vec3(uSeed * 13.7, uSeed * 7.1, uSeed * 3.3);

  // ---- Regions ----------------------------------------------------------------
  float region = fbm3(p * uRegionScale + seedV, 5);
  vec3 albedo = mix(uColorA, uColorB, smoothstep(-uRegionContrast - 1e-4, uRegionContrast + 1e-4, region));
  // Small-scale mottling everywhere.
  albedo *= 0.9 + 0.2 * fbm3(p * uRegionScale * 9.0 + seedV, 3);

  // ---- Craters ----------------------------------------------------------------
  float h = 0.0;
  vec3 slope = vec3(0.0);
  float alb = 0.0;
  float fp = length(fwidth(p)) * uCraterScale;
  float s1 = uCraterScale;
  craterOctave(p, p, s1, uCraterDensity, uSeed, 1.0 - smoothstep(0.15, 0.4, fp), h, slope, alb);
  craterOctave(p, p, s1 * 2.7, uCraterDensity * 0.9, uSeed + 3.1, 1.0 - smoothstep(0.15, 0.4, fp * 2.7), h, slope, alb);
  craterOctave(p, p, s1 * 7.3, uCraterDensity * 0.8, uSeed + 7.7, 1.0 - smoothstep(0.15, 0.4, fp * 7.3), h, slope, alb);

  // Signature basin (Herschel on Mimas, Stickney on Phobos).
  if (uBigCrater.z > 0.0) {
    vec3 c = latLonToVec(uBigCrater.x, uBigCrater.y);
    float ang = acos(clamp(dot(p, c), -1.0, 1.0));
    float r = ang / uBigCrater.z;
    if (r < 1.6) {
      vec3 d = c - p * dot(c, p);
      vec3 dir = -normalize(d + 1e-6);
      float rim = exp(-pow((r - 1.0) / 0.15, 2.0));
      float dpdr = (r < 1.0 ? 1.6 * r : 0.0) + rim * 0.4 * (-2.0 * (r - 1.0) / 0.0225);
      slope += dir * dpdr * uBigCrater.w;
      alb += rim * 0.15 - (r < 1.0 ? 0.06 : 0.0);
      // Central peak.
      alb += exp(-r * r / 0.01) * 0.1;
    }
  }

  // ---- Signature features --------------------------------------------------------
  if (uStyle == STYLE_IO) {
    // Sulphur plains: white SO2 frost, dark silicate lava flows, black
    // volcanic paterae (two size classes) ringed by red plume deposits.
    float frost = smoothstep(0.2, 0.55, fbm3(p * 3.0 + seedV + 7.0, 4));
    albedo = mix(albedo, vec3(0.7, 0.68, 0.58), frost * 0.45);
    float flows = smoothstep(0.42, 0.62, fbm3(p * 6.0 + seedV * 2.0, 4));
    albedo = mix(albedo, vec3(0.1, 0.07, 0.04), flows * 0.45);
    vec2 w1 = worley(p * 5.0 + seedV, 0.0);
    vec2 w2 = worley(p * 11.0 + seedV * 1.7, 0.0);
    float halo = (1.0 - smoothstep(0.08, 0.36, w1.x)) * smoothstep(0.35, 0.75, 0.5 + 0.5 * snoise(p * 9.0 + seedV));
    albedo = mix(albedo, uColorC, halo * 0.7);
    float caldera = max(1.0 - smoothstep(0.06, 0.1, w1.x), 1.0 - smoothstep(0.035, 0.065, w2.x));
    albedo = mix(albedo, vec3(0.03, 0.025, 0.02), caldera);
    // Pele's great red plume ring (~19° S, 255° W).
    vec3 pele = latLonToVec(radians(-19.0), radians(105.0));
    float pa = acos(clamp(dot(p, pele), -1.0, 1.0));
    float ring = exp(-pow((pa - 0.33 + 0.03 * snoise(p * 12.0)) / 0.045, 2.0));
    albedo = mix(albedo, uColorC * 1.1, ring * 0.8);
    // Redder, darker polar regions.
    albedo = mix(albedo, uColorC * 0.5, smoothstep(0.7, 0.95, abs(p.y)) * 0.55);
  } else if (uStyle == STYLE_EUROPA || uLineae > 0.0) {
    // Lineae: reddish-brown cracks as zero-crossings of several noise fields.
    float lines = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float nz = snoise(p * (2.5 + fi * 1.9) + seedV + fi * 11.0);
      float width = 0.028 / (1.0 + fi * 0.5);
      lines = max(lines, 1.0 - smoothstep(0.0, width, abs(nz)));
    }
    float strength = uStyle == STYLE_EUROPA ? 1.0 : uLineae;
    albedo = mix(albedo, uColorC, lines * strength * 0.9);
  }
  if (uStyle == STYLE_GANYMEDE) {
    // Bright grooved terrain cutting through dark, old cratered terrain.
    float bright = smoothstep(-0.05, 0.12, fbm3(p * 2.2 + seedV + 5.0, 4));
    float grooves = 0.5 + 0.5 * sin(dot(p, normalize(vec3(0.3, 1.0, 0.2))) * 160.0 + fbm3(p * 4.0, 3) * 14.0);
    albedo = mix(uColorA, uColorB * (0.85 + 0.25 * grooves), bright) * (0.9 + 0.2 * fbm3(p * 20.0, 2));
  } else if (uStyle == STYLE_ENCELADUS) {
    // Fresh ice; "tiger stripes" — four parallel fractures near the south pole.
    float south = smoothstep(-0.78, -0.92, p.y);
    vec3 axis = normalize(vec3(0.6, 0.0, 0.8));
    float stripes = 1.0 - smoothstep(0.0, 0.05, abs(fract(dot(p, axis) * 5.0 + 0.25) - 0.5) - 0.42);
    albedo = mix(albedo, uColorC, south * stripes * 0.8);
  } else if (uStyle == STYLE_IAPETUS) {
    // Dark leading hemisphere (Cassini Regio) against bright trailing ice.
    float lead = dot(p, vec3(0.0, 0.0, 1.0)) + 0.3 * fbm3(p * 3.0 + seedV, 4);
    float dark = smoothstep(-0.05, 0.12, lead) * (1.0 - smoothstep(0.55, 0.8, abs(p.y)));
    albedo = mix(albedo, uColorC, dark);
    // Equatorial ridge.
    h += exp(-pow(lat / 0.02, 2.0)) * 0.004;
  } else if (uStyle == STYLE_TRITON) {
    // "Cantaloupe" terrain in the north; bright southern cap with dark plume streaks.
    vec2 w = worley(p * 22.0 + seedV, 0.0);
    albedo *= 0.88 + 0.24 * smoothstep(0.0, 0.25, w.y - w.x);
    float cap = smoothstep(-0.1, -0.35, p.y + 0.12 * snoise(p * 4.0));
    float streaks = smoothstep(0.55, 0.75, snoise(vec3(p.x * 3.0, p.y * 40.0, p.z * 3.0) + seedV));
    albedo = mix(albedo, uColorB, cap);
    albedo = mix(albedo, uColorC, cap * streaks * 0.7);
  } else if (uStyle == STYLE_MIRANDA) {
    // Coronae: patches of concentric ridges on an old cratered crust.
    vec2 w = worley(p * 1.6 + seedV, 0.0);
    float corona = 1.0 - smoothstep(0.35, 0.55, w.x);
    float ridges = 0.5 + 0.5 * sin(w.x * 70.0);
    albedo = mix(albedo, mix(uColorB, uColorC, ridges), corona);
  } else if (uStyle == STYLE_PLUTO) {
    // Tombaugh Regio: the bright nitrogen-ice "heart" (Sputnik Planitia at
    // ~20° N 175° E, a fainter eastern lobe), dark red Cthulhu Macula along the
    // equator, greyish-red north polar region.
    vec3 sp = latLonToVec(radians(20.0), radians(175.0));
    vec3 east = latLonToVec(radians(5.0), radians(210.0));
    float heart = max(smoothstep(0.82, 0.9, dot(p, sp) + 0.03 * snoise(p * 8.0)),
                      0.8 * smoothstep(0.8, 0.9, dot(p, east) + 0.04 * snoise(p * 6.0)));
    vec3 cth = latLonToVec(radians(-10.0), radians(90.0));
    float cthulhu = smoothstep(0.35, 0.55, dot(p, cth) + 0.15 * fbm3(p * 3.0, 3)) * (1.0 - smoothstep(0.25, 0.45, abs(lat + 0.15)));
    albedo = mix(albedo, uColorC, cthulhu);
    albedo = mix(albedo, uColorB, heart);
    albedo = mix(albedo, uColorA * vec3(0.8, 0.7, 0.75), smoothstep(0.7, 0.95, p.y) * 0.6);
  }

  // Bright or dark spot (Ceres' Occator faculae, Haumea's red region,
  // Charon's Mordor Macula with a negative strength reading as colour C).
  if (uSpot.z > 0.0) {
    vec3 c = latLonToVec(uSpot.x, uSpot.y);
    float ang = acos(clamp(dot(p, c), -1.0, 1.0));
    float s = 1.0 - smoothstep(uSpot.z * 0.6, uSpot.z + 1e-5, ang + 0.02 * snoise(p * 20.0));
    albedo = mix(albedo, uColorC, s * abs(uSpot.w));
  }

  albedo = max(albedo * (1.0 + alb), vec3(0.0));

  // ---- Lighting -------------------------------------------------------------------
  vec3 L = normalize(uSunPosW - vPosW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 Ng = normalize(vNormalW);
  // Object-space slope → tangent-space normal via the analytic tangent frame.
  vec3 T;
  vec3 B;
  sphereTangents(p, T, B);
  vec3 nTs = normalize(vec3(-dot(slope, T) * uRelief, -dot(slope, B) * uRelief, 1.0));
  vec3 N = applyTangentNormal(Ng, vTangentW, nTs);

  float day = softTerminator(dot(Ng, L), 0.03);
  float light = regolith(dot(N, L), dot(N, V), uLommel) * day * eclipse(vPosW);
  vec3 col = albedo * (uSunColor * uSunIntensity * light + uAmbient + starLight(vPosW, N));
  col = applyHeat(col, albedo);
  gl_FragColor = vec4(col, 1.0);
}
