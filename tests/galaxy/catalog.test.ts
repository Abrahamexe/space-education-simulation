import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DEEP_SKY } from '../../src/config/deepsky.ts';

const finite = (v: number) => Number.isFinite(v);

test('deep-sky ids are unique', () => {
  const ids = DEEP_SKY.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
});

test('every destination has a valid position and framing', () => {
  for (const d of DEEP_SKY) {
    assert.ok(finite(d.ra) && d.ra >= 0 && d.ra < 360, `${d.id} ra`);
    assert.ok(finite(d.dec) && d.dec >= -90 && d.dec <= 90, `${d.id} dec`);
    assert.ok(finite(d.distPc) && d.distPc > 0, `${d.id} distPc`);
    assert.ok(finite(d.framePc) && d.framePc > 0, `${d.id} framePc`);
    assert.ok(d.facts.text.length > 20, `${d.id} text`);
  }
});

test('nebula pictures exist and have a size', () => {
  for (const d of DEEP_SKY) {
    if (d.kind !== 'nebula') continue;
    assert.ok(d.aspect > 0 && d.widthPc > 0, `${d.id} aspect/width`);
    const dir = `public/textures/${d.folder ?? 'deepsky'}/${d.image}`;
    assert.ok(existsSync(`${dir}_4k.jpg`) && existsSync(`${dir}_1k.jpg`), `${d.id} picture ${dir}`);
  }
});

test('orbits and planets are physical', () => {
  for (const d of DEEP_SKY) {
    if (d.kind !== 'system') continue;
    assert.ok(d.stars.length > 0, `${d.id} stars`);
    for (const s of d.stars) assert.ok(s.massSun > 0 && (s.blackHole || s.pulsar || (s.radiusSun > 0 && s.tempK > 0)), `${d.id} ${s.name}`);
    if (d.orbit) assert.ok(d.orbit.periodYears > 0 && d.orbit.aAu > 0 && d.orbit.e >= 0 && d.orbit.e < 1, `${d.id} orbit`);
    for (const p of d.planets ?? []) assert.ok(p.aAu > 0 && p.periodDays > 0 && p.radiusEarth > 0, `${d.id} ${p.name}`);
  }
});

test('clusters have a size and stars', () => {
  for (const d of DEEP_SKY) if (d.kind === 'cluster') assert.ok(d.scalePc > 0 && d.stars > 0, d.id);
});
