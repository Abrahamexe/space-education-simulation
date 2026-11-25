/**
 * The scale path along the bottom band: "Evren / Kozmik ağ / Laniakea / Yerel Grup / Samanyolu /
 * Güneş Sistemi". Every level is a place to go; going there may take several view changes
 * (solar → galaxy → universe → a scale), run one after another and cancellable midway.
 * Pure: no DOM, no Three.js.
 */
export type UniverseScale = 'observable' | 'web' | 'laniakea' | 'local';
export type Level = UniverseScale | 'milkyWay' | 'solar';

export const LEVEL_ORDER: readonly Level[] = ['observable', 'web', 'laniakea', 'local', 'milkyWay', 'solar'];

const NAMES: Record<Level, string> = {
  observable: 'Evren',
  web: 'Kozmik ağ',
  laniakea: 'Laniakea',
  local: 'Yerel Grup',
  milkyWay: 'Samanyolu',
  solar: 'Güneş Sistemi',
};

export function crumbs(here: Level): { level: Level; name: string; current: boolean }[] {
  return LEVEL_ORDER.map((level) => ({ level, name: NAMES[level], current: level === here }));
}

export type Step =
  | { kind: 'toGalaxy' }
  | { kind: 'toUniverse' }
  | { kind: 'toSolar' }
  | { kind: 'toGalaxyFromUniverse' }
  | { kind: 'scale'; id: UniverseScale };

type View = 'solar' | 'galaxy' | 'universe';
const viewOf = (l: Level): View => (l === 'solar' ? 'solar' : l === 'milkyWay' ? 'galaxy' : 'universe');

export function routeTo(from: Level, to: Level): Step[] {
  if (from === to) return [];
  const a = viewOf(from);
  const b = viewOf(to);
  const steps: Step[] = [];
  if (a === 'solar' && b !== 'solar') steps.push({ kind: 'toGalaxy' });
  if (a === 'universe' && b !== 'universe') steps.push({ kind: 'toGalaxyFromUniverse' });
  if (a !== 'universe' && b === 'universe') steps.push({ kind: 'toUniverse' });
  if (a !== 'solar' && b === 'solar') steps.push({ kind: 'toSolar' });
  if (b === 'universe') steps.push({ kind: 'scale', id: to as UniverseScale });
  return steps;
}

export interface RouteOps {
  toGalaxy(): Promise<void>;
  toUniverse(): Promise<void>;
  toSolar(): Promise<void>;
  toGalaxyFromUniverse(): Promise<void>;
  scale(id: UniverseScale): Promise<void>;
}

/** Runs the steps in order; stops before the next step once `isCancelled()` turns true. */
export async function runRoute(steps: Step[], ops: RouteOps, isCancelled: () => boolean): Promise<void> {
  for (const s of steps) {
    if (isCancelled()) return;
    if (s.kind === 'scale') await ops.scale(s.id);
    else await ops[s.kind]();
  }
}
