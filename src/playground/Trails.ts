import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Line, LineBasicMaterial, Vector3 } from 'three';

const POINTS = 1200;

interface Trail {
  line: Line<BufferGeometry, LineBasicMaterial>;
  pts: Float32Array;
  head: number;
  count: number;
  color: Color;
  last: Vector3;
}

/**
 * Where each body has been (absolute scene coordinates, under `world`):
 * a ring buffer per body drawn as a line that fades towards its tail.
 * Replaces the Kepler ellipses, which no longer hold once anything is
 * added to the system.
 */
export class Trails {
  readonly group = new Group();
  private readonly trails = new Map<string, Trail>();

  constructor(world: Group) {
    this.group.name = 'playground-trails';
    world.add(this.group);
  }

  /** Record a position; a point is only added once the body has moved `minStep`. */
  push(id: string, p: Vector3, color: readonly [number, number, number], minStep: number): void {
    let t = this.trails.get(id);
    if (!t) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(POINTS * 3), 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(POINTS * 3), 3));
      g.setDrawRange(0, 0);
      const line = new Line(g, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }));
      line.frustumCulled = false;
      this.group.add(line);
      t = { line, pts: new Float32Array(POINTS * 3), head: 0, count: 0, color: new Color(...color), last: p.clone() };
      this.trails.set(id, t);
      this.write(t, p);
      return;
    }
    if (t.last.distanceTo(p) < minStep) {
      // Keep the newest vertex glued to the body between recorded points.
      this.write(t, p, true);
      return;
    }
    t.last.copy(p);
    this.write(t, p);
  }

  private write(t: Trail, p: Vector3, replaceHead = false): void {
    if (!replaceHead || t.count === 0) {
      t.head = (t.head + 1) % POINTS;
      t.count = Math.min(t.count + 1, POINTS);
    }
    t.pts.set([p.x, p.y, p.z], t.head * 3);
    // Unroll oldest → newest into the geometry with a fading colour.
    const pos = t.line.geometry.getAttribute('position') as BufferAttribute;
    const col = t.line.geometry.getAttribute('color') as BufferAttribute;
    const arr = pos.array as Float32Array;
    const carr = col.array as Float32Array;
    for (let k = 0; k < t.count; k++) {
      const src = ((t.head - t.count + 1 + k + POINTS) % POINTS) * 3;
      arr[k * 3] = t.pts[src];
      arr[k * 3 + 1] = t.pts[src + 1];
      arr[k * 3 + 2] = t.pts[src + 2];
      const f = Math.pow((k + 1) / t.count, 1.6) * 0.55;
      carr[k * 3] = t.color.r * f;
      carr[k * 3 + 1] = t.color.g * f;
      carr[k * 3 + 2] = t.color.b * f;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    t.line.geometry.setDrawRange(0, t.count);
  }

  remove(id: string): void {
    const t = this.trails.get(id);
    if (!t) return;
    t.line.geometry.dispose();
    t.line.material.dispose();
    t.line.removeFromParent();
    this.trails.delete(id);
  }

  clear(): void {
    for (const id of [...this.trails.keys()]) this.remove(id);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }
}
