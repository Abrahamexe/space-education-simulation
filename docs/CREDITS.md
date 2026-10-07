# Kaynaklar ve Lisanslar

Bu projede kullanılan tüm dış dokular, veriler ve kod parçaları burada listelenir.

## Dokular

| Dosya | Kaynak | Lisans | Not |
|---|---|---|---|
| `public/textures/stars/2k_stars_milky_way.jpg` (2048×1024, 246 KB) | [Solar System Scope](https://www.solarsystemscope.com/textures/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Samanyolu panoraması, galaktik koordinatlarda. İlk yüklemede kullanılır. |
| `public/textures/stars/8k_stars_milky_way.jpg` (8192×4096, 1.9 MB) | [Solar System Scope](https://www.solarsystemscope.com/textures/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Aynı panoramanın yüksek çözünürlüğü; arka planda yüklenip değiştirilir. |
| `public/textures/mercury/2k_mercury.jpg` (853 KB) | Solar System Scope | CC BY 4.0 | Merkür yüzeyi; kabartma bu dokunun parlaklığından türetilir. |
| `public/textures/{mercury,mars,jupiter,saturn}/4k_*.jpg` | Solar System Scope 8K kaynaklarından 4K'ya küçültüldü (`scripts/prepare-textures.mjs`) | CC BY 4.0 | Yakın planda yüklenir, uzaklaşınca bellekten atılır. 8K kaynaklar `assets-src/` altında. |
| `public/textures/venus/4k_venus_atmosphere.jpg` | Solar System Scope | CC BY 4.0 | Venüs bulut tepesi, yakın plan. |
| `public/textures/venus/2k_venus_atmosphere.jpg` (224 KB) | Solar System Scope | CC BY 4.0 | Venüs bulut tepesi. |
| `public/textures/earth/2k_earth_{daymap,nightmap,clouds}.jpg` (1,6 MB) | Solar System Scope | CC BY 4.0 | Dünya gündüz, gece ışıkları, bulutlar. |
| `public/textures/earth/2k_earth_normal_map.png`, `2k_earth_specular_map.jpg` | Solar System Scope (TIFF → PNG/JPG dönüştürüldü) | CC BY 4.0 | Normal harita ve okyanus maskesi. |
| `public/textures/earth/4k_*` (6,3 MB) | Solar System Scope 8K kaynaklarından 4K'ya küçültüldü (`scripts/prepare-textures.mjs`) | CC BY 4.0 | Yakın planda yüklenir. 8K kaynaklar `assets-src/` altında. |
| `public/textures/mars/2k_mars.jpg` (733 KB) | Solar System Scope | CC BY 4.0 | |
| `public/textures/jupiter/2k_jupiter.jpg` (487 KB) | Solar System Scope | CC BY 4.0 | |
| `public/textures/saturn/2k_saturn.jpg`, `2k_saturn_ring_alpha.png` | Solar System Scope | CC BY 4.0 | Halka dokusunun yarıçap aralığı (70 800–140 830 km) dokudaki Cassini/Encke boşluklarına göre hesaplandı. |
| `public/textures/uranus/2k_uranus.jpg`, `public/textures/neptune/2k_neptune.jpg` | Solar System Scope | CC BY 4.0 | |
| `public/textures/moon/2k_moon.jpg` (1 MB), `4k_moon.jpg` (2,6 MB, 8K kaynaktan küçültüldü) | Solar System Scope | CC BY 4.0 | Ay yüzeyi; 4K yakın planda yüklenir, uzaklaşınca bellekten atılır. |

> Atıf: "Textures by Solar System Scope (solarsystemscope.com), CC BY 4.0". Uygulamada Ayarlar menüsündeki kaynaklar metninde de gösterilir.

Ay dışındaki uydular, cüce gezegenler ve Halley çekirdeği için lisansı açık küresel harita bulunmadığından yüzeyler **prosedüreldir** (Solar System Scope'un cüce gezegen dokuları 'fictional' olarak işaretli olduğu için kullanılmadı). Renkler ve özellikler yayımlanmış gözlem betimlemelerine dayanan görsel yaklaşımlardır.

Uranüs ve Neptün halkaları, Neptün fırtınaları ve gaz devlerindeki akış/türbülans **prosedüreldir**.

Güneş yüzeyi, korona, fışkırmalar, nebula tonu ve parçacık yıldızları **prosedüreldir**; dış doku kullanmaz.

## Bilimsel veriler

| Değer | Kaynak |
|---|---|
| Güneş yarıçapı (695 700 km), kütle, sidereal dönme süresi (25,38 gün), ekliptiğe eğiklik (7,25°), efektif sıcaklık (5772 K) | NASA GSFC, *Sun Fact Sheet* — nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html |
| Güneş kuzey kutbu (α₀ = 286,13°, δ₀ = 63,87°) ve ana meridyen (W = 84,176° + 14,1844°·d) | Archinal ve ark. 2018, *Celest. Mech. Dyn. Astr.* 130:22 (IAU WGCCRE 2015 raporu) |
| Diferansiyel dönme katsayıları (A = 14,713, B = −2,396, C = −1,787 °/gün) | Snodgrass & Ulrich 1990, *ApJ* 351, 309 |
| Astronomik birim (149 597 870,7 km) | IAU 2012 Karar B2 |
| Işık hızı (299 792,458 km/s) | SI tanımı |
| Ekliptik eğikliği J2000 (84381,406″) | IAU 2006 presesyon modeli (Capitaine ve ark. 2003) |
| Ekvatoral → galaktik dönüşüm matrisi | ESA 1997, *The Hipparcos and Tycho Catalogues*, Cilt 1, §1.5.3 |
| Gezegen yörünge elemanları (a, e, I, L, ϖ, Ω ve yüzyıllık değişimleri) | JPL SSD, *Keplerian Elements for Approximate Positions of the Major Planets* (E. M. Standish), Tablo 1 (1800–2050) |
| Gezegen kutup yönleri ve ana meridyenleri (α₀, δ₀, W) | IAU WGCCRE (Archinal ve ark. 2011, 2018); periyodik terimler dahil edilmedi (Neptün'de ~0,5° fark) |
| Ekvator/kutup yarıçapları, eksen eğiklikleri | NASA GSFC *Planetary Fact Sheet* |
| Dünya atmosferi Rayleigh/Mie katsayıları ve ölçek yükseklikleri | Bruneton & Neyret 2008, *Precomputed Atmospheric Scattering* (deniz seviyesi değerleri) |
| Uranüs ve Neptün halka yarıçapları | NASA GSFC *Uranian / Neptunian Rings Fact Sheet* |
| Bilgi panelindeki gezegen, Ay, Plüton ve Güneş sayıları (kütle, çap, yerçekimi, sıcaklık, gün uzunluğu, uydu sayısı…) | NASA GSFC *Planetary Fact Sheet* ve *Sun Fact Sheet*, 2026-10-05'te çekildi (`src/data/generated/facts.json`) |
| Uydu yörünge elemanları (a, e, ω, M, i, Ω, P, apsis/düğüm presesyon süreleri, Laplace düzlemi kutupları) | JPL SSD *Planetary Satellite Mean Elements* (ssd.jpl.nasa.gov/sats/elem) |
| Uydu ortalama yarıçapları ve GM değerleri (kütle = GM/G, yüzey çekimi = GM/R²) | JPL SSD *Planetary Satellite Physical Parameters*; G için CODATA 2018 |
| Cüce gezegen ve Halley yörünge elemanları, Ceres boyutları, dönme süreleri | JPL *Small-Body Database* API (ssd-api.jpl.nasa.gov/sbdb.api) |
| Halley son ve sonraki günberi tarihleri (9 Şubat 1986, 28 Temmuz 2061) | NASA / JPL Horizons. Sahnedeki konum sabit oskülasyon elemanlarıyla hesaplandığından gezegen pertürbasyonlarını içermez; yaklaşıktır |
| Ceres ve Plüton kutup yönleri / ana meridyenleri | Archinal ve ark. 2018 (IAU WGCCRE) |
| Plüton yarıçapı (1188,3 km) | Nimmo ve ark. 2017, *Icarus* 287 (New Horizons) |
| Haumea üç eksenli boyutları ve halkası | Ortiz ve ark. 2017, *Nature* 550, 219 |
| Makemake çapı | Ortiz ve ark. 2012, *Nature* 491, 566 |
| Eris çapı | Sicardy ve ark. 2011, *Nature* 478, 493 |
| Phobos, Deimos üç eksenli boyutları | Thomas 1989, *Icarus* 77 |
| Amalthea üç eksenli boyutları | Thomas ve ark. 1998, *Icarus* 135 |
| Nereid dönme süresi (11,594 sa) | Kiss ve ark. 2016, *MNRAS* 457 (Kepler K2) |
| Asteroit kuşağındaki Kirkwood boşlukları (3:1, 5:2, 7:3, 2:1) | Jüpiter ile ortalama hareket rezonansları; kuşaktaki tek tek kayaların yörüngeleri istatistiksel olarak üretilmiştir (gerçek asteroit kataloğu değildir) |
| Diğer gezegenlerin atmosfer renkleri, akış profilleri | Görsel yaklaşım (bilimsel veri olarak gösterilmez) |
| Yıldız parlaklık dağılımı ve sıcaklık karışımı | Görsel yaklaşım (bilimsel veri olarak gösterilmez) |

## Kod

| Parça | Kaynak | Lisans |
|---|---|---|
| 3B/4B simplex gürültü (`src/shaders/common/noise.glsl`) | Ian McEwan, Stefan Gustavson — Ashima Arts, [webgl-noise](https://github.com/ashima/webgl-noise) | MIT |
| `hash33` "Hash without Sine" | David Hoskins, [Shadertoy 4djSRW](https://www.shadertoy.com/view/4djSRW) | MIT |
| Kara cisim renk yaklaşımı (`src/utils/color.ts`) | Tanner Helland, Mitchell Charity'nin tablosuna uyum | Algoritma açıklaması, serbest kullanım |
| Mulberry32 PRNG (`src/utils/random.ts`) | Tommy Ettinger | Kamu malı |

## Kütüphaneler

| Paket | Lisans |
|---|---|
| [three.js](https://threejs.org) | MIT |
| [postprocessing](https://github.com/pmndrs/postprocessing) (pmndrs) | Zlib |
| [GSAP](https://gsap.com) | GSAP Standard License (ücretsiz, ticari kullanım dahil) |
| [lil-gui](https://lil-gui.georgealways.com) (yalnızca geliştirme) | MIT |
| [Vite](https://vitejs.dev), [TypeScript](https://www.typescriptlang.org) | MIT, Apache-2.0 |
| [sharp](https://sharp.pixelplumbing.com) (yalnızca doku hazırlama scripti) | Apache-2.0 |
| [Barlow, Barlow Condensed](https://github.com/jpt/barlow) (Jeremy Tribby), `@fontsource` ile | SIL Open Font License 1.1 |
| [IBM Plex Mono](https://github.com/IBM/plex), `@fontsource` ile | SIL Open Font License 1.1 |
| [Phosphor Icons](https://phosphoricons.com) (`@phosphor-icons/core`) | MIT |

## Galaksi görünümü

| Ne | Kaynak | Lisans |
|---|---|---|
| Samanyolu yukarıdan görünüm (`public/textures/galaxy/`, 5600 px kaynaktan 4K/2K) | NASA/JPL-Caltech/ESO/R. Hurt, sanatçı çizimi, Spitzer kızılötesi taramalarına dayalı ([eso1339g](https://www.eso.org/public/images/eso1339g/), [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Artist%E2%80%99s_impression_of_the_Milky_Way.jpg)) | Kamu malı |
| Güneş–merkez uzaklığı R0 = 8178 pc | GRAVITY Collaboration 2019, A&A 625, L10 | — |
| Güneş'in düzlem üstü yüksekliği 20,8 pc | Bennett & Bovy 2019, MNRAS 482, 1417 | — |
| Güneş'in galaktik hızı (U, V, W) + Θ0 | Schönrich, Binney & Dehnen 2010; Reid ve ark. 2019 | — |
| Macellan Bulutları ve Yay Cüce Gökadası uzaklıkları | Pietrzyński ve ark. 2019; Graczyk ve ark. 2020; Vasiliev & Belokurov 2020 | — |
| Yakın yıldız konum ve uzaklıkları | Hipparcos / Gaia DR3 | — |
| Yaşanabilir bölge sınırları (sera kaçağı, en büyük sera, erken Venüs, erken Mars) | Kopparapu ve ark. 2013, ApJ 765, 131; 2014, ApJL 787, L29 | — |
| Galaktik çubuk/şişkinlik boyutu ve açısı | Wegg & Gerhard 2013; Bland-Hawthorn & Gerhard 2016 | — |
| Küresel küme sayısı ve dağılımı | Harris 1996 (2010 sürümü) | — |
| Uzak gökada arka planı | Prosedürel (gerçek bir katalog değil, temsili) | — |
| Derin uzay görselleri (`public/textures/deepsky/*_4k.jpg`, `*_1k.jpg`; `scripts/fetch-deepsky.mjs`) | NASA, ESA, CSA, STScI — Hubble ve Webb yayınları, Wikimedia Commons: Yengeç (J. Hester, A. Loll), Orion (M. Robberto, Hubble Orion Treasury), Yaratılış Sütunları (Webb NIRCam), Halka ve Güney Halka (Webb), Kozmik Uçurumlar (Webb), Sarmal (C.R. O'Dell), Kedi Gözü (J.P. Harrington, K.J. Borkowski), Kelebek (Hubble SM4 ERO), Atbaşı (Hubble Heritage), Cassiopeia A (Webb MIRI, D. Milisavljevic), Eta Karina (J. Morse), Westerlund 2 (Hubble Heritage, A. Nota), Lagün (NASA/ESA/STScI), Trifid (J. DePasquale), Kuğu İlmeği (NASA/JPL-Caltech, GALEX) | Kamu malı |
| Galaksi dışı görseller (`public/textures/extragalactic/*_4k.jpg`, `*_1k.jpg`; `scripts/fetch-extragalactic.mjs`) — Wikimedia Commons | NASA, ESA, CSA, STScI ve Hubble Heritage Team (STScI/AURA): Girdap M51, Sombrero M104, M87 jeti, NGC 1300, Antenler, Puro M82, Hoag Nesnesi, Araba Tekerleği (Webb), Stephan Beşlisi (Webb), Webb'in İlk Derin Alanı (SMACS 0723) | Kamu malı |
| Fırıldak M101 (`m101`) | ESA & NASA; K.D. Kuntz, F. Bresolin, J. Trauger, J. Mould, Y.-H. Chu; CFHT/NOAO | CC BY 4.0 |
| Erboğa A (`cena`, eso0903a) | ESO/WFI (optik); MPIfR/ESO/APEX/A. Weiss ve ark. (milimetre altı); NASA/CXC/CfA/R. Kraft ve ark. (X ışını) | CC BY 4.0 |
| Andromeda M31 (`m31`, "Andromeda Galaxy (with h-alpha)") | Adam Evans (Flickr) | CC BY 2.0 |
| Üçgen M33 (`m33`, "M33 - The Triangulum Galaxy") | Wikimedia Commons kullanıcısı Popcorn4life | CC BY 4.0 |
| 3C 273 (`q3c273`) | ESA/Hubble & NASA | CC BY 2.0 |
| Yıldız sistemleri | Alfa Cen: Pourbaix & Boffin 2016 · Sirius: Bond ve ark. 2017 · TRAPPIST-1: Agol ve ark. 2021 · Proxima: Anglada-Escudé 2016, Faria 2022 · Cygnus X-1: Miller-Jones ve ark. 2021 · Gaia BH3: Gaia Collaboration 2024 · Betelgeuse: Joyce ve ark. 2020 · Çift Pulsar: Kramer ve ark. 2021 · Omega Cen: Baumgardt & Vasiliev 2021, Häberle ve ark. 2024 | — |
| Sgr A* kütlesi 4,3 milyon M☉ | GRAVITY Collaboration 2019 | — |
| S yıldızlarının yörünge öğeleri | Gillessen ve ark. 2017, ApJ 837, 30; S2: GRAVITY 2018 | — |
| Yengeç pulsarı dönme ekseni yönü | Ng & Romani 2004, ApJ 601, 479 | — |
| Bulutsu derinlik modelleri (kabuk, çanak, sütun, fıçı) | Hester 2008; O'Dell 2001; O'Dell ve ark. 2013 | — |

Bu cisimlerin ölçülmüş 3B modelleri yoktur. Bulutsular, Hubble görüntülerinin piksellerinden ve yayımlanmış yapı bilgisinden üretilmiş temsili 3B parçacık bulutlarıdır. Kara delikler Schwarzschild uzay-zamanında ışın izlenerek çizilir (ışığın gerçek yörünge denklemi); birikim diskleri sanatsal temsildir.

Galaksinin uzak yarısı toz yüzünden doğrudan haritalanamamıştır; görseldeki o bölge bilimsel bir tahmindir.

## Metinler

Bilgi panelindeki Türkçe tanıtım metinleri ve "Biliyor muydunuz?" bilgileri bu proje için özgün olarak yazılmıştır (`src/i18n/content.tr.json`); içerdikleri olgular NASA, ESA ve JPL'in kamuya açık görev ve bilgi sayfalarıyla uyumludur.
