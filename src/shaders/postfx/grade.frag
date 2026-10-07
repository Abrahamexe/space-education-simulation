// Exposure + vignette, applied in linear HDR just before tone mapping.
// A camera-like vignette (cos^4 falloff approximation) gently frames the
// scene and keeps attention on the centre of the image.

uniform float uExposure;
uniform float uVignette;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  float r2 = dot(d, d);
  float vig = 1.0 / pow(1.0 + r2 * uVignette, 2.0);
  outputColor = vec4(inputColor.rgb * uExposure * vig, inputColor.a);
}
