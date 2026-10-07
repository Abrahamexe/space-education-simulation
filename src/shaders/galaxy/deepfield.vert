// Background sphere at infinity (only the camera's rotation applies).

varying vec3 vDir;

void main() {
  vDir = position;
  vec3 viewDir = mat3(viewMatrix) * position;
  vec4 clip = projectionMatrix * vec4(viewDir, 1.0);
  gl_Position = clip.xyww;
}
