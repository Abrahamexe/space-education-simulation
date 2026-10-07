// Sun photosphere — fragment stage.
//
// Layers, from small to large scale:
//  1. Granulation: animated Worley cells. Bright, hot cell centres with dark,
//     cooler intergranular lanes; a domain warp makes the walls turbulent.
//  1b. Convective plasma: a coarser, domain-warped ridged layer that keeps
//     the disc boiling from distances where granules are sub-pixel, and
//     fades out as the real granulation resolves.
//  2. Supergranulation: a slow, low-frequency brightness modulation.
//  3. Sunspots: 4D noise (3D position + evolution time) restricted to the
//     active-latitude belts, with umbra/penumbra and penumbral filaments.
//     Spots follow differential rotation (Snodgrass) relative to the mesh.
//  4. Faculae: bright plage around active regions, strongest near the limb.
//  4b. Flares: up to MAX_FLARES kernels that brighten and decay (CPU-driven).
//  5. Limb darkening: per-channel power law I(mu) = mu^alpha, which also
//     reddens the limb as on real white-light photographs.
// The output is linear HDR (values well above 1.0 feed the bloom pass).

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>

uniform float uTime;          // real seconds (visual motion)
uniform float uBrightness;    // HDR multiplier
uniform vec3 uColorCore;      // mean photosphere colour
uniform vec3 uColorHot;       // granule centres
uniform vec3 uColorCool;      // limb tint
uniform vec3 uLimbExp;        // limb-darkening exponents per channel

uniform float uGranScale;
uniform float uGranSpeed;
uniform float uGranContrast;
uniform float uGranFine;
uniform float uGranWarp;

uniform float uSuperScale;
uniform float uSuperStrength;

uniform float uSpotScale;
uniform float uSpotThreshold;
uniform float uSpotPenumbra;
uniform float uUmbraDark;
uniform float uPenumbraDark;
uniform vec2 uSpotTime;       // evolution coordinate of sample A and B
uniform vec2 uSpotDays;       // wrapped day counts of sample A and B
uniform float uSpotMix;       // weight of sample A (crossfade hides wraps)
uniform vec3 uDiffRot;        // Snodgrass A, B, C in deg/day
uniform vec2 uActiveBand;     // active latitude band (radians)

uniform float uFaculae;
uniform float uPlageDisc;

uniform float uPlasmaScale;
uniform float uPlasmaSpeed;
uniform float uPlasmaStrength;

#define MAX_FLARES 2
uniform vec4 uFlares[MAX_FLARES];  // xyz: direction in the rotating frame, w: 0..1 envelope
uniform float uFlareSize;          // angular radius (radians)
uniform float uFlareIntensity;
uniform vec3 uFlareColor;

varying vec3 vObjPos;
varying vec3 vNormalV;
varying vec3 vViewPos;

const float DEG2RAD = 0.017453292519943295;

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// One granulation octave. Returns brightness in ~[0, 1].
float granulation(vec3 p, float t, float footprint) {
  vec2 w = worley(p, t);
  // Narrow dark intergranular lanes where F2 ~ F1 (cool, sinking gas).
  float lane = smoothstep(0.02, 0.34, w.y - w.x);
  // Rounded dome: hot upflow brightest at the cell centre.
  float dome = pow(1.0 - clamp(w.x, 0.0, 1.0), 1.6);
  float g = lane * (0.22 + 0.78 * dome);
  // Anti-aliasing: once cells shrink below ~2 px, fade to their mean value.
  float aa = 1.0 - smoothstep(0.35, 0.9, footprint);
  return mix(0.5, g, aa);
}

// Raw active-region field for one evolution sample.
float spotSample(vec3 p, float lat, float days, float phase) {
  float s2 = sin(lat);
  s2 *= s2;
  // Angular velocity relative to the rigidly rotating mesh (rad/day).
  float dOmega = (uDiffRot.y * s2 + uDiffRot.z * s2 * s2) * DEG2RAD;
  vec3 q = rotateY(p, -dOmega * days);
  // Two octaves: compact, rounded active regions with ragged edges.
  return fbm4(vec4(q * uSpotScale, phase), 2);
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 p = normalize(vObjPos);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float absLat = abs(lat);

  vec3 N = normalize(vNormalV);
  vec3 V = normalize(-vViewPos);
  float mu = clamp(dot(N, V), 0.0, 1.0);

  // ---- 1. Granulation ------------------------------------------------------
  float t = uTime * uGranSpeed;
  vec3 gp = p * uGranScale;
  // Pixel footprint of one cell, measured before warping (derivatives must be
  // taken in uniform control flow). Warping stretches cells only slightly.
  float footprint = length(fwidth(gp)) * 1.1;
  float gran = 0.5;
  // Sub-pixel cells average out to their mean: skip all of the work.
  if (footprint < 0.9) {
    vec3 warpP = p * uGranScale * 0.16;
    vec3 warp = vec3(
      snoise(warpP + vec3(0.0, 0.0, t * 0.6)),
      snoise(warpP + vec3(13.7, 0.0, t * 0.6)),
      snoise(warpP + vec3(0.0, 29.1, t * 0.6))
    );
    gp += warp * uGranWarp * 3.0;
    // Second, finer warp: irregular, organic cell walls instead of straight
    // Voronoi edges.
    vec3 fineWarpP = gp * 0.55;
    vec3 fineWarp = vec3(
      snoise(fineWarpP + vec3(t * 0.9, 0.0, 0.0)),
      snoise(fineWarpP + vec3(5.2, t * 0.9, 0.0)),
      snoise(fineWarpP + vec3(0.0, 9.7, t * 0.9))
    );
    gp += fineWarp * uGranWarp * 0.9;

    float g1 = granulation(gp, t * 6.2831853, footprint);
    // Fine mottling inside granules (not a second cell web, which reads as cracks).
    float fineAa = 1.0 - smoothstep(0.2, 0.6, footprint * 3.1);
    float fine = fineAa > 0.0 ? snoise(gp * 3.1 + vec3(0.0, t * 2.0, 0.0)) * fineAa : 0.0;
    gran = g1 * (1.0 + uGranFine * 0.3 * fine);
  }

  // ---- 1b. Convective plasma -----------------------------------------------
  // Footprint of one plasma cell; visible once granules average out
  // (footprint > ~0.4) and while its own cells are still resolved.
  float plasmaFoot = footprint * uPlasmaScale / uGranScale;
  float plasmaVis = smoothstep(0.35, 0.9, footprint) * (1.0 - smoothstep(0.45, 1.0, plasmaFoot));
  float plasma = 0.0;
  if (plasmaVis > 0.0) {
    float pt = uTime * uPlasmaSpeed;
    vec3 pp = p * uPlasmaScale;
    vec3 pw = pp * 0.45;
    vec3 warp = vec3(
      snoise(pw + vec3(0.0, 0.0, pt)),
      snoise(pw + vec3(7.1, 0.0, pt)),
      snoise(pw + vec3(0.0, 3.3, pt))
    );
    float n = fbm3(pp + warp * 1.1 + vec3(0.0, pt * 0.8, 0.0), 3);
    // Ridged: thin bright walls of rising gas between darker cells.
    float ridge = 1.0 - abs(n);
    plasma = (ridge * ridge - 0.42) * plasmaVis;
  }

  // ---- 2. Supergranulation -------------------------------------------------
  float sup = fbm3(p * uSuperScale + vec3(0.0, uTime * 0.004, 0.0), 2);

  // ---- 3. Sunspots ---------------------------------------------------------
  float belt = smoothstep(uActiveBand.x, uActiveBand.x + 6.0 * DEG2RAD, absLat)
             * (1.0 - smoothstep(uActiveBand.y - 8.0 * DEG2RAD, uActiveBand.y, absLat));
  float spot = -1.0;
  if (belt > 0.0) {
    float a = spotSample(p, lat, uSpotDays.x, uSpotTime.x);
    float b = spotSample(p, lat, uSpotDays.y, uSpotTime.y);
    float w = uSpotMix;
    // Renormalise so the crossfade keeps the field's variance constant.
    spot = (a * w + b * (1.0 - w)) / sqrt(w * w + (1.0 - w) * (1.0 - w));
    spot = mix(-1.0, spot, belt);
  }
  float th = uSpotThreshold;
  float penumbra = smoothstep(th, th + uSpotPenumbra * 0.6, spot);
  float umbra = smoothstep(th + uSpotPenumbra * 0.9, th + uSpotPenumbra * 1.4, spot);
  // Penumbral filaments: fine streaks modulating the penumbra.
  float filaments = 0.0;
  if (penumbra > 0.0) {
    filaments = snoise(p * uSpotScale * 55.0);
  }

  // ---- 4. Faculae ----------------------------------------------------------
  float facula = smoothstep(th - 0.2, th - 0.03, spot) * (1.0 - penumbra);
  float limbWeight = pow(max(1.0 - mu, 0.0), 1.5);

  // ---- Compose intensity ---------------------------------------------------
  float intensity = 1.0 + uGranContrast * (gran - 0.5);
  intensity *= 1.0 + uSuperStrength * sup;
  intensity *= 1.0 + uPlasmaStrength * plasma;
  intensity *= 1.0 + uFaculae * facula * (uPlageDisc + limbWeight);

  float penDark = uPenumbraDark * (0.85 + 0.15 * filaments);
  intensity *= mix(1.0, 1.0 - penDark, penumbra);
  intensity *= mix(1.0, 1.0 - uUmbraDark, umbra);

  // Temperature tint: hot granule centres are whiter, lanes warmer.
  vec3 color = mix(uColorCore, uColorHot, clamp(gran, 0.0, 1.0) * 0.6);
  color = mix(color, uColorHot, clamp(plasma * 1.6, 0.0, 1.0) * 0.55);
  // Spots are cooler, hence redder.
  color = mix(color, vec3(1.0, 0.42, 0.16), penumbra * 0.65);

  // ---- 5. Limb darkening & reddening ---------------------------------------
  vec3 limb = pow(vec3(max(mu, 1e-3)), uLimbExp);
  color = mix(color, uColorCool, pow(max(1.0 - mu, 0.0), 3.0) * 0.55);

  vec3 rgb = color * intensity * limb * uBrightness;

  // ---- 4b. Flares (added light: a flare outshines the photosphere) ----------
  for (int i = 0; i < MAX_FLARES; i++) {
    vec4 f = uFlares[i];
    if (f.w <= 0.0) continue;
    float ang = acos(clamp(dot(p, f.xyz), -1.0, 1.0));
    if (ang > uFlareSize * 3.0) continue;
    float core = exp(-(ang * ang) / (uFlareSize * uFlareSize));
    // Broken, ribbon-like kernel rather than a smooth blob.
    float rib = 0.55 + 0.45 * snoise(p * 160.0 + float(i) * 13.1 + vec3(0.0, uTime * 0.4, 0.0));
    rgb += uFlareColor * core * rib * f.w * uFlareIntensity;
  }

  gl_FragColor = vec4(rgb, 1.0);
}
