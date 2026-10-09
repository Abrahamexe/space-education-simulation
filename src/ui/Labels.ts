import { Vector3 } from 'three';
import { Moon } from '../bodies/Moon';
import type { FocusEntry } from '../bodies/SolarSystem';
import type { UiContext } from './context';

/** Labels hide once a body's disk is this many px in radius (the body speaks for itself). */
const MAX_RADIUS_PX = 48;
/** Approximate glyph advance for collision boxes (px per character at 11px caps). */
const CHAR_PX = 8.2;
const LABEL_H = 18;
const PAD = 6;

const PRIORITY: Record<FocusEntry['kind'], number> = { star: 0, planet: 1, dwarf: 2, comet: 3, moon: 4, craft: 5 };

interface Item {
  entry: FocusEntry;
  el: HTMLButtonElement;
  width: number;
  visible: boolean;
  x: number;
  y: number;
}

/**
 * Names floating next to bodies (PLAN §6.3). HTML labels positioned with
 * transforms each frame: hidden behind the camera, behind a nearer disk,
 * when the disk is already large, for moons whose system is out of view,
 * and when they would collide with a more important label. Clicking a
 * label flies to its body, like clicking the body itself.
 */
export class Labels {
  readonly el: HTMLElement;
  private readonly items: Item[] = [];
  private enabled = true;
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private placed: { x: number; y: number; w: number }[] = [];

  constructor(private readonly ctx: UiContext) {
    const el = document.createElement('div');
    el.className = 'labels';
    el.setAttribute('aria-hidden', 'true'); // the nav bar is the accessible route
    for (const entry of ctx.system.focusables) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'label';
      b.tabIndex = -1;
      b.dataset.kind = entry.kind;
      b.textContent = entry.name;
      b.addEventListener('click', () => this.onClick(entry));
      b.addEventListener('pointerenter', () => ctx.selection.hover(entry));
      b.addEventListener('pointerleave', () => ctx.selection.hover(null));
      el.appendChild(b);
      this.items.push({ entry, el: b, width: entry.name.length * CHAR_PX + 22, visible: false, x: 0, y: 0 });
    }
    // Important labels claim space first.
    this.items.sort((a, b) => PRIORITY[a.entry.kind] - PRIORITY[b.entry.kind]);
    this.el = el;
    ctx.engine.addLate({ update: () => this.update() }, 10);
    ctx.selection.onSelect(() => this.restyle());
    ctx.selection.onHover(() => this.restyle());
  }

  get show(): boolean {
    return this.enabled;
  }

  set show(v: boolean) {
    this.enabled = v;
    if (!v) for (const it of this.items) this.setVisible(it, false);
  }

  private onClick(entry: FocusEntry): void {
    void this.ctx.nav.flyTo(entry);
  }

  private restyle(): void {
    const sel = this.ctx.selection.selected?.id;
    const hov = this.ctx.selection.hovered?.id;
    for (const it of this.items) {
      const state = it.entry.id === sel ? 'selected' : it.entry.id === hov ? 'hover' : '';
      if ((it.el.dataset.state ?? '') !== state) it.el.dataset.state = state;
    }
  }

  private setVisible(it: Item, v: boolean): void {
    if (it.visible === v) return;
    it.visible = v;
    it.el.dataset.visible = String(v);
  }

  private update(): void {
    if (!this.enabled) return;
    const { engine } = this.ctx;
    const cam = engine.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const focal = h / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const sel = this.ctx.selection.selected?.id;
    this.placed = [];

    // Big, near disks that can hide labels behind them.
    const blockers: { x: number; y: number; r: number; depth: number }[] = [];
    const projected = new Map<string, { x: number; y: number; r: number; depth: number }>();
    for (const it of this.items) {
      const body = it.entry.body;
      // Destroyed in the playground: no label.
      if ((body as { simGone?: boolean }).simGone) continue;
      // Spacecraft without data for the date, or Earth orbiters seen from afar.
      const craft = body as { hidden?: boolean; labelHidden?: boolean };
      if (craft.hidden || (craft.labelHidden && it.entry.id !== sel)) continue;
      engine.origin.toRender(body.getAbsolutePosition(this.p), this.p);
      this.q.copy(this.p).applyMatrix4(cam.matrixWorldInverse);
      const depth = -this.q.z;
      if (depth <= 0) continue;
      const ndc = this.p.project(cam);
      const sx = (ndc.x * 0.5 + 0.5) * w;
      const sy = (-ndc.y * 0.5 + 0.5) * h;
      const r = (body.getRadius() / depth) * focal;
      projected.set(it.entry.id, { x: sx, y: sy, r, depth });
      if (r > 6) blockers.push({ x: sx, y: sy, r, depth });
    }

    // Selected first, then by kind priority (items are pre-sorted).
    const order = [...this.items].sort((a, b) => Number(b.entry.id === sel) - Number(a.entry.id === sel));
    for (const it of order) {
      const pr = projected.get(it.entry.id);
      let show = !!pr && pr.r < MAX_RADIUS_PX;
      const body = it.entry.body;
      if (show && body instanceof Moon && body.relevanceWeight < 0.35) show = false;
      if (show && pr) {
        // Off screen?
        if (pr.x < -40 || pr.x > w + 40 || pr.y < -20 || pr.y > h + 20) show = false;
        // Behind a nearer, bigger disk?
        for (const b of blockers) {
          if (b.depth >= pr.depth) continue;
          if (Math.hypot(pr.x - b.x, pr.y - b.y) < b.r) {
            show = false;
            break;
          }
        }
      }
      if (show && pr) {
        const x = pr.x + Math.max(pr.r, 3) + PAD;
        const y = pr.y - LABEL_H / 2;
        const box = { x, y, w: it.width };
        const hit = this.placed.some((o) => x < o.x + o.w && x + box.w > o.x && Math.abs(y - o.y) < LABEL_H);
        if (hit && it.entry.id !== sel) show = false;
        else {
          this.placed.push(box);
          if (Math.abs(x - it.x) > 0.25 || Math.abs(y - it.y) > 0.25) {
            it.x = x;
            it.y = y;
            it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          }
        }
      }
      this.setVisible(it, show);
    }
  }
}
