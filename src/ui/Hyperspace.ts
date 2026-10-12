/**
 * Ramp in until the tunnel covers the view, and the drop out of it (ms).
 * No time at full speed beyond the work itself: a jump that hides nothing
 * only delays the new view.
 */
const ENTER_MS = 320;
const EXIT_MS = 450;
/** Streaks per layer, and layers (staggered so the rush never pulses). */
const STREAKS = 240;
const LAYERS = 3;

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const frames = (n: number) =>
  new Promise<void>((r) => {
    const step = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

/**
 * Light-speed jump, film style, that hides a view change and whatever it
 * loads: star streaks rush out of the centre while the scene swaps behind a
 * dark tunnel, then the view drops out of it. The streaks are drawn once
 * into canvases and moved with CSS transforms and opacity only, which the
 * compositor animates on its own: the rush keeps going even if the page
 * stalls for a moment (a shader compile, a texture upload).
 */
export class Hyperspace {
  private el: HTMLElement | null = null;
  private busy = false;

  /** True when motion should be kept to a minimum (callers dissolve instead). */
  static get reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Jump: ramp in, run `work` (swap + loading) under cover, drop out as soon as it is done. */
  async run(work: () => Promise<void> | void): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const el = this.build();
    el.classList.remove('is-out');
    document.body.appendChild(el);
    void el.offsetWidth; // start the transition from the hidden state
    el.classList.add('is-on');
    await sleep(ENTER_MS + 30); // fully covered before the swap
    try {
      await work();
    } finally {
      // Let the new view draw its first frames (not forever in a hidden tab).
      await Promise.race([frames(2), sleep(250)]);
      el.classList.add('is-out');
      el.classList.remove('is-on');
      await sleep(EXIT_MS);
      el.remove();
      this.busy = false;
    }
  }

  private build(): HTMLElement {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.className = 'hyperspace';
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('--hs-enter', `${ENTER_MS}ms`);
    el.style.setProperty('--hs-exit', `${EXIT_MS}ms`);
    const back = document.createElement('div');
    back.className = 'hs-backdrop';
    el.appendChild(back);
    for (let i = 0; i < LAYERS; i++) {
      const c = this.streaks(i * 7919 + 17);
      c.className = 'hs-layer';
      c.style.setProperty('--i', String(i));
      el.appendChild(c);
    }
    const flash = document.createElement('div');
    flash.className = 'hs-flash';
    el.appendChild(flash);
    this.el = el;
    return el;
  }

  /** One layer: radial streaks, longer and brighter towards the edge (perspective). */
  private streaks(seed: number): HTMLCanvasElement {
    let s = seed;
    const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const size = Math.ceil(Math.hypot(window.screen.width, window.screen.height) * dpr);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.style.width = c.style.height = `${size / dpr}px`;
    const g = c.getContext('2d');
    if (!g) return c;
    const R = size / 2;
    g.translate(R, R);
    g.lineCap = 'round';
    for (let i = 0; i < STREAKS; i++) {
      const a = rand() * Math.PI * 2;
      const r0 = R * (0.03 + 0.6 * Math.pow(rand(), 0.8));
      const len = r0 * (0.35 + 0.6 * rand());
      const x = Math.cos(a);
      const y = Math.sin(a);
      const grad = g.createLinearGradient(x * r0, y * r0, x * (r0 + len), y * (r0 + len));
      const tint = rand();
      const col = tint < 0.6 ? '225,235,255' : tint < 0.85 ? '170,200,255' : '255,240,220';
      grad.addColorStop(0, `rgba(${col},0)`);
      grad.addColorStop(1, `rgba(${col},${0.55 + 0.45 * rand()})`);
      g.strokeStyle = grad;
      g.lineWidth = dpr * (0.6 + 1.8 * (r0 / R));
      g.beginPath();
      g.moveTo(x * r0, y * r0);
      g.lineTo(x * (r0 + len), y * (r0 + len));
      g.stroke();
    }
    return c;
  }
}
