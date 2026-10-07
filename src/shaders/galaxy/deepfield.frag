// The universe beyond the Milky Way: a deep field of distant galaxies
// (ellipticals, spirals, edge-on discs) of all sizes, plus a few faint
// foreground halo stars — procedural, so it never repeats or pixelates.

#include <common>

uniform float uIntensity;

varying vec3 vDir;

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// One galaxy per cell (some cells empty), drawn on the sky round its centre.
vec3 galaxies(vec3 d, float cells, float density, float size) {
  vec3 p = d * cells;
  vec3 cell = floor(p);
  vec3 h = hash33(cell);
  if (h.x > density) return vec3(0.0);
  vec3 centre = cell + 0.3 + 0.4 * hash33(cell + 7.13);
  vec3 off = p - centre;
  off -= d * dot(off, d);
  vec3 axis = normalize(cross(d, hash33(cell + 3.71) - 0.5));
  vec3 axis2 = cross(d, axis);
  float flat_ = mix(0.15, 1.0, h.y);           // edge-on .. face-on
  float x = dot(off, axis);
  float y = dot(off, axis2) / flat_;
  float s = size * (0.5 + h.z);
  float r = length(vec2(x, y)) / s;
  if (r > 3.0) return vec3(0.0);
  vec3 tint;
  float prof;
  if (h.z > 0.55) {
    // Spiral: bluish disc with two arms and a yellow core.
    float a = atan(y, x);
    float arms = 0.55 + 0.45 * sin(2.0 * a - r * 5.0);
    prof = exp(-r * r * 9.0) * 1.5 + exp(-r * 1.6) * arms * 0.6;
    tint = mix(vec3(1.0, 0.85, 0.6), vec3(0.65, 0.78, 1.0), smoothstep(0.1, 0.8, r));
  } else {
    // Elliptical: smooth, warm.
    prof = exp(-pow(r, 0.7) * 3.2) * 1.4;
    tint = vec3(1.0, 0.82, 0.62);
  }
  return tint * prof * (0.35 + 0.65 * h.y);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 c = vec3(0.0);
  c += galaxies(d, 14.0, 0.18, 0.05) * 0.9;
  c += galaxies(d, 38.0, 0.35, 0.06) * 0.55;
  c += galaxies(d, 90.0, 0.5, 0.07) * 0.35;
  c += galaxies(d, 210.0, 0.55, 0.08) * 0.22;
  // Faint halo stars.
  vec3 sh = hash33(floor(d * 700.0));
  c += vec3(0.85, 0.9, 1.0) * step(0.9975, sh.x) * 0.5 * sh.y;
  gl_FragColor = vec4(c * uIntensity, 1.0);
}
