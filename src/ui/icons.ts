/**
 * Phosphor icons (MIT), regular weight, imported as raw SVG so they inherit
 * `currentColor`. One family, one weight across the whole UI. (The light
 * weight's strokes fall below one pixel at 16–18 px and look blurry.)
 */
import play from '@phosphor-icons/core/assets/regular/play.svg?raw';
import pause from '@phosphor-icons/core/assets/regular/pause.svg?raw';
import forward from '@phosphor-icons/core/assets/regular/fast-forward.svg?raw';
import rewind from '@phosphor-icons/core/assets/regular/rewind.svg?raw';
import close from '@phosphor-icons/core/assets/regular/x.svg?raw';
import gear from '@phosphor-icons/core/assets/regular/gear-six.svg?raw';
import orbits from '@phosphor-icons/core/assets/regular/circle-dashed.svg?raw';
import labels from '@phosphor-icons/core/assets/regular/tag.svg?raw';
import home from '@phosphor-icons/core/assets/regular/house.svg?raw';
import now from '@phosphor-icons/core/assets/regular/clock-counter-clockwise.svg?raw';
import target from '@phosphor-icons/core/assets/regular/crosshair.svg?raw';
import belts from '@phosphor-icons/core/assets/regular/dots-nine.svg?raw';
import back from '@phosphor-icons/core/assets/regular/caret-left.svg?raw';
import search from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import help from '@phosphor-icons/core/assets/regular/question.svg?raw';
import galaxy from '@phosphor-icons/core/assets/regular/spiral.svg?raw';
import dev from '@phosphor-icons/core/assets/regular/sliders.svg?raw';
import hand from '@phosphor-icons/core/assets/regular/hand.svg?raw';
import zoomOut from '@phosphor-icons/core/assets/regular/arrows-out.svg?raw';
import sun from '@phosphor-icons/core/assets/regular/sun.svg?raw';
import habitable from '@phosphor-icons/core/assets/regular/plant.svg?raw';
import atom from '@phosphor-icons/core/assets/regular/atom.svg?raw';

export const ICONS = { play, pause, forward, rewind, close, gear, orbits, labels, home, now, target, belts, back, search, help, galaxy, dev, hand, zoomOut, sun, habitable, atom } as const;
export type IconName = keyof typeof ICONS;

/** Inline icon markup, hidden from assistive tech (buttons carry labels). */
export function icon(name: IconName, cls = 'icon'): string {
  return ICONS[name].replace('<svg ', `<svg class="${cls}" aria-hidden="true" focusable="false" `);
}
