import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three';
import { M33_ROTATION } from '../../../config/universe';
import { ParticleLayer } from '../render/ParticleLayer';
import { DM, STAR } from '../render/palette';
import type { Stage } from '../render/Stage';
import { advance, vAt, vHalo } from '../rotation';
import type { ChapterRuntime } from './chapters';

/** 1 scene unit = 2.5 kpc; 1 film second = 10 Myr. */
const SCALE = 1 / 2.5;
const MYR_PER_S = 10;
/** Each tracer drags a tail covering its last TAIL_MYR of orbit. */
const TAIL_MYR = 80;
const R_MAX = 16;
const RD = 1.8;
const TRACER_R = [4, 8, 12, 16];
const EXPECTED = '#69beff';
const ARC_SEG = 64;

const ramp = (t: number, a: number, b: number): number => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const obs = M33_ROTATION.observed;
const vis = M33_ROTATION.visible;

/** The rotation-curve chart (SVG): x 0–16 kpc, y 0–140 km/s; paths are revealed with dash offsets. */
function chartSvg(): string {
  const W = 300;
  const H = 170;
  const x = (r: number) => 34 + (r / R_MAX) * (W - 44);
  const y = (v: number) => H - 26 - (v / 140) * (H - 40);
  const path = (f: (r: number) => number) => {
    let d = '';
    for (let r = 0; r <= R_MAX + 1e-9; r += 0.25) d += `${d ? 'L' : 'M'}${x(r).toFixed(1)},${y(f(r)).toFixed(1)}`;
    return d;
  };
  const ticksX = [0, 4, 8, 12, 16].map((r) => `<text x="${x(r)}" y="${H - 10}" text-anchor="middle">${r}</text>`).join('');
  const ticksY = [0, 50, 100].map((v) => `<text x="28" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  return `<svg class="dm-rot-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="M33 dönme eğrisi: beklenen, ölçülen ve hale">
    <line x1="34" y1="${H - 26}" x2="${W - 10}" y2="${H - 26}" class="ax"/><line x1="34" y1="${H - 26}" x2="34" y2="12" class="ax"/>
    ${ticksX}${ticksY}<text x="${W - 10}" y="${H - 10}" text-anchor="end" class="lbl">kpc</text><text x="36" y="12" class="lbl">km/s</text>
    <path data-c="vis" d="${path((r) => vAt(vis, r))}" pathLength="1" stroke="${EXPECTED}"/>
    <path data-c="obs" d="${path((r) => vAt(obs, r))}" pathLength="1" stroke="#ffffff"/>
    <path data-c="halo" d="${path((r) => vHalo(vAt(obs, r), vAt(vis, r)))}" pathLength="1" stroke="${DM}"/>
  </svg>
  <ul class="dm-rot-legend"><li><i style="background:#fff"></i>ölçülen</li><li><i style="background:${EXPECTED}"></i>görünen maddeden beklenen</li><li><i style="background:${DM}"></i>gereken hale</li></ul>`;
}

/** "Stars that orbit too fast": M33's measured vs. expected rotation, and the halo that explains it. */
export async function buildRotation(stage: Stage, overlay: HTMLElement): Promise<ChapterRuntime> {
  const r = rng(33);
  // Exponential disc: surface density ∝ e^(−R/Rd) -> R ~ Gamma(2, Rd), cut at 16 kpc.
  const nStars = 9000;
  const R = new Float32Array(nStars);
  const phi = new Float32Array(nStars);
  const zz = new Float32Array(nStars);
  for (let i = 0; i < nStars; i++) {
    let rr = Infinity;
    while (rr > R_MAX) rr = -RD * Math.log(Math.max(1e-9, r()) * Math.max(1e-9, r()));
    R[i] = rr;
    phi[i] = 2 * Math.PI * r();
    zz[i] = 0.3 * Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());
  }
  // Radii never change: each star's angular speed (rad per Myr, from the measured curve) is fixed.
  const omega = new Float32Array(nStars);
  for (let i = 0; i < nStars; i++) omega[i] = advance(0, R[i], vAt(obs, R[i]), 1);
  const starBuf = [new Float32Array(3 * nStars), new Float32Array(3 * nStars)];
  let flip = 0;
  const stars = new ParticleLayer({ count: nStars, color: STAR, size: 0.05, opacity: 0.9, kind: 'star', scale: SCALE });

  // Halo: NFW-like radii (dense centre, long tail) out to ~40 kpc.
  const nHalo = 5000;
  const halo = new ParticleLayer({ count: nHalo, color: DM, size: 2.2, opacity: 0, kind: 'dm', scale: SCALE, maxPx: 56 });
  const hp = new Float32Array(3 * nHalo);
  for (let i = 0; i < nHalo; i++) {
    const rad = 1 + 39 * r() ** 1.8;
    const z = 2 * r() - 1;
    const a = 2 * Math.PI * r();
    const s = Math.sqrt(1 - z * z);
    hp.set([rad * s * Math.cos(a), rad * z, rad * s * Math.sin(a)], 3 * i);
  }
  halo.setFrames(hp, hp, 0);

  // Tracer pairs (measured: white, expected: blue) and their arcs since t = 6 s.
  const tracerObs = new ParticleLayer({ count: TRACER_R.length, color: '#ffffff', size: 0.7, opacity: 3, kind: 'star', scale: SCALE, maxPx: 18 });
  const tracerVis = new ParticleLayer({ count: TRACER_R.length, color: EXPECTED, size: 0.7, opacity: 0, kind: 'star', scale: SCALE, maxPx: 18 });
  const arcs = TRACER_R.flatMap(() =>
    (['#ffffff', EXPECTED] as const).map((c) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(3 * (ARC_SEG + 1)), 3));
      const l = new Line(g, new LineBasicMaterial({ color: c, transparent: true, opacity: 0, depthTest: false }));
      l.scale.setScalar(SCALE);
      l.frustumCulled = false;
      return l;
    }),
  );
  const tObs = new Float32Array(3 * TRACER_R.length);
  const tVis = new Float32Array(3 * TRACER_R.length);
  const angObs = TRACER_R.map(() => 0);
  const angVis = TRACER_R.map(() => 0);
  let split = false;
  let splitMyr = 0;
  let lastT = 0;

  stage.scene.add(halo.points, stars.points, tracerObs.points, tracerVis.points, ...arcs);
  overlay.innerHTML = `
    <ul class="dm-legend">
      <li><i style="background:${STAR}"></i>Yıldızlar (ölçülen hızla dönüyor)</li>
      <li><i style="background:#fff"></i>İz yıldızı: ölçülen hız</li>
      <li><i style="background:${EXPECTED}"></i>İz yıldızı: yalnız görünen maddeye göre</li>
      <li><i style="background:${DM}"></i>Karanlık madde halesi (gerçekte görünmez)</li>
    </ul>
    <span class="dm-clock" data-clock></span>
    <div class="dm-rot">${chartSvg()}</div>`;
  const clock = overlay.querySelector<HTMLElement>('[data-clock]')!;
  const paths = Object.fromEntries([...overlay.querySelectorAll<SVGPathElement>('path[data-c]')].map((p) => [p.dataset.c!, p]));
  let myr = 0;
  const v = new Vector3();

  const arcTo = (line: Line, rad: number, a0: number, a1: number) => {
    const pos = line.geometry.getAttribute('position') as BufferAttribute;
    for (let k = 0; k <= ARC_SEG; k++) {
      const a = a0 + ((a1 - a0) * k) / ARC_SEG;
      v.set(rad * Math.cos(a), 0, rad * Math.sin(a));
      pos.setXYZ(k, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
  };

  return {
    update(t, dt) {
      // Replay from the start: forget the split and the arcs.
      if (t < lastT - 0.5) {
        split = false;
        myr = 0;
      }
      lastT = t;
      const dMyr = dt * MYR_PER_S;
      myr += dMyr;
      clock.textContent = `t = ${Math.round(myr).toLocaleString('tr-TR')} milyon yıl`;
      if (dMyr > 0 || myr === 0) {
        flip ^= 1;
        const sb = starBuf[flip];
        for (let i = 0; i < nStars; i++) {
          phi[i] += omega[i] * dMyr;
          sb[3 * i] = R[i] * Math.cos(phi[i]);
          sb[3 * i + 1] = zz[i];
          sb[3 * i + 2] = R[i] * Math.sin(phi[i]);
        }
        stars.setFrames(sb, sb, 0);
      }

      // From 6 s: both tracers of each pair start together, then run at their own speeds.
      if (t >= 6 && !split) {
        split = true;
        splitMyr = myr;
        for (let k = 0; k < TRACER_R.length; k++) angVis[k] = angObs[k];
      }
      for (let k = 0; k < TRACER_R.length; k++) {
        const rad = TRACER_R[k];
        angObs[k] = advance(angObs[k], rad, vAt(obs, rad), dMyr);
        if (split) angVis[k] = advance(angVis[k], rad, vAt(vis, rad), dMyr);
        tObs.set([rad * Math.cos(angObs[k]), 0, rad * Math.sin(angObs[k])], 3 * k);
        tVis.set([rad * Math.cos(angVis[k]), 0, rad * Math.sin(angVis[k])], 3 * k);
      }
      tracerObs.setFrames(tObs.slice(), tObs.slice(), 0);
      tracerVis.setFrames(tVis.slice(), tVis.slice(), 0);
      tracerVis.setOpacity(split ? 3 : 0);

      // Tails: the last TAIL_MYR of each tracer's orbit (from the split on), so the gap between pairs reads at a glance.
      const arcOn = ramp(t, 6, 8) * (1 - 0.6 * ramp(t, 34, 38));
      for (let k = 0; k < TRACER_R.length; k++) {
        const rad = TRACER_R[k];
        const lo = arcs[2 * k];
        const lv = arcs[2 * k + 1];
        if (!split) {
          (lo.material as LineBasicMaterial).opacity = 0;
          (lv.material as LineBasicMaterial).opacity = 0;
          continue;
        }
        const since = Math.min(TAIL_MYR, myr - splitMyr);
        arcTo(lo, rad, advance(angObs[k], rad, -vAt(obs, rad), since), angObs[k]);
        arcTo(lv, rad, advance(angVis[k], rad, -vAt(vis, rad), since), angVis[k]);
        (lo.material as LineBasicMaterial).opacity = 0.85 * arcOn;
        (lv.material as LineBasicMaterial).opacity = 0.85 * arcOn;
      }

      halo.setOpacity(0.012 * ramp(t, 24, 28));
      halo.points.rotation.y += dt * 0.03;
      paths.vis.style.strokeDashoffset = String(1 - ramp(t, 6, 13));
      paths.obs.style.strokeDashoffset = String(1 - ramp(t, 14, 20));
      paths.halo.style.strokeDashoffset = String(1 - ramp(t, 25, 30));
    },
    dispose() {
      stage.scene.remove(halo.points, stars.points, tracerObs.points, tracerVis.points, ...arcs);
      for (const l of [halo, stars, tracerObs, tracerVis]) l.dispose();
      for (const a of arcs) {
        a.geometry.dispose();
        (a.material as LineBasicMaterial).dispose();
      }
      overlay.innerHTML = '';
    },
  };
}
