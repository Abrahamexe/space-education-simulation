// Prominence loop — additive plasma.
// A thin tube looks volumetric when its brightness follows how directly we
// look through it (|N·V|). Noise scrolling along the loop reads as plasma
// draining down the magnetic field lines; uGrow lets the loop rise from one
// footpoint, uLife fades the whole structure in and out.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>

uniform float uTime;
uniform float uSeed;
uniform float uLife;       // 0..1 envelope
uniform float uGrow;       // 0..1 visible fraction along the loop
uniform float uIntensity;
uniform float uFlowSpeed;
uniform vec3 uColor;
uniform vec3 uSunCenterV;   // Sun centre, view space
uniform float uSunRadius;   // Sun radius, world units

varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;

void main() {
  #include <logdepthbuf_fragment>

  float along = vUv.x;
  float around = vUv.y * 6.2831853;

  float ends = smoothstep(0.0, 0.1, along) * (1.0 - smoothstep(0.9, 1.0, along));
  float grow = 1.0 - smoothstep(uGrow - 0.08, uGrow, along);

  float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
  float body = pow(max(facing, 0.0), 2.2);

  // Seamless around the tube: sample on a circle.
  vec3 q = vec3(along * 7.0 - uTime * uFlowSpeed * 2.0, cos(around) * 0.45, sin(around) * 0.45 + uSeed);
  float n = fbm3(q, 3);
  float strands = smoothstep(-0.45, 0.4, n);

  // Seen against the bright disk a prominence is a dark filament; additive
  // light cannot darken, so it simply recedes there.
  vec3 rayDir = normalize(vViewPos);
  float rayDist = length(uSunCenterV - dot(uSunCenterV, rayDir) * rayDir);
  float onDisk = 1.0 - smoothstep(uSunRadius * 0.985, uSunRadius * 1.01, rayDist);

  float a = body * ends * grow * strands * uLife * mix(1.0, 0.1, onDisk);
  if (a < 0.001) discard;

  vec3 col = uColor * uIntensity * a * (0.55 + 0.9 * max(n, 0.0));
  gl_FragColor = vec4(col, 1.0);
}
