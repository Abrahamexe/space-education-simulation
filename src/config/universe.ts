/**
 * Universe map (src/universe): scale presets and landmarks. Positions are
 * RA/Dec (J2000, degrees) with a distance: Mpc for the nearby universe
 * (cz / H0, H0 = 70), or a redshift for the far one (comoving distance,
 * flat ΛCDM, Ωm = 0.3), as in scripts/build-universe.mjs.
 */

export const H0 = 70;
export const OMEGA_M = 0.3;
const C_KMS = 299_792.458;

/** Comoving distance (Mpc) for a redshift. */
export function comovingMpc(z: number): number {
  const n = Math.max(64, Math.ceil(z * 40));
  let s = 0;
  for (let i = 0; i < n; i++) {
    const zi = ((i + 0.5) / n) * z;
    s += 1 / Math.sqrt(OMEGA_M * (1 + zi) ** 3 + (1 - OMEGA_M) + 8.4e-5 * (1 + zi) ** 4);
  }
  return ((C_KMS / H0) * s * z) / n;
}

/** Light years per megaparsec. */
export const LY_PER_MPC = 3.2616e6;

/** Radius of the last-scattering surface (the CMB), comoving Mpc. */
export const CMB_RADIUS_MPC = comovingMpc(1090);
/** Edge of the observable universe (particle horizon), comoving Mpc ≈ 46.5 billion ly. */
export const HORIZON_MPC = 14_260;

export const UNIVERSE_VIEW = {
  /** Camera distance where the hand-over from the galaxy view happens (Mpc). */
  entryMpc: 4,
  /** Closest zoom and farthest (Mpc). */
  minMpc: 0.05,
  maxMpc: 60_000,
  /** Layers fade with the camera distance from the Milky Way (Mpc): [in from, full at] or [full until, gone at]. */
  localGroupFade: [12, 40] as const,
  twoMrsFade: [2, 8] as const,
  sdssFade: [120, 400] as const,
  cmbFade: [1500, 6000] as const,
  flowFade: [6, 20] as const,
};

export interface Scale {
  id: string;
  name: string;
  /** Pivot (Mpc, equatorial RA/Dec/dist), framing distance and view side. */
  ra: number;
  dec: number;
  distMpc: number;
  frameMpc: number;
  /** Look from this sky direction (RA/Dec of the camera side); default: above the supergalactic plane. */
  view?: readonly [number, number];
  text: string;
}

export const SCALES: readonly Scale[] = [
  {
    id: 'local',
    name: 'Yerel Grup',
    ra: 10.68,
    dec: 41.27,
    distMpc: 0.38,
    frameMpc: 4.5,
    text: 'Samanyolu, Andromeda ve Üçgen ile çevrelerindeki yüzü aşkın cüce galaksi. Yaklaşık 10 milyon ışık yılı genişliğinde.',
  },
  {
    id: 'laniakea',
    name: 'Laniakea',
    ra: 220,
    dec: -45,
    distMpc: 40,
    frameMpc: 330,
    text: 'Bizim üstkümemiz: yaklaşık 100 bin galaksi, 520 milyon ışık yılı çapında. Çizgiler galaksilerin Büyük Çekici’ye doğru akışını gösterir.',
  },
  {
    id: 'web',
    name: 'Kozmik ağ',
    ra: 185,
    dec: 30,
    distMpc: 380,
    frameMpc: 1100,
    // From the north celestial pole: the SDSS wedge seen face-on, as in its famous maps.
    view: [180, 90],
    text: 'Galaksiler duvarlar ve ipliklerden oluşan bir ağ üzerinde dizilir; aralarında devasa boşluklar vardır. Noktalar SDSS’in ölçtüğü gerçek galaksilerdir.',
  },
  {
    id: 'observable',
    name: 'Gözlenebilir evren',
    ra: 0,
    dec: 30,
    distMpc: 0,
    frameMpc: 52_000,
    text: 'Işığının bize ulaşabildiği her şey: 93 milyar ışık yılı çapında bir küre. Kenarında Büyük Patlama’dan 380 bin yıl sonra salınan ışık, kozmik mikrodalga arka plan var.',
  },
];

export interface Landmark {
  id: string;
  name: string;
  kind: 'cluster' | 'supercluster' | 'attractor' | 'void' | 'wall' | 'quasar' | 'galaxy' | 'home' | 'edge' | 'evidence';
  ra: number;
  dec: number;
  /** Distance (Mpc), or a redshift (comoving distance). */
  distMpc?: number;
  z?: number;
  /** Shown while the camera is within [min, max] Mpc of the Milky Way. */
  range: readonly [number, number];
  type: string;
  text: string;
  /** Framing distance when flown to (Mpc). */
  frameMpc: number;
}

export const LANDMARKS: readonly Landmark[] = [
  {
    id: 'mw',
    name: 'Samanyolu · buradasınız',
    kind: 'home',
    ra: 266.4,
    dec: -28.9,
    distMpc: 0,
    range: [0, 400],
    type: 'Bizim galaksimiz',
    text: 'Güneş, Samanyolu’nun bir sarmal kolunda, merkezden 26 bin ışık yılı uzakta. Disk yaklaşık 100 bin ışık yılı genişliğinde; uzaklaştıkça Yerel Grup’taki komşularıyla birlikte tek bir noktaya dönüşür.',
    frameMpc: 0.09,
  },
  {
    id: 'virgo',
    name: 'Başak Kümesi',
    kind: 'cluster',
    ra: 187.7,
    dec: 12.4,
    distMpc: 16.5,
    range: [6, 700],
    type: 'Galaksi kümesi · ~1500 galaksi',
    text: 'En yakın büyük küme. Yerel Grup ona doğru saniyede yaklaşık 250 km hızla düşüyor; M87 bu kümenin merkezinde.',
    frameMpc: 18,
  },
  {
    id: 'localvoid',
    name: 'Yerel Boşluk',
    kind: 'void',
    ra: 285,
    dec: 10,
    distMpc: 23,
    range: [10, 300],
    type: 'Kozmik boşluk (yaklaşık konum)',
    text: 'Yerel Grup’un hemen yanındaki neredeyse boş bölge. Boşluklar genişler, galaksiler onların kenarlarından uzaklaşır.',
    frameMpc: 40,
  },
  {
    id: 'centaurus',
    name: 'Erboğa Kümesi',
    kind: 'cluster',
    ra: 192.2,
    dec: -41.3,
    distMpc: 48.8,
    range: [15, 900],
    type: 'Galaksi kümesi (Abell 3526)',
    text: 'Büyük Çekici’ye giden akış hattı üzerinde, Laniakea’nın yoğun bölgelerinden biri.',
    frameMpc: 30,
  },
  {
    id: 'hydra',
    name: 'Su Yılanı Kümesi',
    kind: 'cluster',
    ra: 159.2,
    dec: -27.5,
    distMpc: 54,
    range: [15, 900],
    type: 'Galaksi kümesi (Abell 1060)',
    text: 'Erboğa ile birlikte Hydra–Centaurus üstkümesini oluşturur.',
    frameMpc: 30,
  },
  {
    id: 'ga',
    name: 'Büyük Çekici',
    kind: 'attractor',
    ra: 243.6,
    dec: -60.9,
    distMpc: 66,
    range: [15, 1500],
    type: 'Laniakea’nın çekim merkezi · Norma Kümesi',
    text: 'Laniakea’daki galaksilerin akışının yöneldiği bölge. Samanyolu diskinin arkasında kaldığı için optik olarak zor görülür; varlığı galaksilerin hızlarından anlaşıldı. Merkezinde Norma Kümesi (Abell 3627) var.',
    frameMpc: 60,
  },
  {
    id: 'perseus',
    name: 'Perseus–Balıklar Üstkümesi',
    kind: 'supercluster',
    ra: 49.95,
    dec: 41.5,
    distMpc: 76.7,
    range: [20, 1500],
    type: 'Üstküme · Laniakea’nın komşusu',
    text: 'Laniakea’nın sınırının öte yanındaki uzun galaksi zinciri. Oradaki galaksiler bizim çekim havzamıza değil, kendi merkezlerine akar.',
    frameMpc: 80,
  },
  {
    id: 'coma',
    name: 'Saç Kümesi',
    kind: 'cluster',
    ra: 194.95,
    dec: 27.98,
    distMpc: 99,
    range: [25, 1500],
    type: 'Zengin galaksi kümesi · 1000+ galaksi',
    text: 'Fritz Zwicky 1933’te bu kümedeki galaksilerin çok hızlı hareket ettiğini görüp ilk kez “karanlık madde” fikrini ortaya attı.',
    frameMpc: 40,
  },
  {
    id: 'cfa2wall',
    name: 'CfA2 Büyük Duvarı',
    kind: 'wall',
    ra: 180,
    dec: 30,
    distMpc: 95,
    range: [40, 2000],
    type: 'Galaksi duvarı · ~500 milyon ışık yılı',
    text: '1989’da keşfedilen ilk büyük “duvar”: Saç Kümesi’nden geçen ince, uzun bir galaksi tabakası.',
    frameMpc: 160,
  },
  {
    id: 'shapley',
    name: 'Shapley Üstkümesi',
    kind: 'supercluster',
    ra: 202,
    dec: -31.5,
    distMpc: 206,
    range: [60, 3000],
    type: 'Yakın evrenin en büyük kütle yoğunlaşması',
    text: 'Büyük Çekici’nin de ötesinde, Yerel Grup’un hareketinin bir kısmını da açıklayan dev bir küme topluluğu.',
    frameMpc: 150,
  },
  {
    id: 'bootes',
    name: 'Çoban Boşluğu',
    kind: 'void',
    ra: 218,
    dec: 46,
    z: 0.052,
    range: [80, 3000],
    type: 'Dev boşluk · ~330 milyon ışık yılı çapında',
    text: '“Büyük Hiçlik”: bu boyuttaki bir bölgede binlerce galaksi beklenirken yalnızca birkaç düzine galaksi var.',
    frameMpc: 220,
  },
  {
    id: 'sloanwall',
    name: 'Sloan Büyük Duvarı',
    kind: 'wall',
    ra: 195,
    dec: 0,
    z: 0.073,
    range: [120, 4000],
    type: 'Galaksi duvarı · ~1,4 milyar ışık yılı',
    text: 'SDSS haritasında görülen dev galaksi tabakası; bilinen en büyük yapılardan biri.',
    frameMpc: 450,
  },
  {
    id: '3c273',
    name: '3C 273',
    kind: 'quasar',
    ra: 187.28,
    dec: 2.05,
    z: 0.158,
    range: [300, 30_000],
    type: 'İlk tanımlanan kuasar',
    text: 'Bir galaksinin merkezindeki kara deliğin beslenirken saçtığı ışık; Güneş’in 4 trilyon katı parlak.',
    frameMpc: 300,
  },
  {
    id: 'bullet',
    name: 'Mermi Kümesi',
    kind: 'evidence',
    ra: 104.63,
    dec: -55.95,
    z: 0.296,
    range: [150, 60_000],
    type: 'Çarpışan iki galaksi kümesi · karanlık madde kanıtı',
    text: 'Gazı (pembe) ile kütlesi (mavi) birbirinden ayrılmış küme: karanlık maddenin en doğrudan kanıtı.',
    frameMpc: 7,
  },
  {
    id: 'a1689',
    name: 'Abell 1689',
    kind: 'evidence',
    ra: 197.873,
    dec: -1.341,
    z: 0.183,
    range: [150, 60_000],
    type: 'Kütleçekimsel mercek · karanlık madde kanıtı',
    text: 'Arkasındaki galaksilerin ışığını büken dev küme; bükülme, görünenden çok daha fazla kütle olduğunu gösterir.',
    frameMpc: 1.8,
  },
  {
    id: 'hcbwall',
    name: 'Herkül–Kuzey Taç Büyük Duvarı',
    kind: 'wall',
    ra: 245,
    dec: 30,
    z: 2,
    range: [1500, 60_000],
    type: 'Bilinen en büyük yapı adayı · ~10 milyar ışık yılı',
    text: 'Gama ışını patlamalarının yoğunlaştığı dev bölge. Gerçek bir yapı mı, istatistik bir tesadüf mü hâlâ tartışılıyor.',
    frameMpc: 6000,
  },
  {
    id: 'ton618',
    name: 'TON 618',
    kind: 'quasar',
    ra: 186.95,
    dec: 31.47,
    z: 2.219,
    range: [1500, 60_000],
    type: 'Kuasar · en ağır kara deliklerden biri',
    text: '66 milyar Güneş kütleli kara deliğin beslendiği kuasar. Işığı bize 10,8 milyar yılda ulaştı.',
    frameMpc: 3000,
  },
  {
    id: 'gnz11',
    name: 'GN-z11',
    kind: 'galaxy',
    ra: 189.106,
    dec: 62.242,
    z: 10.6,
    range: [3000, 60_000],
    type: 'Çok erken bir galaksi',
    text: 'Büyük Patlama’dan yalnızca 430 milyon yıl sonraki hâliyle görüyoruz.',
    frameMpc: 4000,
  },
  {
    id: 'jades14',
    name: 'JADES-GS-z14-0',
    kind: 'galaxy',
    ra: 53.083,
    dec: -27.856,
    z: 14.32,
    range: [3000, 60_000],
    type: 'Bilinen en uzak galaksilerden biri (Webb)',
    text: 'James Webb’in bulduğu, Büyük Patlama’dan yaklaşık 290 milyon yıl sonraki galaksi.',
    frameMpc: 4000,
  },
  {
    id: 'cmb',
    name: 'Kozmik mikrodalga arka plan',
    kind: 'edge',
    ra: 0,
    dec: 0,
    z: 1090,
    range: [3000, 60_000],
    type: 'Evrenin ilk ışığı · 380 bin yaşında',
    text: 'Evren soğuyup saydamlaştığında salınan ışık; bugün her yönden 2,7 K sıcaklıkta mikrodalga olarak geliyor. Renkler yüz binde birlik sıcaklık farklarını gösterir: galaksilerin tohumları.',
    frameMpc: 40_000,
  },
];

/** A stop on the "how do we know dark matter exists?" tour. */
export interface Evidence {
  id: string;
  name: string;
  /** Landmark (or Local Group label) the camera flies to. */
  target: string;
  type: string;
  year: string;
  see: string;
  means: string;
  /** Card picture (public/textures/evidence) or a chart drawn in the card. */
  image?: { file: string; credit: string };
  chart?: 'rotation';
  /** Picture placed in the map: centre (RA/Dec, distance or redshift) and width (comoving Mpc). */
  space?: { ra: number; dec: number; z?: number; distMpc?: number; widthMpc: number; aspect: number };
}

export const EVIDENCE: readonly Evidence[] = [
  {
    id: 'rotation',
    name: 'Galaksilerin dönüşü',
    target: 'lg-Üçgen (M33)',
    type: 'Dönme eğrisi · Üçgen Galaksisi (M33)',
    year: 'Vera Rubin ve Kent Ford, 1970’ler',
    see: 'Galaksinin kenarındaki yıldızlar ve gaz, merkeze yakın olanlar kadar hızlı dönüyor (beyaz çizgi, ölçülen).',
    means:
      'Görünen madde merkezde toplandığı için kenardaki hızların, Güneş’ten uzak gezegenler gibi azalması gerekirdi (turuncu çizgi, yalnızca yıldız ve gazın çekimi). Hız düşmüyor: galaksiyi, görünenin birkaç katı kütlede görünmez bir hale sarıyor.',
    chart: 'rotation',
  },
  {
    id: 'coma',
    name: 'Fazla hızlı galaksiler',
    target: 'coma',
    type: 'Saç Kümesi',
    year: 'Fritz Zwicky, 1933',
    see: 'Saç Kümesi’ndeki galaksiler birbirlerine göre saniyede yaklaşık 1000 km hızla hareket ediyor.',
    means:
      'Bu hızda galaksiler kümeden çoktan dağılmış olmalıydı. Onları bir arada tutacak çekim için, görünen yıldızlar ve gazın toplamının 5–10 katı kütle gerekiyor. Zwicky bu görünmez kütleye “dunkle Materie”, yani karanlık madde dedi.',
    image: { file: 'coma.webp', credit: 'CTIO/NOIRLab/DOE/NSF/AURA (CC BY 4.0)' },
    space: { ra: 194.95, dec: 27.98, distMpc: 99, widthMpc: 2.6, aspect: 1024 / 650 },
  },
  {
    id: 'lensing',
    name: 'Işığı büken kütle',
    target: 'a1689',
    type: 'Kütleçekimsel mercek · Abell 1689',
    year: 'Hubble, 2000’ler',
    see: 'Kümenin arkasındaki uzak galaksilerin ışığı bükülmüş: yüzden fazla yay ve çift görüntü var.',
    means:
      'Işığın ne kadar büküldüğü, aradaki toplam kütleyi ışığına bakmadan verir. Abell 1689’da ölçülen kütle, yıldızların ve gazın birkaç katı; fazlası karanlık madde, mercek haritası da onun nasıl dağıldığını gösterir.',
    image: { file: 'a1689.webp', credit: 'NASA, ESA, E. Jullo, P. Natarajan, J.-P. Kneib' },
    space: { ra: 197.873, dec: -1.341, z: 0.183, widthMpc: 0.72, aspect: 986 / 1024 },
  },
  {
    id: 'bullet',
    name: 'Ayrılan gaz ve kütle',
    target: 'bullet',
    type: 'Mermi Kümesi (1E 0657-56)',
    year: 'Clowe ve arkadaşları, 2006 · Webb ve Chandra, 2025',
    see: 'İki galaksi kümesi saniyede ~4500 km hızla birbirinin içinden geçti. Pembe: Chandra’nın gördüğü sıcak gaz (normal maddenin çoğu). Mavi: mercek etkisiyle ölçülen kütle.',
    means:
      'Çarpışmada gazlar birbirine sürtünüp yavaşladı ve ortada kaldı; ama kütlenin çoğu (mavi) galaksilerle birlikte yoluna devam etti. Kütle, normal maddenin olduğu yerde değil: çarpışmada birbirine değmeden geçen görünmez bir madde var. Karanlık maddenin en doğrudan kanıtı sayılır.',
    image: { file: 'bullet.webp', credit: 'NASA, ESA, CSA, STScI, CXC; J. Jee, S. Cha, K. Finner' },
    space: { ra: 104.63, dec: -55.95, z: 0.296, widthMpc: 3.1, aspect: 1024 / 429 },
  },
];

/** Approximate M33 rotation curve (Corbelli & Salucci 2000; Corbelli+ 2014): radius (kpc), speed (km/s). */
export const M33_ROTATION = {
  observed: [[0.5, 38], [1, 55], [2, 75], [3, 88], [4, 96], [5, 102], [6, 107], [8, 112], [10, 117], [12, 121], [14, 124], [16, 126]] as const,
  visible: [[0.5, 35], [1, 50], [2, 62], [3, 66], [4, 66], [5, 64], [6, 61], [8, 56], [10, 52], [12, 49], [14, 46], [16, 44]] as const,
};

/** Dark matter card (the density layer). */
export const DARK_MATTER_TEXT =
  'Evrendeki maddenin yaklaşık %85’i görünmez karanlık maddedir. Işık saçmaz, ama çekimiyle galaksileri bir arada tutar ve kozmik ağın iskeletini oluşturur. Bu harita, 2MRS’teki 44 bin galaksinin dağılımından hesaplanan madde yoğunluğudur: galaksiler karanlık maddenin yoğun olduğu yerlerde toplanır.';
export const FLOW_TEXT =
  'Çizgiler ve üzerlerinde süzülen noktalar galaksilerin akışıdır: her galaksi çevresindeki fazla kütleye doğru çekilir. Akışın yönü 2MRS yoğunluğundan doğrusal kuramla hesaplandı; hızının ölçeği (β) Cosmicflows-4’teki yakın 2869 grubun ölçülmüş hızlarına uyduruldu. Ayrıca bütün bölge, 200 Mpc’nin ötesindeki kütlelerin çekimiyle Shapley yönüne toplu olarak sürükleniyor (~230 km/s). Ayrıntılar ve kendi uydurman için: Laboratuvar → Deneyler.';
export const GAS_TEXT =
  'Pembe ışıltı, galaksi kümelerini dolduran 10–100 milyon derecelik gazdır (ROSAT X-ışını gözlemleri, MCXC kataloğu: 1743 küme). Bir kümedeki normal maddenin çoğu yıldızlarda değil bu gazdadır; ama gazın ve yıldızların toplamı bile kümeyi bir arada tutmaya yetmez. Gerisi karanlık maddedir.';
export const GALAXIES_TEXT =
  'Noktalar galaksiler, yani yıldızlar. Evrendeki normal maddenin yalnızca küçük bir kısmı yıldızlarda; çoğu galaksiler arasındaki seyrek, sıcak gazda.';

/** Cosmic inventory (Planck 2018) and where ordinary matter is today (Shull+ 2012, rounded). */
export const COMPOSITION = {
  today: [
    { label: 'Karanlık enerji', pct: 68.5, color: '#5b5f7a' },
    { label: 'Karanlık madde', pct: 26.6, color: '#3d7bff' },
    { label: 'Normal madde', pct: 4.9, color: '#f2b35e' },
  ],
  early: [
    { label: 'Karanlık madde', pct: 63, color: '#3d7bff' },
    { label: 'Fotonlar', pct: 15, color: '#ffe27a' },
    { label: 'Nötrinolar', pct: 10, color: '#9ad9c4' },
    { label: 'Atomlar', pct: 12, color: '#f2b35e' },
  ],
  baryons: [
    { label: 'Galaksiler arası sıcak gaz (WHIM)', pct: 40, color: '#ff6fc8' },
    { label: 'Soğuk galaksiler arası gaz', pct: 28, color: '#c77dff' },
    { label: 'Galaksi halelerindeki gaz', pct: 18, color: '#ff9ad8' },
    { label: 'Yıldızlar ve galaksiler', pct: 7, color: '#ffffff' },
    { label: 'Küme gazı (X-ışını)', pct: 4, color: '#ff4fa8' },
    { label: 'Diğer', pct: 3, color: '#777' },
  ],
} as const;

export const BASIN_TEXT =
  'Altın kabuk, Samanyolu’nun aktığı noktaya akan her yeri çevreler: Laniakea’nın sınırı. Bu tanım (Tully ve arkadaşları, 2014) galaksilerin nereye gittiğine bakar, ne kadar yakın olduklarına değil. Sınırın öte yanındaki galaksiler başka çekim merkezlerine (Perseus–Balıklar, Herkül, Shapley) akar. Bu veriyle hesaplanan havza yaklaşık 5,6 milyon Mpc³.';
