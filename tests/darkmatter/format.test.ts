import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBake, encodeBake, groupRange, type BakeHeader } from '../../src/ui/darkmatter/bake/format.ts';

test('round trip keeps positions within quantisation error', () => {
  const h: BakeHeader = { version: 1, times: [0, 0.5], groups: [{ name: 'a', count: 2 }, { name: 'b', count: 1 }], half: 5, rho: { group: 'b', lo: 10, hi: 16 } };
  const f0 = new Float32Array([1, -2, 3, 4.9, 0, -4.9, 0.1, 0.2, 0.3]);
  const f1 = f0.map((v) => -v);
  const baked = decodeBake(encodeBake(h, [f0, f1], [new Float32Array([1e13]), new Float32Array([1e15])]).buffer as ArrayBuffer);
  baked.positions(1).forEach((v, k) => assert.ok(Math.abs(v - f1[k]) <= 5 / 32767 + 1e-6, `pos ${k}`));
  assert.ok(Math.abs(Math.log10(baked.rho(1)![0]) - 15) < 6 / 255 + 1e-6);
  assert.deepEqual(groupRange(baked.header, 'b'), [2, 3]);
});

test('locate clamps and interpolates', () => {
  const baked = decodeBake(encodeBake({ version: 1, times: [0, 1, 2], groups: [{ name: 'a', count: 1 }], half: 1 }, [0, 1, 2].map(() => new Float32Array(3))).buffer as ArrayBuffer);
  assert.deepEqual(baked.locate(-1), { i: 0, j: 0, mix: 0 });
  assert.deepEqual(baked.locate(1.25), { i: 1, j: 2, mix: 0.25 });
  assert.deepEqual(baked.locate(9), { i: 2, j: 2, mix: 0 });
  assert.equal(baked.rho(0), null);
});

test('bad magic throws a Turkish error', () => {
  assert.throws(() => decodeBake(new Uint8Array(16).buffer), /Geçersiz karanlık madde veri dosyası/);
});
