// Cinematic: bright pulses travel down each line (the direction of the flow).
// Science: a static sawtooth, faint at the start of each period and bright at
// its end, reads as a row of arrows; colour by speed.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform float uOpacity;
uniform float uScience;
uniform float uPeriod;   // Mpc between pulses / arrows

varying float vAlong;
varying float vSpeed;
varying float vDist;

void main() {
  #include <logdepthbuf_fragment>
  float s = clamp((vSpeed - 80.0) / 600.0, 0.0, 1.0);
  vec3 slow = vec3(0.35, 0.55, 1.0);
  vec3 fast = vec3(1.0, 0.75, 0.35);
  vec3 col = mix(slow, fast, s);
  float ph = fract(vAlong / uPeriod - (1.0 - uScience) * uTime * 0.25);
  float a;
  if (uScience > 0.5) a = 0.18 + 0.82 * ph * ph;
  else a = 0.08 + 0.92 * pow(ph, 10.0);
  a *= uOpacity;
  if (!(a >= 0.002)) discard;
  gl_FragColor = vec4(col * a, 1.0);
}
