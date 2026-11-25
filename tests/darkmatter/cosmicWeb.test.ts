import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWeb, positionsAt } from '../../src/ui/darkmatter/cosmicWeb.ts';

const opts = { n: 16, box: 300, seed: 3, gasScale: 4 };
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

/** Variance of particle counts in 8³ cells. */
function cellVariance(pos: Float32Array, box: number): number {
  const c = 8;
  const counts = new Float64Array(c ** 3);
  for (let i = 0; i < pos.length; i += 3) {
    const f = (v: number) => Math.min(c - 1, Math.floor(((v / box + 0.5) % 1 + 1) % 1 * c));
    counts[(f(pos[i]) * c + f(pos[i + 1])) * c + f(pos[i + 2])]++;
  }
  const mean = pos.length / 3 / counts.length;
  return counts.reduce((s, v) => s + (v - mean) ** 2, 0) / counts.length;
}

test('the displacement field has zero mean', () => {
  const w = makeWeb(opts);
  for (let a = 0; a < 3; a++) {
    let s = 0;
    for (let i = a; i < w.psi.length; i += 3) s += w.psi[i];
    assert.ok(Math.abs(s / (w.psi.length / 3)) < 1e-6 * rms(w.psi) + 1e-9);
  }
});

test('at D = 0 the particles sit on the grid', () => {
  const w = makeWeb(opts);
  const out = new Float32Array(w.q.length);
  const gas = new Float32Array(w.q.length);
  positionsAt(w, 0, 0, out, gas);
  assert.deepEqual(Array.from(out), Array.from(w.q));
});

test('clustering grows with D', () => {
  const w = makeWeb(opts);
  const out = new Float32Array(w.q.length);
  const gas = new Float32Array(w.q.length);
  const v = [0.5, 1, 2].map((D) => (positionsAt(w, D, D, out, gas), cellVariance(out, w.box)));
  assert.ok(v[0] < v[1] && v[1] < v[2], v.join(' '));
});

test('gas displacement is smoother than the dark matter one', () => {
  const w = makeWeb(opts);
  assert.ok(rms(w.psiGas) < rms(w.psi));
});

test('the same seed gives the same web', () => {
  assert.deepEqual(Array.from(makeWeb(opts).psi.slice(0, 30)), Array.from(makeWeb(opts).psi.slice(0, 30)));
});

test('n = 32 builds in under half a second', () => {
  const t0 = performance.now();
  makeWeb({ ...opts, n: 32 });
  const ms = performance.now() - t0;
  console.log(`makeWeb n=32: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 500);
});
