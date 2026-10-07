// Soft star glow with faint diffraction spikes.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uIntensity;
uniform float uSpikes;

varying vec2 vQuad;

void main() {
  #include <logdepthbuf_fragment>
  float r = length(vQuad);
  if (r > 1.0) discard;
  // Bright core about a fifth of the quad, soft halo to its edge.
  float core = exp(-r * r * 22.0);
  float halo = exp(-r * 5.0) * 0.4;
  vec2 a = abs(vQuad);
  float spikes = uSpikes * (exp(-a.x * 90.0) + exp(-a.y * 90.0)) * (1.0 - r);
  float k = (core + halo + spikes) * (1.0 - smoothstep(0.8, 1.0, r));
  vec3 c = uColor * uIntensity * k;
  if (!(max(c.r, max(c.g, c.b)) >= 0.0005)) discard;
  gl_FragColor = vec4(c, 1.0);
}
