# Karanlık madde sinematik — Faz 4 (dönme eğrisi bölümü) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (user chose inline execution). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filme "Fazla hızlı dönen yıldızlar" bölümünü eklemek: M33'ün ölçülen ve yalnız görünen maddeden beklenen dönme hızları, yan yana dönen iz yıldızlarıyla gösterilir; fark görünmeyen haleyle açıklanır.

**Architecture:** Saf modül `rotation.ts` (M33 tablolarından ara değer, hale katkısı, açı ilerletme). Bölüm `film/rotationChapter.ts`: üstel yıldız diski (gerçek ölçülen hızla döner), dört yarıçapta iki renkli iz yıldızı çifti (ölçülen / beklenen hızla), canlı çizilen SVG dönme eğrisi, sonra hale parçacıkları. Lab bağlantısı Deneyler → M33 (`experiments#rotation`).

**Tech Stack:** Faz 1–3 ile aynı; grafik için mevcut `src/ui/lab/plot.ts`.

**Spec:** `docs/superpowers/specs/2026-11-25-karanlik-madde-sinematik-design.md` (bölüm 3).

## Global Constraints

- Faz 1 Global Constraints aynen geçerli.
- Veri: `M33_ROTATION` (`src/config/universe.ts`), birimler kpc ve km/s; zaman ekranda yazılı (1 s film = 40 milyon yıl).
- Bölüm sırası: Karanlık ağ, Halede bir galaksi, Fazla hızlı dönen yıldızlar, Mermi Kümesi, Kapanış.

## Review Focus

1. Tablonun dışındaki yarıçaplar (R < 0.5 veya > 16 kpc): hız NaN/negatif olmamalı. → Task 1 testi.
2. Ölçülen < beklenen olan yarıçapta hale hızı karekökü negatif olmamalı. → Task 1 testi.
3. Bölüm duraklatılınca yıldızlar durmalı, kamera serbest bırakılınca yol devam edebilmeli. → Task 2 doğrulaması.
4. Lab bağlantısı Deneyler sekmesine gitmeli (Etkileşim değil). → Task 2 doğrulaması.

---

### Task 1: `rotation.ts`

**Files:** Create `src/ui/darkmatter/rotation.ts`; Test `tests/darkmatter/rotation.test.ts`.

**Interfaces:**
- `export function vAt(table: readonly (readonly [number, number])[], R: number): number` — doğrusal ara değer; R < ilk noktada 0'dan ilk noktaya doğrusal (v(0) = 0), son noktadan sonra son değer (düz).
- `export function vHalo(vObs: number, vVis: number): number` — `√max(0, vObs² − vVis²)`.
- `export function advance(angle: number, R: number, vKms: number, dtMyr: number): number` — `angle + v·dt/R` (km/s → kpc/Myr: × 1.0227e-3); R ≤ 0 → açı değişmez.
- [ ] Testler: `vAt(obs, 4) = 96`, `vAt(obs, 7) = 109.5`, `vAt(obs, 0) = 0`, `vAt(obs, 30) = 126`; `vHalo(50, 60) = 0`, `vHalo(126, 44) ≈ 118.07`; `advance(0, 8, 112, 100)` ≈ 1.4318 rad; `advance(1, 0, 100, 10) = 1`.
- [ ] RED → uygula → GREEN → commit `"Dark matter: rotation-curve helpers"`.

### Task 2: Film bölümü + bağlantı

**Files:** Create `src/ui/darkmatter/film/rotationChapter.ts`; Modify `src/ui/darkmatter/film/chapters.ts` (`Chapter.lab.tab: 'interaction' | 'experiments'`, bölüm 3. sıraya), `src/ui/darkmatter/Film.ts` (onTry tipi), `src/ui/lab/Lab.ts` (openFilm onTry tipi; film kartı metni "dönen yıldızlar" ekler).

- [ ] Bölüm: `id 'rotation'`, `title 'Fazla hızlı dönen yıldızlar'`, `duration 42`, `lab: { tab: 'experiments', anchor: 'rotation' }`. 1 birim = 2.5 kpc. Disk: 9000 yıldız, üstel profil R_d = 1.8 kpc, R ≤ 16 kpc, kalınlık 0.3 kpc, her yıldız ölçülen hızla döner. İz çiftleri R = 4, 8, 12, 16 kpc: beyaz (ölçülen) ve mavi `#69beff` (beklenen), aynı açıdan başlar; 6 s'den sonra ayrışır. Hale: 5000 NFW benzeri parçacık (DM moru), 24–28 s'de belirir. SVG grafik sağ altta: 6–20 s arası "beklenen" ve "ölçülen" eğrileri soldan sağa çizilir, 24 s'den sonra "hale" eğrisi eklenir (lejant: ölçülen beyaz, beklenen mavi, hale mor). Zaman: 1 s = 40 milyon yıl (kaplamada).
- Altyazılar (birebir):
  - 0–6: "Bir sarmal galaksi (M33) dönüyor. Her yıldız, içinde kalan kütlenin çekimiyle yörüngede."
  - 6–14: "Görünen yıldız ve gaza göre dıştaki yıldızlar daha yavaş dönmeli (mavi)."
  - 14–24: "Ama ölçülen hızlar dışarıda düşmüyor (beyaz). Dış yıldızlar beklenenden çok daha hızlı."
  - 24–34: "Bunu açıklayan görünmeyen bir kütle: galaksiyi saran karanlık madde halesi."
  - 34–42: "Vera Rubin ve diğerleri 1970'lerde bunu yüzlerce galakside ölçtü: düz dönme eğrileri karanlık maddenin ilk güçlü kanıtlarından."
- Yöntem satırı: "Veri: M33 ölçülen dönme eğrisi ve yalnız yıldız + gazdan beklenen eğri (temsili ±6 km/s). Disk ve hale çizimi temsilî; yıldızlar ölçülen hızla döner. Zaman: 1 s = 40 milyon yıl."
- Kamera: 0 s (0, 5, 9) → 14 s (0, 7, 6) (üstten eğik) → 24 s (6, 3, 8) → 34 s (0, 2.5, 11) → 42 s (0, 6, 9).
- [ ] Doğrulama (Playwright): altyazılar zamanında; çip sırası; "dene" → `experiments#rotation` ve lab M33 kartı görünür; duraklat → iz yıldızları durur; 1920×1080 ≤ 16 ms; konsol temiz.
- [ ] Commit `"Dark matter: film chapter, stars that orbit too fast"`.
