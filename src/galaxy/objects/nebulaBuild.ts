import { DataUtils, MathUtils } from 'three';
import type { DepthSpec } from '../../config/deepsky';
import { Random } from '../../utils/random';

const DEG = Math.PI / 180;

/** Image pixel as the depth models see it. */
interface Px {
  /** Centred, y up, in image widths. */
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  /** Luminance, normalised to the image maximum. */
  l: number;
}

/**
 * Up to two depth layers and a thickness (image widths, + towards the Sun)
 * for a pixel, following the object's published structure (see DepthSpec).
 */
function layers(d: DepthSpec, p: Px, ax: number, ay: number): [number, number, number] {
  // Galaxy models work about the anchor (the nucleus).
  const x = p.x - ax;
  const y = p.y - ay;
  switch (d.model) {
    case 'disc': {
      const a = d.majorDeg * DEG;
      const u = x * Math.cos(a) + y * Math.sin(a);
      const v = (-x * Math.sin(a) + y * Math.cos(a)) / Math.cos(d.incDeg * DEG);
      const r2 = (u * u + v * v) / (d.bulge * d.bulge);
      return [0, 0, d.thick + d.bulge * 0.25 * Math.exp(-r2)];
    }
    case 'edge': {
      const a = d.majorDeg * DEG;
      const u = x * Math.cos(a) + y * Math.sin(a);
      const v = -x * Math.sin(a) + y * Math.cos(a);
      // Depth of the disc along the line of sight at this point of the major axis.
      const D = d.length * Math.sqrt(Math.max(0, 1 - (u * u) / (d.length * d.length)));
      const B = d.bulge * Math.sqrt(Math.max(0, 1 - (u * u + v * v) / (d.bulge * d.bulge)));
      return [D * 0.45, -D * 0.45, Math.max(0.01, D * 0.35, B * 0.6)];
    }
    case 'ellipsoid': {
      const q = (x * x + y * y) / (d.radius * d.radius);
      return [0, 0, Math.max(0.01, d.depth * d.radius * Math.sqrt(Math.max(0, 1 - q)) * 0.6)];
    }
    case 'flat':
      return [0, 0, d.depth * (0.3 + 0.7 * p.l)];
    case 'shell': {
      const c = Math.cos(d.angleDeg * DEG);
      const s = Math.sin(d.angleDeg * DEG);
      const u = (p.x * c - p.y * s) / d.a;
      const v = (p.x * s + p.y * c) / d.b;
      const q = u * u + v * v;
      if (q >= 1) return [0, 0, 0.03];
      const z = Math.sqrt(1 - q) * d.depth;
      if (d.interiorBlue && p.b > p.r * 1.05) return [0, 0, z * 0.55 + 0.01];
      return [z, -z, 0.012 + 0.12 * z];
    }
    case 'bowl': {
      const dx = p.x - d.cx;
      const dy = p.y - d.cy;
      const z = Math.min(-d.deep + (dx * dx + dy * dy) / (2 * d.curvature), 0.25);
      return [z, z, 0.018];
    }
    case 'pillars': {
      const background = p.b > p.r * 0.95 || p.l < 0.12;
      return background ? [-0.3, -0.3, 0.06] : [0.02, 0.02, 0.025];
    }
    case 'barrel': {
      const c = Math.cos(d.angleDeg * DEG);
      const s = Math.sin(d.angleDeg * DEG);
      const u = (p.x * c - p.y * s) / d.a;
      const v = (p.x * s + p.y * c) / d.b;
      const rn = Math.sqrt(u * u + v * v);
      if (p.b > p.r && rn < 0.9) {
        const L = d.lobe * Math.sqrt(Math.max(0, 1 - rn * rn)) * d.a + 0.02;
        return [L * 0.6, -L * 0.6, L * 0.45];
      }
      return [0, 0, rn > 1.15 ? 0.07 : 0.03];
    }
    case 'bipolar': {
      const c = Math.cos(d.axisDeg * DEG);
      const s = Math.sin(d.axisDeg * DEG);
      const along = p.x * c + p.y * s;
      const across = -p.x * s + p.y * c;
      const R = d.waist + d.flare * Math.abs(along);
      if (Math.abs(across) >= R) return [0, 0, 0.03];
      const z = Math.sqrt(R * R - across * across);
      return [z * 0.85, -z * 0.85, 0.02 + 0.15 * z];
    }
    case 'sheet': {
      const dust = p.r > p.b * 1.02;
      return dust ? [0.04 + (0.5 - p.l) * 0.05, 0.04 + (0.5 - p.l) * 0.05, 0.035] : [-0.18 - p.l * 0.05, -0.18 - p.l * 0.05, 0.05];
    }
  }
}

/** 0..1: is this pixel part of the galaxy (1) or foreground stars / sky (0)? */
function galaxyMask(d: DepthSpec, p: Px, ax: number, ay: number): number {
  const x = p.x - ax;
  const y = p.y - ay;
  const fade = (q: number) => 1 - MathUtils.smoothstep(q, 0.8, 1.2);
  switch (d.model) {
    case 'disc': {
      const a = d.majorDeg * DEG;
      const u = x * Math.cos(a) + y * Math.sin(a);
      const v = (-x * Math.sin(a) + y * Math.cos(a)) / Math.cos(d.incDeg * DEG);
      return fade(Math.sqrt(u * u + v * v) / d.extent);
    }
    case 'edge': {
      const a = d.majorDeg * DEG;
      const u = (x * Math.cos(a) + y * Math.sin(a)) / (d.length * 1.1);
      const v = (-x * Math.sin(a) + y * Math.cos(a)) / Math.max(d.bulge * 1.6, d.length * 0.2);
      return fade(Math.sqrt(u * u + v * v));
    }
    case 'ellipsoid':
      return fade(Math.sqrt(x * x + y * y) / d.extent);
    default:
      return 1;
  }
}

export interface NebulaBuildInput {
  /** N×N RGBA pixels of the picture (row 0 = top). */
  px: Uint8ClampedArray;
  N: number;
  slices: number;
  depth: DepthSpec;
  /** Anchor in centred image widths (y up). */
  ax: number;
  ay: number;
  aspect: number;
  /** Picture size (object units). */
  W: number;
  H: number;
  seed: number;
  count: number;
  /** Particle size in picture widths. */
  particleSize: number;
}

export interface NebulaBuildOutput {
  /** N×N half floats RGBA: z1, z2, thickness, 1 / sum of slice weights (rows bottom-up). */
  depth: Uint16Array;
  zRange: number;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
}

/**
 * Depth map and particles for a SlicedNebula from its picture, following
 * the object's structure model. Pure, so it runs in a worker.
 */
export function computeNebula(inp: NebulaBuildInput): NebulaBuildOutput {
  const { px, N, depth: d, ax, ay } = inp;
  const SLICES = inp.slices;
  let maxL = 0;
  for (let i = 0; i < N * N; i++) maxL = Math.max(maxL, px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]);
  maxL = maxL / 765 || 1;
  // sRGB byte to linear, by table.
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) LIN[i] = Math.pow(i / 255, 2.2);
  const yScale = 1 / inp.aspect;

  // Raw layers (image widths).
  const raw = new Float32Array(N * N * 3);
  const mask = new Float32Array(N * N);
  let zRange = 0.02;
  const p: Px = { x: 0, y: 0, r: 0, g: 0, b: 0, l: 0 };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      p.x = (i + 0.5) / N - 0.5;
      p.y = (0.5 - (j + 0.5) / N) * yScale;
      p.r = LIN[px[k * 4]];
      p.g = LIN[px[k * 4 + 1]];
      p.b = LIN[px[k * 4 + 2]];
      p.l = (px[k * 4] + px[k * 4 + 1] + px[k * 4 + 2]) / 765 / maxL;
      const [z1, z2, th] = layers(d, p, ax, ay);
      mask[k] = galaxyMask(d, p, ax, ay);
      raw[k * 3] = z1;
      raw[k * 3 + 1] = z2;
      raw[k * 3 + 2] = th;
      zRange = Math.max(zRange, Math.abs(z1) + th, Math.abs(z2) + th);
    }
  }
  // Slices are evenly spread over ±zRange; thickness never below ~half a
  // spacing so no light falls between slices. Normalisation per pixel.
  const spacing = (2 * zRange) / (SLICES - 1);
  const depth = new Uint16Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    const z1 = raw[k * 3] / zRange;
    const z2 = raw[k * 3 + 1] / zRange;
    const th = Math.max(raw[k * 3 + 2], spacing * 0.6) / zRange;
    const inv = -0.5 / (th * th);
    let sum = 0;
    for (let s = 0; s < SLICES; s++) {
      const zs = (s / (SLICES - 1)) * 2 - 1;
      const a = zs - z1;
      const b = zs - z2;
      sum += Math.exp(a * a * inv) + Math.exp(b * b * inv);
    }
    // Rows flipped: texture v = 0 is the image bottom.
    const row = N - 1 - Math.floor(k / N);
    const o = (row * N + (k % N)) * 4;
    depth[o] = DataUtils.toHalfFloat(z1);
    depth[o + 1] = DataUtils.toHalfFloat(z2);
    depth[o + 2] = DataUtils.toHalfFloat(th);
    depth[o + 3] = DataUtils.toHalfFloat(mask[k] / Math.max(sum, 1e-3));
  }

  // Particles: soft splats drawn from the same layers.
  const rnd = new Random(inp.seed);
  const count = inp.count;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const { W, H } = inp;
  let n = 0;
  for (let guard = 0; n < count && guard < count * 60; guard++) {
    const fx = rnd.next();
    const fy = rnd.next();
    const i = Math.min(N - 1, Math.floor(fx * N));
    const j = Math.min(N - 1, Math.floor(fy * N));
    const k = j * N + i;
    const l = (px[k * 4] + px[k * 4 + 1] + px[k * 4 + 2]) / 765 / maxL;
    const edge = MathUtils.smoothstep(Math.min(fx, 1 - fx), 0, 0.12) * MathUtils.smoothstep(Math.min(fy, 1 - fy), 0, 0.12);
    if (l < 0.07 || rnd.next() > Math.pow(l, 1.3) * edge * mask[k]) continue;
    const z = (rnd.next() < 0.5 ? raw[k * 3] : raw[k * 3 + 1]) + rnd.gaussian() * raw[k * 3 + 2];
    pos[n * 3] = (fx - 0.5) * W;
    pos[n * 3 + 1] = (0.5 - fy) * H;
    pos[n * 3 + 2] = z * W;
    const r = LIN[px[k * 4]];
    const g = LIN[px[k * 4 + 1]];
    const b = LIN[px[k * 4 + 2]];
    const m = Math.max(r, g, b, 1e-4);
    const kk = 0.5 + 0.5 * l;
    col[n * 3] = (r / m) * kk;
    col[n * 3 + 1] = (g / m) * kk;
    col[n * 3 + 2] = (b / m) * kk;
    size[n] = W * inp.particleSize * rnd.range(0.6, 1.4);
    n++;
  }
  return { depth, zRange, pos: pos.slice(0, n * 3), col: col.slice(0, n * 3), size: size.slice(0, n) };
}

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (out: NebulaBuildOutput) => void>();

/** computeNebula in a shared worker (falls back to the main thread). */
export function buildNebula(input: NebulaBuildInput): Promise<NebulaBuildOutput> {
  if (typeof Worker === 'undefined') return Promise.resolve(computeNebula(input));
  if (!worker) {
    worker = new Worker(new URL('./nebula.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; out: NebulaBuildOutput }>) => {
      waiting.get(e.data.id)?.(e.data.out);
      waiting.delete(e.data.id);
    };
  }
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ id, input }, [input.px.buffer]);
  });
}
