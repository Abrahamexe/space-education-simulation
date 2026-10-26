import { strings } from '../i18n';
import { SPACECRAFT, type CraftDef } from '../config/spacecraft';
import { icon } from './icons';
import { uiScale } from './UiScale';
import type { UiContext } from './context';

/** Window pixels (at zoom 1) the top bar takes. */
const TOP_CLEAR_PX = 72;

type Group = 'telescope' | 'near' | 'planetary' | 'outer';

const GROUP_ORDER: Group[] = ['telescope', 'near', 'planetary', 'outer'];
const PLANETARY = new Set(['juno', 'cassini', 'clipper', 'juice']);
const OUTER = new Set(['voyager1', 'voyager2', 'pioneer10', 'pioneer11', 'newhorizons']);

function groupOf(def: CraftDef): Group {
  if (def.kind === 'telescope') return 'telescope';
  if (PLANETARY.has(def.id)) return 'planetary';
  if (OUTER.has(def.id)) return 'outer';
  return 'near';
}

/**
 * "Uzay araçları" button at the end of the bottom navigation: opens a list of
 * the telescopes and probes above it. Choosing one switches the spacecraft
 * mode on (the craft are hidden otherwise) and flies there. Closes on Escape,
 * an outside click or a choice.
 */
export class CraftMenu {
  readonly button: HTMLButtonElement;
  private readonly pop: HTMLElement;

  constructor(
    private readonly ctx: UiContext,
    private readonly ensureMode: () => void,
  ) {
    const t = strings().nav;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nav-item nav-craft';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = `${icon('craft')}<span class="nav-label"></span>`;
    (b.lastElementChild as HTMLElement).textContent = t.craft;
    this.button = b;

    const pop = document.createElement('div');
    pop.className = 'craft-menu';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', t.craftMenu);
    pop.dataset.open = 'false';
    const groups = new Map<Group, CraftDef[]>();
    for (const def of SPACECRAFT) {
      const g = groupOf(def);
      groups.set(g, [...(groups.get(g) ?? []), def]);
    }
    for (const g of GROUP_ORDER) {
      const list = groups.get(g);
      if (!list) continue;
      const h = document.createElement('h3');
      h.textContent = t.craftGroups[g];
      pop.appendChild(h);
      for (const def of list) {
        const o = document.createElement('button');
        o.type = 'button';
        o.className = 'craft-option';
        o.dataset.id = def.id;
        o.innerHTML = '<span class="craft-dot" aria-hidden="true"></span><span class="craft-name"></span><span class="craft-year"></span>';
        (o.children[0] as HTMLElement).style.setProperty('--swatch', `rgb(${def.color.map((c) => Math.round(c * 255)).join(',')})`);
        (o.children[1] as HTMLElement).textContent = def.name;
        (o.children[2] as HTMLElement).textContent = def.launch.slice(0, 4);
        pop.appendChild(o);
      }
    }
    document.body.appendChild(pop);
    this.pop = pop;

    b.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    pop.addEventListener('click', (e) => {
      const o = (e.target as HTMLElement).closest('.craft-option') as HTMLElement | null;
      if (!o) return;
      const entry = this.ctx.nav.entry(o.dataset.id as string);
      this.close(false);
      if (!entry) return;
      this.ensureMode();
      void this.ctx.nav.flyTo(entry);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.isOpen) return;
      const n = e.target as Node;
      if (!pop.contains(n) && !b.contains(n)) this.close(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    uiScale.onLayout(() => this.isOpen && this.place());
  }

  private get isOpen(): boolean {
    return this.pop.dataset.open === 'true';
  }

  /** Centred over the button, kept inside the viewport (window pixels in, zoomed interface pixels out). */
  private place(): void {
    const r = this.button.getBoundingClientRect();
    const w = this.pop.getBoundingClientRect().width;
    const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, 8), window.innerWidth - w - 8);
    this.pop.style.left = `${x / uiScale.zoom}px`;
    this.pop.style.bottom = `${(window.innerHeight - r.top + 10) / uiScale.zoom}px`;
    // Not up into the top bar when the window is short.
    this.pop.style.maxHeight = `${Math.min(Math.max(r.top - 10 - TOP_CLEAR_PX * uiScale.zoom, 120) / uiScale.zoom, 520)}px`;
  }

  private open(): void {
    this.pop.dataset.open = 'true';
    this.button.setAttribute('aria-expanded', 'true');
    this.place();
    (this.pop.querySelector('.craft-option') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private close(refocus = true): void {
    this.pop.dataset.open = 'false';
    this.button.setAttribute('aria-expanded', 'false');
    if (refocus) this.button.focus({ preventScroll: true });
  }
}
