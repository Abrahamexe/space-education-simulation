#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uCrisp;  // 0 soft glow, 1 hard dot

varying vec3 vColor;
varying float vAlpha;

void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  float soft = exp(-r2 * 3.0);
  float hard = 1.0 - smoothstep(0.55, 1.0, r2);
  float a = vAlpha * mix(soft, hard, uCrisp) * step(r2, 1.0);
  if (isnan(a) || !(a >= 0.002)) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
