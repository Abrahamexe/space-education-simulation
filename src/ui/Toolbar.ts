import { strings } from '../i18n';
import { QUALITY_ORDER, type QualityLevel } from '../config/quality';
import { icon } from './icons';
import type { UiContext } from './context';

/** View toggles a component can expose (labels live in their own module). */
export interface ToggleTarget {
  get: () => boolean;
  set: (v: boolean) => void;
}

/** Keyboard shortcuts for the layer toggles (Turkish mnemonics: Yörünge, Etiket, Kuşak, Galaksi, Uzay araçları). */
const LAYER_KEYS = { orbits: 'KeyY', labels: 'KeyE', belts: 'KeyK', galaxy: 'KeyG', habitable: 'KeyB', craft: 'KeyU' } as const;
const LAYER_KEY_LABEL = { orbits: 'Y', labels: 'E', belts: 'K', galaxy: 'G', habitable: 'B', craft: 'U' } as const;
const LAYER_ICON = { orbits: 'orbits', labels: 'labels', belts: 'belts', galaxy: 'galaxy', habitable: 'habitable', craft: 'craft' } as const;
type LayerName = keyof typeof LAYER_KEYS;

/** Typing in a field, or a modifier chord: not a shortcut. */
export function isTypingOrChord(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  return typing || e.metaKey || e.ctrlKey || e.altKey;
}

/**
 * Layer toggles (top right): orbits, labels, belts as labelled buttons, so
 * "turn the orbits off" is one obvious click (icon-only toggles were easy to
 * miss). Each has a one-letter shortcut. aria-pressed; gold marks "on".
 */
export class Layers {
  readonly el: HTMLElement;

  private readonly syncFns: (() => void)[] = [];

  constructor(toggles: Record<LayerName, ToggleTarget>) {
    const t = strings().tools;
    const el = document.createElement('div');
    el.className = 'layers cluster';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', t.layers);
    el.dataset.reveal = '';
    el.style.setProperty('--i', '1');
    (['galaxy', 'habitable', 'craft', 'orbits', 'labels', 'belts'] as const).forEach((name) => {
      const target = toggles[name];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `layer${name === 'belts' || name === 'craft' ? ' tool-optional' : ''}`;
      b.title = `${t[name]} (${LAYER_KEY_LABEL[name]})`;
      b.setAttribute('aria-keyshortcuts', LAYER_KEY_LABEL[name]);
      b.innerHTML = `${icon(LAYER_ICON[name])}<span class="layer-label">${t[name]}</span>`;
      const sync = () => b.setAttribute('aria-pressed', String(target.get()));
      const flip = () => {
        target.set(!target.get());
        sync();
      };
      b.addEventListener('click', flip);
      window.addEventListener('keydown', (e) => {
        // The galaxy view has its own keys (K opens its menu there).
        if (e.code !== LAYER_KEYS[name] || isTypingOrChord(e) || document.body.classList.contains('mode-galaxy')) return;
        flip();
      });
      sync();
      this.syncFns.push(sync);
      el.appendChild(b);
    });
    this.el = el;
  }

  /** Re-read every toggle (one layer can change another, e.g. galaxy → orbits). */
  sync(): void {
    this.syncFns.forEach((fn) => fn());
  }
}

/**
 * Bottom-right view controls (PLAN §7.2): cinematic ↔ real scale as a
 * two-option radio group, and a "home" button.
 */
export class Toolbar {
  readonly el: HTMLElement;

  constructor(ctx: UiContext) {
    const t = strings().tools;
    const el = document.createElement('div');
    el.className = 'tools cluster';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', t.group);
    el.dataset.reveal = '';
    el.style.setProperty('--i', '4');

    // Scale radio group.
    const seg = document.createElement('div');
    seg.className = 'segmented';
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', t.scale);
    const modes: ['cinematic' | 'real', string][] = [
      ['cinematic', t.cinematic],
      ['real', t.real],
    ];
    const radios = modes.map(([mode, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.textContent = label;
      b.addEventListener('click', () => ctx.scaleTransition.set(mode));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          ctx.scaleTransition.toggle();
          (radios.find((r) => r.getAttribute('aria-checked') === 'true') ?? b).focus();
        }
      });
      seg.appendChild(b);
      return b;
    });
    const syncScale = () =>
      radios.forEach((b, i) => {
        const on = modes[i][0] === ctx.scaleTransition.mode;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
    ctx.scaleTransition.onChange(syncScale);
    syncScale();
    el.appendChild(seg);

    // Camera mode: orbit a body, or roam freely like a map.
    const camSeg = document.createElement('div');
    camSeg.className = 'segmented';
    camSeg.setAttribute('role', 'radiogroup');
    camSeg.setAttribute('aria-label', t.camera);
    const rig = ctx.engine.rig;
    const camModes: [boolean, string][] = [
      [false, t.cameraOrbit],
      [true, `${icon('hand')}${t.cameraFree}`],
    ];
    const camRadios = camModes.map(([free, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.innerHTML = label;
      b.title = free ? `${t.cameraFree} (M)` : t.cameraOrbit;
      b.addEventListener('click', () => (rig.mapMode = free));
      camSeg.appendChild(b);
      return b;
    });
    const syncCam = () =>
      camRadios.forEach((b, i) => {
        const on = camModes[i][0] === rig.mapMode;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
    rig.onMapModeChange(syncCam);
    syncCam();
    el.appendChild(camSeg);

    const pgCtl = ctx.playground;
    if (pgCtl) {
      const pgBtn = document.createElement('button');
      pgBtn.type = 'button';
      pgBtn.className = 'btn-icon pg-launch';
      pgBtn.setAttribute('aria-label', 'Oyun alanı');
      pgBtn.title = "Oyun alanı: Güneş Sistemi'ne kara delik, yıldız, gezegen ekle (P)";
      pgBtn.setAttribute('aria-keyshortcuts', 'P');
      pgBtn.innerHTML = icon('atom');
      const syncPg = () => pgBtn.setAttribute('aria-pressed', String(pgCtl.active));
      pgBtn.addEventListener('click', () => pgCtl.toggle());
      pgCtl.onChange(syncPg);
      syncPg();
      el.appendChild(pgBtn);
    }

    const galaxy = document.createElement('button');
    galaxy.type = 'button';
    galaxy.className = 'btn-icon';
    galaxy.setAttribute('aria-label', t.galaxyView);
    galaxy.title = t.galaxyView;
    galaxy.innerHTML = icon('zoomOut');
    galaxy.addEventListener('click', () => ctx.views.goToGalaxy());
    el.appendChild(galaxy);

    const home = document.createElement('button');
    home.type = 'button';
    home.className = 'btn-icon';
    home.setAttribute('aria-label', t.home);
    home.title = `${t.home} (H)`;
    home.setAttribute('aria-keyshortcuts', 'H');
    home.innerHTML = icon('home');
    home.addEventListener('click', () => void ctx.nav.home());
    el.appendChild(home);

    this.el = el;
  }
}

/**
 * Settings popover (top right): quality level with an "automatic" switch,
 * and the sources/credits line. Closes on Escape or an outside click and
 * returns focus to its button.
 */
export class Settings {
  readonly el: HTMLElement;
  private readonly pop: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor(ctx: UiContext) {
    const t = strings().tools;
    const el = document.createElement('div');
    el.className = 'settings';
    el.dataset.reveal = '';
    el.style.setProperty('--i', '1');
    el.innerHTML = `
      <button type="button" class="btn-icon" aria-haspopup="dialog" aria-expanded="false" aria-label="${t.settings}" title="${t.settings}">${icon('gear')}</button>
      <div class="popover" role="dialog" aria-label="${t.settings}" data-open="false">
        <h3 id="q-label">${t.quality}</h3>
        <div class="segmented" role="radiogroup" aria-labelledby="q-label"></div>
        <label><input type="checkbox" data-auto> ${t.autoQuality}</label>
        <p>${t.creditsText}</p>
      </div>`;
    this.button = el.querySelector('button') as HTMLButtonElement;
    this.pop = el.querySelector('.popover') as HTMLElement;
    const seg = this.pop.querySelector('.segmented') as HTMLElement;
    const auto = this.pop.querySelector('[data-auto]') as HTMLInputElement;

    const radios = QUALITY_ORDER.map((level) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.textContent = t.qualityLevels[level];
      b.addEventListener('click', () => {
        ctx.quality.auto = false;
        auto.checked = false;
        ctx.quality.set(level);
      });
      seg.appendChild(b);
      return [level, b] as [QualityLevel, HTMLButtonElement];
    });
    const sync = () => {
      for (const [level, b] of radios) {
        const on = level === ctx.quality.level;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      auto.checked = ctx.quality.auto;
    };
    ctx.quality.onChange(sync);
    auto.addEventListener('change', () => (ctx.quality.auto = auto.checked));
    sync();

    this.button.addEventListener('click', () => this.setOpen(this.pop.dataset.open !== 'true'));
    document.addEventListener('pointerdown', (e) => {
      if (this.pop.dataset.open === 'true' && !el.contains(e.target as Node)) this.setOpen(false);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pop.dataset.open === 'true') {
        e.stopPropagation();
        this.setOpen(false);
        this.button.focus();
      }
    });
    this.el = el;
  }

  private setOpen(open: boolean): void {
    this.pop.dataset.open = String(open);
    this.button.setAttribute('aria-expanded', String(open));
    if (open) (this.pop.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  }
}
