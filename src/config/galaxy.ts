/**
 * The Milky Way at galaxy scale. Units: parsecs. The galaxy view is centred
 * on the Sun and shares the solar view's orientation (scene axes), so the
 * disc lines up with the Milky Way band painted on the sky.
 *
 * Structure values are published measurements; the disc's look comes from
 * NASA's Spitzer-based artist's impression (the far side of the Galaxy has
 * not been mapped). Sources: docs/CREDITS.md.
 */

/** Sun → Galactic centre distance (GRAVITY Collaboration 2019). */
export const R0_PC = 8178;
/** Height of the Sun above the Galactic mid-plane (Bennett & Bovy 2019). */
export const Z0_PC = 20.8;
/** Thin-disc scale height (Bland-Hawthorn & Gerhard 2016). */
export const DISC_SCALE_HEIGHT_PC = 300;
/** Bulge: vertical extent of the boxy/peanut bulge (Wegg & Gerhard 2013), pc. */
export const BULGE_HEIGHT_PC = 700;

export const PC_PER_LY = 0.306_601_4;

/**
 * Face-on disc image: NASA/JPL-Caltech/ESO/R. Hurt artist's impression
 * based on Spitzer infrared surveys (public domain; eso1339g). Galactic
 * centre at the image centre, the Sun straight below it, l = 90° to the
 * left, seen from the north Galactic pole. Scaled so the Sun sits R0 from
 * the centre (in the annotated edition it is 0.191 image widths below).
 */
export const DISC_IMAGE = {
  low: 'textures/galaxy/2k_milkyway_faceon.jpg',
  high: 'textures/galaxy/4k_milkyway_faceon.jpg',
  sunOffset: 0.191,
} as const;
export const DISC_IMAGE_WIDTH_PC = R0_PC / DISC_IMAGE.sunOffset;

/** Arm labels at their positions in the image (fractions of width, y down; from the annotated edition). */
export interface ArmLabel {
  id: string;
  name: string;
  at: readonly [number, number];
  local?: boolean;
}

export const ARM_LABELS: readonly ArmLabel[] = [
  { id: 'perseus', name: 'Perseus Kolu', at: [0.405, 0.741] },
  { id: 'scutum', name: 'Kalkan-Erboğa Kolu', at: [0.655, 0.327] },
  { id: 'sagittarius', name: 'Yay-Karina Kolu', at: [0.414, 0.445] },
  { id: 'norma', name: 'Norma Kolu', at: [0.627, 0.509] },
  { id: 'outer', name: 'Dış Kol', at: [0.282, 0.727] },
  { id: 'local', name: 'Orion Kolu (Yerel Kol)', at: [0.486, 0.705], local: true },
  { id: 'bar', name: 'Galaktik Çubuk', at: [0.555, 0.423] },
];

export interface GalaxyMarker {
  id: string;
  name: string;
  /** One-line fact for the caption card. */
  fact: string;
  /** Camera distance range (pc) in which the label is shown. */
  range: readonly [number, number];
  /** Framing distance when flown to (pc). */
  framePc: number;
  /** Position: RA/Dec (deg, J2000) + distance, or galactic l/b (deg) + distance. */
  ra?: number;
  dec?: number;
  l?: number;
  b?: number;
  distPc: number;
  /** Drawn as a star point (nearby stars) with this colour. */
  star?: readonly [number, number, number];
  priority: number;
}

/** Nearby stars and landmarks of the solar neighbourhood (Hipparcos / Gaia distances). */
export const NEIGHBOURHOOD: readonly GalaxyMarker[] = [
  { id: 'barnard', name: 'Barnard Yıldızı', fact: 'Gökyüzünde en hızlı yer değiştiren yıldız; sönük bir kırmızı cüce, 6 ışık yılı.', ra: 269.45, dec: 4.69, distPc: 1.83, star: [1, 0.55, 0.35], range: [0.05, 20], framePc: 3, priority: 4 },
  { id: 'wolf359', name: 'Wolf 359', fact: 'Bilinen en yakın yıldızlardan, 7,9 ışık yılı uzakta küçük bir kırmızı cüce.', ra: 164.12, dec: 7.01, distPc: 2.41, star: [1, 0.5, 0.3], range: [0.05, 15], framePc: 3, priority: 2 },
  { id: 'eps-eri', name: 'Epsilon Eridani', fact: 'Toz diski ve gezegeni olan genç, Güneş benzeri bir yıldız; 10,5 ışık yılı.', ra: 53.23, dec: -9.46, distPc: 3.22, star: [1, 0.78, 0.55], range: [0.05, 20], framePc: 3, priority: 3 },
  { id: 'procyon', name: 'Procyon', fact: 'Küçük Köpek takımyıldızının en parlak yıldızı, 11,5 ışık yılı.', ra: 114.83, dec: 5.22, distPc: 3.51, star: [1, 0.96, 0.88], range: [0.05, 40], framePc: 3, priority: 5 },
  { id: 'tau-ceti', name: 'Tau Ceti', fact: "Güneş'e en çok benzeyen yakın yıldızlardan, 11,9 ışık yılı.", ra: 26.02, dec: -15.94, distPc: 3.65, star: [1, 0.86, 0.66], range: [0.05, 20], framePc: 3, priority: 3 },
  { id: 'altair', name: 'Altair', fact: 'Çok hızlı döndüğü için basık bir yıldız, 16,7 ışık yılı.', ra: 297.7, dec: 8.87, distPc: 5.13, star: [0.92, 0.94, 1], range: [0.3, 60], framePc: 5, priority: 6 },
  { id: 'vega', name: 'Vega', fact: 'Parlaklık ölçeğinin tarihsel sıfır noktası, 25 ışık yılı.', ra: 279.23, dec: 38.78, distPc: 7.68, star: [0.82, 0.88, 1], range: [0.5, 90], framePc: 8, priority: 7 },
  { id: 'arcturus', name: 'Arcturus', fact: 'Kuzey gökyüzünün en parlak yıldızı, turuncu bir dev; 37 ışık yılı.', ra: 213.92, dec: 19.18, distPc: 11.26, star: [1, 0.72, 0.45], range: [0.8, 120], framePc: 10, priority: 6 },
  { id: 'aldebaran', name: 'Aldebaran', fact: "Boğa'nın kırmızı gözü, turuncu dev; 65 ışık yılı.", ra: 68.98, dec: 16.51, distPc: 20.4, star: [1, 0.66, 0.4], range: [2, 200], framePc: 15, priority: 5 },
  { id: 'polaris', name: 'Kutup Yıldızı', fact: 'Dünya eksenini gösteren yıldız, yaklaşık 430 ışık yılı.', ra: 37.95, dec: 89.26, distPc: 133, star: [1, 0.95, 0.85], range: [10, 1500], framePc: 40, priority: 6 },
  { id: 'deneb', name: 'Deneb', fact: 'Bilinen en parlak yıldızlardan biri; uzaklığı belirsiz, yaklaşık 2.600 ışık yılı.', ra: 310.36, dec: 45.28, distPc: 800, star: [0.85, 0.9, 1], range: [80, 6000], framePc: 200, priority: 6 },
];

/** Satellite galaxies (distances: Pietrzyński 2019, Graczyk 2020, Vasiliev & Belokurov 2020). */
export const SATELLITES: readonly (GalaxyMarker & { radiusPc: number; count: number })[] = [
  { id: 'lmc', name: 'Büyük Macellan Bulutu', fact: "Samanyolu'nun en büyük uydu gökadası, 163.000 ışık yılı.", l: 280.47, b: -32.89, distPc: 49_590, radiusPc: 2600, count: 9000, range: [8000, Infinity], framePc: 22_000, priority: 7 },
  { id: 'smc', name: 'Küçük Macellan Bulutu', fact: 'Büyük Macellan Bulutu ile birlikte dolanan cüce gökada, 204.000 ışık yılı.', l: 302.8, b: -44.3, distPc: 62_440, radiusPc: 1500, count: 4500, range: [8000, Infinity], framePc: 15_000, priority: 6 },
  { id: 'sgr-dwarf', name: 'Yay Cüce Gökadası', fact: "Samanyolu'nun gelgit kuvvetiyle parçalanan, galaksinin öbür yanındaki cüce gökada.", l: 5.61, b: -14.09, distPc: 26_500, radiusPc: 1800, count: 1200, range: [8000, Infinity], framePc: 15_000, priority: 4 },
];

export const GALAXY_VIEW = {
  /** Solar view → galaxy once the camera is this many Kuiper-belt distances (50 AU, scene-mapped) from the Sun. */
  enterKuiperMultiple: 8,
  /** Galaxy camera distance from the Sun at the switch, and below which it returns (pc). */
  entryPc: 0.02,
  exitPc: 0.012,
  /** Pull-out after the switch: final view (pc, deg). */
  overviewDistancePc: 42_000,
  overviewElevationDeg: 58,
  pullOutMinS: 4.5,
  /** Camera → pivot limit (pc): wide enough to see the Local Group. */
  maxDistancePc: 4_000_000,
  /** Particle counts: disc stars are sampled from the image's brightness. */
  discStars: 150_000,
  haloStars: 4_000,
  /** Point sizes (pc) for disc stars; pixels clamped. */
  starSizePc: 55,
  maxPointPx: 7,
  /** Sky sphere (painted Milky Way) fades out over this camera distance (pc). */
  skyFade: [60, 1500] as const,
  glowFade: [900, 7000] as const,
  /** Star particles fade in over this camera distance (pc); nearer, the painted sky shows the Galaxy. */
  fieldFade: [40, 700] as const,
  /** The disc image fades in over this camera distance (pc). */
  glowIntensity: 0.9,
  brightness: 1.0,
} as const;
