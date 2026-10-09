// Scrubs NaN / Inf HDR pixels (first effect of the HDR pass). A bad texel
// becomes black instead of a black square: bloom's luminance pass is guarded
// the same way (PostFX), so nothing spreads through the mip chain. Bit test
// on the exponent: isnan() and x != x are folded away by some drivers.

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  uvec4 e = floatBitsToUint(inputColor) & 0x7f800000u;
  vec4 c = any(equal(e, uvec4(0x7f800000u))) ? vec4(0.0, 0.0, 0.0, 1.0) : inputColor;
  // Stay well inside half-float range so later blurs cannot overflow.
  outputColor = clamp(c, vec4(0.0), vec4(3.0e4));
}
