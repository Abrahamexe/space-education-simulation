import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planetLook } from '../../src/galaxy/objects/planetLook.ts';

const sun = { tempK: 5772, radiusSun: 1 };
const t1 = { tempK: 2566, radiusSun: 0.1192 };

test('colder rocky planets carry more ice', () => {
  const warm = planetLook({ name: 'a', aAu: 0.9, radiusEarth: 1 }, sun, 'x');
  const cold = planetLook({ name: 'a', aAu: 1.6, radiusEarth: 1 }, sun, 'x');
  assert.ok(cold.teq < warm.teq && cold.ice > warm.ice, `${cold.ice} vs ${warm.ice}`);
});

test('a measured airless planet has no clouds and no glow of air', () => {
  const b = planetLook({ name: 'b', aAu: 0.01154, radiusEarth: 1.116, massEarth: 1.374, atmosphere: 'none' }, t1, 'trappist1');
  assert.equal(b.cloud, 0);
  assert.equal(b.atm, 0);
});

test('low density means a water-rich world with more ocean', () => {
  const dry = planetLook({ name: 'e', aAu: 0.02925, radiusEarth: 0.92, massEarth: 0.92 ** 3 * 1.05 }, t1, 'trappist1');
  const wet = planetLook({ name: 'e', aAu: 0.02925, radiusEarth: 0.92, massEarth: 0.92 ** 3 * 0.8 }, t1, 'trappist1');
  assert.ok(wet.waterRich && !dry.waterRich);
  assert.ok(wet.ocean > dry.ocean);
});

test('the seven TRAPPIST-1 planets all look different', () => {
  const ps = [
    { name: 'b', aAu: 0.01154, radiusEarth: 1.116, massEarth: 1.374, atmosphere: 'none' as const },
    { name: 'c', aAu: 0.0158, radiusEarth: 1.097, massEarth: 1.308, atmosphere: 'thin' as const },
    { name: 'd', aAu: 0.02227, radiusEarth: 0.788, massEarth: 0.388 },
    { name: 'e', aAu: 0.02925, radiusEarth: 0.92, massEarth: 0.692 },
    { name: 'f', aAu: 0.03849, radiusEarth: 1.045, massEarth: 1.039 },
    { name: 'g', aAu: 0.04683, radiusEarth: 1.129, massEarth: 1.321 },
    { name: 'h', aAu: 0.06189, radiusEarth: 0.755, massEarth: 0.326 },
  ];
  const keys = ps.map((p) => {
    const l = planetLook(p, t1, 'trappist1');
    return [l.type, l.ice.toFixed(2), l.ocean.toFixed(2), l.cloud.toFixed(2), l.tint.map((v) => v.toFixed(2)).join()].join('|');
  });
  assert.equal(new Set(keys).size, 7, keys.join('\n'));
});

test('hot rock darkens and reddens with temperature', () => {
  const mild = planetLook({ name: 'x', aAu: 0.25, radiusEarth: 1 }, sun, 's'); // ~500 K
  const hot = planetLook({ name: 'x', aAu: 0.06, radiusEarth: 1 }, sun, 's'); // ~1000 K
  const lum = (t: readonly number[]) => t[0] + t[1] + t[2];
  assert.ok(lum(hot.tint) < lum(mild.tint), `${hot.tint} vs ${mild.tint}`);
});

test('the seed differs between planets of one system and is stable', () => {
  const a = planetLook({ name: 'f', aAu: 0.038, radiusEarth: 1 }, t1, 'trappist1').seed;
  const b = planetLook({ name: 'g', aAu: 0.038, radiusEarth: 1 }, t1, 'trappist1').seed;
  assert.notEqual(a, b);
  assert.equal(a, planetLook({ name: 'f', aAu: 0.038, radiusEarth: 1 }, t1, 'trappist1').seed);
});
