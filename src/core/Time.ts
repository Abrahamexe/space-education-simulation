import {
  DAYS_PER_JULIAN_YEAR,
  JD_J2000,
  JD_UNIX_EPOCH,
  SECONDS_PER_DAY,
} from '../config/astro';

/**
 * Simulation clock (PLAN §3.4).
 *
 * Two clocks run side by side:
 *  - real time: wall-clock seconds, used for purely visual motion that must
 *    keep moving even when the simulation is paused (sun granulation, star
 *    twinkle, UI).
 *  - simulation time: a Julian Date in double precision. Every orbital and
 *    rotational motion derives from it.
 */

export interface TimeRatePreset {
  id: string;
  /** Simulated days per real second. */
  daysPerSecond: number;
}

const HOUR = 1 / 24;
const MINUTE = HOUR / 60;

export const TIME_RATE_PRESETS: readonly TimeRatePreset[] = [
  { id: 'realtime', daysPerSecond: 1 / SECONDS_PER_DAY },
  { id: 'minutePerSecond', daysPerSecond: MINUTE },
  { id: 'hourPerSecond', daysPerSecond: HOUR },
  { id: 'dayPerSecond', daysPerSecond: 1 },
  { id: 'tenDaysPerSecond', daysPerSecond: 10 },
  { id: 'monthPerSecond', daysPerSecond: DAYS_PER_JULIAN_YEAR / 12 },
  { id: 'yearPerSecond', daysPerSecond: DAYS_PER_JULIAN_YEAR },
];

export const DEFAULT_TIME_RATE_ID = 'hourPerSecond';

/** Frame deltas above this are clamped (tab switches, breakpoints). */
const MAX_FRAME_DELTA_S = 0.1;

export function dateToJulian(date: Date): number {
  return date.getTime() / 1000 / SECONDS_PER_DAY + JD_UNIX_EPOCH;
}

export function julianToDate(jd: number): Date {
  return new Date((jd - JD_UNIX_EPOCH) * SECONDS_PER_DAY * 1000);
}

export class Time {
  /** Simulation instant as a Julian Date (UTC-based; ΔT ignored). */
  jd: number;
  /** Simulated days per real second; sign allowed for reverse playback. */
  rate: number;
  paused = false;

  /** Real seconds since the clock started (never paused). */
  elapsed = 0;
  /** Real seconds since the previous frame (clamped). */
  delta = 0;
  /** Simulated days advanced during the last frame. */
  simDelta = 0;

  private lastNow = -1;

  constructor() {
    this.jd = dateToJulian(new Date());
    this.rate = TIME_RATE_PRESETS.find((p) => p.id === DEFAULT_TIME_RATE_ID)!.daysPerSecond;
  }

  /** Days since J2000.0 — the argument most formulas want. */
  get daysSinceJ2000(): number {
    return this.jd - JD_J2000;
  }

  get date(): Date {
    return julianToDate(this.jd);
  }

  tick(nowMs: number): void {
    if (this.lastNow < 0) this.lastNow = nowMs;
    const dt = Math.min((nowMs - this.lastNow) / 1000, MAX_FRAME_DELTA_S);
    this.lastNow = nowMs;
    this.delta = Math.max(0, dt);
    this.elapsed += this.delta;
    this.simDelta = this.paused ? 0 : this.delta * this.rate;
    this.jd += this.simDelta;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  setRate(daysPerSecond: number): void {
    this.rate = daysPerSecond;
  }

  setNow(): void {
    this.jd = dateToJulian(new Date());
  }

  /** Jump to a Julian date (e.g. a comet's perihelion passage). */
  setJd(jd: number): void {
    this.jd = jd;
  }

  setJ2000(): void {
    this.jd = JD_J2000;
  }
}
