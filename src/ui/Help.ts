import { strings } from '../i18n';
import { icon } from './icons';
import { isTypingOrChord } from './Toolbar';

/**
 * Controls reference (top right, "?"): how to move around, as a popover
 * that can be opened at any time. The first-run hint shows only once; this
 * is where the controls stay discoverable. Also opens with the "?" key.
 */
export class Help {
  readonly el: HTMLElement;
  private readonly pop: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor() {
    const h = strings().help;
    const el = document.createElement('div');
    el.className = 'help';
    el.dataset.reveal = '';
    el.style.setProperty('--i', '1');
    const rows = (items: readonly (readonly [string, string])[]) =>
      items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    el.innerHTML = `
      <button type="button" class="btn-icon" aria-haspopup="dialog" aria-expanded="false" aria-label="${h.title}" title="${h.title} (?)">${icon('help')}</button>
      <div class="popover help-pop" role="dialog" aria-labelledby="help-title" data-open="false">
        <h3 id="help-title">${h.mouse}</h3>
        <dl class="keys">${rows(h.mouseItems)}</dl>
        <h3>${h.touch}</h3>
        <dl class="keys">${rows(h.touchItems)}</dl>
        <h3>${h.keyboard}</h3>
        <dl class="keys">${rows(h.keyItems)}</dl>
      </div>`;
    this.button = el.querySelector('button') as HTMLButtonElement;
    this.pop = el.querySelector('.popover') as HTMLElement;
    this.el = el;

    this.button.addEventListener('click', () => this.setOpen(!this.isOpen));
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !el.contains(e.target as Node)) this.setOpen(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.stopImmediatePropagation();
        this.setOpen(false);
        this.button.focus();
      } else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingOrChord(e)) {
        this.setOpen(!this.isOpen);
      }
    }, { capture: true });
  }

  get isOpen(): boolean {
    return this.pop.dataset.open === 'true';
  }

  private setOpen(open: boolean): void {
    this.pop.dataset.open = String(open);
    this.button.setAttribute('aria-expanded', String(open));
  }
}
