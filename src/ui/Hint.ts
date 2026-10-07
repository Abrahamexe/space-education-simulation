import { strings } from '../i18n';

const STORAGE_KEY = 'uzay.hintSeen';
const SHOW_MS = 9000;

/**
 * First-run hint (PLAN §7.2.5): three short instructions, shown once per
 * browser, fading away after a few seconds or on the first interaction.
 * Storage may be unavailable (private mode); then the hint simply shows.
 */
export class Hint {
  readonly el: HTMLElement;
  private timer = 0;

  constructor() {
    const h = strings().hint;
    const el = document.createElement('ul');
    el.className = 'hint';
    el.setAttribute('role', 'note');
    for (const text of [h.drag, h.zoom, h.click, h.keys]) {
      const li = document.createElement('li');
      li.textContent = text;
      el.appendChild(li);
    }
    this.el = el;
  }

  private seen(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  show(): void {
    if (this.seen()) return;
    this.el.dataset.visible = 'true';
    const dismiss = () => this.hide();
    this.timer = window.setTimeout(dismiss, SHOW_MS);
    for (const ev of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(ev, dismiss, { once: true });
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.el.dataset.visible = 'false';
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* storage unavailable: fine */
    }
  }
}
