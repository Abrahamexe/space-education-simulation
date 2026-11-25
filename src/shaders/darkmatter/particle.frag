uniform vec3 uColor;
uniform float uOpacity;
uniform float uSharp;    // Gaussian falloff: 4 soft fog, 12 crisp star

varying float vBright;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 >= 1.0) discard;
  float a = exp(-r2 * uSharp) * (1.0 - r2);
  gl_FragColor = vec4(uColor * (a * uOpacity * max(vBright, 0.0)), 1.0);
}
