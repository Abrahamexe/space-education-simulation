/**
 * Playground physics: direct-summation N-body gravity in heliocentric-
 * ecliptic AU, days and GM in AU³/day² (k² = 2.959e-4 for the Sun).
 *
 * Integrator: kick-drift-kick leapfrog with a global step set every step
 * by the tightest pair: dt = η · min(√(r³/GM), r/v). Close encounters shrink
 * the step automatically, wide orbits take big ones. Debris (a torn-apart
 * body's pieces) never sets it: each piece is sub-stepped on its own
 * orbital time through every step, against the bodies' positions
 * interpolated across it, so a cloud whirling round a black hole does not
 * slow the whole system down; a piece on an orbit too tight even for that
 * (minutes round a black hole) follows its exact two-body orbit round the
 * body that dominates it. The pieces' mass still pulls on the bodies.
 *
 * Events, checked as the bodies move:
 *  - collision: surfaces touch → merge (mass and momentum conserved). The
 *    surfaces are the ones on screen (`hit`, set by the main thread): the
 *    cinematic scale draws planets ~200× too big for their distances, so
 *    two planets would otherwise pass through each other untouched;
 *    anything reaching a black hole is swallowed;
 *  - tidal disruption: inside the Roche limit d = 2.44 R (M/m)^⅓ of a much
 *    heavier body, a planet or star is torn into a debris stream;
 *  - ejection: unbound from the Sun and beyond 40 AU;
 *  - capture: an added body becomes bound to the Sun;
 *  - a black hole tearing something apart starts feeding (it shines).
 *
 * Gravity travels at the speed of light, one way at a time: an added
 * body's pull reaches another only once the front from where it appeared
 * has got there (placed 4 light-years away, nothing here feels it for 4
 * years), while it feels the Sun's long-established field at once. A
 * removed body keeps pulling (as a "ghost" on its last path) wherever the
 * news of its removal has not arrived yet: the Earth circles a vanished Sun
 * for 8.3 minutes. A torn-apart body's mass goes on in its debris. Climate,
 * radiation and damage are worked out on the main thread from these states.
 */

import { keplerStep, periapsis } from './kepler';

export const GM_SUN = 2.959122082855911e-4;
/** Speed of light, AU/day. */
export const C_AU_DAY = 173.1446326742;

export type SimKind = 'star' | 'planet' | 'dwarf' | 'comet' | 'bh' | 'ns' | 'wd' | 'debris';

export interface SimBodyInit {
  id: string;
  name: string;
  kind: SimKind;
  /** GM, AU³/day². 0 = test particle. */
  mu: number;
  /** Physical radius, AU. */
  radius: number;
  pos: [number, number, number];
  vel: [number, number, number];
  /** Luminosity, L☉ (stars). */
  lum?: number;
  /** Added in the playground (not part of the real Solar System). */
  added?: boolean;
}

export interface SimBody extends SimBodyInit {
  alive: boolean;
  /** Event flags so each fires once. */
  ejected?: boolean;
  /** Heavy body this one is bound to (two-body energy), if any. */
  host?: string;
  /** A host change waiting to be confirmed, and since when (jd). */
  pending?: string;
  pendingSince?: number;
  bound?: boolean;
  /** A black hole that has torn something apart (shows an accretion disc). */
  feeding?: boolean;
  /** Feeding: peak luminosity (L☉) and when it began (jd). */
  feedLum?: number;
  feedJd?: number;
  /** Added: where and when it appeared (its field spreads from there at c). */
  addJd?: number;
  addPos?: [number, number, number];
  /** Its field has reached every body: no more checks. */
  fieldFull?: boolean;
  /** Field front has reached the Earth (event fired). */
  reachedEarth?: boolean;
  /** Collision radius as drawn on screen, AU (≥ radius). */
  hit?: number;
  /** Added: its first host is taken silently (it was put there, not captured). */
  fresh?: boolean;
  /** Removed, but its field still pulls where the news has not arrived. */
  ghost?: boolean;
  /** When and where it stopped existing (removed, merged, torn apart). */
  goneJd?: number;
  gonePos?: [number, number, number];
}

export type SimEventType = 'collision' | 'swallowed' | 'disrupted' | 'ejected' | 'captured' | 'hz-exit' | 'hz-enter' | 'arrival';

export interface SimEvent {
  jd: number;
  /** Collisions: impact energy per kg of the merged body, J/kg. */
  impact?: number;
  type: SimEventType;
  text: string;
  ids: string[];
}

const ETA = 0.025;
const DT_MIN = 1e-8;
const DT_MAX = 4;
const DEBRIS_COUNT = 120;
/** Debris sub-steps: accuracy, shortest step (days) and most sub-steps per step. */
const DEBRIS_ETA = 0.02;
const DEBRIS_H_MIN = 1e-6;
const DEBRIS_MAX_SUB = 64;
/** A piece lighter than this (GM) does not pull the bodies (a planet's pieces; a star's still do). */
const DEBRIS_PULL_MIN = 1e-6 * 2.959122082855911e-4;
const COMPACT: ReadonlySet<SimKind> = new Set(['bh', 'ns', 'wd']);

/**
 * Distance at which two bodies touch. Both drawn surfaces count, except
 * with a black hole, neutron star or white dwarf: then only its own drawn
 * size and the other's true radius, so a star or planet near it is torn
 * apart at the true Roche limit instead of hitting an inflated surface.
 */
function contact(a: SimBody, b: SimBody): number {
  // Debris and a black hole: its true capture radius (2 Rs for a piece
  // falling from far away), not the drawn size, so a torn body's stream can
  // swing round the hole as it does in nature.
  if ((a.kind === 'debris' && b.kind === 'bh') || (b.kind === 'debris' && a.kind === 'bh')) return 2 * (a.kind === 'bh' ? a.radius : b.radius);
  if (COMPACT.has(a.kind) || COMPACT.has(b.kind)) {
    const [c, o] = COMPACT.has(a.kind) ? [a, b] : [b, a];
    return Math.max(c.hit ?? 0, c.radius) + (COMPACT.has(o.kind) ? Math.max(o.hit ?? 0, o.radius) : o.radius);
  }
  return Math.max(a.hit ?? 0, a.radius) + Math.max(b.hit ?? 0, b.radius);
}

/** Turkish "X'in" style genitive is fiddly; event texts avoid suffixes. */
function label(b: SimBody): string {
  return b.name;
}

export class NBody {
  bodies: SimBody[] = [];
  jd: number;
  /** Bumped whenever bodies are added / removed / merged (main thread re-syncs). */
  version = 0;
  private acc = new Float64Array(0);
  private dtNext = 0.1;
  private steps = 0;
  private readonly events: SimEvent[] = [];
  private rand = 12345;

  constructor(init: SimBodyInit[], jd: number) {
    this.jd = jd;
    for (const b of init) this.bodies.push({ ...b, pos: [...b.pos], vel: [...b.vel], alive: true, bound: !b.added, host: b.id === 'sun' ? undefined : 'sun' });
    this.computeAcc();
  }

  add(b: SimBodyInit): void {
    // Fronts that had passed everybody must now also reach the newcomer.
    for (const o of this.bodies) o.fieldFull = false;
    this.bodies.push({ ...b, pos: [...b.pos], vel: [...b.vel], alive: true, bound: false, addJd: this.jd, addPos: [...b.pos], fresh: true });
    this.version++;
    this.computeAcc();
  }

  remove(id: string): void {
    const b = this.bodies.find((x) => x.id === id && x.alive);
    if (!b) return;
    b.alive = false;
    b.goneJd = this.jd;
    b.gonePos = [...b.pos];
    b.ghost = b.mu > 0;
    this.version++;
    this.computeAcc();
  }

  /** On-screen collision radii (AU) by id. */
  setHit(radii: [string, number][]): void {
    const m = new Map(radii);
    for (const b of this.bodies) {
      const h = m.get(b.id);
      if (h !== undefined) b.hit = h;
    }
  }

  takeEvents(): SimEvent[] {
    return this.events.splice(0);
  }

  /**
   * Integrate towards `toJd`, stopping early after `budgetMs` of work, or
   * (with `stopOnTear`) right after a body is torn apart, so the main thread
   * can show it from its first moment.
   */
  advance(toJd: number, budgetMs: number, stopOnTear = false): void {
    const t0 = performance.now();
    const before = this.events.length;
    let n = 0;
    while (this.jd < toJd - 1e-12) {
      const dt = Math.min(this.dtNext, toJd - this.jd);
      this.step(dt);
      if (stopOnTear && this.events.length > before && this.events.slice(before).some((e) => e.type === 'disrupted')) break;
      if ((++n & 63) === 0 && performance.now() - t0 > budgetMs) break;
    }
  }

  private step(dt: number): void {
    const B = this.bodies;
    let a = this.acc;
    const h = dt * 0.5;
    // Bodies at the start of the step (debris interpolates between them).
    const n0 = B.length;
    const start = new Float64Array(n0 * 3);
    for (let i = 0; i < n0; i++) start.set(B[i].pos, i * 3);
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if ((!b.alive && !b.ghost) || b.kind === 'debris') continue;
      b.vel[0] += a[i * 3] * h;
      b.vel[1] += a[i * 3 + 1] * h;
      b.vel[2] += a[i * 3 + 2] * h;
      b.pos[0] += b.vel[0] * dt;
      b.pos[1] += b.vel[1] * dt;
      b.pos[2] += b.vel[2] * dt;
    }
    this.stepDebris(dt, n0, start);
    this.computeAcc();
    // A disruption inside computeAcc may have added debris (new, longer array).
    a = this.acc;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if ((!b.alive && !b.ghost) || b.kind === 'debris') continue;
      b.vel[0] += a[i * 3] * h;
      b.vel[1] += a[i * 3 + 1] * h;
      b.vel[2] += a[i * 3 + 2] * h;
    }
    this.jd += dt;
    this.steps++;
    if ((this.steps & 15) === 0) this.slowChecks();
  }

  /**
   * Debris across one step of `dt`: each piece takes its own leapfrog
   * sub-steps (η·√(r³/GM) of the nearest pull), feeling the bodies at
   * positions interpolated between the step's start and end. Orbits too
   * tight for that go round the dominant body on the exact conic. A piece
   * that touches a body falls onto it and adds its mass.
   */
  private stepDebris(dt: number, n0: number, start: Float64Array): void {
    const B = this.bodies;
    const heavy: number[] = [];
    for (let i = 0; i < n0; i++) if (B[i].alive && B[i].kind !== 'debris' && B[i].mu > 0) heavy.push(i);
    if (!heavy.length) return;
    const p = new Float64Array(heavy.length * 3);
    const acc = [0, 0, 0];
    let dom = 0;
    // Pull on a piece at `x` at fraction `f` of the step; returns the tightest
    // orbital time (and the body setting it, `dom`).
    // Share of the pull that comes from `dom` (set by field).
    let share = 0;
    const field = (x: number[], f: number): number => {
      acc[0] = acc[1] = acc[2] = 0;
      let tight = 0;
      let sum = 0;
      let domPull = 0;
      for (let k = 0; k < heavy.length; k++) {
        const i = heavy[k];
        const b = B[i];
        for (let c = 0; c < 3; c++) p[k * 3 + c] = start[i * 3 + c] + (b.pos[c] - start[i * 3 + c]) * f;
        const dx = p[k * 3] - x[0];
        const dy = p[k * 3 + 1] - x[1];
        const dz = p[k * 3 + 2] - x[2];
        const r2 = dx * dx + dy * dy + dz * dz;
        const r = Math.sqrt(r2);
        const s = b.mu / (r2 * r);
        acc[0] += s * dx;
        acc[1] += s * dy;
        acc[2] += s * dz;
        const pull = b.mu / r2;
        sum += pull;
        // Strongest tide GM/r³ = shortest orbital time (compared without roots).
        const tide = pull / r;
        if (tide > tight) {
          tight = tide;
          dom = k;
          domPull = pull;
        }
      }
      share = sum > 0 ? domPull / sum : 0;
      return tight > 0 ? 1 / Math.sqrt(tight) : Infinity;
    };
    // Touching distance² of a piece to each body (all pieces of a body share a size).
    const touch2 = new Float64Array(heavy.length);
    let touchFor = -1;
    for (let i = 0; i < n0; i++) {
      const d = B[i];
      if (!d.alive || d.kind !== 'debris') continue;
      if (d.radius !== touchFor) {
        touchFor = d.radius;
        for (let k = 0; k < heavy.length; k++) touch2[k] = contact(d, B[heavy[k]]) ** 2;
      }
      const x = d.pos;
      const v = d.vel;
      let t = 0;
      let tight = field(x, 0);
      // Too tight to step through, or ruled by one body and needing more than
      // a few sub-steps: follow the exact conic round that body instead.
      const kepler = DEBRIS_ETA * tight * DEBRIS_MAX_SUB < 4 * dt || (share > 0.95 && DEBRIS_ETA * tight * 8 < dt);
      if (kepler && this.keplerDebris(d, B[heavy[dom]], heavy[dom], dt, start)) continue;
      for (let sub = 0; t < dt - 1e-15 && d.alive; sub++) {
        // Out of sub-steps: finish the step in one go.
        const hs = sub >= DEBRIS_MAX_SUB - 1 ? dt - t : Math.min(dt - t, Math.max(DEBRIS_ETA * tight, DEBRIS_H_MIN));
        for (let c = 0; c < 3; c++) v[c] += acc[c] * hs * 0.5;
        for (let c = 0; c < 3; c++) x[c] += v[c] * hs;
        t += hs;
        tight = field(x, t / dt);
        for (let c = 0; c < 3; c++) v[c] += acc[c] * hs * 0.5;
        // Fallen onto a body?
        for (let k = 0; k < heavy.length; k++) {
          const b = B[heavy[k]];
          const ex = p[k * 3] - x[0];
          const ey = p[k * 3 + 1] - x[1];
          const ez = p[k * 3 + 2] - x[2];
          if (ex * ex + ey * ey + ez * ez < touch2[k]) {
            b.mu += d.mu;
            d.alive = false;
            this.version++;
            break;
          }
        }
      }
    }
  }

  /** Piece `d` on its exact orbit round `b` (index `bi`) for `dt`; false if that failed. */
  private keplerDebris(d: SimBody, b: SimBody, bi: number, dt: number, start: Float64Array): boolean {
    const bv = [0, 1, 2].map((c) => (b.pos[c] - start[bi * 3 + c]) / dt);
    const r = [0, 1, 2].map((c) => d.pos[c] - start[bi * 3 + c]);
    const v = [0, 1, 2].map((c) => d.vel[c] - bv[c]);
    const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
    const bound = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 < b.mu / Math.hypot(r[0], r[1], r[2]);
    // Its orbit dips into the body (and it gets there this step): it falls in.
    if ((bound || rv < 0) && periapsis(r, v, b.mu) < contact(d, b)) {
      b.mu += d.mu;
      d.alive = false;
      this.version++;
      return true;
    }
    if (!keplerStep(r, v, b.mu, dt)) return false;
    for (let c = 0; c < 3; c++) {
      d.pos[c] = b.pos[c] + r[c];
      d.vel[c] = bv[c] + v[c];
    }
    return true;
  }

  /** Accelerations, the next step size, collisions and Roche limits. */
  private computeAcc(): void {
    const B = this.bodies;
    const n = B.length;
    if (this.acc.length !== n * 3) this.acc = new Float64Array(n * 3);
    const a = this.acc;
    a.fill(0);
    let tauMin = Infinity;
    let hit: [number, number] | null = null;
    let tidal: [number, number] | null = null;
    for (let i = 0; i < n; i++) {
      const bi = B[i];
      if (!bi.alive && !bi.ghost) continue;
      for (let j = i + 1; j < n; j++) {
        const bj = B[j];
        if (!bj.alive && !bj.ghost) continue;
        if (bi.mu === 0 && bj.mu === 0) continue;
        if ((bi.ghost && bj.ghost) || (bi.kind === 'debris' && bj.kind === 'debris')) continue;
        // Pieces move in stepDebris; here only a heavy piece's pull on a body counts.
        if ((bi.kind === 'debris' && bi.mu < DEBRIS_PULL_MIN) || (bj.kind === 'debris' && bj.mu < DEBRIS_PULL_MIN)) continue;
        // Light-speed gravity, each way on its own.
        const jOnI = this.feels(bi, bj);
        const iOnJ = this.feels(bj, bi);
        if (!jOnI && !iOnJ) continue;
        const dx = bj.pos[0] - bi.pos[0];
        const dy = bj.pos[1] - bi.pos[1];
        const dz = bj.pos[2] - bi.pos[2];
        const r2 = dx * dx + dy * dy + dz * dz;
        const r = Math.sqrt(r2);
        const inv3 = 1 / (r2 * r);
        if (jOnI) {
          a[i * 3] += bj.mu * dx * inv3;
          a[i * 3 + 1] += bj.mu * dy * inv3;
          a[i * 3 + 2] += bj.mu * dz * inv3;
        }
        if (iOnJ) {
          a[j * 3] -= bi.mu * dx * inv3;
          a[j * 3 + 1] -= bi.mu * dy * inv3;
          a[j * 3 + 2] -= bi.mu * dz * inv3;
        }
        // Contact and tides only between bodies that exist and feel each other.
        const live = bi.alive && bj.alive && jOnI && iOnJ;
        if (bi.kind !== 'debris' && bj.kind !== 'debris') {
          const dvx = bj.vel[0] - bi.vel[0];
          const dvy = bj.vel[1] - bi.vel[1];
          const dvz = bj.vel[2] - bi.vel[2];
          const v = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz) + 1e-12;
          const tau = Math.min(Math.sqrt((r2 * r) / (bi.mu + bj.mu)), r / v);
          if (tau < tauMin) tauMin = tau;
          if (!live) continue;
          const touch = contact(bi, bj);
          if (!hit && r < touch) hit = [i, j];
          if (!tidal) {
            // The lighter one is torn apart inside the heavier one's Roche limit.
            const [big, small] = bi.mu >= bj.mu ? [bi, bj] : [bj, bi];
            if (small.mu > 0 && big.mu > 5 * small.mu && !COMPACT.has(small.kind) && small.kind !== 'comet') {
              const dR = 2.44 * small.radius * Math.cbrt(big.mu / small.mu);
              // On a collision course there is no time to be torn apart: it hits.
              const rv = dx * dvx + dy * dvy + dz * dvz;
              const cx = dy * dvz - dz * dvy;
              const cy = dz * dvx - dx * dvz;
              const cz = dx * dvy - dy * dvx;
              const impact = Math.sqrt(cx * cx + cy * cy + cz * cz) / v;
              const hitting = rv < 0 && impact < touch * 1.2;
              if (r < dR && !hitting) tidal = bi.mu >= bj.mu ? [i, j] : [j, i];
            }
          }
        }
        // Debris pairs: only the pieces' pull on the body counts here (the
        // pieces move in stepDebris).
      }
    }
    this.dtNext = Math.min(Math.max(ETA * tauMin, DT_MIN), DT_MAX);
    if (hit) this.collide(hit[0], hit[1]);
    else if (tidal) this.disrupt(tidal[0], tidal[1]);
  }

  /**
   * Does `t` feel `src`'s pull? Only once the field, spreading at c from
   * where `src` appeared, has got there; for a removed body, only until the
   * news of its removal arrives.
   */
  private feels(t: SimBody, src: SimBody): boolean {
    if (src.addPos && !src.fieldFull && !this.reached(src, t)) return false;
    if (src.ghost) {
      const p = src.gonePos!;
      const front = C_AU_DAY * (this.jd - src.goneJd!);
      return (t.pos[0] - p[0]) ** 2 + (t.pos[1] - p[1]) ** 2 + (t.pos[2] - p[2]) ** 2 > front * front;
    }
    return true;
  }

  /** Has `src`'s field (spreading at c from where it appeared) reached `b`? */
  private reached(src: SimBody, b: SimBody): boolean {
    const front = C_AU_DAY * (this.jd - (src.addJd ?? 0));
    const p = src.addPos!;
    const dx = b.pos[0] - p[0];
    const dy = b.pos[1] - p[1];
    const dz = b.pos[2] - p[2];
    return dx * dx + dy * dy + dz * dz <= front * front;
  }

  /** Days until `src`'s field reaches `b` (0 if it has). */
  delayTo(src: SimBody, b: SimBody): number {
    if (!src.addPos || src.fieldFull) return 0;
    const p = src.addPos;
    const d = Math.hypot(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
    return Math.max(0, d / C_AU_DAY - (this.jd - (src.addJd ?? 0)));
  }

  /** Destroyed by heat or radiation (main thread's damage model): a debris cloud. */
  shatter(id: string, text: string): void {
    const j = this.bodies.findIndex((b) => b.id === id && b.alive);
    if (j < 0) return;
    this.disrupt(-1, j, text);
  }

  private collide(i: number, j: number): void {
    const B = this.bodies;
    let big = B[i];
    let small = B[j];
    if (small.mu > big.mu || (COMPACT.has(small.kind) && !COMPACT.has(big.kind))) [big, small] = [small, big];
    const m = big.mu + small.mu;
    // Impact energy per kg of the merged body: relative motion plus the fall
    // onto the true surfaces (contact may be counted at the drawn ones).
    const vr2 = (big.vel[0] - small.vel[0]) ** 2 + (big.vel[1] - small.vel[1]) ** 2 + (big.vel[2] - small.vel[2]) ** 2;
    const vEsc2 = (2 * m) / (big.radius + small.radius);
    const AU_DAY_SQ_TO_J_KG = (1.495978707e11 / 86_400) ** 2;
    const impact = m > 0 ? ((0.5 * ((big.mu * small.mu) / m) * (vr2 + vEsc2)) / m) * AU_DAY_SQ_TO_J_KG : 0;
    for (let k = 0; k < 3; k++) {
      big.vel[k] = (big.vel[k] * big.mu + small.vel[k] * small.mu) / (m || 1);
      if (!COMPACT.has(big.kind)) big.pos[k] = (big.pos[k] * big.mu + small.pos[k] * small.mu) / (m || 1);
    }
    if (big.kind === 'bh') {
      big.radius = (2 * m) / (C_AU_DAY * C_AU_DAY);
      // What falls in flares up the disc for a while.
      if (small.kind !== 'debris') {
        big.feeding = true;
        big.feedLum = Math.max(big.feedLum ?? 0, (small.kind === 'star' ? 0.1 : 1e-4) * 3.2e4 * (big.mu / GM_SUN));
        big.feedJd = this.jd;
      }
    }
    else if (big.kind === 'planet' || big.kind === 'dwarf') big.radius = Math.cbrt(big.radius ** 3 + small.radius ** 3);
    big.mu = m;
    small.alive = false;
    small.goneJd = this.jd;
    small.gonePos = [...small.pos];
    this.version++;
    const swallowed = big.kind === 'bh';
    this.events.push({
      jd: this.jd,
      type: swallowed ? 'swallowed' : 'collision',
      text: swallowed ? `${label(small)}, ${label(big)} tarafından yutuldu.` : `${label(small)} ile ${label(big)} çarpışıp birleşti.`,
      ids: [small.id, big.id],
      impact,
    });
    this.computeAcc();
  }

  /** Tear `j` into a debris stream round `i` (the heavier body; -1: none). */
  private disrupt(i: number, j: number, text?: string): void {
    const big = i >= 0 ? this.bodies[i] : null;
    const small = this.bodies[j];
    small.alive = false;
    small.goneJd = this.jd;
    small.gonePos = [...small.pos];
    // Debris. Torn apart by tides: the pieces fill the stretched body (a
    // prolate ellipsoid ~1.9× long, pointing at the heavy body) and keep its
    // velocity ("frozen in"). Being at slightly different depths in the
    // heavy body's well they have slightly different orbital energies, so
    // gravity alone draws them out into a long thin stream: the inner half
    // bound and coming back, the outer half flung away. Shattered by heat or
    // an impact (no heavy body): a cloud expanding a little faster than the
    // body's escape speed.
    const vEsc = Math.sqrt((2 * small.mu) / small.radius);
    const R = small.radius;
    let axis: [number, number, number] | null = null;
    if (big) {
      const d = [small.pos[0] - big.pos[0], small.pos[1] - big.pos[1], small.pos[2] - big.pos[2]];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      axis = [d[0] / L, d[1] / L, d[2] / L];
    }
    // Two directions across the axis.
    const ax = axis ?? [1, 0, 0];
    const t1 = Math.abs(ax[0]) < 0.9 ? cross(ax, [1, 0, 0]) : cross(ax, [0, 1, 0]);
    const t2 = cross(ax, t1);
    for (let k = 0; k < DEBRIS_COUNT; k++) {
      // A point spread evenly through the unit ball (stratified along the axis).
      const u = -1 + (2 * (k + 0.5)) / DEBRIS_COUNT;
      const across = Math.sqrt(Math.max(0, 1 - u * u)) * Math.sqrt(this.unit());
      const phi = 2 * Math.PI * this.unit();
      const a = across * Math.cos(phi);
      const b = across * Math.sin(phi);
      const pos = [0, 1, 2].map((c) => small.pos[c]);
      const vel = [0, 1, 2].map((c) => small.vel[c]);
      if (axis) {
        const along = u * 1.9 * R;
        const side = R / Math.sqrt(1.9);
        for (let c = 0; c < 3; c++) {
          pos[c] += ax[c] * along + (t1[c] * a + t2[c] * b) * side;
          vel[c] += this.gauss() * vEsc * 0.03;
        }
      } else {
        const dir = [ax[0] * u + t1[0] * a + t2[0] * b, ax[1] * u + t1[1] * a + t2[1] * b, ax[2] * u + t1[2] * a + t2[2] * b];
        const speed = vEsc * (1.05 + 0.3 * this.unit());
        for (let c = 0; c < 3; c++) {
          pos[c] += dir[c] * R;
          vel[c] += dir[c] * speed;
        }
      }
      this.bodies.push({
        id: `${small.id}-d${k}`,
        name: `${small.name} parçası`,
        kind: 'debris',
        // The mass lives on in the pieces (a torn star still pulls its planets).
        mu: small.mu / DEBRIS_COUNT,
        radius: R * 0.05,
        pos: pos as [number, number, number],
        vel: vel as [number, number, number],
        alive: true,
        bound: true,
      });
    }
    // A black hole swallowing the remains shines: brightly for a star
    // (0.1 Eddington), faintly for a planet; it fades over months (t^-5/3).
    if (big && big.kind === 'bh') {
      const lEdd = 3.2e4 * (big.mu / GM_SUN);
      const lum = small.kind === 'star' ? 0.1 * lEdd : 1e-4 * lEdd * Math.min(1, small.mu / (GM_SUN * 1e-3));
      big.feeding = true;
      big.feedLum = Math.max(big.feedLum ?? 0, lum);
      big.feedJd = this.jd;
    }
    this.version++;
    this.events.push({
      jd: this.jd,
      type: 'disrupted',
      text:
        text ??
        (small.kind === 'star'
          ? `${label(small)}, ${label(big!)} tarafından gelgit kuvvetiyle parçalandı; artıkları bir disk oluşturuyor.`
          : big!.kind === 'bh'
            ? `${label(small)}, ${label(big!)} tarafından spagetti gibi uzatılıp parçalandı; parçaları kara deliğin çevresinde dönüyor.`
            : `${label(small)}, ${label(big!)} yakınında gelgit kuvvetiyle parçalandı.`),
      ids: big ? [small.id, big.id] : [small.id],
    });
    this.computeAcc();
  }

  /** Uniform in (0, 1), deterministic per session. */
  private unit(): number {
    this.rand ^= this.rand << 13;
    this.rand ^= this.rand >>> 17;
    this.rand ^= this.rand << 5;
    return ((this.rand >>> 0) % 1e9) / 1e9 + 1e-9;
  }

  private gauss(): number {
    // xorshift + Box-Muller (deterministic per session).
    const u = () => {
      this.rand ^= this.rand << 13;
      this.rand ^= this.rand >>> 17;
      this.rand ^= this.rand << 5;
      return ((this.rand >>> 0) % 1e9) / 1e9 + 1e-9;
    };
    return Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  }

  /** Hill radius of `h` against the heavier body pulling it hardest (∞ if none). */
  private hillRadius(h: SimBody, heavy: SimBody[]): number {
    let best = Infinity;
    for (const o of heavy) {
      if (o === h || o.mu <= h.mu) continue;
      const d = Math.hypot(h.pos[0] - o.pos[0], h.pos[1] - o.pos[1], h.pos[2] - o.pos[2]);
      best = Math.min(best, d * Math.cbrt(h.mu / (3 * o.mu)));
    }
    return best;
  }

  /**
   * Ejection, capture and the habitable-zone watch (every 16 steps).
   * Each light body's host is the lightest heavy body it is bound to
   * (two-body energy) and inside whose Hill sphere it sits: a far giant
   * black hole pulls the whole Solar System, yet the planets keep circling
   * the Sun until its tides strip them (r > Hill radius). Changing host is an event
   * ("the black hole stole Jupiter"); bound to none and far from all of
   * them, it has been ejected.
   */
  private slowChecks(): void {
    const heavyAll = this.bodies.filter((b) => b.alive && b.mu > GM_SUN * 0.05);
    for (const b of this.bodies) {
      if (!b.alive || b.kind === 'debris' || heavyAll.includes(b)) continue;
      // Only heavy bodies whose pull has reached this one count.
      const heavy = heavyAll.filter((h) => !h.addPos || h.fieldFull || this.reached(h, b));
      // Candidate host: the lightest heavy body it is bound to, within its Hill sphere.
      let cand: SimBody | null = null;
      let nearest = Infinity;
      // Fallback: the heavy body it is most tightly bound to.
      let tight: SimBody | null = null;
      let tightE = 0;
      for (const h of heavy) {
        const r = Math.hypot(b.pos[0] - h.pos[0], b.pos[1] - h.pos[1], b.pos[2] - h.pos[2]);
        nearest = Math.min(nearest, r);
        const vv = (b.vel[0] - h.vel[0]) ** 2 + (b.vel[1] - h.vel[1]) ** 2 + (b.vel[2] - h.vel[2]) ** 2;
        const e = vv / 2 - (h.mu + b.mu) / r;
        if (e < tightE) {
          tightE = e;
          tight = h;
        }
        if (e < 0 && r < this.hillRadius(h, heavy) && (!cand || h.mu < cand.mu)) cand = h;
      }
      const now = cand ? cand.id : tight ? tight.id : nearest > 40 ? 'none' : (b.host ?? 'none');
      // Put on an orbit: it starts out with that host, no "captured" news.
      if (b.fresh) {
        b.fresh = false;
        if (now !== 'none') {
          b.host = now;
          continue;
        }
      }
      // Hysteresis: a change only counts once it has held for 60 days (no flicker mid-encounter).
      if (now === (b.host ?? 'none')) {
        b.pendingSince = undefined;
        continue;
      }
      if (b.pending !== now) {
        b.pending = now;
        b.pendingSince = this.jd;
        continue;
      }
      if (this.jd - (b.pendingSince ?? this.jd) < 60) continue;
      const was = b.host;
      b.pendingSince = undefined;
      if (now === 'none') {
        b.host = undefined;
        if (!b.ejected) {
          b.ejected = true;
          const text = heavy.length
            ? `${b.name} hiçbir yıldıza bağlı kalmadı: Güneş Sistemi'nden fırlatıldı.`
            : `${b.name} artık hiçbir yıldıza bağlı değil: son hızıyla düz bir çizgide uzaklaşıyor.`;
          this.events.push({ jd: this.jd, type: 'ejected', text, ids: [b.id] });
        }
        continue;
      }
      const host = heavy.find((h) => h.id === now)!;
      b.host = now;
      b.ejected = false;
      this.events.push({
        jd: this.jd,
        type: 'captured',
        text:
          was === undefined
            ? `${b.name}, ${host.name} çevresinde yörüngeye girdi.`
            : now === 'sun'
              ? `${b.name} yeniden Güneş'in çevresinde dolanıyor.`
              : was === 'sun' && host.mu > (heavy.find((h) => h.id === 'sun')?.mu ?? Infinity)
                ? `${b.name}, ${host.name} gelgit kuvvetiyle Güneş'ten koparıldı: artık onun çevresinde dolanıyor.`
                : `${b.name}, ${host.name} tarafından kapıldı: artık onun çevresinde dolanıyor.`,
        ids: [b.id, now],
      });
    }
    // A heavy added body (star, black hole) and the Sun: a new binary.
    const sun = this.bodies.find((b) => b.id === 'sun' && b.alive);
    if (sun) {
      for (const b of heavyAll) {
        if (!b.added || (b.addPos && !b.fieldFull && !this.reached(b, sun))) continue;
        const r = Math.hypot(b.pos[0] - sun.pos[0], b.pos[1] - sun.pos[1], b.pos[2] - sun.pos[2]);
        const v2 = (b.vel[0] - sun.vel[0]) ** 2 + (b.vel[1] - sun.vel[1]) ** 2 + (b.vel[2] - sun.vel[2]) ** 2;
        const E = v2 / 2 - (sun.mu + b.mu) / r;
        if (E < 0 && !b.bound) {
          b.bound = true;
          this.events.push({ jd: this.jd, type: 'captured', text: `${b.name} ile Güneş birbirinin çekimine kapıldı: artık bir çift sistem gibi dolanıyorlar.`, ids: [b.id] });
        } else if (E > 0 && b.bound) b.bound = false;
      }
    }
    // Ghosts fade once the news of their removal has reached everybody.
    for (const g of this.bodies) {
      if (!g.ghost) continue;
      const front = C_AU_DAY * (this.jd - g.goneJd!);
      const p = g.gonePos!;
      if (this.bodies.every((o) => !o.alive || Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1], o.pos[2] - p[2]) <= front)) g.ghost = false;
    }
    // Field fronts: the moment an added body's pull reaches the Earth; done once past everyone.
    const earth = this.bodies.find((b) => b.id === 'earth' && b.alive);
    for (const b of this.bodies) {
      if (!b.alive || !b.addPos || b.fieldFull) continue;
      if (earth && !b.reachedEarth && this.reached(b, earth)) {
        b.reachedEarth = true;
        // The true light-travel time (checks run every few steps, so not "now − added").
        const p = b.addPos;
        const days = Math.hypot(earth.pos[0] - p[0], earth.pos[1] - p[1], earth.pos[2] - p[2]) / C_AU_DAY;
        if (days > 3) this.events.push({ jd: (b.addJd ?? this.jd) + days, type: 'arrival', text: `${b.name}: kütle çekimi ışık hızıyla ${Math.round(days).toLocaleString('tr-TR')} günde Dünya'ya ulaştı.`, ids: [b.id, 'earth'] });
      }
      if (this.bodies.every((o) => !o.alive || o === b || this.reached(b, o))) b.fieldFull = true;
    }
  }
}

function cross(a: number[], b: number[]): [number, number, number] {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  const L = Math.hypot(x, y, z) || 1;
  return [x / L, y / L, z / L];
}
