import './film.css';
import { icon } from '../icons';
import { holdMainRender } from './gate';
import { Stage } from './render/Stage';
import { CHAPTERS, type Chapter, type ChapterRuntime } from './film/chapters';
import { captionAt, poseAt } from './film/timeline';

const LOAD_ERROR = 'Film verisi yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.';

/**
 * Full-screen "film" about dark matter and ordinary matter: chapters play on a dark-matter Stage
 * with a camera path, captions and a method line; each can hand over to its live lab scene.
 * The main engine is held stopped while the film is open.
 */
export class Film {
  private root: HTMLElement | null = null;
  private stage: Stage | null = null;
  private runtime: ChapterRuntime | null = null;
  private chapter: Chapter = CHAPTERS[0];
  private t = 0;
  private playing = false;
  private userCam = false;
  private loadId = 0;
  private release: (() => void) | null = null;
  private els!: {
    overlay: HTMLElement;
    caption: HTMLElement;
    method: HTMLElement;
    status: HTMLElement;
    play: HTMLButtonElement;
    chips: HTMLButtonElement[];
    progress: HTMLElement;
    recenter: HTMLButtonElement;
    tryBtn: HTMLButtonElement;
  };

  constructor(private readonly opts: { onTry: (tab: 'interaction', anchor: string) => void }) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  async open(chapterId?: string): Promise<void> {
    if (!this.root) this.mount();
    await this.load(CHAPTERS.find((c) => c.id === chapterId) ?? CHAPTERS[0]);
  }

  close(): void {
    if (!this.root) return;
    this.loadId++;
    this.runtime?.dispose();
    this.runtime = null;
    this.stage?.dispose();
    this.stage = null;
    this.root.remove();
    this.root = null;
    document.removeEventListener('keydown', this.onKey, true);
    this.release?.();
    this.release = null;
  }

  private mount(): void {
    this.release = holdMainRender();
    const root = document.createElement('section');
    root.className = 'dm-film';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Film: karanlık madde ile normal madde');
    root.innerHTML = `
      <div class="dm-film-stage"></div>
      <div class="dm-film-overlay"></div>
      <p class="dm-film-caption" aria-live="polite"></p>
      <p class="dm-film-status" hidden></p>
      <div class="dm-film-bar">
        <button type="button" class="btn-icon" data-film-play aria-label="Oynat">${icon('play')}</button>
        <div class="dm-film-chips" role="tablist">${CHAPTERS.map((c, i) => `<button type="button" class="pill" role="tab" data-film-chip="${c.id}">${i + 1} · ${c.title}</button>`).join('')}</div>
        <div class="dm-film-progress"><i></i></div>
        <button type="button" class="pill" data-film-recenter hidden>Kameraya dön</button>
        <button type="button" class="pill pill-accent" data-film-try hidden>Gerçek simülasyonda dene</button>
        <button type="button" class="btn-icon" data-film-close aria-label="Kapat">${icon('close')}</button>
      </div>
      <p class="dm-film-method"></p>`;
    document.body.appendChild(root);
    this.root = root;
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    this.els = {
      overlay: q('.dm-film-overlay'),
      caption: q('.dm-film-caption'),
      method: q('.dm-film-method'),
      status: q('.dm-film-status'),
      play: q('[data-film-play]'),
      chips: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-film-chip]')),
      progress: q('.dm-film-progress i'),
      recenter: q('[data-film-recenter]'),
      tryBtn: q('[data-film-try]'),
    };
    this.els.play.addEventListener('click', () => this.setPlaying(!this.playing));
    q('[data-film-close]').addEventListener('click', () => this.close());
    this.els.recenter.addEventListener('click', () => this.setUserCam(false));
    this.els.tryBtn.addEventListener('click', () => {
      const lab = this.chapter.lab;
      if (!lab) return;
      this.close();
      this.opts.onTry(lab.tab, lab.anchor);
    });
    for (const chip of this.els.chips) chip.addEventListener('click', () => void this.load(CHAPTERS.find((c) => c.id === chip.dataset.filmChip)!));
    document.addEventListener('keydown', this.onKey, true);

    const stage = new Stage(q('.dm-film-stage'), { fov: 40 });
    stage.controls.maxDistance = 40; // camera paths step back on narrow screens
    stage.controls.addEventListener('start', () => this.setUserCam(true));
    stage.onUpdate((dt) => this.tick(dt));
    stage.start();
    this.stage = stage;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.root) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      this.close();
    } else if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
      e.stopPropagation();
      e.preventDefault();
      this.setPlaying(!this.playing);
    }
  };

  private async load(chapter: Chapter): Promise<void> {
    const stage = this.stage;
    if (!stage) return;
    const id = ++this.loadId;
    this.runtime?.dispose();
    this.runtime = null;
    this.chapter = chapter;
    this.t = 0;
    this.setUserCam(false);
    this.setPlaying(false);
    this.els.chips.forEach((c) => c.setAttribute('aria-selected', String(c.dataset.filmChip === chapter.id)));
    this.els.method.textContent = chapter.method;
    this.els.caption.textContent = '';
    this.els.tryBtn.hidden = !chapter.lab;
    this.els.tryBtn.classList.remove('dm-film-glow');
    this.els.progress.parentElement!.hidden = !Number.isFinite(chapter.duration);
    this.status('Yükleniyor…');
    try {
      const runtime = await chapter.build(stage, this.els.overlay);
      if (id !== this.loadId) {
        runtime.dispose();
        return;
      }
      this.runtime = runtime;
      this.status(null);
      this.setPlaying(Number.isFinite(chapter.duration));
    } catch (err) {
      if (id !== this.loadId) return;
      console.warn('[film]', err);
      this.status(LOAD_ERROR);
    }
  }

  private status(text: string | null): void {
    this.els.status.hidden = text === null;
    this.els.status.textContent = text ?? '';
  }

  private setPlaying(on: boolean): void {
    if (on && this.t >= this.chapter.duration) this.t = 0;
    this.playing = on;
    this.els.play.innerHTML = icon(on ? 'pause' : 'play');
    this.els.play.setAttribute('aria-label', on ? 'Duraklat' : 'Oynat');
  }

  private setUserCam(on: boolean): void {
    this.userCam = on;
    this.els.recenter.hidden = !on || !this.chapter.camera;
  }

  private tick(dt: number): void {
    const stage = this.stage;
    if (!stage || !this.runtime) return;
    const c = this.chapter;
    if (this.playing) {
      this.t += dt;
      if (this.t >= c.duration) {
        this.t = c.duration;
        this.setPlaying(false);
        this.els.tryBtn.classList.add('dm-film-glow');
      }
    }
    this.runtime.update(this.t, this.playing ? dt : 0);
    if (c.camera && !this.userCam) {
      const p = poseAt(c.camera, this.t);
      // Paths are framed for 16:9; narrower screens step back so the width still fits.
      const k = Math.max(1, (16 / 9 / stage.camera.aspect) ** 0.75);
      stage.controls.target.set(...p.target);
      stage.camera.position.set(...p.pos).sub(stage.controls.target).multiplyScalar(k).add(stage.controls.target);
    }
    const cap = captionAt(c.captions, this.t);
    const text = cap?.text ?? '';
    if (this.els.caption.textContent !== text) this.els.caption.textContent = text;
    if (Number.isFinite(c.duration)) this.els.progress.style.width = `${(100 * this.t) / c.duration}%`;
  }
}
