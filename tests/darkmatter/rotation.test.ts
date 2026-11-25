import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, vAt, vHalo } from '../../src/ui/darkmatter/rotation.ts';

const obs = [[0.5, 38], [1, 55], [2, 75], [3, 88], [4, 96], [5, 102], [6, 107], [8, 112], [10, 117], [12, 121], [14, 124], [16, 126]] as const;

test('vAt interpolates, starts at 0 and stays flat past the data', () => {
  assert.equal(vAt(obs, 4), 96);
  assert.equal(vAt(obs, 7), 109.5);
  assert.equal(vAt(obs, 0), 0);
  assert.equal(vAt(obs, 0.25), 19);
  assert.equal(vAt(obs, 30), 126);
  assert.equal(vAt(obs, -1), 0);
});

test('vHalo never goes imaginary', () => {
  assert.equal(vHalo(50, 60), 0);
  assert.ok(Math.abs(vHalo(126, 44) - Math.sqrt(126 ** 2 - 44 ** 2)) < 1e-9);
});

test('advance turns km/s and Myr into radians', () => {
  assert.ok(Math.abs(advance(0, 8, 112, 100) - (112 * 1.0227e-3 * 100) / 8) < 1e-9);
  assert.equal(advance(1, 0, 100, 10), 1);
});
