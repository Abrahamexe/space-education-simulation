import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeAlpha } from '../../src/galaxy/objects/edgeMask.ts';

const N = 64;
function image(blob: boolean, sky = [0.02, 0.015, 0.01]): Float32Array {
  const a = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const d = Math.hypot(i - N / 2, j - N / 2) / (N * 0.18);
      const v = blob ? Math.exp(-d * d) * 0.8 : 0;
      a[3 * k] = sky[0] + v;
      a[3 * k + 1] = sky[1] + v * 0.6;
      a[3 * k + 2] = sky[2] + v * 0.9;
    }
  return a;
}

test('sky around a central object fades out, the object stays', () => {
  const { alpha } = edgeAlpha(image(true), N);
  assert.ok(alpha[0] < 0.02 && alpha[N - 1] < 0.02 && alpha[N * N - 1] < 0.02, 'corners');
  assert.ok(alpha[(N / 2) * N + N / 2] > 0.5, 'centre');
});

test('the picture border is always faded', () => {
  const { alpha } = edgeAlpha(image(true), N);
  for (let i = 0; i < N; i++) for (const k of [i, (N - 1) * N + i, i * N, i * N + N - 1]) assert.ok(alpha[k] < 0.05, `border ${k}`);
});

test('the sky colour is measured from the dark part', () => {
  const { sky } = edgeAlpha(image(true), N);
  assert.ok(Math.abs(sky[0] - 0.02) < 0.001 && Math.abs(sky[1] - 0.015) < 0.001 && Math.abs(sky[2] - 0.01) < 0.001, sky.join());
});

test('a flat picture gives finite alpha', () => {
  const { alpha, sky } = edgeAlpha(image(false), N);
  assert.ok(alpha.every(Number.isFinite) && sky.every(Number.isFinite));
});
