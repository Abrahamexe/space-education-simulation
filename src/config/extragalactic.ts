/**
 * Famous objects beyond the Milky Way, placed in the galaxy scene (pc) at
 * their true sky positions and distances. Nearby galaxies use measured
 * distances (Cepheids, TRGB, masers); for the far ones (z > 0.05) the
 * position is the comoving distance in flat ΛCDM (Planck 2018: H0 = 67.66,
 * Ωm = 0.311) and the cards also give the light-travel time.
 *
 * Pictures: NASA/ESA/CSA Hubble and Webb (public domain), ESA/Hubble and
 * ESO (CC BY 4.0), two amateur mosaics (CC BY 2.0 / 4.0), all from
 * Wikimedia Commons (scripts/fetch-extragalactic.mjs, docs/CREDITS.md).
 * Sizes on screen follow each galaxy's published diameter; orientation
 * (inclination, major axis) the published values, measured on the picture.
 *
 * Black holes are ray-traced like Sgr A* (the "Interstellar" view), with
 * the jets their galaxies are known for.
 */
import type { DepthSpec, Facts } from './deepsky';

type RGB = readonly [number, number, number];

/** A relativistic jet pair along the black hole's spin axis. */
export interface JetDef {
  /** Approaching jet in the picture: angle CCW from +x (y up), degrees. */
  angleDeg: number;
  /** Angle between the jet and our line of sight, degrees. */
  losDeg: number;
  /** True (deprojected) length, pc. */
  lengthPc: number;
  /** Half opening angle far out, degrees. */
  openingDeg: number;
  color: RGB;
  intensity: number;
  /** Counter-jet brightness relative to the approaching one (Doppler dimming). */
  counter: number;
}

export interface HoleDef {
  name: string;
  /** Menu label. */
  short: string;
  massSun: number;
  /** Disc look: 'film' (warm, Interstellar) or 'quasar' (hotter, bluer, brighter). */
  look: 'film' | 'quasar';
  facts: Facts;
  jet?: JetDef;
  /** A quasar outshines its galaxy: a bright point seen from far away. */
  beacon?: { color: RGB; intensity: number };
}

/** Old stars of an elliptical / bulge, and its globular clusters. */
export interface HaloDef {
  scalePc: number;
  stars: number;
  color: RGB;
  /** Axis ratio along the line of sight (1 = round). */
  flatten?: number;
  globulars?: number;
  globularScalePc?: number;
}

export interface ExtraDef {
  id: string;
  name: string;
  short: string;
  /** Menu group: a galaxy, or a black hole on its own (no picture). */
  category: 'galaxy' | 'blackhole';
  /** Sub-group in the "Samanyolu dışında" menu (galaxies). */
  menu?: 'galaxy' | 'interacting' | 'deep';
  ra: number;
  dec: number;
  distPc: number;
  framePc: number;
  facts: Facts;
  image?: {
    file: string;
    aspect: number;
    widthPc: number;
    anchor: readonly [number, number];
    depth: DepthSpec;
    brightness: number;
  };
  hole?: HoleDef;
  halo?: HaloDef;
  /** Large faint glow (e.g. the Lyman-alpha nebula round TON 618). */
  nebula?: { color: RGB; radiusPc: number; intensity: number };
}

const WARM: RGB = [1.0, 0.86, 0.66];
const JET_BLUE: RGB = [0.62, 0.78, 1.0];

export const EXTRAGALACTIC: readonly ExtraDef[] = [
  // ---- Local Group ---------------------------------------------------------------------------
  {
    id: 'm31',
    name: 'Andromeda Galaksisi (M31)',
    short: 'Andromeda (M31)',
    category: 'galaxy',
    ra: 10.6847,
    dec: 41.269,
    distPc: 765_000,
    framePc: 58_000,
    image: { file: 'm31', aspect: 3000 / 1971, widthPc: 50_000, anchor: [0.51, 0.5], depth: { model: 'disc', incDeg: 77, majorDeg: -36, bulge: 0.035, thick: 0.005, extent: 0.4 }, brightness: 1.1 },
    hole: {
      name: 'M31* kara deliği',
      short: 'M31* (Andromeda)',
      massSun: 1.4e8,
      look: 'film',
      facts: {
        type: 'Süper kütleli kara delik',
        stats: [
          ['Kütle', '~140 milyon Güneş (Bender ve ark. 2005)'],
          ["Sgr A*'ya göre", '~35 kat ağır'],
        ],
        text: "Andromeda'nın çekirdeğindeki kara delik. Çevresinde çift görünümlü bir yıldız diski dolanıyor: diskteki yıldızların yörüngeleri kara deliğin kütlesini ele veriyor.",
      },
    },
    facts: {
      type: 'Sarmal galaksi · Yerel Grup',
      stats: [
        ['Çap', '~150.000 ışık yılı'],
        ['Yıldız', '~1 trilyon'],
        ['Yaklaşma hızı', '110 km/s'],
      ],
      text: "Çıplak gözle görülebilen en uzak cisim ve en yakın büyük komşumuz. Samanyolu'na saniyede 110 km hızla yaklaşıyor; 4,5 milyar yıl sonra iki galaksi çarpışıp dev bir eliptik galaksiye dönüşecek. Gördüğün ışık 2,5 milyon yıl önce yola çıktı.",
      didYouKnow: "Gökyüzünde dolunayın altı katı genişliğinde; yalnızca çok sönük olduğu için çıplak gözle küçük bir leke gibi görünür.",
    },
  },
  {
    id: 'm33',
    name: 'Üçgen Galaksisi (M33)',
    short: 'Üçgen (M33)',
    category: 'galaxy',
    ra: 23.4621,
    dec: 30.6599,
    distPc: 840_000,
    framePc: 42_000,
    image: { file: 'm33', aspect: 3732 / 2344, widthPc: 37_000, anchor: [0.5, 0.5], depth: { model: 'disc', incDeg: 55, majorDeg: -8, bulge: 0.015, thick: 0.006, extent: 0.3 }, brightness: 1.2 },
    facts: {
      type: 'Sarmal galaksi · Yerel Grup',
      stats: [
        ['Çap', '~60.000 ışık yılı'],
        ['Yıldız', '~40 milyar'],
        ['Uzaklık', '2,7 milyon ışık yılı'],
      ],
      text: "Yerel Grup'un üçüncü büyük galaksisi. Merkezinde belirgin bir şişkinlik ve büyük bir kara delik yok; bol miktarda yıldız doğum bölgesi var (en büyüğü NGC 604).",
      didYouKnow: 'Çok karanlık bir gökyüzünde çıplak gözle görülebilen en uzak cisim olabilir.',
    },
  },

  // ---- Famous galaxies -----------------------------------------------------------------------
  {
    id: 'm51',
    name: 'Girdap Galaksisi (M51)',
    short: 'Girdap (M51)',
    category: 'galaxy',
    ra: 202.4696,
    dec: 47.1952,
    distPc: 8_580_000,
    framePc: 40_000,
    image: { file: 'm51', aspect: 3840 / 2665, widthPc: 35_000, anchor: [0.38, 0.46], depth: { model: 'disc', incDeg: 22, majorDeg: 0, bulge: 0.03, thick: 0.006, extent: 0.33 }, brightness: 1.0 },
    facts: {
      type: 'Etkileşen sarmal galaksi',
      stats: [
        ['Çap', '~76.000 ışık yılı'],
        ['Uzaklık', '~28 milyon ışık yılı'],
        ['Eşi', 'NGC 5195'],
      ],
      text: "Sarmal kollar fikrinin doğduğu galaksi: 1845'te Lord Rosse çizdi. Küçük eşi NGC 5195'in kütle çekimi kolları sıkıştırıp parlak, pembe yıldız doğum bölgeleri yakıyor.",
      didYouKnow: 'İki galaksi yüz milyonlarca yıldır birbirinin içinden geçiyor.',
    },
  },
  {
    id: 'm101',
    name: 'Fırıldak Galaksisi (M101)',
    short: 'Fırıldak (M101)',
    category: 'galaxy',
    ra: 210.8023,
    dec: 54.349,
    distPc: 6_400_000,
    framePc: 58_000,
    image: { file: 'm101', aspect: 3840 / 3002, widthPc: 52_000, anchor: [0.49, 0.5], depth: { model: 'disc', incDeg: 18, majorDeg: 0, bulge: 0.02, thick: 0.005, extent: 0.5 }, brightness: 1.0 },
    facts: {
      type: 'Büyük tasarım sarmal galaksi',
      stats: [
        ['Çap', '~170.000 ışık yılı'],
        ['Uzaklık', '~21 milyon ışık yılı'],
        ['Yıldız', '~1 trilyon'],
      ],
      text: "Samanyolu'nun neredeyse iki katı büyüklüğünde, tam yüzden görünen bir sarmal. Hubble'ın birleştirdiği 51 kareden oluşan bu görüntü, bir sarmal galaksinin şimdiye kadarki en ayrıntılı portrelerinden.",
      didYouKnow: "2023'te bu galakside patlayan SN 2023ixf son on yılın en yakın süpernovasıydı.",
    },
  },
  {
    id: 'm104',
    name: 'Sombrero Galaksisi (M104)',
    short: 'Sombrero (M104)',
    category: 'galaxy',
    ra: 189.9976,
    dec: -11.6231,
    distPc: 9_550_000,
    framePc: 24_000,
    image: { file: 'm104', aspect: 3840 / 2152, widthPc: 21_000, anchor: [0.5, 0.5], depth: { model: 'edge', majorDeg: -3, length: 0.36, bulge: 0.14 }, brightness: 0.72 },
    halo: { scalePc: 1400, stars: 30_000, color: WARM, flatten: 0.7, globulars: 2000, globularScalePc: 6000 },
    hole: {
      name: 'Sombrero kara deliği',
      short: 'Sombrero* (M104)',
      massSun: 6.6e8,
      look: 'film',
      facts: {
        type: 'Süper kütleli kara delik',
        stats: [['Kütle', '~660 milyon Güneş (Kormendy ve ark. 1996, 2013)']],
        text: "Sombrero'nun parlak çekirdeğindeki kara delik; yakın galaksilerde bilinen en ağırlarından.",
      },
    },
    facts: {
      type: 'Sarmal galaksi, kenardan',
      stats: [
        ['Çap', '~50.000 ışık yılı'],
        ['Uzaklık', '~31 milyon ışık yılı'],
        ['Küresel küme', '~2.000'],
      ],
      text: 'Kenardan gördüğümüz için bir şapkaya benziyor: parlak, şişkin bir merkez ve onu çevreleyen koyu toz şeridi. Çevresinde Samanyolu’ndakinin on katı küresel küme var.',
      didYouKnow: "Webb'in kızılötesi görüntüsünde toz halkası pürüzsüz değil, topak topak görünüyor.",
    },
  },
  {
    id: 'm87',
    name: 'M87 (Virgo A)',
    short: 'M87',
    category: 'galaxy',
    ra: 187.7059,
    dec: 12.3911,
    distPc: 16_400_000,
    framePc: 9000,
    image: { file: 'm87', aspect: 1222 / 1276, widthPc: 2200, anchor: [0.175, 0.18], depth: { model: 'ellipsoid', radius: 0.55, depth: 0.6, extent: 0.9 }, brightness: 0.9 },
    halo: { scalePc: 2600, stars: 50_000, color: WARM, flatten: 0.9, globulars: 12_000, globularScalePc: 14_000 },
    hole: {
      name: 'M87* kara deliği',
      short: 'M87* (ilk fotoğraflanan)',
      massSun: 6.5e9,
      look: 'film',
      jet: { angleDeg: -43, losDeg: 17, lengthPc: 5100, openingDeg: 2.5, color: JET_BLUE, intensity: 0.7, counter: 0.03 },
      facts: {
        type: 'Süper kütleli kara delik',
        stats: [
          ['Kütle', '6,5 milyar Güneş'],
          ['Olay ufku çapı', '~40 milyar km (Güneş Sistemi kadar)'],
          ['İlk görüntü', '2019, Olay Ufku Teleskobu'],
        ],
        text: "Fotoğrafı çekilen ilk kara delik. Dönerken çevresindeki manyetik alanları burup ışık hızına yakın bir plazma jeti fırlatıyor: jet 5.000 ışık yılı boyunca galaksiden dışarı uzanıyor.",
        didYouKnow: "2019'daki görüntü için Dünya'nın dört bir yanındaki radyo teleskopları birleşip Dünya büyüklüğünde tek bir teleskop gibi çalıştı.",
      },
    },
    facts: {
      type: 'Dev eliptik galaksi · Başak Kümesi',
      stats: [
        ['Kütle', '~2,4 trilyon Güneş'],
        ['Küresel küme', '~12.000'],
        ['Uzaklık', '~53 milyon ışık yılı'],
      ],
      text: "Başak Galaksi Kümesi'nin merkezindeki dev eliptik galaksi. Merkezindeki kara delikten çıkan mavi jet Hubble görüntüsünde açıkça seçiliyor.",
    },
  },
  {
    id: 'cena',
    name: 'Erboğa A (Centaurus A, NGC 5128)',
    short: 'Erboğa A',
    category: 'galaxy',
    ra: 201.3651,
    dec: -43.0191,
    distPc: 3_800_000,
    framePc: 40_000,
    image: { file: 'cena', aspect: 2808 / 2957, widthPc: 36_000, anchor: [0.51, 0.51], depth: { model: 'ellipsoid', radius: 0.2, depth: 0.8, extent: 0.42 }, brightness: 1.0 },
    halo: { scalePc: 2200, stars: 25_000, color: WARM, flatten: 0.85 },
    hole: {
      name: 'Erboğa A kara deliği',
      short: 'Erboğa A*',
      massSun: 5.5e7,
      look: 'film',
      jet: { angleDeg: 130, losDeg: 50, lengthPc: 8000, openingDeg: 4, color: [1.0, 0.7, 0.4], intensity: 0.6, counter: 0.35 },
      facts: {
        type: 'Süper kütleli kara delik',
        stats: [
          ['Kütle', '~55 milyon Güneş'],
          ['Jet', 'ışık hızının ~%50’si'],
        ],
        text: 'En yakın etkin galaksi çekirdeği. İki yöne fırlattığı jetler galaksinin çok dışına, milyonlarca ışık yılı uzunluğunda radyo loblarına kadar uzanıyor.',
      },
    },
    facts: {
      type: 'Eliptik galaksi + yutulmuş sarmal (radyo galaksisi)',
      stats: [
        ['Uzaklık', '~12 milyon ışık yılı'],
        ['Radyo lobları', '~1 milyon ışık yılı'],
      ],
      text: 'Dev bir eliptik galaksinin ortasında, yuttuğu sarmal galaksinin tozlu kalıntısı. Turuncu: soğuk toz ve jetler (APEX), mavi: X ışınında parlayan sıcak gaz (Chandra).',
      didYouKnow: 'Gökyüzündeki en parlak radyo kaynaklarından; yalnızca radyo loblarının boyu dolunayın 20 katı.',
    },
  },
  {
    id: 'm82',
    name: 'Puro Galaksisi (M82)',
    short: 'Puro (M82)',
    category: 'galaxy',
    ra: 148.9696,
    dec: 69.6797,
    distPc: 3_600_000,
    framePc: 16_000,
    image: { file: 'm82', aspect: 3840 / 2991, widthPc: 14_000, anchor: [0.49, 0.5], depth: { model: 'edge', majorDeg: 21, length: 0.42, bulge: 0.05 }, brightness: 1.0 },
    facts: {
      type: 'Yıldız patlaması galaksisi',
      stats: [
        ['Uzaklık', '~12 milyon ışık yılı'],
        ['Yıldız oluşumu', "Samanyolu'nun ~10 katı"],
      ],
      text: "Komşusu M81'in kütle çekimiyle sarsılan galaksi çılgınca yıldız üretiyor. Patlayan yıldızların rüzgârı, kırmızı hidrojen lifleri hâlinde galaksinin iki yanından dışarı fışkırıyor.",
      didYouKnow: '2014’te bu galakside patlayan SN 2014J, son on yılların en yakın Ia tipi süpernovasıydı.',
    },
  },
  {
    id: 'ngc1300',
    name: 'NGC 1300',
    short: 'NGC 1300 (çubuklu)',
    category: 'galaxy',
    ra: 49.9208,
    dec: -19.4111,
    distPc: 18_700_000,
    framePc: 40_000,
    image: { file: 'ngc1300', aspect: 3840 / 2191, widthPc: 36_000, anchor: [0.49, 0.48], depth: { model: 'disc', incDeg: 45, majorDeg: -5, bulge: 0.04, thick: 0.006, extent: 0.5 }, brightness: 1.0 },
    facts: {
      type: 'Çubuklu sarmal galaksi',
      stats: [
        ['Çap', '~110.000 ışık yılı'],
        ['Uzaklık', '~61 milyon ışık yılı'],
      ],
      text: 'Çubuklu sarmalların ders kitabı örneği. Merkezdeki yıldız çubuğu gazı içeriye taşıyor; Samanyolu da buna benzer bir çubuklu sarmal.',
    },
  },
  {
    id: 'antennae',
    name: 'Antenler (NGC 4038/4039)',
    short: 'Antenler',
    category: 'galaxy',
    menu: 'interacting',
    ra: 180.4708,
    dec: -18.8722,
    distPc: 22_000_000,
    framePc: 56_000,
    image: { file: 'antennae', aspect: 3915 / 3885, widthPc: 55_000, anchor: [0.5, 0.5], depth: { model: 'flat', depth: 0.05 }, brightness: 1.0 },
    facts: {
      type: 'Çarpışan iki galaksi',
      stats: [
        ['Uzaklık', '~72 milyon ışık yılı'],
        ['Çarpışma başlangıcı', '~600 milyon yıl önce'],
      ],
      text: 'İki sarmal galaksi çarpışıyor. Sıkışan gaz bulutlarında milyarlarca yeni yıldız doğuyor (pembe). Galaksilerin arkasından uzanan uzun gelgit kuyrukları onlara adını verdi.',
      didYouKnow: 'Samanyolu ile Andromeda da birkaç milyar yıl sonra buna benzeyecek.',
    },
  },
  {
    id: 'stephan',
    name: 'Stephan Beşlisi',
    short: 'Stephan Beşlisi',
    category: 'galaxy',
    menu: 'interacting',
    ra: 339.0142,
    dec: 33.96,
    distPc: 89_000_000,
    framePc: 150_000,
    image: { file: 'stephan', aspect: 3840 / 3682, widthPc: 160_000, anchor: [0.5, 0.5], depth: { model: 'flat', depth: 0.08 }, brightness: 1.0 },
    facts: {
      type: 'Sıkı galaksi grubu',
      stats: [
        ['Uzaklık', '~290 milyon ışık yılı'],
        ['Görüntü', 'Webb, 2022 (ilk görüntüler)'],
      ],
      text: "Dört galaksi birbirinin çevresinde dans ediyor; aralarından geçen galaksinin yarattığı şok dalgası gazı ısıtıyor. Beşinci galaksi (sol üstteki, NGC 7320) aslında çok daha yakında, yalnızca aynı doğrultuda.",
      didYouKnow: "Webb'in ilk görüntülerinden; 150 milyon pikselden oluşan bir mozaik.",
    },
  },
  {
    id: 'cartwheel',
    name: 'Araba Tekerleği Galaksisi',
    short: 'Araba Tekerleği',
    category: 'galaxy',
    menu: 'interacting',
    ra: 9.4213,
    dec: -33.7164,
    distPc: 153_000_000,
    framePc: 100_000,
    image: { file: 'cartwheel', aspect: 3840 / 3534, widthPc: 95_000, anchor: [0.58, 0.55], depth: { model: 'disc', incDeg: 32, majorDeg: 90, bulge: 0.03, thick: 0.008, extent: 0.27 }, brightness: 1.0 },
    facts: {
      type: 'Halka galaksi',
      stats: [
        ['Çap', '~144.000 ışık yılı'],
        ['Uzaklık', '~500 milyon ışık yılı'],
      ],
      text: 'Küçük bir galaksi bu sarmalın tam ortasından geçti; suya atılan taşın halkaları gibi, yıldız oluşumu dalgası dışarıya doğru yayıldı. Dış halka yeni yıldızlarla, iç halka sıcak tozla parlıyor.',
      didYouKnow: 'Yaklaşık 400 milyon yıl önceki çarpışmanın izleri hâlâ genişliyor.',
    },
  },
  {
    id: 'hoag',
    name: 'Hoag Nesnesi',
    short: 'Hoag Nesnesi',
    category: 'galaxy',
    menu: 'interacting',
    ra: 229.3167,
    dec: 21.5856,
    distPc: 183_000_000,
    framePc: 48_000,
    image: { file: 'hoag', aspect: 1521 / 1489, widthPc: 44_000, anchor: [0.52, 0.49], depth: { model: 'disc', incDeg: 15, majorDeg: 0, bulge: 0.07, thick: 0.01, extent: 0.38 }, brightness: 1.0 },
    facts: {
      type: 'Halka galaksi (kökeni bilinmiyor)',
      stats: [
        ['Çap', '~100.000 ışık yılı'],
        ['Uzaklık', '~600 milyon ışık yılı'],
      ],
      text: 'Sarı, yaşlı yıldızlardan bir çekirdek ve onu çevreleyen kusursuz mavi bir halka; aradaki boşlukta neredeyse hiç yıldız yok. Nasıl oluştuğu hâlâ çözülemedi.',
      didYouKnow: 'Halkanın arasından, çok daha uzaktaki benzer bir halka galaksi görünüyor.',
    },
  },

  // ---- Quasars and the largest black holes ----------------------------------------------------
  {
    id: 'q3c273',
    name: '3C 273 kuasarı',
    short: '3C 273 (ilk kuasar)',
    category: 'galaxy',
    menu: 'deep',
    ra: 187.2779,
    dec: 2.0524,
    distPc: 673_600_000,
    framePc: 160_000,
    image: { file: 'q3c273', aspect: 1280 / 1264, widthPc: 180_000, anchor: [0.5, 0.5], depth: { model: 'flat', depth: 0.03 }, brightness: 0.8 },
    hole: {
      name: '3C 273 kara deliği',
      short: '3C 273 kuasarı',
      massSun: 2.6e8,
      look: 'quasar',
      jet: { angleDeg: 149, losDeg: 10, lengthPc: 290_000, openingDeg: 1.2, color: JET_BLUE, intensity: 0.6, counter: 0.01 },
      beacon: { color: [0.8, 0.88, 1.0], intensity: 3 },
      facts: {
        type: 'Kuasar (beslenen süper kütleli kara delik)',
        stats: [
          ['Kütle', '~260 milyon Güneş (GRAVITY 2018)'],
          ['Parlaklık', "Güneş'in ~4 trilyon katı"],
        ],
        text: 'Tanımlanan ilk kuasar (1963). Kara deliğe düşen gaz öyle ısınıyor ki çekirdek, yüzlerce milyar yıldızlı galaksisinin tamamından yüz kat parlak.',
      },
    },
    facts: {
      type: 'Kuasar ve galaksisi',
      stats: [
        ['Işığın yola çıkışı', '2 milyar yıl önce'],
        ['Bugünkü uzaklık', '~2,2 milyar ışık yılı'],
        ['Jet', '~200.000 ışık yılı'],
      ],
      text: 'Gökyüzündeki en parlak kuasar; küçük bir teleskopla bile görülebilir. Sol üstteki çizgi, çekirdekten fırlayan dev jet.',
      didYouKnow: "Uzaklığı ölçüldüğünde, bu kadar uzaktan bu kadar parlak görünen bir şeyin ne olabileceği yıllarca tartışıldı.",
    },
  },
  {
    id: 'smacs',
    name: "Webb'in İlk Derin Alanı (SMACS 0723)",
    short: 'Webb Derin Alanı',
    category: 'galaxy',
    menu: 'deep',
    ra: 110.8375,
    dec: -73.4547,
    distPc: 1_564_000_000,
    framePc: 820_000,
    image: { file: 'smacs', aspect: 3840 / 3919, widthPc: 790_000, anchor: [0.5, 0.5], depth: { model: 'flat', depth: 0.1 }, brightness: 1.0 },
    facts: {
      type: 'Galaksi kümesi ve kütle çekimsel mercek',
      stats: [
        ['Işığın yola çıkışı', '4,6 milyar yıl önce (küme)'],
        ['Bugünkü uzaklık', '~5,1 milyar ışık yılı'],
        ['Gökyüzündeki boyutu', 'kol boyunda tutulan bir kum tanesi'],
      ],
      text: "Webb'in yayımlanan ilk görüntüsü. Önde bir galaksi kümesi; kütlesi arkadaki galaksilerin ışığını büküp büyütüyor. Kavisli kırmızı çizgiler, 13 milyar yıl önceki galaksilerin gerildiği görüntüleri. Sivri ışınlı yıldızlar Samanyolu'ndan.",
      didYouKnow: 'Bu kadarcık bir alanda binlerce galaksi var; tüm gökyüzünde yüz milyarlarca.',
    },
  },
  {
    id: 'holm15a',
    name: 'Holmberg 15A* kara deliği',
    short: 'Holm 15A* (40 milyar M☉)',
    category: 'blackhole',
    ra: 10.4604,
    dec: -9.3031,
    distPc: 242_700_000,
    framePc: 30_000,
    halo: { scalePc: 9000, stars: 60_000, color: WARM, flatten: 0.8, globulars: 6000, globularScalePc: 40_000 },
    hole: {
      name: 'Holmberg 15A*',
      short: 'Holm 15A* (40 milyar M☉)',
      massSun: 4.0e10,
      look: 'film',
      facts: {
        type: 'Ultra kütleli kara delik',
        stats: [
          ['Kütle', '40 milyar Güneş (Mehrgan ve ark. 2019)'],
          ['Olay ufku çapı', "~1.600 AU (Güneş–Neptün uzaklığının 50 katı)"],
          ['Galaksi', 'Holmberg 15A, Abell 85 kümesinin merkezi'],
        ],
        text: 'Yıldız hareketlerinden doğrudan ölçülmüş en ağır kara delik. Galaksisinin çekirdeği garip biçimde sönük ve geniş: kara delik, birleşmeler sırasında merkezdeki yıldızları dışarı savurmuş.',
      },
    },
    facts: {
      type: 'Ultra kütleli kara delik',
      stats: [
        ['Işığın yola çıkışı', '~770 milyon yıl önce'],
        ['Bugünkü uzaklık', '~790 milyon ışık yılı'],
      ],
      text: 'Abell 85 galaksi kümesinin merkezindeki dev eliptik galaksinin kara deliği.',
    },
  },
  {
    id: 'ton618',
    name: 'TON 618',
    short: 'TON 618 (66 milyar M☉?)',
    category: 'blackhole',
    ra: 187.1038,
    dec: 31.4772,
    distPc: 5_615_000_000,
    framePc: 0,
    nebula: { color: [0.55, 0.5, 1.0], radiusPc: 90_000, intensity: 0.35 },
    halo: { scalePc: 4000, stars: 20_000, color: [0.8, 0.85, 1.0], flatten: 0.8 },
    hole: {
      name: 'TON 618',
      short: 'TON 618 (40,7 milyar M☉)',
      massSun: 4.07e10,
      look: 'quasar',
      jet: { angleDeg: 60, losDeg: 30, lengthPc: 120_000, openingDeg: 1.5, color: JET_BLUE, intensity: 0.7, counter: 0.08 },
      beacon: { color: [0.75, 0.82, 1.0], intensity: 5 },
      facts: {
        type: 'Kuasar · bilinen en büyük kara deliklerden',
        stats: [
          ['Kütle', '40,7 milyar Güneş (Ge ve ark. 2019; eski tahmin 66 milyar)'],
          ['Olay ufku çapı', '~1.600 AU: Güneş Sistemi bunun içinde kaybolur'],
          ['Parlaklık', "Güneş'in ~140 trilyon katı"],
          ['Işığın yola çıkışı', '10,8 milyar yıl önce'],
          ['Bugünkü uzaklık', '~18 milyar ışık yılı'],
        ],
        text: "Evrenin en parlak kuasarlarından. Kara deliğe akan gaz, Samanyolu'nun tamamının 140 katı ışık saçıyor. Çevresinde 300.000 ışık yılı genişliğinde, kuasarın ışığıyla parlayan dev bir hidrojen bulutu (mor) var.",
        didYouKnow: "Gördüğün ışık Dünya oluşmadan 6 milyar yıl önce yola çıktı. Evren genişlediği için TON 618 bugün 18 milyar ışık yılı ötede.",
      },
    },
    facts: {
      type: 'Kuasar',
      stats: [],
      text: '',
    },
  },
];
