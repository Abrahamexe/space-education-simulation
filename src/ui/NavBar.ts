import { Color } from 'three';
import { strings } from '../i18n';
import { CelestialBody } from '../bodies/CelestialBody';
import { Moon } from '../bodies/Moon';
import { MAIN_BODIES } from '../core/Navigator';
import type { UiContext } from './context';

const SUN_SWATCH = '#f2b35e';

/**
 * Bottom navigation (PLAN §7.2): one button per major body with a small
 * swatch of its orbit colour (identity, not decoration). A single gold
 * indicator slides to the current body; selecting a moon highlights its
 * planet. Buttons fly the camera to the body.
 */
export class NavBar {
  readonly el: HTMLElement;
  private readonly indicator: HTMLElement;
  private readonly items = new Map<string, HTMLButtonElement>();

  constructor(ctx: UiContext) {
    const el = document.createElement('nav');
    el.className = 'nav';
    el.setAttribute('aria-label', strings().nav.label);
    el.dataset.reveal = '';
    el.style.setProperty('--i', '2');

    for (const id of MAIN_BODIES) {
      const entry = ctx.nav.entry(id);
      if (!entry) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nav-item';
      b.dataset.id = id;
      const body = entry.body;
      const color =
        body instanceof CelestialBody ? `#${new Color(...body.desc.render.orbitColor).getHexString()}` : SUN_SWATCH;
      b.innerHTML = `<span class="nav-swatch" aria-hidden="true"></span><span class="nav-label"></span>`;
      (b.firstElementChild as HTMLElement).style.setProperty('--swatch', color);
      (b.lastElementChild as HTMLElement).textContent = entry.name;
      b.addEventListener('click', () => void ctx.nav.flyTo(entry));
      this.items.set(id, b);
      el.appendChild(b);
    }

    this.indicator = document.createElement('span');
    this.indicator.className = 'nav-indicator';
    this.indicator.setAttribute('aria-hidden', 'true');
    el.appendChild(this.indicator);
    this.el = el;

    ctx.selection.onSelect((e) => {
      let id = e?.id ?? null;
      if (e?.body instanceof Moon) id = (e.body.parent as CelestialBody).id;
      this.setActive(id);
    });
    window.addEventListener('resize', () => this.setActive(this.activeId));
  }

  private activeId: string | null = null;

  setActive(id: string | null): void {
    this.activeId = id;
    for (const [bid, b] of this.items) b.setAttribute('aria-current', String(bid === id));
    const b = id ? this.items.get(id) : undefined;
    if (!b) {
      this.indicator.style.setProperty('--o', '0');
      return;
    }
    // Measure after layout; the indicator is a 100px bar scaled to the item.
    requestAnimationFrame(() => {
      const inset = 12;
      this.indicator.style.setProperty('--x', `${b.offsetLeft + inset}px`);
      this.indicator.style.setProperty('--w', String((b.offsetWidth - inset * 2) / 100));
      this.indicator.style.setProperty('--o', '1');
      b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }
}
