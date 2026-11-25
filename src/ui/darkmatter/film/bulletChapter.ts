import { Vector3 } from 'three';
import { decodeBake, groupRange, type Baked } from '../bake/format';
import { deflectionField, projectSigma } from '../lensing';
import { LensedBackground } from '../render/LensedBackground';
import { ParticleLayer } from '../render/ParticleLayer';
import { DM, GAS, STAR } from '../render/palette';
import type { Stage } from '../render/Stage';
import type { ChapterRuntime } from './chapters';
import { simTime } from './timeline';

/** Film seconds over which the simulation plays, and the simulated span (Gyr). */
const FILM: [number, number] = [2, 28];
const SIM: [number, number] = [0, 1.2];
const LENS_N = 48;
const LENS_HALF = 3;
const LENS_EVERY = 0.05;

const ramp = (t: number, a: number, b: number): number => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

const P = new Vector3();

export async function buildBullet(stage: Stage, overlay: HTMLElement): Promise<ChapterRuntime> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/darkmatter/bullet.bin`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const baked: Baked = decodeBake(await res.arrayBuffer());
  const h = baked.header;
  const meta = h.meta as Record<string, number>;
  const [dm0, dm1] = [groupRange(h, 'dmMain')[0], groupRange(h, 'dmSub')[1]];
  const [g0, g1] = groupRange(h, 'gas');
  const [s0, s1] = groupRange(h, 'gal');
  const [sub0, sub1] = groupRange(h, 'dmSub');
  const nGasMain = meta.nGasMain;

  // Decoded frames, few at a time (two are in use per frame).
  const cache = new Map<number, { pos: Float32Array; rho: Float32Array }>();
  const frameAt = (i: number) => {
    let f = cache.get(i);
    if (!f) {
      f = { pos: baked.positions(i), rho: baked.rho(i)! };
      cache.set(i, f);
      if (cache.size > 4) cache.delete(cache.keys().next().value!);
    }
    return f;
  };
  const view = (f: { pos: Float32Array }, a: number, b: number) => f.pos.subarray(3 * a, 3 * b);
  // Stable views per cached frame so the layers upload only when the frame changes.
  const views = new WeakMap<Float32Array, { dm: Float32Array; gas: Float32Array; gal: Float32Array }>();
  const viewsOf = (f: { pos: Float32Array }) => {
    let v = views.get(f.pos);
    if (!v) {
      v = { dm: view(f, dm0, dm1), gas: view(f, g0, g1), gal: view(f, s0, s1) };
      views.set(f.pos, v);
    }
    return v;
  };

  const dm = new ParticleLayer({ count: dm1 - dm0, color: DM, size: 0.42, opacity: 0.004, kind: 'dm' });
  const gas = new ParticleLayer({ count: g1 - g0, color: GAS, size: 0.2, opacity: 0.16, kind: 'gas' });
  const gal = new ParticleLayer({ count: s1 - s0, color: STAR, size: 0.025, opacity: 2.2, kind: 'star' });
  const lensed = new LensedBackground({ count: 5000, seed: 7, half: LENS_HALF, depth: 5 });
  lensed.setStrength(0.12);
  stage.scene.add(lensed.object, dm.points, gas.points, gal.points);
  const rho0 = Array.from(frameAt(0).rho).sort((a, b) => a - b);
  const rhoRef = rho0[Math.floor(rho0.length * 0.99)];
  let lensT = -Infinity;

  overlay.innerHTML = `
    <ul class="dm-legend">
      <li><i style="background:${DM}"></i>Karanlık madde (gerçekte görünmez)</li>
      <li><i style="background:${GAS}"></i>Sıcak gaz: X-ışını parlaklığı</li>
      <li><i style="background:${STAR}"></i>Galaksiler</li>
    </ul>
    <span class="dm-clock" data-clock></span>
    <span class="dm-tag" data-tag="mass">Kütle burada (mercekten)</span>
    <span class="dm-tag dm-tag-gas" data-tag="gas">Gaz burada (X-ışını)</span>`;
  const clock = overlay.querySelector<HTMLElement>('[data-clock]')!;
  const tagMass = overlay.querySelector<HTMLElement>('[data-tag="mass"]')!;
  const tagGas = overlay.querySelector<HTMLElement>('[data-tag="gas"]')!;

  /**
   * Weighted mean position of particles [from, to) in a frame blend. Weights (e.g. gas ρ² for the
   * X-ray peak) are indexed from `from`; without them every particle counts once.
   */
  const centroid = (a: Float32Array, b: Float32Array, mix: number, from: number, to: number, out: Vector3, w?: Float32Array) => {
    out.set(0, 0, 0);
    let sum = 0;
    for (let i = from; i < to; i++) {
      const k = w ? w[i - from] : 1;
      out.x += k * (a[3 * i] + (b[3 * i] - a[3 * i]) * mix);
      out.y += k * (a[3 * i + 1] + (b[3 * i + 1] - a[3 * i + 1]) * mix);
      out.z += k * (a[3 * i + 2] + (b[3 * i + 2] - a[3 * i + 2]) * mix);
      sum += k;
    }
    return out.multiplyScalar(1 / Math.max(1e-30, sum));
  };
  const place = (el: HTMLElement, p: Vector3, show: number) => {
    P.copy(p).project(stage.camera);
    const w = overlay.clientWidth;
    const hh = overlay.clientHeight;
    el.style.transform = `translate(${((P.x + 1) / 2) * w}px, ${((1 - P.y) / 2) * hh}px)`;
    el.style.opacity = String(show);
  };
  const pm = new Vector3();
  const pg = new Vector3();
  let xray: Float32Array | undefined;

  return {
    update(t) {
      const ts = simTime(t, FILM, SIM);
      const { i, j, mix } = baked.locate(ts);
      const a = frameAt(i);
      const b = frameAt(j);
      const va = viewsOf(a);
      const vb = viewsOf(b);
      dm.setFrames(va.dm, vb.dm, mix);
      gas.setFrames(va.gas, vb.gas, mix);
      gas.setRho(a.rho, b.rho, rhoRef);
      gal.setFrames(va.gal, vb.gal, mix);
      clock.textContent = `t = ${ts.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} milyar yıl`;

      // 26–33 s: dark matter fades (it is invisible), the lensed background takes over.
      dm.setOpacity(0.004 * (1 - 0.85 * ramp(t, 26, 31)));
      lensed.setOpacity(ramp(t, 25, 30));
      const fi = Math.round(i + mix);
      if (Math.abs(h.times[fi] - lensT) >= LENS_EVERY - 1e-9) {
        lensT = h.times[fi];
        const f = frameAt(fi);
        const s = projectSigma(f.pos, [
          { from: 0, to: sub0, mass: meta.mDmMain },
          { from: sub0, to: sub1, mass: meta.mDmSub },
          { from: g0, to: g0 + nGasMain, mass: meta.mGasMain },
          { from: g0 + nGasMain, to: g1, mass: meta.mGasSub },
        ], LENS_N, LENS_HALF);
        lensed.setField(deflectionField(s, LENS_N, LENS_HALF, 0.08), LENS_N, LENS_HALF);
      }

      // 33 s on: where the bullet's mass is and where its gas is.
      const show = ramp(t, 33, 34.5);
      if (show > 0) {
        place(tagMass, centroid(a.pos, b.pos, mix, sub0, sub1, pm), show);
        // X-ray peak of the bullet's gas: weight by ρ² of the nearer frame.
        const r = (mix < 0.5 ? a : b).rho.subarray(nGasMain);
        const w2 = (xray ??= new Float32Array(r.length));
        for (let k = 0; k < r.length; k++) w2[k] = r[k] * r[k];
        place(tagGas, centroid(a.pos, b.pos, mix, g0 + nGasMain, g1, pg, w2), show);
      } else {
        tagMass.style.opacity = tagGas.style.opacity = '0';
      }
    },
    dispose() {
      stage.scene.remove(lensed.object, dm.points, gas.points, gal.points);
      dm.dispose();
      gas.dispose();
      gal.dispose();
      lensed.dispose();
      overlay.innerHTML = '';
    },
  };
}
