import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFT3 } from '../../src/ui/darkmatter/fft.ts';

test('forward then inverse returns n^3 times the input (unnormalised)', () => {
  const n = 8;
  const fft = new FFT3(n);
  const re = Float64Array.from({ length: n ** 3 }, (_, i) => Math.sin(i * 1.7) + (i % 5));
  const im = new Float64Array(n ** 3);
  const r0 = re.slice();
  fft.transform(re, im, false);
  fft.transform(re, im, true);
  const N = n ** 3;
  for (let i = 0; i < re.length; i++) assert.ok(Math.abs(re[i] / N - r0[i]) < 1e-9 && Math.abs(im[i] / N) < 1e-9, `i=${i}`);
});
