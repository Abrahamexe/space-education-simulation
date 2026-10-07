import { strings } from '../i18n';
import { DAYS_PER_JULIAN_YEAR, SECONDS_PER_DAY } from '../config/astro';
import { date, time as clock } from './format';
import { icon } from './icons';
import { dateToJulian } from '../core/Time';
import type { UiContext } from './context';

const Y = DAYS_PER_JULIAN_YEAR;
const MONTH = Y / 12;
const HOUR = 1 / 24;
const MINUTE = HOUR / 60;
const SECOND = 1 / SECONDS_PER_DAY;

/** Speed ladder (sim days per real second), backwards through forwards (PLAN §3.4). */
const LADDER = [-Y, -MONTH, -10, -1, -HOUR, -MINUTE, SECOND, MINUTE, HOUR, 1, 10, MONTH, Y];
const DATE_REFRESH_MS = 100;

function rateLabel(rate: number): string {
  const t = strings().time;
  const a = Math.abs(rate);
  const unit = (count: number, word: string) => `${count} ${word} ${t.perSecond}`;
  let text: string;
  if (Math.abs(a - SECOND) < 1e-12) text = t.realtime;
  else if (Math.abs(a - Y) < 1e-6) text = unit(1, t.units.year);
  else if (Math.abs(a - MONTH) < 1e-6) text = unit(1, t.units.month);
  else if (a >= 1) text = unit(Math.round(a), t.units.day);
  else if (Math.abs(a - HOUR) < 1e-9) text = unit(1, t.units.hour);
  else if (a >= HOUR) text = unit(Math.round(a / HOUR), t.units.hour);
  else text = unit(Math.max(1, Math.round(a / MINUTE)), t.units.minute);
  return rate < 0 ? `${t.reverse} ${text}` : text;
}

/**
 * Bottom-left time controls: slower/back, play/pause, faster along a fixed
 * speed ladder; the current simulation date (UTC) and speed; back to today.
 */
export class TimeControls {
  readonly el: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly dateEl: HTMLElement;
  private readonly rateEl: HTMLElement;
  private lastDraw = 0;

  constructor(private readonly ctx: UiContext) {
    const t = strings().time;
    const el = document.createElement('div');
    el.className = 'time cluster';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', t.group);
    el.dataset.reveal = '';
    el.style.setProperty('--i', '3');
    el.innerHTML = `
      <button type="button" class="btn-icon" data-act="slower" aria-label="${t.slower}">${icon('rewind')}</button>
      <button type="button" class="btn-icon btn-play" data-act="play">${icon('pause')}</button>
      <button type="button" class="btn-icon" data-act="faster" aria-label="${t.faster}">${icon('forward')}</button>
      <div class="time-text">
        <span class="time-date" aria-live="off"></span>
        <span class="time-rate"></span>
      </div>
      <button type="button" class="btn-icon" data-act="now" aria-label="${t.now}" title="${t.now}">${icon('now')}</button>`;
    this.play = el.querySelector('[data-act="play"]') as HTMLButtonElement;
    this.dateEl = el.querySelector('.time-date') as HTMLElement;
    this.rateEl = el.querySelector('.time-rate') as HTMLElement;
    el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      const time = ctx.engine.time;
      if (act === 'play') time.togglePause();
      else if (act === 'slower') this.step(-1);
      else if (act === 'faster') this.step(1);
      else if (act === 'now') {
        // In the playground the simulation owns the clock: start it over from today.
        if (ctx.playground?.active) {
          ctx.playground.reset(dateToJulian(new Date()));
          time.setRate(1);
        }
        else time.setNow();
      }
      this.draw(true);
    });
    this.el = el;
    ctx.engine.onFrame(() => this.draw(false));
    this.draw(true);
  }

  private step(dir: 1 | -1): void {
    const time = this.ctx.engine.time;
    // Nearest rung to the current rate, then one step along the ladder.
    let idx = 0;
    let best = Infinity;
    LADDER.forEach((r, i) => {
      const d = Math.abs(Math.log(Math.abs(r)) - Math.log(Math.abs(time.rate))) + (Math.sign(r) === Math.sign(time.rate) ? 0 : 100);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    const next = Math.min(LADDER.length - 1, Math.max(0, idx + dir));
    time.setRate(LADDER[next]);
    if (time.paused) time.togglePause();
  }

  private draw(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastDraw < DATE_REFRESH_MS) return;
    this.lastDraw = now;
    const t = strings().time;
    const time = this.ctx.engine.time;
    const d = time.date;
    this.dateEl.textContent = `${date(d)}  ${clock(d)}`;
    const label = rateLabel(time.rate);
    if (this.rateEl.textContent !== label) this.rateEl.textContent = label;
    const playing = !time.paused;
    if (this.play.dataset.playing !== String(playing)) {
      this.play.dataset.playing = String(playing);
      this.play.setAttribute('aria-label', playing ? t.pause : t.play);
      this.play.innerHTML = icon(playing ? 'pause' : 'play');
      this.rateEl.dataset.paused = String(!playing);
    }
  }
}
