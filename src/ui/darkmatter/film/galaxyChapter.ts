import { decodeBake, groupRange, type Baked } from '../bake/format';
import { ParticleLayer } from '../render/ParticleLayer';
import { DM, STAR } from '../render/palette';
import type { Stage } from '../render/Stage';
import type { ChapterRuntime } from './chapters';
import { simTime } from './timeline';

/** Film seconds over which the simulation plays, and the simulated span (Gyr). */
const FILM: [number, number] = [2, 38];
const SIM: [number, number] = [0, 3];
/** Data are in kpc; drawn at 10 kpc per scene unit. */
const SCALE = 0.1;

const ramp = (t: number, a: number, b: number): number => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** "A galaxy forms in its halo": the baked GalaxySim run, gas coloured by its real temperature. */
export async function buildGalaxy(stage: Stage, overlay: HTMLElement): Promise<ChapterRuntime> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/darkmatter/galaxy.bin`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const baked: Baked = decodeBake(await res.arrayBuffer());
  const h = baked.header;
  const [d0, d1] = groupRange(h, 'dm');
  const [b0, b1] = groupRange(h, 'bar');
  const nBar = b1 - b0;

  type Frame = { dm: Float32Array; bar: Float32Array; gas: Float32Array; star: Float32Array; logT: Float32Array };
  const cache = new Map<number, Frame>();
  const frameAt = (i: number): Frame => {
    let f = cache.get(i);
    if (!f) {
      const raw = baked.positions(i);
      // The disc forms in the simulation's x-y plane: swap y and z so it lies flat in the scene.
      for (let k = 0; k < raw.length; k += 3) {
        const y = raw[k + 1];
        raw[k + 1] = raw[k + 2];
        raw[k + 2] = y;
      }
      const kind = baked.channel('kind', i)!;
      const gas = new Float32Array(nBar);
      const star = new Float32Array(nBar);
      for (let k = 0; k < nBar; k++) {
        const kk = Math.round(kind[k]);
        gas[k] = kk === 1 ? 1 : 0;
        star[k] = kk === 2 ? 1 : 0;
      }
      f = { dm: raw.subarray(3 * d0, 3 * d1), bar: raw.subarray(3 * b0, 3 * b1), gas, star, logT: baked.channel('logT', i)! };
      cache.set(i, f);
      if (cache.size > 4) cache.delete(cache.keys().next().value!);
    }
    return f;
  };

  const dm = new ParticleLayer({ count: d1 - d0, color: DM, size: 0.9, opacity: 0.004, kind: 'dm', scale: SCALE, maxPx: 90 });
  const gas = new ParticleLayer({ count: nBar, color: '#ffffff', size: 0.14, opacity: 0.22, kind: 'gas', scale: SCALE, maxPx: 36 });
  const star = new ParticleLayer({ count: nBar, color: STAR, size: 0.05, opacity: 1.4, kind: 'star', scale: SCALE });
  stage.scene.add(dm.points, gas.points, star.points);

  overlay.innerHTML = `
    <ul class="dm-legend">
      <li><i style="background:${DM}"></i>Karanlık madde (gerçekte görünmez)</li>
      <li><i class="dm-legend-temp"></i>Gaz: soğuk (mavi) → sıcak (pembe)</li>
      <li><i style="background:${STAR}"></i>Yıldızlar</li>
    </ul>
    <span class="dm-clock" data-clock></span>`;
  const clock = overlay.querySelector<HTMLElement>('[data-clock]')!;

  return {
    update(t) {
      const ts = simTime(t, FILM, SIM);
      const { i, j, mix } = baked.locate(ts);
      const a = frameAt(i);
      const b = frameAt(j);
      dm.setFrames(a.dm, b.dm, mix);
      gas.setFrames(a.bar, b.bar, mix);
      gas.setVisibility(a.gas, b.gas);
      gas.setTemperature(a.logT, b.logT);
      star.setFrames(a.bar, b.bar, mix);
      star.setVisibility(a.star, b.star);
      clock.textContent = ts < 1 ? `t = ${Math.round(ts * 1000)} milyon yıl` : `t = ${ts.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} milyar yıl`;
      // 33–36 s: hide the dark matter; 41–44 s: bring part of it back.
      dm.setOpacity(0.004 * (1 - ramp(t, 33, 36) + 0.4 * ramp(t, 41, 44)));
    },
    dispose() {
      stage.scene.remove(dm.points, gas.points, star.points);
      dm.dispose();
      gas.dispose();
      star.dispose();
      overlay.innerHTML = '';
    },
  };
}
