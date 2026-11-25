import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crumbs, routeTo, runRoute, type RouteOps } from '../../src/ui/scalePath.ts';

test('crumbs list every level big to small and mark the current one', () => {
  const c = crumbs('milkyWay');
  assert.deepEqual(c.map((x) => x.level), ['observable', 'web', 'laniakea', 'local', 'milkyWay', 'solar']);
  assert.deepEqual(c.filter((x) => x.current).map((x) => x.level), ['milkyWay']);
  assert.equal(c[0].name, 'Evren');
  assert.equal(c[5].name, 'Güneş Sistemi');
});

test('routes between views', () => {
  assert.deepEqual(routeTo('solar', 'milkyWay'), [{ kind: 'toGalaxy' }]);
  assert.deepEqual(routeTo('solar', 'laniakea'), [{ kind: 'toGalaxy' }, { kind: 'toUniverse' }, { kind: 'scale', id: 'laniakea' }]);
  assert.deepEqual(routeTo('milkyWay', 'solar'), [{ kind: 'toSolar' }]);
  assert.deepEqual(routeTo('milkyWay', 'web'), [{ kind: 'toUniverse' }, { kind: 'scale', id: 'web' }]);
  assert.deepEqual(routeTo('web', 'solar'), [{ kind: 'toGalaxyFromUniverse' }, { kind: 'toSolar' }]);
  assert.deepEqual(routeTo('laniakea', 'local'), [{ kind: 'scale', id: 'local' }]);
  assert.deepEqual(routeTo('local', 'milkyWay'), [{ kind: 'toGalaxyFromUniverse' }]);
  assert.deepEqual(routeTo('solar', 'solar'), []);
});

test('runRoute runs steps in order and stops when cancelled', async () => {
  const log: string[] = [];
  let cancel = false;
  const op = (n: string) => async () => {
    log.push(n);
    if (n === 'toUniverse') cancel = true;
  };
  const ops: RouteOps = {
    toGalaxy: op('toGalaxy'),
    toUniverse: op('toUniverse'),
    toSolar: op('toSolar'),
    toGalaxyFromUniverse: op('back'),
    scale: async (id) => {
      log.push(id);
    },
  };
  await runRoute(routeTo('solar', 'laniakea'), ops, () => cancel);
  assert.deepEqual(log, ['toGalaxy', 'toUniverse']);
});
