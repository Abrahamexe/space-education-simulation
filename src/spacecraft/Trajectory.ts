import { keplerStep } from '../playground/kepler';

/** Centre a trajectory segment is given about. */
export type CraftCenter = 'sun' | 'earth' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto';

export interface SegmentData {
  center: CraftCenter;
  /** km³/s² */
  gm: number;
  /** First sample (JD TDB) and spacing (days). */
  t0: number;
  step: number;
  n: number;
  /** First sample's index in the craft's sample array. */
  offset: number;
  /** 'kepler': two-body about the centre; 'hermite': cubic in position/velocity (L2 halo orbits). */
  interp: 'kepler' | 'hermite';
}

export interface CraftTrackData {
  horizons: string;
  startJd: number;
  endJd: number;
  segments: SegmentData[];
}

export interface CraftState {
  center: CraftCenter;
  /** Position (km) and velocity (km/s) relative to the centre, ecliptic J2000. */
  r: [number, number, number];
  v: [number, number, number];
}

const DAY_S = 86400;

/**
 * A spacecraft's trajectory from JPL Horizons state vectors (see
 * scripts/fetch-spacecraft.mjs). Between two samples the state is the blend
 * of both neighbours propagated to the time, on a conic about the segment's
 * centre (exact for coasting flight, so hourly samples hold a 5-Jupiter-radii
 * flyby) or, for the L2 observatories, by cubic Hermite interpolation.
 */
export class Trajectory {
  private data: Float32Array | null = null;
  private loading: Promise<void> | null = null;
  private readonly ra = [0, 0, 0];
  private readonly va = [0, 0, 0];
  private readonly rb = [0, 0, 0];
  private readonly vb = [0, 0, 0];

  constructor(
    readonly id: string,
    readonly track: CraftTrackData,
  ) {}

  get loaded(): boolean {
    return this.data !== null;
  }

  load(): Promise<void> {
    this.loading ??= fetch(`${import.meta.env.BASE_URL}data/spacecraft/${this.id}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((b) => void (this.data = new Float32Array(b)))
      .catch(() => {
        this.loading = null;
      });
    return this.loading;
  }

  covers(jd: number): boolean {
    return jd >= this.track.startJd && jd <= this.track.endJd;
  }

  /** Segment holding the time (or the nearest one in a gap between two). */
  segmentAt(jd: number): SegmentData | null {
    const segs = this.track.segments;
    if (!this.covers(jd)) return null;
    const end = (s: SegmentData) => s.t0 + (s.n - 1) * s.step;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (jd < s.t0 && i > 0) {
        // In the gap before this segment: the nearer of its neighbours.
        return jd - end(segs[i - 1]) < s.t0 - jd ? segs[i - 1] : s;
      }
      if (jd <= end(s)) return s;
    }
    return segs[segs.length - 1];
  }

  private sample(s: SegmentData, i: number, r: number[], v: number[]): void {
    const d = this.data!;
    const o = (s.offset + i) * 6;
    r[0] = d[o];
    r[1] = d[o + 1];
    r[2] = d[o + 2];
    v[0] = d[o + 3];
    v[1] = d[o + 4];
    v[2] = d[o + 5];
  }

  /** Sample k of a segment (for drawing the path). */
  sampleAt(s: SegmentData, k: number, out: CraftState): CraftState {
    this.sample(s, k, out.r, out.v);
    out.center = s.center;
    return out;
  }

  /** State at a Julian date, or null outside the data (or not loaded yet). */
  stateAt(jd: number, out: CraftState): CraftState | null {
    if (!this.data) return null;
    const s = this.segmentAt(jd);
    if (!s) return null;
    const raw = (jd - s.t0) / s.step;
    if (raw < 0 || raw > s.n - 1 || s.n < 2) {
      // In a gap between segments: carry the nearest end sample over.
      const k = raw < 0 ? 0 : s.n - 1;
      this.sample(s, k, out.r, out.v);
      keplerStep(out.r, out.v, s.gm, (jd - (s.t0 + k * s.step)) * DAY_S);
      out.center = s.center;
      return out;
    }
    const x = raw;
    const i = Math.min(Math.floor(x), s.n - 2);
    const f = x - i;
    const { ra, va, rb, vb } = this;
    this.sample(s, i, ra, va);
    this.sample(s, i + 1, rb, vb);
    out.center = s.center;
    if (s.interp === 'hermite') {
      // Cubic Hermite on [0, 1] with velocities scaled to the step.
      const h = s.step * DAY_S;
      const f2 = f * f;
      const f3 = f2 * f;
      const h00 = 2 * f3 - 3 * f2 + 1;
      const h10 = f3 - 2 * f2 + f;
      const h01 = -2 * f3 + 3 * f2;
      const h11 = f3 - f2;
      const d00 = (6 * f2 - 6 * f) / h;
      const d10 = 3 * f2 - 4 * f + 1;
      const d01 = (-6 * f2 + 6 * f) / h;
      const d11 = 3 * f2 - 2 * f;
      for (let k = 0; k < 3; k++) {
        out.r[k] = h00 * ra[k] + h10 * h * va[k] + h01 * rb[k] + h11 * h * vb[k];
        out.v[k] = d00 * ra[k] + d10 * va[k] + d01 * rb[k] + d11 * vb[k];
      }
      return out;
    }
    // Both neighbours carried to the time on their conics, blended smoothly.
    const dtA = f * s.step * DAY_S;
    const dtB = (f - 1) * s.step * DAY_S;
    const okA = f === 0 || keplerStep(ra, va, s.gm, dtA);
    const okB = f === 1 || keplerStep(rb, vb, s.gm, dtB);
    const w = okA && okB ? f * f * (3 - 2 * f) : okA ? 0 : 1;
    for (let k = 0; k < 3; k++) {
      out.r[k] = ra[k] + (rb[k] - ra[k]) * w;
      out.v[k] = va[k] + (vb[k] - va[k]) * w;
    }
    return out;
  }
}
