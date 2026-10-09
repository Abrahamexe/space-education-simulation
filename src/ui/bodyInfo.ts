import factsData from '../data/generated/facts.json';
import satellitesData from '../data/generated/satellites.json';
import smallBodiesData from '../data/generated/small-bodies.json';
import content from '../i18n/content.tr.json';
import { strings } from '../i18n';
import { CelestialBody } from '../bodies/CelestialBody';
import { Planet } from '../bodies/Planet';
import type { FocusEntry, SolarSystem } from '../bodies/SolarSystem';
import type { SatelliteRecord } from '../bodies/Moon';
import { SPACECRAFT } from '../config/spacecraft';
import { au, date, fixed, hours, km, num, period, sci, sig } from './format';

/**
 * Everything the info panel shows for one body, assembled from sourced data
 * only: NASA fact sheets (planets, the Moon, the Sun), JPL satellite tables
 * (moons; mass and surface gravity derived from GM and radius) and the JPL
 * Small-Body Database (dwarf planets, Halley). Nothing is invented: a value
 * missing from the sources is simply not shown.
 */

export interface Stat {
  label: string;
  value: string;
}

export interface Comparison {
  label: string;
  /** Body / Earth. */
  ratio: number;
  text: string;
}

export interface BodyInfo {
  id: string;
  name: string;
  typeLabel: string;
  subtitle: string | null;
  stats: Stat[];
  compare: Comparison[];
  text: string[];
  fact: string | null;
  moons: FocusEntry[];
  /** The body this one orbits (moons), for the panel's back link. */
  parent: FocusEntry | null;
  /**
   * Comets: the perihelion passage of the orbit solution (JPL SBDB, Julian
   * date). Near the elements' epoch, so the model matches it closely; the
   * panel offers a jump there to see the comet active.
   */
  perihelionJd: number | null;
  /** Spacecraft: also show the live distance (and signal delay) from Earth. */
  craft?: boolean;
  /** Source line when it differs from the default. */
  source?: string;
}

type Facts = Record<string, Record<string, number | boolean | null>>;
const FACTS = (factsData as unknown as { bodies: Facts }).bodies;
const SATS = satellitesData.satellites as unknown as SatelliteRecord[] & { gm?: number }[];
const SMALL = Object.fromEntries(smallBodiesData.bodies.map((b) => [b.id, b]));
const TEXT = content as unknown as {
  types: Record<string, string>;
  bodies: Record<string, { subtitle?: string; text: string[]; fact?: string }>;
  dwarfMoons: Record<string, number>;
  cometPerihelia?: Record<string, { last: string; next: string }>;
};

/** CODATA 2018 Newtonian constant of gravitation (m³ kg⁻¹ s⁻²). */
const G = 6.6743e-11;
const EARTH = FACTS.earth as Record<string, number>;

const S = () => strings().panel.stats;

/**
 * Turkish genitive for a proper name, by vowel harmony:
 * Jüpiter'in, Satürn'ün, Mars'ın, Plüton'un, Dünya'nın.
 */
export function genitive(name: string): string {
  const vowels = 'aıoueiöüâî';
  const lower = name.toLocaleLowerCase('tr-TR');
  const last = [...lower].reverse().find((c) => vowels.includes(c)) ?? 'e';
  const suffix = 'aıâ'.includes(last) ? 'ın' : 'eiî'.includes(last) ? 'in' : 'ou'.includes(last) ? 'un' : 'ün';
  const endsInVowel = vowels.includes(lower[lower.length - 1]);
  return `${name}'${endsInVowel ? 'n' : ''}${suffix}`;
}

function ratioText(r: number): string {
  const R = strings().panel.ratio;
  if (Math.abs(r - 1) < 0.005) return R.same;
  if (r >= 1) return R.times(sig(r, r >= 100 ? 3 : 2));
  return R.times(sig(r, 2));
}

function comparisons(diameterKm?: number | null, mass1e24?: number | null, gravity?: number | null): Comparison[] {
  const S2 = S();
  const out: Comparison[] = [];
  const push = (label: string, v: number | null | undefined, earth: number) => {
    if (v && v > 0) out.push({ label, ratio: v / earth, text: ratioText(v / earth) });
  };
  push(S2.diameter, diameterKm, EARTH.diameterKm);
  push(S2.mass, mass1e24, EARTH.mass1e24kg);
  push(S2.gravity, gravity, EARTH.gravity);
  return out;
}

const tempC = (c: number) => `${num(c, 0)} °C`;
// NASA quotes surface gravity to one decimal; tiny moons need significant figures.
const gravityText = (g: number) => `${g >= 1 ? fixed(g, 1) : sig(g, 2)} m/s²`;
const kg = (m1e24: number) => `${sci(m1e24 * 1e24, 4)} kg`;

function sizeText(body: CelestialBody): string {
  const t = body.desc.triaxialKm;
  if (t) return `${t.map((v) => sig(v * 2, 3)).join(' × ')} km`;
  return `${num(body.desc.radiusKm.equatorial * 2, 0)} km`;
}

export function buildInfo(e: FocusEntry, system: SolarSystem): BodyInfo {
  const st = S();
  const body = e.body instanceof CelestialBody ? e.body : null;
  const words = TEXT.bodies[e.id] ?? { text: [] };
  let typeKey: string = e.kind;
  if (e.kind === 'planet' && body instanceof Planet) typeKey = body.data.type;
  if (e.kind === 'star') typeKey = 'star';
  const info: BodyInfo = {
    id: e.id,
    name: e.name,
    typeLabel: TEXT.types[typeKey] ?? '',
    subtitle: words.subtitle ?? null,
    stats: [],
    compare: [],
    text: words.text,
    fact: words.fact ?? null,
    moons: system.focusables.filter((f) => f.parent === e.id),
    parent: e.parent ? (system.focusables.find((p) => p.id === e.parent) ?? null) : null,
    perihelionJd: null,
  };
  const stats = info.stats;
  if (e.kind === 'craft') {
    const def = SPACECRAFT.find((c) => c.id === e.id);
    if (!def) return info;
    const p = strings().panel;
    info.typeLabel = p.craftTypes[def.kind];
    info.subtitle = def.status;
    info.text = def.text;
    info.fact = def.fact;
    info.craft = true;
    info.source = 'schematic' in def.model ? p.craftSourcesSchematic : p.craftSources;
    stats.push(
      { label: st.agency, value: def.agency },
      { label: st.launch, value: date(new Date(def.launch + 'T12:00:00Z')) },
      { label: st.mass, value: `${num(def.massKg, 0)} kg` },
      { label: st.size, value: `${num(def.sizeM, Number.isInteger(def.sizeM) ? 0 : 1)} m` },
    );
    return info;
  }
  const f = FACTS[e.id] as Record<string, number> | undefined;

  if (e.kind === 'star' && f) {
    stats.push(
      { label: st.diameter, value: `${num(f.radiusKm * 2, 0)} km` },
      { label: st.mass, value: kg(f.mass1e24kg) },
      { label: st.surfaceTemp, value: `${num(f.effectiveTempK, 0)} K` },
      { label: st.coreTemp, value: `${sig(f.centralTempK / 1e6, 3)} milyon K` },
      { label: st.rotation, value: hours(f.rotationHours) },
      { label: st.gravity, value: gravityText(f.gravity) },
    );
    info.compare = comparisons(f.radiusKm * 2, f.mass1e24kg, f.gravity);
    return info;
  }

  if (e.kind === 'planet' && f) {
    stats.push(
      { label: st.diameter, value: `${num(f.diameterKm, 0)} km` },
      { label: st.mass, value: kg(f.mass1e24kg) },
      { label: st.distanceSun, value: km(f.distance1e6km * 1e6) },
      { label: st.orbit, value: period(f.orbitalPeriodDays) },
      { label: st.day, value: hours(f.dayHours) },
      { label: st.temp, value: tempC(f.meanTempC) },
      { label: st.gravity, value: gravityText(f.gravity) },
      { label: st.moons, value: num(f.moons, 0) },
    );
    info.compare = comparisons(f.diameterKm, f.mass1e24kg, f.gravity);
    return info;
  }

  if (e.kind === 'moon' && body) {
    const parent = system.focusables.find((p) => p.id === e.parent);
    if (parent) info.subtitle = strings().panel.moonOf(genitive(parent.name));
    if (e.id === 'moon' && f) {
      // Earth's Moon is on the NASA fact sheet itself.
      stats.push(
        { label: st.diameter, value: `${num(f.diameterKm, 0)} km` },
        { label: st.mass, value: kg(f.mass1e24kg) },
        { label: st.distanceEarth, value: km(f.distance1e6km * 1e6) },
        { label: st.orbit, value: period(f.orbitalPeriodDays) },
        { label: st.temp, value: tempC(f.meanTempC) },
        { label: st.gravity, value: gravityText(f.gravity) },
      );
      info.compare = comparisons(f.diameterKm, f.mass1e24kg, f.gravity);
      return info;
    }
    const sat = SATS.find((s) => s.name === (body.desc as { jplName?: string }).jplName) as
      | (SatelliteRecord & { gm?: number | null })
      | undefined;
    if (sat) {
      const radius = sat.meanRadiusKm ?? body.desc.radiusKm.equatorial;
      const massKg = sat.gm ? (sat.gm * 1e9) / G : null;
      const gravity = sat.gm ? (sat.gm / (radius * radius)) * 1000 : null;
      stats.push({ label: body.desc.triaxialKm ? st.size : st.diameter, value: body.desc.triaxialKm ? sizeText(body) : `${num(radius * 2, 0)} km` });
      if (massKg) stats.push({ label: st.mass, value: `${sci(massKg, 4)} kg` });
      stats.push({ label: st.distanceParent, value: km(sat.aKm) });
      const retro = sat.iDeg > 90 ? ` (${strings().panel.retrograde})` : '';
      stats.push({ label: st.orbit, value: period(sat.periodDays) + retro });
      if (gravity) stats.push({ label: st.gravity, value: gravityText(gravity) });
      info.compare = comparisons(radius * 2, massKg ? massKg / 1e24 : null, gravity);
    }
    return info;
  }

  const sb = SMALL[e.id];
  if ((e.kind === 'dwarf' || e.kind === 'comet') && sb && body) {
    if (e.kind === 'comet') {
      const q = sb.aAu * (1 - sb.e);
      const Q = sb.aAu * (1 + sb.e);
      stats.push(
        { label: st.size, value: sizeText(body) },
        { label: st.orbit, value: period(sb.periodDays) },
        { label: st.perihelion, value: au(q) },
        { label: st.aphelion, value: au(Q) },
      );
      // Perihelion dates come from published ephemerides: propagating fixed
      // osculating elements ignores planetary perturbations (off by months).
      info.perihelionJd = (sb as { perihelionJd?: number }).perihelionJd ?? null;
      const peri = TEXT.cometPerihelia?.[e.id];
      if (peri) {
        stats.push(
          { label: st.lastPerihelion, value: date(new Date(peri.last + 'T12:00:00Z')) },
          { label: st.nextPerihelion, value: date(new Date(peri.next + 'T12:00:00Z')) },
        );
      }
      return info;
    }
    const diameter = f?.diameterKm ?? null;
    stats.push({ label: body.desc.triaxialKm ? st.size : st.diameter, value: diameter ? `${num(diameter, 0)} km` : sizeText(body) });
    if (f?.mass1e24kg) stats.push({ label: st.mass, value: kg(f.mass1e24kg) });
    stats.push({ label: st.distanceSun, value: au(sb.aAu) });
    stats.push({ label: st.orbit, value: period(sb.periodDays) });
    if (sb.rotationHours) stats.push({ label: st.day, value: hours(sb.rotationHours) });
    if (f?.meanTempC !== undefined && f?.meanTempC !== null) stats.push({ label: st.temp, value: tempC(f.meanTempC) });
    if (f?.gravity) stats.push({ label: st.gravity, value: gravityText(f.gravity) });
    const moons = TEXT.dwarfMoons[e.id];
    if (moons !== undefined) stats.push({ label: st.moons, value: num(moons, 0) });
    info.compare = comparisons(diameter ?? body.desc.radiusKm.equatorial * 2, f?.mass1e24kg ?? null, f?.gravity ?? null);
  }
  return info;
}
