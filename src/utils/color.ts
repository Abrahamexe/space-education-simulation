import { Color } from 'three';

/**
 * Approximate colour of a black body at `kelvin`, as linear RGB normalised
 * to max channel = 1. Based on Tanner Helland's fit of Mitchell Charity's
 * blackbody table (valid ~1000–40000 K), converted from sRGB to linear.
 */
export function blackbodyLinear(kelvin: number, out = new Color()): Color {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  const clamp = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  out.setRGB(clamp(r), clamp(g), clamp(b)); // sRGB in, converted below
  out.convertSRGBToLinear();
  const m = Math.max(out.r, out.g, out.b) || 1;
  return out.setRGB(out.r / m, out.g / m, out.b / m);
}

/** Mix a colour towards its luminance (0 = grey, 1 = unchanged). */
export function saturate(c: Color, amount: number): Color {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return c.setRGB(l + (c.r - l) * amount, l + (c.g - l) * amount, l + (c.b - l) * amount);
}
