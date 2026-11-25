import { Vector3 } from 'three';
import { CelestialBody } from '../bodies/CelestialBody';
import { angularDiameterDeg, frameLabel } from './angular';
import type { UiContext } from './context';

const MIN_R_PX = 24;
const MAX_FILL = 0.9;
const LABEL_MS = 250;

/**
 * Four corner marks around the focused body and "HEDEF · MARS · 4,1° GÖRÜŞ" above them. Hidden
 * for small or screen-filling disks, in free camera and outside the Solar System view.
 */
export class TargetFrame {
  readonly el: HTMLElement;
  private readonly label: HTMLElement;
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private lastLabel = 0;

  constructor(private readonly ctx: UiContext) {
    const el = document.createElement('div');
    el.className = 'target-frame';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<i class="tf-c tf-tl"></i><i class="tf-c tf-tr"></i><i class="tf-c tf-bl"></i><i class="tf-c tf-br"></i><span class="tf-label"></span>';
    this.label = el.querySelector('.tf-label') as HTMLElement;
    this.el = el;
    document.body.append(el);
    ctx.engine.onFrame(() => this.update());
  }

  private hide(): void {
    if (this.el.dataset.on !== 'false') this.el.dataset.on = 'false';
  }

  update(): void {
    const { engine, nav } = this.ctx;
    const body = engine.rig.focusTarget;
    if (!(body instanceof CelestialBody) || engine.rig.mapMode || document.body.classList.contains('mode-galaxy')) return this.hide();
    const cam = engine.camera;
    engine.origin.toRender(body.getAbsolutePosition(this.p), this.p);
    this.q.copy(this.p).applyMatrix4(cam.matrixWorldInverse);
    const depth = -this.q.z;
    if (depth <= 0) return this.hide();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const focal = h / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const rScene = body.getRadius();
    const r = (rScene / depth) * focal;
    if (r < MIN_R_PX || 2 * r > MAX_FILL * Math.min(w, h)) return this.hide();
    const ndc = this.p.project(cam);
    const sx = (ndc.x * 0.5 + 0.5) * w;
    const sy = (-ndc.y * 0.5 + 0.5) * h;
    const half = r * 1.12;
    this.el.style.transform = `translate(${(sx - half).toFixed(1)}px, ${(sy - half).toFixed(1)}px)`;
    this.el.style.width = this.el.style.height = `${(2 * half).toFixed(1)}px`;
    this.el.dataset.on = 'true';
    const now = performance.now();
    if (now - this.lastLabel > LABEL_MS) {
      this.lastLabel = now;
      const name = nav.entry(body.id)?.name ?? body.id;
      const text = frameLabel(name, angularDiameterDeg(2 * rScene, depth));
      if (this.label.textContent !== text) this.label.textContent = text;
    }
  }
}
