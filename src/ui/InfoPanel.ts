import { strings } from '../i18n';
import { CelestialBody } from '../bodies/CelestialBody';
import type { FocusEntry } from '../bodies/SolarSystem';
import { KM_PER_AU } from '../config/astro';
import { TIME_RATE_PRESETS, julianToDate } from '../core/Time';
import { buildInfo, type BodyInfo, type Comparison } from './bodyInfo';
import { au, km, lightTime } from './format';
import { icon } from './icons';
import type { UiContext } from './context';

/** Bars span ±3 decades (0.001× … 1000× Earth) on a log scale. */
const LOG_SPAN = 3;
const LIVE_REFRESH_MS = 250;
/** "Watch the passage" starts this many days before perihelion, as the tail grows. */
const PASSAGE_LEAD_DAYS = 30;
/** …and plays at a day per second, so the approach unfolds in about a minute. */
const PASSAGE_RATE_ID = 'dayPerSecond';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function compareRow(c: Comparison): string {
  const lg = Math.max(-LOG_SPAN, Math.min(LOG_SPAN, Math.log10(c.ratio)));
  const width = (Math.abs(lg) / LOG_SPAN) * 50;
  const dir = lg >= 0 ? 'up' : 'down';
  const origin = dir === 'up' ? 'left center' : 'right center';
  return `
    <div class="compare-row">
      <span class="compare-label">${esc(c.label)}</span>
      <div class="compare-track" aria-hidden="true">
        <span class="compare-bar" data-dir="${dir}" style="width:${width.toFixed(2)}%;--origin:${origin}"></span>
      </div>
      <span class="compare-value">${esc(c.text)}</span>
    </div>`;
}

/**
 * Right-hand info panel (PLAN §7.2.3). Slides in when something is
 * selected; switching bodies cross-fades the content with a short stagger
 * instead of re-sliding. Everything shown comes from bodyInfo (sourced data).
 */
export class InfoPanel {
  readonly el: HTMLElement;
  private readonly scroll: HTMLElement;
  private current: FocusEntry | null = null;
  private liveEl: HTMLElement | null = null;
  private lastLive = 0;

  constructor(private readonly ctx: UiContext) {
    const p = strings().panel;
    const el = document.createElement('aside');
    el.className = 'panel';
    el.dataset.open = 'false';
    el.setAttribute('aria-label', p.label);
    el.innerHTML = `
      <button type="button" class="btn-icon panel-close" aria-label="${p.close}">${icon('close')}</button>
      <div class="panel-scroll"></div>`;
    this.scroll = el.querySelector('.panel-scroll') as HTMLElement;
    (el.querySelector('.panel-close') as HTMLElement).addEventListener('click', () => ctx.selection.select(null));
    el.addEventListener('click', (e) => {
      const passage = (e.target as HTMLElement).closest('[data-passage]') as HTMLElement | null;
      if (passage && this.current) {
        const time = ctx.engine.time;
        time.setJd(Number(passage.dataset.passage) - PASSAGE_LEAD_DAYS);
        const rate = TIME_RATE_PRESETS.find((r) => r.id === PASSAGE_RATE_ID);
        if (rate) time.setRate(rate.daysPerSecond);
        if (time.paused) time.togglePause();
        // Fly one frame later: the comet must first update its activity at
        // the new date, or the framing would still be the bare nucleus.
        const entry = this.current;
        const off = ctx.engine.onFrame(() => {
          off();
          void ctx.nav.flyTo(entry);
        });
        return;
      }
      const b = (e.target as HTMLElement).closest('[data-fly]') as HTMLElement | null;
      if (!b) return;
      const entry = ctx.nav.entry(b.dataset.fly as string);
      if (entry) void ctx.nav.flyTo(entry);
    });
    this.el = el;

    ctx.selection.onSelect((e) => this.show(e));
    this.enableSheetDrag();
    ctx.engine.onFrame(() => this.updateLive());
  }

  private show(e: FocusEntry | null): void {
    if (!e) {
      this.el.dataset.open = 'false';
      this.current = null;
      return;
    }
    if (e.id === this.current?.id) return;
    const wasOpen = this.el.dataset.open === 'true';
    this.current = e;
    this.el.dataset.entering = String(!wasOpen);
    this.el.dataset.swapping = 'true';
    this.render(buildInfo(e, this.ctx.system));
    this.scroll.scrollTop = 0;
    this.el.dataset.open = 'true';
    // Force the "hidden" state to apply, then release it so the content
    // staggers in (on first open it rides in with the panel).
    void this.el.offsetWidth;
    requestAnimationFrame(() => (this.el.dataset.swapping = 'false'));
    if (!wasOpen) this.el.setAttribute('aria-hidden', 'false');
  }

  /**
   * Mobile bottom sheet: drag down from the top part to dismiss. Follows the
   * finger; a long or fast enough drag closes (velocity check so a flick
   * is enough), otherwise it springs back with the drawer curve.
   */
  private enableSheetDrag(): void {
    const DISMISS_PX = 90;
    const DISMISS_VELOCITY = 0.11; // px/ms
    const HANDLE_ZONE_PX = 120;
    let start: { y: number; t: number; id: number } | null = null;
    let dy = 0;
    const isSheet = () => window.matchMedia('(max-width: 760px)').matches;
    this.el.addEventListener('pointerdown', (e) => {
      if (!isSheet() || e.pointerType === 'mouse') return;
      const top = this.el.getBoundingClientRect().top;
      // Only from the header zone, and only when the content is scrolled to the top.
      if (e.clientY - top > HANDLE_ZONE_PX || this.scroll.scrollTop > 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      start = { y: e.clientY, t: performance.now(), id: e.pointerId };
      dy = 0;
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      dy = Math.max(0, e.clientY - start.y);
      if (dy > 4) {
        this.el.dataset.dragging = 'true';
        this.el.setPointerCapture(e.pointerId);
        this.el.style.transform = `translateY(${dy}px)`;
      }
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const v = dy / Math.max(performance.now() - start.t, 1);
      start = null;
      this.el.dataset.dragging = 'false';
      this.el.style.transform = '';
      if (dy > DISMISS_PX || v > DISMISS_VELOCITY) this.ctx.selection.select(null);
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  private render(info: BodyInfo): void {
    const p = strings().panel;
    const parts: string[] = [];
    const back = info.parent
      ? `<button type="button" class="panel-back" data-fly="${info.parent.id}" aria-label="${esc(p.backTo(info.parent.name))}">${icon('back')}${esc(info.parent.name)}</button>`
      : '';
    parts.push(`
      <header>
        ${back}
        <p class="panel-type">${esc(info.typeLabel)}</p>
        <h2 class="panel-title" id="panel-title">${esc(info.name)}</h2>
        ${info.subtitle ? `<p class="panel-sub">${esc(info.subtitle)}</p>` : ''}
        <div class="panel-actions"><button type="button" class="pill" data-fly="${info.id}">${icon('target')}${p.flyTo}</button>${
          info.perihelionJd !== null
            ? `<button type="button" class="pill" data-passage="${info.perihelionJd}" title="${esc(p.watchPassageNote)}">${icon('now')}${p.watchPassage(julianToDate(info.perihelionJd).getUTCFullYear())}</button>`
            : ''
        }</div>
        ${info.perihelionJd !== null ? `<p class="panel-note">${esc(p.watchPassageNote)}</p>` : ''}
      </header>`);
    if (info.moons.length) {
      parts.push(`
        <section class="moons" aria-labelledby="moons-title">
          <h3 id="moons-title">${p.moons}</h3>
          <div class="chips">${info.moons.map((m) => `<button type="button" class="pill" data-fly="${m.id}">${esc(m.name)}</button>`).join('')}</div>
        </section>`);
    }
    if (info.id !== 'sun') {
      parts.push(`<div class="panel-live"><span class="k">${p.toSun}</span><span class="v" data-live="d"></span><span class="v2" data-live="t"></span></div>`);
    }
    if (info.stats.length) {
      parts.push(
        `<dl class="stats">${info.stats.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join('')}</dl>`,
      );
    }
    if (info.compare.length && info.id !== 'earth') {
      parts.push(`
        <section class="compare" aria-labelledby="cmp-title">
          <h3 id="cmp-title">${p.compare}</h3>
          ${info.compare.map(compareRow).join('')}
          <p class="compare-note">${p.compareNote}</p>
        </section>`);
    }
    if (info.text.length) {
      parts.push(`<div class="prose">${info.text.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`);
    }
    if (info.fact) {
      parts.push(`<aside class="fact"><h3>${p.fact}</h3><p>${esc(info.fact)}</p></aside>`);
    }
    parts.push(`<p class="panel-src">${p.sources}</p>`);
    this.scroll.innerHTML = parts.join('');
    [...this.scroll.children].forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(i)));
    this.el.setAttribute('aria-labelledby', 'panel-title');
    this.liveEl = this.scroll.querySelector('.panel-live');
    this.lastLive = 0;
    this.updateLive();
  }

  /** Real heliocentric distance and light time, refreshed a few times a second. */
  private updateLive(): void {
    if (!this.liveEl || !this.current) return;
    const now = performance.now();
    if (now - this.lastLive < LIVE_REFRESH_MS) return;
    this.lastLive = now;
    const body = this.current.body;
    if (!(body instanceof CelestialBody)) return;
    const d = body.heliocentricDistanceKm;
    (this.liveEl.querySelector('[data-live="d"]') as HTMLElement).textContent = `${au(d / KM_PER_AU)}`;
    (this.liveEl.querySelector('[data-live="t"]') as HTMLElement).textContent =
      `${km(d)} · ${strings().panel.byLight} ${lightTime(d)}`;
  }
}
