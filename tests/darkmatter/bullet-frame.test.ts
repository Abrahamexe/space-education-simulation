import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BulletSim, COUNTS } from '../../src/ui/lab/scenes/bullet.worker.ts';

test('frames carry xyz triplets for every population', () => {
  const s = new BulletSim(0);
  s.step();
  const f = s.frame(s.diagnostics());
  assert.equal(f.dmMain.length, COUNTS.dmMain * 3);
  assert.equal(f.dmSub.length, COUNTS.dmSub * 3);
  assert.equal(f.gas.length, (COUNTS.gasMain + COUNTS.gasSub) * 3);
  assert.equal(f.gal.length, (COUNTS.galMain + COUNTS.galSub) * 3);
  assert.ok(f.dmMain.some((v, i) => i % 3 === 2 && v !== 0), 'z is filled');
});
