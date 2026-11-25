/** Small radix-2 complex 3D FFT on an n^3 cube stored as (i*n + j)*n + k. */
export class FFT3 {
  private readonly cosT: Float64Array;
  private readonly sinT: Float64Array;
  private readonly rev: Uint32Array;
  private readonly lr: Float64Array;
  private readonly li: Float64Array;
  private readonly n: number;

  constructor(n: number) {
    this.n = n;
    this.cosT = new Float64Array(n / 2);
    this.sinT = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cosT[k] = Math.cos((2 * Math.PI * k) / n);
      this.sinT[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.lr = new Float64Array(n);
    this.li = new Float64Array(n);
  }

  private line(sign: number): void {
    const { n, lr, li, rev, cosT, sinT } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = lr[i];
        lr[i] = lr[j];
        lr[j] = t;
        t = li[i];
        li[i] = li[j];
        li[j] = t;
      }
    }
    // Stages 2 and 4 need no table lookups (twiddles are 1 and sign * i).
    for (let s = 0; s < n; s += 4) {
      const ar = lr[s] + lr[s + 1];
      const ai = li[s] + li[s + 1];
      const br = lr[s] - lr[s + 1];
      const bi = li[s] - li[s + 1];
      const cr = lr[s + 2] + lr[s + 3];
      const ci = li[s + 2] + li[s + 3];
      const er = lr[s + 2] - lr[s + 3];
      const ei = li[s + 2] - li[s + 3];
      const tr = -sign * ei;
      const ti = sign * er;
      lr[s] = ar + cr;
      li[s] = ai + ci;
      lr[s + 2] = ar - cr;
      li[s + 2] = ai - ci;
      lr[s + 1] = br + tr;
      li[s + 1] = bi + ti;
      lr[s + 3] = br - tr;
      li[s + 3] = bi - ti;
    }
    for (let size = 8; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = cosT[t];
          const wi = sign * sinT[t];
          const a = s + k;
          const b = a + half;
          const xr = lr[b] * wr - li[b] * wi;
          const xi = lr[b] * wi + li[b] * wr;
          lr[b] = lr[a] - xr;
          li[b] = li[a] - xi;
          lr[a] += xr;
          li[a] += xi;
        }
      }
    }
  }

  /** In-place transform (forward: exp(-i...)); the inverse is not normalised. */
  transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const { n, lr, li } = this;
    const sign = inverse ? 1 : -1;
    const strides = [1, n, n * n];
    for (let axis = 0; axis < 3; axis++) {
      const st = strides[axis];
      for (let p = 0; p < n; p++) {
        for (let q = 0; q < n; q++) {
          // Line start: the two other indices are (p, q).
          const base = axis === 0 ? p * n * n + q * n : axis === 1 ? p * n * n + q : p * n + q;
          for (let m = 0, o = base; m < n; m++, o += st) {
            lr[m] = re[o];
            li[m] = im[o];
          }
          this.line(sign);
          for (let m = 0, o = base; m < n; m++, o += st) {
            re[o] = lr[m];
            im[o] = li[m];
          }
        }
      }
    }
  }
}
