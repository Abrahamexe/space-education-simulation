import { strings } from '../i18n';
import { CelestialBody } from '../bodies/CelestialBody';
import type { FocusEntry } from '../bodies/SolarSystem';
import { Vector3 } from 'three';
import { KM_PER_AU } from '../config/astro';
import { equatorialToScene } from '../physics/frames';
import { SKY_FOVS, fetchObservation, formatDec, formatRa, skyCutoutUrl, type Observation, type Telescope } from '../spacecraft/LiveObservation';
import { TIME_RATE_PRESETS, julianToDate } from '../core/Time';
import { buildInfo, type BodyInfo, type Comparison } from './bodyInfo';
import { au, km, lightTime } from './format';
import { icon } from './icons';
import { uiScale } from './UiScale';
import type { UiContext } from './context';

/** Bars span ±3 decades (0.001× … 1000× Earth) on a log scale. */
const LOG_SPAN = 3;
const LIVE_REFRESH_MS = 250;
/** "Watch the passage" starts this many days before perihelion, as the tail grows. */
const PASSAGE_LEAD_DAYS = 30;
/** …and plays at a day per second, so the approach unfolds in about a minute. */
const PASSAGE_RATE_ID = 'dayPerSecond';

/** Live observation: refetched this often while on. */
const LIVE_POLL_MS = 60_000;

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
  /** Live observation of the shown telescope (Hubble, Webb), when switched on. */
  private info: BodyInfo | null = null;
  private obs: { telescope: Telescope; craftId: string; data: Observation | null; state: 'loading' | 'ready' | 'error'; timer: number; token: number; fov: number } | null = null;
  private obsEl: HTMLElement | null = null;
  private obsToken = 0;

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
      const t = e.target as HTMLElement;
      if (t.closest('[data-live-toggle]')) return this.toggleObservation();
      if (t.closest('[data-live-retry]')) return this.pollObservation();
      if (t.closest('[data-live-look]')) return this.lookAtTarget();
      const fov = t.closest<HTMLElement>('[data-live-fov]');
      if (fov && this.obs) {
        this.obs.fov = Number(fov.dataset.liveFov);
        return this.renderObservation();
      }
      const passage = t.closest('[data-passage]') as HTMLElement | null;
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
      this.stopObservation();
      return;
    }
    if (e.id === this.current?.id) return;
    this.stopObservation();
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
    const isSheet = () => uiScale.width <= 760;
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
        this.el.style.transform = `translateY(${dy / uiScale.zoom}px)`;
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
          info.live
            ? `<button type="button" class="pill pill-live" data-live-toggle aria-pressed="false"><span class="live-dot" aria-hidden="true"></span>${p.live.button}</button>`
            : ''
        }${
          info.perihelionJd !== null
            ? `<button type="button" class="pill" data-passage="${info.perihelionJd}" title="${esc(p.watchPassageNote)}">${icon('now')}${p.watchPassage(julianToDate(info.perihelionJd).getUTCFullYear())}</button>`
            : ''
        }</div>
        ${info.perihelionJd !== null ? `<p class="panel-note">${esc(p.watchPassageNote)}</p>` : ''}
      </header>`);
    if (info.live) parts.push('<section class="live-obs" aria-live="polite" hidden></section>');
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
    if (info.craft) {
      parts.push(`<div class="panel-live"><span class="k">${p.toEarth}</span><span class="v" data-live="e"></span><span class="v2" data-live="et"></span></div>`);
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
    parts.push(`<p class="panel-src">${info.source ?? p.sources}</p>`);
    this.scroll.innerHTML = parts.join('');
    [...this.scroll.children].forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(i)));
    this.el.setAttribute('aria-labelledby', 'panel-title');
    this.liveEl = this.scroll.querySelector('.panel-live');
    this.obsEl = this.scroll.querySelector('.live-obs');
    this.info = info;
    this.lastLive = 0;
    this.updateLive();
  }

  // ---- Live observation (Hubble, Webb) -----------------------------------------------

  private toggleObservation(): void {
    if (this.obs) return this.stopObservation();
    const telescope = this.info?.live;
    const entry = this.current;
    if (!telescope || !entry) return;
    this.obs = { telescope, craftId: entry.id, data: null, state: 'loading', timer: window.setInterval(() => this.pollObservation(), LIVE_POLL_MS), token: ++this.obsToken, fov: SKY_FOVS[1] };
    this.scroll.querySelector('[data-live-toggle]')?.setAttribute('aria-pressed', 'true');
    this.renderObservation();
    this.pollObservation();
  }

  private stopObservation(): void {
    const o = this.obs;
    if (!o) return;
    window.clearInterval(o.timer);
    this.ctx.spacecraft?.craft(o.craftId)?.setPointing(null);
    this.obs = null;
    this.scroll.querySelector('[data-live-toggle]')?.setAttribute('aria-pressed', 'false');
    if (this.obsEl) this.obsEl.hidden = true;
  }

  private pollObservation(): void {
    const o = this.obs;
    if (!o) return;
    const token = o.token;
    if (!o.data) {
      o.state = 'loading';
      this.renderObservation();
    }
    void fetchObservation(o.telescope).then((data) => {
      if (this.obs?.token !== token) return;
      // Same observation as shown: leave the card (and its sky image) alone.
      const same = !!o.data && !!data && o.state === 'ready' && +o.data.start === +data.start && o.data.raDeg === data.raDeg && o.data.decDeg === data.decDeg;
      if (data) {
        o.data = data;
        o.state = 'ready';
        this.ctx.spacecraft?.craft(o.craftId)?.setPointing(equatorialToScene(data.raDeg, data.decDeg));
      } else if (!o.data) o.state = 'error';
      if (!same) this.renderObservation();
    });
  }

  /** The camera behind and beside the telescope, so the beam runs away ahead of it. */
  private lookAtTarget(): void {
    const d = this.obs?.data;
    const entry = this.current;
    if (!d || !entry) return;
    const to = equatorialToScene(d.raDeg, d.decDeg);
    const up = new Vector3(0, 1, 0);
    const side = new Vector3().crossVectors(to, up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const direction = to.clone().multiplyScalar(-0.8).addScaledVector(side, 0.5).addScaledVector(up, 0.25).normalize();
    void this.ctx.engine.rig.flyTo(entry.body, { distance: this.ctx.nav.framingDistance(entry), direction });
  }

  private renderObservation(): void {
    const el = this.obsEl;
    const o = this.obs;
    if (!el || !o) return;
    const L = strings().panel.live;
    el.hidden = false;
    if (!o.data) {
      el.innerHTML =
        o.state === 'error'
          ? `<p class="live-msg">${L.error}</p><button type="button" class="pill" data-live-retry>${L.retry}</button>`
          : `<p class="live-msg">${L.loading}</p>`;
      return;
    }
    const d = o.data;
    const now = Date.now();
    const status = now < +d.start ? 'next' : now > +d.end ? 'last' : 'now';
    const hm = (t: Date) => t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const day = d.start.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    const kind = d.targetCategory ? (L.categories[d.targetCategory] ?? d.targetCategory) : null;
    const row = (k: string, v: string, attr = '') => `<div><dt>${esc(k)}</dt><dd${attr}>${v}</dd></div>`;
    el.innerHTML = `
      <p class="live-status" data-state="${status}"><span class="live-dot" aria-hidden="true"></span>${L.status[status]}</p>
      ${d.targetName ? `<h3 class="live-target">${esc(d.targetName)}</h3>` : ''}
      <figure class="live-sky" data-state="loading">
        <img alt="${esc(L.sky.alt)}" src="${skyCutoutUrl(d.raDeg, d.decDeg, o.fov)}" width="480" height="480" decoding="async">
        <span class="live-reticle" aria-hidden="true"></span>
        <p class="live-sky-error">${L.sky.error}</p>
      </figure>
      <div class="live-fov" role="group" aria-label="${esc(L.sky.fov)}">
        <span>${L.sky.fov}</span>
        ${SKY_FOVS.map((f) => `<button type="button" class="pill" data-live-fov="${f}" aria-pressed="${f === o.fov}">${f >= 1 ? `${f}°` : `${Math.round(f * 60)}′`}</button>`).join('')}
      </div>
      <dl class="stats live-stats">
        ${kind ? row(L.kind, esc(kind)) : ''}
        ${d.instruments.length ? row(L.instrument, esc(d.instruments.join(', '))) : ''}
        ${row(L.coords, `${formatRa(d.raDeg)}<br>${formatDec(d.decDeg)}`)}
        ${row(L.time, `${esc(day)}<br>${hm(d.start)} – ${hm(d.end)}`)}
        ${row(status === 'next' ? L.remainNext : L.remain, '', ' data-lo="remain"')}
      </dl>
      ${d.title ? `<p class="live-title">${esc(d.title)}</p>` : ''}
      <p class="live-meta">${[d.programType, d.programId ? `#${d.programId}` : null, d.science, d.investigator].filter(Boolean).map((s) => esc(String(s))).join(' · ')}</p>
      <div class="panel-actions"><button type="button" class="pill" data-live-look>${icon('target')}${L.lookAt}</button></div>
      <p class="panel-note">${L.note}</p>`;
    const sky = el.querySelector('.live-sky') as HTMLElement;
    const img = sky.querySelector('img') as HTMLImageElement;
    img.addEventListener('load', () => (sky.dataset.state = 'ready'));
    img.addEventListener('error', () => (sky.dataset.state = 'error'));
    this.updateObservation();
  }

  /** Countdown to the end of the exposure (or to its start). */
  private updateObservation(): void {
    const d = this.obs?.data;
    const el = this.obsEl?.querySelector('[data-lo="remain"]');
    if (!d || !el) return;
    const now = Date.now();
    // The exposure began (or ended) while the card stayed: redraw it in its new state.
    const status = now < +d.start ? 'next' : now > +d.end ? 'last' : 'now';
    if (this.obsEl?.querySelector('.live-status')?.getAttribute('data-state') !== status) return this.renderObservation();
    const s = Math.round(((now < +d.start ? +d.start : +d.end) - now) / 1000);
    if (s <= 0 && now > +d.end) {
      el.textContent = strings().panel.live.done;
      return;
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    el.textContent = h > 0 ? `${h} sa ${m} dk` : `${m} dk ${String(s % 60).padStart(2, '0')} sn`;
  }

  /** Real heliocentric distance and light time, refreshed a few times a second. */
  private updateLive(): void {
    if (!this.liveEl || !this.current) return;
    const now = performance.now();
    if (now - this.lastLive < LIVE_REFRESH_MS) return;
    this.lastLive = now;
    if (this.obs) this.updateObservation();
    const body = this.current.body as Partial<CelestialBody> & { earthDistanceKm?: number };
    const d = body.heliocentricDistanceKm;
    if (typeof d !== 'number') return;
    if (typeof body.earthDistanceKm === 'number') {
      const e = body.earthDistanceKm;
      const el = this.scroll.querySelector('[data-live="e"]');
      if (el) {
        el.textContent = e < KM_PER_AU * 0.01 ? km(e) : au(e / KM_PER_AU);
        const s = e / 299792.458;
        (this.scroll.querySelector('[data-live="et"]') as HTMLElement).textContent = `${strings().panel.signal} ${s < 1 ? `${Math.max(1, Math.round(s * 1000))} ms` : lightTime(e)}`;
      }
    }
    (this.liveEl.querySelector('[data-live="d"]') as HTMLElement).textContent = `${au(d / KM_PER_AU)}`;
    (this.liveEl.querySelector('[data-live="t"]') as HTMLElement).textContent =
      `${km(d)} · ${strings().panel.byLight} ${lightTime(d)}`;
  }
}
