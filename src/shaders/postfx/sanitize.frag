// Scrubs NaN / Inf pixels out of the HDR image before bloom. One bad texel
// otherwise spreads through the bloom mip chain into black squares. Bit test
// on the exponent: isnan() and x != x are folded away by some drivers.

bool bad(vec4 c) {
  uvec4 e = floatBitsToUint(c) & 0x7f800000u;
  return any(equal(e, uvec4(0x7f800000u)));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 c = inputColor;
  if (bad(c)) {
    // Patch the hole from valid neighbours: 8 at 1 px, then 8 at 4 px for a
    // whole bad sprite.
    vec4 sum = vec4(0.0);
    float n = 0.0;
    for (int ring = 0; ring < 2; ring++) {
      float d = ring == 0 ? 1.0 : 4.0;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853982;
        vec4 s = texture2D(inputBuffer, uv + vec2(cos(a), sin(a)) * d * texelSize);
        if (!bad(s)) {
          sum += s;
          n += 1.0;
        }
      }
      if (n > 0.0) break;
    }
    c = n > 0.0 ? sum / n : vec4(0.0, 0.0, 0.0, 1.0);
  }
  // Stay well inside half-float range so later blurs cannot overflow.
  outputColor = clamp(c, vec4(0.0), vec4(3.0e4));
}
