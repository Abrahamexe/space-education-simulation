/**
 * Playground ("Oyun alanı"): the Solar System as an N-body sandbox.
 * GM values: JPL DE440 (system masses for planets with moons, since the
 * moons ride along with their planet); dwarf planets from JPL SBDB.
 */
import { KM_PER_AU, SECONDS_PER_DAY } from './astro';

type RGB = readonly [number, number, number];

/** km³/s² → AU³/day². */
export const GM_KM_TO_AU = (SECONDS_PER_DAY * SECONDS_PER_DAY) / (KM_PER_AU * KM_PER_AU * KM_PER_AU);

export const GM_KM3S2: Record<string, number> = {
  sun: 132_712_440_041.279,
  mercury: 22_031.869,
  venus: 324_858.592,
  earth: 403_503.236, // Earth + Moon
  mars: 42_828.376,
  jupiter: 126_712_764.1,
  saturn: 37_940_584.84,
  uranus: 5_794_556.4,
  neptune: 6_836_527.1,
  ceres: 62.63,
  pluto: 975.5, // Pluto + Charon
  haumea: 267.4,
  makemake: 207,
  eris: 1108,
  halley: 0,
};

export const M_SUN_KG = 1.98847e30;
export const M_JUP_IN_SUN = 9.5458e-4;
export const M_EARTH_IN_SUN = 3.003e-6;
export const R_SUN_KM = 695_700;

export type AddKind = 'bh' | 'quasar' | 'ns' | 'wd' | 'rd' | 'sunlike' | 'bluegiant' | 'jupiter' | 'earth' | 'neptune' | 'moonlike';
export type MassUnit = 'sun' | 'jup' | 'earth';

export interface AddPreset {
  kind: AddKind;
  name: string;
  /** Short description for the palette. */
  hint: string;
  /** Default mass and the unit the form shows. */
  mass: number;
  unit: MassUnit;
  /** Radius, km (black holes: from the mass). */
  radiusKm: number;
  /** Surface temperature, K (stars). */
  tempK?: number;
  /** How it is drawn. */
  look: 'hole' | 'pulsar' | 'star' | 'planet';
  texture?: string;
  color: RGB;
  /** Quick mass choices (value in `unit`, label). */
  masses?: readonly (readonly [number, string])[];
}

/** Eddington luminosity per solar mass, L☉. */
export const L_EDD_PER_SUN = 3.2e4;
/** A quasar shines at ~8 % of Eddington (TON 618: 4·10¹⁰ M☉ → ~10¹⁴ L☉). */
export const QUASAR_EDDINGTON = 0.08;

export const ADD_PRESETS: readonly AddPreset[] = [
  {
    kind: 'bh', name: 'Kara delik', hint: 'Işığı bile yutan çekim', mass: 10, unit: 'sun', radiusKm: 0, look: 'hole', color: [1, 0.6, 0.3],
    masses: [[1, '1 M☉'], [10, '10 M☉'], [100, '100 M☉'], [4.3e6, 'Sgr A*'], [6.5e9, 'M87*'], [4.07e10, 'TON 618']],
  },
  {
    kind: 'quasar', name: 'Kuasar (beslenen dev kara delik)', hint: 'TON 618 gibi: diskiyle bir galaksiden parlak', mass: 4.07e10, unit: 'sun', radiusKm: 0, look: 'hole', color: [0.75, 0.82, 1],
    masses: [[1e8, '100 milyon M☉'], [2.6e8, '3C 273'], [6.5e9, 'M87*'], [4.07e10, 'TON 618']],
  },
  { kind: 'ns', name: 'Nötron yıldızı (pulsar)', hint: '1,4 Güneş kütlesi, 24 km çap', mass: 1.4, unit: 'sun', radiusKm: 12, look: 'pulsar', color: [0.6, 0.78, 1], masses: [[1.2, '1,2 M☉'], [1.4, '1,4 M☉'], [2, '2 M☉']] },
  { kind: 'wd', name: 'Beyaz cüce', hint: "Dünya boyunda, Güneş'in yarısı kütlede", mass: 0.6, unit: 'sun', radiusKm: 8700, tempK: 25_000, look: 'star', color: [0.8, 0.88, 1] },
  { kind: 'rd', name: 'Kırmızı cüce', hint: 'Galaksideki en yaygın yıldız', mass: 0.2, unit: 'sun', radiusKm: 0.22 * R_SUN_KM, tempK: 3200, look: 'star', color: [1, 0.5, 0.3] },
  { kind: 'sunlike', name: 'Güneş benzeri yıldız', hint: "Güneş'in ikizi", mass: 1, unit: 'sun', radiusKm: R_SUN_KM, tempK: 5772, look: 'star', color: [1, 0.85, 0.6], masses: [[0.5, '0,5 M☉'], [1, '1 M☉'], [2, '2 M☉']] },
  { kind: 'bluegiant', name: 'Mavi dev', hint: '20 Güneş kütlesi, 36.000 kat parlak', mass: 20, unit: 'sun', radiusKm: 7 * R_SUN_KM, tempK: 30_000, look: 'star', color: [0.65, 0.78, 1] },
  { kind: 'jupiter', name: 'Jüpiter benzeri gezegen', hint: 'Gaz devi', mass: 1, unit: 'jup', radiusKm: 71_492, look: 'planet', texture: 'textures/jupiter/2k_jupiter.jpg', color: [0.85, 0.7, 0.55], masses: [[0.3, '0,3 M♃'], [1, '1 M♃'], [5, '5 M♃'], [13, '13 M♃']] },
  { kind: 'earth', name: 'Dünya benzeri gezegen', hint: 'İkinci bir Dünya', mass: 1, unit: 'earth', radiusKm: 6371, look: 'planet', texture: 'textures/earth/2k_earth_daymap.jpg', color: [0.4, 0.55, 0.8], masses: [[0.1, '0,1 M⊕'], [1, '1 M⊕'], [5, '5 M⊕']] },
  { kind: 'neptune', name: 'Haydut gezegen', hint: 'Yıldızsız dolaşan, Neptün kütleli', mass: 17.1, unit: 'earth', radiusKm: 24_622, look: 'planet', texture: 'textures/neptune/2k_neptune.jpg', color: [0.4, 0.55, 1] },
  { kind: 'moonlike', name: 'Ay büyüklüğünde cisim', hint: 'Çarpışma için ideal', mass: 0.0123, unit: 'earth', radiusKm: 1737, look: 'planet', texture: 'textures/moon/2k_moon.jpg', color: [0.6, 0.6, 0.6] },
];

export function massInSun(mass: number, unit: MassUnit): number {
  return unit === 'sun' ? mass : unit === 'jup' ? mass * M_JUP_IN_SUN : mass * M_EARTH_IN_SUN;
}

/** Luminosity (L☉) from radius (km) and temperature (Stefan–Boltzmann, relative to the Sun). */
export function luminosityOf(radiusKm: number, tempK: number): number {
  return (radiusKm / R_SUN_KM) ** 2 * (tempK / 5772) ** 4;
}

/** Simulated days per real second. */
export const PLAYGROUND_RATES: readonly { label: string; days: number }[] = [
  { label: '1 gün/s', days: 1 },
  { label: '10 gün/s', days: 10 },
  { label: '1 ay/s', days: 30.44 },
  { label: '1 yıl/s', days: 365.25 },
  { label: '10 yıl/s', days: 3652.5 },
  { label: '100 yıl/s', days: 36_525 },
];

/**
 * Ready-made "what if" scenarios. Positions: relative to `ref` (a body id),
 * in the ecliptic, AU; `angleDeg` measured from the Sun→ref direction,
 * counter-clockwise seen from the north. Velocity relative to `ref`:
 * km/s along `dirDeg` (same convention), or 'circular' for a circular orbit
 * round `ref`.
 */
export interface Scenario {
  id: string;
  name: string;
  text: string;
  bodies: {
    kind: AddKind;
    mass?: number;
    ref: string;
    distanceAu: number;
    angleDeg: number;
    speedKmS: number | 'circular';
    dirDeg?: number;
    heightAu?: number;
    /** Velocity measured against the Sun instead of `ref`. */
    velFrame?: 'ref' | 'sun';
    name?: string;
  }[];
  /** Remove these real bodies first. */
  remove?: string[];
  rateDays?: number;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'bh-flyby',
    name: 'Kara delik yakından geçiyor',
    text: '10 Güneş kütleli bir kara delik dış sistemden içeri dalıyor ve Jüpiter yörüngesi yakınından geçiyor.',
    bodies: [{ kind: 'bh', mass: 10, ref: 'sun', distanceAu: 120, angleDeg: 40, speedKmS: 18, dirDeg: 222, heightAu: 4 }],
    rateDays: 365.25,
  },
  {
    id: 'bh-mars',
    name: "Mars'ın yanında 1 Güneş kütleli kara delik",
    text: "Güneş kütlesinde bir kara delik, Güneş'e göre durgun, Mars'ın 0,5 AU ötesinde beliriyor. İç gezegenlerin yörüngeleri ne olur?",
    bodies: [{ kind: 'bh', mass: 1, ref: 'mars', distanceAu: 0.5, angleDeg: 0, speedKmS: 0, velFrame: 'sun' }],
    rateDays: 30.44,
  },
  {
    id: 'star-flyby',
    name: 'Bir yıldız sistemin içinden geçiyor',
    text: "Güneş benzeri bir yıldız 30 km/s hızla Neptün'ün yörüngesinin hemen dışından geçiyor.",
    bodies: [{ kind: 'sunlike', ref: 'sun', distanceAu: 400, angleDeg: 100, speedKmS: 30, dirDeg: 284, heightAu: 10 }],
    rateDays: 3652.5,
  },
  {
    id: 'jupiter-earth',
    name: 'Dünya yakınında ikinci bir Jüpiter',
    text: "Jüpiter kütleli bir gezegen Dünya'nın biraz dışında, 1,3 AU'da dairesel yörüngede dolanıyor.",
    bodies: [{ kind: 'jupiter', ref: 'sun', distanceAu: 1.3, angleDeg: 60, speedKmS: 'circular' }],
    rateDays: 365.25,
  },
  {
    id: 'rogue',
    name: 'Haydut gezegen iç sistemden geçiyor',
    text: "Neptün kütleli bir haydut gezegen 20 km/s hızla Dünya'nın yörüngesini kesiyor.",
    bodies: [{ kind: 'neptune', ref: 'sun', distanceAu: 30, angleDeg: 25, speedKmS: 20, dirDeg: 200, heightAu: 0.5 }],
    rateDays: 30.44,
  },
  {
    id: 'no-sun',
    name: 'Güneş yok olsaydı',
    text: 'Güneş bir anda yok oluyor. Gezegenler o anki hızlarıyla düz çizgide uzaklaşır.',
    bodies: [],
    remove: ['sun'],
    rateDays: 365.25,
  },
  {
    id: 'moon-hit',
    name: "Dünya'ya Ay büyüklüğünde bir cisim çarpıyor",
    text: "Ay büyüklüğünde bir cisim Dünya'ya doğru 12 km/s hızla geliyor (Ay'ı oluşturan çarpışmaya benzer).",
    bodies: [{ kind: 'moonlike', ref: 'earth', distanceAu: 0.02, angleDeg: 90, speedKmS: 12, dirDeg: 270 }],
    rateDays: 1,
  },
  {
    id: 'ton618',
    name: 'TON 618, 4 ışık yılı uzakta',
    text: "Bilinen en büyük kara deliklerden TON 618, Proxima Centauri kadar uzağa konuyor. Işığı ve çekimi ışık hızıyla yol alır: 4 yıl hiçbir şey olmaz, sonra Güneş'ten bin kat güçlü ışık her şeyi kavurur.",
    bodies: [{ kind: 'quasar', name: 'TON 618', ref: 'sun', distanceAu: 268_000, angleDeg: 50, speedKmS: 0, velFrame: 'sun', heightAu: 20_000 }],
    rateDays: 365.25,
  },
  {
    id: 'bh-earth',
    name: "Kara delik Dünya'nın dibinden geçiyor",
    text: "10 Güneş kütleli bir kara delik Dünya'nın 2 milyon km yakınından geçiyor: Dünya gelgit kuvvetiyle spagetti gibi uzayıp parçalanır.",
    bodies: [{ kind: 'bh', mass: 10, ref: 'earth', distanceAu: 1.5, angleDeg: 0.5, speedKmS: 40, dirDeg: 180 }],
    rateDays: 1,
  },
  {
    id: 'pulsar',
    name: 'Pulsar Kuiper Kuşağı’nda',
    text: "Bir pulsar 80 AU uzakta Güneş'le birlikte dolanmaya başlıyor. Kütlesi Güneş'ten büyük olduğu için dış gezegenleri sarsar; peki ışınımı Dünya'nın ozon tabakasına ne yapar?",
    bodies: [{ kind: 'ns', ref: 'sun', distanceAu: 80, angleDeg: 30, speedKmS: 'circular' }],
    rateDays: 30.44,
  },
  {
    id: 'blue-giant',
    name: 'Mavi dev 6 AU uzakta',
    text: "36.000 kat parlak bir mavi dev Jüpiter'in yerine yakın konuyor: Dünya ne kadar ısınır?",
    bodies: [{ kind: 'bluegiant', ref: 'sun', distanceAu: 6, angleDeg: 180, speedKmS: 'circular' }],
    rateDays: 30.44,
  },
];
