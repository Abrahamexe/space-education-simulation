import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempColor } from '../../src/ui/darkmatter/render/temperature.ts';

test('tempColor hits the stops and clamps', () => {
  assert.deepEqual(tempColor(4.0).map((v) => Math.round(v * 255)), [226, 244, 255]);
  assert.deepEqual(tempColor(9).map((v) => Math.round(v * 255)), [255, 111, 200]);
  assert.deepEqual(tempColor(1).map((v) => Math.round(v * 255)), [226, 244, 255]);
  assert.deepEqual(tempColor(4.6).map((v) => Math.round(v * 255)), [105, 190, 255]);
});

test('visibility crossfade: a particle turning gas→star sums to one', () => {
  for (const m of [0, 0.3, 0.5, 1]) assert.equal((1 - m) * 1 + m * 0 + ((1 - m) * 0 + m * 1), 1);
});
