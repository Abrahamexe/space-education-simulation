// Jet glow: brightest along the spine (soft limb from the view angle),
// knots of shocked plasma along its length, fading towards the tip.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>

uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uSeed;

varying float vAlong;
varying vec3 vView;
varying vec3 vNormalV;

void main() {
  #include <logdepthbuf_fragment>
  float rim = abs(dot(normalize(vNormalV), normalize(-vView)));
  float spine = pow(rim, 2.2);
  // Knots drift outwards along the jet.
  float k = vAlong * 38.0 - uTime * 0.25;
  float knots = 0.55 + 0.45 * smoothstep(0.1, 0.9, snoise(vec3(k, uSeed, 0.0)) * 0.5 + 0.5);
  // Faint where it is launched (next to the hole the disc dominates), then
  // brightest a few hundred Rs out, fading towards the tip.
  float fade = smoothstep(0.02, 0.3, vAlong) * (1.0 - smoothstep(0.75, 1.0, vAlong));
  float base = mix(1.0, 0.45, vAlong);
  vec3 c = uColor * uIntensity * spine * knots * fade * base;
  if (max(c.r, max(c.g, c.b)) < 0.0005) discard;
  gl_FragColor = vec4(c, 1.0);
}
