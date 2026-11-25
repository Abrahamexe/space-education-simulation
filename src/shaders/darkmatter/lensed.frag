uniform float uOpacity;

varying mat2 vInv;
varying vec3 vTint;
varying float vBright;
varying float vExtent;

void main() {
  // q = ±1 at the sprite edge = size · extent / 2 in world units; g is in units of the galaxy's size.
  vec2 q = (gl_PointCoord - 0.5) * 2.0;
  q.y = -q.y;
  vec2 g = vInv * q * (0.5 * vExtent);
  float r2 = dot(g, g);
  if (r2 >= 1.0) discard;
  float a = exp(-r2 * 4.0) * (1.0 - r2);
  gl_FragColor = vec4(vTint * (a * vBright * uOpacity), 1.0);
}
