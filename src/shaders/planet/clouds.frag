// Earth's cloud shell — a slightly larger sphere drawn after the surface.
// Opacity comes from the cloud map; lighting has a soft terminator with a
// warm tint as sunlight grazes the deck, and a faint glow on the night side
// so storm systems remain readable against city lights.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_planet>

uniform sampler2D uClouds;
uniform float uCloudOffset;
uniform float uOpacity;
uniform vec3 uTwilightTint;

varying vec2 vUv;
varying vec3 vObjPos;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vTangentW;

void main() {
  #include <logdepthbuf_fragment>

  float c = texture2D(uClouds, vUv + vec2(uCloudOffset, 0.0)).r;
  float alpha = smoothstep(0.08, 0.85, c) * uOpacity;
  if (alpha < 0.004) discard;

  vec3 L = normalize(uSunPosW - vPosW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 N = normalize(vNormalW);
  float NdotL = dot(N, L);
  float lit = softTerminator(NdotL, 0.08) * (0.25 + 0.75 * max(NdotL, 0.0));

  // Grazing light is redder (longer path through the atmosphere).
  float grazing = 1.0 - smoothstep(0.0, 0.35, NdotL);
  vec3 tint = mix(vec3(1.0), uTwilightTint, grazing * step(-0.1, NdotL));

  // Thicker clouds look brighter; edges and thin veils a touch grey.
  float density = mix(0.75, 1.0, c);
  vec3 col = tint * uSunColor * uSunIntensity * lit * density + uAmbient * 2.0;

  // Edge-on views: clouds thicken towards the limb.
  float limb = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  alpha = clamp(alpha * (1.0 + limb * 0.8), 0.0, 1.0);

  gl_FragColor = vec4(col * alpha, alpha);
}
