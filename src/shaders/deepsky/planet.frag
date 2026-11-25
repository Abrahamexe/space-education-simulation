// Exoplanet, lit by its star. Its class (exoplanetType.ts) picks the look; surface detail comes from
// real Solar System maps (Mercury, Moon, Jupiter, Neptune) recoloured for the class. Representative:
// no exoplanet surface has been imaged.
// uType: 0 lava, 1 barren, 2 temperate, 3 eyeball, 4 icy, 5 subNeptune, 6 giant, 7 hotJupiter.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_noise>

uniform sampler2D uTex;
uniform float uType;
uniform vec3 uTint;
uniform float uSeed;
uniform float uGlow;
uniform vec3 uLightColor;
uniform vec3 uLightPosV;

varying vec3 vPos;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;

bool isType(float t) { return abs(uType - t) < 0.5; }

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalV);
  vec3 l = normalize(uLightPosV - vViewPos);
  vec3 v = normalize(-vViewPos);
  float ndl = dot(n, l);
  float diff = max(ndl, 0.0);
  vec3 p = normalize(vPos);
  vec2 uv = vec2(fract(vUv.x + uSeed), vUv.y);
  vec3 tex = texture2D(uTex, uv).rgb;
  float h = dot(tex, vec3(0.3, 0.55, 0.15));
  vec3 base = vec3(0.0);
  vec3 emit = vec3(0.0);
  vec3 atm = vec3(0.0);

  if (isType(0.0)) {
    // Lava world: dark crust, glowing cracks, brighter on the night side.
    base = h * vec3(0.2, 0.16, 0.14);
    float cr = smoothstep(0.62, 0.82, abs(snoise(p * 5.0 + uSeed * 7.0))) + 0.6 * pow(1.0 - h, 5.0);
    emit = vec3(1.0, 0.33, 0.07) * cr * uGlow * (0.35 + 0.65 * (1.0 - diff));
  } else if (isType(1.0)) {
    base = h * uTint * 1.4;
  } else if (isType(2.0) || isType(3.0)) {
    float land = smoothstep(0.47, 0.53, h * 0.8 + 0.12 + 0.28 * snoise(p * 1.8 + uSeed * 5.0));
    vec3 ground = mix(vec3(0.32, 0.27, 0.18), vec3(0.2, 0.3, 0.14), 0.5 + 0.5 * snoise(p * 4.0 + uSeed));
    vec3 ocean = vec3(0.02, 0.08, 0.2);
    base = mix(ocean, ground * (0.7 + 0.6 * h), land);
    float cloud = smoothstep(0.15, 0.65, snoise(p * 2.6 + uSeed * 3.0) * 0.7 + snoise(p * 7.0 - uSeed) * 0.35 + 0.2);
    float ice = smoothstep(0.78, 0.9, abs(p.y));
    if (isType(3.0)) {
      // Tidally locked: open water only near the point under the star, ice elsewhere.
      ice = 1.0 - smoothstep(0.25, 0.55, ndl);
      cloud *= smoothstep(-0.1, 0.4, ndl);
    }
    base = mix(base, vec3(0.86, 0.9, 0.95), ice);
    base = mix(base, vec3(0.92), cloud * 0.75);
    atm = vec3(0.35, 0.55, 1.0);
  } else if (isType(4.0)) {
    base = mix(vec3(0.62, 0.72, 0.82), vec3(0.95, 0.97, 1.0), h);
  } else if (isType(5.0)) {
    base = mix(tex * uTint * 1.1, uTint * 0.55, 0.35);
    atm = uTint;
  } else if (isType(6.0)) {
    base = mix(vec3(h), tex, 0.35) * uTint * 1.6;
    atm = uTint * 0.6;
  } else {
    // Hot Jupiter: dark, banded, glowing red on the night side.
    // Measured hot Jupiters are darker than coal (geometric albedo of a few per cent).
    base = tex * vec3(0.12, 0.085, 0.075);
    emit = vec3(0.95, 0.28, 0.08) * uGlow * pow(1.0 - diff, 2.0) * (0.6 + 0.4 * h);
    atm = vec3(0.7, 0.35, 0.2);
  }

  vec3 c = base * uLightColor * (diff + 0.02) + emit;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  c += atm * rim * (0.15 + diff) * uLightColor * 0.8;
  gl_FragColor = vec4(c, 1.0);
}
