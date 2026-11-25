import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileSampler } from '../../src/ui/darkmatter/shells.ts';

const radii = Float64Array.from({ length: 441 }, (_, i) => i * 0.5);
const gauss = (mu: number, w: number) => Float64Array.from(radii, (r) => Math.exp(-0.5 * ((r - mu) / w) ** 2));

test('the median of a Gaussian shell is its centre', () => {
  const s = profileSampler(radii, gauss(100, 5));
  const r = s(0.5);
  assert.ok(r > 99 && r < 101, String(r));
});

test('the ends stay inside the grid', () => {
  const s = profileSampler(radii, gauss(100, 5));
  for (const u of [0, 1e-9, 1 - 1e-9, 1]) {
    const r = s(u);
    assert.ok(r >= 0 && r <= 220 && Number.isFinite(r), `${u} -> ${r}`);
  }
});

test('an all-zero or negative profile gives 0, never NaN', () => {
  const s = profileSampler(radii, Float64Array.from(radii, () => -1));
  for (const u of [0, 0.5, 1]) assert.equal(s(u), 0);
});

test('negative parts count as empty', () => {
  const p = Float64Array.from(radii, (r) => (r < 50 ? -5 : Math.exp(-0.5 * ((r - 150) / 3) ** 2)));
  const s = profileSampler(radii, p);
  for (const u of [0.01, 0.5, 0.99]) assert.ok(s(u) > 135, String(s(u)));
});
