import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RADII, Z_D, fieldsAt, soundHorizon } from '../../src/ui/lab/scenes/baoModel.ts';

const peakR = (p: Float64Array, lo: number, hi: number): number => {
  let best = -Infinity;
  let r = NaN;
  for (let i = 0; i < p.length; i++) if (RADII[i] >= lo && RADII[i] <= hi && p[i] > best) (best = p[i]), (r = RADII[i]);
  return r;
};

test('sound horizon at drag is ~147 Mpc', () => {
  const rs = soundHorizon(Z_D);
  assert.ok(rs > 140 && rs < 155, String(rs));
});

test('the baryon shell sits at the sound horizon at drag', () => {
  const r = peakR(fieldsAt(Z_D).baryon, 20, 220);
  assert.ok(r > 140 && r < 155, String(r));
});

test('today the dark matter carries a local bump near 150 Mpc', () => {
  const dm = fieldsAt(0).dm;
  const r = peakR(dm, 120, 175);
  const i = RADII.indexOf(r);
  assert.ok(r > 125 && r < 170 && dm[i] > dm[i - 10] && dm[i] > dm[i + 10], String(r));
});
