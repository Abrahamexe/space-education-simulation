import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineLoop, MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { KM_PER_AU } from '../config/astro';
import { scale } from '../core/scale';
import type { FloatingOrigin } from '../core/FloatingOrigin';

const KM_PER_LY = 9.4607e12;

const RINGS: { km: number; label: string; ly?: boolean }[] = [
  { km: 1 * KM_PER_AU, label: '1 AU' },
  { km: 5 * KM_PER_AU, label: '5 AU' },
  { km: 10 * KM_PER_AU, label: '10 AU' },
  { km: 30 * KM_PER_AU, label: '30 AU' },
  { km: 100 * KM_PER_AU, label: '100 AU' },
  { km: 1000 * KM_PER_AU, label: '1.000 AU' },
  { km: 10_000 * KM_PER_AU, label: '10.000 AU' },
  { km: 0.25 * KM_PER_LY, label: '0,25 ışık yılı', ly: true },
  { km: 0.5 * KM_PER_LY, label: '0,5 ışık yılı', ly: true },
  { km: 1 * KM_PER_LY, label: '1 ışık yılı', ly: true },
  { km: 2 * KM_PER_LY, label: '2 ışık yılı', ly: true },
  { km: 4.24 * KM_PER_LY, label: '4,24 ışık yılı (Proxima Centauri)', ly: true },
  { km: 10 * KM_PER_LY, label: '10 ışık yılı', ly: true },
  { km: 20 * KM_PER_LY, label: '20 ışık yılı', ly: true },
];

const CIRCLE = (() => {
  const n = 256;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    a.set([Math.cos(t), 0, Math.sin(t)], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(a, 3));
  return g;
})();

/**
 * Distance guides for placing bodies: rings round the Sun in the ecliptic
 * (AU, then light-years out to 20 ly), each labelled where it crosses the
 * right side of the view. A ring shows only while it is a sensible size on
 * screen, so a handful are visible at any zoom.
 */
export class Guides {
  readonly group = new Group();
  private readonly rings: { line: LineLoop<BufferGeometry, LineBasicMaterial>; el: HTMLElement; km: number }[] = [];
  private readonly root: HTMLElement;
  private readonly tmp = new Vector3();

  constructor(world: Group, private readonly origin: FloatingOrigin) {
    this.group.name = 'playground-guides';
    world.add(this.group);
    this.root = document.createElement('div');
    this.root.className = 'labels pg-guide-labels';
    document.body.appendChild(this.root);
    for (const r of RINGS) {
      const line = new LineLoop(CIRCLE, new LineBasicMaterial({ color: r.ly ? 0x8fb4ff : 0xf2b35e, transparent: true, opacity: 0.25, depthWrite: false }));
      line.frustumCulled = false;
      this.group.add(line);
      const el = document.createElement('span');
      el.className = 'label pg-guide';
      el.textContent = r.label;
      this.root.appendChild(el);
      this.rings.push({ line, el, km: r.km });
    }
    this.applyScale();
    scale.onChange(() => this.applyScale());
    this.visible = false;
  }

  private applyScale(): void {
    for (const r of this.rings) r.line.scale.setScalar(scale.distance(r.km));
  }

  set visible(v: boolean) {
    this.group.visible = v;
    this.root.style.display = v ? '' : 'none';
  }

  update(camera: PerspectiveCamera, viewportH: number): void {
    if (!this.group.visible) return;
    const sun = this.origin.toRender(new Vector3(), this.tmp.set(0, 0, 0));
    const d = camera.position.distanceTo(sun);
    const pxPerRad = viewportH / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
    // Label anchor: the ring point to the right of the Sun as seen now.
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    right.y = 0;
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Labels sit on one line: going outwards, skip one too close to the last shown.
    let lastX = -Infinity;
    let lastW = 0;
    for (const r of this.rings) {
      const R = r.line.scale.x;
      const px = (R / Math.max(d, 1e-9)) * pxPerRad;
      const k = MathUtils.smoothstep(px, 30, 70) * (1 - MathUtils.smoothstep(px, h * 2.5, h * 5));
      r.line.visible = k > 0.01;
      r.line.material.opacity = 0.3 * k;
      const p = sun.clone().addScaledVector(right, R);
      const behind = p.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0;
      p.project(camera);
      const x = (p.x * 0.5 + 0.5) * w + 4;
      const y = (-p.y * 0.5 + 0.5) * h - 8;
      // (The width of the last shown label is known; a hidden one measures 0.)
      const show = k > 0.3 && !behind && x > 0 && x < w - 40 && y > 0 && y < h && Math.abs(x - lastX) > lastW + 12;
      if (show) {
        lastX = x;
        lastW = r.el.offsetWidth || 90;
      }
      r.el.dataset.visible = String(show);
      if (show) r.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }
}
