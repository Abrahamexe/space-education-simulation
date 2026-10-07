import type { FocusEntry } from '../bodies/SolarSystem';

type Listener = (entry: FocusEntry | null) => void;

/**
 * Which body is selected (focus + info panel) and which is under the
 * pointer. UI components and the camera subscribe; nothing else mutates it.
 */
export class Selection {
  private _selected: FocusEntry | null = null;
  private _hovered: FocusEntry | null = null;
  private readonly selectFns = new Set<Listener>();
  private readonly hoverFns = new Set<Listener>();

  get selected(): FocusEntry | null {
    return this._selected;
  }

  get hovered(): FocusEntry | null {
    return this._hovered;
  }

  select(entry: FocusEntry | null): void {
    if (entry?.id === this._selected?.id) return;
    this._selected = entry;
    this.selectFns.forEach((fn) => fn(entry));
  }

  hover(entry: FocusEntry | null): void {
    if (entry?.id === this._hovered?.id) return;
    this._hovered = entry;
    this.hoverFns.forEach((fn) => fn(entry));
  }

  onSelect(fn: Listener): () => void {
    this.selectFns.add(fn);
    return () => this.selectFns.delete(fn);
  }

  onHover(fn: Listener): () => void {
    this.hoverFns.add(fn);
    return () => this.hoverFns.delete(fn);
  }
}
