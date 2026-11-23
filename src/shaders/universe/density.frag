// Emission-only ray march through the density grid (R8: (log10(1+δ)+1)/2).
// Cinematic: a violet glow where matter piles up (δ ≳ 1). Science: the same
// field as a colour scale, blue below the mean, red above, faint overall.

#include <common>
#include <logdepthbuf_pars_fragment>

precision highp sampler3D;

uniform sampler3D uDensity;
uniform vec3 uCamObj;     // camera position in the box's frame (Mpc)
uniform float uHalf;      // box half size (Mpc)
uniform float uIntensity;
uniform float uScience;   // 0 cinematic, 1 science
uniform float uSteps;

varying vec3 vObj;

vec3 sciencePalette(float l) {
  // l = log10(1+δ) in [-1, 1]: overdensities only, yellow → red as δ grows
  // (voids stay black, so the map stays readable).
  float k = smoothstep(0.2, 1.0, l);
  return mix(vec3(0.9, 0.75, 0.2), vec3(1.0, 0.25, 0.1), smoothstep(0.5, 1.0, l)) * k * k;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 ro = uCamObj;
  vec3 rd = normalize(vObj - uCamObj);
  // Slab intersection with the box.
  vec3 inv = 1.0 / rd;
  vec3 t0 = (vec3(-uHalf) - ro) * inv;
  vec3 t1 = (vec3(uHalf) - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tn = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  if (!(tf > tn)) discard;
  float n = uSteps;
  float dt = (tf - tn) / n;
  vec3 acc = vec3(0.0);
  // Per-pixel jitter hides the step pattern.
  float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < 160; i++) {
    if (float(i) >= n) break;
    vec3 p = ro + rd * (tn + (float(i) + j) * dt);
    float v = texture(uDensity, p / (2.0 * uHalf) + 0.5).r;
    float l = v * 2.0 - 1.0;
    // Fade towards the box edges (the survey thins out there).
    float edge = 1.0 - smoothstep(0.78, 0.98, length(p) / uHalf);
    if (uScience > 0.5) {
      acc += sciencePalette(l) * edge;
    } else {
      // Only where matter piles up (δ ≳ 2): filaments and clusters, not a fog.
      float e = smoothstep(0.45, 1.0, l);
      // Blue: the usual colour for dark matter (gas is pink, as in the Bullet Cluster images).
      vec3 c = mix(vec3(0.12, 0.3, 1.0), vec3(0.55, 0.8, 1.0), smoothstep(0.6, 1.0, l));
      acc += c * e * e * e * edge;
    }
  }
  // Normalised by the box size so the glow doesn't depend on the step count.
  vec3 col = acc * dt / (2.0 * uHalf) * uIntensity;
  if (isnan(col.r + col.g + col.b)) discard;
  gl_FragColor = vec4(col, 1.0);
}
