import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Points, ShaderMaterial, Vector3 } from 'three';
import type { Focusable } from '../core/types';

/**
 * The pieces of a torn-apart or shattered body. The simulation knows them
 * at true size: a cloud a few thousand km across that tides draw out into a
 * stream (see NBody.disrupt). The planet itself was drawn ~200× too big for
 * its distances, so the cloud is drawn the same way: never smaller than the
 * planet was, but true to its shape. Seen at that size the round body turns
 * into an egg, then a long thin strand; once the real stream outgrows the
 * drawn planet it is shown at its true size. Pieces glow hot at first (rock
 * torn open, melted) and cool to the body's colour.
 *
 * A tidal stream keeps its pieces in order (they were laid out along the
 * axis to the heavy body, and that order is their order in orbital energy),
 * so neighbours are joined by a few in-between points: a continuous strand
 * rather than loose dots.
 */

/** In-between points per pair of neighbouring pieces in a stream. */
const FILL = 7;

const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aColor;
attribute float aSize;
attribute float aBorn;
attribute float aCool;
uniform float uScale;
uniform float uNow;
varying vec3 vColor;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float age = max(uNow - aBorn, 0.0);
  // Molten white-orange at first, cooling to the body's colour.
  float cool = smoothstep(0.0, 1.0, age / max(aCool, 1e-6));
  vColor = mix(vec3(1.6, 1.0, 0.55), aColor, cool);
  vFade = 0.55 + 0.45 * (1.0 - cool);
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 1e-6), 1.5, 40.0);
  #include <logdepthbuf_vertex>
}`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 3.0) * vFade * 0.45;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export interface PieceOrigin {
  /** The torn body's drawn radius (scene units): the cloud is never drawn smaller. */
  drawn: number;
  /** When it came loose (sim jd) and the dynamical time where it was torn (days). */
  born: number;
  slide: number;
  color: Color;
  /** Drawn size (scene units). */
  size: number;
  /** Which body it came from, its place in the stream, and whether it is a stream (tides) or a cloud. */
  parent: string;
  order: number;
  stream: boolean;
}

export class DebrisView {
  private readonly group = new Group();
  private points: Points<BufferGeometry, ShaderMaterial> | null = null;
  readonly origins = new Map<string, PieceOrigin>();
  /** jd the attribute times are measured from (keeps floats precise). */
  private base = 0;
  /** Each cloud as drawn: centre (absolute scene) and extent, for the camera. */
  private readonly clouds = new Map<string, { c: Vector3; r: number }>();

  /**
   * A camera target following the cloud a body became (its drawn centre),
   * so a camera watching the body keeps watching its remains.
   */
  focusFor(parent: string, drawn: number): Focusable {
    const clouds = this.clouds;
    const last = new Vector3();
    return {
      getAbsolutePosition: (out: Vector3) => {
        const c = clouds.get(parent);
        if (c) last.copy(c.c);
        return out.copy(last);
      },
      getRadius: () => drawn * 0.5,
      getViewRadius: () => Math.max(clouds.get(parent)?.r ?? drawn, drawn),
    };
  }

  constructor(world: Group) {
    this.group.name = 'playground-debris';
    world.add(this.group);
  }

  /** Make room for `n` slots (one per body in the state; non-debris slots stay hidden). */
  private ensure(n: number): Points<BufferGeometry, ShaderMaterial> {
    if (this.points && this.points.geometry.getAttribute('position').count === n) return this.points;
    this.dispose();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSize', new BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aBorn', new BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aCool', new BufferAttribute(new Float32Array(n), 1));
    const p = new Points(
      g,
      new ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: { uScale: { value: 1 }, uNow: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    p.frustumCulled = false;
    this.group.add(p);
    this.points = p;
    return p;
  }

  /**
   * Draw the live pieces. `ids`/`alive` follow the simulation state;
   * `place(i, out)` gives a piece's true scene position.
   */
  update(ids: string[], kinds: string[], alive: Uint8Array, jd: number, pxScale: number, place: (i: number, out: Vector3) => Vector3): void {
    // Live pieces at their true scene positions, grouped per torn body.
    const live: { i: number; o: PieceOrigin; p: Vector3 }[] = [];
    const groups = new Map<string, { c: Vector3; n: number; s2: number; scale: number; aspect: number; cov: number[] }>();
    for (let i = 0; i < ids.length; i++) {
      const o = alive[i] && kinds[i] === 'debris' ? this.origins.get(ids[i]) : undefined;
      if (!o) continue;
      const p = place(i, new Vector3());
      live.push({ i, o, p });
      const g = groups.get(o.parent) ?? { c: new Vector3(), n: 0, s2: 0, scale: 1, aspect: 1, cov: [0, 0, 0, 0, 0, 0] };
      g.c.add(p);
      g.n++;
      groups.set(o.parent, g);
    }
    if (!live.length) {
      this.dispose();
      return;
    }
    for (const g of groups.values()) g.c.divideScalar(g.n);
    for (const { o, p } of live) {
      const g = groups.get(o.parent)!;
      const x = p.x - g.c.x;
      const y = p.y - g.c.y;
      const z = p.z - g.c.z;
      g.s2 += (x * x + y * y + z * z) / g.n;
      const c = g.cov;
      c[0] += (x * x) / g.n;
      c[1] += (x * y) / g.n;
      c[2] += (x * z) / g.n;
      c[3] += (y * y) / g.n;
      c[4] += (y * z) / g.n;
      c[5] += (z * z) / g.n;
    }
    // Drawn at least as big as the body was (true shape), and how elongated
    // it is. A shattered cloud also visibly spreads: its drawn size grows
    // (doubling in a quarter of a day) until the real cloud is bigger.
    for (const [parent, g] of groups) {
      const o = live.find((l) => l.o.parent === parent)!.o;
      const rms = Math.sqrt(g.s2);
      const grow = o.stream ? 1 : 1 + Math.max(jd - o.born, 0) / 0.25;
      g.scale = Math.max(1, (o.drawn * 0.75 * grow) / Math.max(rms, 1e-12));
      const [a, b, c, d, e, f] = g.cov;
      let v = [1, 0.5, 0.25];
      for (let it = 0; it < 24; it++) {
        const w = [a * v[0] + b * v[1] + c * v[2], b * v[0] + d * v[1] + e * v[2], c * v[0] + e * v[1] + f * v[2]];
        const L = Math.hypot(w[0], w[1], w[2]) || 1;
        v = [w[0] / L, w[1] / L, w[2] / L];
      }
      const l1 = v[0] * (a * v[0] + b * v[1] + c * v[2]) + v[1] * (b * v[0] + d * v[1] + e * v[2]) + v[2] * (c * v[0] + e * v[1] + f * v[2]);
      const rest = Math.max((g.s2 - l1) / 2, 1e-30);
      g.aspect = Math.sqrt(Math.max(l1, 0) / rest);
    }
    for (const l of live) {
      const g = groups.get(l.o.parent)!;
      l.p.sub(g.c).multiplyScalar(g.scale).add(g.c);
    }
    for (const [parent, g] of groups) {
      const c = this.clouds.get(parent) ?? { c: new Vector3(), r: 0 };
      c.c.copy(g.c);
      c.r = Math.sqrt(g.s2) * g.scale * 2;
      this.clouds.set(parent, c);
    }
    if (!this.points) this.base = jd;
    live.sort((a, b) => (a.o.parent < b.o.parent ? -1 : a.o.parent > b.o.parent ? 1 : a.o.order - b.o.order));
    // Capacity: every piece plus its in-between points (grown in steps).
    const need = live.length * (FILL + 1);
    const cap = this.points ? this.points.geometry.getAttribute('position').count : 0;
    const p = this.ensure(cap >= need && cap <= need * 4 ? cap : need * 2);
    const n = p.geometry.getAttribute('position').count;
    const pos = p.geometry.getAttribute('position') as BufferAttribute;
    const col = p.geometry.getAttribute('aColor') as BufferAttribute;
    const size = p.geometry.getAttribute('aSize') as BufferAttribute;
    const born = p.geometry.getAttribute('aBorn') as BufferAttribute;
    const cool = p.geometry.getAttribute('aCool') as BufferAttribute;
    let k = 0;
    const put = (x: Vector3, o: PieceOrigin, s: number) => {
      pos.setXYZ(k, x.x, x.y, x.z);
      col.setXYZ(k, o.color.r, o.color.g, o.color.b);
      size.setX(k, o.size * s);
      born.setX(k, o.born - this.base);
      cool.setX(k, o.slide * 4);
      k++;
    };
    for (const l of live) put(l.p, l.o, 1);
    // The strand: a centre line through the stream (a running average over
    // neighbours in stream order, which smooths out the scatter across its
    // width), filled in with points. Only once the cloud has drawn out; while
    // it is still round, there is no line to follow.
    const W = 4;
    const line: Vector3[] = [];
    const mid = new Vector3();
    for (let j = 0; j < live.length; ) {
      const parent = live[j].o.parent;
      let e = j;
      while (e < live.length && live[e].o.parent === parent) e++;
      const o = live[j].o;
      const t = Math.min(Math.max((groups.get(parent)!.aspect - 2.5) / 5, 0), 1);
      const s = 0.75 * t * t * (3 - 2 * t);
      if (o.stream && s >= 0.05 && e - j > 2 * W + 1) {
        line.length = 0;
        for (let q = j; q < e; q++) {
          const c = new Vector3();
          let n = 0;
          for (let r = Math.max(j, q - W); r <= Math.min(e - 1, q + W); r++) {
            c.add(live[r].p);
            n++;
          }
          line.push(c.divideScalar(n));
        }
        for (let q = 0; q + 1 < line.length; q++) {
          const from = live[j + q].o;
          for (let f = 0; f < FILL; f++) put(mid.lerpVectors(line[q], line[q + 1], f / FILL), from, s);
        }
      }
      j = e;
    }
    for (; k < n; k++) {
      pos.setXYZ(k, 1e12, 1e12, 1e12);
      size.setX(k, 0);
    }
    for (const a of [pos, col, size, born, cool]) a.needsUpdate = true;
    p.material.uniforms.uScale.value = pxScale;
    p.material.uniforms.uNow.value = jd - this.base;
  }

  private dispose(): void {
    if (!this.points) return;
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points.removeFromParent();
    this.points = null;
  }

  clear(): void {
    this.dispose();
    this.origins.clear();
    this.clouds.clear();
  }
}
