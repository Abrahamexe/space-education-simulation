import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equilibriumK, planetType } from '../../src/galaxy/objects/exoplanetType.ts';

const sun = { tempK: 5772, radiusSun: 1 };

test('Earth comes out near 255 K and temperate', () => {
  const t = equilibriumK(5772, 1, 1);
  assert.ok(Math.abs(t - 255) < 3, String(t));
  assert.equal(planetType({ aAu: 1, radiusEarth: 1 }, sun), 'temperate');
});

test('51 Pegasi b is a hot Jupiter', () => {
  assert.equal(planetType({ aAu: 0.0527, radiusEarth: 13 }, { tempK: 5768, radiusSun: 1.27 }), 'hotJupiter');
});

test('a cool giant is a banded giant', () => {
  assert.equal(planetType({ aAu: 5.2, radiusEarth: 11.2 }, sun), 'giant');
});

test('TOI-700 c is a sub-Neptune', () => {
  assert.equal(planetType({ aAu: 0.0925, radiusEarth: 2.65 }, { tempK: 3480, radiusSun: 0.42 }), 'subNeptune');
});

test('TRAPPIST-1 e is a tidally locked eyeball world, b a hot barren rock', () => {
  const t1 = { tempK: 2566, radiusSun: 0.1192 };
  assert.equal(planetType({ aAu: 0.02925, radiusEarth: 0.92 }, t1), 'eyeball');
  assert.equal(planetType({ aAu: 0.01154, radiusEarth: 1.116 }, t1), 'barren');
});

test('Kepler-186 f is temperate (far enough not to be locked)', () => {
  assert.equal(planetType({ aAu: 0.432, radiusEarth: 1.17 }, { tempK: 3755, radiusSun: 0.523 }), 'temperate');
});

test('very close rocky planets are lava worlds, far ones icy', () => {
  assert.equal(planetType({ aAu: 0.015, radiusEarth: 1.5 }, sun), 'lava');
  assert.equal(planetType({ aAu: 5, radiusEarth: 1 }, sun), 'icy');
});
