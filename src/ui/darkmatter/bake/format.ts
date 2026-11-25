/**
 * Pre-baked particle animations for the dark-matter film ("DMB1").
 *
 * Layout: ASCII "DMB1", uint32 LE header length, UTF-8 JSON header, zero padding to a multiple
 * of 4 bytes, then per frame all groups' int16 x, y, z (x_q = round(x / half * 32767)), then,
 * if the header has `rho`, per frame one uint8 per particle of that group holding log10 density
 * quantised between `lo` and `hi`.
 */

export interface BakeGroup {
  name: string;
  count: number;
}

export interface BakeHeader {
  version: 1;
  /** Simulation time of every frame (Gyr), ascending. */
  times: number[];
  groups: BakeGroup[];
  /** Position quantisation half range (Mpc). */
  half: number;
  /** Per-particle density of one group, log10 quantised to uint8 between lo and hi. */
  rho?: { group: string; lo: number; hi: number };
  meta?: Record<string, string | number>;
}

export interface Baked {
  header: BakeHeader;
  /** All groups back to back, xyz triplets in Mpc (fresh array). */
  positions(i: number): Float32Array;
  /** Linear density of the `rho` group (fresh array), or null when the file has none. */
  rho(i: number): Float32Array | null;
  /** Frames around time t and the blend between them; clamped to the first / last frame. */
  locate(t: number): { i: number; j: number; mix: number };
}

const MAGIC = 'DMB1';
const Q = 32767;

const total = (h: BakeHeader): number => h.groups.reduce((s, g) => s + g.count, 0);

export function groupRange(h: BakeHeader, name: string): [number, number] {
  let from = 0;
  for (const g of h.groups) {
    if (g.name === name) return [from, from + g.count];
    from += g.count;
  }
  throw new Error(`Unknown bake group "${name}"`);
}

function rhoCount(h: BakeHeader): number {
  if (!h.rho) return 0;
  const [a, b] = groupRange(h, h.rho.group);
  return b - a;
}

export function encodeBake(h: BakeHeader, frames: Float32Array[], rho?: Float32Array[]): Uint8Array {
  const n = total(h);
  const nr = rhoCount(h);
  const json = new TextEncoder().encode(JSON.stringify(h));
  const head = (8 + json.length + 3) & ~3;
  const posBytes = frames.length * n * 3 * 2;
  const out = new Uint8Array(head + posBytes + (h.rho ? frames.length * nr : 0));
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  const pos = new Int16Array(out.buffer, head, frames.length * n * 3);
  frames.forEach((f, i) => {
    for (let k = 0; k < n * 3; k++) pos[i * n * 3 + k] = Math.max(-Q, Math.min(Q, Math.round((f[k] / h.half) * Q)));
  });
  if (h.rho && rho) {
    const { lo, hi } = h.rho;
    const r8 = new Uint8Array(out.buffer, head + posBytes, frames.length * nr);
    rho.forEach((r, i) => {
      for (let k = 0; k < nr; k++) {
        const l = Math.log10(Math.max(r[k], 1e-30));
        r8[i * nr + k] = Math.max(0, Math.min(255, Math.round(((l - lo) / (hi - lo)) * 255)));
      }
    });
  }
  return out;
}

export function decodeBake(buf: ArrayBuffer): Baked {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 8 || new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error('Geçersiz karanlık madde veri dosyası');
  const len = new DataView(buf).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as BakeHeader;
  const head = (8 + len + 3) & ~3;
  const n = total(header);
  const nf = header.times.length;
  const nr = rhoCount(header);
  const pos = new Int16Array(buf, head, nf * n * 3);
  const r8 = header.rho ? new Uint8Array(buf, head + nf * n * 6, nf * nr) : null;
  const scale = header.half / Q;
  return {
    header,
    positions(i) {
      const out = new Float32Array(n * 3);
      const o = i * n * 3;
      for (let k = 0; k < n * 3; k++) out[k] = pos[o + k] * scale;
      return out;
    },
    rho(i) {
      if (!r8 || !header.rho) return null;
      const { lo, hi } = header.rho;
      const out = new Float32Array(nr);
      for (let k = 0; k < nr; k++) out[k] = 10 ** (lo + (r8[i * nr + k] / 255) * (hi - lo));
      return out;
    },
    locate(t) {
      const ts = header.times;
      if (!(t > ts[0])) return { i: 0, j: 0, mix: 0 };
      if (t >= ts[nf - 1]) return { i: nf - 1, j: nf - 1, mix: 0 };
      let i = 0;
      while (ts[i + 1] <= t) i++;
      return { i, j: i + 1, mix: (t - ts[i]) / (ts[i + 1] - ts[i]) };
    },
  };
}
