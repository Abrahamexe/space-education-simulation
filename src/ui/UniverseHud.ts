import { Vector3 } from 'three';
import data from '../data/generated/universe.json';
import lgPhotos from '../data/generated/localgroup.json';
import { BASIN_TEXT, COMPOSITION, EVIDENCE, M33_ROTATION, type Evidence, DARK_MATTER_TEXT, FLOW_TEXT, GALAXIES_TEXT, GAS_TEXT, LY_PER_MPC, SCALES, type Landmark } from '../config/universe';
import type { Engine } from '../core/Engine';
import { radecUnit, EQ_TO_SCENE } from '../universe/UniverseModel';
import type { UniverseTarget, UniverseView } from '../universe/UniverseView';
import { icon } from './icons';
import { Lab } from './lab/Lab';
import type { LabAction } from './lab/content';
import { AGE_NOW, scaleAt, SIM_BOX } from '../universe/CosmicWebSim';

/** What happens when, for the formation time-lapse (upper bound in Gyr). */
const SIM_STAGES: readonly [number, string, string][] = [
  [0.001, 'Evren saydamlaşıyor', 'Madde neredeyse düzgün dağılmış. Renkler yüz binde birlik yoğunluk farkları: kozmik mikrodalga arka planda görülen, bütün yapıların tohumları.'],
  [0.18, 'Karanlık çağ', 'Henüz yıldız yok. Karanlık madde kendi çekimiyle yoğun yerlere toplanmaya başlıyor. Normal madde ışınımla bağlı olduğu için geride kalmıştı; şimdi karanlık maddenin açtığı çukurlara düşüyor.'],
  [1.0, 'İlk galaksiler', 'En yoğun düğümlerde gaz soğuyup çöküyor ve ilk galaksiler yanıyor (beyaz noktalar). Karanlık madde ince tabakalar ve ipliklere toplanıyor.'],
  [4.0, 'Kozmik öğle', 'Yıldız oluşumunun ve kuasarların zirvesi. Galaksiler ipliklerin kesiştiği düğümlerde kümeleşiyor, aradaki boşluklar büyüyor.'],
  [99, 'Bugüne doğru', 'Kozmik ağ tamamlandı: düğümlerde galaksi kümeleri, ipliklerde galaksi zincirleri, aralarında boşluklar. Karanlık enerji genişlemeyi hızlandırdığı için yapıların büyümesi yavaşlıyor.'],
];

function ageText(t: number): string {
  if (t < 0.001) return `${Math.round(t * 1e6).toLocaleString('tr-TR')} bin yıl`;
  if (t < 1) return `${Math.round(t * 1000).toLocaleString('tr-TR')} milyon yıl`;
  return `${t.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyar yıl`;
}
import { isTypingOrChord } from './Toolbar';

const CHAR_PX = 6.4;
const LABEL_H = 18;

/** Distance in light years, Turkish style (Mpc in). */
function lightYears(mpc: number): string {
  const ly = mpc * LY_PER_MPC;
  const f = (v: number, d = 1) => v.toLocaleString('tr-TR', { maximumFractionDigits: d });
  if (ly < 1e6) return `${f(ly / 1000, 0)} bin ışık yılı`;
  if (ly < 1e9) return `${f(ly / 1e6, ly < 1e7 ? 1 : 0)} milyon ışık yılı`;
  return `${f(ly / 1e9, 1)} milyar ışık yılı`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

interface Item {
  t: UniverseTarget;
  el: HTMLButtonElement;
  w: number;
  visible: boolean;
  x: number;
  y: number;
}

/**
 * Overlay of the universe map: the bottom bar (back to the galaxy, the four
 * scales, cinematic / science look, dark matter and flow layers, labels),
 * landmark labels (click flies there and opens a card) and the card.
 */
export class UniverseHud {
  private readonly root: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly card: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly items: Item[] = [];
  private selected: string | null = null;
  private labelsOn = true;
  private lastReadout = 0;

  constructor(
    engine: Engine,
    private readonly view: UniverseView,
  ) {
    // Landmarks plus the brighter Local Group members.
    const local: UniverseTarget[] = data.localGroup
      .filter((g) => (g.vmag ?? 0) < -13.5 && g.name !== 'The Galaxy')
      // Brightest first: they win where labels would overlap.
      .sort((a, b) => (a.vmag ?? 0) - (b.vmag ?? 0))
      .map((g) => {
        const def: Landmark = {
          id: `lg-${g.name}`,
          name: g.name,
          kind: 'galaxy',
          ra: g.ra,
          dec: g.dec,
          distMpc: g.dMpc,
          range: [0, 14],
          type: `Yerel Grup üyesi · ${g.type.trim() || 'galaksi'}`,
          text: `Yerel Grup’taki galaksilerden biri (McConnachie 2012 kataloğu). Samanyolu’na uzaklığı ${lightYears(g.dMpc)}.`,
          // Close enough to fill the view with its photo (or a dwarf's few kpc).
          frameMpc: Math.max(((lgPhotos.galaxies.find((p) => p.name === g.name)?.widthPc ?? 6000) / 1e6) * 1.8, 0.006),
        };
        return { def, distMpc: g.dMpc, position: radecUnit(g.ra, g.dec).applyMatrix4(EQ_TO_SCENE).normalize().multiplyScalar(g.dMpc) };
      });

    this.labels = document.createElement('div');
    this.labels.className = 'labels galaxy-labels universe-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    for (const t of [...view.targets, ...local]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'label';
      b.tabIndex = -1;
      b.dataset.kind = t.def.kind === 'home' ? 'sun' : t.def.kind;
      b.textContent = t.def.name;
      b.addEventListener('click', () => this.go(t));
      this.labels.appendChild(b);
      this.items.push({ t, el: b, w: t.def.name.length * CHAR_PX + 22, visible: false, x: 0, y: 0 });
    }

    this.bar = document.createElement('div');
    this.bar.className = 'galaxy-bar universe-bar cluster';
    this.bar.setAttribute('role', 'group');
    this.bar.setAttribute('aria-label', 'Evren haritası');
    this.bar.innerHTML = `
      <button type="button" class="pill" data-back>${icon('galaxy')}<span>Galaksiye dön</span></button>
      <div class="segmented universe-scales" role="radiogroup" aria-label="Ölçek">
        ${SCALES.map((s, i) => `<button type="button" role="radio" data-scale="${s.id}" title="${esc(s.name)} (${i + 1})">${esc(s.name)}</button>`).join('')}
      </div>
      <p class="galaxy-readout" aria-live="off"></p>
      <div class="segmented" role="radiogroup" aria-label="Görünüm">
        <button type="button" role="radio" data-look="cinematic">Sinematik</button>
        <button type="button" role="radio" data-look="science">Bilimsel</button>
      </div>
      <div class="universe-layers">
        <button type="button" class="pill" data-layers aria-haspopup="true" aria-expanded="false">Katmanlar</button>
        <div class="universe-layers-pop" role="group" aria-label="Katmanlar" data-open="false">
          <button type="button" class="ul-row" data-layer="galaxies" aria-pressed="true"><span class="ul-sw" style="--sw:#fff"></span>Galaksiler (yıldızlar)<kbd>G</kbd></button>
          <button type="button" class="ul-row" data-layer="darkMatter" aria-pressed="true"><span class="ul-sw" style="--sw:#3d7bff"></span>Karanlık madde<kbd>D</kbd></button>
          <button type="button" class="ul-row" data-layer="gas" aria-pressed="false"><span class="ul-sw" style="--sw:#ff6fc8"></span>Sıcak gaz (X-ışını)<kbd>X</kbd></button>
          <button type="button" class="ul-row" data-layer="flow" aria-pressed="true"><span class="ul-sw" style="--sw:#ffc46b"></span>Galaksi akışı<kbd>A</kbd></button>
          <button type="button" class="ul-row" data-layer="basin" aria-pressed="true"><span class="ul-sw" style="--sw:#f2b35e"></span>Laniakea sınırı<kbd>L</kbd></button>
        </div>
      </div>
      <button type="button" class="pill" data-composition title="Evren neyden yapılmış?">Bileşim</button>
      <button type="button" class="pill pill-accent" data-sim title="Kozmik ağ nasıl oluştu? (O)">Oluşum</button>
      <button type="button" class="pill pill-lab" data-lab title="Laboratuvar: denklemler, deneyler, grafikler, veri (T)">Laboratuvar</button>
      <button type="button" class="pill" data-film title="Film: karanlık madde ile normal madde nerede etkileşir?">Film</button>
      <div class="universe-layers">
        <button type="button" class="pill" data-evidence-btn aria-haspopup="true" aria-expanded="false" title="Karanlık maddeyi nereden biliyoruz?">Kanıtlar</button>
        <div class="universe-layers-pop" role="group" aria-label="Karanlık madde kanıtları" data-open="false" data-evidence-pop>
          ${EVIDENCE.map((e, i) => `<button type="button" class="ul-row" data-evidence="${e.id}"><span class="ev-n">${i + 1}</span>${esc(e.name)}<kbd>${esc(e.year.split(',').pop()!.trim().slice(0, 9))}</kbd></button>`).join('')}
        </div>
      </div>
      <button type="button" class="btn-icon" data-labels aria-pressed="true" aria-label="Etiketler" title="Etiketler (E)">${icon('labels')}</button>
      <button type="button" class="btn-icon" data-info aria-label="Bu harita nedir?" title="Bu harita nedir?">${icon('help')}</button>`;
    this.readout = this.bar.querySelector('.galaxy-readout') as HTMLElement;
    const q = <T extends HTMLElement>(s: string) => this.bar.querySelector(s) as T;
    q('[data-back]').addEventListener('click', () => void view.returnHome());
    const scaleBtns = [...this.bar.querySelectorAll<HTMLButtonElement>('[data-scale]')];
    scaleBtns.forEach((b) =>
      b.addEventListener('click', () => {
        const s = SCALES.find((x) => x.id === b.dataset.scale)!;
        void view.goScale(s);
        this.showScaleCard(s.id);
      }),
    );
    const lookBtns = [...this.bar.querySelectorAll<HTMLButtonElement>('[data-look]')];
    lookBtns.forEach((b) => b.addEventListener('click', () => (view.science = b.dataset.look === 'science')));
    const lab = q<HTMLButtonElement>('[data-labels]');
    const layersBtn = q<HTMLButtonElement>('[data-layers]');
    const layersPop = q<HTMLElement>('.universe-layers-pop');
    layersBtn.addEventListener('click', () => {
      const open = layersPop.dataset.open !== 'true';
      layersPop.dataset.open = String(open);
      layersBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('pointerdown', (e) => {
      if (layersPop.dataset.open === 'true' && !(e.target as HTMLElement).closest('.universe-layers')) {
        layersPop.dataset.open = 'false';
        layersBtn.setAttribute('aria-expanded', 'false');
      }
    });
    type LayerKey = 'galaxies' | 'darkMatter' | 'gas' | 'flow' | 'basin';
    const layerCards: Record<LayerKey, [string, string, string]> = {
      galaxies: ['Galaksiler', 'Normal madde · yıldızlar', GALAXIES_TEXT],
      darkMatter: ['Karanlık madde', 'Madde yoğunluğu haritası', DARK_MATTER_TEXT],
      gas: ['Sıcak gaz', 'Normal madde · X-ışını', GAS_TEXT],
      flow: ['Galaksi akışı', 'Cosmicflows-4 · doğrusal kuram', FLOW_TEXT],
      basin: ['Laniakea’nın sınırı', 'Çekim havzası', BASIN_TEXT],
    };
    const toggleLayer = (k: LayerKey) => {
      view[k] = !view[k];
      if (view[k]) this.showCard(...layerCards[k]);
    };
    const layerRows = [...this.bar.querySelectorAll<HTMLButtonElement>('[data-layer]')];
    layerRows.forEach((b) => b.addEventListener('click', () => toggleLayer(b.dataset.layer as LayerKey)));
    q('[data-composition]').addEventListener('click', () => this.showComposition());
    const evBtn = q<HTMLButtonElement>('[data-evidence-btn]');
    const evPop = q<HTMLElement>('[data-evidence-pop]');
    evBtn.addEventListener('click', () => {
      const open = evPop.dataset.open !== 'true';
      evPop.dataset.open = String(open);
      evBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('pointerdown', (e) => {
      if (evPop.dataset.open === 'true' && !(e.target as HTMLElement).closest('.universe-layers')) {
        evPop.dataset.open = 'false';
        evBtn.setAttribute('aria-expanded', 'false');
      }
    });
    evPop.querySelectorAll<HTMLButtonElement>('[data-evidence]').forEach((b) =>
      b.addEventListener('click', () => {
        evPop.dataset.open = 'false';
        evBtn.setAttribute('aria-expanded', 'false');
        const ev = EVIDENCE.find((x) => x.id === b.dataset.evidence)!;
        this.showEvidence(ev);
      }),
    );
    lab.addEventListener('click', () => this.setLabels(!this.labelsOn));
    q('[data-info]').addEventListener('click', () =>
      this.showCard(
        'Evren haritası',
        'Gerçek gözlem verisi',
        'Her nokta gerçek bir galaksi: yakın evren 2MRS (44 bin galaksi, bütün gökyüzü), uzak ağ SDSS (260 bin galaksi, kuzey gökyüzü), Yerel Grup McConnachie 2012 kataloğu. Mor parıltı galaksilerden hesaplanan karanlık madde yoğunluğu, çizgiler galaksi akışı, dış küre WMAP’in kozmik mikrodalga arka plan haritası. Uzaklıklar kırmızıya kaymadan (H0 = 70) hesaplandı.',
      ),
    );
    const sync = () => {
      lookBtns.forEach((b) => b.setAttribute('aria-checked', String((b.dataset.look === 'science') === view.science)));
      layerRows.forEach((b) => b.setAttribute('aria-pressed', String(view[b.dataset.layer as LayerKey])));
      lab.setAttribute('aria-pressed', String(this.labelsOn));
    };
    view.onSettingsChange(() => {
      sync();
      this.syncSim?.();
    });
    sync();
    this.syncScale = () => {
      const cur = view.currentScale().id;
      scaleBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scale === cur)));
    };
    this.syncLabelsBtn = sync;

    // Formation time-lapse panel.
    this.simPanel = document.createElement('div');
    this.simPanel.className = 'sim-panel';
    this.simPanel.dataset.open = 'false';
    this.simPanel.innerHTML = `
      <div class="sim-head">
        <div><p class="galaxy-card-type" data-sim-age></p><h3 data-sim-stage></h3></div>
        <button type="button" class="pill" data-sim-exit>Haritaya dön</button>
      </div>
      <p class="sim-text" data-sim-text></p>
      <div class="sim-controls">
        <button type="button" class="btn-icon" data-sim-play aria-label="Oynat / durdur"></button>
        <input type="range" min="0" max="1000" step="1" data-sim-slider aria-label="Zaman">
        <span class="sim-now">13,8 milyar yıl</span>
      </div>
      <div class="sim-layers">
        <button type="button" class="ul-row" data-sim-layer="darkMatter" aria-pressed="true"><span class="ul-sw" style="--sw:#4d7dff"></span>Karanlık madde</button>
        <button type="button" class="ul-row" data-sim-layer="gas" aria-pressed="true"><span class="ul-sw" style="--sw:#ff6fc8"></span>Gaz</button>
        <button type="button" class="ul-row" data-sim-layer="galaxies" aria-pressed="true"><span class="ul-sw" style="--sw:#fff"></span>Galaksiler</button>
        <button type="button" class="ul-row" data-sim-layer="slab" aria-pressed="true" title="Kutunun yalnızca 44 Mpc kalınlığındaki bir dilimi: ağ daha net görünür"><span class="ul-sw" style="--sw:#f2b35e"></span>İnce dilim</button>
      </div>
      <p class="sim-note">Kutu ${SIM_BOX} Mpc (yaklaşık 1 milyar ışık yılı) genişliğinde ve evrenle birlikte genişliyor; uzaklıklar bugünkü ölçekte. Zel’dovich yaklaşımı: büyük ölçekli yapının oluşumunu N-cisim benzetimleri gibi verir.</p>`;
    const sq = <T extends HTMLElement>(s: string) => this.simPanel.querySelector(s) as T;
    const slider = sq<HTMLInputElement>('[data-sim-slider]');
    const lt0 = Math.log10(3.8e-4);
    const lt1 = Math.log10(AGE_NOW);
    slider.addEventListener('input', () => {
      view.simRunning = false;
      view.simTime = 10 ** (lt0 + (Number(slider.value) / 1000) * (lt1 - lt0));
    });
    sq('[data-sim-play]').addEventListener('click', () => (view.simRunning = !view.simRunning));
    sq('[data-sim-exit]').addEventListener('click', () => view.exitSim());
    this.simPanel.querySelectorAll<HTMLButtonElement>('[data-sim-layer]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.simLayer as keyof typeof view.simLayers;
        view.setSimLayer(k, !view.simLayers[k]);
      }),
    );
    this.q('[data-sim]').addEventListener('click', () => (view.simActive ? view.exitSim() : view.enterSim()));
    this.syncSim = () => {
      const on = view.simActive;
      this.simPanel.dataset.open = String(on);
      this.root.dataset.sim = String(on);
      const t = view.simTime;
      slider.value = String(Math.round(((Math.log10(t) - lt0) / (lt1 - lt0)) * 1000));
      const a = scaleAt(t);
      sq('[data-sim-age]').textContent = `Evren ${ageText(t)} yaşında · kırmızıya kayma z = ${t < 0.001 ? '≈ 1100' : (1 / a - 1).toLocaleString('tr-TR', { maximumFractionDigits: a < 0.01 ? 0 : 1 })}`;
      const stage = SIM_STAGES.find((s) => t <= s[0])!;
      sq('[data-sim-stage]').textContent = stage[1];
      const text = sq('[data-sim-text]');
      if (text.textContent !== stage[2]) text.textContent = stage[2];
      const play = sq('[data-sim-play]');
      play.innerHTML = icon(view.simRunning ? 'pause' : 'play');
      this.simPanel.querySelectorAll<HTMLButtonElement>('[data-sim-layer]').forEach((b) =>
        b.setAttribute('aria-pressed', String(view.simLayers[b.dataset.simLayer as keyof typeof view.simLayers])),
      );
    };

    this.card = document.createElement('div');
    this.card.className = 'galaxy-card';
    this.card.setAttribute('role', 'status');
    this.card.dataset.open = 'false';

    const credit = document.createElement('p');
    credit.className = 'galaxy-credit';
    credit.textContent = 'Veri: 2MRS (Huchra+ 2012) · SDSS DR17 · McConnachie 2012 · CMB: NASA/WMAP Bilim Ekibi';

    this.root = document.createElement('div');
    this.root.className = 'galaxy-hud universe-hud';
    // The student lab: its own drawer, apart from the map's controls.
    this.lab = new Lab(view, (a) => this.runLab(a), (html) => this.showHtml('Seçilen galaksi', '2MRS kataloğu', html));
    this.q('[data-lab]').addEventListener('click', () => this.lab.toggle());
    this.q('[data-film]').addEventListener('click', () => void this.lab.openFilm());
    this.root.append(this.simPanel, this.bar, this.card, credit, this.lab.el);
    document.body.append(this.labels, this.root);

    window.addEventListener('keydown', (e) => {
      if (!view.active || isTypingOrChord(e)) return;
      if (e.key === 'Escape') {
        if (this.lab.isOpen) this.lab.close();
        else if (this.card.dataset.open === 'true') this.closeCard();
        else void view.returnHome();
      } else if (e.code === 'KeyE') this.setLabels(!this.labelsOn);
      else if (e.code === 'KeyD') toggleLayer('darkMatter');
      else if (e.code === 'KeyA') toggleLayer('flow');
      else if (e.code === 'KeyL') toggleLayer('basin');
      else if (e.code === 'KeyX') toggleLayer('gas');
      else if (e.code === 'KeyO') view.simActive ? view.exitSim() : view.enterSim();
      else if (e.code === 'KeyT') this.lab.toggle();
      else if (e.code === 'Space' && view.simActive && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        view.simRunning = !view.simRunning;
      }
      else if (e.code === 'KeyG') toggleLayer('galaxies');
      else if (e.code === 'KeyB') view.science = !view.science;
      else if (/^Digit[1-4]$/.test(e.code)) {
        const s = SCALES[Number(e.code.slice(5)) - 1];
        void view.goScale(s);
        this.showScaleCard(s.id);
      }
    });
    view.onActiveChange((on) => {
      if (!on) {
        this.closeCard();
        for (const it of this.items) this.setVisible(it, false);
      } else this.showScaleCard('laniakea');
    });
    engine.addLate({ update: () => this.update() }, 31);
  }

  private readonly syncScale: () => void;
  private readonly simPanel: HTMLElement;
  private readonly lab: Lab;

  /** A lab "show me" button: drive the map. */
  private runLab(a: LabAction): void {
    const v = this.view;
    if (a.kind === 'target') {
      const it = this.items.find((x) => x.t.def.id === a.id);
      if (v.simActive) v.exitSim();
      if (it) this.go(it.t);
    } else if (a.kind === 'scale') {
      if (v.simActive) v.exitSim();
      const s = SCALES.find((x) => x.id === a.id);
      if (s) void v.goScale(s);
    } else if (a.kind === 'layer') {
      if (v.simActive) v.exitSim();
      v[a.layer] = true;
    } else if (a.kind === 'sim') v.enterSim();
  }

  /** A card with ready-made HTML (inspector results). */
  private showHtml(name: string, type: string, html: string): void {
    this.card.dataset.wide = 'false';
    this.card.innerHTML = `
      <div class="galaxy-card-head">
        <div><p class="galaxy-card-type">${esc(type)}</p><h3>${esc(name)}</h3></div>
        <button type="button" class="btn-icon" aria-label="Kapat">${icon('close')}</button>
      </div>${html}`;
    (this.card.querySelector('button') as HTMLElement).addEventListener('click', () => this.closeCard());
    this.card.dataset.open = 'true';
  }
  private syncSim: (() => void) | null = null;
  private q<T extends HTMLElement>(s: string): T {
    return this.bar.querySelector(s) as T;
  }
  private readonly syncLabelsBtn: () => void;

  private setLabels(on: boolean): void {
    this.labelsOn = on;
    this.syncLabelsBtn();
  }

  private go(t: UniverseTarget): void {
    void this.view.goTarget(t);
    this.selected = t.def.id;
    const stats = t.distMpc > 0 ? `${lightYears(t.distMpc)} uzakta` : '';
    this.showCard(t.def.name, [t.def.type, stats].filter(Boolean).join(' · '), t.def.text);
    for (const it of this.items) it.el.dataset.state = it.t.def.id === t.def.id ? 'selected' : '';
  }

  private showScaleCard(id: string): void {
    const s = SCALES.find((x) => x.id === id);
    if (s) this.showCard(s.name, 'Ölçek', s.text);
  }

  private showCard(name: string, type: string, text: string): void {
    this.card.dataset.wide = 'false';
    this.card.innerHTML = `
      <div class="galaxy-card-head">
        <div><p class="galaxy-card-type">${esc(type)}</p><h3>${esc(name)}</h3></div>
        <button type="button" class="btn-icon" aria-label="Kapat">${icon('close')}</button>
      </div>
      <p class="galaxy-card-text">${esc(text)}</p>`;
    (this.card.querySelector('button') as HTMLElement).addEventListener('click', () => this.closeCard());
    this.card.dataset.open = 'true';
  }

  /** Fly to an evidence stop and open its card (picture or chart, what we see, what it means). */
  private showEvidence(ev: Evidence): void {
    const it = this.items.find((x) => x.t.def.id === ev.target);
    if (it) {
      void this.view.goTarget(it.t);
      this.selected = it.t.def.id;
      for (const o of this.items) o.el.dataset.state = o === it ? 'selected' : '';
    }
    const n = EVIDENCE.indexOf(ev);
    const media = ev.chart === 'rotation'
      ? this.rotationChart()
      : ev.image
        ? `<figure class="ev-fig"><img src="${import.meta.env.BASE_URL}textures/evidence/${ev.image.file}" alt="${esc(ev.type)}" loading="lazy"><figcaption>${esc(ev.image.credit)}</figcaption></figure>`
        : '';
    this.card.innerHTML = `
      <div class="galaxy-card-head">
        <div><p class="galaxy-card-type">Kanıt ${n + 1}/${EVIDENCE.length} · ${esc(ev.year)}</p><h3>${esc(ev.name)}</h3></div>
        <button type="button" class="btn-icon" aria-label="Kapat">${icon('close')}</button>
      </div>
      <p class="ev-sub">${esc(ev.type)}</p>
      ${media}
      <h4 class="comp-h">Ne görüyoruz?</h4><p class="galaxy-card-text">${esc(ev.see)}</p>
      <h4 class="comp-h">Ne anlama geliyor?</h4><p class="galaxy-card-text">${esc(ev.means)}</p>
      <div class="ev-nav">
        <button type="button" class="pill" data-ev-step="-1" ${n === 0 ? 'disabled' : ''}>Önceki</button>
        <button type="button" class="pill" data-ev-step="1" ${n === EVIDENCE.length - 1 ? 'disabled' : ''}>Sonraki kanıt</button>
      </div>`;
    this.card.dataset.wide = 'true';
    (this.card.querySelector('.btn-icon') as HTMLElement).addEventListener('click', () => this.closeCard());
    this.card.querySelectorAll<HTMLButtonElement>('[data-ev-step]').forEach((b) =>
      b.addEventListener('click', () => this.showEvidence(EVIDENCE[n + Number(b.dataset.evStep)])),
    );
    this.card.dataset.open = 'true';
  }

  /** M33: measured rotation (white) against what stars and gas alone would give (orange). */
  private rotationChart(): string {
    const W = 360;
    const H = 190;
    const L = 34;
    const B = 26;
    const x = (r: number) => L + (r / 16) * (W - L - 10);
    const y = (v: number) => H - B - (v / 140) * (H - B - 10);
    const path = (pts: readonly (readonly [number, number])[]) => pts.map(([r, v], i) => `${i ? 'L' : 'M'}${x(r).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ticksX = [0, 4, 8, 12, 16].map((r) => `<text x="${x(r)}" y="${H - 8}" text-anchor="middle">${r}</text>`).join('');
    const ticksY = [0, 50, 100].map((v) => `<line x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
    return `<figure class="ev-fig ev-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="M33 dönme eğrisi: ölçülen hız kenarda düşmüyor, görünen maddeden beklenen hız düşüyor">
        ${ticksY}${ticksX}
        <path d="${path(M33_ROTATION.visible)}" class="visible"/>
        <path d="${path(M33_ROTATION.observed)}" class="observed"/>
        <text x="${x(16)}" y="${y(126) - 8}" text-anchor="end" class="lab-obs">ölçülen</text>
        <text x="${x(16)}" y="${y(44) - 8}" text-anchor="end" class="lab-vis">yalnızca görünen madde</text>
        <text x="${W - 10}" y="${H - B - 6}" text-anchor="end" class="axis">merkezden uzaklık (bin parsek) →</text>
        <text x="4" y="12" class="axis">km/s</text>
      </svg>
      <figcaption>Yaklaşık değerler: Corbelli ve Salucci 2000; Corbelli ve ark. 2014</figcaption></figure>`;
  }

  /** What the universe is made of: today, at 380 000 years, and where ordinary matter is. */
  private showComposition(): void {
    const bar = (rows: readonly { label: string; pct: number; color: string }[]) =>
      `<div class="comp-bar">${rows.map((r) => `<span style="flex:${r.pct};background:${r.color}" title="${esc(r.label)} %${r.pct}"></span>`).join('')}</div>
       <ul class="comp-legend">${rows.map((r) => `<li><i style="background:${r.color}"></i>${esc(r.label)}<b>%${r.pct.toLocaleString('tr-TR')}</b></li>`).join('')}</ul>`;
    this.card.dataset.wide = 'false';
    this.card.innerHTML = `
      <div class="galaxy-card-head">
        <div><p class="galaxy-card-type">Planck 2018 · WMAP · Shull+ 2012</p><h3>Evren neyden yapılmış?</h3></div>
        <button type="button" class="btn-icon" aria-label="Kapat">${icon('close')}</button>
      </div>
      <h4 class="comp-h">Bugün</h4>${bar(COMPOSITION.today)}
      <h4 class="comp-h">380 bin yaşındayken (CMB’nin salındığı an)</h4>${bar(COMPOSITION.early)}
      <h4 class="comp-h">Normal madde bugün nerede?</h4>${bar(COMPOSITION.baryons)}
      <p class="galaxy-card-text">Gördüğümüz her şey (yıldızlar, gaz, gezegenler, biz) evrenin yalnızca %5’i. Karanlık madde ondan beş kat fazla ve kozmik ağın iskeletini kurar; normal madde onun çukurlarına akar. Karanlık enerji ise evrenin genişlemesini hızlandırır. Erken evrende fotonlar ve nötrinolar da önemliydi; genişlemeyle enerjileri seyreldi.</p>`;
    (this.card.querySelector('button') as HTMLElement).addEventListener('click', () => this.closeCard());
    this.card.dataset.open = 'true';
  }

  private closeCard(): void {
    this.selected = null;
    this.card.dataset.wide = 'false';
    this.card.dataset.open = 'false';
    for (const it of this.items) it.el.dataset.state = '';
  }

  private setVisible(it: Item, v: boolean): void {
    if (it.visible === v) return;
    it.visible = v;
    it.el.dataset.visible = String(v);
  }

  private readonly tmp = new Vector3();

  private update(): void {
    const view = this.view;
    if (!view.active) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const d = view.distance;
    if (view.simActive) {
      for (const it of this.items) this.setVisible(it, false);
      const now = performance.now();
      if (now - this.lastReadout > 120) {
        this.lastReadout = now;
        this.syncSim?.();
      }
      return;
    }
    const placed: { x: number; y: number; w: number }[] = [];
    const order = [...this.items].sort((a, b) => Number(b.t.def.id === this.selected) - Number(a.t.def.id === this.selected));
    for (const it of order) {
      const t = it.t;
      let show = this.labelsOn && d >= t.def.range[0] && d <= t.def.range[1];
      // Not when the camera sits right on it (the card says what it is).
      if (show && t.def.kind !== 'edge' && view.camera.position.distanceTo(t.position) < t.def.frameMpc * 0.05) show = false;
      if (t.def.id === this.selected) show = true;
      let p = null;
      if (show) {
        // The CMB label sits on the sphere straight ahead.
        const pos = t.def.kind === 'edge' ? this.tmp.set(0, 0, -1).applyQuaternion(view.camera.quaternion).multiplyScalar(t.distMpc) : t.position;
        p = view.project(pos, w, h);
      }
      if (!p || p.x < -40 || p.x > w + 40 || p.y < -20 || p.y > h + 20) show = false;
      if (show && p) {
        const x = p.x + 8;
        const y = p.y - LABEL_H / 2;
        const hit = placed.some((o) => x < o.x + o.w && x + it.w > o.x && Math.abs(y - o.y) < LABEL_H);
        if (hit && t.def.id !== this.selected) show = false;
        else {
          placed.push({ x, y, w: it.w });
          if (Math.abs(x - it.x) > 0.25 || Math.abs(y - it.y) > 0.25) {
            it.x = x;
            it.y = y;
            it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          }
        }
      }
      this.setVisible(it, show);
    }
    const now = performance.now();
    if (now - this.lastReadout > 200) {
      this.lastReadout = now;
      this.readout.textContent = `Samanyolu’na ${lightYears(Math.max(d, 0.001))}`;
      this.syncScale();
    }
  }
}
