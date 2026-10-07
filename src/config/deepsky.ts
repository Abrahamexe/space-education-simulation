/**
 * Deep-sky destinations of the galaxy view: the Milky Way's most famous
 * nebulae, star systems, pulsars, black holes and clusters. Positions are
 * J2000 RA/Dec (deg) + distance (pc). Images are NASA/ESA/CSA Hubble and
 * Webb releases (public domain, Wikimedia Commons; docs/CREDITS.md). No
 * measured 3-D models of these objects exist: nebula depth follows their
 * published structure (see `DepthSpec`), systems use published orbits and
 * stellar parameters.
 */

export type Category = 'blackhole' | 'galaxy' | 'giant' | 'pulsar' | 'nebula' | 'system' | 'cluster';

export interface Facts {
  /** Short type line, e.g. "Süpernova kalıntısı". */
  type: string;
  /** Extra numbers for the card (distance is added automatically). */
  stats: readonly (readonly [string, string])[];
  text: string;
  didYouKnow?: string;
}

interface Base {
  id: string;
  name: string;
  /** Short label for menus. */
  short: string;
  category: Category;
  ra: number;
  dec: number;
  distPc: number;
  /** Framing distance when flown to (pc). */
  framePc: number;
  facts: Facts;
}

/**
 * Nebula depth models (image coordinates centred, y up, in image widths;
 * depth towards the Sun in image widths):
 *  - shell: emission on an ellipsoidal shell (supernova remnants, some
 *    planetary nebulae); `interiorBlue` fills it with the bluish synchrotron
 *    glow (Crab);
 *  - bowl: an H II "blister" opening towards us, deepest behind its stars;
 *  - pillars: dark, dusty columns in front of glowing background gas;
 *  - barrel: a thick ring seen nearly pole-on with gas filling a lobe along
 *    the line of sight (Ring, Helix, Southern Ring);
 *  - bipolar: two lobes along an axis in the sky (Butterfly, Homunculus);
 *  - sheet: a cloud edge: dust in front, glowing gas behind.
 *
 * Galaxies (extragalactic.ts), centred on the image anchor:
 *  - disc: a spiral seen at inclination incDeg, its major axis at majorDeg
 *    in the picture (CCW from +x, y up). The picture is sheared back onto
 *    the tilted disc plane (deprojected), so from Earth's side it is the
 *    photograph and from elsewhere a disc; thickness grows in the bulge;
 *  - edge: an edge-on disc: light spread along the line of sight over the
 *    disc's depth at each point of the major axis, plus a round bulge;
 *  - ellipsoid: an elliptical galaxy or a round body of stars;
 *  - flat: a thin sheet (groups, fields, quasar hosts).
 * `extent` (image widths, deprojected) masks out what lies beyond the
 * galaxy: foreground Milky Way stars and sky in the photo.
 */
export type DepthSpec =
  | { model: 'shell'; a: number; b: number; angleDeg: number; depth: number; interiorBlue?: boolean }
  | { model: 'bowl'; cx: number; cy: number; deep: number; curvature: number }
  | { model: 'pillars' }
  | { model: 'barrel'; a: number; b: number; angleDeg: number; lobe: number }
  | { model: 'bipolar'; axisDeg: number; waist: number; flare: number }
  | { model: 'sheet' }
  | { model: 'disc'; incDeg: number; majorDeg: number; bulge: number; thick: number; extent: number }
  | { model: 'edge'; majorDeg: number; length: number; bulge: number }
  | { model: 'ellipsoid'; radius: number; depth: number; extent: number }
  | { model: 'flat'; depth: number };

export interface PulsarSpin {
  /** Image position (fraction, y down) when inside a nebula. */
  at?: readonly [number, number];
  positionAngleDeg: number;
  inclinationDeg: number;
  magneticDeg: number;
  periodS: number;
  /** Shown slowed down: seconds per turn on screen. */
  shownPeriodS: number;
  beamLengthPc: number;
}

export interface NebulaDef extends Base {
  kind: 'nebula';
  /** Texture id: public/textures/<folder>/<image>_1k.jpg and _4k.jpg. */
  image: string;
  /** Texture folder (default 'deepsky'). */
  folder?: string;
  /**
   * Image point (fractions, y down) placed at RA/Dec and used as the centre
   * of the galaxy depth models (default: the image centre).
   */
  anchor?: readonly [number, number];
  /** Particle count for the off-axis view (default 32 000). */
  particles?: number;
  /** Particle size (fraction of the width, default 1/90) and brightness (default 0.1). */
  particleSize?: number;
  particleGain?: number;
  /** Drawn within this many picture widths of the camera (default 1500). */
  visibleWidths?: number;
  /** Image aspect (width / height). */
  aspect: number;
  /** Image width on the sky at the object's distance (pc). */
  widthPc: number;
  depth: DepthSpec;
  brightness: number;
  /** Optional central star (image fraction, y down). */
  core?: { at: readonly [number, number]; color: readonly [number, number, number]; label?: string };
  /** A pulsar inside (Crab). */
  pulsar?: PulsarSpin;
}

export interface StarDef {
  name: string;
  radiusSun: number;
  tempK: number;
  massSun: number;
  /** Rendered as a black hole (lensing) instead of a star. */
  blackHole?: boolean;
  /** Neutron star (pulsar) with beams. */
  pulsar?: PulsarSpin;
}

/** Relative orbit of star 2 around star 1 (visual-binary elements). */
export interface BinaryOrbit {
  aAu: number;
  e: number;
  iDeg: number;
  OmegaDeg: number;
  omegaDeg: number;
  periodYears: number;
  /** Periastron epoch (decimal year). */
  tP: number;
}

export interface PlanetDef {
  name: string;
  aAu: number;
  periodDays: number;
  radiusEarth: number;
  color: readonly [number, number, number];
  note?: string;
}

export interface SystemDef extends Base {
  kind: 'system';
  stars: readonly StarDef[];
  orbit?: BinaryOrbit;
  planets?: readonly PlanetDef[];
  /** Planet orbits' inclination to the sky (deg; ~90 = edge-on). */
  planetInclinationDeg?: number;
  /** Accretion disc + gas stream from star 2 onto star 1 (X-ray binary). */
  accretion?: { outerAu: number };
  /** Boiling, giant-cell surface. */
  supergiant?: boolean;
}

export interface PulsarDef extends Base {
  kind: 'pulsar';
  spin: PulsarSpin;
  /** A glowing wind nebula around it (pc). */
  windNebulaPc?: number;
  magnetar?: boolean;
}

export interface ClusterDef extends Base {
  kind: 'cluster';
  /** Plummer scale radius (pc) and particle count. */
  scalePc: number;
  stars: number;
  globular: boolean;
  /** Named members (RA, Dec, colour) for open clusters. */
  members?: readonly { name: string; ra: number; dec: number; color: readonly [number, number, number] }[];
  /** Central black hole mass (suns). */
  blackHoleMassSun?: number;
  reflectionNebula?: boolean;
}

export type DeepDef = NebulaDef | SystemDef | PulsarDef | ClusterDef;

/** Sgr A*: mass 4.3 million suns (GRAVITY 2019). */
export const SGR_A_MASS_SUN = 4.297e6;
/** 2GM/c² for one solar mass, km. */
export const RS_KM_PER_SUN = 2.953;
export const AU_PER_PC = 206_264.806;
export const SUN_RADIUS_AU = 0.004_650_47;
export const EARTH_RADIUS_AU = 4.263_5e-5;

/**
 * S-stars around Sgr A* (Gillessen et al. 2017, ApJ 837, 30; S2 from
 * GRAVITY 2018). a in arcsec at R0, angles in degrees, tP and P in years.
 */
export interface SStar {
  id: string;
  a: number;
  e: number;
  i: number;
  Omega: number;
  omega: number;
  tP: number;
  P: number;
}

export const S_STARS: readonly SStar[] = [
  { id: 'S2', a: 0.1255, e: 0.8839, i: 134.18, Omega: 226.94, omega: 65.51, tP: 2018.38, P: 16.05 },
  { id: 'S1', a: 0.595, e: 0.556, i: 119.14, Omega: 342.04, omega: 122.3, tP: 2001.8, P: 166 },
  { id: 'S8', a: 0.404, e: 0.803, i: 74.37, Omega: 315.43, omega: 346.7, tP: 1983.64, P: 92.9 },
  { id: 'S12', a: 0.299, e: 0.888, i: 33.56, Omega: 230.1, omega: 317.9, tP: 1995.59, P: 58.9 },
  { id: 'S13', a: 0.264, e: 0.425, i: 24.7, Omega: 74.5, omega: 245.2, tP: 2004.86, P: 49 },
  { id: 'S14', a: 0.256, e: 0.976, i: 100.59, Omega: 226.38, omega: 334.59, tP: 2000.12, P: 47.3 },
];

/**
 * Orbits in the galaxy view (S-stars, binaries) run sped up by this many
 * days per real second: slow enough to follow S2 through its periapsis.
 * Fast systems (planets, X-ray binaries) use their own slower rates.
 */
export const DEEP_DAYS_PER_SECOND = 5;

const AU = 1 / AU_PER_PC;

export const DEEP_SKY: readonly DeepDef[] = [
  // ---- Black holes ------------------------------------------------------------------------
  {
    kind: 'system',
    id: 'cygx1',
    name: 'Cygnus X-1',
    short: 'Cygnus X-1',
    category: 'blackhole',
    ra: 299.5903,
    dec: 35.2016,
    distPc: 2220,
    framePc: 1.1 * AU,
    stars: [
      { name: 'Kara delik', radiusSun: 0, tempK: 0, massSun: 21.2, blackHole: true },
      { name: 'HDE 226868', radiusSun: 22.3, tempK: 31_000, massSun: 40.6 },
    ],
    // Miller-Jones et al. 2021.
    orbit: { aAu: 0.244, e: 0.018, iDeg: 27.5, OmegaDeg: 0, omegaDeg: 0, periodYears: 5.5998 / 365.25, tP: 2026 },
    accretion: { outerAu: 0.05 },
    facts: {
      type: 'Yıldız kütleli kara delik + mavi süperdev',
      stats: [
        ['Kara delik', '21 Güneş kütlesi'],
        ['Eşi', '41 Güneş kütlesi, mavi süperdev'],
        ['Yörünge', '5,6 gün'],
      ],
      text: 'Varlığı kabul edilen ilk kara delik. Dev eşinden kopardığı gaz, kara deliğin çevresinde milyonlarca dereceye ısınıp X ışınıyla parlıyor.',
      didYouKnow: "Stephen Hawking, 1974'te Cygnus X-1'in kara delik olmadığına dair Kip Thorne ile bahse girdi; 1990'da kaybettiğini kabul etti.",
    },
  },
  {
    kind: 'system',
    id: 'gaiabh3',
    name: 'Gaia BH3',
    short: 'Gaia BH3',
    category: 'blackhole',
    ra: 294.828,
    dec: 14.932,
    distPc: 590,
    framePc: 70 * AU,
    stars: [
      { name: 'Kara delik', radiusSun: 0, tempK: 0, massSun: 32.7, blackHole: true },
      { name: 'Dev eş', radiusSun: 4.9, tempK: 5212, massSun: 0.76 },
    ],
    // Gaia Collaboration 2024.
    orbit: { aAu: 16.17, e: 0.7291, iDeg: 110.6, OmegaDeg: 136.3, omegaDeg: 77.3, periodYears: 11.6, tP: 2018.0 },
    facts: {
      type: 'Uyuyan kara delik',
      stats: [
        ['Kütle', '33 Güneş kütlesi'],
        ['Keşif', '2024, Gaia uydusu'],
        ['Yörünge', '11,6 yıl'],
      ],
      text: "Samanyolu'nda bilinen en büyük yıldız kütleli kara delik. Çevresinde gaz olmadığı için hiç ışımıyor; yalnızca eşi olan yıldızı salınıma sokmasından bulundu.",
      didYouKnow: "Dünya'ya yalnızca 1.900 ışık yılı uzaklıkta.",
    },
  },

  // ---- Pulsars --------------------------------------------------------------------------------
  {
    kind: 'pulsar',
    id: 'vela',
    name: 'Vela Pulsarı',
    short: 'Vela Pulsarı',
    category: 'pulsar',
    ra: 128.8359,
    dec: -45.1764,
    distPc: 287,
    framePc: 0.05,
    spin: { positionAngleDeg: 130, inclinationDeg: 64, magneticDeg: 45, periodS: 0.0893, shownPeriodS: 2.2, beamLengthPc: 0.03 },
    windNebulaPc: 0.012,
    facts: {
      type: 'Pulsar (dönen nötron yıldızı)',
      stats: [
        ['Dönüş', 'saniyede 11 tur'],
        ['Yaş', '~11.000 yıl'],
        ['Çap', '~20 km'],
      ],
      text: "Gökyüzünün en parlak radyo pulsarlarından. Arada bir aniden hızlanır ('sıçrama'); bu, nötron yıldızının içindeki süperakışkan maddeyi incelemenin tek yolu.",
      didYouKnow: "Bir çay kaşığı nötron yıldızı maddesi Dünya'da yaklaşık bir milyar ton gelirdi.",
    },
  },
  {
    kind: 'pulsar',
    id: 'psrb1919',
    name: 'PSR B1919+21',
    short: 'İlk pulsar',
    category: 'pulsar',
    ra: 290.4366,
    dec: 21.8836,
    distPc: 300,
    framePc: 0.05,
    spin: { positionAngleDeg: 20, inclinationDeg: 70, magneticDeg: 50, periodS: 1.3373, shownPeriodS: 1.3373, beamLengthPc: 0.03 },
    facts: {
      type: 'Keşfedilen ilk pulsar',
      stats: [
        ['Dönüş', '1,34 saniyede bir tur'],
        ['Keşif', '1967, Jocelyn Bell Burnell'],
      ],
      text: 'Düzenli radyo atımları o kadar şaşırtıcıydı ki ilk başta yarı şaka "LGM-1" (Küçük Yeşil Adamlar) diye adlandırıldı. Gerçekte dönen bir nötron yıldızıydı.',
      didYouKnow: "Joy Division'ın 'Unknown Pleasures' albüm kapağındaki çizgiler bu pulsarın atımlarıdır.",
    },
  },
  {
    kind: 'system',
    id: 'doublepulsar',
    name: 'Çift Pulsar (PSR J0737−3039)',
    short: 'Çift Pulsar',
    category: 'pulsar',
    ra: 114.4636,
    dec: -30.6614,
    distPc: 735,
    framePc: 0.03 * AU,
    stars: [
      { name: 'Pulsar A', radiusSun: 0, tempK: 0, massSun: 1.338, pulsar: { positionAngleDeg: 0, inclinationDeg: 89, magneticDeg: 60, periodS: 0.0227, shownPeriodS: 0.8, beamLengthPc: 0.02 * AU } },
      { name: 'Pulsar B', radiusSun: 0, tempK: 0, massSun: 1.249, pulsar: { positionAngleDeg: 60, inclinationDeg: 40, magneticDeg: 70, periodS: 2.773, shownPeriodS: 2.8, beamLengthPc: 0.02 * AU } },
    ],
    // Kramer et al. 2021.
    orbit: { aAu: 0.0059, e: 0.0878, iDeg: 89.35, OmegaDeg: 0, omegaDeg: 0, periodYears: 0.1023 / 365.25, tP: 2026 },
    facts: {
      type: 'İki pulsarlı tek sistem',
      stats: [
        ['Yörünge', '2,45 saat'],
        ['Ayrılık', '~900.000 km'],
        ['Birleşme', '~85 milyon yıl sonra'],
      ],
      text: "Bilinen tek çift pulsar. Birbirinin etrafında o kadar hızlı dönüyorlar ki kütleçekim dalgalarıyla enerji kaybedip yaklaşıyorlar; Einstein'ın öngörüsü %0,01 hassasiyetle doğrulandı.",
    },
  },
  {
    kind: 'pulsar',
    id: 'sgr1806',
    name: 'SGR 1806−20 (magnetar)',
    short: 'Magnetar',
    category: 'pulsar',
    ra: 272.1638,
    dec: -20.411,
    distPc: 8700,
    framePc: 0.05,
    magnetar: true,
    spin: { positionAngleDeg: 40, inclinationDeg: 50, magneticDeg: 30, periodS: 7.6, shownPeriodS: 7.6, beamLengthPc: 0.02 },
    facts: {
      type: 'Magnetar',
      stats: [
        ['Manyetik alan', "Dünya'nınkinin ~10 trilyon katı"],
        ['Dönüş', '7,6 saniyede bir tur'],
      ],
      text: "Evrendeki en güçlü mıknatıslardan. 27 Aralık 2004'teki dev patlamasında 0,2 saniyede Güneş'in 150.000 yılda yaydığı enerjiyi saldı.",
      didYouKnow: "50.000 ışık yılı uzaktan gelen o patlama Dünya'nın üst atmosferini ölçülebilir biçimde etkiledi.",
    },
  },

  // ---- Nebulae --------------------------------------------------------------------------------
  {
    kind: 'nebula',
    id: 'crab',
    name: 'Yengeç Bulutsusu ve Pulsarı',
    short: 'Yengeç Bulutsusu',
    category: 'nebula',
    ra: 83.633,
    dec: 22.0145,
    distPc: 2000,
    framePc: 8,
    image: 'crab',
    aspect: 1,
    widthPc: 4.6,
    depth: { model: 'shell', a: 0.46, b: 0.33, angleDeg: -20, depth: 0.3, interiorBlue: true },
    brightness: 1,
    pulsar: {
      at: [0.52, 0.51],
      // Ng & Romani 2004: spin axis position angle and inclination.
      positionAngleDeg: 124,
      inclinationDeg: 61,
      magneticDeg: 55,
      periodS: 0.0337,
      shownPeriodS: 1.6,
      beamLengthPc: 1.3,
    },
    facts: {
      type: 'Süpernova kalıntısı + pulsar',
      stats: [
        ['Patlama', '1054 yılı'],
        ['Boyut', '~11 ışık yılı'],
        ['Pulsar', 'saniyede 30 tur'],
      ],
      text: "1054'te Çinli gökbilimcilerin gündüz bile gördüğü süpernovanın kalıntısı. Merkezdeki pulsar, bulutsunun mavi ışıltısını besleyen enerji kaynağı.",
      didYouKnow: 'Bulutsu hâlâ saniyede 1.500 km hızla genişliyor.',
    },
  },
  {
    kind: 'nebula',
    id: 'orion',
    name: 'Orion Bulutsusu (M42)',
    short: 'Orion Bulutsusu',
    category: 'nebula',
    ra: 83.822,
    dec: -5.391,
    distPc: 412,
    framePc: 13,
    image: 'orion',
    aspect: 1,
    widthPc: 7.3,
    depth: { model: 'bowl', cx: 0.07, cy: 0.02, deep: 0.055, curvature: 0.23 },
    brightness: 1,
    facts: {
      type: 'Yıldız doğum bölgesi',
      stats: [
        ['Boyut', '~24 ışık yılı'],
        ['Yıldız', '~2.000 genç yıldız'],
      ],
      text: "Bize en yakın büyük yıldız doğum bölgesi; çıplak gözle Avcı'nın kılıcında bulanık bir leke olarak görünür. Trapez yıldızlarının ışığı arkadaki gaz çanağını oyarak parlatıyor.",
      didYouKnow: 'Hubble burada oluşmakta olan gezegen sistemlerini (proplidleri) ilk kez fotoğrafladı.',
    },
  },
  {
    kind: 'nebula',
    id: 'pillars',
    name: 'Yaratılış Sütunları (M16)',
    short: 'Yaratılış Sütunları',
    category: 'nebula',
    ra: 274.7,
    dec: -13.8,
    distPc: 1740,
    framePc: 3.2,
    image: 'pillars',
    aspect: 2365 / 4096,
    widthPc: 1.3,
    depth: { model: 'pillars' },
    brightness: 1,
    facts: {
      type: 'Gaz ve toz sütunları',
      stats: [
        ['Boy', '~4 ışık yılı'],
        ['Görüntü', 'Webb, 2022'],
      ],
      text: "Kartal Bulutsusu'ndaki soğuk gaz ve toz sütunları. İçlerinde yeni yıldızlar doğuyor; yakındaki sıcak yıldızların ışığı onları yavaşça aşındırıyor.",
      didYouKnow: 'Sütunların uçlarındaki kırmızı lekeler, gazını hâlâ dışarı püskürten bebek yıldızlar.',
    },
  },
  {
    kind: 'nebula',
    id: 'carina',
    name: 'Kozmik Uçurumlar (Karina, NGC 3324)',
    short: 'Kozmik Uçurumlar',
    category: 'nebula',
    ra: 159.33,
    dec: -58.633,
    distPc: 2350,
    framePc: 9,
    image: 'carina',
    aspect: 3840 / 2224,
    widthPc: 5.5,
    depth: { model: 'sheet' },
    brightness: 1,
    facts: {
      type: 'Yıldız doğum bölgesinin kenarı',
      stats: [
        ['Uçurum yüksekliği', '~7 ışık yılı'],
        ['Görüntü', "Webb'in ilk görüntülerinden, 2022"],
      ],
      text: "Karina Bulutsusu'ndaki dev bir gaz boşluğunun kenarı. Yukarıdaki sıcak yıldızların ışığı ve rüzgârı tozu oyup bu 'dağ sırasını' şekillendirdi.",
    },
  },
  {
    kind: 'nebula',
    id: 'lagoon',
    name: 'Lagün Bulutsusu (M8)',
    short: 'Lagün Bulutsusu',
    category: 'nebula',
    ra: 270.904,
    dec: -24.383,
    distPc: 1250,
    framePc: 2.4,
    image: 'lagoon',
    aspect: 3481 / 4097,
    widthPc: 1.3,
    depth: { model: 'sheet' },
    brightness: 1,
    facts: {
      type: 'Yıldız doğum bölgesi',
      stats: [
        ['Bulutsu', '~55 × 20 ışık yılı'],
        ['Görüntü', "Hubble'ın 28. yaşı, 2018"],
      ],
      text: "Görüntünün merkezindeki dev yıldız Herschel 36'nın ışığı ve rüzgârı çevresindeki gazı oyup kıvrımlı kuleler hâline getiriyor.",
    },
  },
  {
    kind: 'nebula',
    id: 'trifid',
    name: 'Üç Boğumlu Bulutsu (M20)',
    short: 'Trifid Bulutsusu',
    category: 'nebula',
    ra: 270.596,
    dec: -23.03,
    distPc: 1260,
    framePc: 2.2,
    image: 'trifid',
    aspect: 3840 / 3717,
    widthPc: 1.2,
    depth: { model: 'pillars' },
    brightness: 1,
    facts: {
      type: 'Yıldız doğum bölgesi',
      stats: [['Görüntü', 'Hubble']],
      text: 'Kırmızı salma bulutsusu, mavi yansıma bulutsusu ve koyu toz şeritleri bir arada. Görüntüdeki sütunun ucundan genç bir yıldızın jeti fışkırıyor.',
    },
  },
  {
    kind: 'nebula',
    id: 'horsehead',
    name: 'Atbaşı Bulutsusu',
    short: 'Atbaşı Bulutsusu',
    category: 'nebula',
    ra: 85.245,
    dec: -2.458,
    distPc: 420,
    framePc: 1.4,
    image: 'horsehead',
    aspect: 2839 / 2065,
    widthPc: 0.75,
    depth: { model: 'pillars' },
    brightness: 0.8,
    facts: {
      type: 'Karanlık bulutsu',
      stats: [
        ['Baş', '~3,5 ışık yılı'],
        ['Görüntü', 'Hubble kızılötesi, 2013'],
      ],
      text: 'Arkadaki parlak gazın önünde siluet olarak görünen soğuk toz bulutu. Kızılötesinde içi görünür hâle gelir; yaklaşık 5 milyon yıl içinde dağılıp kaybolacak.',
    },
  },
  {
    kind: 'nebula',
    id: 'westerlund2',
    name: 'Westerlund 2',
    short: 'Westerlund 2',
    category: 'nebula',
    ra: 156.0042,
    dec: -57.7639,
    distPc: 4200,
    framePc: 20,
    image: 'westerlund2',
    aspect: 3840 / 2877,
    widthPc: 12,
    depth: { model: 'bowl', cx: 0.1, cy: 0.08, deep: 0.05, curvature: 0.3 },
    brightness: 1,
    facts: {
      type: 'Genç dev yıldız kümesi',
      stats: [
        ['Yaş', '~2 milyon yıl'],
        ['Yıldız', '~3.000'],
        ['Görüntü', "Hubble'ın 25. yaşı, 2015"],
      ],
      text: 'Galaksimizin en sıcak ve en ağır yıldızlarından bazılarını barındıran genç küme. Yıldızların ışığı çevrelerindeki gazı oyarak dev bir boşluk açıyor.',
    },
  },
  {
    kind: 'nebula',
    id: 'ring',
    name: 'Halka Bulutsusu (M57)',
    short: 'Halka Bulutsusu',
    category: 'nebula',
    ra: 283.396,
    dec: 33.029,
    distPc: 790,
    framePc: 1.3,
    image: 'ring',
    aspect: 3840 / 3895,
    widthPc: 0.73,
    depth: { model: 'barrel', a: 0.28, b: 0.22, angleDeg: 30, lobe: 0.5 },
    brightness: 1,
    core: { at: [0.5, 0.5], color: [0.85, 0.9, 1] },
    facts: {
      type: 'Gezegenimsi bulutsu',
      stats: [
        ['Boyut', '~1,3 ışık yılı'],
        ['Yaş', '~4.000 yıl'],
        ['Görüntü', 'Webb, 2023'],
      ],
      text: 'Güneş benzeri bir yıldızın ölürken dışarı attığı gaz. Halka aslında bize ucundan bakan bir fıçı; ortadaki beyaz cüce, yıldızdan geriye kalan sıcak çekirdek.',
      didYouKnow: 'Güneş de yaklaşık 5 milyar yıl sonra buna benzer bir bulutsu bırakacak.',
    },
  },
  {
    kind: 'nebula',
    id: 'southernring',
    name: 'Güney Halka Bulutsusu (NGC 3132)',
    short: 'Güney Halka',
    category: 'nebula',
    ra: 151.7571,
    dec: -40.4365,
    distPc: 760,
    framePc: 0.5,
    image: 'southernring',
    aspect: 3840 / 3576,
    widthPc: 0.27,
    depth: { model: 'barrel', a: 0.26, b: 0.17, angleDeg: 20, lobe: 0.45 },
    brightness: 1,
    core: { at: [0.47, 0.49], color: [1, 0.92, 0.8] },
    facts: {
      type: 'Gezegenimsi bulutsu',
      stats: [
        ['Boyut', '~0,5 ışık yılı'],
        ['Görüntü', "Webb'in ilk görüntülerinden, 2022"],
      ],
      text: 'Webb, merkezde iki yıldız olduğunu gösterdi: parlak olanın yanında, bulutsuyu asıl yaratan sönük ve tozlu bir beyaz cüce saklanıyor.',
    },
  },
  {
    kind: 'nebula',
    id: 'helix',
    name: 'Sarmal Bulutsu (NGC 7293)',
    short: 'Sarmal Bulutsu',
    category: 'nebula',
    ra: 337.4108,
    dec: -20.8372,
    distPc: 200,
    framePc: 2.4,
    image: 'helix',
    aspect: 3800 / 4096,
    widthPc: 1.4,
    depth: { model: 'barrel', a: 0.3, b: 0.27, angleDeg: 0, lobe: 0.4 },
    brightness: 1,
    core: { at: [0.5, 0.5], color: [0.85, 0.9, 1] },
    facts: {
      type: 'Gezegenimsi bulutsu',
      stats: [
        ['Boyut', '~2,5 ışık yılı'],
        ['Lakabı', "Tanrı'nın Gözü"],
      ],
      text: 'Bize en yakın gezegenimsi bulutsulardan. Halkanın iç kenarındaki binlerce kuyruklu yıldız benzeri gaz düğümü, sıcak rüzgârın soğuk gazı yontmasıyla oluştu.',
    },
  },
  {
    kind: 'nebula',
    id: 'catseye',
    name: 'Kedi Gözü Bulutsusu (NGC 6543)',
    short: 'Kedi Gözü',
    category: 'nebula',
    ra: 269.6391,
    dec: 66.6331,
    distPc: 1000,
    framePc: 0.22,
    image: 'catseye',
    aspect: 1,
    widthPc: 0.12,
    depth: { model: 'shell', a: 0.36, b: 0.42, angleDeg: 0, depth: 0.32 },
    brightness: 1,
    core: { at: [0.5, 0.49], color: [0.85, 0.9, 1] },
    facts: {
      type: 'Gezegenimsi bulutsu',
      stats: [
        ['Yaş', '~1.000 yıl'],
        ['Görüntü', 'Hubble'],
      ],
      text: 'Bilinen en karmaşık gezegenimsi bulutsulardan: iç içe kabuklar, jetler ve düğümler. Merkezdeki yıldızın bir eşi olabileceği düşünülüyor.',
    },
  },
  {
    kind: 'nebula',
    id: 'butterfly',
    name: 'Kelebek Bulutsusu (NGC 6302)',
    short: 'Kelebek Bulutsusu',
    category: 'nebula',
    ra: 258.4349,
    dec: -37.1031,
    distPc: 1040,
    framePc: 1.1,
    image: 'butterfly',
    aspect: 3515 / 4096,
    widthPc: 0.6,
    depth: { model: 'bipolar', axisDeg: 62, waist: 0.03, flare: 0.45 },
    brightness: 1,
    facts: {
      type: 'Gezegenimsi bulutsu',
      stats: [
        ['Kanat açıklığı', '~3 ışık yılı'],
        ['Merkez yıldız', '~250.000 °C'],
      ],
      text: 'Ölen bir yıldızın gazı, belindeki kalın toz halkası yüzünden iki yana fışkırarak kanatları oluşturdu. Merkezdeki yıldız bilinen en sıcak yıldızlardan.',
    },
  },
  {
    kind: 'nebula',
    id: 'etacar',
    name: 'Eta Karina ve Homunculus',
    short: 'Eta Karina',
    category: 'nebula',
    ra: 161.2648,
    dec: -59.6844,
    distPc: 2300,
    framePc: 0.55,
    image: 'etacar',
    aspect: 1,
    widthPc: 0.3,
    depth: { model: 'bipolar', axisDeg: 35, waist: 0.02, flare: 0.5 },
    brightness: 0.9,
    core: { at: [0.53, 0.47], color: [1, 0.95, 0.85], label: 'Eta Karina A+B' },
    facts: {
      type: 'Patlamaya hazır dev yıldız çifti',
      stats: [
        ['Kütle', '~100 + 30 Güneş kütlesi'],
        ['Büyük Patlama', '1843'],
      ],
      text: "1843'teki 'Büyük Patlama'da Sirius'tan sonra gökyüzünün en parlak ikinci yıldızı oldu ve bu çift loblu Homunculus bulutsusunu saçtı. Bir gün süpernova olarak patlayacak.",
    },
  },
  {
    kind: 'nebula',
    id: 'casa',
    name: 'Cassiopeia A',
    short: 'Cassiopeia A',
    category: 'nebula',
    ra: 350.85,
    dec: 58.815,
    distPc: 3400,
    framePc: 9,
    image: 'casa',
    aspect: 1,
    widthPc: 5.5,
    depth: { model: 'shell', a: 0.34, b: 0.34, angleDeg: 0, depth: 0.32 },
    brightness: 1,
    core: { at: [0.5, 0.5], color: [0.7, 0.8, 1], label: 'Nötron yıldızı' },
    facts: {
      type: 'Süpernova kalıntısı',
      stats: [
        ['Patlama', '~1680'],
        ['Boyut', '~10 ışık yılı'],
        ['Görüntü', 'Webb MIRI, 2023'],
      ],
      text: "Samanyolu'ndaki en genç süpernova kalıntılarından. Patlayan yıldızın kalıntıları hâlâ saniyede 5.000 km hızla genişliyor; merkezde bir nötron yıldızı kaldı.",
    },
  },
  {
    kind: 'nebula',
    id: 'veil',
    name: 'Kuğu İlmeği (Peçe Bulutsusu)',
    short: 'Peçe Bulutsusu',
    category: 'nebula',
    ra: 312.75,
    dec: 30.67,
    distPc: 735,
    framePc: 70,
    image: 'veil',
    aspect: 3840 / 3333,
    widthPc: 45,
    depth: { model: 'shell', a: 0.38, b: 0.42, angleDeg: 0, depth: 0.35 },
    brightness: 1,
    facts: {
      type: 'Süpernova kalıntısı',
      stats: [
        ['Patlama', '~10.000–20.000 yıl önce'],
        ['Çap', '~120 ışık yılı'],
        ['Görüntü', 'GALEX morötesi'],
      ],
      text: 'Eski bir süpernovanın genişleyen şok dalgası. Gökyüzünde dolunayın altı katı genişliğinde bir çember çiziyor.',
    },
  },

  // ---- Star systems ---------------------------------------------------------------------------
  {
    kind: 'system',
    id: 'alphacen',
    name: 'Alfa Centauri A ve B',
    short: 'Alfa Centauri',
    category: 'system',
    ra: 219.9,
    dec: -60.835,
    distPc: 1.347,
    framePc: 80 * AU,
    stars: [
      { name: 'Alfa Centauri A', radiusSun: 1.2234, tempK: 5790, massSun: 1.0788 },
      { name: 'Alfa Centauri B', radiusSun: 0.8632, tempK: 5260, massSun: 0.9092 },
    ],
    // Pourbaix & Boffin 2016.
    orbit: { aAu: 23.4, e: 0.5179, iDeg: 79.32, OmegaDeg: 205.07, omegaDeg: 232.3, periodYears: 79.91, tP: 1955.66 },
    facts: {
      type: 'Çift yıldız',
      stats: [
        ['Yörünge', '80 yıl'],
        ['Ayrılık', '11–35 AU'],
      ],
      text: "Güneş'e en yakın yıldız sistemi. Biri Güneş'ten biraz büyük, diğeri biraz küçük iki yıldız birbirinin etrafında dönüyor; üçüncü üye Proxima çok uzaktan onlara eşlik ediyor.",
      didYouKnow: 'Bugünkü en hızlı uzay aracıyla bile oraya varmak binlerce yıl sürer.',
    },
  },
  {
    kind: 'system',
    id: 'proxima',
    name: 'Proxima Centauri',
    short: 'Proxima Centauri',
    category: 'system',
    ra: 217.4289,
    dec: -62.6795,
    distPc: 1.302,
    framePc: 0.14 * AU,
    stars: [{ name: 'Proxima Centauri', radiusSun: 0.1542, tempK: 3042, massSun: 0.1221 }],
    planets: [
      { name: 'Proxima d', aAu: 0.02885, periodDays: 5.122, radiusEarth: 0.81, color: [0.55, 0.45, 0.4] },
      { name: 'Proxima b', aAu: 0.04857, periodDays: 11.186, radiusEarth: 1.07, color: [0.62, 0.48, 0.38], note: 'yaşanabilir bölgede' },
    ],
    planetInclinationDeg: 60,
    facts: {
      type: 'Kırmızı cüce + gezegenler',
      stats: [
        ['Konum', "Güneş'e en yakın yıldız"],
        ['Proxima b', 'yaşanabilir bölgede'],
      ],
      text: "Güneş'e en yakın yıldız. Çevresinde Dünya kütlesinde bir gezegen, Proxima b, sıvı suyun var olabileceği sıcaklık bölgesinde dönüyor.",
      didYouKnow: 'Proxima sık sık güçlü patlamalar yapar; gezegenin atmosferini koruyup koruyamadığı bilinmiyor.',
    },
  },
  {
    kind: 'system',
    id: 'sirius',
    name: 'Sirius A ve B',
    short: 'Sirius',
    category: 'system',
    ra: 101.2872,
    dec: -16.7161,
    distPc: 2.64,
    framePc: 65 * AU,
    stars: [
      { name: 'Sirius A', radiusSun: 1.711, tempK: 9940, massSun: 2.063 },
      { name: 'Sirius B (beyaz cüce)', radiusSun: 0.0084, tempK: 25_000, massSun: 1.018 },
    ],
    // Bond et al. 2017.
    orbit: { aAu: 19.8, e: 0.5923, iDeg: 136.3, OmegaDeg: 45.4, omegaDeg: 149.2, periodYears: 50.13, tP: 1994.57 },
    facts: {
      type: 'Çift yıldız (yıldız + beyaz cüce)',
      stats: [
        ['Parlaklık', 'gece gökyüzünün en parlak yıldızı'],
        ['Yörünge', '50 yıl'],
      ],
      text: "Sirius A'nın küçük eşi Sirius B, Dünya büyüklüğünde ama Güneş kütlesinde bir beyaz cüce: bir yıldızın ölümünden geriye kalan sıcak çekirdek.",
      didYouKnow: "Sirius B'nin varlığı 1844'te Sirius'un yalpalamasından tahmin edildi; ancak 1862'de görülebildi.",
    },
  },
  {
    kind: 'system',
    id: 'trappist1',
    name: 'TRAPPIST-1',
    short: 'TRAPPIST-1',
    category: 'system',
    ra: 346.6222,
    dec: -5.0414,
    distPc: 12.43,
    framePc: 0.17 * AU,
    stars: [{ name: 'TRAPPIST-1', radiusSun: 0.1192, tempK: 2566, massSun: 0.0898 }],
    // Agol et al. 2021.
    planets: [
      { name: 'b', aAu: 0.01154, periodDays: 1.511, radiusEarth: 1.116, color: [0.6, 0.45, 0.35] },
      { name: 'c', aAu: 0.0158, periodDays: 2.422, radiusEarth: 1.097, color: [0.65, 0.55, 0.45] },
      { name: 'd', aAu: 0.02227, periodDays: 4.05, radiusEarth: 0.788, color: [0.55, 0.6, 0.7] },
      { name: 'e', aAu: 0.02925, periodDays: 6.1, radiusEarth: 0.92, color: [0.4, 0.55, 0.75], note: 'yaşanabilir bölgede' },
      { name: 'f', aAu: 0.03849, periodDays: 9.207, radiusEarth: 1.045, color: [0.55, 0.7, 0.8], note: 'yaşanabilir bölgede' },
      { name: 'g', aAu: 0.04683, periodDays: 12.353, radiusEarth: 1.129, color: [0.7, 0.75, 0.85], note: 'yaşanabilir bölgede' },
      { name: 'h', aAu: 0.06189, periodDays: 18.767, radiusEarth: 0.755, color: [0.8, 0.82, 0.88] },
    ],
    planetInclinationDeg: 80,
    facts: {
      type: 'Kırmızı cüce + 7 gezegen',
      stats: [
        ['Gezegen', '7 Dünya boyutunda'],
        ['Yaşanabilir bölge', '3 gezegen'],
      ],
      text: "Jüpiter'den biraz büyük soğuk bir yıldızın çevresinde yedi kayalık gezegen. Hepsi Merkür'ün Güneş'e uzaklığından çok daha yakın; bir gezegenin yüzeyinden ötekiler Ay'dan büyük görünür.",
      didYouKnow: 'Gezegenlerin yörünge süreleri neredeyse tam sayı oranlarında; bir müzik akoru gibi uyumlular.',
    },
  },
  {
    kind: 'system',
    id: 'betelgeuse',
    name: 'Betelgeuse',
    short: 'Betelgeuse',
    category: 'system',
    ra: 88.7929,
    dec: 7.4071,
    distPc: 168,
    framePc: 16 * AU,
    stars: [{ name: 'Betelgeuse', radiusSun: 764, tempK: 3600, massSun: 18 }],
    supergiant: true,
    facts: {
      type: 'Kırmızı süperdev',
      stats: [
        ['Yarıçap', "Güneş'in ~760 katı"],
        ['Yaş', '~10 milyon yıl'],
      ],
      text: "Güneş'in yerine konsa Mars'ın yörüngesine kadar her şeyi yutardı. Yüzeyi dev konveksiyon hücreleriyle kaynıyor; ömrünün sonunda süpernova olarak patlayacak.",
      didYouKnow: "2019–2020'deki 'Büyük Kararma'da parlaklığı üçte ikisine düştü; yüzeyinden kopan bir toz bulutu yüzündendi.",
    },
  },

  // ---- Giant stars ------------------------------------------------------------------------------
  {
    kind: 'system',
    id: 'uyscuti',
    name: 'UY Scuti',
    short: 'UY Scuti',
    category: 'giant',
    ra: 276.902,
    dec: -12.4664,
    distPc: 2900,
    framePc: 22 * AU,
    stars: [{ name: 'UY Scuti', radiusSun: 909, tempK: 3365, massSun: 8 }],
    supergiant: true,
    facts: {
      type: 'Kırmızı süperdev',
      stats: [
        ['Yarıçap', "Güneş'in ~900 katı (Gaia DR3)"],
        ['Sıcaklık', '~3.400 K'],
        ['Parlaklık', "Güneş'in ~100.000 katı"],
      ],
      text: "Bilinen en büyük yıldızlardan. Güneş'in yerinde olsa Jüpiter'in yörüngesine yaklaşırdı; içine yaklaşık 5 milyar Güneş sığardı. Kütlesi ise yalnızca birkaç Güneş kadar: çok seyrek, şişkin bir gaz küresi.",
      didYouKnow: "Işığın UY Scuti'nin çevresini bir kez dolanması yaklaşık 7 saat sürer; Güneş'te bu 14,5 saniye.",
    },
  },
  {
    kind: 'system',
    id: 'vycma',
    name: 'VY Canis Majoris',
    short: 'VY CMa',
    category: 'giant',
    ra: 110.743,
    dec: -25.7675,
    distPc: 1170,
    framePc: 34 * AU,
    stars: [{ name: 'VY Canis Majoris', radiusSun: 1420, tempK: 3490, massSun: 17 }],
    supergiant: true,
    facts: {
      type: 'Kırmızı hiperdev',
      stats: [
        ['Yarıçap', "Güneş'in ~1.400 katı"],
        ['Kütle', '~17 Güneş'],
        ['Uzaklık', '3.800 ışık yılı'],
      ],
      text: "Samanyolu'nun en büyük ve en çok kütle kaybeden yıldızlarından. Yüzeyinden kopan dev gaz yayları ve toz bulutlarıyla sarılı; Güneş'in yerinde olsa Satürn'ün yörüngesine kadar uzanırdı.",
      didYouKnow: 'Her yıl Dünya kütlesinin yaklaşık 30 katı kadar maddeyi uzaya savuruyor.',
    },
  },
  {
    kind: 'system',
    id: 'st2-18',
    name: 'Stephenson 2-18',
    short: 'Stephenson 2-18',
    category: 'giant',
    ra: 279.76,
    dec: -6.0278,
    distPc: 5800,
    framePc: 50 * AU,
    stars: [{ name: 'Stephenson 2-18', radiusSun: 2150, tempK: 3200, massSun: 20 }],
    supergiant: true,
    facts: {
      type: 'Kırmızı süperdev (aday en büyük yıldız)',
      stats: [
        ['Yarıçap', "Güneş'in ~2.150 katı (belirsiz)"],
        ['Uzaklık', '~19.000 ışık yılı'],
        ['Küme', 'Stephenson 2'],
      ],
      text: "Bazı ölçümlere göre bilinen en büyük yıldız: Güneş'in yerinde olsa Satürn'ün yörüngesini aşardı. Uzaklığı ve sıcaklığı belirsiz olduğu için gerçek boyutu tartışmalı; birkaç kat daha küçük de olabilir.",
      didYouKnow: 'Hacmine yaklaşık 10 milyar Güneş sığar.',
    },
  },
  {
    kind: 'system',
    id: 'r136a1',
    name: 'R136a1',
    short: 'R136a1 (BMB)',
    category: 'giant',
    ra: 84.6766,
    dec: -69.1009,
    distPc: 49_590,
    framePc: 1.5 * AU,
    stars: [{ name: 'R136a1', radiusSun: 42.7, tempK: 46_000, massSun: 196 }],
    facts: {
      type: 'Wolf-Rayet yıldızı · bilinen en ağır yıldız',
      stats: [
        ['Kütle', '~200 Güneş (Kalari ve ark. 2022)'],
        ['Parlaklık', "Güneş'in ~5 milyon katı"],
        ['Yer', 'Büyük Macellan Bulutu, Tarantula Bulutsusu'],
      ],
      text: "Bilinen en ağır ve en parlak yıldız, Samanyolu'nun uydusu Büyük Macellan Bulutu'nda. Yüzeyi 46.000 derece; şiddetli rüzgârıyla her yıl Dünya kütlesinin birkaç katını kaybediyor. Birkaç milyon yıl içinde patlayacak.",
      didYouKnow: 'Güneş ile yer değiştirse Dünya, Güneş ışığının milyonlarca katıyla yanardı.',
    },
  },
  {
    kind: 'system',
    id: 'wohg64',
    name: 'WOH G64',
    short: 'WOH G64 (BMB)',
    category: 'giant',
    ra: 73.794,
    dec: -68.3417,
    distPc: 49_590,
    framePc: 36 * AU,
    stars: [{ name: 'WOH G64', radiusSun: 1540, tempK: 3400, massSun: 25 }],
    supergiant: true,
    facts: {
      type: 'Kırmızı süperdev → sarı hiperdev',
      stats: [
        ['Yarıçap', "Güneş'in ~1.500 katı"],
        ['Yer', 'Büyük Macellan Bulutu'],
        ['İlk yakın görüntü', '2024, VLTI (GRAVITY)'],
      ],
      text: "Başka bir galakside yakından görüntülenen ilk yıldız. Çevresinde yumurta biçimli bir toz kozası var. 2014'ten bu yana ısınıp sarı hiperdeve dönüşüyor: büyük olasılıkla patlamadan önceki son evrelerinde.",
      didYouKnow: "Görüntüsü, Ay'daki bir insanı Dünya'dan seçmeye yetecek keskinlikte bir teleskop ağıyla çekildi.",
    },
  },

  // ---- Clusters -------------------------------------------------------------------------------
  {
    kind: 'cluster',
    id: 'omegacen',
    name: 'Omega Centauri',
    short: 'Omega Centauri',
    category: 'cluster',
    ra: 201.6968,
    dec: -47.4795,
    distPc: 5430,
    framePc: 45,
    scalePc: 6,
    stars: 160_000,
    globular: true,
    blackHoleMassSun: 8200,
    facts: {
      type: 'Küresel yıldız kümesi',
      stats: [
        ['Yıldız', '~10 milyon'],
        ['Yaş', '~12 milyar yıl'],
        ['Merkez', '≥8.200 M☉ kara delik (2024)'],
      ],
      text: "Samanyolu'nun en büyük küresel kümesi; muhtemelen galaksimizin yuttuğu bir cüce gökadanın çekirdeği. Merkezinde ara kütleli bir kara delik bulundu.",
    },
  },
  {
    kind: 'cluster',
    id: 'pleiades',
    name: 'Ülker (Pleiades, M45)',
    short: 'Ülker',
    category: 'cluster',
    ra: 56.75,
    dec: 24.12,
    distPc: 136,
    framePc: 14,
    scalePc: 1.8,
    stars: 1400,
    globular: false,
    reflectionNebula: true,
    members: [
      { name: 'Alkyone', ra: 56.8711, dec: 24.1051, color: [0.7, 0.8, 1] },
      { name: 'Atlas', ra: 57.2906, dec: 24.0534, color: [0.72, 0.8, 1] },
      { name: 'Elektra', ra: 56.2189, dec: 24.1133, color: [0.7, 0.8, 1] },
      { name: 'Maia', ra: 56.4567, dec: 24.3678, color: [0.72, 0.82, 1] },
      { name: 'Merope', ra: 56.5816, dec: 23.9484, color: [0.72, 0.82, 1] },
      { name: 'Taygeta', ra: 56.3021, dec: 24.4672, color: [0.74, 0.84, 1] },
      { name: 'Pleione', ra: 57.2967, dec: 24.1367, color: [0.75, 0.84, 1] },
      { name: 'Kelaino', ra: 56.2006, dec: 24.2894, color: [0.76, 0.85, 1] },
      { name: 'Sterope', ra: 56.4767, dec: 24.5544, color: [0.78, 0.86, 1] },
    ],
    facts: {
      type: 'Açık yıldız kümesi',
      stats: [
        ['Yıldız', '~1.000'],
        ['Yaş', '~100 milyon yıl'],
      ],
      text: 'Çıplak gözle görülen en ünlü yıldız kümesi. Mavi, genç yıldızlar içinden geçtikleri toz bulutunu aydınlatıyor.',
      didYouKnow: "Subaru otomobillerinin logosu Ülker'in altı yıldızıdır.",
    },
  },
];

/** Sgr A* card. */
export const SGR_A_FACTS: Facts = {
  type: 'Süper kütleli kara delik',
  stats: [
    ['Kütle', '4,3 milyon Güneş'],
    ['Olay ufku çapı', '~25 milyon km'],
    ['İlk görüntü', '2022, Olay Ufku Teleskobu'],
  ],
  text: 'Galaksimizin merkezindeki kara delik. Çevresindeki S yıldızları onu birkaç on yılda bir dolanıyor; yörüngeleri kütlesini ölçmemizi sağladı (Nobel 2020). Yakından bak: ışığı büküp arkasındakileri halkaya çeviriyor.',
  didYouKnow: 'S2 yıldızı kara deliğe en yakın geçişinde ışık hızının %2,5\'iyle hareket eder.',
};

/** Galaxy facts for the "Samanyolu" card. */
export const MILKY_WAY_FACTS: Facts = {
  type: 'Çubuklu sarmal gökada',
  stats: [
    ['Çap', '~100.000 ışık yılı'],
    ['Yıldız', '100–400 milyar'],
    ['Yaş', '~13,6 milyar yıl'],
    ['Kütle', '~1,5 trilyon Güneş (karanlık madde dahil)'],
    ["Güneş'in turu", '~230 milyon yıl'],
  ],
  text: "Güneş, merkezden 26.700 ışık yılı uzakta, küçük Orion Kolu'nda. Merkezde 4 milyon Güneş kütleli Sgr A* kara deliği var. Galaksimiz yaklaşık 4,5 milyar yıl sonra Andromeda ile çarpışıp birleşecek.",
  didYouKnow: 'Galaksideki tozun ardında kalan uzak yarısını hiç doğrudan göremiyoruz.',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  blackhole: 'Kara delikler',
  galaxy: 'Galaksiler (Samanyolu dışı)',
  giant: 'Dev yıldızlar',
  pulsar: 'Pulsarlar ve nötron yıldızları',
  nebula: 'Bulutsular',
  system: 'Yıldız sistemleri',
  cluster: 'Yıldız kümeleri',
};

