// Volumetric nebula as a stack of slices. The picture's light is shared
// out over the slices by a per-pixel depth map: up to two Gaussian layers
// (front and back of a shell, say) with a thickness, normalised so the
// whole stack, seen from the Sun, adds back up to the original picture.
// Seen at a grazing angle a slice fades out (the particles carry the shape
// there) instead of showing as a line.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uMap;
uniform sampler2D uDepth;   // r: z1, g: z2 (units of uZRange), b: thickness, a: 1 / sum of weights
uniform float uIntensity;
uniform float uZ;           // this slice's depth (units of uZRange, −1..1)
uniform float uZRange;
uniform vec2 uFacing;       // facing fade range (|cos| of the view to the plane normal)

varying vec2 vUv;
varying vec3 vView;
varying vec3 vNormalV;

float g(float x, float s) {
  return exp(-0.5 * (x * x) / (s * s));
}

void main() {
  #include <logdepthbuf_fragment>
  vec4 dm = texture2D(uDepth, vUv);
  float w = (g(uZ - dm.r, dm.b) + g(uZ - dm.g, dm.b)) * dm.a;
  vec3 v = normalize(-vView);
  float facing = smoothstep(uFacing.x, uFacing.y, abs(dot(v, normalize(vNormalV))));
  vec2 e = smoothstep(vec2(0.0), vec2(0.14), vUv) * smoothstep(vec2(0.0), vec2(0.14), 1.0 - vUv);
  // Most slices carry almost nothing at a given pixel: skip the colour fetch.
  if (w * facing * e.x * e.y < 0.003) discard;
  vec3 c = texture2D(uMap, vUv).rgb * uIntensity * w * facing * e.x * e.y;
  if (!(max(c.r, max(c.g, c.b)) >= 0.0004)) discard;
  gl_FragColor = vec4(c, 1.0);
}
