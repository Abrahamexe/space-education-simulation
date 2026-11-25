#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uIntensity;

varying float vAlong;
varying vec3 vView;
varying vec3 vNormalV;

void main() {
  #include <logdepthbuf_fragment>
  vec3 v = normalize(-vView);
  // Brighter where the line of sight grazes the cone (thicker glow).
  float rim = 1.0 - abs(dot(v, normalize(vNormalV)));
  float a = uIntensity * pow(1.0 - vAlong, 2.2) * (0.25 + 0.75 * rim * rim);
  if (isnan(a) || !(a >= 0.002)) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
