# Galaksiye yeni cisimler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (user chose inline execution). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `config/deepsky.ts` kataloğuna 38 cisim, SS 433 için jet çizimi, 10 yeni lisanslı görsel.

**Architecture:** Veri kayıtları mevcut tiplere (`NebulaDef`, `SystemDef`, `PulsarDef`, `ClusterDef`); tek kod eklemesi `SystemDef.jets` + `StarSystem`. Görseller mevcut betiklerle.

**Spec:** `docs/superpowers/specs/2026-11-25-galaksi-yeni-cisimler-design.md`

## Global Constraints

- Kamu malı / CC BY görseller; `docs/CREDITS.md` güncel.
- Türkçe metin; RA/Dec J2000 derece; uzaklık pc; `framePc` sistemlerde `n * AU`.
- `npm run typecheck`, `npm test`, `npm run build` temiz.

## Review Focus

1. Her yeni kayıt Keşfet menüsünde doğru sekmede ve uçulabilir (konum NaN değil, `framePc` > 0). → Task 5 katalog testi.
2. id'ler benzersiz. → Task 5 katalog testi.
3. Nebula görselleri yüklenmezse (eksik dosya) sahne çökmemeli. → Task 4 doğrulaması (mevcut Loader davranışı).
4. Galaksi görünümünde kare süresi bugünkü düzeyde. → Task 6 ölçümü.

---

### Task 1: Katalog doğrulama testi
- Create `tests/galaxy/catalog.test.ts`: `DEEP_SKY` için id benzersiz; her kayıtta ra ∈ [0,360), dec ∈ [−90,90], distPc > 0, framePc > 0, sonlu; nebulada aspect > 0, widthPc > 0 ve `public/textures/<folder|deepsky>/<image>_4k.jpg` + `_1k.jpg` var; sistemde yörünge varsa periodYears > 0; gezegenlerde aAu > 0, periodDays > 0. (Mevcut katalogla GREEN; sonraki task'lar bunu kırmamalı.)
- Not: `deepsky.ts` başka modül içe aktarıyorsa Node'da çalışması için test buna göre yazılır.
- Commit `"Galaxy: catalog sanity test"`.

### Task 2: SS 433 jetleri
- `SystemDef.jets?: { precessionDays: number; coneDeg: number; lengthAu: number; speedC: number }`.
- `StarSystem`: `def.jets` varsa birinci cismin grubuna `PulsarBeams` (magneticDeg = coneDeg, periodS = precessionDays·86400, shownPeriodS 6, uzunluk lengthAu, renk sıcak beyaz-mavi) eklenir; pulsar kartı üretmez.
- Doğrulama: typecheck; Task 3 sonrası SS 433'e uçup ekran görüntüsü.
- Commit `"Galaxy: precessing jets for systems (SS 433)"`.

### Task 3: Yıldızlar, gezegen sistemleri, kompakt cisimler (görselsiz)
- Kayıtlar: vega, polaris, rigel, antares, aldebaran, arcturus, deneb, barnard, 51peg, kepler186, kepler452, toi700, gaiabh1, gaiabh2, v404cyg, ss433, psrj0437, swiftj1818.
- Katalog testi GREEN; commit `"Galaxy: famous stars, planetary systems and compact objects"`.

### Task 4: Görseller + nebulalar ve kalıntılar
- `fetch-deepsky.mjs` FILES: eagle, rosette, crescent, bubble, dumbbell, eskimo, hourglass, heart, northamerica, tycho, kepler (Commons'ta doğrula). `build-hires.mjs`: kaynağı > 4K olanlar (rosette, crescent, bubble, heart, northamerica).
- Betikleri çalıştır; kayıtlar (shell/bowl/bipolar/barrel/sheet); CREDITS.
- Katalog testi GREEN; commit `"Galaxy: nine nebulae and two supernova remnants"`.

### Task 5: Kümeler
- hyades, beehive, hpersei, chipersei, m13, tuc47, m4, arches, quintuplet; katalog testi; commit `"Galaxy: nine star clusters"`.

### Task 6: Tarayıcı doğrulaması
- Keşfet menüsünde yeni kayıtlar; her gruptan en az iki hedefe uçuş + ekran görüntüsü (SS 433 jetleri, Rozet 3D yan açı, M13, Kepler-186); galaksi genel görünüm kare süresi önce/sonra; konsol temiz.
