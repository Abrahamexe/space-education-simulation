import type { QualityLevel } from '../../config/quality';

/**
 * Only one heavy WebGL scene at a time: while a dark-matter lab scene is visible or the film is
 * open, the main engine (solar system / galaxy / universe map) stops rendering. Holds nest; the
 * engine is restarted only by the last release, and only if a hold stopped it in the first place.
 */
export interface MainRender {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  level(): QualityLevel;
}

let target: MainRender | null = null;
let holds = 0;
let stoppedByUs = false;
/** The viewer turned to the main view: holds are ignored until they are all released. */
let yielded = false;

export function bindMainRender(t: MainRender): void {
  target = t;
  holds = 0;
  stoppedByUs = false;
  yielded = false;
}

/** Stop the main engine until the returned release function is called (calling it twice is harmless). */
export function holdMainRender(): () => void {
  if (holds++ === 0 && !yielded && target?.isRunning()) {
    target.stop();
    stoppedByUs = true;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holds === 0) {
      yielded = false;
      if (stoppedByUs) {
        stoppedByUs = false;
        target?.start();
      }
    }
  };
}

/**
 * The viewer is using the main view (clicked or pressed a key outside the dark-matter scenes):
 * restart the engine now; current holds stop nothing more until all are released.
 */
export function yieldMainRender(): void {
  if (holds === 0) return;
  yielded = true;
  if (stoppedByUs) {
    stoppedByUs = false;
    target?.start();
  }
}

/** The main app's quality level; 'medium' before the app has bound itself. */
export function mainQuality(): QualityLevel {
  return target?.level() ?? 'medium';
}
