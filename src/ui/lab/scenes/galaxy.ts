/**
 * Scene 3 of the lab: a galaxy forming inside a dark-matter halo.
 *
 * Real physics at low resolution, computed in galaxy.worker.ts: gravity (Barnes-Hut tree),
 * SPH gas with radiative cooling, star formation and optional supernova feedback. The
 * initial state is the classic "cooling of a rotating hot halo" (cf. Kaufmann et al. 2007).
 * This file is the user interface: two projections, a live rotation curve, the dark-matter
 * density profile, readouts and the method note.
 */
import './galaxy.css';
import { plot, type Axis, type Series } from '../plot';
import { num, sci } from '../physics';
import type { FromWorker, Stats, ToWorker } from './galaxy.worker';

// ---------------------------------------------------------------- constants

const VIEW = 60; // kpc, half width of both projections
const CELLS = 50; // dark-matter map resolution
const RS_KPC = 20.6; // r_s of the halo for the analytic NFW reference (kpc), r200/c
const M200 = 1e12;
const FBAR = 0.15;
const CONC = 10;

const RESOLUTIONS: Record<string, { nDm: number; nGas: number; label: string }> = {
  fast: { nDm: 3500, nGas: 2500, label: 'Hızlı' },
  normal: { nDm: 5000, nGas: 4000, label: 'Normal' },
  high: { nDm: 8000, nGas: 6000, label: 'Yüksek' },
};
const DEFAULT_RES = 'fast';

// log10 T -> colour of a gas particle: cold white-blue, warm violet, hot pink
const T_STOPS: [number, [number, number, number]][] = [
  [4.0, [226, 244, 255]],
  [4.6, [105, 190, 255]],
  [5.3, [172, 140, 255]],
  [6.0, [255, 111, 200]],
  [7.0, [255, 111, 200]],
];
const T_BUCKETS = 28;
const T_COLOURS: string[] = Array.from({ length: T_BUCKETS }, (_, k) => {
  const lt = 4 + (k / (T_BUCKETS - 1)) * 3;
  let j = 0;
  while (j < T_STOPS.length - 2 && T_STOPS[j + 1][0] < lt) j++;
  const [a, ca] = T_STOPS[j];
  const [b, cb] = T_STOPS[j + 1];
  const w = Math.min(1, Math.max(0, (lt - a) / (b - a)));
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * w));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
});

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const fmtMass = (m: number): string => {
  if (m <= 0) return '0';
  const e = Math.floor(Math.log10(m));
  const mant = m / 10 ** e;
  return `${mant.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×10${String(e).replace(/\d/g, (d) => SUP[+d])} M☉`;
};
const fmtTime = (gyr: number): string => (gyr < 1 ? `${num(gyr * 1000, 0)} milyon yıl` : `${num(gyr, 2)} milyar yıl`);

const mNFW = (x: number): number => Math.log(1 + x) - x / (1 + x);

// ---------------------------------------------------------------- mount

export function mountGalaxyFormation(container: HTMLElement): void {
  const root = document.createElement('div');
  root.className = 'gal';
  root.innerHTML = `
    <p class="note gal-intro">Dönen, sıcak gaz dolu bir karanlık madde halesi ile başla. Gaz ışınım yapıp enerji kaybeder, basıncı düşer ve çöker; açısal momentumunu koruduğu için bir diske oturur ve yıldız doğurur. Karanlık madde ışınım yapamaz: geniş, yaklaşık küresel bir hale olarak kalır. Aşağıdaki her şey çekim, gaz dinamiği ve soğuma denklemleriyle gerçekten hesaplanıyor (düşük çözünürlükte).</p>
    <div class="gal-views">
      <figure><canvas data-face aria-label="Yüzü bize dönük görünüm"></canvas><figcaption>Yüzü bize dönük (x–y), ±${VIEW} kpc</figcaption></figure>
      <figure><canvas data-edge aria-label="Kenardan görünüm"></canvas><figcaption>Kenardan (x–z), ±${VIEW} kpc</figcaption></figure>
    </div>
    <div class="gal-layers" role="group" aria-label="Katmanlar">
      <label class="lab-check"><input type="checkbox" data-layer="dm" checked><i class="gal-sw gal-sw-dm"></i>Karanlık madde</label>
      <label class="lab-check"><input type="checkbox" data-layer="gas" checked><i class="gal-sw gal-sw-gas"></i>Gaz (renk: sıcaklık)</label>
      <label class="lab-check"><input type="checkbox" data-layer="star" checked><i class="gal-sw gal-sw-star"></i>Yıldızlar</label>
    </div>
    <div class="gal-tbar" aria-hidden="true"><span>soğuk &lt; 2×10⁴ K</span><i></i><span>sıcak &gt; 10⁶ K</span></div>
    <p class="lab-readout gal-stage" data-stage aria-live="polite"></p>
    <div class="lab-acts">
      <button type="button" class="pill pill-accent" data-play>▶ Oynat</button>
      <button type="button" class="pill" data-reset>Baştan</button>
      <label class="gal-res">Çözünürlük
        <select data-res aria-label="Çözünürlük">${Object.entries(RESOLUTIONS)
          .map(([k, r]) => `<option value="${k}"${k === DEFAULT_RES ? ' selected' : ''}>${r.label} (N = ${(r.nDm + r.nGas).toLocaleString('tr-TR')})</option>`)
          .join('')}</select>
      </label>
    </div>
    <label class="lab-check"><input type="checkbox" data-fb checked> Süpernova geri beslemesi (değişince baştan başlar)</label>
    <div class="gal-stats" data-stats></div>
    <h4 class="gal-h">Dönme eğrisi</h4>
    <div data-rot></div>
    <div class="gal-legend">
      <span><i style="background:#7fffc4"></i>toplam</span><span><i style="background:#5d8dff"></i>karanlık madde</span><span><i style="background:#ff6fc8"></i>gaz</span><span><i style="background:#ffd27a"></i>yıldızlar</span><span><i class="gal-dot"></i>ölçülen ortalama hız (soğuk gaz + yıldız, diskte)</span>
    </div>
    <p class="note" data-rotnote></p>
    <h4 class="gal-h">Karanlık madde yoğunluk profili</h4>
    <div data-rho></div>
    <div class="gal-legend">
      <span><i style="background:#5d8dff"></i>şimdi</span><span><i class="gal-dash"></i>başlangıç (aynı parçacıklar)</span><span><i class="gal-dot2"></i>analitik NFW</span>
    </div>
    <p class="lab-readout" data-core></p>
    <details class="lab-method gal-method" data-method>
      <summary>Yöntem ve sınırlar</summary>
      <div data-method-body></div>
    </details>`;
  container.replaceChildren(root);

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel) as T;
  const faceCv = q<HTMLCanvasElement>('[data-face]');
  const edgeCv = q<HTMLCanvasElement>('[data-edge]');
  const stageEl = q<HTMLElement>('[data-stage]');
  const statsEl = q<HTMLElement>('[data-stats]');
  const rotEl = q<HTMLElement>('[data-rot]');
  const rotNote = q<HTMLElement>('[data-rotnote]');
  const rhoEl = q<HTMLElement>('[data-rho]');
  const coreEl = q<HTMLElement>('[data-core]');
  const methodBody = q<HTMLElement>('[data-method-body]');
  const playBtn = q<HTMLButtonElement>('[data-play]');
  const resetBtn = q<HTMLButtonElement>('[data-reset]');
  const fbBox = q<HTMLInputElement>('[data-fb]');
  const resSel = q<HTMLSelectElement>('[data-res]');
  const layerBoxes = [...root.querySelectorAll<HTMLInputElement>('[data-layer]')];

  let worker: Worker | null = null;
  let wantRun = false; // what the user asked for
  let sentRun = false; // what the worker was told
  let last: (FromWorker & { stats: Stats }) | null = null;
  let mDm = 1.7e8;
  let timer = 0;
  let dead = false;
  let failed = false;

  // ---- canvases

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = 225;
  for (const cv of [faceCv, edgeCv]) {
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    cv.style.width = '100%';
    cv.style.aspectRatio = '1 / 1';
    cv.className = 'gal-cv';
  }
  const mapCv = document.createElement('canvas');
  mapCv.width = CELLS;
  mapCv.height = CELLS;
  const mapCtx = mapCv.getContext('2d')!;
  const mapImg = mapCtx.createImageData(CELLS, CELLS);

  const layer = (k: string): boolean => layerBoxes.find((b) => b.dataset.layer === k)!.checked;

  function dmMap(snap: FromWorker, axisB: 'py' | 'pz'): void {
    const g = new Float32Array(CELLS * CELLS);
    const { px, kind } = snap;
    const pb = axisB === 'py' ? snap.py : snap.pz;
    for (let i = 0; i < kind.length; i++) {
      if (kind[i] !== 0) continue;
      const cx = Math.floor(((px[i] + VIEW) / (2 * VIEW)) * CELLS);
      const cy = Math.floor(((VIEW - pb[i]) / (2 * VIEW)) * CELLS);
      if (cx >= 0 && cx < CELLS && cy >= 0 && cy < CELLS) g[cy * CELLS + cx]++;
    }
    // two 3x3 box blurs ~ a Gaussian of about one cell
    const tmp = new Float32Array(CELLS * CELLS);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? g : tmp;
      const dst = pass === 0 ? tmp : g;
      for (let y = 0; y < CELLS; y++) {
        for (let x = 0; x < CELLS; x++) {
          let s = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= CELLS || yy >= CELLS) continue;
              s += src[yy * CELLS + xx];
              n++;
            }
          }
          dst[y * CELLS + x] = s / n;
        }
      }
    }
    const cell = (2 * VIEW) / CELLS;
    const d = mapImg.data;
    for (let k = 0; k < CELLS * CELLS; k++) {
      const sigma = (g[k] * mDm) / (cell * cell); // M_sun / kpc^2
      const a = sigma > 0 ? Math.min(1, Math.max(0, (Math.log10(sigma) - 6.6) / 2.3)) : 0;
      d[k * 4] = 61;
      d[k * 4 + 1] = 123;
      d[k * 4 + 2] = 255;
      d[k * 4 + 3] = Math.round(a * 215);
    }
    mapCtx.putImageData(mapImg, 0, 0);
  }

  function drawView(cv: HTMLCanvasElement, snap: FromWorker, edge: boolean): void {
    const ctx = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, W, H);
    const { px, py, pz, kind, logT } = snap;
    const pb = edge ? pz : py;
    const sc = W / (2 * VIEW);
    if (layer('dm')) {
      dmMap(snap, edge ? 'pz' : 'py');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mapCv, 0, 0, W, H);
    }
    const dot = Math.max(1.4, 1.5 * dpr);
    if (layer('gas')) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      const buckets: number[][] = Array.from({ length: T_BUCKETS }, () => []);
      for (let i = 0; i < kind.length; i++) {
        if (kind[i] !== 1) continue;
        const b = Math.min(T_BUCKETS - 1, Math.max(0, Math.round(((logT[i] - 4) / 3) * (T_BUCKETS - 1))));
        buckets[b].push(i);
      }
      for (let b = 0; b < T_BUCKETS; b++) {
        ctx.fillStyle = T_COLOURS[b];
        for (const i of buckets[b]) {
          const x = (px[i] + VIEW) * sc;
          const y = (VIEW - pb[i]) * sc;
          if (x < 0 || y < 0 || x > W || y > H) continue;
          ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (layer('star')) {
      ctx.fillStyle = '#ffe6bd';
      ctx.globalAlpha = 0.85;
      const s = Math.max(1.3, 1.4 * dpr);
      for (let i = 0; i < kind.length; i++) {
        if (kind[i] !== 2) continue;
        const x = (px[i] + VIEW) * sc;
        const y = (VIEW - pb[i]) * sc;
        if (x < 0 || y < 0 || x > W || y > H) continue;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }
    // scale bar: 20 kpc
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const barW = 20 * sc;
    ctx.fillRect(10 * dpr, H - 14 * dpr, barW, 2 * dpr);
    ctx.font = `${10 * dpr}px monospace`;
    ctx.fillText('20 kpc', 10 * dpr, H - 18 * dpr);
  }

  // ---- plots

  const rotX: Axis = { min: 0, max: 60, label: 'yarıçap r (kpc)', ticks: [0, 10, 20, 30, 40, 50, 60] };
  const rotY: Axis = { min: 0, max: 300, label: 'hız (km/s)', ticks: [0, 50, 100, 150, 200, 250, 300] };
  const rhoX: Axis = { min: 1, max: 100, log: true, label: 'yarıçap r (kpc)' };
  const rhoY: Axis = { min: 1e4, max: 1e9, log: true, label: 'ρ (M☉/kpc³)' };
  const ρs = M200 / (4 * Math.PI * RS_KPC ** 3 * mNFW(CONC));
  const nfwX = Array.from({ length: 40 }, (_, k) => 10 ** ((2 * k) / 39));
  const nfwY = nfwX.map((r) => ((1 - FBAR) * ρs) / ((r / RS_KPC) * (1 + r / RS_KPC) ** 2));

  function drawPlots(st: Stats): void {
    const series: Series[] = [
      { kind: 'line', x: st.rr, y: st.vDm, cls: 'g-dm' },
      { kind: 'line', x: st.rr, y: st.vGas, cls: 'g-gas' },
      { kind: 'line', x: st.rr, y: st.vStar, cls: 'g-star' },
      { kind: 'line', x: st.rr, y: st.vTot, cls: 'g-total' },
    ];
    if (st.rotR.length) series.push({ kind: 'scatter', x: st.rotR, y: st.rotV, cls: 'g-pts', r: 3.2 });
    rotEl.innerHTML = plot(rotX, rotY, series, 'Dönme eğrisi: toplam, karanlık madde, gaz ve yıldızlar için dairesel hız ve ölçülen ortalama dönme hızı');

    const keep = (a: Float64Array): [number[], number[]] => {
      const xs: number[] = [];
      const ys: number[] = [];
      a.forEach((v, k) => {
        if (v > 0) {
          xs.push(st.rhoR[k]);
          ys.push(v);
        }
      });
      return [xs, ys];
    };
    const [x0, y0] = keep(st.rho0);
    const [x1, y1] = keep(st.rho);
    rhoEl.innerHTML = plot(
      rhoX,
      rhoY,
      [
        { kind: 'line', x: nfwX, y: nfwY, cls: 'g-nfw' },
        { kind: 'line', x: x0, y: y0, cls: 'g-init' },
        { kind: 'line', x: x1, y: y1, cls: 'g-now' },
      ],
      'Karanlık madde yoğunluğu: yarıçapa göre şimdi, başlangıçta ve analitik NFW',
    );
  }

  // ---- readouts

  function stageText(st: Stats): string {
    const gas0 = FBAR * M200;
    const coldFrac = (st.mCold + st.mStar) / gas0;
    let s: string;
    if (st.t < 0.02 && coldFrac < 0.05) s = 'Sıcak gaz halede asılı; ışınım yaparak enerji kaybediyor, basıncı azalıyor.';
    else if (st.mStar < 3e9 && st.t < 1) s = 'Soğuyan gaz merkeze çöküyor; açısal momentum onu bir diske dönüştürüyor.';
    else if (st.t < 1.6) s = 'Diskte yıldızlar doğuyor; karanlık madde halesi küresel kalıyor.';
    else s = 'Dönme eğrisi: dışarıda düz — kütlenin çoğu karanlık madde.';
    if (fbBox.checked && st.mStar > 2e9 && st.t < 1.6 && st.t >= 0.02) s += ' Süpernovalar çevre gazı ısıtıp bir kısmını dışarı itiyor.';
    return s;
  }

  const kv = (k: string, v: string): string => `<div><span>${k}</span><b>${v}</b></div>`;

  function readouts(m: FromWorker): void {
    const st = m.stats;
    const at = (a: Float64Array, r: number): number => a[Math.round(r * 2) - 1];
    stageEl.textContent = stageText(st);
    statsEl.innerHTML =
      kv('Zaman', `t = ${fmtTime(st.t)}`) +
      kv('Hız', m.running ? `${num(m.speed, m.speed < 10 ? 1 : 0)} Myr/s` : 'durdu') +
      kv('Sıcak gaz (T &gt; 3×10⁵ K)', fmtMass(st.mHot)) +
      kv('Ilık gaz', fmtMass(st.mWarm)) +
      kv('Soğuk gaz (T &lt; 3×10⁴ K)', fmtMass(st.mCold)) +
      kv('Oluşan yıldız kütlesi', fmtMass(st.mStar)) +
      kv('Yıldız oluşum hızı', `${num(st.sfr, st.sfr < 10 ? 1 : 0)} M☉/yıl`) +
      kv('Disk ölçek uzunluğu', Number.isFinite(st.rd) ? `${num(st.rd, 1)} kpc` : 'ölçülemiyor') +
      kv('Dönme parametresi λ′', `${num(st.spinGas0, 3)} (başlangıç, gaz) → ${num(st.spinBar, 3)} (gaz + yıldız)`) +
      kv('j(soğuk gaz + yıldız) / j(ilk gaz)', num(st.jRatio, 2)) +
      kv('v<sub>c</sub> 10 / 30 / 60 kpc', `${num(at(st.vTot, 10), 0)} / ${num(at(st.vTot, 30), 0)} / ${num(at(st.vTot, 60), 0)} km/s`) +
      kv('Karanlık madde payı v<sub>c</sub>² (30 kpc)', `%${num((100 * at(st.vDm, 30) ** 2) / at(st.vTot, 30) ** 2, 0)}`);
    const hot = st.mHot > st.mCold && st.t > 0.3;
    rotNote.innerHTML = `Çizgiler, küresel kütle içinden √(G M(&lt;r)/r). Gaz ve yıldız eğrilerini karanlık madde eğrisiyle karşılaştır: kütle merkezde toplandıkça gaz + yıldız eğrisi Kepler gibi düşmeye yönelir, toplamın dışarıda düz kalmasını geniş karanlık madde halesi sağlar. Noktalar diskteki soğuk gaz ve yıldızların gerçek ortalama dönme hızı (|z| &lt; 4 kpc); asimetrik sürüklenme ve kalın disk yüzünden dairesel hızın altında kalır.${hot ? ' Gazın büyük kısmı hâlâ sıcak: dönme henüz yerleşmedi.' : ''}`;
    const c = coreRatio(st);
    coreEl.innerHTML = c
      ? `Merkez (1–5 kpc) karanlık madde kütlesi: başlangıca göre <b>×${num(c.ratio, 2)}</b> (parçacık gürültüsü ≈ ±${num(c.err, 2)}). ${coreWords(c)}`
      : 'Merkez karanlık madde kütlesi henüz ölçülemiyor.';
  }

  /** Mass of dark matter in the shells 1-5 kpc now vs. at the start. */
  function coreRatio(st: Stats): { ratio: number; err: number } | null {
    let m1 = 0;
    let m0 = 0;
    for (let k = 0; k < 4; k++) {
      const r0 = 10 ** ((2 * k) / 12);
      const r1 = 10 ** ((2 * (k + 1)) / 12);
      const v = (4 / 3) * Math.PI * (r1 ** 3 - r0 ** 3);
      m1 += st.rho[k] * v;
      m0 += st.rho0[k] * v;
    }
    if (m0 <= 0 || m1 <= 0) return null;
    const n0 = m0 / mDm;
    const n1 = m1 / mDm;
    const ratio = m1 / m0;
    return { ratio, err: ratio * Math.sqrt(1 / n0 + 1 / n1) };
  }

  function coreWords(c: { ratio: number; err: number }): string {
    const ctl = 'Kontrol: soğuma ve süpernova kapalıyken (yalnızca çekim + basınç) bu oran 2 milyar yılda 0,55–0,8 arasında oynadı; yumuşatma ve parçacık gürültüsü merkezi zaten biraz eritiyor.';
    if (c.ratio > 1 + 2 * c.err) return `Gazın çökmesi çekim potansiyelini derinleştirdi: karanlık madde merkeze doğru sıkıştı (adyabatik büzülme). ${ctl}`;
    if (c.ratio < 0.4) return `Oran kontrolün alt sınırının da altında: merkezdeki karanlık madde azalmış. Süpernova kaynaklı gaz dalgalanmaları böyle bir etki yapabilir (çekirdek–tepe tartışması); ama geri besleme kapalıyken de benzer bir düşüş görüyorsan neden gazın çöküşü ve ağır parçacıklarla saçılma gibi sayısal/dinamik etkilerdir. Karşılaştırmak için anahtarı değiştir. ${ctl}`;
    return `Değişim kontrol aralığının içinde: bu çözünürlükte baryon etkisi sayısal gürültüden ayırt edilemiyor. ${ctl}`;
  }

  function methodText(m: FromWorker): string {
    const i = m.info;
    return `
      <ul>
        <li><b>Başlangıç.</b> NFW halesi (<a href="https://arxiv.org/abs/astro-ph/9611107" target="_blank" rel="noopener">Navarro, Frenk &amp; White 1997</a>): M₂₀₀ = 10¹² M☉, c = ${CONC}, H₀ = 70 km/s/Mpc ⇒ r₂₀₀ = ${num(i.r200, 1)} kpc, V₂₀₀ = ${num(i.v200, 0)} km/s (G = 4,498×10⁻⁶ kpc³ M☉⁻¹ Gyr⁻²; 1 km/s = 1,0227 kpc/Gyr). Kütlenin %15’i gaz, %85’i karanlık madde; ikisi de aynı NFW şeklinde. Hız dağılımı ve gaz sıcaklığı küresel Jeans / hidrostatik denklemden sayısal integralle bulundu, bu yüzden soğuma kapalıyken hale dengede kalır (kontrol koşusunda 1 milyar yılda gaz ve karanlık madde yarı-kütle yarıçapları %1 içinde kalır; kesik sınıra yakın en dış %10 yavaşça genişler). Gaz, Bullock λ′ = ${num(i.spin, 3)} ile dönüyor (v<sub>φ</sub> ∝ R/(1+R/r<sub>s</sub>)); karanlık maddede net dönme yok. Kurulum: <a href="https://arxiv.org/abs/astro-ph/0601115" target="_blank" rel="noopener">Kaufmann ve ark. 2007</a> türü “dönen sıcak halenin soğuması”.</li>
        <li><b>Parçacıklar.</b> N<sub>km</sub> = ${i.nDm.toLocaleString('tr-TR')} (her biri ${sci(i.mDm, 2)} M☉), N<sub>gaz</sub> = ${i.nGas.toLocaleString('tr-TR')} (her biri ${sci(i.mGas, 2)} M☉; oluşan yıldız parçacığı gaz parçacığının kütlesini korur). Toplam N sabit.</li>
        <li><b>Çekim.</b> Barnes–Hut oktree (θ = 0,7, grup yürüyüşü, tek kutuplu), Plummer yumuşatma ε<sub>km</sub> = 1,5 kpc, ε<sub>gaz,yıldız</sub> = 0,7 kpc. Karanlık maddenin kuvveti (yörünge süreleri bu aralıktan çok uzun) en geç her 1,5 Myr’de (40 kpc içinde) ya da 4 Myr’de (dışında) yenilenir; gaz ve yıldızlarınki her adımda.</li>
        <li><b>Gaz.</b> SPH (<a href="https://arxiv.org/abs/1109.2219" target="_blank" rel="noopener">Springel 2010</a>): kübik spline çekirdek, ≈ 32 komşu (uyarlanır h), simetrik basınç kuvveti, Monaghan yapay viskozitesi (α = 1, β = 2, Balsara anahtarı), γ = 5/3, μ = 0,59, enerji denklemi. Komşu listeleri birkaç adımda bir yenilenir.</li>
        <li><b>Soğuma.</b> yaklaşık soğuma eğrisi Λ(T): ≈ 0,3 Z☉, çarpışmalı iyonlaşma dengesi, log T’ye göre doğrusal enterpolasyonlu 11 noktalı tablo; du/dt = −n<sub>H</sub>² Λ/ρ, alt adımlarla; sıcaklık tabanı 10⁴ K. UV artalan ve kimya yok.</li>
        <li><b>Yıldız oluşumu</b> (alt-ızgara tarifi): n<sub>H</sub> &gt; 0,1 cm⁻³, T &lt; 2×10⁴ K (ya da çözünürlük tabanında), ∇·v &lt; 0; olasılık 1 − exp(−ε Δt/t<sub>ff</sub>), ε = 0,05. <b>Süpernova</b> (anahtar): oluşan her M☉ için 10⁴⁹ erg ısıl enerji, ≈ 32 komşuya çekirdek ağırlıklı; ısıtılan parçacıkların soğuması 10 Myr kapatılır (aşırı soğumayı önlemek için ayarlanmış bir tarif).</li>
        <li><b>Çözünürlük tabanı.</b> Yoğun gazın Jeans kütlesi 2 N<sub>komşu</sub> parçacığın altına inmesin diye (Bate &amp; Burkert 1997) basınca h’ye bağlı bir taban konur; bu çözünürlükte diskin gerçekte olduğundan kalın ve ılık çıkmasının ana nedeni budur.</li>
        <li><b>Zaman.</b> Sıçrama (kick–drift–kick), tek küresel adım: Courant (C = 0,25, işaret hızı v<sub>sig</sub> = c<sub>i</sub> + c<sub>j</sub> − 2 w<sub>ij</sub>) ve ivme (η = 0,04) kriterleri, 0,2–5 Myr arasında kırpılır. Birkaç şok veya süpernova ısıtmalı parçacık herkesin adımını belirlemesin diye Courant adımı gaz parçacıklarının en küçük %1’lik diliminden alınır (en küçüğünün en fazla 2 katı: en hızlı parçacıklarda etkin C ≤ 0,5). Soğuma adımı sınırlamaz; kendi alt adımlarıyla (u asla negatif olmaz) integre edilir. Süpernova ısıtması sıcaklığı 10⁷ K ile sınırlar (fazlası atılır: yoksa adım mikroskobik olur).</li>
      </ul>
      <p class="note"><b>Sınırlar.</b> Parçacık kütlesi 10⁷–10⁸ M☉: gerçek bir galakside bu tek bir dev moleküler bulut kompleksinden ağırdır; disk çözünürlük yüzünden kalındır ve soğuk gaz kümelenmesi çözülemez. Yıldız oluşumu ve geri besleme birinci ilkelerden değil, ayarlanmış tariflerdir; sonuçlar tariflere duyarlıdır. Soğuma tablosu yaklaşıktır. Ağır karanlık madde parçacıkları diski yapay olarak ısıtabilir (iki cisim saçılması). Başlangıç koşulu yalıtılmış, dengede bir hale: kozmolojik büyüme, birleşmeler ve süzülen soğuk akımlar yok; bütün gaz aynı anda soğumaya başladığı için ilk ≈ 0,3 milyar yılda “soğuma akışı” gerçek bir galaksidekinden şiddetli. Çekirdek–tepe tartışması (süpernova kaynaklı gaz dalgalanmalarının karanlık madde merkezini düzleştirmesi, <a href="https://arxiv.org/abs/1106.0499" target="_blank" rel="noopener">Pontzen &amp; Governato 2012</a>) bu çözünürlükte güvenle sınanamaz: etki 1,5 kpc yumuşatma altında kalır; yukarıdaki satır koşunun gerçekte ne gösterdiğini olduğu gibi yazar. Hale ile disk kuramı için bkz. <a href="https://arxiv.org/abs/astro-ph/9707093" target="_blank" rel="noopener">Mo, Mao &amp; White 1998</a>.</p>`;
  }

  // ---- worker plumbing

  function send(m: ToWorker): void {
    worker?.postMessage(m);
  }

  function startWorker(): void {
    worker?.terminate();
    worker = new Worker(new URL('./galaxy.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FromWorker>) => receive(e.data);
    worker.onerror = () => {
      failed = true;
      stageEl.textContent = 'Hesaplama çalışanı başlatılamadı.';
    };
    sentRun = false;
    const r = RESOLUTIONS[resSel.value];
    send({ t: 'init', feedback: fbBox.checked, nDm: r.nDm, nGas: r.nGas });
  }

  function receive(m: FromWorker): void {
    mDm = m.info.mDm;
    last = m;
    if (!methodBody.dataset.n || methodBody.dataset.n !== `${m.info.nDm}/${m.info.nGas}`) {
      methodBody.dataset.n = `${m.info.nDm}/${m.info.nGas}`;
      methodBody.innerHTML = methodText(m);
    }
    sentRun = m.running;
    redraw();
    if (!m.running && wantRun && !sentRun && visible()) syncRun();
  }

  function redraw(): void {
    if (!last) return;
    drawView(faceCv, last, false);
    drawView(edgeCv, last, true);
    readouts(last);
    drawPlots(last.stats);
  }

  /** On screen: attached, not display:none (offsetParent), not visibility:hidden / opacity:0 (a closed drawer), tab in front. */
  const visible = (): boolean => {
    if (!container.isConnected || container.offsetParent === null || document.hidden) return false;
    const el = container as HTMLElement & { checkVisibility?: (o: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean };
    return el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
  };

  /** The worker runs only while the user wants it and the scene is on screen. */
  function syncRun(): void {
    if (!worker || failed) return;
    const go = wantRun && visible();
    if (go !== sentRun) {
      sentRun = go;
      send({ t: 'run', run: go });
    }
    playBtn.textContent = wantRun ? '❚❚ Durdur' : '▶ Oynat';
    playBtn.setAttribute('aria-pressed', String(wantRun));
  }

  function tick(): void {
    if (dead) return;
    if (!container.isConnected) {
      dispose();
      return;
    }
    if (!worker && visible()) startWorker();
    syncRun();
  }

  function dispose(): void {
    dead = true;
    window.clearInterval(timer);
    worker?.terminate();
    worker = null;
  }

  // ---- events

  playBtn.addEventListener('click', () => {
    wantRun = !wantRun;
    if (!worker && visible()) startWorker();
    syncRun();
  });
  const restart = (): void => {
    last = null;
    stageEl.textContent = 'Başlangıç koşulları kuruluyor…';
    if (visible() || worker) startWorker();
    syncRun();
  };
  resetBtn.addEventListener('click', restart);
  fbBox.addEventListener('change', restart);
  resSel.addEventListener('change', restart);
  layerBoxes.forEach((b) => b.addEventListener('change', redraw));

  stageEl.textContent = 'Başlangıç koşulları kuruluyor…';
  timer = window.setInterval(tick, 400);
  tick();
}
