import { BufferAttribute, BufferGeometry, Uint32BufferAttribute } from 'three';

/**
 * Polyline as a camera-facing ribbon (two vertices per sample, extruded in the
 * vertex shader to a constant pixel width): WebGL lines are one pixel wide and
 * shimmer. Geometries made from one RibbonData share its buffers, so a path
 * can be split into a bright past and a dim future with a draw range each.
 */
export interface RibbonData {
  samples: number;
  position: BufferAttribute;
  /** What float32 dropped from `position` (the RTE shader adds it back near the camera). */
  positionLow: BufferAttribute;
  tangent: BufferAttribute;
  side: BufferAttribute;
  along: BufferAttribute;
  index: Uint32BufferAttribute;
}

/** Ribbon buffers for `points` (x y z per sample, at least two; doubles keep their low part). */
export function ribbonData(points: ArrayLike<number>, alongOf?: (i: number) => number): RibbonData {
  const n = Math.floor(points.length / 3);
  const d: RibbonData = {
    samples: n,
    position: new BufferAttribute(new Float32Array(n * 6), 3),
    positionLow: new BufferAttribute(new Float32Array(n * 6), 3),
    tangent: new BufferAttribute(new Float32Array(n * 6), 3),
    side: new BufferAttribute(new Float32Array(n * 2), 1),
    along: new BufferAttribute(new Float32Array(n * 2), 1),
    index: new Uint32BufferAttribute(new Uint32Array(Math.max(n - 1, 0) * 6), 1),
  };
  const side = d.side.array as Float32Array;
  for (let i = 0; i < n * 2; i++) side[i] = i % 2 === 0 ? -1 : 1;
  const idx = d.index.array as Uint32Array;
  for (let i = 0; i < n - 1; i++) {
    const v = i * 2;
    idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
  }
  writeRibbon(d, points, alongOf);
  return d;
}

/**
 * Refill a ribbon's positions, tangents and `along` values in place (same
 * sample count): small ribbons that move every frame reuse their buffers.
 * `along` defaults to the sample index (dash pattern, taper).
 */
export function writeRibbon(d: RibbonData, points: ArrayLike<number>, alongOf: (i: number) => number = (i) => i): void {
  const n = d.samples;
  const pos = d.position.array as Float32Array;
  const low = d.positionLow.array as Float32Array;
  const tan = d.tangent.array as Float32Array;
  const along = d.along.array as Float32Array;
  let tx = 1;
  let ty = 0;
  let tz = 0;
  for (let i = 0; i < n; i++) {
    // Tangent: along the chord through both neighbours (central difference).
    const a = Math.max(i - 1, 0) * 3;
    const b = Math.min(i + 1, n - 1) * 3;
    let dx = points[b] - points[a];
    let dy = points[b + 1] - points[a + 1];
    let dz = points[b + 2] - points[a + 2];
    const len = Math.hypot(dx, dy, dz);
    // Repeated samples have no direction: keep the last one.
    if (len > 0) {
      dx /= len;
      dy /= len;
      dz /= len;
      tx = dx;
      ty = dy;
      tz = dz;
    }
    const al = alongOf(i);
    for (let k = 0; k < 2; k++) {
      const o = (i * 2 + k) * 3;
      for (let c = 0; c < 3; c++) {
        const p = points[i * 3 + c];
        pos[o + c] = p;
        low[o + c] = p - pos[o + c];
      }
      tan[o] = tx;
      tan[o + 1] = ty;
      tan[o + 2] = tz;
      along[i * 2 + k] = al;
    }
  }
  d.position.needsUpdate = true;
  d.positionLow.needsUpdate = true;
  d.tangent.needsUpdate = true;
  d.along.needsUpdate = true;
}

/** A geometry over the shared buffers, drawing samples [a, b). */
export function ribbonGeometry(d: RibbonData, a = 0, b = d.samples): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', d.position);
  g.setAttribute('positionLow', d.positionLow);
  g.setAttribute('tangent', d.tangent);
  g.setAttribute('side', d.side);
  g.setAttribute('along', d.along);
  g.setIndex(d.index);
  g.boundingSphere = null;
  setRibbonRange(g, a, b);
  return g;
}

/** Draw the segments between samples a and b-1. */
export function setRibbonRange(g: BufferGeometry, a: number, b: number): void {
  const from = Math.max(a, 0);
  g.setDrawRange(from * 6, Math.max(b - 1 - from, 0) * 6);
}
