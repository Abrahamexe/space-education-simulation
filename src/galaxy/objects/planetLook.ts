import { equilibriumK, planetType, type PlanetType } from './exoplanetType.ts';

/**
 * One exoplanet's look, derived from its own data rather than its class alone: temperature sets ice,
 * ocean and cloud amounts and rock colour; density marks water-rich worlds; a measured atmosphere
 * (or its absence) sets clouds and the glow of air; a seed from its name lays out continents and
 * weather. Representative — no exoplanet surface has been imaged.
 */
export interface LookInput {
  name: string;
  aAu: number;
  radiusEarth: number;
  massEarth?: number;
  atmosphere?: 'none' | 'thin' | 'thick';
}

export interface PlanetLook {
  type: PlanetType;
  teq: number;
  /** Bulk density relative to Earth (when the mass is known). */
  density?: number;
  waterRich: boolean;
  /** 0..1 amounts. */
  ice: number;
  ocean: number;
  cloud: number;
  /** Strength of the atmosphere's rim glow. */
  atm: number;
  /** Surface / haze / band colour (linear-ish RGB 0..1). */
  tint: [number, number, number];
  glow: number;
  /** 0..1, stable per planet: continent and weather layout. */
  seed: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** FNV-1a hash of the name to 0..1. */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return (h % 100_000) / 100_000;
}

export function planetLook(p: LookInput, star: { tempK: number; radiusSun: number }, systemId: string): PlanetLook {
  const type = planetType(p, star);
  const teq = equilibriumK(star.tempK, star.radiusSun, p.aAu);
  const seed = hash01(`${systemId}/${p.name}`);
  const jitter = (k: number) => (hash01(`${systemId}/${p.name}/${k}`) - 0.5) * 2; // −1..1
  const density = p.massEarth && p.radiusEarth > 0 ? p.massEarth / p.radiusEarth ** 3 : undefined;
  const waterRich = density !== undefined && density < 0.85 && p.radiusEarth < 1.7;

  const atm = p.atmosphere === 'none' ? 0 : p.atmosphere === 'thin' ? 0.5 : p.atmosphere === 'thick' || p.radiusEarth >= 1.7 ? 1 : 0.7;
  const ice = Math.min(1, Math.max(0, smooth(275, 190, teq) + 0.08 * jitter(1)));
  let ocean = 0.5 + (waterRich ? 0.32 : 0) - 0.4 * smooth(300, 345, teq) + 0.12 * jitter(2);
  ocean = Math.min(0.95, Math.max(0.1, ocean));
  let cloud = atm === 0 ? 0 : 0.22 + 0.45 * smooth(200, 320, teq) + (atm >= 1 ? 0.15 : 0) + 0.1 * jitter(3);
  cloud = Math.min(0.95, Math.max(0, cloud));

  let tint: [number, number, number];
  if (type === 'subNeptune') {
    tint = teq < 300 ? mix3([0.5, 0.68, 0.95], [0.6, 0.8, 0.88], smooth(150, 300, teq)) : mix3([0.68, 0.8, 0.85], [0.88, 0.74, 0.58], smooth(300, 700, teq));
  } else if (type === 'giant' || type === 'hotJupiter') {
    tint = mix3([0.95, 0.88, 0.75], [1, 0.7, 0.45], smooth(150, 900, teq));
  } else if (type === 'icy') {
    tint = mix3([0.78, 0.86, 0.98], [0.92, 0.9, 0.88], smooth(80, 180, teq));
  } else {
    // Bare rock: grey when mild, rust in the heat, dark basalt / glowing crust when hotter still.
    tint = teq < 600 ? mix3([0.62, 0.6, 0.57], [0.88, 0.56, 0.38], smooth(330, 600, teq)) : mix3([0.88, 0.56, 0.38], [0.34, 0.28, 0.25], smooth(600, 950, teq));
  }
  // A small, stable per-planet variation in hue so neighbours never share a colour.
  tint = tint.map((v, i) => Math.min(1, Math.max(0, v * (1 + 0.07 * jitter(10 + i))))) as [number, number, number];

  const glow = type === 'lava' ? Math.min(1, 0.5 + smooth(900, 1600, teq) * 0.5) : type === 'hotJupiter' ? Math.min(1, Math.max(0.2, (teq - 900) / 1000)) : 0;
  return { type, teq, density, waterRich, ice, ocean, cloud, atm, tint, glow, seed };
}
