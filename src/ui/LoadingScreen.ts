import { strings } from '../i18n';

/**
 * Provisional start-up overlay: a hairline progress bar. Phase 5 gives it
 * its final design; the API (setProgress / finish) stays the same.
 */
export class LoadingScreen {
  private readonly el: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly bar: HTMLDivElement;

  constructor(parent: HTMLElement) {
    const s = strings().loading;
    this.el = document.createElement('div');
    this.el.className = 'loading';
    this.el.innerHTML = `
      <div class="loading__inner">
        <h1 class="loading__title"></h1>
        <div class="loading__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="loading__fill"></div>
        </div>
        <p class="loading__status" aria-live="polite"></p>
      </div>`;
    this.el.querySelector('.loading__title')!.textContent = s.title;
    this.bar = this.el.querySelector('.loading__bar') as HTMLDivElement;
    this.bar.setAttribute('aria-label', s.progressLabel);
    this.fill = this.el.querySelector('.loading__fill') as HTMLDivElement;
    this.status = this.el.querySelector('.loading__status') as HTMLParagraphElement;
    this.status.textContent = s.status;
    parent.appendChild(this.el);
  }

  setProgress(ratio: number): void {
    const r = Math.max(0, Math.min(1, ratio));
    this.fill.style.transform = `scaleX(${r})`;
    this.bar.setAttribute('aria-valuenow', String(Math.round(r * 100)));
  }

  showError(message: string): void {
    this.status.textContent = message;
  }

  /** Fade out, then remove from the DOM. Resolves when gone. */
  finish(): Promise<void> {
    this.setProgress(1);
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        this.el.remove();
        resolve();
      };
      this.el.addEventListener('transitionend', (e) => {
        if (e.target === this.el) done();
      });
      // Fallback in case transitions are disabled.
      const ms = parseFloat(getComputedStyle(this.el).transitionDuration) * 1000 || 0;
      window.setTimeout(done, ms + 100);
      requestAnimationFrame(() => (this.el.dataset.state = 'done'));
    });
  }
}
