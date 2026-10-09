// Celestial reference lines at infinity: only the camera's rotation is
// applied (like the Milky Way sphere), z = w pins them to the far plane.

attribute vec3 color;
varying vec3 vColor;

void main() {
  vColor = color;
  vec3 viewDir = mat3(viewMatrix) * position;
  vec4 clip = projectionMatrix * vec4(viewDir, 1.0);
  gl_Position = clip.xyww;
}
