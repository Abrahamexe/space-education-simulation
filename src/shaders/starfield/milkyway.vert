// Milky Way sky sphere — rendered at infinity.
// Only the camera's rotation is applied, so the sky never shows parallax and
// never gets clipped by near/far planes. z = w pins it to the far plane.

varying vec3 vDir;

void main() {
  vDir = position;
  vec3 viewDir = mat3(viewMatrix) * position;
  vec4 clip = projectionMatrix * vec4(viewDir, 1.0);
  gl_Position = clip.xyww;
}
