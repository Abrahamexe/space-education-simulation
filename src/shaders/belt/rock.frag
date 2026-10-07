// Belt rocks — regolith lighting from the Sun with a soft terminator.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_planet>

varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vColor;

void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunPosW - vPosW);
  vec3 V = normalize(cameraPosition - vPosW);
  float light = regolith(dot(N, L), dot(N, V), 0.6) * softTerminator(dot(N, L), 0.05);
  vec3 col = vColor * (uSunColor * uSunIntensity * light + uAmbient * 2.0);
  gl_FragColor = vec4(col, 1.0);
}
