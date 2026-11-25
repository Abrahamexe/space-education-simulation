# Karanlık madde ↔ normal madde: sinematik anlatım ve laboratuvar yenilemesi

Tarih: 2026-11-25 · Durum: onaylandı (kullanıcı, 2026-11-25)

## Niyet ve neden

Kullanıcı internette karanlık madde ile normal maddenin nerede ve nasıl etkileştiğini "oyun grafiği gibi",
animasyonlu ve sinematik gösteren web tabanlı bir çalışma gördü; bizim anlatımımızı ondan daha az anlaşılır ve
daha az etkileyici buluyor. Bugünkü "Etkileşim" sekmesi (src/ui/lab/Lab.ts → renderInteraction) fiziksel olarak
sağlam: BAO yarı-analitik modeli (scenes/bao.ts), Mermi Kümesi PM + hidro + Monte Carlo SIDM (scenes/bullet.worker.ts),
NFW halesinde Barnes-Hut + SPH galaksi oluşumu (scenes/galaxy.worker.ts). Ama sunum 460×300 px'lik düz 2D canvas
kareleri ve grafikler; "kutu içinde animasyon" gibi duruyor.

Amaç: aynı bilimi, izleyenin ilk bakışta anlayacağı ve etkileneceği bir görsel anlatımla vermek.

Tek ana mesaj (her bölüm bunun bir yüzü):
1. İki madde yalnızca kütleçekimiyle etkileşir.
2. Normal madde çarpışır, basınç kurar, ışınım yapıp soğur → merkeze çöker, parlar.
3. Karanlık madde bunların hiçbirini yapmaz → şişkin, görünmez bir hale olarak kalır, çarpışmada içinden geçer.

## Hedefler

- **G1 Sinematik hikâye ("film modu")**: tam ekran 3D Three.js sahnesi, kamera kendisi hareket eder, Türkçe
  kısa altyazı/anlatım kartları, bloom/post-FX, her bölüm 30–60 sn, durdur/ileri/geri ve bölüm atlama.
- **G2 Laboratuvar sahnelerinin yenilenmesi**: BAO, Mermi Kümesi ve galaksi oluşumu sahneleri aynı görsel dille
  (WebGL, parlayan parçacıklar, döndürülebilir 3D kamera, büyüt/tam ekran) yeniden çizilir; fizik worker'ları
  korunur, grafikler ve okumalar yerinde kalır.
- **G3** Her film bölümünün sonunda "Gerçek simülasyonda dene" → ilgili laboratuvar sahnesine gider.
- Iris Xe 1920×1080'de akıcı (hedef ≤ 16 ms/kare medium kalitede), RTX'te daha zengin.

## Hedef dışı

- Sesli anlatım, müzik (sonra eklenebilir).
- Yeni bir bilimsel model ya da yeni fizik iddiası.
- Masaüstü paketleme (kullanıcı erteledi).
- Ana güneş sistemi / galaksi görünümlerinin değiştirilmesi.

## Karşı-hedefler (çalışsa bile başarısızlık sayılır)

- Görsel uğruna yanlış fizik: karanlık maddenin "parladığı", gazla çarpıştığı ya da sürtündüğü izlenimi.
  Karanlık madde her zaman "görünmezin görselleştirilmesi" olarak işaretlenir (ör. "karanlık maddeyi göster"
  açıkken soğuk mor sis + altyazı "gerçekte görünmez").
- Ölçek ya da süre hilesi gizlenmemeli: hızlandırma/basitleştirme ekranda yazılı.
- Iris Xe'de takılan, siyah kare / NaN üreten bir sahne (bkz. mevcut NaN dersleri).
- Mevcut laboratuvarın ölçüm/grafik içeriğinin kaybolması.

## Kısıtlar

- Web, Three.js r186 + postprocessing 6.x, Vite, TypeScript; yeni ağır bağımlılık yok.
- Lab paneli UniverseHud içinde açılıyor (src/ui/UniverseHud.ts → Lab); film modu kendi tam ekran katmanında,
  kendi renderer'ı ile (ana Engine'e dokunmadan; ana sahne film açıkken durdurulur).
- Shader'lar NaN-güvenli yazılır (smoothstep eşit kenar yok, negatif tabanın pow'u yok), PostFX sanitize düzeni izlenir.
- Lisans: yalnızca açıkça lisanslı görseller (arka plan galaksileri gerekiyorsa kendi prosedürel üretimimiz).
- Tüm metinler Türkçe.

## Yaklaşımlar

| | Yol | Artı | Eksi |
|---|---|---|---|
| **A (seçildi)** | 3D sinematik hikâye + laboratuvara bağlantı | En büyük etki, anlatımı biz yönetiriz | En pahalısı (birkaç oturum) |
| B | Yalnız mevcut 2D sahneleri WebGL 3D'ye taşımak | Ucuz, fizik birebir | Hikâye/kamera yok, yine "laboratuvar" hissi |
| C | A + B'nin hafif hali | Dengeli | — |

Kullanıcı A'yı seçti ve laboratuvar sahnelerinin de "aynı mantıkla güzelleştirilmesini" istedi; yani pratikte A + B'nin
tam hali. Ortak bir 3D parçacık görselleştirme çekirdeği ikisini birden besler.

## Tasarım

### Ortak çekirdek: `src/ui/darkmatter/render/`
- Kendi `WebGLRenderer` + `EffectComposer` (bloom, hafif vignette, film greni, sanitize) kuran küçük bir sahne sınıfı.
- Parçacık katmanları (Points, additive, yumuşak sprite, boyut ∝ ekran):
  - **Karanlık madde**: soğuk mor/indigo, düşük opaklık sis + yoğunluktan türetilmiş hacim izlenimi; aç/kapa.
  - **Gaz**: sıcaklığa göre renk (soğuk mavi-beyaz → sıcak pembe, mevcut T_STOPS paleti), X-ışını sıcaklığında parlama.
  - **Yıldızlar**: sarı-beyaz keskin noktalar, yaşa göre renk.
- Zaman aralıklı karelerin GPU'da yumuşak ara değerlenmesi (pozisyon a/b tamponları + uMix), böylece seyrek
  fizik kareleri 60 fps akıcı görünür.
- Kamera yolu: anahtar pozlar + gsap zaman çizelgesi; kullanıcı fareyle müdahale ederse yol duraklar.
- Kalite seviyesi: parçacık sayısı ve bloom çözünürlüğü QualityManager presetinden.

### Fizik verisinin kaynağı: önceden pişirilmiş (bake) gerçek simülasyon
- Film bölümleri canlı hesap yerine **mevcut worker fiziğinin daha yüksek çözünürlükte, Node'da önceden
  çalıştırılmış** kare dizilerini oynatır (spacecraft verisindeki düzenle aynı: `scripts/bake-darkmatter.mjs`
  → `public/data/darkmatter/*.bin`). Böylece hem sinematik yoğunluk hem dürüst fizik.
- Kozmik ağ bölümü için: Zel'dovich yaklaşımı (Gauss rastgele alanın FFT'si ile yer değiştirme); karanlık madde
  ve gaz aynı başlangıçtan, gaz basınç ölçeği altında yumuşatılmış. Analitik, ucuz, bilinen bir yöntem.
- Laboratuvar sahneleri ise canlı çalışmaya devam eder (kullanıcı parametre değiştirir).

### Film modu: `src/ui/darkmatter/Film.ts`
Açılış: Etkileşim sekmesinin en üstünde büyük "Filmi izle" kartı (+ Evren haritası HUD'unda bir düğme).
Tam ekran katman, Esc ile çıkış, alt kısımda bölüm çizgisi.

Bölümler:
1. **Karanlık ağ** — Büyük Patlama sonrası pürüzsüz dağılım; karanlık madde önce kümelenir, gaz basınç yüzünden
   geride kalır, sonra kuyulara akar. Altyazı: "Karanlık madde ışıkla etkileşmez, bu yüzden ilk çöken o olur."
   → Lab: BAO sahnesi.
2. **Halede bir galaksi** — kameraya yakın tek bir hale; gaz düşer, şok ile ısınır (pembe), ışınım yapıp soğur
   (mavi), diske çöker, yıldızlar yanar. Karanlık madde küre olarak kalır. "Karanlık maddeyi gizle" ile yalnız
   görünür galaksi. → Lab: galaksi oluşumu.
3. **Fazla hızlı dönen yıldızlar** — disk yandan; yıldızların hız okları; kenarda "beklenen" ile "ölçülen" hız
   eğrisi canlı çizilir; ardından hale belirir ve farkı açıklar. → Lab: Deneyler sekmesindeki M33 dönme eğrisi.
4. **Mermi Kümesi** — iki küme 3D'de çarpışır: gaz çarpışıp yavaşlar ve pembe parlar (X-ışını), karanlık madde ve
   galaksiler geçer; arka plan galaksilerinin görüntüsü kütle haritasıyla bükülür (zayıf mercek, ekran uzayı
   distorsiyonu, mevcut LensingEffect fikri). Sonda "mercek = kütle, X-ışını = gaz, ayrı yerlerde!" katmanı.
   → Lab: Mermi Kümesi.
5. **Bildiklerimiz / bilmediklerimiz** — kısa kapanış kartı (mevcut DM_UNKNOWNS metni).

### Laboratuvar sahneleri (G2)
- Üç sahne de ortak çekirdekle WebGL'e geçer: sahne kartı tam genişlik, 16:9, sürükle-döndür, "Büyüt" ile tam ekran.
- Fizik worker'ları ve mesaj tipleri olduğu gibi; worker çıktısı (2D projeksiyonlar) gerekirse 3D konumları
  da gönderecek şekilde genişletilir.
- Grafikler (plot.ts) ve okumalar kartın altında/yanında kalır; kaydırıcılar canlı.
- Mermi Kümesi'nde kontur ve "çarpışmasız / σ/m" kaydırıcısı korunur; 3D'de kütle konturu yerde bir ızgara
  olarak, X-ışını gazı parlayan bulut olarak.

## Kullanıcının kararları
- Yol A (sinematik hikâye) + laboratuvar sahnelerinin aynı görsel dille yenilenmesi.
- Web tabanlı kalacak.

## Benim kararlarım (düzeltilebilir)
- Bölüm listesi ve sırası (yukarıda).
- Altyazı/anlatım yalnız metin, ses yok.
- Film verisi önceden pişirilmiş gerçek simülasyon; laboratuvar canlı.
- Film kendi renderer'ında, ana motoru durdurarak.
- Sıra: (1) ortak çekirdek + Mermi Kümesi (hem film bölümü hem lab) → (2) galaksi oluşumu → (3) kozmik ağ/BAO →
  (4) dönme eğrisi bölümü → (5) cila ve performans ölçümü.

## Gözden geçirme sonrası netleştirmeler (benim kararlarım)
- **BAO sahnesi 3D'de**: 1-B yarı-analitik model korunur; 3D görünüm profillerden türetilen iç içe küresel
  kabuklardır (karanlık madde, baryon, foton ayrı renk; kalınlık/parlaklık ∝ r²·δ(r)). Sahnede açıkça
  "bu bir simülasyon değil, profilin 3D çizimi" yazar. Film bölüm 1 önce bu ses kabuğunu (aynı modelden), sonra
  Zel'dovich kozmik ağını gösterir; bu yüzden bölüm 1 → BAO bağlantısı geçerli.
- **Mermi Kümesi gaz rengi**: worker izotermal (enerji denklemi yok). Yeni fizik eklenmez; pembe parlaklık
  "X-ışını parlaklığı (∝ ρ²)" olarak etiketlenir, "sıcaklık" denmez. Sıcaklık paleti yalnız galaksi sahnesinde
  (SPH'de gerçek T var).
- **Tek seferde tek GPU yükü**: Lab'ın Etkileşim sahnesi görünürken (IntersectionObserver) ana Engine durur,
  görünmez olunca devam eder; film modunda da durur. Aynı anda yalnız görünür lab sahnesinin worker'ı çalışır.
  ≤16 ms hedefi lab sahneleri için de geçerli.
- **Film verisi**: "aynı kod, daha büyük N" şartı yok. Mermi Kümesi ve galaksi bölümleri worker modüllerini
  Node'da doğrudan içe aktarıp pişirir (galaksi için bake süresi ≤ ~1 saat olacak N seçilir). Kozmik ağ
  (Zel'dovich) ve dönme eğrisi (analitik NFW + disk) amaca özel üretilir; her bölümde kullanılan yöntem ve
  basitleştirme ekranda bir satırla yazılır.

## İnşacıya kalanlar
- Parçacık sayıları, sprite/sis shader detayları, bake çözünürlüğü ve dosya boyutu (≤ ~30 MB toplam hedefi).
- Kamera pozları ve zamanlama.
- Mercek distorsiyonunun tam formu (zayıf mercek, Born yaklaşımı yeterli).
