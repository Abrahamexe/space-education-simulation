import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflectionField, projectSigma } from '../../src/ui/darkmatter/lensing.ts';

test('a point mass deflects toward itself with |α|·r ~ const', () => {
  const n = 32, half = 4, sigma = new Float32Array(n * n);
  sigma[(n / 2) * n + n / 2] = 1;
  const a = deflectionField(sigma, n, half, 0.05);
  const cell = (2 * half) / n, c = n / 2 + 0.5;
  const probe = (i: number, j: number) => {
    const k = 2 * (j * n + i), dx = i + 0.5 - c, dy = j + 0.5 - c;
    return { dot: a[k] * dx + a[k + 1] * dy, mag: Math.hypot(a[k], a[k + 1]), r: Math.hypot(dx, dy) * cell };
  };
  const p1 = probe(n / 2 + 4, n / 2), p2 = probe(n / 2 + 10, n / 2);
  assert.ok(p1.dot < 0 && p2.dot < 0, 'points toward the mass');
  assert.ok(Math.abs(p1.mag * p1.r - p2.mag * p2.r) / (p1.mag * p1.r) < 0.1);
});

test('projected sigma conserves mass', () => {
  const n = 16, half = 2;
  const pos = new Float32Array([0, 0, 1, 0.5, -0.5, -1, -1.2, 1.3, 0]);
  const s = projectSigma(pos, [{ from: 0, to: 2, mass: 2 }, { from: 2, to: 3, mass: 5 }], n, half);
  const area = ((2 * half) / n) ** 2;
  assert.ok(Math.abs(s.reduce((a, v) => a + v, 0) * area - 9) / 9 < 1e-5);
});

test('an empty map gives a zero field without NaN', () => {
  const a = deflectionField(new Float32Array(64), 8, 1, 0.1);
  assert.ok(a.every((v) => v === 0));
});
