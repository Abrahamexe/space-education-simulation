// Laniakea's boundary: the basin mask (R8, 1 inside) ray-marched, glowing
// where the mask crosses one half, a thin shell, with a faint fill inside.

#include <common>
#include <logdepthbuf_pars_fragment>

precision highp sampler3D;

uniform sampler3D uMask;
uniform vec3 uCamObj;
uniform float uHalf;
uniform float uIntensity;

varying vec3 vObj;

void main() {
  #include <logdepthbuf_fragment>
  vec3 ro = uCamObj;
  vec3 rd = normalize(vObj - uCamObj);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (vec3(-uHalf) - ro) * inv;
  vec3 t1 = (vec3(uHalf) - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tn = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  if (!(tf > tn)) discard;
  const int N = 112;
  float dt = (tf - tn) / float(N);
  float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float acc = 0.0;
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (tn + (float(i) + j) * dt);
    float m = texture(uMask, p / (2.0 * uHalf) + 0.5).r;
    float shell = 1.0 - abs(m - 0.5) * 2.0;
    acc += pow(max(shell, 0.0), 10.0) + m * 0.02;
  }
  vec3 col = vec3(1.0, 0.72, 0.32) * acc * dt / (2.0 * uHalf) * uIntensity;
  if (isnan(col.r)) discard;
  gl_FragColor = vec4(col, 1.0);
}
