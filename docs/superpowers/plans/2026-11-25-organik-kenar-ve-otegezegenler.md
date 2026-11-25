# Organik kenar + ötegezegen türleri — tasarım ve plan

Tarih: 2026-11-25 · Kullanıcı kararları: (1) "organik kenar güzel, köşeli olan hepsine uygulayalım"; (2) ötegezegenler için "Bilimsel tür + gerçek doku ayrıntısı".

## 1. Organik kenar (bulutsular ve galaksiler)

**Sorun:** Fotoğrafın gökyüzü sisi + önplan yıldızları + dikdörtgen %14 kenar solması → uzaktan köşeli kart.

**Tasarım (demo: `.playwright-mcp/mask-demo3.mjs`, "organic"):** nebula worker'ında (`nebulaBuild.computeNebula`, N = 512) piksel başına alfa:
- B = bulanık parlaklık (yarıçap %1,5), gökyüzü = B'nin %20 yüzdeliği, tepe = %99,5; gökyüzü rengi = en karanlık beşte birin ortalaması (doğrusal RGB).
- nesne maskesi = smoothstep(0,02; 0,22; (B − gökyüzü)/(tepe − gökyüzü)), %2 bulanık.
- yapı S = bulanık parlaklık (%4), %10–%95 yüzdeliklerine normalize.
- r = squircle uzaklığı (|x|⁴+|y|⁴)^¼ (görüntü merkezine göre, −1..1); f = r + 0,38·(0,55 − S).
- alfa = smoothstep(1,0 → 0,62; f) · kenar(%4) · (0,35 + 0,65 · nesne maskesi).
- `mask[k]` (galaksi maskesiyle) bu alfa ile çarpılır → derinlik dokusunun a kanalı; parçacıklar da aynı maskeyi kullanır.
- Shader (`slice.frag`): dikdörtgen `e` solması kalkar; renk `max(map − 0,9·uSky, 0)`.
- Kapsam: tüm `NebulaDef` (deepsky + extragalactic). Gerekirse kayıt başına `edge: 'rect'` ile eski davranış (YAGNI: şimdilik eklenmez).

**Görevler**
- [ ] T1 `src/galaxy/objects/edgeMask.ts`: `edgeAlpha(lin: Float32Array /*rgb*/, N): { alpha: Float32Array; sky: [r,g,b] }`. Test (`tests/galaxy/edgeMask.test.ts`): düz gökyüzü + ortada parlak leke → köşe alfa < 0,02, merkez > 0,5; görüntü kenarındaki tüm pikseller < 0,05; gökyüzü rengi arka plana ±%5; tamamen düz görüntü NaN üretmez.
- [ ] T2 `computeNebula` alfa ve gökyüzünü kullanır (`NebulaBuildOutput.sky`), `SlicedNebula` uSky uniform'u, `slice.frag` güncel; parçacık renkleri gökyüzü çıkarılmış. Doğrulama: Playwright uzaktan Kalp, Kabarcık, Hilal, Rozet, Orion, M51, M33 + yakın yan görünüm (3D korunuyor); kare süresi değişmez; konsol temiz.

## 2. Ötegezegen türleri

**Sorun:** her gezegen tek renk + gürültü küre (`planet.frag`) → hepsi aynı kahverengi kaya.

**Tasarım:**
- Tür, yarıçap ve denge sıcaklığından: T_eq = T★ · √(R★ / 2a) · (1 − A)^¼ (A = 0,3).
  - R ≥ 6 R⊕: T_eq > 1000 K → `hotJupiter`; değilse `giant` (bantlı).
  - 1,7 ≤ R < 6: `subNeptune` (puslu).
  - R < 1,7: T_eq > 900 K → `lava`; 180–330 K → `temperate`; < 180 K → `icy`; arası → `barren` (sıcak çöl).
  - Kırmızı cüce (T★ < 4000 K) ve a < 0,1 AU olan kayalıklar: gelgit kilidi → `temperate` ise `eyeball`.
- Görünüm (`planet.frag` genişler, uniform `uType`, `uTex`): Güneş Sistemi dokuları ayrıntı için, türe göre yeniden renklenir — `barren`/`lava`: Merkür; `temperate`/`eyeball`: Ay + bulut gürültüsü + okyanus tonu; `icy`: Ay beyaza; `giant`/`hotJupiter`: Jüpiter bantları yeniden renkli; `subNeptune`: Neptün. Atmosferli türlerde kenar ışıltısı; `lava`/`hotJupiter` gece yüzünde sıcaklık parlaması; `eyeball` yıldıza bakan yüzde okyanus, arka yüzde buz.
- Kart: tür adı + T_eq + "Görünüm temsili: bu gezegenlerin yüzey görüntüsü yok."

**Görevler**
- [ ] T3 `src/galaxy/objects/exoplanetType.ts`: `equilibriumK(starTempK, starRadiusSun, aAu)`, `planetType(p, star): PlanetType`. Test: Dünya (5772 K, 1 R☉, 1 AU, 1 R⊕) T_eq ≈ 255 K → temperate; 51 Peg b → hotJupiter; TRAPPIST-1 b → lava değil/… (tabloya göre); Kepler-186 f → temperate; TOI-700 c → subNeptune; TRAPPIST-1 e → eyeball.
- [ ] T4 shader + dokular + kart satırı; Playwright: TRAPPIST-1, Kepler-186, 51 Peg, TOI-700, Barnard yakın çekim; konsol temiz.
