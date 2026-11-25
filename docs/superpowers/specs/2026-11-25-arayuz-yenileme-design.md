# Arayüz yenileme: "Görev Kontrol" dili, mevcut her şey korunarak

Tarih: 2026-11-25 · Durum: onaylandı (kullanıcı, 2026-11-25)

## Niyet ve neden

Kullanıcı bugünkü arayüzü projeye yakıştırmıyor. Yeni arayüzün "modern ama uzay temasına uygun, pahalı ama
anlaşılır" olmasını istiyor. Taslak turunda şunlar netleşti:

- **C (Görev Kontrol)** taslağının sol listesini ve sağdaki veri kartını beğendi: panelsiz, ince çizgili, mono
  büyük harfli etiketler, büyük ince başlık.
- **C'nin alt kısmını** (logaritmik cetvel) beğenmedi.
- **A'nın (Obsidyen Cam)** gri cam panellerini ve yuvarlak köşelerini beğenmedi. A'nın düzenini (üstte araçlar,
  altta zaman ve gezinme bandı) korumak istiyor.
- Sonuç **E taslağı** oldu. Kullanıcı bunu "istediğim şey bu" diye onayladı. Taslaklar:
  `public/__mock/ui-mock2.html#e`, `#f` (Güneş Sistemi), `#g` (galaksi), `#h` (evren). Bu dosya git'e girmez.

Kullanıcının tek koşulu: **eski arayüzdeki hiçbir bilgi, düğme, kısayol ya da özellik kaybolmayacak.**

## Hedefler

- Tüm ekranlar tek görsel dilde olacak: keskin köşe, 1 px ince çizgi, gri dolgu yok, mono büyük harfli etiket,
  ince ve büyük başlık, etkin durum için beyaz dolgu.
- Aynı iskelet her görünümde tekrar edecek: **üst satır** (kimlik ve araçlar), **sol sütun** ("neredeyim / nereye
  gidebilirim" listesi), **sağ sütun** (seçili şeyin verisi), **alt bant** (zaman, ölçek yolu, görünüm araçları).
- Bugünkü her öğenin yeni yerde bir karşılığı olacak. Aşağıdaki envanter bunun sözleşmesi.

## Hedef dışı

- Yeni bilimsel içerik, yeni görünüm ya da yeni özellik yok. İstisna: hedef köşe çerçevesi (aşağıda, isteğe bağlı).
- Laboratuvar, Film ve oyun alanının iç düzenleri değişmez; yalnızca yeni renk ve yazı dilini alırlar.
- Metinler değişmez. Uygulama adı ("Güneş Sistemi") ve tüm Türkçe metinler aynen kalır.

## Hedef karşıtları (çalışsa bile başarısızlık sayılır)

- Bir düğmenin, kısayolun, bilgi satırının ya da bildirimin sessizce kaybolması.
- Parlak sahnede (evren katmanları, Güneş yakını, galaksi diski) yazının okunamaz hale gelmesi.
- Mobilde (≤760 px) kullanılamaz olması.
- Kare hızının düşmesi. Arka planda büyük `backdrop-filter` kullanılmayacak.

## Yaklaşımlar

1. **Yeniden boyama ve yeniden yerleştirme (seçilen).** Bileşenlerin TypeScript mantığı, olay
   işleyicileri, kısayolları ve `aria` etiketleri aynı kalır. Değişen şeyler: `tokens.css` (renk, yazı, köşe),
   `hud.css` (yerleşim) ve gereken yerde bileşenlerin hangi kapsayıcıya eklendiği. Kayıp riski en düşük yol, çünkü
   işlevi taşıyan kod yerinde kalıyor.
2. **Sıfırdan yeni arayüz katmanı.** Daha temiz bir sonuç verirdi. Ama 8.700 satırlık arayüz kodundaki her davranışı
   yeniden yazmak gerekirdi; "hiçbir şey kaybolmasın" koşuluna en ters yol bu.
3. **Yalnızca tokenları değiştirmek.** En ucuz yol. Ama yerleşim aynı kalır (alt orta gezegen çubuğu, sağda gri
   kart); kullanıcının istediği sol liste, sağ sütun ve alt bant düzeni ortaya çıkmaz.

## Görsel dil (tokenlar)

- **Yazı:** Geist (başlık 300, gövde 400) ve Geist Mono (etiket, sayı, düğme). `@fontsource/geist` ve
  `@fontsource/geist-mono` eklenir, Barlow, Barlow Condensed ve IBM Plex Mono çıkar.
- **Renk:** mürekkep `#eef0f4`. İkincil metin %55, sessiz metin %40. Çizgi %10–22 beyaz. Etkin durum beyaz dolgu
  ve siyah yazı. Canlı veri yeşil (`#8ff0c4`, yalnızca canlı nokta ve canlı durum için). Güneş altını vurgusu
  kalkar.
- **Yüzey:** gri cam yok. Okunurluk için ekran kenarlarında koyu geçişler (kenar perdeleri) var: solda, sağda,
  altta ve üstte. Parlak sahnede bu perdeler koyulaşır (evren görünümü). Açılır menüler (ayarlar, arama
  sonuçları, katmanlar) okunurluk için koyu, opak, keskin köşeli ve ince çerçeveli kutulardır.
- **Şekil:** köşe yarıçapı 0. Kontroller 1 px çerçeveli kare ya da dikdörtgen. Gruplar bitişik bölmeli
  ("segmented").
- **Hareket:** mevcut süreler ve eğriler (`--ease-out`, `--d-panel-in` vb.) korunur.
- **Doku:** çok hafif yatay tarama çizgisi (%1,6). İsteğe bağlı, kapatılabilir.

## Yerleşim iskeleti

| Bölge | Güneş Sistemi | Galaksi | Evren |
|---|---|---|---|
| Üst sol | Ad + canlı uzaklık okuması | Ad + "Güneş'e … ışık yılı" | Ad + "Samanyolu'na …" |
| Üst sağ | Katman anahtarları, Ara, ?, Ayarlar | Yörüngeler, Etiketler, Yaşanabilir bölge, Keşfet araması, ?, Ayarlar | Etiketler, Katmanlar ▾, Bileşim ▾, Ara, ?, Ayarlar |
| Sol sütun | Gezegen listesi (renk işaretli) + Uzay araçları ▸ | Keşfet listesi (içinde / dışında sekmeleri, kategoriler, uzaklıklar) | Ölçek listesi + Öğren (Oluşum, Laboratuvar, Film, Kanıtlar) |
| Sağ sütun | Bilgi paneli (tam içerik, kaydırmalı) | Cisim / Samanyolu kartı | Ölçek kartı |
| Alt bant | Zaman · ölçek yolu · Sinematik/Gerçek, Yörünge/Serbest, oyun alanı, tam ekran, ev | Durdur, hız · ölçek yolu · Yörünge/Serbest, ev | Zaman · ölçek yolu · Sinematik/Bilimsel, ev |
| Sağ alt | — | Görsel kaynakları | Veri kaynakları |

**Ölçek yolu** ("Evren / Laniakea / Yerel Grup / Samanyolu / Güneş Sistemi / Mars"): bulunulan seviye çerçeveli
gösterilir. Her seviye tıklanabilir ve bugünkü geçiş düğmelerinin yerini alır: "Galaksiye çık", "Güneş Sistemi'ne
dön", "Evrene çık", "Galaksiye dön" ve evren ölçek sekmeleri. Bu düğmelerin kısayolları ve davranışları aynen
kalır.

## Envanter: bugünkü her öğe → yeni yeri

### Güneş Sistemi (Hud)
| Bugün | Yeni yer |
|---|---|
| Marka "Güneş Sistemi" | Üst sol |
| Canlı okuma (cisim · Güneş'e AU · ışık süresi / Odak / Serbest kamera tuşları) | Üst sol, markanın yanında |
| Geliştirici düğmesi (FPS) | Markanın altında, küçük |
| Ara (/) ve sonuç listesi | Üst sağ, kare çerçeveli kutu; sonuçlar opak açılır kutuda |
| Katmanlar: Galaktik (G), Yaşanabilir bölge (B), Uzay araçları (U), Yörüngeler (Y), Etiketler (E), Kuşaklar | Üst sağ, bitişik anahtar grubu (kare gösterge açık/kapalı) |
| Yardım (?) | Üst sağ kare |
| Ayarlar: kalite (Düşük–Ultra, Otomatik), arayüz boyutu, kaynaklar | Üst sağ kare; açılır kutu |
| Gezegen çubuğu (0–9, ← →, renk işaretleri, etkin gösterge) | Sol sütun, dikey liste |
| Uzay araçları menüsü (CraftMenu) | Sol sütun altında "Uzay araçları ▸", açılır liste sağa açılır |
| Zaman: geri, durdur/başlat (Boşluk), ileri, tarih, hız, "şimdi" | Alt bant sol |
| Sinematik / Gerçek | Alt bant sağ |
| Yörünge / Serbest (M) | Alt bant sağ |
| Oyun alanı (P) | Alt bant sağ kare |
| Galaksiye çık | Ölçek yolunda "Samanyolu" (ve mevcut kısayol) |
| Genel görünüm (ev) | Alt bant sağ kare |
| Tam ekran | Alt bant sağ kare |
| Bildirimler (yaşanabilir bölge, galaktik, serbest kamera, yavaşlık) | Alt bandın üstünde ortada, keskin köşeli koyu şerit |
| İlk açılış ipucu | Aynı yerde, yeni dilde |
| Kayan etiketler (Labels) | Aynı, yeni yazı tipiyle |

### Bilgi paneli (InfoPanel), sağ sütun, tüm bölümleriyle
Kapat ✕, "… geri dön", tür, başlık, alt başlık, Yaklaş, Canlı gözlem (canlı nokta, durum, hedef, gökyüzü görüntüsü,
görüş açısı seçimi, canlı istatistikler, program bilgisi, "Bak", not, hata/yeniden dene), geçiş izleme ve notu,
uydular, Güneş'e ve Dünya'ya canlı uzaklıklar, istatistik ızgarası, Dünya ile karşılaştırma çubukları, metin,
"Biliyor muydun?", kaynak. Hepsi aynı sırada kalır. Panel kaydırılır, sağında ince bir kaydırma rayı vardır. Odak
kaydırması (`setViewShift`) yeni genişliğe göre çalışır.

### Galaksi (GalaxyHud)
Güneş Sistemi'ne dön (ölçek yolu, Esc), Keşfet (K) ve tüm içeriği (arama, içinde/dışında sekmeleri ve sayıları,
sıralama notu, kategoriler, kartlar) sol sütuna taşınır. Liste kaydırılabilir. K arama kutusuna odaklanır, Esc
listeyi daraltır. Ayrıca: Evrene çık (ölçek yolu), durdur (Boşluk), hız (1×), uzaklık okuması, yörüngeler (Y),
etiketler (E), Yörünge/Serbest (M), yaşanabilir bölge (B), yardım, genel görünüm (H), Samanyolu hakkında ve cisim
kartları (sağ sütun), kaynak yazısı (sağ alt).

### Evren (UniverseHud)
Galaksiye dön (ölçek yolu), ölçek sekmeleri Yerel Grup / Laniakea / Kozmik ağ / Gözlenebilir evren (sol sütun ve
1–4 kısayolları), uzaklık okuması, Sinematik/Bilimsel, Katmanlar açılır kutusu (yüzdeli katmanlar, dilim notu),
Bileşim açılır kutusu ("Evren neyden yapılmış?"), Oluşum (O), Laboratuvar (T), Film, Kanıtlar ve M33 dönme eğrisi,
etiketler (E), yardım, "Bu harita nedir?", ölçek kartı (sağ sütun, kapat), zaman ve oynat/durdur, evren yaşı ve
kırmızıya kayma okuması (alt bant zaman grubu), kaynak yazısı (sağ alt).

### Diğerleri (yerleşim aynı, yalnızca yeni dil)
Laboratuvar, Film (karanlık madde), oyun alanı paneli (yaklaş, kaldır, durdur, paneli gizle, çık), yardım penceresi
(fare, dokunmatik, klavye listeleri), yükleme ekranı, geliştirici paneli (`devtools.css`), arayüz boyutu (UiScale).

### Tüm kısayollar (değişmez)
`0–9`, `← → ↑ ↓`, `/`, `?`, `Boşluk`, `Enter`, `Esc`, `W A S D`, `B`, `E`, `G`, `H`, `K`, `L`, `M`, `O`, `P`,
`T`, `X`, `Y`, `F2`, `` ` ``.

## Mobil (≤760 px)

- Sağ sütun bugünkü gibi alt sayfa (bottom sheet) olur.
- Sol sütun, alt bandın üstünde yatay kaydırılan tek bir şerit olur.
- Üst sağdaki anahtarlar tek bir "Görünüm ▾" açılır kutusunda toplanır. Bugünkü `tool-optional` mantığı korunur.
- Ölçek yolu yalnızca bir üst ve bulunulan seviyeyi gösterir.

## Hedef köşe çerçevesi (isteğe bağlı, son adım)

Odaklanılan cismin ekrandaki boyutuna göre dört köşe çizgisi ve "HEDEF · MARS · 4,1° GÖRÜŞ" yazısı. Yeni bir öğe,
kayıp riski yok. Sahne kalabalıksa kapatılabilir. Ayrı bir adım olarak, en sonda yapılır.

## Doğrulama

- **Envanter testi:** Playwright betiği. Her görünümde (Güneş Sistemi, cisim seçili, galaksi, Keşfet, evren,
  Laboratuvar, Film, oyun alanı) yukarıdaki envanterdeki her öğeyi `aria-label`, `data-*` ya da metniyle arar.
  Görünür ve tıklanabilir olduğunu doğrular. Kısayolları basıp etkisini kontrol eder. Bugünkü arayüzde **önce**
  çalıştırılıp yeşil olduğu görülür, yenileme boyunca yeşil kalmalıdır.
- **Okunurluk:** parlak sahnelerde ekran görüntüsü. Etiket metni ile arkası arasında yaklaşık 4,5:1 karşıtlık
  hedeflenir; kenar perdeleri buna göre ayarlanır.
- `npm test`, `npm run build`, 1600×900 ve 390×844 ekran görüntüleri, önce/sonra karşılaştırması.

## Kurucuya bırakılanlar

Tam piksel ölçüleri, açılır kutuların iç düzeni, animasyon ayrıntıları ve kenar perdelerinin kesin değerleri.
Bunlar taslaklara ve mevcut tokenlara göre belirlenir.

## Benim verdiğim kararlar (kullanıcı kontrol etsin)

1. Güneş altını vurgu rengi kalkıyor, etkin durum beyaz dolgu ile gösteriliyor. Yalnızca canlı veride yeşil var.
2. Yazı tipi Geist ve Geist Mono'ya geçiyor (yeni bağımlılık).
3. Galaksideki Keşfet ortadaki pencereden sol sütuna taşınıyor ve masaüstünde hep açık duruyor.
4. Görünümler arası geçiş düğmelerinin yerini ölçek yolu alıyor; kısayollar aynı kalıyor.
5. Hedef köşe çerçevesi en son, isteğe bağlı adım.
