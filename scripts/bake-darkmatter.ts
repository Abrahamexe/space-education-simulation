// Bakes the dark-matter film's Bullet Cluster chapter: runs the lab's BulletSim (sigma/m = 0,
// fixed seed) in Node and writes public/data/darkmatter/bullet.bin (format: src/ui/darkmatter/bake/format.ts).
// Run: npm run bake:dm   (Node >= 23 strips the TypeScript types itself)
import { mkdirSync, writeFileSync } from 'node:fs';
import { BulletSim, COUNTS, DT, T_END } from '../src/ui/lab/scenes/bullet.worker.ts';
import { encodeBake, type BakeHeader } from '../src/ui/darkmatter/bake/format.ts';
import { cicDensity, sampleDensity } from '../src/ui/darkmatter/bake/density.ts';

const EVERY = 8; // steps per saved frame (0.016 Gyr)
const GRID = 64;
const GRID_HALF = 3;

const sim = new BulletSim(0);
const info = sim.ready();
const nGas = COUNTS.gasMain + COUNTS.gasSub;
const times: number[] = [];
const frames: Float32Array[] = [];
const rhos: Float32Array[] = [];

function capture(): void {
  const f = sim.frame(sim.diagnostics());
  const all = new Float32Array(f.dmMain.length + f.dmSub.length + f.gas.length + f.gal.length);
  let o = 0;
  for (const a of [f.dmMain, f.dmSub, f.gas, f.gal]) {
    all.set(a, o);
    o += a.length;
  }
  const grid = new Float32Array(GRID ** 3);
  cicDensity(f.gas, 0, COUNTS.gasMain, info.mGasMain, grid, GRID, GRID_HALF);
  cicDensity(f.gas, COUNTS.gasMain, nGas, info.mGasSub, grid, GRID, GRID_HALF);
  const rho = new Float32Array(nGas);
  for (let i = 0; i < nGas; i++) rho[i] = sampleDensity(grid, GRID, GRID_HALF, f.gas[3 * i], f.gas[3 * i + 1], f.gas[3 * i + 2]);
  times.push(f.t);
  frames.push(all);
  rhos.push(rho);
}

const t0 = performance.now();
capture();
let steps = 0;
while (sim.t < T_END - 1e-9) {
  sim.step(DT);
  if (++steps % EVERY === 0) capture();
}
if (times[times.length - 1] < sim.t - 1e-9) capture();

// Density range: 1st and 99.9th percentile of log10 rho over all frames (zeros ignored).
const logs: number[] = [];
for (const r of rhos) for (const v of r) if (v > 0) logs.push(Math.log10(v));
logs.sort((a, b) => a - b);
const lo = logs[Math.floor(logs.length * 0.01)];
const hi = logs[Math.min(logs.length - 1, Math.floor(logs.length * 0.999))];

const header: BakeHeader = {
  version: 1,
  times,
  groups: [
    { name: 'dmMain', count: COUNTS.dmMain },
    { name: 'dmSub', count: COUNTS.dmSub },
    { name: 'gas', count: nGas },
    { name: 'gal', count: COUNTS.galMain + COUNTS.galSub },
  ],
  half: 5,
  rho: { group: 'gas', lo, hi },
  meta: { sigma: 0, method: 'PM + basit hidro, σ/m = 0', nGasMain: COUNTS.gasMain, mDmMain: info.mDmMain, mDmSub: info.mDmSub, mGasMain: info.mGasMain, mGasSub: info.mGasSub },
};
const bytes = encodeBake(header, frames, rhos);
mkdirSync('public/data/darkmatter', { recursive: true });
writeFileSync('public/data/darkmatter/bullet.bin', bytes);
console.log(`bullet.bin: ${times.length} frames, ${(bytes.length / 1e6).toFixed(2)} MB, t_end ${times[times.length - 1].toFixed(3)} Gyr, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
