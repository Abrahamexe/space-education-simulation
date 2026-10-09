import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type Object3D,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';

interface TileLevel {
  level: number;
  w: number;
  h: number;
}

interface TileSet {
  tile: number;
  ext: string;
  /** Levels sharper than the 4K base texture, ascending. */
  levels: TileLevel[];
}

/** Window texture size (texels) and tiles across it. */
const SIZE = 4096;
/** Long side of the base texture the window improves on. */
const BASE_LONG = 4096;
/** Tiles uploaded per frame (each a 1024² texSubImage + one mip rebuild per window). */
const UPLOADS_PER_FRAME = 2;
const FETCHES = 4;
/** Seconds the wanted window must hold still before it replaces a finished one. */
const SETTLE_S = 0.3;
const FADE_S = 0.25;

let indexPromise: Promise<Record<string, TileSet>> | null = null;

/** public/tiles/index.json (built by `npm run hires`; empty when not built). */
function tileIndex(): Promise<Record<string, TileSet>> {
  indexPromise ??= fetch(`${import.meta.env.BASE_URL}tiles/index.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return indexPromise;
}

interface Win {
  L: TileLevel;
  tx0: number;
  ty0: number;
}

/**
 * Streams the full-resolution original of a picture (up to 16K) into one
 * 4096² window texture covering the part on screen, so close up a nebula or
 * galaxy is as sharp as the telescope image while memory stays fixed. The
 * window follows the view in whole tiles, picks the pyramid level that
 * matches one texel per screen pixel, waits for the view to settle, fades
 * out, refills tile by tile (nearest the centre first) and fades back in;
 * the 4K base texture shows meanwhile. Slice shaders blend it in through
 * `uniforms` (uDetail, uDetailRect = u0 v0 u1 v1, uDetailMix).
 */
export class DetailWindow {
  readonly uniforms = {
    uDetail: { value: null as Texture | null },
    uDetailRect: { value: new Vector4(0, 0, 1, 1) },
    uDetailMix: { value: 0 },
  };
  private set: TileSet | null = null;
  private tex: DataTexture | null = null;
  /** Window in the texture (or being filled). */
  private win: Win | null = null;
  private filled = false;
  /** Wanted window and since when (s). */
  private wanted: Win | null = null;
  private wantedSince = 0;
  private gen = 0;
  /** Tiles still to fetch / decoded and waiting for upload. */
  private toFetch: [number, number][] = [];
  private fetching = 0;
  private ready: { tx: number; ty: number; bmp: ImageBitmap }[] = [];
  private remaining = 0;
  private clock = 0;
  private readonly inv = new Matrix4();
  private readonly camL = new Vector3();
  private readonly tmp = new Vector3();

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly id: string,
    /** Picture size in its group's local units. */
    private readonly W: number,
    private readonly H: number,
  ) {
    void tileIndex().then((i) => (this.set = i[id] ?? null));
  }

  /** Image uv under a screen point (NDC), on the picture plane; false if it misses. */
  private uvAt(camera: PerspectiveCamera, x: number, y: number, out: Vector2): boolean {
    const d = this.tmp.set(x, y, 0.5).unproject(camera).applyMatrix4(this.inv).sub(this.camL);
    if (Math.abs(d.z) < 1e-12) return false;
    const t = -this.camL.z / d.z;
    if (!(t > 0)) return false;
    out.set((this.camL.x + d.x * t) / this.W + 0.5, (this.camL.y + d.y * t) / this.H + 0.5);
    return true;
  }

  /** The window the view wants now, or null (base texture is sharp enough). */
  private want(camera: PerspectiveCamera, group: Object3D): Win | null {
    const set = this.set;
    if (!set || !set.levels.length) return null;
    this.inv.copy(group.matrixWorld).invert();
    this.camL.copy(camera.position).applyMatrix4(this.inv);
    const c = new Vector2();
    const ax = new Vector2();
    const ay = new Vector2();
    const el = this.renderer.domElement;
    const pr = this.renderer.getPixelRatio();
    const px = 2 / (el.clientWidth * pr);
    const py = 2 / (el.clientHeight * pr);
    if (!this.uvAt(camera, 0, 0, c) || !this.uvAt(camera, px, 0, ax) || !this.uvAt(camera, 0, py, ay)) return null;
    if (c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1) return null;
    // Texels across the image wanted for one texel per device pixel.
    const top = set.levels[set.levels.length - 1];
    const aspect = top.w / top.h;
    const du = Math.max(Math.abs(ax.x - c.x), Math.abs(ay.x - c.x), 1e-12);
    const dv = Math.max(Math.abs(ax.y - c.y), Math.abs(ay.y - c.y), 1e-12);
    const need = Math.max(1 / du, aspect / dv);
    const baseW = BASE_LONG * (aspect >= 1 ? 1 : aspect);
    if (need < baseW * 1.15) return null;
    const L = set.levels.find((l) => l.w >= need) ?? top;
    const T = set.tile;
    const grid = SIZE / T;
    const cols = Math.ceil(L.w / T);
    const rows = Math.ceil(L.h / T);
    const txc = (c.x * L.w) / T;
    const tyc = ((1 - c.y) * L.h) / T;
    const clampT = (v: number, n: number) => Math.min(Math.max(Math.round(v - grid / 2), 0), Math.max(n - grid, 0));
    const w = this.win;
    // Keep the current window while the centre stays in its middle tiles.
    if (w && w.L === L) {
      const inX = txc >= w.tx0 + 1 || w.tx0 === 0;
      const inX2 = txc <= w.tx0 + grid - 1 || w.tx0 >= cols - grid;
      const inY = tyc >= w.ty0 + 1 || w.ty0 === 0;
      const inY2 = tyc <= w.ty0 + grid - 1 || w.ty0 >= rows - grid;
      if (inX && inX2 && inY && inY2) return w;
    }
    return { L, tx0: clampT(txc, cols), ty0: clampT(tyc, rows) };
  }

  private same(a: Win | null, b: Win | null): boolean {
    return a === b || (!!a && !!b && a.L === b.L && a.tx0 === b.tx0 && a.ty0 === b.ty0);
  }

  update(camera: PerspectiveCamera, group: Object3D, dt: number): void {
    this.clock += dt;
    const u = this.uniforms;
    const want = this.want(camera, group);
    if (!this.same(want, this.wanted)) {
      this.wanted = want;
      this.wantedSince = this.clock;
    }
    // A new window: wait for the view to settle (always, unless nothing is shown).
    const settled = this.clock - this.wantedSince >= (this.filled ? SETTLE_S : 0.05);
    if (want && !this.same(want, this.win) && settled) this.begin(want);

    // A filled window maps correctly wherever the view is: keep showing it
    // until a new one starts; fade out before refilling, in once complete.
    const show = !!want && this.filled;
    u.uDetailMix.value = Math.min(Math.max(u.uDetailMix.value + (show ? dt : -dt) / FADE_S, 0), 1);
    if (!this.filled && this.win && u.uDetailMix.value === 0) this.pump();
  }

  private begin(w: Win): void {
    this.gen++;
    for (const r of this.ready) r.bmp.close();
    this.ready = [];
    this.win = w;
    this.filled = false;
    const T = this.set!.tile;
    const grid = SIZE / T;
    const cols = Math.ceil(w.L.w / T);
    const rows = Math.ceil(w.L.h / T);
    const list: [number, number][] = [];
    for (let j = w.ty0; j < Math.min(w.ty0 + grid, rows); j++) for (let i = w.tx0; i < Math.min(w.tx0 + grid, cols); i++) list.push([i, j]);
    const mid = w.tx0 + grid / 2 - 0.5;
    const midY = w.ty0 + grid / 2 - 0.5;
    list.sort((a, b) => Math.hypot(a[0] - mid, a[1] - midY) - Math.hypot(b[0] - mid, b[1] - midY));
    this.toFetch = list;
    this.remaining = list.length;
  }

  /** Fetch ahead and upload a few decoded tiles (only while the window is hidden). */
  private pump(): void {
    const w = this.win!;
    const set = this.set!;
    while (this.fetching < FETCHES && this.toFetch.length) {
      const [tx, ty] = this.toFetch.shift()!;
      const gen = this.gen;
      this.fetching++;
      fetch(`${import.meta.env.BASE_URL}tiles/${this.id}/dz_files/${w.L.level}/${tx}_${ty}.${set.ext}`)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => createImageBitmap(b, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
        .then((bmp) => {
          if (gen !== this.gen) bmp.close();
          else this.ready.push({ tx, ty, bmp });
        })
        .catch(() => {
          // A missing tile: show the window without it rather than never.
          if (gen === this.gen) this.remaining--;
        })
        .finally(() => this.fetching--);
    }
    if (!this.ready.length) {
      if (this.remaining === 0) this.finish();
      return;
    }
    const tex = this.texture();
    const T = set.tile;
    // The rectangle the texture now covers, in image uv.
    const r = this.uniforms.uDetailRect.value;
    r.set((w.tx0 * T) / w.L.w, 1 - (w.ty0 * T + SIZE) / w.L.h, (w.tx0 * T + SIZE) / w.L.w, 1 - (w.ty0 * T) / w.L.h);
    for (let n = 0; n < UPLOADS_PER_FRAME && this.ready.length; n++) {
      const { tx, ty, bmp } = this.ready.shift()!;
      this.remaining--;
      const src = new Texture(bmp);
      // Mipmaps once, with the last tile.
      tex.generateMipmaps = this.remaining === 0;
      this.renderer.copyTextureToTexture(src, tex, null, new Vector2((tx - w.tx0) * T, SIZE - (ty - w.ty0) * T - bmp.height));
      bmp.close();
    }
    if (this.remaining === 0) this.finish();
  }

  private finish(): void {
    this.filled = true;
    this.uniforms.uDetail.value = this.tex;
  }

  private texture(): DataTexture {
    if (this.tex) return this.tex;
    const t = new DataTexture(null, SIZE, SIZE, RGBAFormat, UnsignedByteType);
    t.colorSpace = SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    // Storage only: the tiles are copied in afterwards.
    t.source.dataReady = false;
    t.needsUpdate = true;
    this.renderer.initTexture(t);
    this.tex = t;
    return t;
  }

  /** Free the window texture (the object is far away again). */
  dispose(): void {
    this.gen++;
    for (const r of this.ready) r.bmp.close();
    this.ready = [];
    this.toFetch = [];
    this.win = this.wanted = null;
    this.filled = false;
    this.uniforms.uDetailMix.value = 0;
    this.uniforms.uDetail.value = null;
    this.tex?.dispose();
    this.tex = null;
  }
}
