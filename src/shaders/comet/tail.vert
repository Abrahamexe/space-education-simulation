// Comet tails as GPU particles. Each particle has a fixed random seed; its
// age cycles over time, so the tail is a steady stream with no CPU work.
//
//  - ION tail (define ION): plasma swept straight out by the solar wind —
//    exactly anti-sunward, narrow, with a slight ripple.
//  - Dust tail: grains pushed by radiation pressure but keeping their
//    orbital momentum, so the tail curves back along the orbit and fans out.
// Positions are built in render space from uniforms (no precision issues).

#include <common>
#include <logdepthbuf_pars_vertex>

uniform vec3 uNucleus;        // render space
uniform vec3 uAntiSun;        // unit
uniform vec3 uVelocity;       // unit, direction of motion
uniform float uLength;        // scene units
uniform float uWidth;         // scene units at the far end
uniform float uActivity;      // 0..1
uniform float uTime;
uniform float uRate;          // stream speed (cycles per second)
uniform float uParticleSize;  // scene units
uniform float uProjScale;     // viewport half-height / tan(fov/2), device px
uniform vec3 uColor;

attribute vec4 aSeed;

const float MAX_POINT_PX = 48.0;
const float NEAR_FADE_PX = 14.0;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float t = fract(aSeed.x + uTime * uRate * (0.7 + 0.6 * aSeed.w));
  // Perpendicular basis around the anti-sun axis.
  vec3 up = abs(uAntiSun.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 p1 = normalize(cross(uAntiSun, up));
  vec3 p2 = cross(uAntiSun, p1);
  float ang = aSeed.y * 6.2831853;
  vec3 radial = p1 * cos(ang) + p2 * sin(ang);
  float spread = sqrt(aSeed.z);

#ifdef ION
  float along = t;
  vec3 pos = uNucleus + uAntiSun * (along * uLength)
           + radial * spread * uWidth * (0.15 + 0.85 * along) * 0.35
           + p1 * sin(along * 12.0 + uTime * 0.7 + aSeed.w * 3.0) * uWidth * 0.08 * along;
  float fade = pow(max(1.0 - t, 0.0), 1.2);
#else
  float along = t * t;  // grains decelerate relative to the nucleus
  // Lagging behind along the orbit makes the characteristic curve.
  vec3 trailing = -uVelocity * along * along * 0.55;
  vec3 pos = uNucleus + (uAntiSun * along * 0.85 + trailing) * uLength
           + radial * spread * uWidth * (0.1 + along);
  float fade = pow(max(1.0 - t, 0.0), 1.6);
#endif

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  float px = uParticleSize * (0.5 + aSeed.w) / max(-mv.z, 1e-6) * uProjScale;
  gl_PointSize = clamp(px, 1.0, MAX_POINT_PX);
  // Sub-pixel grains are drawn at 1 px with their light scaled by area.
  vAlpha = fade * uActivity * min(px * px, 1.0);
  // Grains right next to the camera (flying through the tail) would be big
  // soft discs; let them dissolve into the haze instead.
  vAlpha *= 1.0 - smoothstep(NEAR_FADE_PX, MAX_POINT_PX, px);
  vColor = uColor;
}
