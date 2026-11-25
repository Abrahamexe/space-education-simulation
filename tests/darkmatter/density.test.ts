import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cicDensity, sampleDensity } from '../../src/ui/darkmatter/bake/density.ts';

test('CIC conserves mass inside the box', () => {
  const n = 16, half = 2, grid = new Float32Array(n ** 3);
  const pos = new Float32Array([0, 0, 0, 0.3, -0.7, 1.1, -1.5, 1.5, 0.2]);
  cicDensity(pos, 0, 3, 1e12, grid, n, half);
  const cell = ((2 * half) / n) ** 3;
  assert.ok(Math.abs(grid.reduce((s, v) => s + v, 0) * cell - 3e12) / 3e12 < 1e-5);
});

test('sampled density peaks at a lone particle and is 0 outside', () => {
  const n = 16, half = 2, grid = new Float32Array(n ** 3);
  cicDensity(new Float32Array([0.125, 0.125, 0.125]), 0, 1, 1, grid, n, half);
  assert.ok(sampleDensity(grid, n, half, 0.125, 0.125, 0.125) > sampleDensity(grid, n, half, 0.6, 0.6, 0.6));
  assert.equal(sampleDensity(grid, n, half, 9, 0, 0), 0);
});
