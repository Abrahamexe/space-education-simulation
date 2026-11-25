import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angularDiameterDeg, frameLabel } from '../../src/ui/angular.ts';

test('angular diameter of a sphere seen from its centre distance', () => {
  // Mars (6.792 km across) from 10.000 km: 2·atan(3.396 / 10.000) ≈ 37,5°.
  assert.ok(Math.abs(angularDiameterDeg(6792, 10000) - 37.5) < 0.1);
  // Far away it shrinks like size / distance.
  assert.ok(Math.abs(angularDiameterDeg(1, 57.2958 * 1000) - 0.001) < 1e-5);
  // At or inside the surface: the whole sky.
  assert.equal(angularDiameterDeg(6792, 0), 180);
  assert.equal(angularDiameterDeg(6792, 1000), 180);
});

test('frame label: Turkish decimal comma, arcminutes below a degree', () => {
  assert.equal(frameLabel('Mars', 4.12), 'HEDEF · MARS · 4,1° GÖRÜŞ');
  assert.equal(frameLabel('Ay', 0.52), 'HEDEF · AY · 31′ GÖRÜŞ');
  assert.equal(frameLabel('Jüpiter', 120), 'HEDEF · JÜPİTER · 120° GÖRÜŞ');
});
