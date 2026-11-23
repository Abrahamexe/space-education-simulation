// Sky-subtracted photo, added to the scene (the black around it adds nothing).

#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uMap;
uniform float uOpacity;

varying vec2 vUv;

void main() {
  #include <logdepthbuf_fragment>
  vec4 t = texture2D(uMap, vUv);
  vec3 c = t.rgb * uOpacity;
  if (!(max(c.r, max(c.g, c.b)) >= 0.002)) discard;
  gl_FragColor = vec4(c, 1.0);
}
