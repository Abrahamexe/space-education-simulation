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

test('channels round trip per group and frame', () => {
  const h: BakeHeader = { version: 1, times: [0, 1], groups: [{ name: 'a', count: 1 }, { name: 'b', count: 2 }], half: 1, channels: [{ name: 'kind', group: 'b', lo: 0, hi: 2 }, { name: 'logT', group: 'b', lo: 4, hi: 7 }] };
  const f = [new Float32Array(9), new Float32Array(9)];
  const ch = { kind: [new Float32Array([1, 1]), new Float32Array([1, 2])], logT: [new Float32Array([4, 7]), new Float32Array([5.5, 4])] };
  const d = decodeBake(encodeBake(h, f, undefined, ch).buffer as ArrayBuffer);
  assert.deepEqual(Array.from(d.channel('kind', 1)!, Math.round), [1, 2]); // integer channels are read with rounding
  assert.ok(Math.abs(d.channel('logT', 1)![0] - 5.5) < 3 / 255 + 1e-6);
  assert.equal(d.channel('nope', 0), null);
});

test('files without channels still decode, with rho and channels together', () => {
  const h: BakeHeader = { version: 1, times: [0], groups: [{ name: 'a', count: 2 }], half: 2, rho: { group: 'a', lo: 0, hi: 2 } };
  const d = decodeBake(encodeBake(h, [new Float32Array([1, 0, 0, 0, 1, 0])], [new Float32Array([10, 100])]).buffer as ArrayBuffer);
  assert.equal(d.channel('kind', 0), null);
  assert.ok(Math.abs(d.positions(0)[4] - 1) < 1e-3);
  const h2: BakeHeader = { ...h, channels: [{ name: 'k', group: 'a', lo: 0, hi: 1 }] };
  const d2 = decodeBake(encodeBake(h2, [new Float32Array(6)], [new Float32Array([10, 100])], { k: [new Float32Array([0, 1])] }).buffer as ArrayBuffer);
  assert.ok(Math.abs(d2.rho(0)![1] - 100) < 3);
  assert.deepEqual(Array.from(d2.channel('k', 0)!, Math.round), [0, 1]);
});
