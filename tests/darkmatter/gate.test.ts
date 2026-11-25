import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindMainRender, holdMainRender, mainQuality } from '../../src/ui/darkmatter/gate.ts';

function fake(running: boolean) {
  const log: string[] = [];
  let r = running;
  return {
    log,
    t: {
      start() { r = true; log.push('start'); },
      stop() { r = false; log.push('stop'); },
      isRunning: () => r,
      level: () => 'high' as const,
    },
  };
}

test('hold stops a running engine and release restarts it', () => {
  const f = fake(true);
  bindMainRender(f.t);
  const release = holdMainRender();
  release();
  assert.deepEqual(f.log, ['stop', 'start']);
});

test('nested holds restart only after the last release', () => {
  const f = fake(true);
  bindMainRender(f.t);
  const a = holdMainRender();
  const b = holdMainRender();
  a();
  assert.deepEqual(f.log, ['stop']);
  b();
  assert.deepEqual(f.log, ['stop', 'start']);
});

test('an engine that was already stopped is not started on release', () => {
  const f = fake(false);
  bindMainRender(f.t);
  holdMainRender()();
  assert.deepEqual(f.log, []);
});

test('double release is harmless', () => {
  const f = fake(true);
  bindMainRender(f.t);
  const a = holdMainRender();
  const b = holdMainRender();
  a();
  a();
  assert.deepEqual(f.log, ['stop']);
  b();
  assert.deepEqual(f.log, ['stop', 'start']);
});

test('quality comes from the bound target', () => {
  bindMainRender(fake(true).t);
  assert.equal(mainQuality(), 'high');
});
