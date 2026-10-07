import {
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type ColorSpace,
  type WebGLRenderer,
} from 'three';

export interface TextureOptions {
  colorSpace?: ColorSpace;
  /** Disable mipmaps (e.g. equirect skies where the u-seam breaks them). */
  mipmaps?: boolean;
  wrapRepeatS?: boolean;
}

type ProgressFn = (ratio: number) => void;

/**
 * Texture loading with progress reporting (PLAN §9).
 *
 * `load` counts towards the blocking progress bar shown at start-up;
 * `loadDeferred` runs after the critical set and is not counted, used to
 * swap low-resolution textures for high-resolution ones in the background.
 */
export class Loader {
  private readonly loader = new TextureLoader();
  private readonly maxAnisotropy: number;
  private total = 0;
  private done = 0;
  private readonly pending: Promise<unknown>[] = [];
  private readonly progressFns = new Set<ProgressFn>();

  constructor(renderer: WebGLRenderer) {
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  private url(path: string): string {
    return `${import.meta.env.BASE_URL}${path}`;
  }

  private configure(tex: Texture, opts: TextureOptions): Texture {
    tex.colorSpace = opts.colorSpace ?? SRGBColorSpace;
    tex.anisotropy = this.maxAnisotropy;
    if (opts.mipmaps === false) {
      tex.generateMipmaps = false;
      tex.minFilter = LinearFilter;
    }
    if (opts.wrapRepeatS) tex.wrapS = RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  private emit(): void {
    const ratio = this.total === 0 ? 1 : this.done / this.total;
    this.progressFns.forEach((fn) => fn(ratio));
  }

  /** Critical texture: counted in start-up progress. */
  load(path: string, opts: TextureOptions = {}): Promise<Texture> {
    this.total++;
    this.emit();
    const p = this.loader.loadAsync(this.url(path)).then(
      (tex) => {
        this.done++;
        this.emit();
        return this.configure(tex, opts);
      },
      (err: unknown) => {
        this.done++;
        this.emit();
        throw err;
      },
    );
    this.pending.push(p.catch(() => undefined));
    return p;
  }

  /** Non-critical texture, loaded in the background. */
  loadDeferred(path: string, opts: TextureOptions = {}): Promise<Texture> {
    return this.loader.loadAsync(this.url(path)).then((tex) => this.configure(tex, opts));
  }

  onProgress(fn: ProgressFn): () => void {
    this.progressFns.add(fn);
    fn(this.total === 0 ? 0 : this.done / this.total);
    return () => this.progressFns.delete(fn);
  }

  /** Resolves when every critical texture requested so far has settled. */
  async whenIdle(): Promise<void> {
    let seen = -1;
    while (seen !== this.pending.length) {
      seen = this.pending.length;
      await Promise.all(this.pending);
    }
  }
}
