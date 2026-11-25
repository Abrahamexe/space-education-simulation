/**
 * What an exoplanet is likely to look like, from what is measured: its radius and how much light it
 * gets. No exoplanet surface has ever been imaged, so the look is representative; the class follows
 * the usual size / temperature divisions (Fulton gap at ~1.7 R⊕, giants above ~6 R⊕).
 */
export type PlanetType = 'lava' | 'barren' | 'temperate' | 'eyeball' | 'icy' | 'subNeptune' | 'giant' | 'hotJupiter';

const SUN_RADIUS_AU = 0.004_650_47;
/** Bond albedo used for the equilibrium temperature. */
const ALBEDO = 0.3;

/** Equilibrium temperature (K): T★ · √(R★ / 2a) · (1 − A)^¼. */
export function equilibriumK(starTempK: number, starRadiusSun: number, aAu: number): number {
  if (!(aAu > 0) || !(starTempK > 0) || !(starRadiusSun > 0)) return 0;
  return starTempK * Math.sqrt((starRadiusSun * SUN_RADIUS_AU) / (2 * aAu)) * (1 - ALBEDO) ** 0.25;
}

export function planetType(p: { aAu: number; radiusEarth: number }, star: { tempK: number; radiusSun: number }): PlanetType {
  const t = equilibriumK(star.tempK, star.radiusSun, p.aAu);
  if (p.radiusEarth >= 6) return t > 1000 ? 'hotJupiter' : 'giant';
  if (p.radiusEarth >= 1.7) return 'subNeptune';
  if (t > 900) return 'lava';
  if (t < 180) return 'icy';
  if (t <= 330) {
    // Close to a red dwarf the rotation locks: one face in endless day.
    return star.tempK < 4000 && p.aAu < 0.1 ? 'eyeball' : 'temperate';
  }
  return 'barren';
}

/** Turkish names for the card. */
export const PLANET_TYPE_NAME: Record<PlanetType, string> = {
  lava: 'Lav dünyası',
  barren: 'Sıcak, kayalık çöl',
  temperate: 'Ilıman kayalık dünya',
  eyeball: 'Gelgit kilitli "göz küresi" dünya',
  icy: 'Donmuş dünya',
  subNeptune: 'Alt-Neptün (kalın, puslu atmosfer)',
  giant: 'Gaz devi',
  hotJupiter: 'Sıcak Jüpiter',
};
