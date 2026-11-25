import { cosmicAge, fieldsAt, RADII } from '../../lab/scenes/baoModel';
import { makeWeb, positionsAt } from '../cosmicWeb';
import { cicDensity } from '../bake/density';
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
const RHO_EVERY = 6;
/** Largest growth factor reached (end of the chapter). */
const D_MAX = 1.1;

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
  let rhoAge = 0;
  let rhoReady = false;
  const cellInv = RHO_N / BOX;
  /** (ρ/ρ̄)² at each particle from the nearest density cell, faded near the box faces. */
  const shade = (pos: Float32Array, out: Float32Array) => {
    for (let i = 0; i < count; i++) {
      const x = pos[3 * i];
      const y = pos[3 * i + 1];
      const z = pos[3 * i + 2];
      const gx = Math.min(RHO_N - 1, Math.max(0, Math.floor((x + BOX / 2) * cellInv)));
      const gy = Math.min(RHO_N - 1, Math.max(0, Math.floor((y + BOX / 2) * cellInv)));
      const gz = Math.min(RHO_N - 1, Math.max(0, Math.floor((z + BOX / 2) * cellInv)));
      const r = rhoGrid[(gz * RHO_N + gy) * RHO_N + gx] / meanRho;
      const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) / (BOX / 2);
      out[i] = r * r * (m < 0.75 ? 1 : Math.max(0, 1 - (m - 0.75) / 0.25));
    }
  };
  const bufs = [{ dm: new Float32Array(3 * count), gas: new Float32Array(3 * count) }];
  const webStart = web.q.slice();
  const dmEnd = new Float32Array(3 * count);
  const gasEnd = new Float32Array(3 * count);
  for (let i = 0; i < 3 * count; i++) {
    dmEnd[i] = web.q[i] + D_MAX * web.psi[i];
    gasEnd[i] = web.q[i] + D_MAX * web.psiGas[i];
  }
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
        const D = 0.05 + (D_MAX - 0.05) * ramp(t, 20, 44);
        const lag = 0.35 + 0.65 * ramp(t, 22, 32);
        // Zel'dovich positions are linear in D: the GPU blends q -> q + D_MAX·ψ, nothing is uploaded per frame.
        dm.setFrames(webStart, dmEnd, D / D_MAX);
        gas.setFrames(webStart, gasEnd, (D * lag) / D_MAX);
        const b = bufs[0];
        // Brightness from the local dark-matter density (both layers sample the same grid). It changes
        // slowly, so it is refreshed every RHO_EVERY frames and not at all while paused.
        // Brightness ∝ (ρ/ρ̄)² from the dark-matter density: filaments and knots glow, voids go dark,
        // soft fade near the box faces. It changes slowly, so it is refreshed in two slices (dark
        // matter on one frame, gas three frames later) every RHO_EVERY frames, and not while paused.
        const phase = rhoAge++ % RHO_EVERY;
        if ((dt > 0 || !rhoReady) && (phase === 0 || !rhoReady)) {
          positionsAt(web, D, D * lag, b.dm, b.gas);
          rhoGrid.fill(0);
          cicDensity(b.dm, 0, count, 1, rhoGrid, RHO_N, BOX / 2);
          shade(b.dm, rhoDm);
          const rd = rhoDm.slice();
          dm.setRho(rd, rd, 6);
        }
        if ((dt > 0 || !rhoReady) && (phase === 3 || !rhoReady)) {
          shade(b.gas, rhoGas);
          const rg = rhoGas.slice();
          gas.setRho(rg, rg, 6);
        }
        rhoReady = true;
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
