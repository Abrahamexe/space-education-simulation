import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionAt, simTime } from '../../src/ui/darkmatter/film/timeline.ts';

test('captionAt picks the caption whose window holds t', () => {
  const caps = [{ at: 0, until: 5, text: 'a' }, { at: 5, until: 9, text: 'b' }];
  assert.equal(captionAt(caps, 4.99)?.text, 'a');
  assert.equal(captionAt(caps, 5)?.text, 'b');
  assert.equal(captionAt(caps, 9), null);
});

test('simTime maps and clamps', () => {
  assert.equal(simTime(13, [0, 26], [0, 1.2]), 0.6);
  assert.equal(simTime(-3, [0, 26], [0, 1.2]), 0);
  assert.equal(simTime(40, [0, 26], [0, 1.2]), 1.2);
});

test('poseAt eases between keys and holds the ends', async () => {
  const { poseAt } = await import('../../src/ui/darkmatter/film/timeline.ts');
  const keys = [{ at: 0, pos: [0, 0, 10] as [number, number, number] }, { at: 10, pos: [10, 0, 0] as [number, number, number] }];
  assert.deepEqual(poseAt(keys, -1).pos, [0, 0, 10]);
  assert.deepEqual(poseAt(keys, 20).pos, [10, 0, 0]);
  const mid = poseAt(keys, 5).pos;
  assert.ok(Math.abs(mid[0] - 5) < 1e-9 && Math.abs(mid[2] - 5) < 1e-9, 'smoothstep is symmetric at the midpoint');
  assert.ok(poseAt(keys, 1).pos[0] < 1, 'eases in');
  assert.deepEqual(poseAt(keys, 5).target, [0, 0, 0]);
});
