// One-off bake of the Milky Way's procedural nebula colour into an
// equirectangular texture in galactic coordinates (the same mapping as the
// panorama). The noise is static, so evaluating five simplex octaves per
// screen pixel every frame was pure waste; the sky shader now just samples
// this map. Output is the un-weighted tint; strength and the galactic-plane
// concentration stay uniforms in milkyway.frag.

#include <common>
#include <space_noise>

uniform mat3 uSceneToGalactic;

varying vec2 vUv;

void main() {
  // Inverse of milkyway.frag's lookup: uv → galactic (l, b) → direction.
  float l = (0.5 - vUv.x) * 2.0 * PI;
  float b = (0.5 - vUv.y) * PI;
  vec3 g = vec3(cos(b) * cos(l), cos(b) * sin(l), sin(b));
  vec3 dir = transpose(uSceneToGalactic) * g; // rotation: inverse = transpose

  float n = fbm3(dir * 1.8, 4);
  float hue = snoise(dir * 0.9 + 4.2);
  vec3 tint = mix(vec3(0.28, 0.36, 0.95), vec3(0.95, 0.38, 0.52), 0.5 + 0.5 * hue);
  gl_FragColor = vec4(tint * pow(max(n, 0.0), 2.0), 1.0);
}
