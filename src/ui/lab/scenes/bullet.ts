import './bullet.css';
import { BufferGeometry, Float32BufferAttribute, GridHelper, LineBasicMaterial, LineSegments } from 'three';
import { Stage } from '../../darkmatter/render/Stage';
import { ParticleLayer } from '../../darkmatter/render/ParticleLayer';
import { LensedBackground } from '../../darkmatter/render/LensedBackground';
import { deflectionField, projectSigma } from '../../darkmatter/lensing';
import { DM, GAS, STAR } from '../../darkmatter/render/palette';
import { cicDensity, sampleDensity } from '../../darkmatter/bake/density';
import { COUNTS, type BulletDiag, type BulletFrame, type BulletReady, type FromWorker, type ToWorker } from './bullet.worker';

/**
 * Lab scene: a Bullet Cluster (1E 0657-56) style collision of two galaxy clusters. The physics runs
 * in bullet.worker.ts (PM gravity, simplified gas, Monte Carlo self-interacting dark matter); this
 * file draws the clusters in 3D (dark-matter Stage) and explains what the offsets mean.
 */

/** Allowed sigma/m values, cm^2/g (slider steps). */
const SIGMAS = [0, 0.1, 0.3, 1, 3, 10];

// Total-mass map on the sky plane (x, y) for the lensing contours: 5.6 Mpc wide, centred on the origin.
const GW = 115;
const GH = 75;
const VIEW_W = 5.6;
const CELL = VIEW_W / GW; // Mpc per map cell
const X0 = -VIEW_W / 2;
const Y0 = (-GH * CELL) / 2;

/** Wall-clock time between worker frames (bullet.worker STEP_MS): the GPU blends across it. */
const STEP_MS = 66;
/** Gas density grid for the per-particle X-ray brightness (same as the film bake). */
const RHO_N = 64;
const RHO_HALF = 3;
/** Lensing field: n×n cells over ±LENS_HALF Mpc, refreshed every LENS_EVERY Gyr; drawn shift for |α| = 1. */
const LENS_N = 48;
const LENS_HALF = 3;
const LENS_EVERY = 0.05;
const LENS_SHIFT = 0.12;

/** Contour levels of the total (lensing) mass map, as fractions of the initial main-cluster peak. */
const CONTOUR_LEVELS = [0.06, 0.12, 0.25, 0.5];

const num = (v: number, d = 0): string => v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });

function sigmaText(s: number): string {
  return s === 0 ? '0 (çarpışmasız)' : `${num(s, s < 1 ? 1 : 0)} cm²/g`;
}

/** Cloud-in-cell splat of (x, y) pairs onto the map grid, weight w per particle. */
function splat(grid: Float32Array, pts: Float32Array, from: number, to: number, w: number): void {
  for (let i = from; i < to; i++) {
    const gx = (pts[3 * i] - X0) / CELL - 0.5;
    const gy = (pts[3 * i + 1] - Y0) / CELL - 0.5;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    if (i0 < -1 || j0 < -1 || i0 >= GW || j0 >= GH) continue;
    const fx = gx - i0;
    const fy = gy - j0;
    for (let b = 0; b < 2; b++) {
      const j = j0 + b;
      if (j < 0 || j >= GH) continue;
      const wy = b ? fy : 1 - fy;
      for (let a = 0; a < 2; a++) {
        const k = i0 + a;
        if (k < 0 || k >= GW) continue;
        grid[j * GW + k] += w * wy * (a ? fx : 1 - fx);
      }
    }
  }
}

/** Separable [1,4,6,4,1]/16 blur (sigma ~ 1 cell) applied `passes` times, in place. */
function blur(g: Float32Array, tmp: Float32Array, passes: number): void {
  const K = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        let s = 0;
        for (let d = -2; d <= 2; d++) s += K[d + 2] * g[j * GW + Math.min(GW - 1, Math.max(0, i + d))];
        tmp[j * GW + i] = s;
      }
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        let s = 0;
        for (let d = -2; d <= 2; d++) s += K[d + 2] * tmp[Math.min(GH - 1, Math.max(0, j + d)) * GW + i];
        g[j * GW + i] = s;
      }
  }
}

/** q-quantile of the positive values (0 if none). */
function percentile(a: Float32Array, q: number): number {
  const v = Array.from(a).filter((x) => x > 0).sort((x, y) => x - y);
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : 0;
}

const DM_OPACITY = 0.004;
const GAS_OPACITY = 0.16;
const GAL_OPACITY = 2.2;

export function mountBullet(container: HTMLElement): void {
  container.classList.add('bullet');
  container.innerHTML = `
    <p class="bullet-intro">İki galaksi kümesi çarpışıyor (Mermi Kümesi, 1E 0657-56, benzeri). Sıcak gaz çarpışmada birbirine sürtünüp yavaşlar; galaksiler ve (çarpışmasızsa) karanlık madde ise birbirinin içinden geçer. Kütlenin gazla birlikte olmaması, karanlık maddenin kanıtlarından biridir.</p>
    <div class="bullet-stage" role="img" aria-label="İki galaksi kümesinin çarpışması, üç boyutlu: karanlık madde, sıcak gaz, galaksiler. Sürükleyerek döndür, tekerlekle yaklaş.">
      <div class="dm-overlay"><span data-clock></span><span class="dm-scale">Izgara karesi 1 Mpc · sürükle: döndür</span></div>
      <button type="button" class="pill dm-full" data-full>Büyüt</button>
    </div>
    <div class="bullet-layers">
      <label class="lab-check"><input type="checkbox" data-layer="dm" checked><span class="bullet-sw" style="background:${DM}"></span> Karanlık madde (gerçekte görünmez)</label>
      <label class="lab-check"><input type="checkbox" data-layer="gas" checked><span class="bullet-sw" style="background:${GAS}"></span> Sıcak gaz: X-ışını parlaklığı (∝ ρ²)</label>
      <label class="lab-check"><input type="checkbox" data-layer="gal" checked><span class="bullet-sw" style="background:${STAR}"></span> Galaksiler</label>
      <label class="lab-check"><input type="checkbox" data-layer="lens" checked><span class="bullet-sw bullet-sw-ring"></span> Kütleçekimsel mercek (konturlar ve bükülen arka plan galaksileri)</label>
    </div>
    <div class="lab-acts">
      <button type="button" class="pill pill-accent" data-play>Oynat</button>
      <button type="button" class="pill" data-reset>Baştan</button>
    </div>
    <label class="lab-slider bullet-slider"><span class="bullet-slider-label">Karanlık maddenin kendi kendine çarpışması σ/m</span><input type="range" min="0" max="${SIGMAS.length - 1}" step="1" value="0" data-sigma aria-label="Karanlık maddenin kendi kendine çarpışması σ/m"><output data-sigma-out></output></label>
    <p class="note">Arka plandaki soluk galaksiler kümelerin kütlesiyle bükülür; bu yalnızca kümelere gözlemcinin yönünden (önden) bakınca görünür. Bükülme görünür olsun diye büyütüldü; yönü ve şekli kütle haritasından hesaplanır.</p>
    <p class="lab-readout" data-readout></p>
    <p data-explain></p>
    <p class="note">Kaynaklar: <a href="https://arxiv.org/abs/astro-ph/0608407" target="_blank" rel="noopener">Clowe ve ark. 2006</a> (gaz ve kütle tepeleri ayrık), <a href="https://arxiv.org/abs/0704.0261" target="_blank" rel="noopener">Randall ve ark. 2008</a> (σ/m &lt; 1,25 cm²/g).</p>
    <p class="note" data-simple>Basitleştirmeler: kütleçekimi parçacık-ağ (PM) yöntemiyle, ağ hücresi 0,16 Mpc, etkin yumuşatma ≈ 0,1 Mpc (küçük kümenin çekirdeği buna yakın, bu yüzden biraz yayılır) ve 10 Mpc’lik periyodik bir kutuda hesaplanır. Gaz “basitleştirilmiş hidrodinamik” ile modellenir: gaz başlangıçta kendi kütleçekimi potansiyelinde eşısıl hidrostatik dengededir; basınç eşısıl, komşu gaza sürtünme var; şok ısınması ve soğuma yoktur, gaz sıcaklığı (≈ 1600 ve 700 km/s ses hızı) temsili bir değerdir. Karanlık madde etkileşimi Monte Carlo ile, sabit ve yönden bağımsız σ/m ile yapılır; momentum yalnızca ortalamada korunur. Yaklaşık 12 000 parçacık kullanıldığından konumlar ±20 kpc kadar gürültülüdür. Kütleler ve boyutlar Mermi Kümesi’ni temsil eden değerlerdir (ana küme 1,5×10¹⁵ M☉, mermi 1,5×10¹⁴ M☉); başlangıç mesafesi ve hızı, en yakın geçişin ~0,5 milyar yılda olması için seçilmiştir.</p>`;

  const stageEl = container.querySelector<HTMLElement>('.bullet-stage')!;
  const clock = container.querySelector<HTMLElement>('[data-clock]')!;
  const fullBtn = container.querySelector<HTMLButtonElement>('[data-full]')!;
  const playBtn = container.querySelector<HTMLButtonElement>('[data-play]')!;
  const resetBtn = container.querySelector<HTMLButtonElement>('[data-reset]')!;
  const slider = container.querySelector<HTMLInputElement>('[data-sigma]')!;
  const sliderOut = container.querySelector<HTMLOutputElement>('[data-sigma-out]')!;
  const readout = container.querySelector<HTMLElement>('[data-readout]')!;
  const explain = container.querySelector<HTMLElement>('[data-explain]')!;
  const layerBoxes = Array.from(container.querySelectorAll<HTMLInputElement>('[data-layer]'));

  const stage = new Stage(stageEl);
  const nDm = COUNTS.dmMain + COUNTS.dmSub;
  const nGas = COUNTS.gasMain + COUNTS.gasSub;
  const dmLayer = new ParticleLayer({ count: nDm, color: DM, size: 0.42, opacity: DM_OPACITY, kind: 'dm' });
  const gasLayer = new ParticleLayer({ count: nGas, color: GAS, size: 0.2, opacity: GAS_OPACITY, kind: 'gas' });
  const galLayer = new ParticleLayer({ count: COUNTS.galMain + COUNTS.galSub, color: STAR, size: 0.025, opacity: GAL_OPACITY, kind: 'star' });
  const grid = new GridHelper(10, 10, 0x2a3350, 0x161c2e);
  grid.position.y = -2.2;
  const contourGeo = new BufferGeometry();
  const contourLines = new LineSegments(contourGeo, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false }));
  const lensed = new LensedBackground({ count: 5000, seed: 7, half: LENS_HALF, depth: 5 });
  lensed.setStrength(LENS_SHIFT);
  let lensT = -Infinity;
  stage.scene.add(lensed.object, grid, dmLayer.points, gasLayer.points, galLayer.points, contourLines);
  const rhoGrid = new Float32Array(RHO_N ** 3);
  type Snap = { dm: Float32Array; gas: Float32Array; gal: Float32Array; rho: Float32Array };
  let prev: Snap | null = null;
  let cur: Snap | null = null;
  let arrived = 0;
  let rhoRef = 0;
  stage.onUpdate(() => {
    if (!prev || !cur) return;
    const mix = Math.min(1, (performance.now() - arrived) / STEP_MS);
    dmLayer.setFrames(prev.dm, cur.dm, mix);
    gasLayer.setFrames(prev.gas, cur.gas, mix);
    gasLayer.setRho(prev.rho, cur.rho, rhoRef);
    galLayer.setFrames(prev.gal, cur.gal, mix);
  });

  const layers = { dm: true, gas: true, gal: true, lens: true };
  const dm = new Float32Array(GW * GH);
  const segs: number[] = [];
  const gasMap = new Float32Array(GW * GH);
  const total = new Float32Array(GW * GH);
  const tmp = new Float32Array(GW * GH);
  // Brightness references (the peaks of the first frame), kept across resets so runs compare.
  let ref: { total: number } | null = null;

  let info: BulletReady | null = null;
  let frame: BulletFrame | null = null;
  let lastT: number | null = null;
  let history: BulletDiag[] = [];
  let minSep = Infinity;
  let contact = false;
  let tContact = 0;
  let wantPlay = true;
  let workerRunning = false;
  let finished = false;
  let intersecting = true;
  let disposed = false;
  let lastReadout = '';

  const worker = new Worker(new URL('./bullet.worker.ts', import.meta.url), { type: 'module' });
  const send = (m: ToWorker): void => worker.postMessage(m);

  const sigma = (): number => SIGMAS[Number(slider.value)];

  // ---- Visibility ----------------------------------------------------------------------------

  // A closed lab panel stays in the DOM (data-open="false"), so ask it too.
  const shown = (): boolean =>
    container.isConnected && container.closest<HTMLElement>('[data-open]')?.dataset.open !== 'false' && container.offsetParent !== null && container.getClientRects().length > 0 && intersecting && !document.hidden;

  /** Keep the worker running only while the user wants it and the scene is visible. */
  function sync(): void {
    if (disposed) return;
    if (shown()) stage.start();
    else stage.stop();
    const should = wantPlay && !finished && shown();
    if (should !== workerRunning) {
      workerRunning = should;
      send({ type: should ? 'run' : 'pause' });
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    io?.disconnect();
    stage.dispose();
    dmLayer.dispose();
    gasLayer.dispose();
    galLayer.dispose();
    lensed.dispose();
    contourGeo.dispose();
    mo.disconnect();
    worker.terminate();
  }

  const timer = window.setInterval(() => {
    if (!container.isConnected) dispose();
    else sync();
  }, 500);
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((e) => {
    intersecting = e[e.length - 1].isIntersecting;
    sync();
  }) : null;
  io?.observe(stageEl);
  // Removal of the card terminates the worker immediately (the interval is the fallback).
  const mo = new MutationObserver(() => {
    if (!container.isConnected) dispose();
  });
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', sync);

  // ---- Worker traffic ------------------------------------------------------------------------

  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === 'ready') {
      info = m;
    } else if (m.type === 'frame') {
      frame = m;
      history.push(m.diag);
      if (history.length > 6) history.shift();
      if (m.diag.sep < minSep) {
        minSep = m.diag.sep;
        // Time of the closest approach once the cores have met (sep < 300 kpc).
        if (minSep < 300) {
          contact = true;
          tContact = m.t;
        }
      }
      applyFrame(m);
      updateText();
    } else {
      finished = true;
      workerRunning = false;
      wantPlay = false;
      updateButtons();
    }
  };

  function restart(): void {
    history = [];
    minSep = Infinity;
    contact = false;
    finished = false;
    workerRunning = false;
    send({ type: 'reset', sigmaOverM: sigma() });
    updateText();
    sync();
  }

  // ---- Drawing -------------------------------------------------------------------------------

  function buildMaps(f: BulletFrame, meta: BulletReady): void {
    dm.fill(0);
    gasMap.fill(0);
    splat(dm, f.dmMain, 0, f.dmMain.length / 3, meta.mDmMain);
    splat(dm, f.dmSub, 0, f.dmSub.length / 3, meta.mDmSub);
    splat(gasMap, f.gas, 0, meta.nGasMain, meta.mGasMain);
    splat(gasMap, f.gas, meta.nGasMain, f.gas.length / 3, meta.mGasSub);
    blur(dm, tmp, 2);
    blur(gasMap, tmp, 3);
    for (let i = 0; i < total.length; i++) total[i] = dm[i] + gasMap[i];
  }

  function peak(a: Float32Array): number {
    let m = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return m;
  }

  /** Marching squares for one level on the total-mass map; segments go to `segs` on the sky plane (Mpc, z = 0). */
  function contour(level: number): void {
    const v = (i: number, j: number): number => total[j * GW + i];
    // Edge crossing coordinates (in map cells, cell centres at +0.5).
    const lerp = (a: number, b: number): number => (level - a) / (b - a);
    for (let j = 0; j < GH - 1; j++) {
      for (let i = 0; i < GW - 1; i++) {
        const a = v(i, j); // top-left
        const b = v(i + 1, j); // top-right
        const c = v(i + 1, j + 1); // bottom-right
        const d = v(i, j + 1); // bottom-left
        const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const top: [number, number] = [i + lerp(a, b), j];
        const right: [number, number] = [i + 1, j + lerp(b, c)];
        const bottom: [number, number] = [i + lerp(d, c), j + 1];
        const left: [number, number] = [i, j + lerp(a, d)];
        const seg = (p: [number, number], q: [number, number]): void => {
          segs.push(X0 + (p[0] + 0.5) * CELL, Y0 + (p[1] + 0.5) * CELL, 0, X0 + (q[0] + 0.5) * CELL, Y0 + (q[1] + 0.5) * CELL, 0);
        };
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(top, left); break;
          case 5: seg(top, right); seg(left, bottom); break; // saddle, kept separate
          case 10: seg(top, left); seg(bottom, right); break;
        }
      }
    }
  }

  /** A new worker frame: GPU buffers (previous -> this one), gas density, lensing contours, clock. */
  function applyFrame(f: BulletFrame): void {
    if (disposed || !info) return;
    const dmAll = new Float32Array(nDm * 3);
    dmAll.set(f.dmMain, 0);
    dmAll.set(f.dmSub, f.dmMain.length);
    rhoGrid.fill(0);
    cicDensity(f.gas, 0, info.nGasMain, info.mGasMain, rhoGrid, RHO_N, RHO_HALF);
    cicDensity(f.gas, info.nGasMain, nGas, info.mGasSub, rhoGrid, RHO_N, RHO_HALF);
    const rho = new Float32Array(nGas);
    for (let i = 0; i < nGas; i++) rho[i] = sampleDensity(rhoGrid, RHO_N, RHO_HALF, f.gas[3 * i], f.gas[3 * i + 1], f.gas[3 * i + 2]);
    if (!rhoRef) rhoRef = percentile(rho, 0.99);
    const next: Snap = { dm: dmAll, gas: f.gas, gal: f.gal, rho };
    // A reset jumps back in time: do not blend across it.
    prev = cur && lastT !== null && f.t > lastT - 1e-9 ? cur : next;
    cur = next;
    lastT = f.t;
    arrived = performance.now();
    clock.textContent = `t = ${num(f.t, 2)} milyar yıl`;

    buildMaps(f, info);
    if (!ref) ref = { total: peak(total) };
    segs.length = 0;
    for (const l of CONTOUR_LEVELS) contour(l * ref.total);
    contourGeo.setAttribute('position', new Float32BufferAttribute(segs, 3));
    if (Math.abs(f.t - lensT) >= LENS_EVERY - 1e-9) {
      lensT = f.t;
      const sDm = projectSigma(dmAll, [{ from: 0, to: COUNTS.dmMain, mass: info.mDmMain }, { from: COUNTS.dmMain, to: nDm, mass: info.mDmSub }], LENS_N, LENS_HALF);
      const sGas = projectSigma(f.gas, [{ from: 0, to: info.nGasMain, mass: info.mGasMain }, { from: info.nGasMain, to: nGas, mass: info.mGasSub }], LENS_N, LENS_HALF);
      for (let i = 0; i < sDm.length; i++) sDm[i] += sGas[i];
      lensed.setField(deflectionField(sDm, LENS_N, LENS_HALF, 0.08), LENS_N, LENS_HALF);
    }
    applyLayers();
  }

  function applyLayers(): void {
    dmLayer.setOpacity(layers.dm ? DM_OPACITY : 0);
    gasLayer.setOpacity(layers.gas ? GAS_OPACITY : 0);
    galLayer.setOpacity(layers.gal ? GAL_OPACITY : 0);
    contourLines.visible = layers.lens;
    lensed.setOpacity(layers.lens ? 1 : 0);
  }

  // ---- Text ----------------------------------------------------------------------------------

  function mean(pick: (d: BulletDiag) => number): number {
    return history.length ? history.reduce((s, d) => s + pick(d), 0) / history.length : 0;
  }

  function updateText(): void {
    const s = sigma();
    sliderOut.textContent = sigmaText(s);
    // Averaged over the last ~0.05 Gyr and rounded to 10 kpc: the tracers are few and noisy.
    const round10 = (v: number): string => num(Math.round(Math.abs(v) / 10) * 10);
    const x = round10(mean((d) => d.gasOff));
    const y = round10(mean((d) => d.galOff));
    const when = !frame ? '' : contact ? ` (en yakın geçiş t ≈ ${num(tContact, 2)} milyar yıl)` : ' (kümeler henüz çarpışmadı)';
    const line = `Mermi (küçük küme): gaz–kütle ayrımı ≈ ${x} kpc · galaksi–karanlık madde ayrımı ≈ ${y} kpc${when}`;
    const yv = Math.abs(mean((d) => d.galOff));
    // Judge the lag only some time after the encounter, when the tracers have separated.
    const settled = contact && frame !== null && frame.t > tContact + 0.1;
    let text: string;
    if (s === 0) {
      text = 'σ/m = 0: karanlık madde çarpışmasızdır, galaksiler gibi çarpışmadan geçer. Karanlık madde galaksilerle birlikte kalır (galaksi–karanlık madde ayrımı ≈ 0), gaz ise sürtünmeyle geride kalır (gaz–kütle ayrımı büyük). Gözlenen durum budur: Clowe ve ark. (2006) gaz ile kütle tepelerinin belirgin biçimde ayrık olduğunu gösterdi.';
    } else {
      const sm = `σ/m = ${num(s, s < 1 ? 1 : 0)} cm²/g`;
      let measured = '';
      if (settled) measured = yv > 100 ? ` Bu çalıştırmada küçük kümenin karanlık maddesi ana kümenin içinde yavaşlayıp ona karışıyor; galaksiler ondan ayrılıyor (≈ ${round10(yv)} kpc).` : ' Bu çalıştırmada karanlık madde galaksilerle birlikte kalıyor.';
      const limit = s >= 1 ? ' Gözlemlerde galaksilerle kütle arasında böyle bir kayma görülmez; bu yüzden σ/m ≲ 1 cm²/g sınırı konur (Randall ve ark. 2008: σ/m < 1,25 cm²/g).' : ' Mermi Kümesi’nde galaksi–kütle kayması görülmediğinden bu değer gözlemle uyumludur (Randall ve ark. 2008: σ/m < 1,25 cm²/g).';
      text = `${sm}: karanlık madde parçacıkları birbirinin içinden geçerken ara sıra saçılır; çok saçılırsa küçük kümenin karanlık maddesi yavaşlar ve galaksilerinin gerisinde kalır.${measured}${limit} Bu basit modelde geçiş eşiği ~1 cm²/g dolayındadır ve çözünürlüğe duyarlıdır.`;
    }
    const sig = `${line}\n${text}`;
    if (sig !== lastReadout) {
      lastReadout = sig;
      readout.textContent = line;
      explain.textContent = text;
    }
  }

  function updateButtons(): void {
    playBtn.textContent = wantPlay ? 'Durdur' : 'Oynat';
    playBtn.setAttribute('aria-pressed', String(wantPlay));
  }

  // ---- Controls ------------------------------------------------------------------------------

  playBtn.addEventListener('click', () => {
    if (!wantPlay && finished) restart();
    wantPlay = !wantPlay;
    updateButtons();
    sync();
  });
  resetBtn.addEventListener('click', () => {
    restart();
  });
  slider.addEventListener('input', () => {
    sliderOut.textContent = sigmaText(sigma());
  });
  // Changing sigma/m starts a fresh run (same initial particles, different dark matter physics).
  slider.addEventListener('change', () => restart());
  for (const box of layerBoxes) {
    box.addEventListener('change', () => {
      layers[box.dataset.layer as keyof typeof layers] = box.checked;
      applyLayers();
    });
  }

  stage.onFullscreen = (on) => (fullBtn.textContent = on ? 'Küçült' : 'Büyüt');
  fullBtn.addEventListener('click', () => stage.setFullscreen(!stage.fullscreen));

  updateButtons();
  updateText();
  send({ type: 'init', sigmaOverM: sigma() });
  sync();
}
