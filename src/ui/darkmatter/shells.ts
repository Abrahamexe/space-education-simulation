/**
 * Turns a radial mass profile r²·δ(r) into particle radii: the profile (negative parts counted
 * as empty) is the probability density, and u in [0, 1] maps through its inverse CDF. Each drawn
 * particle keeps its own u, so as the profile changes in time its particle slides smoothly.
 */
export function profileSampler(radii: Float64Array, profile: Float64Array): (u: number) => number {
  const n = radii.length;
  const cdf = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const a = Math.max(0, profile[i - 1]);
    const b = Math.max(0, profile[i]);
    cdf[i] = cdf[i - 1] + 0.5 * (a + b) * (radii[i] - radii[i - 1]);
  }
  const total = cdf[n - 1];
  if (!(total > 0)) return () => 0;
  return (u: number) => {
    const target = Math.min(1, Math.max(0, u)) * total;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid;
      else hi = mid;
    }
    const span = cdf[hi] - cdf[lo];
    const f = span > 0 ? (target - cdf[lo]) / span : 0;
    return radii[lo] + f * (radii[hi] - radii[lo]);
  };
}
