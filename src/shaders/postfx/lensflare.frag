// Procedural lens flare (postprocessing Effect, linear HDR, before tone
// mapping). Models what a real multi-element lens does with a very bright
// point source:
//  - ghosts: reflections between lens elements, mirrored through the image
//    centre along the sun → centre axis; hexagonal from the iris blades and
//    with slight chromatic dispersion on their rims;
//  - halo: a faint, dispersed ring around the source;
//  - starburst: diffraction spikes from the aperture, slowly shimmering;
//  - anamorphic streak: a thin horizontal line (cinema-lens character).
// Everything scales with uVisibility, which the CPU computes from on-screen
// position and occlusion.

#include <space_noise>

uniform vec2 uSunPos;        // sun centre in uv space
uniform float uVisibility;   // 0..1
uniform float uIntensity;
uniform float uGhost;
uniform float uHalo;
uniform float uStreak;
uniform float uStarburst;
uniform float uFlareTime;

// Envelope cut-offs: the halo Gaussian (σ ≈ 0.012) is < 1e-6 beyond 0.045
// of its radius; the starburst falloff is < 1e-3 beyond ~1 screen height.
const float HALO_REACH = 0.045;
const float BURST_CUTOFF = 1e-3;

float hexDist(vec2 q) {
  q = abs(q);
  return max(q.x * 0.8660254 + q.y * 0.5, q.y);
}

// One ghost with chromatic rim: R, G, B use slightly different radii.
vec3 ghost(vec2 p, vec2 c, float r, vec3 tint, float rim) {
  vec2 q = p - c;
  float d = hexDist(q);
  vec3 radii = r * vec3(1.025, 1.0, 0.975);
  vec3 dn = d / radii;
  vec3 disk = 1.0 - smoothstep(0.82, 1.0, dn);
  vec3 ring = smoothstep(0.55, 0.97, dn) * disk;
  return tint * mix(disk * 0.6, ring, rim);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uVisibility <= 0.0001) {
    outputColor = inputColor;
    return;
  }

  vec2 asp = vec2(aspect, 1.0);
  vec2 p = (uv - 0.5) * asp;
  vec2 s = (uSunPos - 0.5) * asp;
  float sunDistFromCentre = length(s);

  vec3 col = vec3(0.0);

  // ---- Ghosts (mirrored through the image centre) ----------------------------
  vec3 gsum = vec3(0.0);
  gsum += ghost(p, s * -0.22, 0.030, vec3(0.55, 0.75, 1.00), 0.2);
  gsum += ghost(p, s * -0.48, 0.065, vec3(0.35, 0.95, 0.60), 0.7);
  gsum += ghost(p, s * -0.80, 0.022, vec3(1.00, 0.70, 0.35), 0.1);
  gsum += ghost(p, s * -1.05, 0.110, vec3(0.45, 0.55, 1.00), 0.85);
  gsum += ghost(p, s * -1.45, 0.045, vec3(1.00, 0.55, 0.30), 0.4);
  gsum += ghost(p, s * 0.42, 0.040, vec3(0.80, 0.60, 1.00), 0.6);
  gsum += ghost(p, s * 0.70, 0.016, vec3(1.00, 0.85, 0.60), 0.0);
  // Ghosts brighten as the source moves off-axis (more internal reflection).
  col += gsum * uGhost * 0.12 * (0.35 + smoothstep(0.0, 0.6, sunDistFromCentre));

  // The noise terms below are the expensive part; each is evaluated only
  // where its envelope is non-negligible (screen-coherent branches).

  // ---- Halo ring around the source --------------------------------------------
  vec2 q = p - s;
  float dq = length(q);
  vec3 haloR = vec3(0.405, 0.40, 0.395);
  if (abs(dq - haloR.y) < HALO_REACH) {
    vec3 halo = exp(-((vec3(dq) - haloR) / 0.012) * ((vec3(dq) - haloR) / 0.012));
    float haloArc = 0.55 + 0.45 * snoise(vec3(normalize(q + 1e-5) * 3.0, uFlareTime * 0.05));
    col += halo * vec3(0.9, 0.85, 1.0) * haloArc * uHalo * 0.25;
  }

  // ---- Starburst --------------------------------------------------------------
  float burstFall = exp(-dq * 7.0);
  if (burstFall > BURST_CUTOFF) {
    vec2 ac = q / max(dq, 1e-5); // (cos, sin) of the angle around the source
    float rays = snoise(vec3(ac * 9.0, uFlareTime * 0.08));
    rays = pow(clamp(0.5 + 0.5 * rays, 0.0, 1.0), 7.0);
    float fineRays = pow(clamp(0.5 + 0.5 * snoise(vec3(ac * 28.0, uFlareTime * 0.12 + 5.0)), 0.0, 1.0), 9.0);
    col += vec3(1.0, 0.92, 0.82) * (rays + 0.6 * fineRays) * burstFall * uStarburst * 2.5;
  }

  // ---- Anamorphic streak ------------------------------------------------------
  float streak = exp(-abs(q.y) * 260.0) * exp(-abs(q.x) * 2.6);
  col += vec3(0.55, 0.7, 1.0) * streak * uStreak * 1.6;

  col *= uIntensity * uVisibility;
  outputColor = vec4(inputColor.rgb + col, inputColor.a);
}
