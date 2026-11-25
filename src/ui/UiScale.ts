/**
 * Interface size (Küçük / Normal / Büyük) and the layout that follows from it.
 *
 * The size is CSS `zoom` on the overlay roots (hud.css): everything in them
 * scales together while the 3D scene is untouched. Two things do not follow a
 * zoom by themselves, so they are done here:
 *  - media queries still see the real window width: the breakpoints that mattered
 *    are `vw-<n>` classes on <html> measured in interface pixels (window width
 *    divided by the zoom);
 *  - what fits in the top and bottom bars depends on the window, the zoom, the
 *    language and the buttons present, so instead of guessed breakpoints the bars
 *    are measured: stacked / compacted step by step until nothing overlaps.
 * `--hud-bottom` (the height the bottom bars take) lets panels sit above them.
 */

export type UiSizeId = 'small' | 'normal' | 'large';

export const UI_SIZES: Record<UiSizeId, number> = { small: 0.85, normal: 1, large: 1.2 };
export const UI_SIZE_ORDER: UiSizeId[] = ['small', 'normal', 'large'];

const KEY = 'space.uiSize';
/** Interface widths (px) the CSS has rules for. */
const WIDTH_STEPS = [760, 1100] as const;
/** Bottom bar, one step at a time: nav above the rest, one column, wrapping clusters. */
const BOTTOM_STEPS = ['stack-bottom', 'stack-3', 'stack-wrap'] as const;
/** Top bar: labels become icons, then the readout and the optional layers go, then the title. */
const TOP_STEPS = ['top-compact', 'top-tight', 'top-min'] as const;

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
}

/** Nothing sticks out of the container and no two of the elements overlap. */
function fits(box: Element, parts: Element[]): boolean {
  const c = box.getBoundingClientRect();
  const rects = parts.map((p) => p.getBoundingClientRect());
  if (rects.some((r) => r.width > 0 && (r.left < c.left - 1 || r.right > c.right + 1))) return false;
  return !rects.some((r, i) => r.width > 0 && rects.some((o, j) => j > i && o.width > 0 && overlaps(r, o)));
}

class UiScale {
  private id: UiSizeId = 'normal';
  private readonly listeners = new Set<(id: UiSizeId) => void>();
  private readonly layoutListeners = new Set<() => void>();
  private frame = 0;

  constructor() {
    try {
      const saved = localStorage.getItem(KEY) as UiSizeId | null;
      if (saved && saved in UI_SIZES) this.id = saved;
    } catch {
      /* private window: keep the default */
    }
    document.documentElement.style.setProperty('--ui-zoom', String(this.zoom));
    window.addEventListener('resize', () => this.fit());
    void document.fonts?.ready.then(() => this.fit());
  }

  get size(): UiSizeId {
    return this.id;
  }

  get zoom(): number {
    return UI_SIZES[this.id];
  }

  /** Window width in interface pixels. */
  get width(): number {
    return window.innerWidth / this.zoom;
  }

  set(id: UiSizeId): void {
    if (id === this.id) return;
    this.id = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* not saved */
    }
    document.documentElement.style.setProperty('--ui-zoom', String(this.zoom));
    this.layout();
    this.listeners.forEach((fn) => fn(id));
    // The 3D view and anything measuring the window follow the new layout.
    window.dispatchEvent(new Event('resize'));
  }

  onChange(fn: (id: UiSizeId) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called after every re-measure (anything placed from the bars' positions follows them). */
  onLayout(fn: () => void): () => void {
    this.layoutListeners.add(fn);
    return () => this.layoutListeners.delete(fn);
  }

  /** Re-measure on the next frame (many resize events, one layout). */
  fit(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.layout();
    });
  }

  private layout(): void {
    const root = document.documentElement;
    root.style.setProperty('--ui-zoom', String(this.zoom));
    for (const w of WIDTH_STEPS) root.classList.toggle(`vw-${w}`, this.width <= w);
    const hud = document.querySelector('.hud');
    const top = hud?.querySelector('.hud-top');
    const bottom = hud?.querySelector('.hud-bottom');
    if (!hud || !top || !bottom) return;

    const step = (steps: readonly string[], ok: () => boolean) => {
      for (const s of steps) root.classList.remove(s);
      if (ok()) return;
      for (const s of steps) {
        root.classList.add(s);
        if (ok()) return;
      }
    };
    const brand = top.querySelector('.hud-id') ?? top.querySelector('.brand');
    const right = top.querySelector('.top-right');
    if (brand && right) step(TOP_STEPS, () => fits(top, [brand, right]));
    const parts = [...bottom.children];
    step(BOTTOM_STEPS, () => fits(bottom, parts));

    root.style.setProperty('--hud-bottom', `${(window.innerHeight - bottom.getBoundingClientRect().top) / this.zoom}px`);
    this.layoutListeners.forEach((fn) => fn());
  }
}

export const uiScale = new UiScale();
