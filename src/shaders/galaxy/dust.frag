// Dust in the mid-plane, drawn with multiplicative blending: it dims the
// disc light behind it (slices below the plane when seen from above) and,
// seen edge-on, shows as the dark lane through the middle of the disc. The
// map marks where the picture is darker than its surroundings (the lanes).

#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uDust;
uniform float uStrength;
uniform vec3 uNormal;

varying vec2 vUv;
varying vec3 vWorld;

void main() {
  #include <logdepthbuf_fragment>
  float dust = texture2D(uDust, vUv).r;
  vec3 v = normalize(cameraPosition - vWorld);
  // Longer path through the dust layer when seen at a slant.
  float path = min(1.0 / max(abs(dot(v, uNormal)), 0.08), 6.0);
  float t = exp(-uStrength * dust * path);
  gl_FragColor = vec4(vec3(t), 1.0);
}
