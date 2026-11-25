// Background galaxies seen through the clusters: shifted and stretched by the deflection field.
attribute vec4 shape;    // x: size (world), y: axis ratio, z: angle, w: brightness
attribute vec3 tint;

uniform sampler2D uField; // RG: deflection, max |α| = 1
uniform float uHalf;      // field covers [-uHalf, uHalf]² on the sky plane
uniform float uStrength;  // shift for |α| = 1 (world units)
uniform float uScale;

varying mat2 vInv;        // screen-sprite coords -> intrinsic galaxy coords
varying vec3 vTint;
varying float vBright;
varying float vExtent;

vec2 field(vec2 p) {
  vec2 uv = p / (2.0 * uHalf) + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec2(0.0);
  return texture2D(uField, uv).rg;
}

void main() {
  vec2 p = position.xy;
  float h = uHalf / 48.0;
  vec2 a = field(p);
  // Jacobian of the displacement, finite differences.
  vec2 dx = (field(p + vec2(h, 0.0)) - field(p - vec2(h, 0.0))) / (2.0 * h);
  vec2 dy = (field(p + vec2(0.0, h)) - field(p - vec2(0.0, h))) / (2.0 * h);
  mat2 J = uStrength * mat2(dx, dy);
  mat2 A = mat2(1.0) + J;       // image = A · source (stretch along the shear)
  float det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  // Keep the map invertible and the stretch bounded (no caustics in this sketch).
  if (abs(det) < 0.25) A = mat2(1.0);
  float c = cos(shape.z), s = sin(shape.z);
  mat2 R = mat2(c, s, -s, c);
  mat2 E = R * mat2(1.0, 0.0, 0.0, shape.y);  // intrinsic ellipse
  mat2 M = A * E;
  float d2 = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  vInv = mat2(M[1][1], -M[0][1], -M[1][0], M[0][0]) / d2;
  vec3 pos = vec3(p + uStrength * a, position.z);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float depth = max(-mv.z, 1e-3);
  float extent = max(length(M[0]), length(M[1])) * 2.0; // sprite half-width = size · extent / 2
  gl_PointSize = clamp(shape.x * extent * uScale / depth, 1.5, 48.0);
  vExtent = extent;
  vTint = tint;
  vBright = shape.w;
  gl_Position = projectionMatrix * mv;
}
