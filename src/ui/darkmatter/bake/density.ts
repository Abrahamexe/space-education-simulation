/**
 * Cloud-in-cell density on an n³ grid over the cube [-half, half]³ (cell-centred, the same rule
 * as the 2D splat of the Bullet lab scene). Positions are xyz triplets; densities in mass/volume.
 */
export function cicDensity(pos: Float32Array, from: number, to: number, mass: number, grid: Float32Array, n: number, half: number): void {
  const cell = (2 * half) / n;
  const w = mass / cell ** 3;
  for (let p = from; p < to; p++) {
    const gx = (pos[3 * p] + half) / cell - 0.5;
    const gy = (pos[3 * p + 1] + half) / cell - 0.5;
    const gz = (pos[3 * p + 2] + half) / cell - 0.5;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const k0 = Math.floor(gz);
    if (i0 < -1 || j0 < -1 || k0 < -1 || i0 >= n || j0 >= n || k0 >= n) continue;
    const fx = gx - i0;
    const fy = gy - j0;
    const fz = gz - k0;
    for (let c = 0; c < 2; c++) {
      const k = k0 + c;
      if (k < 0 || k >= n) continue;
      const wz = c ? fz : 1 - fz;
      for (let b = 0; b < 2; b++) {
        const j = j0 + b;
        if (j < 0 || j >= n) continue;
        const wy = b ? fy : 1 - fy;
        for (let a = 0; a < 2; a++) {
          const i = i0 + a;
          if (i < 0 || i >= n) continue;
          grid[(k * n + j) * n + i] += w * wz * wy * (a ? fx : 1 - fx);
        }
      }
    }
  }
}

/** Trilinear sample of a cicDensity grid at (x, y, z); 0 outside the cube. */
export function sampleDensity(grid: Float32Array, n: number, half: number, x: number, y: number, z: number): number {
  if (Math.abs(x) > half || Math.abs(y) > half || Math.abs(z) > half) return 0;
  const cell = (2 * half) / n;
  const gx = Math.min(n - 1, Math.max(0, (x + half) / cell - 0.5));
  const gy = Math.min(n - 1, Math.max(0, (y + half) / cell - 0.5));
  const gz = Math.min(n - 1, Math.max(0, (z + half) / cell - 0.5));
  const i0 = Math.min(n - 2, Math.floor(gx));
  const j0 = Math.min(n - 2, Math.floor(gy));
  const k0 = Math.min(n - 2, Math.floor(gz));
  const fx = gx - i0;
  const fy = gy - j0;
  const fz = gz - k0;
  let s = 0;
  for (let c = 0; c < 2; c++)
    for (let b = 0; b < 2; b++)
      for (let a = 0; a < 2; a++)
        s += grid[((k0 + c) * n + j0 + b) * n + i0 + a] * (c ? fz : 1 - fz) * (b ? fy : 1 - fy) * (a ? fx : 1 - fx);
  return s;
}
