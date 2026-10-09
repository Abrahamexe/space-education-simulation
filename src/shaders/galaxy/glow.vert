// One slice of the layered galactic disc. The slice's share of the light
// (Gaussian vertical profile, normalised over all slices) depends only on
// the distance from the centre, so it is computed per vertex on a fine grid
// instead of per pixel.

#include <common>
#include <logdepthbuf_pars_vertex>

#define LAYERS 16

uniform float uZ;          // this slice's height above the mid-plane (pc)
uniform float uZMax;       // slices span ±uZMax
uniform float uWidth;      // picture width (pc)
uniform float uStride;     // only every uStride-th slice (mirrored about the mid-plane) is drawn

varying vec2 vUv;
varying vec3 vWorld;
varying float vWeight;

float profile(float z, float h) {
  return exp(-0.5 * (z * z) / (h * h));
}

void main() {
  vUv = uv;
  // Thin disc, swelling into the bulge.
  float r = length(uv - 0.5) * uWidth;
  float h = 110.0 + 820.0 * exp(-(r * r) / (1700.0 * 1700.0));
  float sum = 0.0;
  for (int i = 0; i < LAYERS; i++) {
    // Same selection as GalaxyModel.updateSlices: normalise over drawn slices.
    float m = float(i < LAYERS / 2 ? i : LAYERS - 1 - i);
    if (mod(float(LAYERS / 2 - 1) - m, uStride) > 0.5) continue;
    float t = float(i) / float(LAYERS - 1) * 2.0 - 1.0;
    sum += profile(sign(t) * t * t * uZMax, h);
  }
  vWeight = profile(uZ, h) / max(sum, 1e-4);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
