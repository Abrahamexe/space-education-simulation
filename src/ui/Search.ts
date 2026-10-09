import { strings } from '../i18n';
import type { FocusEntry } from '../bodies/SolarSystem';
import { icon } from './icons';
import { isTypingOrChord } from './Toolbar';
import type { UiContext } from './context';

const GROUP_ORDER: FocusEntry['kind'][] = ['star', 'planet', 'dwarf', 'comet', 'moon', 'craft'];

/** Match quality, lower is better; moons of a matching planet come last. */
const enum Rank {
  Prefix,
  WordPrefix,
  Substring,
  ParentMatch,
}

const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Turkish-aware folding: case and diacritics ("jupiter" finds Jüpiter, "gunes" Güneş). */
function fold(s: string): string {
  return s.toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, (c) => FOLD[c]);
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * Find-a-body box (top right): every focusable body (moons, dwarf planets
 * and the comet included, which have no button of their own) by typing a
 * few letters. Combobox + listbox semantics; ↑/↓ move, Enter flies, Esc
 * closes. Opens with "/" or Ctrl+K. No open/close animation: it is a
 * keyboard-driven tool and must feel instant.
 */
export class Search {
  readonly el: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly dialog: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private results: FocusEntry[] = [];
  private active = 0;

  constructor(private readonly ctx: UiContext) {
    const t = strings().search;
    const el = document.createElement('div');
    el.className = 'search';
    el.dataset.reveal = '';
    el.style.setProperty('--i', '1');
    el.innerHTML = `
      <button type="button" class="search-trigger" aria-haspopup="dialog" aria-expanded="false" aria-keyshortcuts="/ Control+K" title="${t.open} (/)">
        ${icon('search')}<span class="layer-label">${t.open}</span>
      </button>
      <div class="search-dialog" role="dialog" aria-label="${t.label}" data-open="false">
        <div class="search-field">
          ${icon('search')}
          <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="search-list"
            placeholder="${t.placeholder}" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="go">
        </div>
        <div class="search-list" id="search-list" role="listbox" aria-label="${t.label}"></div>
      </div>`;
    this.button = el.querySelector('.search-trigger') as HTMLButtonElement;
    this.dialog = el.querySelector('.search-dialog') as HTMLElement;
    this.input = el.querySelector('input') as HTMLInputElement;
    this.list = el.querySelector('.search-list') as HTMLElement;
    this.el = el;

    this.button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.input.addEventListener('input', () => this.update(true));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('click', (e) => {
      const opt = (e.target as HTMLElement).closest('[role="option"]') as HTMLElement | null;
      if (opt) this.choose(Number(opt.dataset.index));
    });
    this.list.addEventListener('pointermove', (e) => {
      const opt = (e.target as HTMLElement).closest('[role="option"]') as HTMLElement | null;
      if (opt) this.setActive(Number(opt.dataset.index), false);
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !el.contains(e.target as Node)) this.close(false);
    });
    window.addEventListener('keydown', (e) => {
      if (this.isOpen) return;
      const slash = e.key === '/' && !isTypingOrChord(e);
      const ctrlK = (e.ctrlKey || e.metaKey) && e.code === 'KeyK';
      if (slash || ctrlK) {
        e.preventDefault();
        this.open();
      }
    });
  }

  get isOpen(): boolean {
    return this.dialog.dataset.open === 'true';
  }

  open(): void {
    this.dialog.dataset.open = 'true';
    this.button.setAttribute('aria-expanded', 'true');
    this.input.value = '';
    this.update(true);
    this.input.focus();
  }

  close(returnFocus = true): void {
    this.dialog.dataset.open = 'false';
    this.button.setAttribute('aria-expanded', 'false');
    if (returnFocus) this.button.focus();
  }

  private onKey(e: KeyboardEvent): void {
    // Keep app shortcuts (Space, digits, letters) out of the text field.
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.results.length;
      if (n) this.setActive((this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.results.length) this.choose(this.active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  private choose(i: number): void {
    const entry = this.results[i];
    if (!entry) return;
    this.close(false);
    this.input.blur();
    void this.ctx.nav.flyTo(entry);
  }

  /** Rank every body against the query; an empty query lists everything by group. */
  private match(query: string): FocusEntry[] {
    // Spacecraft not yet launched (or past their data) cannot be flown to.
    const all = this.ctx.system.focusables.filter((e) => !(e.body as { hidden?: boolean }).hidden);
    const q = fold(query.trim());
    const groupOf = (e: FocusEntry) => GROUP_ORDER.indexOf(e.kind);
    if (!q) return [...all].sort((a, b) => groupOf(a) - groupOf(b));
    const nameOf = new Map(all.map((e) => [e.id, fold(e.name)]));
    const ranked: { e: FocusEntry; rank: Rank; i: number }[] = [];
    all.forEach((e, i) => {
      const name = nameOf.get(e.id) as string;
      let rank: Rank | null = null;
      if (name.startsWith(q)) rank = Rank.Prefix;
      else if (name.split(/[\s'-]+/).some((w) => w.startsWith(q))) rank = Rank.WordPrefix;
      else if (name.includes(q)) rank = Rank.Substring;
      else if (e.parent && (nameOf.get(e.parent) ?? '').startsWith(q)) rank = Rank.ParentMatch;
      if (rank !== null) ranked.push({ e, rank, i });
    });
    ranked.sort((a, b) => a.rank - b.rank || groupOf(a.e) - groupOf(b.e) || a.i - b.i);
    return ranked.map((r) => r.e);
  }

  private update(resetActive: boolean): void {
    const t = strings().search;
    this.results = this.match(this.input.value);
    if (resetActive) this.active = 0;
    if (!this.results.length) {
      this.list.innerHTML = `<p class="search-empty">${t.empty}</p>`;
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    const names = new Map(this.ctx.system.focusables.map((e) => [e.id, e.name]));
    let html = '';
    let lastKind: FocusEntry['kind'] | null = null;
    this.results.forEach((e, i) => {
      if (e.kind !== lastKind) {
        html += `<p class="search-group" role="presentation">${t.groups[e.kind]}</p>`;
        lastKind = e.kind;
      }
      const meta = e.parent ? `<span class="search-meta">${esc(names.get(e.parent) ?? '')}</span>` : '';
      html += `<div class="search-option" role="option" id="search-opt-${e.id}" data-index="${i}" aria-selected="false"><span>${esc(e.name)}</span>${meta}</div>`;
    });
    this.list.innerHTML = html;
    this.setActive(this.active, true);
  }

  private setActive(i: number, scroll: boolean): void {
    this.list.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    this.active = i;
    const opt = this.list.querySelector(`[data-index="${i}"]`) as HTMLElement | null;
    if (!opt) return;
    opt.setAttribute('aria-selected', 'true');
    this.input.setAttribute('aria-activedescendant', opt.id);
    if (scroll) opt.scrollIntoView({ block: 'nearest' });
  }
}
