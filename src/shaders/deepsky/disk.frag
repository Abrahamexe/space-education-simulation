// Hot, swirling gas: hotter and brighter inwards, streaked by orbital shear,
// and Doppler-beamed (the side coming towards us is brighter and bluer).

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>

uniform float uInner;
uniform float uOuter;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uCamLocal;   // camera position in the ring's frame

varying vec2 vPos;

void main() {
  #include <logdepthbuf_fragment>
  float r = length(vPos);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float ang = atan(vPos.y, vPos.x);
  // Keplerian shear: inner gas laps the outer.
  float swirl = ang + uTime * 1.6 * pow(uInner / max(r, uInner), 1.5);
  float n = snoise(vec3(cos(swirl) * r * 2.2, sin(swirl) * r * 2.2, t * 3.0 + uTime * 0.05));
  float streak = 0.65 + 0.35 * n;
  vec3 hot = vec3(1.0, 0.92, 0.8);
  vec3 warm = vec3(1.0, 0.55, 0.18);
  vec3 cool = vec3(0.55, 0.12, 0.04);
  vec3 col = t < 0.35 ? mix(hot, warm, t / 0.35) : mix(warm, cool, (t - 0.35) / 0.65);
  // Doppler beaming: orbital velocity (counter-clockwise) towards the camera.
  vec3 vel = normalize(vec3(-vPos.y, vPos.x, 0.0));
  vec3 toCam = normalize(uCamLocal - vec3(vPos, 0.0));
  float beta = 0.35 * sqrt(uInner / max(r, uInner));
  float dop = pow(1.0 + beta * dot(vel, toCam), 3.0);
  col = mix(col, col * vec3(0.8, 0.9, 1.25), clamp(dot(vel, toCam), 0.0, 1.0) * 0.4);
  float edge = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.7, 1.0, t));
  float bright = uIntensity * streak * edge * pow(max(1.0 - t, 0.0), 1.5) * dop;
  vec3 c = col * bright;
  if (!(max(c.r, max(c.g, c.b)) >= 0.0005)) discard;
  gl_FragColor = vec4(c, 1.0);
}
