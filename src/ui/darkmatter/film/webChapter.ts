import { cosmicAge, fieldsAt, RADII } from '../../lab/scenes/baoModel';
import { makeWeb, positionsAt } from '../cosmicWeb';
import { cicDensity, sampleDensity } from '../bake/density';
import { ParticleLayer } from '../render/ParticleLayer';
import { DM } from '../render/palette';
import { SHELL_COLORS, ShellView } from '../render/ShellView';
import type { Stage } from '../render/Stage';
import type { ChapterRuntime } from './chapters';

/** 1 scene unit = 30 Mpc. */
const SCALE = 1 / 30;
const BOX = 200;
const N = 32;

/** Density grid for the brightness (filaments glow, voids go dark). */
const RHO_N = 48;

/**
 * Time of the shell phase as log10(1+z): quick to the drag epoch (z ≈ 1060, 8 s), slow while the
 * shell freezes and the light leaves (8–12 s), then on to z ≈ 9 by 18 s.
 */
function shellS(t: number): number {
  const lerp = (a: number, b: number, u: number) => a + (b - a) * Math.min(1, Math.max(0, u));
  if (t < 8) return lerp(5, 3.03, t / 8);
  if (t < 12) return lerp(3.03, 2.6, (t - 8) / 4);
  return lerp(2.6, 1, (t - 12) / 6);
}

const ramp = (t: number, a: number, b: number): number => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

function formatAge(years: number): string {
  const sig = (x: number) => x.toLocaleString('tr-TR', { maximumSignificantDigits: 3 });
  if (years < 1e6) return `${sig(years / 1e3)} bin yıl`;
  if (years < 1e9) return `${sig(years / 1e6)} milyon yıl`;
  return `${sig(years / 1e9)} milyar yıl`;
}

/**
 * "The dark web": first the BAO model's sound shell (a picture of its mass profiles, not a
 * simulation), then a Zel'dovich cosmic web in which the dark matter collapses first and the gas,
 * held back by pressure, follows later into the wells.
 */
export async function buildWeb(stage: Stage, overlay: HTMLElement): Promise<ChapterRuntime> {
  const shells = new ShellView(RADII, 3000, SCALE);
  shells.gain = { baryon: 4, photon: 4, dm: 0.5, neutrino: 2 };
  const web = makeWeb({ n: N, box: BOX, seed: 7, gasScale: 4 });
  const count = N ** 3;
  // Sub-cell jitter of the starting points: hides the grid lattice (a display choice).
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const cell = BOX / N;
  for (let i = 0; i < web.q.length; i++) web.q[i] += (rnd() - 0.5) * cell;
  const rhoGrid = new Float32Array(RHO_N ** 3);
  const rhoDm = new Float32Array(count);
  const rhoGas = new Float32Array(count);
  const meanRho = count / BOX ** 3;
  const bufs = [0, 1].map(() => ({ dm: new Float32Array(3 * count), gas: new Float32Array(3 * count) }));
  let flip = 0;
  const dm = new ParticleLayer({ count, color: DM, size: 0.13, opacity: 0, kind: 'dm', scale: SCALE, maxPx: 60 });
  const gas = new ParticleLayer({ count, color: SHELL_COLORS.baryon, size: 0.08, opacity: 0, kind: 'gas', scale: SCALE, maxPx: 40 });
  stage.scene.add(shells.object, dm.points, gas.points);

  overlay.innerHTML = `
    <ul class="dm-legend">
      <li><i style="background:${DM}"></i>Karanlık madde (gerçekte görünmez)</li>
      <li><i style="background:${SHELL_COLORS.baryon}"></i>Normal madde (gaz)</li>
      <li data-photon><i style="background:${SHELL_COLORS.photon}"></i>Işık (fotonlar)</li>
    </ul>
    <span class="dm-clock" data-clock></span>`;
  const clock = overlay.querySelector<HTMLElement>('[data-clock]')!;
  const photonRow = overlay.querySelector<HTMLElement>('[data-photon]')!;
  let lastS = NaN;

  return {
    update(t, dt) {
      // 0–18 s: the sound shell (time as in shellS).
      const shellFade = 1 - ramp(t, 18, 21);
      shells.object.visible = shellFade > 0;
      shells.object.rotation.y += dt * 0.05;
      if (shellFade > 0) {
        const s = shellS(t);
        if (!(Math.abs(s - lastS) <= 1e-3) || shellFade < 1) { // NaN-safe: lastS starts as NaN
          lastS = s;
          shells.set(fieldsAt(10 ** s - 1), shellFade);
        }
        clock.textContent = `Evren ${formatAge(cosmicAge(10 ** s - 1))} yaşında`;
      }
      photonRow.style.opacity = String(shellFade);

      // 18 s on: the web. D grows smoothly; the gas lags behind until ~30 s, then catches up.
      const webIn = ramp(t, 18, 22);
      if (webIn > 0) {
        const D = 0.05 + 1.05 * ramp(t, 20, 44);
        const lag = 0.35 + 0.65 * ramp(t, 22, 32);
        flip ^= 1;
        const b = bufs[flip];
        positionsAt(web, D, D * lag, b.dm, b.gas);
        dm.setFrames(b.dm, b.dm, 0);
        gas.setFrames(b.gas, b.gas, 0);
        // Brightness from the local dark-matter density (both layers sample the same grid).
        rhoGrid.fill(0);
        cicDensity(b.dm, 0, count, 1, rhoGrid, RHO_N, BOX / 2);
        // Brightness ∝ (ρ/ρ̄)²: filaments and knots glow, voids go dark; soft fade near the box faces.
        const edge = (x: number, y: number, z: number) => {
          const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) / (BOX / 2);
          return m < 0.75 ? 1 : Math.max(0, 1 - (m - 0.75) / 0.25);
        };
        for (let i = 0; i < count; i++) {
          const x = b.dm[3 * i], y = b.dm[3 * i + 1], z = b.dm[3 * i + 2];
          const rd = sampleDensity(rhoGrid, RHO_N, BOX / 2, x, y, z) / meanRho;
          rhoDm[i] = rd * rd * edge(x, y, z);
          const gx = b.gas[3 * i], gy = b.gas[3 * i + 1], gz = b.gas[3 * i + 2];
          const rg = sampleDensity(rhoGrid, RHO_N, BOX / 2, gx, gy, gz) / meanRho;
          rhoGas[i] = rg * rg * edge(gx, gy, gz);
        }
        const rd = rhoDm.slice();
        const rg = rhoGas.slice();
        dm.setRho(rd, rd, 6);
        gas.setRho(rg, rg, 6);
        dm.setOpacity(0.12 * webIn);
        gas.setOpacity(0.16 * webIn);
        if (shellFade <= 0) clock.textContent = `Yapılar büyüyor · büyüme çarpanı D = ${D.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } else {
        dm.setOpacity(0);
        gas.setOpacity(0);
      }
    },
    dispose() {
      stage.scene.remove(shells.object, dm.points, gas.points);
      shells.dispose();
      dm.dispose();
      gas.dispose();
      overlay.innerHTML = '';
    },
  };
}
