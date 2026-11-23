import lab from '../../data/generated/lab.json';
import { angularDiameter, comoving, einsteinMass, enclosedMass, growth, LY_PER_MPC, num, sci, virialMass } from './physics';

/** What a "show me" button does in the map. */
export type LabAction =
  | { kind: 'target'; id: string }
  | { kind: 'scale'; id: string }
  | { kind: 'layer'; layer: 'darkMatter' | 'gas' | 'flow' | 'basin' | 'galaxies' }
  | { kind: 'sim' }
  | { kind: 'tab'; tab: LabTab; anchor?: string };

export type LabTab = 'concepts' | 'experiments' | 'interaction' | 'plots' | 'data' | 'exercises';

export interface Concept {
  id: string;
  title: string;
  question: string;
  /** HTML: explanation, equations (.eq) and a worked example with this app's numbers (.worked). */
  body: () => string;
  actions: { label: string; action: LabAction }[];
}

const eq = (s: string) => `<div class="eq">${s}</div>`;
const worked = (title: string, steps: string[]) =>
  `<div class="worked"><p class="worked-h">${title}</p><ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>`;

export const CONCEPTS: Concept[] = [
  {
    id: 'hubble',
    title: 'Hubble yasası ve uzaklık',
    question: 'Bir galaksinin kırmızıya kaymasından uzaklığını nasıl buluruz?',
    body: () => {
      const cz = 6925;
      const d = cz / 70;
      return `
      <p>Evren genişlediği için uzak galaksiler bizden uzaklaşır; ışıklarının dalga boyu uzar (kırmızıya kayar). Yakın evrende hız uzaklıkla orantılıdır:</p>
      ${eq('v = H<sub>0</sub> · d &nbsp;&nbsp;&nbsp; z = Δλ / λ &nbsp;&nbsp;&nbsp; v ≈ c z &nbsp;(z ≪ 1)')}
      <p>Ancak ölçülen hız, genişleme ile galaksinin kendi hareketinin (<em>özgün hız</em>, v<sub>pec</sub>) toplamıdır: <span class="inl">cz = H<sub>0</sub> d + v<sub>pec</sub></span>. Bu yüzden kırmızıya kaymadan bulunan uzaklık ±v<sub>pec</sub>/H<sub>0</sub> kadar yanılır; 500 km/s’lik bir özgün hız 7 Mpc demektir.</p>
      ${worked('Örnek: Saç Kümesi', [
        `Ölçülen kırmızıya kayma: cz = ${num(cz, 0)} km/s`,
        `d = cz / H<sub>0</sub> = ${num(cz, 0)} / 70 = <b>${num(d)} Mpc</b>`,
        `= ${num((d * LY_PER_MPC) / 1e6, 0)} milyon ışık yılı`,
      ])}
      <p class="note">Bu haritadaki 2MRS galaksileri cz / H<sub>0</sub>’dan yerleştirildi (<em>kırmızıya kayma uzayı</em>). Veri sekmesinde özgün hızlar çıkarılmış <em>gerçek uzay</em> konumlarına geçebilirsin. Uzak evrende (z ≳ 0,1) doğrusal yasa yetmez; uzaklık ΛCDM ile integralden hesaplanır: z = 0,3 için ${num(comoving(0.3), 0)} Mpc (eş hareketli).</p>`;
    },
    actions: [
      { label: 'Hubble diyagramını aç', action: { kind: 'tab', tab: 'plots', anchor: 'hubble' } },
      { label: 'Saç Kümesi’ne git', action: { kind: 'target', id: 'coma' } },
    ],
  },
  {
    id: 'virial',
    title: 'Virial teoremi: Zwicky’nin hesabı',
    question: 'Bir kümenin kütlesini galaksilerinin hızlarından nasıl buluruz?',
    body: () => {
      const s = 1000;
      const R = 1.5;
      const M = virialMass(s, R);
      const Mstar = 1.5e13;
      return `
      <p>Kütleçekimiyle dengelenmiş (virialize olmuş) bir sistemde ortalama kinetik ve potansiyel enerji arasında basit bir ilişki vardır:</p>
      ${eq('2⟨K⟩ + ⟨U⟩ = 0')}
      <p>Düzgün bir küre için U = −(3/5) G M² / R ve K = (3/2) M σ² (σ: tek eksendeki hız dağılımı). Buradan:</p>
      ${eq('M ≈ 5 σ<sup>2</sup> R / G')}
      ${worked('Örnek: Saç Kümesi', [
        `σ ≈ ${num(s, 0)} km/s = 10<sup>6</sup> m/s, R ≈ ${num(R)} Mpc = ${sci(R * 3.0857e22)} m`,
        `M = 5 × (10<sup>6</sup>)² × ${sci(R * 3.0857e22)} / 6,674 × 10⁻¹¹ = <b>${sci(M)} M☉</b>`,
        `Yıldızlar ≈ ${sci(Mstar)} M☉, sıcak gaz ≈ 1,5 × 10¹⁴ M☉ → görünen madde, gereken kütlenin ancak %${num(((Mstar + 1.5e14) / M) * 100, 0)}’i`,
      ])}
      <p class="note">Zwicky 1933’te gazı bilmiyordu; yalnızca yıldız ışığıyla kıyasladı ve yüzlerce kat fark buldu. Bugün gaz da sayılınca fark ~6 kat; yine de büyük çoğunluk görünmez.</p>`;
    },
    actions: [
      { label: 'Saç Kümesi’ne git', action: { kind: 'target', id: 'coma' } },
      { label: 'Sıcak gaz katmanını aç', action: { kind: 'layer', layer: 'gas' } },
    ],
  },
  {
    id: 'rotation',
    title: 'Dönme eğrileri ve karanlık madde halesi',
    question: 'Galaksinin kenarındaki yıldızlar neden beklenenden hızlı dönüyor?',
    body: () => {
      const v = 124;
      const r = 14;
      const M = enclosedMass(v, r);
      return `
      <p>Dairesel yörüngede çekim, merkezcil kuvveti sağlar. Yalnızca r’nin içindeki kütle önemlidir:</p>
      ${eq('v<sup>2</sup> / r = G M(&lt;r) / r<sup>2</sup> &nbsp;⇒&nbsp; v(r) = √( G M(&lt;r) / r )')}
      <p>Kütle merkezde toplanmışsa dışarıda M sabit kalır ve hız <span class="inl">v ∝ r<sup>−1/2</sup></span> düşer (Kepler, Güneş sistemi gibi). Ölçülen eğriler düz kalıyorsa M(&lt;r) ∝ r demektir: kütle görünen maddenin çok dışına uzanır. Simülasyonlar bu halenin yoğunluk profilini verir (NFW):</p>
      ${eq('ρ(r) = ρ<sub>s</sub> / [ (r/r<sub>s</sub>) (1 + r/r<sub>s</sub>)<sup>2</sup> ]')}
      ${worked('Örnek: M33', [
        `${r} kpc’de ölçülen hız ≈ ${v} km/s`,
        `M(&lt;${r} kpc) = v² r / G = (${v} × 10³)² × ${r} × 3,086 × 10¹⁹ / 6,674 × 10⁻¹¹ = <b>${sci(M)} M☉</b>`,
        `Yıldızlar + gaz ≈ 1 × 10¹⁰ M☉ → kütlenin ~%${num((1e10 / M) * 100, 0)}’i görünür`,
      ])}`;
    },
    actions: [
      { label: 'Deney: haleyi kendin uydur', action: { kind: 'tab', tab: 'experiments', anchor: 'rotation' } },
      { label: 'M33’e git', action: { kind: 'target', id: 'lg-Üçgen (M33)' } },
    ],
  },
  {
    id: 'lensing',
    title: 'Kütleçekimsel mercek',
    question: 'Işığın bükülmesinden kütleyi nasıl ölçeriz?',
    body: () => {
      const th = 45;
      const zl = 0.183;
      const zs = 1;
      const M = einsteinMass(th, zl, zs);
      const rKpc = ((th / 3600) * Math.PI) / 180 * angularDiameter(zl) * 1000;
      return `
      <p>Genel görelilikte kütle ışığı büker. b uzaklığından geçen ışın α = 4GM/(c²b) kadar sapar. Kaynak, mercek ve gözlemci aynı hizadaysa görüntü bir halka olur; yarıçapı (Einstein açısı):</p>
      ${eq('θ<sub>E</sub> = √( (4 G M / c<sup>2</sup>) · D<sub>ls</sub> / (D<sub>l</sub> D<sub>s</sub>) )')}
      <p>D’ler açısal-çap uzaklıklarıdır. θ<sub>E</sub> ölçülünce, ışığa ya da dinamiğe bakmadan, halkanın içindeki <em>toplam</em> kütle bulunur.</p>
      ${worked('Örnek: Abell 1689', [
        `θ<sub>E</sub> ≈ ${th}″, z<sub>mercek</sub> = ${zl}, z<sub>kaynak</sub> ≈ ${zs}`,
        `D<sub>l</sub> = ${num(angularDiameter(zl), 0)} Mpc, D<sub>s</sub> = ${num(angularDiameter(zs), 0)} Mpc (ΛCDM)`,
        `M(&lt;θ<sub>E</sub>) = θ<sub>E</sub>² c² D<sub>l</sub> D<sub>s</sub> / (4 G D<sub>ls</sub>) = <b>${sci(M)} M☉</b> (merkezden ~${num(rKpc, 0)} kpc içinde)`,
        'Aynı bölgedeki yıldız ve gaz bunun ancak küçük bir kesri.',
      ])}`;
    },
    actions: [
      { label: 'Abell 1689’a git', action: { kind: 'target', id: 'a1689' } },
      { label: 'Mermi Kümesi’ne git', action: { kind: 'target', id: 'bullet' } },
    ],
  },
  {
    id: 'linear',
    title: 'Doğrusal kuram: yoğunluktan akışa',
    question: 'Galaksilerin dağılımından hızlarını nasıl tahmin ederiz?',
    body: () => {
      const f = 0.3 ** 0.55;
      const c = lab.cf4;
      return `
      <p>Yoğunluk farkları küçükken (δ = ρ/ρ̄ − 1 ≪ 1) maddenin korunumu ve Poisson denklemi birleşir; özgün hız, yoğunluk alanının çekiminden gelir:</p>
      ${eq('∇ · v = − H<sub>0</sub> f δ &nbsp;&nbsp;&nbsp; v(r) = (H<sub>0</sub> f / 4π) ∫ δ(r′) (r′ − r) / |r′ − r|<sup>3</sup> d<sup>3</sup>r′')}
      <p>f ≈ Ω<sub>m</sub><sup>0,55</sup> büyüme hızıdır. Galaksiler karanlık maddeyi birebir izlemez, bir <em>yanlılıkla</em> (bias) izler: δ<sub>g</sub> = b δ<sub>m</sub>. Galaksilerden hesaplanan hız bu yüzden β = f / b ile ölçeklenir.</p>
      ${worked('Bu haritanın uydurması', [
        `2MRS yoğunluk alanından v<sub>1</sub>(r) (β = 1 için) hesaplandı (Fourier uzayında: v(k) = i H<sub>0</sub> δ(k) k / k²).`,
        `Cosmicflows-4’ün cz &lt; ${num(c.fitCz, 0)} km/s olan ${num(c.fitGroups, 0)} grubunun ölçülen özgün hızına v<sub>r</sub> = β u·v<sub>1</sub> + u·V<sub>dış</sub> ağırlıklı en küçük karelerle uyduruldu.`,
        `Sonuç: <b>β = ${num(c.beta, 2)}</b>, V<sub>dış</sub> = ${c.vExtMag} km/s (RA ${c.vExtRa}°, Dec ${c.vExtDec}°).`,
        `Literatür (Carrick ve ark. 2015, aynı 2MRS türü veri): <b>β = 0,43 ± 0,02</b>, V<sub>dış</sub> = 159 ± 23 km/s. Bizim β açıkça düşük; b = f / β = ${num(f / c.beta, 1)} de gerçekçi değil (2MRS için b ≈ 1,2).`,
      ])}
      <p><b>Neden düşük?</b> Bu, regresyonun öğretici bir tuzağı: <em>öngörücü</em> (burada u·v<sub>1</sub>) gürültülüyse en küçük kareler eğimi sıfıra doğru çekilir (regresyon seyrelmesi). Bizim yoğunluk alanı ham: uzakta az sayıda galaksi büyük ağırlıklarla sayılıyor ve atış gürültüsü öngörülen hızları şişiriyor. Profesyonel analizler alanı önce <em>Wiener süzgeciyle</em> gürültüden arındırır ve uzaklık hatalarını olabilirlik (likelihood) içinde modeller; o zaman β ≈ 0,43 çıkar. Uzaktaki gruplar eklendikçe bizim β daha da düşer (Deneyler sekmesinde dene).</p>
      <p class="note">Akış çizgilerinin <em>yönü</em> ve Laniakea sınırı β’dan bağımsızdır (alan yalnızca ölçeklenir); etkilenen yalnızca hızların büyüklüğü.</p>`;
    },
    actions: [
      { label: 'Deney: β’yı kendin bul', action: { kind: 'tab', tab: 'experiments', anchor: 'beta' } },
      { label: 'Akış katmanını aç', action: { kind: 'layer', layer: 'flow' } },
      { label: 'Laniakea sınırını aç', action: { kind: 'layer', layer: 'basin' } },
    ],
  },
  {
    id: 'growth',
    title: 'Yapı nasıl büyür ve neden karanlık madde gerekir?',
    question: 'CMB’deki minik dalgalanmalar nasıl galaksilere dönüştü?',
    body: () => {
      const aRec = 1 / 1100;
      const g = growth(1) / growth(aRec);
      return `
      <p>Genişleyen evrende küçük yoğunluk farkları kendi çekimleriyle büyür. Doğrusal kuramda δ(a, x) = D(a) δ<sub>0</sub>(x); madde baskın dönemde D ∝ a. Friedmann denklemi genişlemeyi verir:</p>
      ${eq('H<sup>2</sup>(a) = H<sub>0</sub><sup>2</sup> [ Ω<sub>r</sub> a<sup>−4</sup> + Ω<sub>m</sub> a<sup>−3</sup> + Ω<sub>Λ</sub> ]')}
      ${worked('Neden normal madde tek başına yetmez?', [
        'CMB’de sıcaklık farkları ΔT/T ≈ 10⁻⁵: normal maddenin yoğunluk farkı da bu mertebede (z ≈ 1100).',
        `Saydamlaşmadan bugüne doğrusal büyüme: D(1) / D(1/1100) ≈ <b>${num(g, 0)}</b> kat (Λ’nın frenlemesiyle).`,
        `10⁻⁵ × ${num(g, 0)} ≈ ${sci(1e-5 * g, 1)}: galaksi oluşması için δ ~ 1 gerekirdi. <b>Yetmez.</b>`,
        'Karanlık madde ışınımla etkileşmediği için madde baskın döneme geçişten (z ≈ 3400) beri büyüyordu; saydamlaşmada farkları zaten çok daha büyüktü. Normal madde sonra onun çukurlarına düştü.',
      ])}
      <p>Zel’dovich yaklaşımı bu büyümeyi parçacıklarla gösterir: her parçacık başlangıç konumu q’dan sabit bir yönde, D(t) ile ölçeklenen kadar kayar:</p>
      ${eq('x(q, t) = q + D(t) ψ(q) &nbsp;&nbsp;&nbsp; ∇<sub>q</sub> · ψ = − δ<sub>0</sub>(q)')}`;
    },
    actions: [
      { label: 'Oluşum benzetimini aç', action: { kind: 'sim' } },
      { label: 'Deney: karanlık madde olmasaydı', action: { kind: 'tab', tab: 'experiments', anchor: 'sim' } },
    ],
  },
  {
    id: 'budget',
    title: 'Evrenin bileşimi nasıl ölçülüyor?',
    question: '%5 normal madde, %27 karanlık madde sayıları nereden geliyor?',
    body: () => `
      <p>Üç bağımsız ölçüm aynı sonuca varır:</p>
      <ul>
        <li><b>Büyük Patlama çekirdek sentezi:</b> İlk dakikalarda oluşan döteryum ve helyum oranları, normal madde yoğunluğuna çok duyarlıdır: Ω<sub>b</sub> h² ≈ 0,022.</li>
        <li><b>CMB güç spektrumu:</b> Akustik tepelerin göreli yükseklikleri Ω<sub>b</sub>’yi, konumları ve genel şekli Ω<sub>m</sub>’yi verir (Planck: Ω<sub>b</sub> = 0,049, Ω<sub>m</sub> = 0,315).</li>
        <li><b>Kümeler ve galaksi dağılımı:</b> Küme gaz kesri, zayıf mercek, baryon akustik salınımları.</li>
      </ul>
      ${eq('Ω<sub>KM</sub> / Ω<sub>b</sub> = (0,315 − 0,049) / 0,049 ≈ 5,4')}
      <p class="note">Karanlık enerji (Ω<sub>Λ</sub> ≈ 0,685) ise uzak süpernovaların beklenenden sönük görünmesinden (1998) ve CMB ile birlikte düz geometriden çıkar.</p>`,
    actions: [{ label: 'Kozmik mikrodalga arka plan', action: { kind: 'scale', id: 'observable' } }],
  },
];

export interface Method {
  id: string;
  title: string;
  data: string;
  method: string;
  limits: string;
  refs: { text: string; url: string }[];
}

const ax = (id: string) => `https://arxiv.org/abs/${id}`;

export const METHODS: Method[] = [
  {
    id: '2mrs',
    title: 'Yakın evren galaksileri (2MRS)',
    data: '2MASS Redshift Survey: K<sub>s</sub> ≤ 11,75 kadirden parlak 44 599 galaksi, |b| > 5° (merkez yönünde 8°), bütün gökyüzü. Haritada cz ≥ 300 km/s olan 43 463 galaksi.',
    method: 'Konum = yön × cz / H<sub>0</sub> (H<sub>0</sub> = 70). Mutlak kadir M<sub>K</sub> = K − μ(d); renk Hubble tipine göre (erken tip turuncu, geç tip mavi).',
    limits: 'Kırmızıya kayma uzayında: özgün hızlar konumları ~±5 Mpc kaydırır, kümeler görüş yönünde uzar. Akı sınırlı: uzakta yalnızca parlak galaksiler var. Samanyolu düzlemi (|b| < 5–8°) boş.',
    refs: [{ text: 'Huchra ve ark. 2012, ApJS 199, 26', url: ax('1108.0669') }],
  },
  {
    id: 'density',
    title: 'Karanlık madde yoğunluk haritası',
    data: '2MRS galaksileri; seçim fonksiyonu için K bandı Schechter fonksiyonu (Kochanek ve ark. 2001).',
    method: 'Her galaksi 1/φ(d) ağırlığıyla (en fazla 10) ızgaraya konur; boş Samanyolu şeridi, |b| = 6–12° arasındaki galaksilerin aynalanmasıyla doldurulur; δ = ρ/ρ̄ − 1, 3 Mpc Gauss ile yumuşatılır (256³ ızgara, ±200 Mpc).',
    limits: 'Ölçülen şey galaksi yoğunluğu: karanlık madde, δ<sub>m</sub> = δ<sub>g</sub> / b varsayımıyla çıkarılır (b ≈ 1,2). 190 Mpc’nin ötesi ve şeritin içi tahmin. Küçük ölçeklerde atış gürültüsü.',
    refs: [
      { text: 'Kochanek ve ark. 2001, ApJ 560, 566', url: ax('astro-ph/0011456') },
      { text: 'Carrick ve ark. 2015, MNRAS 450, 317 (benzer yöntem, 2M++)', url: ax('1504.04627') },
    ],
  },
  {
    id: 'flow',
    title: 'Galaksi akışı ve Laniakea',
    data: 'Yoğunluk alanı (yukarıda) ve Cosmicflows-4’ün 38 000 galaksi grubunun uzaklıkları ve özgün hızları.',
    method: 'Doğrusal kuram, 9 Mpc yumuşatma, 128³ FFT. β ve dış toplu akış, cz &lt; 4000 km/s olan CF4 gruplarının hızlarına ağırlıklı en küçük karelerle uyduruldu (Wiener süzgeci yok: β düşük çıkar, bkz. Kavramlar). Akış çizgileri yerel alanda (toplu akış hariç) izlendi; Laniakea = Samanyolu’nun aktığı noktaya akan bölge (çekim havzası, Tully ve ark. 2014 tanımı).',
    limits: 'Doğrusal kuram kümelerin içinde geçersiz. CF4 uzaklık hataları ~%20. Havza sınırı yumuşatma ölçeğine duyarlıdır: daha ince yumuşatmada Samanyolu Başak Kümesi’ne akar, daha kaba yumuşatmada Laniakea çıkar.',
    refs: [
      { text: 'Tully ve ark. 2023, ApJ 944, 94 (Cosmicflows-4)', url: ax('2209.11238') },
      { text: 'Tully ve ark. 2014, Nature 513, 71 (Laniakea)', url: ax('1409.0880') },
      { text: 'Carrick ve ark. 2015, MNRAS 450, 317', url: ax('1504.04627') },
    ],
  },
  {
    id: 'sdss',
    title: 'Kozmik ağ (SDSS)',
    data: 'SDSS DR17 tayf ölçümü olan galaksiler, 0,01 < z < 0,2, üçte biri (259 920).',
    method: 'Uzaklık ΛCDM eş hareketli uzaklıktan (Ω<sub>m</sub> = 0,3). Gök ekvatoru şeridi (|Dec| < 6°) vurgulu.',
    limits: 'Kuzey gökyüzü ağırlıklı; akı sınırlı (uzakta yalnızca parlaklar); kırmızıya kayma uzayında.',
    refs: [{ text: 'Abdurro’uf ve ark. 2022, ApJS 259, 35 (DR17)', url: ax('2112.02026') }],
  },
  {
    id: 'gas',
    title: 'Sıcak küme gazı (MCXC)',
    data: 'ROSAT X-ışını kümeleri kataloğu: 1743 küme, L<sub>500</sub>, M<sub>500</sub>, R<sub>500</sub>.',
    method: 'Her küme R<sub>500</sub>’ün 1,5 katı yarıçaplı pembe ışıltı; parlaklık √L<sub>500</sub> ile.',
    limits: 'Yalnızca X-ışınında parlak kümeler; galaksiler arası sıcak gaz (WHIM) gösterilmiyor.',
    refs: [{ text: 'Piffaretti ve ark. 2011, A&A 534, A109', url: ax('1007.1916') }],
  },
  {
    id: 'localgroup',
    title: 'Yerel Grup',
    data: 'McConnachie 2012 kataloğu (uzaklık, parlaklık, yarı-ışık yarıçapı); 20 galaksi için gerçek fotoğraf.',
    method: 'Fotoğrafların gökyüzü arka planı çıkarıldı; ölçülen yarı-ışık yarıçapı katalogdakine eşlenerek gerçek boyutta çizildi, Samanyolu’ndan görünen yönelimle.',
    limits: 'Fotoğraflar düz kart: başka açıdan bakınca 3B yapı yok. M31, M33, BMB boyutları görünür diskten.',
    refs: [{ text: 'McConnachie 2012, AJ 144, 4', url: ax('1204.1562') }],
  },
  {
    id: 'cmb',
    title: 'Kozmik mikrodalga arka plan',
    data: 'WMAP 9 yıllık ILC haritası (HEALPix, N<sub>side</sub> = 512).',
    method: 'Galaktik koordinatlarda eşdikdörtgen dokuya çevrildi; ±0,3 mK renk ölçeği; küre yarıçapı z = 1090’ın eş hareketli uzaklığı.',
    limits: 'ILC haritası ön plan temizlenmiş ama galaktik düzlemde kalıntı var; daha keskin harita için Planck.',
    refs: [
      { text: 'Bennett ve ark. 2013, ApJS 208, 20 (WMAP 9)', url: ax('1212.5225') },
      { text: 'Planck 2018 VI, A&A 641, A6', url: ax('1807.06209') },
    ],
  },
  {
    id: 'sim',
    title: 'Oluşum benzetimi',
    data: 'Gauss rastgele başlangıç alanı; BBKS aktarım fonksiyonu, n<sub>s</sub> = 1.',
    method: 'Zel’dovich yaklaşımı, 64³ parçacık, 200 Mpc kutu; 1,6 Mpc kesmeyle kabuk kesişmesi geciktirildi. Gaz: aynı alan 3,5 Mpc daha yumuşatılmış. Galaksiler: bugünkü en yoğun %7’lik bölgedeki parçacıklar, yoğunluğa göre erken oluşur.',
    limits: 'Doğrusal ötesi (hale içi) dinamik yok; kümeler gerçek benzetimlerdeki kadar yoğunlaşmaz. Gaz fiziği ve yıldız oluşumu temsili.',
    refs: [
      { text: 'Zel’dovich 1970, A&A 5, 84', url: 'https://ui.adsabs.harvard.edu/abs/1970A%26A.....5...84Z' },
      { text: 'Bardeen ve ark. 1986, ApJ 304, 15 (BBKS)', url: 'https://ui.adsabs.harvard.edu/abs/1986ApJ...304...15B' },
    ],
  },
  {
    id: 'evidence',
    title: 'Kanıt durakları',
    data: 'M33 dönme eğrisi, Saç Kümesi, Abell 1689 ve Mermi Kümesi görüntüleri.',
    method: 'Dönme eğrisi değerleri yayımlanmış eğrilerden yuvarlatıldı; görüntüler NASA/ESA/NOIRLab.',
    limits: 'Dönme eğrisi noktaları yaklaşık; hata çubukları temsili.',
    refs: [
      { text: 'Corbelli ve Salucci 2000, MNRAS 311, 441', url: ax('astro-ph/9909252') },
      { text: 'Clowe ve ark. 2006, ApJ 648, L109 (Mermi Kümesi)', url: ax('astro-ph/0608407') },
      { text: 'Navarro, Frenk ve White 1997, ApJ 490, 493 (NFW)', url: ax('astro-ph/9611107') },
      { text: 'Shull ve ark. 2012, ApJ 759, 23 (baryon sayımı)', url: ax('1112.2706') },
    ],
  },
];

export interface Exercise {
  id: string;
  q: string;
  /** Numeric answer and relative tolerance, or a choice. */
  answer?: { value: number; tol: number; unit: string };
  choices?: { text: string; correct?: boolean }[];
  hint: string;
  solution: string;
}

export const EXERCISES: Exercise[] = [
  {
    id: 'e1',
    q: 'Bir galaksinin kırmızıya kayması cz = 3500 km/s. H<sub>0</sub> = 70 km/s/Mpc ise uzaklığı kaç Mpc?',
    answer: { value: 50, tol: 0.03, unit: 'Mpc' },
    hint: 'v = H<sub>0</sub> d',
    solution: 'd = 3500 / 70 = 50 Mpc (≈ 163 milyon ışık yılı). Özgün hızı 300 km/s ise gerçek uzaklık ±4 Mpc farklı olabilir.',
  },
  {
    id: 'e2',
    q: 'Bir kümenin hız dağılımı σ = 800 km/s, yarıçapı R = 1 Mpc. Virial kütlesi kaç M☉? (10’un üssü olarak, ör. 7.4e14)',
    answer: { value: virialMass(800, 1), tol: 0.1, unit: 'M☉' },
    hint: 'M ≈ 5 σ² R / G; 1 Mpc = 3,086 × 10²² m, M☉ = 1,989 × 10³⁰ kg',
    solution: `M = 5 × (8 × 10⁵)² × 3,086 × 10²² / 6,674 × 10⁻¹¹ ≈ ${sci(virialMass(800, 1))} M☉.`,
  },
  {
    id: 'e3',
    q: 'Güneş, Samanyolu merkezinden 8 kpc uzakta saniyede 220 km hızla dönüyor. Güneş’in yörüngesinin içindeki kütle kaç M☉?',
    answer: { value: enclosedMass(220, 8), tol: 0.1, unit: 'M☉' },
    hint: 'M = v² r / G',
    solution: `M = (2,2 × 10⁵)² × 8 × 3,086 × 10¹⁹ / 6,674 × 10⁻¹¹ ≈ ${sci(enclosedMass(220, 8))} M☉.`,
  },
  {
    id: 'e4',
    q: 'M33’te görünen madde 4 kpc’de 66 km/s verir. Bütün kütle 4 kpc’nin içinde olsaydı, 16 kpc’deki hız kaç km/s olurdu?',
    answer: { value: 33, tol: 0.05, unit: 'km/s' },
    hint: 'Kütlenin dışında v ∝ r<sup>−1/2</sup>',
    solution: 'v = 66 × (4/16)<sup>1/2</sup> = 33 km/s. Ölçülen ise ~126 km/s: aradaki fark karanlık madde halesi.',
  },
  {
    id: 'e5',
    q: 'Mermi Kümesi’nde çarpışmadan sonra sıcak gaz neden iki kütle merkezinin arasında kaldı?',
    choices: [
      { text: 'Gaz bulutları çarpışırken birbirine sürtünüp (ram basıncı) yavaşladı; galaksiler ve karanlık madde ise neredeyse hiç etkileşmeden geçti.', correct: true },
      { text: 'Gaz daha hafif olduğu için çekim onu daha az etkiledi.' },
      { text: 'Karanlık madde gazı itti.' },
    ],
    hint: 'Galaksiler arasındaki uzaklıklar dev; gaz ise bütün kümeyi dolduruyor.',
    solution: 'Galaksiler (ve karanlık madde) birbirine neredeyse değmez; gaz ise sürekli bir akışkan gibi çarpışır ve yavaşlar. Kütle haritasının (mercek) galaksilerle birlikte gitmesi, kütlenin çoğunun gazda değil çarpışmasız bir bileşende olduğunu gösterir.',
  },
  {
    id: 'e6',
    q: 'Büyüme hızı f = 0,52 ve ölçülen β = 0,43 ise galaksi yanlılığı b kaçtır?',
    answer: { value: 0.52 / 0.43, tol: 0.03, unit: '' },
    hint: 'β = f / b',
    solution: 'b = 0,52 / 0,43 ≈ 1,21: galaksiler maddeden %21 daha kümeli.',
  },
  {
    id: 'e7',
    q: 'Madde baskın bir evrende δ ∝ a. Normal maddenin z = 1100’deki yoğunluk farkı 10⁻⁵ ise, yalnızca bu büyümeyle bugün (a = 1) kaç olurdu?',
    answer: { value: 1.1e-2, tol: 0.1, unit: '' },
    hint: 'a = 1/(1+z)',
    solution: 'δ<sub>bugün</sub> ≈ 10⁻⁵ × 1101 ≈ 1,1 × 10⁻²: galaksi oluşması için gereken δ ~ 1’in çok altında. Karanlık madde olmadan bugünkü yapılar oluşamazdı.',
  },
  {
    id: 'e8',
    q: 'Hubble zamanı 1/H<sub>0</sub> kaç milyar yıl? (H<sub>0</sub> = 70 km/s/Mpc)',
    answer: { value: 13.97, tol: 0.02, unit: 'milyar yıl' },
    hint: '1 Mpc = 3,086 × 10¹⁹ km; 1 yıl = 3,156 × 10⁷ s',
    solution: '1/H<sub>0</sub> = 3,086 × 10¹⁹ / 70 s = 4,41 × 10¹⁷ s ≈ 13,97 milyar yıl. Evrenin gerçek yaşı (13,8) buna yakın; bu bir tesadüf değil, madde ve karanlık enerjinin etkilerinin yaklaşık dengelenmesi.',
  },
];

/**
 * Scene 4: what is known about dark matter and what is still a hypothesis,
 * kept strictly apart. Facts are textbook-level; candidate statuses as of 2024–25.
 */
export const DM_UNKNOWNS = `
  <p>Karanlık madde ile normal madde arasında <b>bilinen tek etkileşim kütleçekimidir</b>. Başka bir etkileşim varsa çok zayıftır; aşağıdaki deneyler bunu arıyor.</p>
  <h4 class="comp-h">Bildiğimiz (gözlemle sınanmış)</h4>
  <ul>
    <li><b>Normal madde değil:</b> Büyük Patlama çekirdek sentezi ve CMB, baryon miktarını Ω<sub>b</sub> ≈ 0,049 ile sınırlar; toplam madde ise Ω<sub>m</sub> ≈ 0,31.</li>
    <li><b>Neredeyse çarpışmasız:</b> Mermi Kümesi ve benzer çarpışan kümeler kendi kendine çarpışmayı σ/m ≲ 1 cm²/g ile sınırlar (Sahne 2).</li>
    <li><b>Soğuk (ya da en fazla ılık):</b> Küçük ölçekli yapılar (Lyman-α ormanı, cüce galaksiler) karanlık maddenin erken evrende yavaş hareket ettiğini gösterir.</li>
    <li><b>Kararlı ve ışık saçmaz:</b> Evrenin yaşı boyunca bozunmamış; ışıkla etkileşimi ölçülemeyecek kadar küçük.</li>
  </ul>
  <h4 class="comp-h">Adaylar (henüz hiçbiri bulunmadı)</h4>
  <dl class="lab-kv">
    <dt>WIMP</dt><dd>Zayıf etkileşen, ~10 GeV – 10 TeV kütleli parçacık. Doğrudan arama: ksenon dedektörleri (XENONnT, LZ, PandaX); dolaylı: cüce galaksilerden gama ışını (Fermi-LAT); hızlandırıcı: LHC. Sonuç: etkileşim kesitinde ~10⁻⁴⁷ cm² mertebesine kadar iniliyor, sinyal yok.</dd>
    <dt>Aksiyon</dt><dd>Güçlü kuvvetteki bir simetri sorununu çözmek için önerilmiş çok hafif parçacık (μeV – meV). Arama: manyetik alanda mikrodalgaya dönüşmesi (ADMX haloskopu), Güneş’ten gelen aksiyonlar (CAST, gelecekte IAXO). Bazı kütle aralıkları dışlandı.</dd>
    <dt>Steril nötrino</dt><dd>keV kütleli, yalnızca kütleçekimi ve karışımla etkileşen nötrino; ılık karanlık madde. 2014’te iddia edilen 3,5 keV X-ışını çizgisi tartışmalı; Hitomi ve XRISM gözlemleri kesinleştirmedi.</dd>
    <dt>İlkel kara delikler</dt><dd>Erken evrende oluşmuş olabilecek kara delikler. Kütleçekimsel mikromercek taramaları (EROS, OGLE, Subaru HSC) ve CMB geniş kütle aralıklarını dışladı; asteroit kütleli küçük bir aralık hâlâ açık.</dd>
    <dt>Ultra hafif (“bulanık”) KM</dt><dd>~10⁻²² eV kütleli, galaksi ölçeğinde dalga gibi davranan alan; cücelerde çekirdek oluşturur. Lyman-α ormanı verisi bu kütleyi alttan sınırlıyor.</dd>
  </dl>
  <h4 class="comp-h">Karanlık madde yerine değiştirilmiş kütleçekimi?</h4>
  <p>MOND (Milgrom 1983) galaksilerin dönme eğrilerini karanlık madde olmadan şaşırtıcı iyi açıklar. Ama galaksi kümelerinde hâlâ eksik kütle bırakır, Mermi Kümesi’nde kütlenin gazdan ayrılmasını açıklamakta zorlanır ve CMB’deki akustik tepelerin göreli yüksekliklerini karanlık madde olmadan üretemez. Bu yüzden bugün çoğunluk görüşü karanlık maddeden yanadır; ama parçacığın kendisi bulunana kadar soru kapanmış sayılmaz.</p>`;
