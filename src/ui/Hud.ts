import { strings } from '../i18n';
import { science } from '../core/Science';
import { CelestialBody } from '../bodies/CelestialBody';
import { KM_PER_AU } from '../config/astro';
import { au, lightTime } from './format';
import { Hint } from './Hint';
import { InfoPanel } from './InfoPanel';
import { Labels } from './Labels';
import { NavBar } from './NavBar';
import { TimeControls } from './TimeControls';
import { Help } from './Help';
import { Search } from './Search';
import { Layers, Settings, Toolbar } from './Toolbar';
import type { UiContext } from './context';

const READOUT_REFRESH_MS = 250;
const NOTICE_MS = 5000;
/** Must match the bottom-sheet breakpoint in hud.css. */
const MOBILE_MAX_WIDTH = 760;

/**
 * The overlay shell (PLAN §7.2): brand, live distance readout, search, layer
 * toggles, help and settings on top; time controls / navigation / scale
 * along the bottom, the info panel,
 * floating labels and the first-run hint. Elements arrive with a short
 * stagger once the opening shot is under way.
 */
export class Hud {
  readonly root: HTMLElement;
  readonly labels: Labels;
  private readonly readout: HTMLElement;
  private readonly hint = new Hint();
  private readonly notice: HTMLElement;
  private lastReadout = 0;
  private noticeTimer = 0;
  private freeNoticeShown = false;

  constructor(private readonly ctx: UiContext) {
    const t = strings();
    const root = document.createElement('div');
    root.className = 'hud';

    // ---- Top ------------------------------------------------------------------
    const top = document.createElement('header');
    top.className = 'hud-top';
    const brand = document.createElement('h1');
    brand.className = 'brand';
    brand.textContent = t.app.title;
    brand.dataset.reveal = '';
    brand.style.setProperty('--i', '0');
    const right = document.createElement('div');
    right.className = 'top-right';
    this.readout = document.createElement('p');
    this.readout.className = 'readout';
    this.readout.dataset.reveal = '';
    this.readout.style.setProperty('--i', '1');
    this.readout.setAttribute('aria-live', 'off');
    this.labels = new Labels(ctx);
    const sys = ctx.system;
    // Orbit lines (Y) cover both frames: the ellipses, or the galactic trails while G is on.
    const setOrbits = (v: boolean) => {
      sys.showOrbits = v;
      ctx.galactic.showTrails = v;
    };
    // Spacecraft mode (U): the planets' lines and names give way to the craft and
    // their paths; switching it off brings back what was on before.
    let beforeCraft: { orbits: boolean; labels: boolean } | null = null;
    const layers = new Layers({
      orbits: { get: () => sys.showOrbits, set: setOrbits },
      labels: { get: () => this.labels.show, set: (v) => (this.labels.show = v) },
      belts: { get: () => sys.showBelts, set: (v) => (sys.showBelts = v) },
      galaxy: { get: () => ctx.galactic.enabled, set: (v) => (ctx.galactic.enabled = v) },
      craft: {
        get: () => ctx.spacecraft?.visible ?? false,
        set: (v) => {
          if (!ctx.spacecraft || ctx.spacecraft.visible === v) return;
          ctx.spacecraft.visible = v;
          if (v) {
            beforeCraft = { orbits: sys.showOrbits, labels: this.labels.show };
            setOrbits(false);
            this.labels.show = true;
          } else if (beforeCraft) {
            setOrbits(beforeCraft.orbits);
            this.labels.show = beforeCraft.labels;
            beforeCraft = null;
          }
          layers.sync();
        },
      },
      habitable: {
        get: () => science.habitableZones,
        set: (v) => {
          science.habitableZones = v;
          if (v) this.showNotice(t.tools.habitableNotice);
        },
      },
    });
    ctx.galactic.onChange((on) => {
      layers.sync();
      if (on) this.showNotice(t.tools.galaxyNotice);
    });
    right.append(this.readout, new Search(ctx).el, layers.el, new Help().el, new Settings(ctx).el);
    top.append(brand, right);

    // ---- Bottom ------------------------------------------------------------------
    const bottom = document.createElement('div');
    bottom.className = 'hud-bottom';
    bottom.append(new TimeControls(ctx).el, new NavBar(ctx).el, new Toolbar(ctx).el);

    const spacer = document.createElement('div');
    root.append(top, spacer, bottom);

    this.notice = document.createElement('div');
    this.notice.className = 'notice';
    this.notice.setAttribute('role', 'status');

    document.body.append(this.labels.el, root, new InfoPanel(ctx).el, this.hint.el, this.notice);
    this.root = root;

    ctx.engine.onFrame(() => this.updateReadout());
    // Keep the focused body in the open part of the screen while the panel shows.
    ctx.selection.onSelect((e) => requestAnimationFrame(() => this.updateViewShift(!!e)));
    window.addEventListener('resize', () => this.updateViewShift(!!ctx.selection.selected));
    // Free camera: the panel describes the body we just left, so close it,
    // and explain the new controls once per visit.
    ctx.engine.rig.onRelease(() => {
      ctx.selection.select(null);
      if (!this.freeNoticeShown) {
        this.freeNoticeShown = true;
        this.showNotice(t.errors.freeCamera);
      }
    });
    ctx.quality.onChange((_level, reason) => {
      if (reason === 'auto') this.showNotice(t.errors.slow);
    });
  }

  /** Staggered entrance and the first-run hint. */
  reveal(): void {
    this.root.classList.add('is-ready');
    window.setTimeout(() => this.hint.show(), 1200);
  }

  private updateViewShift(open: boolean): void {
    const panel = document.querySelector('.panel') as HTMLElement | null;
    if (!open || !panel) {
      this.ctx.engine.setViewShift(0, 0);
      return;
    }
    const sheet = window.innerWidth <= MOBILE_MAX_WIDTH;
    if (sheet) this.ctx.engine.setViewShift(0, panel.offsetHeight / 2);
    else this.ctx.engine.setViewShift((panel.offsetWidth + 16) / 2, 0);
  }

  showNotice(text: string): void {
    this.notice.textContent = text;
    this.notice.dataset.visible = 'true';
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => (this.notice.dataset.visible = 'false'), NOTICE_MS);
  }

  /** "Güneş'e 5,31 AU · ışıkla 44 dk 10 sn" for the focused body (real distance). */
  private updateReadout(): void {
    const now = performance.now();
    if (now - this.lastReadout < READOUT_REFRESH_MS) return;
    this.lastReadout = now;
    const r = strings().readout;
    const focus = this.ctx.engine.rig.focusTarget;
    const entry = this.ctx.system.focusables.find((f) => f.body === focus);
    let text = '';
    if (entry && focus instanceof CelestialBody) {
      const d = focus.heliocentricDistanceKm;
      text = `<b>${entry.name}</b>${r.toSun} ${au(d / KM_PER_AU)} · ${r.byLight} ${lightTime(d)}`;
    } else if (entry) {
      text = `<b>${r.focus}</b>${entry.name}`;
    } else if (!focus) {
      text = `<b>${r.free}</b>${this.ctx.engine.rig.mapMode ? r.mapKeys : r.freeKeys}`;
    }
    if (this.readout.innerHTML !== text) this.readout.innerHTML = text;
  }
}
