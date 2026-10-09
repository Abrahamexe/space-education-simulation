// Corona and chromosphere — additive, linear HDR.
//
//  - Inner corona: bright, steep exponential falloff just above the limb.
//  - Outer corona: power-law falloff r^-k, broken into radial streamers by
//    4D noise sampled on the 3D direction (angular detail) and log(r) minus
//    time (radial flow outwards). Streamers favour the solar equator; thin
//    polar plumes remain near the poles, as in eclipse photographs.
//  - Magnetic loops: arcades of nested, thin semicircular arcs standing on
//    the limb over the active latitudes, slowly brightening and fading.
//  - Chromosphere: a thin, spiky red rim hugging the limb.
// The whole pattern turns slowly about the solar axis and "breathes".

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>

uniform float uTime;
uniform vec3 uAxis;
uniform float uIntensity;
uniform float uFalloff;
uniform float uStreamerStrength;
uniform float uStreamerSharpness;
uniform float uFlowSpeed;
uniform vec3 uColor;
uniform vec3 uInnerColor;
uniform vec3 uChromoColor;
uniform float uChromoIntensity;
uniform float uExtent;
uniform float uSwirl;        // current turn angle about the axis (rad)
uniform float uBreath;       // brightness multiplier (CPU, ~1 ± a few %)
uniform float uLoopStrength;

// Rodrigues rotation of v about unit axis k.
vec3 rotateAbout(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

varying vec3 vOffset;
varying vec2 vPlane;

const float LOOP_CELL = 0.16;      // arcade width along the limb (radians)
const float LOOP_THICK = 0.0045;   // arc thickness (radii)

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

// Nested arcs centred on a footpoint pair in one limb cell.
float arcade(float theta, float h, float t) {
  float u = theta / LOOP_CELL;
  float cell = floor(u);
  float x = (fract(u) - 0.5) * LOOP_CELL;
  float rnd = hash11(cell);
  // Not every cell has an arcade; those that do wax and wane over ~a minute.
  float life = smoothstep(0.35, 1.0, sin(t * (0.08 + 0.06 * rnd) + rnd * 6.2831853));
  if (life <= 0.0 || rnd < 0.25) return 0.0;
  float d = length(vec2(x, h));
  float sum = 0.0;
  for (int k = 0; k < 3; k++) {
    float R = LOOP_CELL * (0.42 - 0.12 * float(k)) * (0.8 + 0.4 * hash11(cell + float(k) * 7.0));
    float ring = (d - R) / LOOP_THICK;
    sum += exp(-ring * ring) * (1.0 - 0.25 * float(k));
  }
  return sum * life;
}

void main() {
  #include <logdepthbuf_fragment>

  float r = length(vOffset);
  // The disk itself is drawn by the photosphere; skip pixels it will cover.
  if (r < 0.985) discard;
  float h0 = max(r - 1.0, 0.0);
  // Upper bound of everything below without the noise: skip pixels that
  // cannot reach a visible level (the outskirts of the billboard).
  float edge0 = 1.0 - smoothstep(uExtent * 0.55, uExtent * 0.98, r);
  float bound = (exp(-h0 * 9.0) * 1.2 + pow(r, -uFalloff) * (0.18 + uStreamerStrength)) * uIntensity * uBreath * edge0;
  if (bound < 2e-4 && h0 >= 0.03) discard;

  vec3 dir = rotateAbout(vOffset / r, uAxis, uSwirl);
  float h = max(r - 1.0, 0.0);           // height above the limb (radii)
  float logR = log(max(r, 1.0));
  float flow = uTime * uFlowSpeed;

  // ---- Streamers -----------------------------------------------------------
  float eq = 1.0 - abs(dot(dir, uAxis));  // 1 at equator, 0 at poles
  float n1 = snoise(vec4(dir * 2.6, logR * 1.4 - flow));
  // The middle octave fades out far from the limb, where the streamers are
  // faint and broad (each 4-D lookup is costly over a screen-sized corona).
  float w2 = 1.0 - smoothstep(3.5, 4.5, r);
  float n2 = w2 > 0.0 ? snoise(vec4(dir * 7.5 + 3.1, logR * 2.6 - flow * 1.7)) * w2 : 0.0;
  // Finest octave only near the limb, where it is resolvable.
  float n3 = r < 2.5 ? snoise(vec4(dir * 21.0 - 1.7, logR * 4.0 - flow * 2.3)) : 0.0;
  float streamNoise = 0.55 * n1 + 0.3 * n2 + 0.15 * n3;
  float streamer = pow(clamp(0.5 + 0.5 * streamNoise, 0.0, 1.0), uStreamerSharpness);
  // Wide equatorial helmets, thinner polar plumes.
  float zone = mix(0.35, 1.0, pow(max(eq, 0.0), 1.4));
  streamer *= zone;

  // ---- Radial profiles ------------------------------------------------------
  float inner = exp(-h * 9.0);
  float outer = pow(r, -uFalloff);
  // Fade to zero at the quad border so the billboard edge never shows.
  float edge = 1.0 - smoothstep(uExtent * 0.55, uExtent * 0.98, r);

  vec3 col = uInnerColor * inner * (0.8 + 0.4 * streamer);
  col += uColor * outer * (0.18 + uStreamerStrength * streamer);

  // ---- Magnetic loops ---------------------------------------------------------
  if (h < LOOP_CELL * 0.5) {
    float theta = atan(vPlane.y, vPlane.x);
    // Active latitudes only (position angle measured from the solar equator).
    float activeBelt = 1.0 - smoothstep(0.35, 0.6, abs(sin(theta)));
    if (activeBelt > 0.0) {
      col += uInnerColor * arcade(theta, h, uTime) * activeBelt * exp(-h * 12.0) * uLoopStrength;
    }
  }
  col *= uIntensity * uBreath * edge;

  // ---- Chromosphere -----------------------------------------------------------
  if (h < 0.03) {
    float spicules = 0.65 + 0.35 * snoise(vec4(dir * 140.0, flow * 6.0));
    float chromo = exp(-h / 0.0035) * spicules;
    col += uChromoColor * chromo * uChromoIntensity;
  }

  gl_FragColor = vec4(col, 1.0);
}
