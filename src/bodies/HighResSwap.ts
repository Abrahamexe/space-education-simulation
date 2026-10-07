import type { Texture } from 'three';
import { runtime } from '../config/runtime';
import type { Loader, TextureOptions } from '../core/Loader';

/** Unload once the camera is this many times farther than the load distance. */
const UNLOAD_FACTOR = 3;
/** Wait this long before retrying a failed high-res load. */
const RETRY_MS = 60_000;

export interface SwapSlot {
  uniform: { value: Texture | null };
  path: string;
  opts: TextureOptions;
}

/**
 * Progressive texture streaming with memory release (PLAN §9): the low-res
 * maps stay resident; the high-res set loads when the camera comes within
 * `nearRadii` body radii and is disposed again (GPU memory freed) once it
 * moves `UNLOAD_FACTOR` times farther away. The gap between the two
 * distances prevents thrashing at the boundary. All slots swap together so
 * maps never mismatch (e.g. 4K clouds over a 2K ocean mask).
 */
export class HighResSwap {
  private state: 'low' | 'loading' | 'high' = 'low';
  /** After a failed load, do not retry before this time (ms, performance.now). */
  private retryAfter = 0;
  private token = 0;
  private readonly low: (Texture | null)[] = [];
  private high: Texture[] = [];

  constructor(
    private readonly loader: Loader,
    private readonly slots: SwapSlot[],
    private readonly nearRadii: number,
  ) {}

  /** `distanceRadii`: camera distance in units of the body's radius. */
  update(distanceRadii: number): void {
    const wantHigh = runtime.highResTextures && distanceRadii < this.nearRadii;
    const tooFar = !runtime.highResTextures || distanceRadii > this.nearRadii * UNLOAD_FACTOR;
    if (this.state === 'low' && wantHigh && performance.now() >= this.retryAfter) this.load();
    else if (this.state === 'loading' && tooFar) {
      this.token++; // late arrivals are disposed
      this.state = 'low';
    } else if (this.state === 'high' && tooFar) this.unload();
  }

  private load(): void {
    this.state = 'loading';
    const token = ++this.token;
    Promise.allSettled(this.slots.map((s) => this.loader.loadDeferred(s.path, s.opts)))
      .then((results) => {
        const loaded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        if (loaded.length !== results.length) {
          // Partial failure: free what did load, then back off (catch below).
          loaded.forEach((t) => t.dispose());
          throw new Error('high-res set incomplete');
        }
        const textures = loaded;
        if (token !== this.token) {
          textures.forEach((t) => t.dispose());
          return;
        }
        this.slots.forEach((s, i) => {
          this.low[i] = s.uniform.value;
          s.uniform.value = textures[i];
        });
        this.high = textures;
        this.state = 'high';
      })
      .catch(() => {
        if (token !== this.token) return;
        // Missing file or offline: keep the low-res maps and back off instead
        // of re-requesting the whole set every frame.
        this.state = 'low';
        this.retryAfter = performance.now() + RETRY_MS;
      });
  }

  private unload(): void {
    this.slots.forEach((s, i) => (s.uniform.value = this.low[i] ?? s.uniform.value));
    this.high.forEach((t) => t.dispose());
    this.high = [];
    this.state = 'low';
  }

  dispose(): void {
    this.token++;
    this.high.forEach((t) => t.dispose());
  }
}
