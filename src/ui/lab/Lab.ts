import lab from '../../data/generated/lab.json';
import { M33_ROTATION } from '../../config/universe';
import type { UniverseView } from '../../universe/UniverseView';
import { icon } from '../icons';
import { CONCEPTS, DM_UNKNOWNS, EXERCISES, METHODS, type LabAction, type LabTab } from './content';
import { COSMO, G, MPC, MSUN, nfwSpeed, num, sci } from './physics';
import { plot, project } from './plot';

const TABS: [LabTab, string][] = [
  ['concepts', 'Kavramlar'],
  ['experiments', 'Deneyler'],
  ['interaction', 'Etkileşim'],
  ['plots', 'Grafikler'],
  ['data', 'Veri ve yöntem'],
  ['exercises', 'Alıştırmalar'],
];

const BASE = import.meta.env.BASE_URL;

/** M33 rotation: measured points get a representative ±6 km/s. */
const ROT_ERR = 6;

/** BBKS transfer function (k in 1/Mpc, h = 0.7). */
function bbks(k: number, Om: number): number {
  const q = k / (Om * 0.7 * 0.7);
  return Math.log(1 + 2.34 * q) / (2.34 * q) / (1 + 3.89 * q + (16.1 * q) ** 2 + (5.46 * q) ** 3 + (6.71 * q) ** 4) ** 0.25;
}

/** Linear ΛCDM P(k) in Mpc³, normalised to σ8 (R = 8/h Mpc). */
function linearPk(Om = 0.3, s8 = 0.81): (k: number) => number {
  const raw = (k: number) => k * bbks(k, Om) ** 2;
  const R = 8 / 0.7;
  let s = 0;
  const n = 2000;
  const l0 = Math.log(1e-4);
  const l1 = Math.log(10);
  for (let i = 0; i < n; i++) {
    const k = Math.exp(l0 + ((i + 0.5) / n) * (l1 - l0));
    const x = k * R;
    const w = (3 * (Math.sin(x) - x * Math.cos(x))) / x ** 3;
    s += raw(k) * w * w * k ** 3 * ((l1 - l0) / n);
  }
  const A = s8 ** 2 / (s / (2 * Math.PI ** 2));
  return (k) => A * raw(k);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

async function bin(file: string): Promise<Float32Array> {
  const r = await fetch(`${BASE}data/universe/${file}`);
  return new Float32Array(await r.arrayBuffer());
}

/**
 * The student lab: a drawer beside the universe map with its own tabs, kept
 * apart from the map's controls. Concepts with equations and worked numbers,
 * hands-on experiments, plots of the real data behind the map, the data and
 * method pages with references, and exercises. "Show me" buttons drive the map.
 */
export class Lab {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private tab: LabTab = 'concepts';
  private readonly rendered = new Set<LabTab>();
  private readonly panes = new Map<LabTab, HTMLElement>();
  private inspector = false;

  constructor(
    private readonly view: UniverseView,
    private readonly run: (a: LabAction) => void,
    private readonly showGalaxy: (html: string) => void,
  ) {
    const el = document.createElement('aside');
    el.className = 'lab';
    el.dataset.open = 'false';
    el.setAttribute('aria-label', 'Laboratuvar');
    el.innerHTML = `
      <header class="lab-head">
        <div><p class="galaxy-card-type">Öğrenme alanı</p><h2>Laboratuvar</h2></div>
        <button type="button" class="btn-icon" data-lab-close aria-label="Kapat">${icon('close')}</button>
      </header>
      <nav class="lab-tabs" role="tablist">${TABS.map(([id, name]) => `<button type="button" role="tab" data-lab-tab="${id}">${name}</button>`).join('')}</nav>
      <div class="lab-body"></div>`;
    this.el = el;
    this.body = el.querySelector('.lab-body') as HTMLElement;
    for (const [id] of TABS) {
      const p = document.createElement('section');
      p.className = 'lab-pane';
      p.dataset.pane = id;
      this.body.appendChild(p);
      this.panes.set(id, p);
    }
    el.querySelector('[data-lab-close]')!.addEventListener('click', () => this.close());
    el.querySelectorAll<HTMLButtonElement>('[data-lab-tab]').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.labTab as LabTab)));
    // "Show me" buttons anywhere in the lab.
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (b) this.act(JSON.parse(b.dataset.act!) as LabAction);
    });
    // Inspector: a click (not a drag) on the map picks a 2MRS galaxy.
    let down: { x: number; y: number } | null = null;
    const canvas = document.querySelector('canvas');
    canvas?.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas?.addEventListener('pointerup', (e) => {
      if (!this.inspector || !down || !view.active || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      void this.inspect(e.clientX, e.clientY);
    });
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  open(tab: LabTab = this.tab, anchor?: string): void {
    this.el.dataset.open = 'true';
    this.show(tab, anchor);
  }

  close(): void {
    this.el.dataset.open = 'false';
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private show(tab: LabTab, anchor?: string): void {
    this.tab = tab;
    this.el.querySelectorAll<HTMLButtonElement>('[data-lab-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.labTab === tab)));
    for (const [id, p] of this.panes) p.hidden = id !== tab;
    if (!this.rendered.has(tab)) {
      this.rendered.add(tab);
      void this.render(tab);
    }
    if (anchor) requestAnimationFrame(() => this.panes.get(tab)!.querySelector(`[data-anchor="${anchor}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    else this.body.scrollTop = 0;
  }

  private act(a: LabAction): void {
    if (a.kind === 'tab') this.show(a.tab, a.anchor);
    else this.run(a);
  }

  private btn(label: string, a: LabAction): string {
    return `<button type="button" class="pill lab-act" data-act='${JSON.stringify(a).replace(/'/g, '&#39;')}'>${label}</button>`;
  }

  private async render(tab: LabTab): Promise<void> {
    const p = this.panes.get(tab)!;
    if (tab === 'concepts') {
      p.innerHTML = `<p class="lab-intro">Haritada gördüğün her şeyin arkasındaki fizik. Her başlıkta denklem, bu uygulamanın kendi verisiyle yapılmış bir hesap ve haritada göstermek için düğmeler var.</p>
        ${CONCEPTS.map((c) => `<details class="lab-card" data-anchor="${c.id}"><summary><span>${c.title}</span><em>${c.question}</em></summary>${c.body()}<div class="lab-acts">${c.actions.map((x) => this.btn(x.label, x.action)).join('')}</div></details>`).join('')}`;
      (p.querySelector('details') as HTMLDetailsElement | null)?.setAttribute('open', '');
    } else if (tab === 'experiments') this.renderExperiments(p);
    else if (tab === 'interaction') await this.renderInteraction(p);
    else if (tab === 'plots') await this.renderPlots(p);
    else if (tab === 'data') this.renderData(p);
    else this.renderExercises(p);
  }

  // ---- Dark matter ↔ ordinary matter ------------------------------------------------------

  /** Four scenes; the heavy ones (simulations in workers) load only when this tab opens. */
  private async renderInteraction(p: HTMLElement): Promise<void> {
    p.innerHTML = `
      <p class="lab-intro">Karanlık madde ile normal madde yalnızca kütleçekimiyle etkileşir; bütün farkı normal maddenin çarpışabilmesi, ışınım yapıp soğuyabilmesi ve basınç oluşturabilmesi yaratır. Dört sahnede bunun sonuçlarını izle.</p>
      <section class="lab-card" data-anchor="bao"><h3>Sahne 1 · Erken evren: ses dalgası ve çukur</h3><div data-scene="bao"></div></section>
      <section class="lab-card" data-anchor="bullet"><h3>Sahne 2 · Mermi Kümesi: kim çarpışır, kim geçer?</h3><div data-scene="bullet"></div></section>
      <section class="lab-card" data-anchor="galaxy"><h3>Sahne 3 · Bir halede galaksi doğuyor</h3><div data-scene="galaxy"><p class="note">Yükleniyor…</p></div></section>
      <section class="lab-card" data-anchor="unknowns"><h3>Sahne 4 · Bildiklerimiz ve bilmediklerimiz</h3>${DM_UNKNOWNS}</section>`;
    const slot = (k: string) => p.querySelector(`[data-scene="${k}"]`) as HTMLElement;
    const [{ mountBao }, { mountBullet }] = await Promise.all([import('./scenes/bao'), import('./scenes/bullet')]);
    mountBao(slot('bao'));
    mountBullet(slot('bullet'));
    await this.mountGalaxyScene(slot('galaxy'));
  }

  /** Scene 3: galaxy formation in a dark-matter halo (N-body + SPH in a worker). */
  private async mountGalaxyScene(el: HTMLElement): Promise<void> {
    const { mountGalaxyFormation } = await import('./scenes/galaxy');
    el.innerHTML = '';
    mountGalaxyFormation(el);
  }

  // ---- Experiments -------------------------------------------------------------------------

  private renderExperiments(p: HTMLElement): void {
    p.innerHTML = `
      <section class="lab-card" data-anchor="rotation">
        <h3>1 · M33’e karanlık madde halesi uydur</h3>
        <p>Beyaz noktalar ölçülen dönme hızı, turuncu kesikli çizgi yalnızca yıldız ve gazın vereceği hız. Bir NFW halesi ekle: V<sub>200</sub> halenin büyüklüğü, c ne kadar merkezde toplandığı. Toplam hız v = √(v<sub>görünen</sub>² + v<sub>hale</sub>²).</p>
        <div data-rot-plot></div>
        <label class="lab-slider">V<sub>200</sub> <input type="range" min="0" max="160" step="1" value="0" data-rot-v><output data-rot-vo></output></label>
        <label class="lab-slider">c <input type="range" min="2" max="25" step="0.5" value="8" data-rot-c><output data-rot-co></output></label>
        <p class="lab-readout" data-rot-out></p>
        <div class="lab-acts"><button type="button" class="pill" data-rot-best>En iyi uyumu bul</button>${this.btn('M33’e git', { kind: 'target', id: 'lg-Üçgen (M33)' })}</div>
      </section>
      <section class="lab-card" data-anchor="beta">
        <h3>2 · β’yı kendin bul</h3>
        <p>Cosmicflows-4 gruplarının ölçülen özgün hızı (dikey) ile 2MRS yoğunluğundan öngörülen hız (yatay), öngörülen hıza göre kutulanmış (ortalama ± hata). β doğruysa noktalar y = x çizgisine oturur. Literatür değeri β = 0,43; bu ham alanla daha düşük çıkar (nedeni Kavramlar → Doğrusal kuram).</p>
        <div data-beta-plot></div>
        <label class="lab-slider">β <input type="range" min="0" max="1" step="0.01" value="0.2" data-beta><output data-beta-o></output></label>
        <label class="lab-check"><input type="checkbox" data-ext checked> Dış toplu akışı ekle (V<sub>dış</sub> = ${lab.cf4.vExtMag} km/s)</label>
        <label class="lab-check"><input type="checkbox" data-far> Uzak grupları da kat (cz ${num(lab.cf4.fitCz, 0)}–10 500 km/s; varsayılan yalnızca yakınlar)</label>
        <p class="lab-readout" data-beta-out></p>
      </section>
      <section class="lab-card" data-anchor="sim">
        <h3>3 · Başka bir evren kur</h3>
        <p>Oluşum benzetimini başka parametrelerle yeniden kur ve bugünkü hâlini karşılaştır. Başlangıç rastgele fazları aynı: farklar yalnızca fizikten.</p>
        <label class="lab-slider">σ<sub>8</sub> <input type="range" min="0.3" max="1.3" step="0.01" value="0.81" data-s8><output data-s8o></output></label>
        <label class="lab-slider">Ω<sub>m</sub> <input type="range" min="0.1" max="0.6" step="0.01" value="0.31" data-om><output data-omo></output></label>
        <label class="lab-check"><input type="checkbox" data-nodm> Karanlık madde yok (yalnızca normal madde, Ω<sub>m</sub> = 0,049)</label>
        <p class="lab-readout" data-sim-out></p>
        <div class="lab-acts"><button type="button" class="pill pill-accent" data-sim-apply>Benzetimde göster</button><button type="button" class="pill" data-sim-reset>Bizim evren</button></div>
      </section>`;
    this.rotationExperiment(p);
    void this.betaExperiment(p);
    this.simExperiment(p);
  }

  private rotationExperiment(p: HTMLElement): void {
    const vIn = p.querySelector('[data-rot-v]') as HTMLInputElement;
    const cIn = p.querySelector('[data-rot-c]') as HTMLInputElement;
    const obs = M33_ROTATION.observed;
    const vis = M33_ROTATION.visible;
    const model = (r: number, vb: number, v200: number, c: number) => Math.sqrt(vb * vb + (v200 > 0 ? nfwSpeed(r, v200, c) ** 2 : 0));
    const chi2 = (v200: number, c: number) => obs.reduce((s, [r, v], i) => s + ((v - model(r, vis[i][1], v200, c)) / ROT_ERR) ** 2, 0);
    const draw = () => {
      const v200 = Number(vIn.value);
      const c = Number(cIn.value);
      (p.querySelector('[data-rot-vo]') as HTMLElement).textContent = v200 ? `${v200} km/s` : 'hale yok';
      (p.querySelector('[data-rot-co]') as HTMLElement).textContent = num(c);
      const rs = Array.from({ length: 80 }, (_, i) => 0.3 + (i / 79) * 17);
      const visInterp = (r: number) => {
        for (let i = 1; i < vis.length; i++) if (r <= vis[i][0]) return vis[i - 1][1] + ((vis[i][1] - vis[i - 1][1]) * (r - vis[i - 1][0])) / (vis[i][0] - vis[i - 1][0]);
        return vis[vis.length - 1][1] * Math.sqrt(vis[vis.length - 1][0] / r);
      };
      const series: Parameters<typeof plot>[2] = [
        { kind: 'line', x: rs, y: rs.map(visInterp), cls: 's-vis', label: 'yıldız + gaz' },
        { kind: 'scatter', x: obs.map((o) => o[0]), y: obs.map((o) => o[1]), err: obs.map(() => ROT_ERR), cls: 's-obs', r: 2.4, label: 'ölçülen' },
      ];
      if (v200 > 0) {
        series.push({ kind: 'line', x: rs, y: rs.map((r) => nfwSpeed(r, v200, c)), cls: 's-halo', label: 'karanlık madde halesi' });
        series.push({ kind: 'line', x: rs, y: rs.map((r) => model(r, visInterp(r), v200, c)), cls: 's-total', label: 'toplam' });
      }
      (p.querySelector('[data-rot-plot]') as HTMLElement).innerHTML = plot(
        { min: 0, max: 17, label: 'merkezden uzaklık r (kpc)' },
        { min: 0, max: 150, label: 'dönme hızı v (km/s)' },
        series,
        'M33 dönme eğrisi ve hale uydurması',
      );
      const x2 = chi2(v200, c);
      const H0 = (COSMO.H0 * 1e3) / MPC;
      const m200 = v200 > 0 ? (v200 * 1e3) ** 3 / (10 * G * H0) / MSUN : 0;
      (p.querySelector('[data-rot-out]') as HTMLElement).innerHTML =
        `χ² / N = <b>${num(x2 / obs.length, 1)}</b> ${x2 / obs.length < 2 ? '· iyi uyum' : x2 / obs.length < 10 ? '· yaklaşıyor' : '· uymuyor'}` +
        (v200 > 0 ? ` · hale kütlesi M<sub>200</sub> = ${sci(m200)} M☉ (görünen maddenin ~${num(m200 / 1e10, 0)} katı)` : ' · hale olmadan dış noktalar açıklanamıyor');
    };
    vIn.addEventListener('input', draw);
    cIn.addEventListener('input', draw);
    p.querySelector('[data-rot-best]')!.addEventListener('click', () => {
      let best = [0, 8, Infinity];
      for (let v = 20; v <= 160; v += 1) for (let c = 2; c <= 25; c += 0.5) {
        const x = chi2(v, c);
        if (x < best[2]) best = [v, c, x];
      }
      vIn.value = String(best[0]);
      cIn.value = String(best[1]);
      draw();
    });
    draw();
  }

  private async betaExperiment(p: HTMLElement): Promise<void> {
    const f = await bin('cf4fit.bin');
    const n = f.length / 5;
    const bIn = p.querySelector('[data-beta]') as HTMLInputElement;
    const ext = p.querySelector('[data-ext]') as HTMLInputElement;
    const far = p.querySelector('[data-far]') as HTMLInputElement;
    const use = (i: number) => far.checked || f[i * 5] < lab.cf4.fitCz;
    const chi2 = (b: number, e: boolean) => {
      let s = 0;
      let m = 0;
      for (let i = 0; i < n; i++) {
        if (!use(i)) continue;
        s += ((f[i * 5 + 1] - b * f[i * 5 + 3] - (e ? f[i * 5 + 4] : 0)) / f[i * 5 + 2]) ** 2;
        m++;
      }
      return s / Math.max(m, 1);
    };
    const betas = Array.from({ length: 101 }, (_, i) => i / 100);
    const draw = () => {
      const b = Number(bIn.value);
      const e = ext.checked;
      (p.querySelector('[data-beta-o]') as HTMLElement).textContent = num(b, 2);
      // Bin the groups by predicted velocity.
      const NB = 16;
      const sum = new Float64Array(NB);
      const sum2 = new Float64Array(NB);
      const cnt = new Float64Array(NB);
      for (let i = 0; i < n; i++) {
        if (!use(i)) continue;
        const pred = b * f[i * 5 + 3] + (e ? f[i * 5 + 4] : 0);
        const k = Math.floor(((pred + 800) / 1600) * NB);
        if (k < 0 || k >= NB) continue;
        sum[k] += f[i * 5 + 1];
        sum2[k] += f[i * 5 + 1] ** 2;
        cnt[k]++;
      }
      const xs: number[] = [];
      const ys: number[] = [];
      const es: number[] = [];
      for (let k = 0; k < NB; k++) {
        if (cnt[k] < 20) continue;
        const m = sum[k] / cnt[k];
        xs.push(-800 + ((k + 0.5) / NB) * 1600);
        ys.push(m);
        es.push(Math.sqrt(Math.max(sum2[k] / cnt[k] - m * m, 0) / cnt[k]));
      }
      (p.querySelector('[data-beta-plot]') as HTMLElement).innerHTML = plot(
        { min: -800, max: 800, label: 'öngörülen özgün hız (km/s)' },
        { min: -800, max: 800, label: 'ölçülen özgün hız (km/s)' },
        [
          { kind: 'line', x: [-800, 800], y: [-800, 800], cls: 's-ref', label: 'y = x (kusursuz uyum)' },
          { kind: 'scatter', x: xs, y: ys, err: es, cls: 's-obs', r: 2.6, label: 'kutu ortalaması' },
        ],
        'Ölçülen ve öngörülen özgün hızlar',
      );
      const c = betas.map((x) => chi2(x, e));
      let bi = 0;
      for (let i = 1; i < c.length; i++) if (c[i] < c[bi]) bi = i;
      const cur = chi2(b, e);
      (p.querySelector('[data-beta-out]') as HTMLElement).innerHTML =
        `χ² / N = <b>${num(cur, 3)}</b> · en iyi β = <b>${num(betas[bi], 2)}</b> (χ² / N = ${num(c[bi], 3)}). ` +
        `Literatür: β = 0,43 (Wiener süzgeçli alan). Fark, gürültülü öngörücünün eğimi seyreltmesinden: uzak grupları katınca β’nın nasıl düştüğüne bak.`;
    };
    bIn.addEventListener('input', draw);
    ext.addEventListener('change', draw);
    far.addEventListener('change', draw);
    draw();
  }

  private simExperiment(p: HTMLElement): void {
    const s8 = p.querySelector('[data-s8]') as HTMLInputElement;
    const om = p.querySelector('[data-om]') as HTMLInputElement;
    const nodm = p.querySelector('[data-nodm]') as HTMLInputElement;
    const out = p.querySelector('[data-sim-out]') as HTMLElement;
    const sync = () => {
      (p.querySelector('[data-s8o]') as HTMLElement).textContent = num(Number(s8.value), 2);
      (p.querySelector('[data-omo]') as HTMLElement).textContent = num(Number(om.value), 2);
      s8.disabled = om.disabled = nodm.checked;
      out.innerHTML = nodm.checked
        ? 'Yalnızca normal madde: dalgalanmalar CMB’deki 10⁻⁵’ten başlayıp bugüne ancak ~10⁻² olur. Benzetimde genlik buna göre ~%1’e iner: ağ ve galaksi oluşmaz.'
        : `Genlik σ<sub>8</sub>/0,81 = ${num(Number(s8.value) / 0.81, 2)}; daha küçük σ<sub>8</sub> daha az ve daha geç yapı, daha küçük Ω<sub>m</sub> daha düz bir güç spektrumu ve daha erken duran büyüme demek.`;
    };
    s8.addEventListener('input', sync);
    om.addEventListener('input', sync);
    nodm.addEventListener('change', sync);
    p.querySelector('[data-sim-apply]')!.addEventListener('click', () => {
      this.view.rebuildSim(nodm.checked ? { amp: 0.012, om: 0.049 } : { amp: Number(s8.value) / 0.81, om: Number(om.value) });
    });
    p.querySelector('[data-sim-reset]')!.addEventListener('click', () => {
      s8.value = '0.81';
      om.value = '0.31';
      nodm.checked = false;
      sync();
      this.view.rebuildSim({ amp: 1, om: 0.31 });
    });
    sync();
  }

  // ---- Plots ---------------------------------------------------------------------------

  private async renderPlots(p: HTMLElement): Promise<void> {
    p.innerHTML = `
      <section class="lab-card" data-anchor="hubble">
        <h3>Hubble diyagramı</h3>
        <p>Cosmicflows-4’teki ${num(lab.cf4.hubble, 0)} grubun bağımsız ölçülen uzaklığı (Cepheid, TRGB, Tully–Fisher, süpernova…) ile kırmızıya kayma hızı. Eğim H<sub>0</sub>; noktaların saçılması özgün hızlar ve uzaklık hataları.</p>
        <div data-hub-plot></div>
        <label class="lab-slider">H<sub>0</sub> <input type="range" min="50" max="90" step="0.5" value="70" data-h0><output data-h0o></output></label>
        <p class="lab-readout" data-hub-out></p>
      </section>
      <section class="lab-card" data-anchor="pk">
        <h3>Güç spektrumu P(k)</h3>
        <p>Yoğunluk dalgalanmalarının ölçeğe göre gücü: büyük k küçük ölçek. 2MRS galaksilerinden ölçülen (noktalar) ile ΛCDM’nin doğrusal öngörüsü × b² (çizgi).</p>
        <div data-pk-plot></div>
        <p class="note">En büyük ölçeklerde (k &lt; 0,03) tahmin, gözlenen hacmin sınırlı olmasından etkilenir; küçük ölçeklerde ise doğrusal kuram geçersizleşir ve atış gürültüsü eklenir.</p>
      </section>
      <section class="lab-card" data-anchor="hist">
        <h3>Yoğunluk dağılımı</h3>
        <p>150 Mpc içinde, 3 Mpc yumuşatılmış yoğunluk alanında log₁₀(1 + δ) dağılımı. Hacmin çoğu ortalamanın altında (boşluklar); az sayıda hücre çok yoğun (kümeler): neredeyse log-normal.</p>
        <div data-hist-plot></div>
      </section>`;
    // Hubble diagram.
    const h = await bin('hubble.bin');
    const n = h.length / 3;
    const step = Math.max(1, Math.floor(n / 5000));
    const dx: number[] = [];
    const vy: number[] = [];
    for (let i = 0; i < n; i += step) {
      dx.push(h[i * 3]);
      vy.push(h[i * 3 + 1]);
    }
    // Weighted least squares through the origin over d < 250 Mpc (σ_v ≈ 0.46 e_DM · v + 300).
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      const d = h[i * 3];
      const v = h[i * 3 + 1];
      if (d > 250) continue;
      const w = 1 / ((0.46 * h[i * 3 + 2] * v) ** 2 + 300 ** 2);
      sxy += w * d * v;
      sxx += w * d * d;
    }
    const best = sxy / sxx;
    const h0 = p.querySelector('[data-h0]') as HTMLInputElement;
    const drawH = () => {
      const H = Number(h0.value);
      (p.querySelector('[data-h0o]') as HTMLElement).textContent = `${num(H, 1)} km/s/Mpc`;
      (p.querySelector('[data-hub-plot]') as HTMLElement).innerHTML = plot(
        { min: 0, max: 300, label: 'uzaklık d (Mpc)' },
        { min: 0, max: 22000, label: 'hız cz (km/s)' },
        [
          { kind: 'scatter', x: dx, y: vy, cls: 's-dim', r: 0.9, label: 'galaksi grupları' },
          { kind: 'line', x: [0, 300], y: [0, 300 * H], cls: 's-total', label: `v = ${num(H, 1)} · d` },
        ],
        'Hubble diyagramı',
      );
      (p.querySelector('[data-hub-out]') as HTMLElement).innerHTML =
        `En iyi eğim (d &lt; 250 Mpc, ağırlıklı): <b>H<sub>0</sub> = ${num(best, 1)} km/s/Mpc</b>. Cosmicflows-4’ün uzaklık ölçeği ~75 verir; Planck’ın CMB’den bulduğu 67,4 ile bu fark “Hubble gerilimi” olarak bilinen açık bir sorundur.`;
    };
    h0.addEventListener('input', drawH);
    drawH();
    // P(k).
    const pk = lab.pk.filter((x) => x[1] > 0);
    const lin = linearPk();
    const ks = Array.from({ length: 60 }, (_, i) => 0.015 * (1 / 0.015) ** (i / 59));
    (p.querySelector('[data-pk-plot]') as HTMLElement).innerHTML = plot(
      { min: 0.015, max: 1, log: true, label: 'dalga sayısı k (1/Mpc)', ticks: [0.02, 0.05, 0.1, 0.2, 0.5, 1] },
      { min: 300, max: 6e5, log: true, label: 'P(k) (Mpc³)' },
      [
        { kind: 'line', x: ks, y: ks.map((k) => lin(k) * 1.2 ** 2), cls: 's-halo', label: 'ΛCDM doğrusal × b² (b = 1,2)' },
        { kind: 'scatter', x: pk.map((x) => x[0]), y: pk.map((x) => x[1]), cls: 's-obs', r: 2.6, label: '2MRS (bu harita)' },
      ],
      'Güç spektrumu',
    );
    // Histogram.
    const hist = lab.hist;
    const nb = hist.counts.length;
    const xs = Array.from({ length: nb + 1 }, (_, i) => hist.from + (i / nb) * (hist.to - hist.from));
    const total = hist.counts.reduce((a, b) => a + b, 0);
    const ys = [...hist.counts.map((c) => c / total), hist.counts[nb - 1] / total];
    const [mx] = project({ min: -1.5, max: 1.5, label: '' }, { min: 0, max: 1, label: '' }, 0, 0);
    (p.querySelector('[data-hist-plot]') as HTMLElement).innerHTML = plot(
      { min: -1.5, max: 1.5, label: 'log₁₀(1 + δ)' },
      { min: 0, max: Math.max(...ys) * 1.15, label: 'hacim kesri' },
      [{ kind: 'step', x: xs, y: ys, cls: 's-halo' }],
      'Yoğunluk dağılımı',
      `<line class="s-ref line" x1="${mx}" x2="${mx}" y1="14" y2="222"/><text x="${mx + 4}" y="28" class="leg">ortalama (δ = 0)</text>`,
    );
  }

  // ---- Data and methods ----------------------------------------------------------------------

  private renderData(p: HTMLElement): void {
    p.innerHTML = `
      <section class="lab-card">
        <h3>Haritada incele</h3>
        <label class="lab-check"><input type="checkbox" data-real> Gerçek uzay: 2MRS galaksilerini öngörülen özgün hızları kadar görüş yönünde kaydır (cz/H<sub>0</sub> → gerçek uzaklık)</label>
        <p class="note">Kırmızıya kayma uzayında büyük yapılar görüş yönünde basık görünür (Kaiser etkisi); doğrusal kuram bunu düzeltir. Kümelerin içindeki hızlı hareketlerin yarattığı uzamalar (“Tanrı’nın parmakları”) doğrusal kuramla düzelmez.</p>
        <label class="lab-check"><input type="checkbox" data-sg> Süper galaktik koordinat ızgarası (50 Mpc’lik halkalar, SGX ve SGY eksenleri)</label>
        <label class="lab-check"><input type="checkbox" data-insp> İnceleyici: haritada bir galaksiye tıkla, katalog bilgisini gör (Laniakea ölçeğinde)</label>
        <div class="lab-insp" data-insp-out><p class="note">Henüz galaksi seçilmedi.</p></div>
      </section>
      <section class="lab-card"><h3>Veriler, yöntemler ve sınırlar</h3>
        ${METHODS.map((m) => `<details class="lab-method"><summary>${m.title}</summary>
          <dl><dt>Veri</dt><dd>${m.data}</dd><dt>Yöntem</dt><dd>${m.method}</dd><dt>Sınırlar</dt><dd>${m.limits}</dd>
          <dt>Kaynaklar</dt><dd><ul>${m.refs.map((r) => `<li><a href="${r.url}" target="_blank" rel="noopener">${esc(r.text)}</a></li>`).join('')}</ul></dd></dl></details>`).join('')}
      </section>`;
    const real = p.querySelector('[data-real]') as HTMLInputElement;
    real.addEventListener('change', () => {
      // Animate the shift over a second so the eye can follow it.
      const from = real.checked ? 0 : 1;
      const to = real.checked ? 1 : 0;
      const t0 = performance.now();
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / 1200);
        const e = u * u * (3 - 2 * u);
        void this.view.model.setRealSpace(from + (to - from) * e);
        if (u < 1) requestAnimationFrame(step);
      };
      step();
    });
    (p.querySelector('[data-sg]') as HTMLInputElement).addEventListener('change', (e) => (this.view.sgGrid.visible = (e.target as HTMLInputElement).checked));
    (p.querySelector('[data-insp]') as HTMLInputElement).addEventListener('change', (e) => {
      this.inspector = (e.target as HTMLInputElement).checked;
      if (this.inspector) void this.view.model.galaxyMeta();
    });
  }

  private async inspect(x: number, y: number): Promise<void> {
    const v = this.view;
    const i = v.model.pickGalaxy(x, y, (p) => v.project(p, window.innerWidth, window.innerHeight));
    const out = this.panes.get('data')!.querySelector('[data-insp-out]') as HTMLElement;
    if (i < 0) {
      out.innerHTML = '<p class="note">Tıklanan yerde 2MRS galaksisi yok (yakınlaşıp tekrar dene).</p>';
      return;
    }
    const [meta, vpec] = await Promise.all([v.model.galaxyMeta(), v.model.galaxyPecVel(i)]);
    const cz = meta.cz[i];
    const d = cz / COSMO.H0;
    const dReal = (cz - vpec) / COSMO.H0;
    const M = meta.k[i] - (5 * Math.log10(d) + 25);
    const html = `<dl class="lab-kv">
      <dt>Ad (2MASX)</dt><dd>J${esc(meta.id[i])}</dd>
      <dt>RA, Dec</dt><dd>${num(meta.ra[i], 3)}°, ${num(meta.dec[i], 3)}°</dd>
      <dt>Kırmızıya kayma</dt><dd>cz = ${num(cz, 0)} km/s (z = ${num(cz / 299792.458, 4)})</dd>
      <dt>Uzaklık (cz/H₀)</dt><dd>${num(d, 1)} Mpc</dd>
      <dt>Öngörülen özgün hız</dt><dd>${num(vpec, 0)} km/s → gerçek uzaklık ≈ ${num(dReal, 1)} Mpc</dd>
      <dt>K<sub>s</sub> kadiri</dt><dd>${num(meta.k[i], 2)} (mutlak M<sub>K</sub> ≈ ${num(M, 1)})</dd>
      <dt>Hubble tipi kodu</dt><dd>${esc(meta.type[i] || '—')}${/^9[89]/.test(meta.type[i]) ? ' (sınıflandırılmamış)' : ' (2MRS kodu: ilk rakam T tipi; ≤ 0 erken tip, > 0 sarmal)'}</dd></dl>
      <p class="note"><a href="https://ned.ipac.caltech.edu/byname?objname=2MASX%20J${encodeURIComponent(meta.id[i])}" target="_blank" rel="noopener">NED’de aç</a></p>`;
    out.innerHTML = html;
    this.showGalaxy(html);
  }

  // ---- Exercises ------------------------------------------------------------------------

  private renderExercises(p: HTMLElement): void {
    p.innerHTML = `<p class="lab-intro">Sayısal cevapları virgül ya da nokta ile, büyük sayıları 7.4e14 gibi yazabilirsin. Önce kendin dene; takılırsan ipucu, sonra çözüm.</p>
      ${EXERCISES.map((x, n) => `<section class="lab-card lab-ex" data-ex="${x.id}">
        <h3>${n + 1}. soru</h3><p>${x.q}</p>
        ${x.answer
          ? `<div class="lab-ans"><input type="text" inputmode="decimal" aria-label="Cevap" placeholder="cevap"><span>${x.answer.unit}</span><button type="button" class="pill" data-check>Kontrol et</button></div>`
          : `<div class="lab-choices">${x.choices!.map((c, i) => `<button type="button" class="ul-row" data-choice="${i}">${c.text}</button>`).join('')}</div>`}
        <p class="lab-fb" aria-live="polite"></p>
        <details><summary>İpucu</summary><p>${x.hint}</p></details>
        <details><summary>Çözüm</summary><p>${x.solution}</p></details>
      </section>`).join('')}`;
    p.querySelectorAll<HTMLElement>('[data-ex]').forEach((sec) => {
      const ex = EXERCISES.find((e) => e.id === sec.dataset.ex)!;
      const fb = sec.querySelector('.lab-fb') as HTMLElement;
      sec.querySelector('[data-check]')?.addEventListener('click', () => {
        const raw = (sec.querySelector('input') as HTMLInputElement).value.trim().replace(/\s/g, '').replace(',', '.').replace(/[×x]10\^?/i, 'e');
        const v = Number(raw);
        const a = ex.answer!;
        if (!Number.isFinite(v)) fb.textContent = 'Bir sayı yaz.';
        else if (Math.abs(v - a.value) <= Math.abs(a.value) * a.tol) {
          fb.textContent = 'Doğru!';
          fb.dataset.ok = 'true';
        } else {
          fb.textContent = v > a.value ? 'Biraz büyük çıktı, tekrar dene.' : 'Biraz küçük çıktı, tekrar dene.';
          fb.dataset.ok = 'false';
        }
      });
      sec.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) =>
        b.addEventListener('click', () => {
          const ok = !!ex.choices![Number(b.dataset.choice)].correct;
          fb.textContent = ok ? 'Doğru!' : 'Değil; çözüme bakabilirsin.';
          fb.dataset.ok = String(ok);
        }),
      );
    });
  }
}
