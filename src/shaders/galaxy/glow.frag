// The disc as a stack of slices (weights from the vertex shader). Viewed
// obliquely a slice is brightened by its longer path through the slab
// (capped).

#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uMap;
uniform float uIntensity;
uniform vec3 uNormal;      // galactic north (world)

varying vec2 vUv;
varying vec3 vWorld;
varying float vWeight;

void main() {
  #include <logdepthbuf_fragment>
  if (vWeight < 0.002) discard;
  vec3 v = normalize(cameraPosition - vWorld);
  float path = 1.0 / max(abs(dot(v, uNormal)), 0.6);
  vec3 c = texture2D(uMap, vUv).rgb * uIntensity * vWeight * path;
  if (!(max(c.r, max(c.g, c.b)) >= 0.0003)) discard;
  gl_FragColor = vec4(c, 1.0);
}
