// Bakes the dark-matter film's chapters by running the lab simulations in Node:
//   bullet  BulletSim (sigma/m = 0, fixed seed)          -> public/data/darkmatter/bullet.bin
//   galaxy  GalaxySim (12 000 DM + 10 000 gas particles) -> public/data/darkmatter/galaxy.bin
// Format: src/ui/darkmatter/bake/format.ts.
// Run: npm run bake:dm [-- bullet|galaxy]   (Node >= 23 strips the TypeScript types itself)
import { mkdirSync, writeFileSync } from 'node:fs';
import { BulletSim, COUNTS, DT, T_END } from '../src/ui/lab/scenes/bullet.worker.ts';
import { encodeBake, type BakeHeader } from '../src/ui/darkmatter/bake/format.ts';
import { cicDensity, sampleDensity } from '../src/ui/darkmatter/bake/density.ts';
import { GalaxySim } from '../src/ui/lab/scenes/galaxy.worker.ts';

function bakeBullet(): void {
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
}

/** Frame times (Gyr): dense while the gas collapses, sparser once the disc has settled. */
function galaxyTimes(): number[] {
  const t: number[] = [];
  for (let x = 0; x < 0.6 - 1e-9; x += 0.015) t.push(+x.toFixed(4));
  for (let x = 0.6; x <= 3 + 1e-9; x += 0.04) t.push(+x.toFixed(4));
  return t;
}

function bakeGalaxy(): void {
  const nDm = 12000;
  const nGas = 10000;
  const sim = new GalaxySim({ nDm, nGas });
  const times = galaxyTimes();
  const frames: Float32Array[] = [];
  const kinds: Float32Array[] = [];
  const temps: Float32Array[] = [];
  const t0 = performance.now();
  let lastLog = 0;
  for (const target of times) {
    while (sim.t < target - 1e-9) sim.step();
    const s = sim.snapshot();
    // Dark matter first, then the baryons (gas and stars) in their fixed order.
    const pos = new Float32Array((nDm + nGas) * 3);
    const kind = new Float32Array(nGas);
    const logT = new Float32Array(nGas);
    let d = 0;
    let b = 0;
    for (let i = 0; i < s.kind.length; i++) {
      const k = s.kind[i] === 0 ? d++ : nDm + b++;
      pos[3 * k] = s.px[i];
      pos[3 * k + 1] = s.py[i];
      pos[3 * k + 2] = s.pz[i];
      if (s.kind[i] !== 0) {
        kind[k - nDm] = s.kind[i];
        logT[k - nDm] = s.kind[i] === 1 ? s.logT[i] : 4;
      }
    }
    frames.push(pos);
    kinds.push(kind);
    temps.push(logT);
    if (sim.t - lastLog >= 0.1) {
      lastLog = sim.t;
      console.log(`  t = ${sim.t.toFixed(2)} Gyr, stars ${sim.stats().nStars}, ${((performance.now() - t0) / 60000).toFixed(1)} min`);
    }
  }
  // Did a disc form? Cold gas thickness vs. extent in the last frame.
  const last = frames[frames.length - 1];
  const zs: number[] = [];
  const rs: number[] = [];
  for (let k = 0; k < nGas; k++) {
    if (kinds[kinds.length - 1][k] !== 1 || temps[temps.length - 1][k] > 4.5) continue;
    const i = nDm + k;
    zs.push(Math.abs(last[3 * i + 2]));
    rs.push(Math.hypot(last[3 * i], last[3 * i + 1]));
  }
  const med = (a: number[]) => (a.sort((x, y) => x - y), a[Math.floor(a.length / 2)] ?? NaN);
  const header: BakeHeader = {
    version: 1,
    times,
    groups: [{ name: 'dm', count: nDm }, { name: 'bar', count: nGas }],
    half: 260,
    channels: [
      { name: 'kind', group: 'bar', lo: 0, hi: 2 },
      { name: 'logT', group: 'bar', lo: 4, hi: 7 },
    ],
    meta: { method: 'Barnes-Hut + SPH, soğuma, yıldız oluşumu, süpernova', nDm, nGas },
  };
  const bytes = encodeBake(header, frames, undefined, { kind: kinds, logT: temps });
  mkdirSync('public/data/darkmatter', { recursive: true });
  writeFileSync('public/data/darkmatter/galaxy.bin', bytes);
  console.log(`galaxy.bin: ${times.length} frames, ${(bytes.length / 1e6).toFixed(2)} MB, stars ${sim.stats().nStars}, cold gas |z| median ${med(zs).toFixed(2)} kpc vs R median ${med(rs).toFixed(2)} kpc, ${((performance.now() - t0) / 60000).toFixed(1)} min`);
}

const which = process.argv[2];
if (!which || which === 'bullet') bakeBullet();
if (!which || which === 'galaxy') bakeGalaxy();
