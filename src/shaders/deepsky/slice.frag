// Volumetric nebula as a stack of slices. The picture's light is shared
// out over the slices by a per-pixel depth map: up to two Gaussian layers
// (front and back of a shell, say) with a thickness, normalised so the
// whole stack, seen from the Sun, adds back up to the original picture.
// Seen at a grazing angle a slice fades out (the particles carry the shape
// there) instead of showing as a line.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uMap;
uniform sampler2D uDetail;  // full-resolution window over part of the picture
uniform vec4 uDetailRect;   // its extent in picture uv: u0 v0 u1 v1
uniform float uDetailMix;
uniform sampler2D uDepth;   // r: z1, g: z2 (units of uZRange), b: thickness, a: 1 / sum of weights
uniform float uIntensity;
uniform float uZ;           // this slice's depth (units of uZRange, −1..1)
uniform float uZRange;
uniform vec2 uFacing;       // facing fade range (|cos| of the view to the plane normal)
uniform float uCollapse;    // 1: on the Earth-side axis, one slice carries the whole stack

#define SLICES 16

varying vec2 vUv;
varying vec3 vView;
varying vec3 vNormalV;

float g(float x, float s) {
  return exp(-0.5 * (x * x) / (s * s));
}

void main() {
  #include <logdepthbuf_fragment>
  vec4 dm = texture2D(uDepth, vUv);
  float w;
  if (uCollapse > 0.5) {
    // On axis the depth-scaled slices project onto the same pixels: sum their
    // weights here instead of blending 16 full layers.
    w = 0.0;
    for (int s = 0; s < SLICES; s++) {
      float zs = float(s) / float(SLICES - 1) * 2.0 - 1.0;
      w += g(zs - dm.r, dm.b) + g(zs - dm.g, dm.b);
    }
    w *= dm.a;
  } else {
    w = (g(uZ - dm.r, dm.b) + g(uZ - dm.g, dm.b)) * dm.a;
  }
  vec3 v = normalize(-vView);
  float facing = smoothstep(uFacing.x, uFacing.y, abs(dot(v, normalize(vNormalV))));
  vec2 e = smoothstep(vec2(0.0), vec2(0.14), vUv) * smoothstep(vec2(0.0), vec2(0.14), 1.0 - vUv);
  // Most slices carry almost nothing at a given pixel: skip the colour fetch.
  if (w * facing * e.x * e.y < 0.003) discard;
  vec3 map = texture2D(uMap, vUv).rgb;
  if (uDetailMix > 0.0) {
    vec2 d = (vUv - uDetailRect.xy) / (uDetailRect.zw - uDetailRect.xy);
    vec2 f = smoothstep(vec2(0.0), vec2(0.02), d) * smoothstep(vec2(0.0), vec2(0.02), 1.0 - d);
    map = mix(map, texture2D(uDetail, d).rgb, uDetailMix * f.x * f.y);
  }
  vec3 c = map * uIntensity * w * facing * e.x * e.y;
  if (!(max(c.r, max(c.g, c.b)) >= 0.0004)) discard;
  gl_FragColor = vec4(c, 1.0);
}
