import { crumbs, type Level } from './scalePath';

/**
 * The bottom band's scale path: "Evren / … / Samanyolu / Güneş Sistemi / Mars". Each level is a
 * button that takes you there; the current level is framed; `leaf` (the focused body) is plain text.
 */
export class ScalePathBar {
  readonly el: HTMLElement;
  private here: Level | null = null;
  private leaf = '';

  constructor(private readonly onGo: (level: Level) => void) {
    const el = document.createElement('nav');
    el.className = 'scale-path';
    el.setAttribute('aria-label', 'Ölçek yolu');
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-level]');
      if (b && b.getAttribute('aria-current') !== 'location') this.onGo(b.dataset.level as Level);
    });
    this.el = el;
  }

  set(here: Level, leaf = ''): void {
    if (here === this.here && leaf === this.leaf) return;
    this.here = here;
    this.leaf = leaf;
    const parts = crumbs(here).map(
      (c) =>
        `<button type="button" class="sp-crumb" data-level="${c.level}"${c.current ? ' aria-current="location"' : ''}>${c.name}</button>`,
    );
    if (leaf) parts.push(`<span class="sp-leaf">${leaf.replace(/[<>&]/g, '')}</span>`);
    this.el.innerHTML = parts.join('<span class="sp-sep" aria-hidden="true">/</span>');
  }
}
