// Black hole, ray-traced in Schwarzschild spacetime (units: Schwarzschild
// radius Rs = 1). Each pixel's photon is integrated backwards with the
// exact orbit equation for light, written as an acceleration
//   a = -(3/2) h^2 r / r^5   (h = |r x v|, conserved),
// so paths bend, wrap round the photon sphere (r = 1.5) or fall in (r < 1).
// A thin accretion disc in the hole's y = 0 plane is sampled wherever a
// path crosses it: that is how the far side of the disc shows up arched
// over and under the shadow, as in the film Interstellar. Escaping paths
// look up the rendered scene (or the painted sky off-screen) in their final
// direction. Rays that never come near (impact parameter > uR0) get the
// weak-field deflection 2/b only.

#include <space_noise>

uniform float uActive;
uniform vec3 uCamPos;      // camera, hole frame (Rs)
uniform mat3 uCamRot;      // camera axes (right, up, back) in the hole frame
uniform float uTanHalf;
uniform float uR0;         // integration sphere radius (Rs)
uniform float uDiskOn;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uDiskGain;
uniform float uDoppler;    // 0 = film look, 1 = full relativistic beaming
uniform vec3 uDiskHot;
uniform vec3 uDiskWarm;
uniform float uTime;
uniform sampler2D uSky;
uniform float uSkyOn;
uniform float uSkyGain;
uniform mat3 uSkyMat;      // hole frame -> galactic
uniform float uLens;       // 1 = bent light, 0 = straight rays (no lensing)

// Without lensing the hole is still drawn as it would look: a shadow of the
// true apparent size (2.6 Rs) rimmed by a thin bright photon ring and a soft
// halo, so it can be found against the stars.
#define SHADOW_R 2.6

#define MAX_STEPS 300

vec3 skyColor(vec3 d) {
  if (uSkyOn < 0.5) return vec3(0.0);
  vec3 g = uSkyMat * d;
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  vec2 st = vec2(0.5 - l / (2.0 * PI), 0.5 - b / PI);
  return texture2D(uSky, st).rgb * uSkyGain;
}

vec3 background(vec3 d) {
  vec3 col = skyColor(d);
  vec3 dc = vec3(dot(uCamRot[0], d), dot(uCamRot[1], d), dot(uCamRot[2], d));
  float zf = max(-dc.z, 1e-4);
  vec2 ndc = vec2(dc.x / zf / (aspect * uTanHalf), dc.y / zf / uTanHalf);
  float m = max(abs(ndc.x), abs(ndc.y));
  if (dc.z < -1e-4 && m < 1.0) {
    vec3 scene = texture2D(inputBuffer, clamp(ndc * 0.5 + 0.5, 0.0, 1.0)).rgb;
    col = mix(col, scene, smoothstep(1.0, 0.85, m));
  }
  return col;
}

// Emission (premultiplied) and opacity of the disc where a path crosses it.
vec4 disc(vec3 p, vec3 v) {
  float r = length(p.xz);
  if (r < uDiskIn || r > uDiskOut) return vec4(0.0);
  float t = (r - uDiskIn) / (uDiskOut - uDiskIn);
  float ang = atan(p.z, p.x);
  // Keplerian shear: inner gas laps the outer, streaking it into rings.
  float omega = pow(r, -1.5);
  float sw = ang - uTime * omega * 6.0;
  // Streaks: high frequency across radius, low along the orbit (periodic in
  // angle), the way sheared gas looks in the film.
  vec2 cs = vec2(cos(sw), sin(sw));
  float n = 0.5 * snoise(vec3(cs * 1.2, r * 3.0)) + 0.3 * snoise(vec3(cs * 2.6, r * 9.0 + 3.0)) + 0.2 * snoise(vec3(cs * 5.0, r * 22.0 + 9.0));
  float dens = clamp(0.62 + 0.55 * n, 0.0, 1.0);
  dens *= smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.75, 1.0, t));
  vec3 col = mix(uDiskHot, uDiskWarm, smoothstep(0.0, 0.7, t));
  float bright = uDiskGain * pow(1.0 - t, 1.6) * (0.35 + dens);
  // Orbital velocity (counter-clockwise seen from +y) and Doppler factor.
  vec3 vel = normalize(vec3(-p.z, 0.0, p.x));
  float beta = clamp(sqrt(0.5 / r), 0.0, 0.7);
  float gamma = inversesqrt(1.0 - beta * beta);
  float D = 1.0 / (gamma * (1.0 - beta * dot(vel, -normalize(v))));
  float beam = mix(1.0, pow(D, 3.0), uDoppler);
  col = mix(col, col * vec3(0.75, 0.9, 1.3), clamp((D - 1.0) * uDoppler, 0.0, 0.6));
  // Gravitational redshift dims the innermost gas.
  bright *= beam * sqrt(max(1.0 - 1.0 / r, 0.0));
  float alpha = clamp(dens * 1.4, 0.0, 0.95);
  return vec4(col * bright * alpha, alpha);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uActive < 0.5) {
    outputColor = inputColor;
    return;
  }
  vec3 rd = normalize(uCamRot * vec3((uv.x * 2.0 - 1.0) * aspect * uTanHalf, (uv.y * 2.0 - 1.0) * uTanHalf, -1.0));
  vec3 ro = uCamPos;
  vec3 p = ro;
  float rc = length(ro);
  if (rc > uR0) {
    float B = dot(ro, rd);
    float disc2 = B * B - (rc * rc - uR0 * uR0);
    if (disc2 < 0.0 || B > 0.0) {
      if (uLens < 0.5) {
        outputColor = inputColor;
        return;
      }
      // Far ray: weak-field bending towards the hole, angle 2/b.
      vec3 c = ro - rd * B;
      float b = max(length(c), 1e-3);
      vec3 bent = normalize(rd - c / b * (2.0 / b));
      outputColor = vec4(background(bent), inputColor.a);
      return;
    }
    p = ro + rd * (-B - sqrt(disc2));
  }
  vec3 v = rd;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);
  vec4 acc = vec4(0.0);
  bool captured = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    float r = length(p);
    if (r < mix(SHADOW_R, 1.0, uLens)) {
      captured = true;
      break;
    }
    if (r > uR0 * 1.02 && dot(p, v) > 0.0) break;
    float dt = clamp(0.07 * r * min(r / 1.5, 1.0), 0.012, 2.5);
    float r2 = r * r;
    vec3 a = (-1.5 * uLens * h2 / (r2 * r2 * r)) * p;
    vec3 vn = v + a * dt;
    vec3 pn = p + vn * dt;
    if (uDiskOn > 0.5 && p.y * pn.y < 0.0) {
      vec3 hit = mix(p, pn, p.y / (p.y - pn.y));
      vec4 d = disc(hit, vn);
      acc.rgb += (1.0 - acc.a) * d.rgb;
      acc.a += (1.0 - acc.a) * d.a;
      if (acc.a > 0.97) break;
    }
    p = pn;
    v = vn;
  }
  vec3 bg = captured ? vec3(0.0) : uLens < 0.5 ? inputColor.rgb : background(normalize(v));
  vec3 col = acc.rgb + (1.0 - acc.a) * bg;
  if (uLens < 0.5 && dot(ro, rd) < 0.0) {
    float b = length(cross(ro, rd));
    float x = b - SHADOW_R;
    float rim = exp(-x * x / 0.02) * 1.6 + (x > 0.0 ? 0.35 * exp(-x / 1.8) : 0.0);
    col += (1.0 - acc.a * 0.6) * rim * vec3(1.0, 0.62, 0.3);
  }
  outputColor = vec4(col, inputColor.a);
}
