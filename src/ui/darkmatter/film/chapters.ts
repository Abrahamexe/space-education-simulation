import type { Stage } from '../render/Stage';
import type { Caption, CamKey } from './timeline';

export interface ChapterRuntime {
  /** t: chapter time (s), dt: frame step (s, 0 while paused). */
  update(t: number, dt: number): void;
  dispose(): void;
}

export interface Chapter {
  id: string;
  title: string;
  /** Seconds; Infinity for a card that stays until the viewer moves on. */
  duration: number;
  captions: Caption[];
  /** Camera path; absent = the viewer orbits freely. */
  camera?: CamKey[];
  /** One line: method and simplifications, always on screen. */
  method: string;
  lab?: { tab: 'interaction'; anchor: string };
  /** Builds the scene into the stage; `overlay` is a DOM layer over the canvas for labels. */
  build(stage: Stage, overlay: HTMLElement): Promise<ChapterRuntime>;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'web',
    title: 'Karanlık ağ',
    duration: 46,
    captions: [
      { at: 0, until: 9, text: "Büyük Patlama'dan hemen sonra: madde neredeyse pürüzsüz. Küçük bir fazlalıkta ses dalgası dışarı yayılıyor." },
      { at: 9, until: 18, text: 'Gaz ışıkla birlikte sürüklenip kabuk oluyor. Karanlık madde ışıkla etkileşmez, merkezde kalıp çökmeye başlıyor.' },
      { at: 18, until: 28, text: 'Karanlık madde ışıkla etkileşmez, bu yüzden ilk çöken o olur. Gaz önce geride kalır.' },
      { at: 28, until: 38, text: 'Karanlık madde ince iplikler ve düğümlerden bir ağ örüyor; gaz kütleçekimiyle bu kuyulara akıyor.' },
      { at: 38, until: 46.01, text: 'Galaksiler bu ağın düğümlerinde doğacak. İskeleti görünmeyen madde kuruyor.' },
    ],
    camera: [
      { at: 0, pos: [0, 3, 22] },
      { at: 18, pos: [0, 2, 14] },
      { at: 22, pos: [0, 5, 17] },
      { at: 34, pos: [7, 4, 13] },
      { at: 46, pos: [4, 3, 10] },
    ],
    method: "Ses kabuğu: yarı-analitik model (Eisenstein, Seo & White 2007), simülasyon değil. Ağ: Zel'dovich yaklaşımı, BBKS güç tayfı; gaz basınç ölçeğinde (4 Mpc) süzülmüş ve gecikmeli izliyor (basitleştirme). Parlaklık yoğunluğun karesiyle çizildi.",
    lab: { tab: 'interaction', anchor: 'bao' },
    build: async (stage, overlay) => (await import('./webChapter')).buildWeb(stage, overlay),
  },
  {
    id: 'galaxy',
    title: 'Halede bir galaksi',
    duration: 44,
    captions: [
      { at: 0, until: 7, text: 'Bir karanlık madde halesi: görünmez, ama içindeki gazı kütleçekimiyle tutuyor.' },
      { at: 7, until: 15, text: 'Gaz başta sıcak ve seyrek. Işınım yaptıkça enerji kaybediyor ve soğuyor (mavi).' },
      { at: 15, until: 24, text: 'Soğuyan gaz merkeze düşüyor ve dönerek bir diske yassılaşıyor. Karanlık madde soğuyamaz: küre olarak kalıyor.' },
      { at: 24, until: 33, text: 'Diskte gaz yoğunlaşınca yıldızlar doğuyor. Süpernovalar çevredeki gazı yeniden ısıtıyor (pembe).' },
      { at: 33, until: 44.01, text: "Karanlık maddeyi gizleyince yalnız görünen galaksi kalır. Oysa kütlenin %85'i o görünmeyen halede." },
    ],
    camera: [
      { at: 0, pos: [0, 14, 46] },
      { at: 10, pos: [0, 9, 30] },
      { at: 22, pos: [12, 7, 16] },
      { at: 32, pos: [0, 3.5, 11] },
      { at: 38, pos: [0, 11, 4] },
      { at: 44, pos: [2, 8, 8] },
    ],
    method: 'Barnes-Hut kütleçekimi + SPH gaz, ışınımla soğuma, yıldız oluşumu ve süpernova geri beslemesi; 12 000 karanlık madde + 10 000 gaz parçacığı. Zaman hızlandırılmış: 3 milyar yıl ≈ 36 s.',
    lab: { tab: 'interaction', anchor: 'galaxy' },
    build: async (stage, overlay) => (await import('./galaxyChapter')).buildGalaxy(stage, overlay),
  },
  {
    id: 'bullet',
    title: 'Mermi Kümesi',
    duration: 40,
    captions: [
      { at: 0, until: 8, text: 'İki galaksi kümesi saatte milyonlarca kilometre hızla birbirine yaklaşıyor.' },
      { at: 8, until: 18, text: 'Sıcak gaz bulutları çarpışıyor: birbirine sürtünüp yavaşlıyorlar.' },
      { at: 18, until: 26, text: 'Karanlık madde ve galaksiler ise neredeyse hiç çarpışmadan birbirinin içinden geçiyor.' },
      { at: 26, until: 33, text: 'Karanlık madde gerçekte görünmez. Onu, arkadaki galaksilerin ışığını nasıl büktüğünden buluruz.' },
      { at: 33, until: 40.01, text: 'Kütle ile gaz ayrı yerlerde: kütlenin çoğu görünmeyen maddede.' },
    ],
    camera: [
      { at: 0, pos: [0, 3, 11] },
      { at: 8, pos: [0, 1.5, 7] },
      { at: 18, pos: [1.2, 0.8, 4.5] },
      { at: 22, pos: [0.4, 0.4, 6] },
      { at: 26, pos: [0, 0.4, 6] },
      { at: 33, pos: [0, 0, 8] },
      { at: 40, pos: [0, 0, 7.6] },
    ],
    method: 'Parçacık-ağ kütleçekimi + basitleştirilmiş gaz, σ/m = 0. Parlaklık X-ışını (∝ ρ²), sıcaklık değil. Zaman hızlandırılmış: 1,2 milyar yıl ≈ 26 s.',
    lab: { tab: 'interaction', anchor: 'bullet' },
    build: async (stage, overlay) => (await import('./bulletChapter')).buildBullet(stage, overlay),
  },
  {
    id: 'unknowns',
    title: 'Bildiklerimiz, bilmediklerimiz',
    duration: Infinity,
    captions: [],
    method: 'Kapanış kartı. Arka plandaki sis, bir karanlık madde halesinin temsili çizimidir.',
    build: async (stage, overlay) => (await import('./unknownsChapter')).buildUnknowns(stage, overlay),
  },
];
