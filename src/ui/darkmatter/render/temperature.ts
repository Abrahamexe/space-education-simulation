/** log10 T -> colour of a gas particle (0–255 RGB stops): cold white-blue, warm violet, hot pink. */
export const T_STOPS: [number, [number, number, number]][] = [
  [4.0, [226, 244, 255]],
  [4.6, [105, 190, 255]],
  [5.3, [172, 140, 255]],
  [6.0, [255, 111, 200]],
  [7.0, [255, 111, 200]],
];

/** Colour (0–1 RGB) for log10 T, linear between the stops and clamped at the ends. */
export function tempColor(logT: number): [number, number, number] {
  let j = 0;
  while (j < T_STOPS.length - 2 && T_STOPS[j + 1][0] < logT) j++;
  const [a, ca] = T_STOPS[j];
  const [b, cb] = T_STOPS[j + 1];
  const w = Math.min(1, Math.max(0, (logT - a) / (b - a)));
  return [0, 1, 2].map((i) => (ca[i] + (cb[i] - ca[i]) * w) / 255) as [number, number, number];
}
