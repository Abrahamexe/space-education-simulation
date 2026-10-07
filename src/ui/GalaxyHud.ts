import { strings } from '../i18n';
import { PC_PER_LY } from '../config/galaxy';
import { CATEGORY_LABELS, DEEP_SKY, MILKY_WAY_FACTS, type Category, type Facts } from '../config/deepsky';
import { EXTRAGALACTIC } from '../config/extragalactic';
import type { Engine } from '../core/Engine';
import type { GalaxyTarget, GalaxyView } from '../galaxy/GalaxyView';
import { icon } from './icons';
import { isTypingOrChord } from './Toolbar';
import { science } from '../core/Science';
import { StarSystem, type SystemMember } from '../galaxy/objects/StarSystem';

const CHAR_PX = 6.4;
const LABEL_H = 18;
const KIND_PRIORITY: Record<GalaxyTarget['kind'], number> = {
  sun: 0,
  blackhole: 1,
  centre: 1,
  nebula: 2,
  galaxy: 2,
  pulsar: 2,
  system: 2,
  cluster: 2,
  arm: 3,
  satellite: 4,
  star: 5,
  planet: 5,
};
const CATEGORY_ORDER: Category[] = ['blackhole', 'galaxy', 'giant', 'nebula', 'system', 'pulsar', 'cluster'];

function lightYears(pc: number): string {
  const g = strings().galaxy;
  const ly = pc / PC_PER_LY;
  if (ly < 1) return `${Math.round(pc * 206_265).toLocaleString('tr-TR')} AU`;
  if (ly < 1000) return `${ly.toLocaleString('tr-TR', { maximumFractionDigits: ly < 10 ? 1 : 0 })} ${g.lightYears}`;
  if (ly >= 1e9) return `${(ly / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyar ${g.lightYears}`;
  if (ly >= 1e6) return `${(ly / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: ly < 1e7 ? 2 : 0 })} milyon ${g.lightYears}`;
  return `${(ly / 1000).toLocaleString('tr-TR', { maximumFractionDigits: ly < 10_000 ? 1 : 0 })} ${g.thousandLightYears}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * Overlay of the galaxy view: labels (click flies there and opens a card),
 * the "Keşfet" menu of destinations by category, rich cards (type, numbers,
 * text, "did you know"), a Milky Way facts card, the return / overview bar
 * with the distance to the Sun, and the image credit. The solar HUD is
 * hidden meanwhile (body.mode-galaxy).
 *
 * Inside a star system the solar tools come along: a navigation bar of its
 * stars and planets (← → step through them), rich body cards, and layer
 * toggles for orbits (Y) and labels (E) plus the camera mode (M).
 */
export class GalaxyHud {
  private readonly labels: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly card: HTMLElement;
  private readonly credit: HTMLElement;
  private readonly explore: HTMLElement;
  private readonly exploreBtn: HTMLButtonElement;
  private readonly items: { t: GalaxyTarget; el: HTMLButtonElement; w: number; visible: boolean; x: number; y: number }[] = [];
  private selected: string | null = null;
  private lastReadout = 0;
  private readonly systems: StarSystem[];
  private readonly sysNav: HTMLElement;
  private readonly sysIndicator: HTMLElement;
  private readonly sysItems = new Map<string, HTMLButtonElement>();
  private system: StarSystem | null = null;
  private lastSystemCheck = 0;
  private labelsOn = true;
  private orbitsOn = true;
  private readonly layerBtns: { labels: HTMLButtonElement; orbits: HTMLButtonElement };

  constructor(
    engine: Engine,
    private readonly view: GalaxyView,
  ) {
    const g = strings().galaxy;
    this.labels = document.createElement('div');
    this.labels.className = 'labels galaxy-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    for (const t of view.targets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'label';
      b.tabIndex = -1;
      b.dataset.kind = t.kind;
      b.textContent = t.name;
      b.addEventListener('click', () => this.go(t));
      this.labels.appendChild(b);
      this.items.push({ t, el: b, w: t.name.length * CHAR_PX + 22, visible: false, x: 0, y: 0 });
    }
    this.items.sort((a, b) => KIND_PRIORITY[a.t.kind] - KIND_PRIORITY[b.t.kind] || b.t.priority - a.t.priority);

    this.bar = document.createElement('div');
    this.bar.className = 'galaxy-bar cluster';
    this.bar.setAttribute('role', 'group');
    this.bar.setAttribute('aria-label', g.title);
    this.bar.innerHTML = `
      <button type="button" class="pill" data-back>${icon('sun')}<span>${g.back}</span></button>
      <button type="button" class="pill pill-accent" data-explore aria-haspopup="dialog" aria-expanded="false">${icon('galaxy')}<span>${g.explore}</span></button>
      <button type="button" class="btn-icon" data-pause aria-label="${g.pause}" title="${g.pause} (Boşluk)">${icon('pause')}</button>
      <button type="button" class="galaxy-speed" data-speed title="${g.speed}">1×</button>
      <p class="galaxy-readout" aria-live="off"></p>
      <button type="button" class="btn-icon" data-orbits aria-pressed="true" aria-label="${strings().tools.orbits}" title="${strings().tools.orbits} (Y)">${icon('orbits')}</button>
      <button type="button" class="btn-icon" data-labels aria-pressed="true" aria-label="${strings().tools.labels}" title="${strings().tools.labels} (E)">${icon('labels')}</button>
      <div class="segmented galaxy-cam" role="radiogroup" aria-label="${strings().tools.camera}">
        <button type="button" role="radio" data-cam="orbit" title="${strings().tools.cameraOrbit}">${strings().tools.cameraOrbit}</button>
        <button type="button" role="radio" data-cam="free" title="${strings().tools.cameraFree} (M)">${icon('hand')}${strings().tools.cameraFree}</button>
      </div>
      <button type="button" class="btn-icon" data-hz aria-pressed="false" aria-label="${strings().tools.habitable}" title="${strings().tools.habitable} (B)">${icon('habitable')}</button>
      <button type="button" class="btn-icon" data-info aria-label="${g.aboutMilkyWay}" title="${g.aboutMilkyWay}">${icon('help')}</button>
      <button type="button" class="btn-icon" data-overview aria-label="${g.overview}" title="${g.overview} (H)">${icon('home')}</button>`;
    this.readout = this.bar.querySelector('.galaxy-readout') as HTMLElement;
    this.exploreBtn = this.bar.querySelector('[data-explore]') as HTMLButtonElement;
    (this.bar.querySelector('[data-back]') as HTMLElement).addEventListener('click', () => void view.returnToSun());
    (this.bar.querySelector('[data-overview]') as HTMLElement).addEventListener('click', () => void view.overview());
    (this.bar.querySelector('[data-info]') as HTMLElement).addEventListener('click', () => this.showCard(g.title, MILKY_WAY_FACTS, undefined, null));
    this.exploreBtn.addEventListener('click', () => this.setExplore(this.explore.dataset.open !== 'true'));
    const pauseBtn = this.bar.querySelector('[data-pause]') as HTMLButtonElement;
    const speedBtn = this.bar.querySelector('[data-speed]') as HTMLButtonElement;
    pauseBtn.addEventListener('click', () => (view.deepPaused = !view.deepPaused));
    speedBtn.addEventListener('click', () => view.cycleDeepSpeed());
    const syncTime = () => {
      pauseBtn.innerHTML = icon(view.deepPaused ? 'play' : 'pause');
      pauseBtn.setAttribute('aria-label', view.deepPaused ? g.play : g.pause);
      pauseBtn.title = `${view.deepPaused ? g.play : g.pause} (Boşluk)`;
      pauseBtn.setAttribute('aria-pressed', String(view.deepPaused));
      speedBtn.textContent = `${view.deepSpeed}×`;
    };
    view.onTimeChange(syncTime);
    syncTime();
    const hzBtn = this.bar.querySelector('[data-hz]') as HTMLButtonElement;
    const syncHz = () => hzBtn.setAttribute('aria-pressed', String(science.habitableZones));
    hzBtn.addEventListener('click', () => {
      science.habitableZones = !science.habitableZones;
      if (science.habitableZones) this.showCard(strings().tools.habitable, undefined, undefined, strings().tools.habitableNotice);
    });
    science.onChange(syncHz);
    syncHz();

    // Layers and camera mode, shared with the solar toolbar's state.
    this.layerBtns = {
      labels: this.bar.querySelector('[data-labels]') as HTMLButtonElement,
      orbits: this.bar.querySelector('[data-orbits]') as HTMLButtonElement,
    };
    this.layerBtns.labels.addEventListener('click', () => this.setLabels(!this.labelsOn));
    this.layerBtns.orbits.addEventListener('click', () => this.setOrbits(!this.orbitsOn));
    const rig = engine.rig;
    const camBtns = [...this.bar.querySelectorAll<HTMLButtonElement>('[data-cam]')];
    camBtns.forEach((b) => b.addEventListener('click', () => (rig.mapMode = b.dataset.cam === 'free')));
    const syncCam = () =>
      camBtns.forEach((b) => {
        const on = (b.dataset.cam === 'free') === rig.mapMode;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
    rig.onMapModeChange(syncCam);
    syncCam();

    // Star-system navigation bar (filled when the camera is inside one).
    this.systems = view.deep.objects.filter((o): o is StarSystem => o instanceof StarSystem);
    this.sysNav = document.createElement('nav');
    this.sysNav.className = 'nav galaxy-system';
    this.sysNav.setAttribute('aria-label', strings().nav.label);
    this.sysNav.dataset.open = 'false';
    this.sysIndicator = document.createElement('span');
    this.sysIndicator.className = 'nav-indicator';
    this.sysIndicator.setAttribute('aria-hidden', 'true');

    // Destinations by category.
    this.explore = document.createElement('div');
    this.explore.className = 'galaxy-explore';
    this.explore.setAttribute('role', 'dialog');
    this.explore.setAttribute('aria-label', g.explore);
    this.explore.dataset.open = 'false';
    // Two tabs: inside the Milky Way (by category) and beyond it.
    const chips = (defs: { id: string; short: string }[]) =>
      defs.map((d) => `<button type="button" class="chip" data-go="${d.id}">${esc(d.short)}</button>`).join('');
    const section = (tab: 'in' | 'out', title: string, defs: { id: string; short: string }[]) =>
      defs.length ? `<section data-tab="${tab}"><h3>${title}</h3><div class="chips">${chips(defs)}</div></section>` : '';
    // The Magellanic Clouds are beyond the Galaxy's disc (~50 kpc).
    const inGalaxy = (d: { distPc: number }) => d.distPc < 30_000;
    const inside = CATEGORY_ORDER.filter((c) => c !== 'galaxy').map((cat) => {
      const defs = DEEP_SKY.filter((d) => d.category === cat && inGalaxy(d)).map((d) => ({ id: d.id, short: d.short }));
      if (cat === 'blackhole') defs.unshift({ id: 'sgr-a', short: 'Sgr A* (galaksi merkezi)' }, { id: 'sstars', short: 'Sgr A* ve S yıldızları' });
      return section('in', CATEGORY_LABELS[cat], defs);
    });
    const holes = EXTRAGALACTIC.filter((d) => d.hole).map((d) => ({ id: d.image ? `${d.id}-hole` : d.id, short: d.hole!.short }));
    const gal = (m: string) => EXTRAGALACTIC.filter((d) => d.category === 'galaxy' && (d.menu ?? 'galaxy') === m).map((d) => ({ id: d.id, short: d.short }));
    const outside = [
      section('out', 'Süper kütleli kara delikler', holes),
      section('out', 'Galaksiler', gal('galaxy')),
      section('out', 'Çarpışan ve tuhaf galaksiler', gal('interacting')),
      section('out', 'Kuasarlar ve derin evren', gal('deep')),
      section('out', 'Dev yıldızlar (Macellan Bulutu)', DEEP_SKY.filter((d) => !inGalaxy(d)).map((d) => ({ id: d.id, short: d.short }))),
    ];
    this.explore.dataset.tab = 'in';
    this.explore.innerHTML = `<div class="galaxy-explore-head"><h2>${g.explore}</h2><button type="button" class="btn-icon" data-close aria-label="${g.closeCard}">${icon('close')}</button></div>
      <div class="segmented galaxy-tabs" role="tablist">
        <button type="button" role="tab" data-tab-btn="in" aria-selected="true">Samanyolu içinde</button>
        <button type="button" role="tab" data-tab-btn="out" aria-selected="false">Samanyolu dışında</button>
      </div>${inside.join('')}${outside.join('')}`;
    const tabBtns = [...this.explore.querySelectorAll<HTMLButtonElement>('[data-tab-btn]')];
    tabBtns.forEach((b) =>
      b.addEventListener('click', () => {
        this.explore.dataset.tab = b.dataset.tabBtn!;
        tabBtns.forEach((x) => {
          x.setAttribute('aria-selected', String(x === b));
          x.setAttribute('aria-checked', String(x === b));
        });
      }),
    );
    tabBtns[0].setAttribute('aria-checked', 'true');
    this.explore.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
      if (b) {
        const t = view.targets.find((x) => x.id === b.dataset.go);
        if (t) {
          this.setExplore(false);
          this.go(t);
        }
      } else if ((e.target as HTMLElement).closest('[data-close]')) this.setExplore(false);
    });

    this.card = document.createElement('div');
    this.card.className = 'galaxy-card';
    this.card.setAttribute('role', 'status');
    this.card.dataset.open = 'false';

    this.credit = document.createElement('p');
    this.credit.className = 'galaxy-credit';
    this.credit.textContent = g.credit;

    const root = document.createElement('div');
    root.className = 'galaxy-hud';
    root.append(this.explore, this.sysNav, this.bar, this.card, this.credit);
    document.body.append(this.labels, root);

    window.addEventListener('keydown', (e) => {
      if (!view.active || isTypingOrChord(e)) return;
      if (e.key === 'Escape') {
        if (this.explore.dataset.open === 'true') this.setExplore(false);
        else if (this.card.dataset.open === 'true') this.closeCard();
        else void view.returnToSun();
      } else if (e.code === 'KeyH') void view.overview();
      else if (e.code === 'KeyE') this.setLabels(!this.labelsOn);
      else if (e.code === 'KeyY') this.setOrbits(!this.orbitsOn);
      else if (e.code === 'KeyM') engine.rig.mapMode = !engine.rig.mapMode;
      else if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && this.system) {
        e.preventDefault();
        this.step(e.code === 'ArrowRight' ? 1 : -1);
      }
      else if (e.code === 'KeyB') science.habitableZones = !science.habitableZones;
      else if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        view.deepPaused = !view.deepPaused;
      }
      else if (e.code === 'KeyK' || e.key === '/') {
        e.preventDefault();
        this.setExplore(this.explore.dataset.open !== 'true');
      }
    });
    view.onActiveChange((on) => {
      if (!on) {
        this.closeCard();
        this.setExplore(false);
        for (const it of this.items) this.setVisible(it, false);
        this.setSystem(null);
      }
    });
    engine.addLate({ update: () => this.update() }, 30);
  }

  private setExplore(open: boolean): void {
    this.explore.dataset.open = String(open);
    this.exploreBtn.setAttribute('aria-expanded', String(open));
  }

  private go(t: GalaxyTarget): void {
    void this.view.flyToTarget(t);
    if (t.kind === 'sun') return;
    this.selected = t.id;
    const m = this.member(t.id);
    if (m) this.showCard(m.name, m.facts, undefined, null);
    else this.showCard(t.name, t.facts, t.distPc, t.fact);
    for (const it of this.items) it.el.dataset.state = it.t.id === t.id ? 'selected' : '';
    this.syncSystemNav();
  }

  /** A system body's card data, by target id (the system's own id gives its main card). */
  private member(id: string): SystemMember | undefined {
    for (const sys of this.systems) {
      if (id === sys.def.id) return undefined;
      const m = sys.members.find((x) => x.targetId === id);
      if (m) return m;
    }
    return undefined;
  }

  private setLabels(on: boolean): void {
    this.labelsOn = on;
    this.labels.style.visibility = on ? '' : 'hidden';
    this.layerBtns.labels.setAttribute('aria-pressed', String(on));
  }

  private setOrbits(on: boolean): void {
    this.orbitsOn = on;
    for (const s of this.systems) s.showOrbits = on;
    this.layerBtns.orbits.setAttribute('aria-pressed', String(on));
  }

  /** The system the camera is in, if any (within a few dozen system sizes). */
  private findSystem(): StarSystem | null {
    const cam = this.view.camera.position;
    let best: StarSystem | null = null;
    let bestD = Infinity;
    for (const s of this.systems) {
      const d = cam.distanceTo(s.position);
      if (d < Math.max(s.extentPc * 60, s.def.framePc * 4) && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  private setSystem(sys: StarSystem | null): void {
    if (sys === this.system) return;
    this.system = sys;
    this.sysItems.clear();
    this.sysNav.replaceChildren();
    this.sysNav.dataset.open = String(!!sys);
    if (!sys) return;
    const add = (id: string, name: string, swatch: string | null) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nav-item';
      b.innerHTML = `${swatch ? '<span class="nav-swatch" aria-hidden="true"></span>' : icon('target')}<span class="nav-label"></span>`;
      if (swatch) (b.firstElementChild as HTMLElement).style.setProperty('--swatch', swatch);
      (b.lastElementChild as HTMLElement).textContent = name;
      b.addEventListener('click', () => {
        const t = this.view.targets.find((x) => x.id === id);
        if (t) this.go(t);
      });
      this.sysItems.set(id, b);
      this.sysNav.appendChild(b);
    };
    add(sys.def.id, 'Tüm sistem', null);
    // A pulsar's member card shares the system's target; skip the duplicate.
    for (const m of sys.members) if (m.targetId !== sys.def.id) add(m.targetId, m.name, m.swatch);
    this.sysNav.appendChild(this.sysIndicator);
    this.syncSystemNav();
  }

  private syncSystemNav(): void {
    const id = this.selected;
    for (const [bid, b] of this.sysItems) b.setAttribute('aria-current', String(bid === id));
    const b = id ? this.sysItems.get(id) : undefined;
    if (!b) {
      this.sysIndicator.style.setProperty('--o', '0');
      return;
    }
    requestAnimationFrame(() => {
      const inset = 12;
      this.sysIndicator.style.setProperty('--x', `${b.offsetLeft + inset}px`);
      this.sysIndicator.style.setProperty('--w', String((b.offsetWidth - inset * 2) / 100));
      this.sysIndicator.style.setProperty('--o', '1');
      b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }

  /** ← →: previous / next body of the current system. */
  private step(dir: 1 | -1): void {
    const ids = [...this.sysItems.keys()];
    if (!ids.length) return;
    const i = this.selected ? ids.indexOf(this.selected) : -1;
    const next = ids[(i + dir + ids.length) % ids.length];
    const t = this.view.targets.find((x) => x.id === next);
    if (t) this.go(t);
  }

  /** Rich card: type, distance and numbers, text, "did you know". */
  private showCard(name: string, facts: Facts | undefined, distPc: number | undefined, fallback: string | null): void {
    const g = strings().galaxy;
    const stats: [string, string][] = [];
    if (distPc !== undefined) stats.push([g.distance, lightYears(distPc)]);
    if (facts) stats.push(...facts.stats.map(([a, b]) => [a, b] as [string, string]));
    this.card.innerHTML = `
      <div class="galaxy-card-head">
        <div>${facts ? `<p class="galaxy-card-type">${esc(facts.type)}</p>` : ''}<h3>${esc(name)}</h3></div>
        <button type="button" class="btn-icon" aria-label="${g.closeCard}">${icon('close')}</button>
      </div>
      ${stats.length ? `<dl class="galaxy-card-stats">${stats.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>` : ''}
      <p class="galaxy-card-text">${esc(facts?.text ?? fallback ?? '')}</p>
      ${facts?.didYouKnow ? `<p class="galaxy-card-dyk"><b>${g.didYouKnow}</b> ${esc(facts.didYouKnow)}</p>` : ''}`;
    (this.card.querySelector('button') as HTMLElement).addEventListener('click', () => this.closeCard());
    this.card.dataset.open = 'true';
  }

  private closeCard(): void {
    this.selected = null;
    this.card.dataset.open = 'false';
    for (const it of this.items) it.el.dataset.state = '';
    this.syncSystemNav();
  }

  private setVisible(it: (typeof this.items)[number], v: boolean): void {
    if (it.visible === v) return;
    it.visible = v;
    it.el.dataset.visible = String(v);
  }

  private update(): void {
    const view = this.view;
    if (!view.active) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const zoom = view.zoom;
    const placed: { x: number; y: number; w: number }[] = [];
    const order = [...this.items].sort((a, b) => Number(b.t.id === this.selected) - Number(a.t.id === this.selected));
    for (const it of order) {
      const t = it.t;
      const d = view.camera.position.distanceTo(t.position);
      // Zoomed into one place, far destinations' labels would only clutter.
      const near = (t.maxDistPc === undefined || d < t.maxDistPc) && !(t.category && d > Math.max(zoom * 20_000, 30));
      let show = (zoom >= t.range[0] && zoom <= t.range[1] && near) || t.id === this.selected;
      const p = show ? view.project(t.position, w, h) : null;
      if (!p || p.x < -40 || p.x > w + 40 || p.y < -20 || p.y > h + 20) show = false;
      if (show && p) {
        const x = p.x + 8;
        const y = p.y - LABEL_H / 2;
        const hit = placed.some((o) => x < o.x + o.w && x + it.w > o.x && Math.abs(y - o.y) < LABEL_H);
        if (hit && t.id !== this.selected) show = false;
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
    if (now - this.lastSystemCheck > 250) {
      this.lastSystemCheck = now;
      this.setSystem(this.findSystem());
    }
    if (now - this.lastReadout > 200) {
      this.lastReadout = now;
      this.readout.textContent = `${strings().galaxy.toSun} ${lightYears(view.sunDistance)}`;
    }
  }
}
