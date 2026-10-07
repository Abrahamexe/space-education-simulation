import { INTERACTION } from '../config/visual';
import type { Engine } from './Engine';
import { MAIN_BODIES, type Navigator } from './Navigator';
import type { Picker } from './Picker';
import type { Selection } from './Selection';

/** Number keys → bodies (PLAN §6.1: 1–9 go to a planet; 0 is the Sun). */
const KEY_TARGETS: Record<string, string> = Object.fromEntries(MAIN_BODIES.map((id, i) => [`Digit${i}`, id]));

/**
 * Pointer and keyboard input on the scene (PLAN §6.1):
 *  - a click on a body flies to it at once (a press that moved is a drag
 *    for the orbit controls, not a click); a click on empty sky deselects;
 *  - in map mode (free camera) a click only selects, so the view never
 *    locks on; a double click flies;
 *  - hover shows a pointer cursor and highlights the body;
 *  - Space pauses time, 0–9 fly to bodies, ← → step to the previous / next
 *    body, Esc goes back, H goes home.
 * Keys are ignored while typing in form fields.
 */
export class Input {
  private down: { x: number; y: number; t: number } | null = null;
  private hoverQueued = false;
  private lastMove = { x: 0, y: 0 };

  constructor(
    private readonly engine: Engine,
    private readonly dom: HTMLElement,
    private readonly picker: Picker,
    private readonly selection: Selection,
    private readonly nav: Navigator,
  ) {
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerleave', () => this.setHover(null));
    dom.addEventListener('dblclick', this.onDouble);
    window.addEventListener('keydown', this.onKey);
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private readonly onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved > INTERACTION.clickMaxMovePx || performance.now() - d.t > INTERACTION.clickMaxMs) return;
    const hit = this.picker.pick(e.clientX, e.clientY);
    // One click is enough: waiting to see whether a second click follows
    // made every click feel late, and "double-click to go" was not obvious.
    if (!this.engine.rig.active) return;
    if (hit && this.engine.rig.mapMode) this.selection.select(hit);
    else if (hit) void this.nav.flyTo(hit);
    else this.selection.select(null);
  };

  private readonly onDouble = (e: MouseEvent) => {
    if (!this.engine.rig.active || !this.engine.rig.mapMode) return;
    const hit = this.picker.pick(e.clientX, e.clientY);
    if (hit) void this.nav.flyTo(hit);
  };

  private readonly onMove = (e: PointerEvent) => {
    this.lastMove = { x: e.clientX, y: e.clientY };
    if (this.down || e.pointerType === 'touch' || !this.engine.rig.active) return;
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      this.setHover(this.picker.pick(this.lastMove.x, this.lastMove.y));
    });
  };

  private setHover(hit: ReturnType<Picker['pick']>): void {
    this.selection.hover(hit);
    if (this.dom.style.cursor === 'grabbing') return;
    this.dom.style.cursor = hit ? 'pointer' : this.engine.rig.mapMode ? 'grab' : '';
  }

  private readonly onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!this.engine.rig.active) return;
    if (e.code === 'Space') {
      // Let focused buttons keep Space for activation.
      if (t && t.tagName === 'BUTTON') return;
      e.preventDefault();
      this.engine.time.togglePause();
      return;
    }
    const id = KEY_TARGETS[e.code];
    if (id) {
      const entry = this.nav.entry(id);
      if (entry) void this.nav.flyTo(entry);
      return;
    }
    if (e.code === 'Escape') void this.nav.back();
    else if (e.code === 'KeyH') void this.nav.home();
    else if (e.code === 'KeyM') this.engine.rig.mapMode = !this.engine.rig.mapMode;
    else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      e.preventDefault();
      void this.nav.step(e.code === 'ArrowRight' ? 1 : -1);
    }
  };
}
