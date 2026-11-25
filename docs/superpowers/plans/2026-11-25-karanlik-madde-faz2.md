# Karanlık madde sinematik — Faz 2 (galaksi oluşumu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (user chose inline execution). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Galaksi oluşumu laboratuvar sahnesini 3D Stage'e taşımak ve filme "Halede bir galaksi" bölümünü (pişirilmiş gerçek simülasyon) eklemek.

**Architecture:** Faz 1 çekirdeği (`src/ui/darkmatter/`) genişler: pişirilmiş dosya formatı parçacık başına uint8 "kanallar" taşır (tür, log T); `ParticleLayer` sıcaklık paleti ve parçacık başına görünürlük kazanır. Lab sahnesi canlı `galaxy.worker` anlık görüntülerini, film bölümü `public/data/darkmatter/galaxy.bin`'i oynatır. Sahne kpc biriminde; çizimde 1 birim = 10 kpc.

**Tech Stack:** Faz 1 ile aynı (TypeScript, Three.js r186, postprocessing, `node --test`).

**Spec:** `docs/superpowers/specs/2026-11-25-karanlik-madde-sinematik-design.md` (Faz 1 planı: `docs/superpowers/plans/2026-11-25-karanlik-madde-faz1.md`)

## Global Constraints

- Faz 1 Global Constraints aynen geçerli (Türkçe metin, NaN-güvenli shader, karanlık madde "gerçekte görünmez", yöntem satırı, ≤ 16 ms/kare Iris Xe 1920×1080 medium, testler `tests/` altında, commit'te Claude satırı yok).
- Sıcaklık paleti yalnız galaksi sahnesinde ve gerçek T'den (SPH `u`): mevcut `T_STOPS` (src/ui/lab/scenes/galaxy.ts) birebir.
- Bake süresi ≤ ~1 saat; `public/data/darkmatter/` toplamı ≤ ~30 MB.
- Mevcut galaksi lab içerikleri (dönme eğrisi, yoğunluk profili, okumalar, yöntem notu, çözünürlük ve geri besleme seçimi) korunur.

## Review Focus

1. Yıldız oluşumu sırasında bir parçacık gazdan yıldıza döner: iki kare arasında hem gaz hem yıldız katmanında yarım parlaklıkla görünmeli, hiçbir zaman iki kat ya da kaybolmuş olmamalı. → Task 1 testi (`visibility crossfade`) + Task 3 doğrulaması.
2. Lab'da çözünürlük değiştirilince parçacık sayısı değişir: katmanlar yeni sayıyla yeniden kurulmalı, eski tamponla taşma/çökme olmamalı. → Task 3 doğrulama adımı.
3. Eski `bullet.bin` (kanalsız) yeni kodla okunmaya devam etmeli. → Task 1 testi (`files without channels still decode`).
4. Worker hatası (ör. `failed`) olursa 3D sahne boş kalıp kilitlenmemeli; mevcut hata metni görünmeli. → Task 3 doğrulama adımı.
5. Film bölüm sırası değişince ("1 · Halede bir galaksi", "2 · Mermi Kümesi", …) lab bağlantıları doğru sahneye gitmeli. → Task 4 doğrulama adımı.

---

### Task 1: Format kanalları + ParticleLayer sıcaklık/görünürlük

**Files:**
- Modify: `src/ui/darkmatter/bake/format.ts`
- Modify: `src/ui/darkmatter/render/ParticleLayer.ts`, `src/shaders/darkmatter/particle.vert`, `particle.frag`
- Create: `src/ui/darkmatter/render/temperature.ts`
- Test: `tests/darkmatter/format.test.ts`, `tests/darkmatter/temperature.test.ts`

**Interfaces:**
- Produces (`format.ts`):
  - `BakeHeader.channels?: { name: string; group: string; lo: number; hi: number }[]` — her kanal, grubundaki her parçacık için kare başına bir uint8 (`lo..hi` doğrusal). Düzen: konumlar, sonra (varsa) `rho` bloğu, sonra kanallar başlıktaki sırayla, her biri tüm kareler.
  - `encodeBake(h, frames, rho?, channels?: Record<string, Float32Array[]>)`
  - `Baked.channel(name: string, i: number): Float32Array | null` — doğrusal değerler (`lo + q/255·(hi−lo)`).
- Produces (`temperature.ts`): `export const T_STOPS: [number, [number, number, number]][]` (galaxy.ts'den taşınır; galaxy.ts buradan içe aktarır) ve `export function tempColor(logT: number): [number, number, number]` (0–1 RGB).
- Produces (`ParticleLayer`):
  - `setVisibility(a: Float32Array, b: Float32Array): void` — parçacık başına 0..1 çarpan (mevcut `rhoA/rhoB` öznitelikleri, `uRhoRef = 1`, `uRhoMax = 1` ile).
  - `setTemperature(a: Float32Array, b: Float32Array): void` — log T öznitelikleri `tA/tB`; ilk çağrı `uTemp = 1` yapar, renk shader'da `T_STOPS`'tan (uniform dizi `uStops[5]` vec4: x = logT, yzw = rgb).
  - Kurucuya `scale?: number` (nesne ölçeği; galaksi için 0.1).

- [ ] **Step 1: Failing testler**

```ts
// format.test.ts (ek)
test('channels round trip per group and frame', () => {
  const h: BakeHeader = { version: 1, times: [0, 1], groups: [{ name: 'a', count: 1 }, { name: 'b', count: 2 }], half: 1, channels: [{ name: 'kind', group: 'b', lo: 0, hi: 2 }, { name: 'logT', group: 'b', lo: 4, hi: 7 }] };
  const f = [new Float32Array(9), new Float32Array(9)];
  const ch = { kind: [new Float32Array([1, 1]), new Float32Array([1, 2])], logT: [new Float32Array([4, 7]), new Float32Array([5.5, 4])] };
  const d = decodeBake(encodeBake(h, f, undefined, ch).buffer as ArrayBuffer);
  assert.deepEqual(Array.from(d.channel('kind', 1)!), [1, 2]);
  assert.ok(Math.abs(d.channel('logT', 1)![0] - 5.5) < 3 / 255 + 1e-6);
  assert.equal(d.channel('nope', 0), null);
});
test('files without channels still decode', () => { /* Faz 1 başlığıyla encode → channel() null, positions aynı */ });

// temperature.test.ts
test('tempColor hits the stops and clamps', () => {
  assert.deepEqual(tempColor(4.0).map((v) => Math.round(v * 255)), [226, 244, 255]);
  assert.deepEqual(tempColor(9).map((v) => Math.round(v * 255)), [255, 111, 200]);
  assert.deepEqual(tempColor(1).map((v) => Math.round(v * 255)), [226, 244, 255]);
});
test('visibility crossfade: a particle turning gas→star sums to one', () => {
  // gas vis a=1,b=0 ; star vis a=0,b=1 ; at mix m both layers' weights sum to 1
  for (const m of [0, 0.3, 0.5, 1]) assert.equal((1 - m) * 1 + m * 0 + ((1 - m) * 0 + m * 1), 1);
});
```
(Son test shader'daki `mix(rhoA, rhoB, uMix)` kuralının iki katmanda tamamlayıcı olduğunu belgeler; görünürlük dizileri Task 3/4'te `kind === 1` / `kind === 2` olarak üretilir.)

- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** uygula. **Step 4:** `npm test`, `npm run typecheck` → PASS. Bullet lab + film görsel olarak değişmedi (Playwright tek ekran görüntüsü).
- [ ] **Step 5: Commit** — `"Dark matter: bake channels, temperature palette in particle layer"`

### Task 2: Galaksi bake'i

**Files:**
- Modify: `scripts/bake-darkmatter.ts` (argüman: `bullet` | `galaxy` | yok = ikisi)
- Create (çıktı): `public/data/darkmatter/galaxy.bin`

**Interfaces:**
- Consumes: `GalaxySim`, `DEFAULTS` (`src/ui/lab/scenes/galaxy.worker.ts`), `snapshot()`.
- Produces: `galaxy.bin` — gruplar `dm` (12 000), `bar` (10 000; gaz+yıldız, sıra sabit); kanallar `kind` (bar, 1..2) ve `logT` (bar, 4..7, yıldızlarda 4); `half: 260` kpc; kare zamanları 0–0,6 Gyr arası 0,015 Gyr, 0,6–3,0 Gyr arası 0,04 Gyr (≈ 100 kare); `meta`: `{ method, nDm, nGas, mDm, mGas, r200 }`; ayrıca kare başına `stats` gerekmez.
- [ ] **Step 1:** betik; `GalaxySim({ ...DEFAULTS, nDm: 12000, nGas: 10000 })`, her kare zamanına gelince `snapshot()` (merkezlenmiş). İlerleme satırı her 0,1 Gyr'de.
- [ ] **Step 2:** `npm run bake:dm -- galaxy` → ≤ 60 dk, dosya ≤ 20 MB; son karede yıldız sayısı > 0 ve soğuk gazın |z| medyanı < R medyanının yarısı (disk oluştu) — betik bunu yazdırır.
- [ ] **Step 3: Commit** — `"Dark matter: galaxy formation bake"`

### Task 3: 3D galaksi oluşumu lab sahnesi

**Files:**
- Modify: `src/ui/lab/scenes/galaxy.ts`, `galaxy.css`

**Interfaces:**
- Consumes: `Stage`, `ParticleLayer` (`setVisibility`, `setTemperature`, `scale`), `T_STOPS` (Task 1).
- [ ] **Step 1:** İki 2D canvas yerine tek 16:9 `Stage` (Büyüt düğmeli, saat ve "Izgara karesi 20 kpc" kaplaması); katmanlar: DM (mor sis, "gerçekte görünmez"), gaz (sıcaklık rengi, görünürlük = kind 1), yıldız (STAR, görünürlük = kind 2). Worker anlık görüntüleri ~150 ms arayla gelir: iki tampon arasında `mix = (now − arrived)/150`. Parçacık sayısı değişince (çözünürlük) katmanlar yeniden kurulur. Kamera başlangıcı 3/4 açı (0, 6, 14) birim, hedef 0. Görünürlük/motor kapısı bullet.ts'deki `shown()` düzeniyle.
- [ ] **Step 2: Doğrulama (Playwright)** — sahne açılır, oynat → ~0,5 Gyr'de mavi soğuk gaz merkeze çöker, yıldızlar belirir; çözünürlük "Yüksek"e geçince çökme yok; kapı (görünürken motor durur, kaydırınca çalışır); 390 px sığar; NaN yok (konsol), perf ≤ 16 ms (`__dmStage`).
- [ ] **Step 3: Commit** — `"Dark matter: 3D galaxy formation lab scene"`

### Task 4: Film bölümü "Halede bir galaksi"

**Files:**
- Create: `src/ui/darkmatter/film/galaxyChapter.ts`
- Modify: `src/ui/darkmatter/film/chapters.ts` (bölüm Mermi Kümesi'nden önce)

**Interfaces:**
- Consumes: `decodeBake`, `Baked.channel`, `ParticleLayer`, `simTime`, `Chapter`.
- [ ] **Step 1:** bölüm verisi: `id 'galaxy'`, `title 'Halede bir galaksi'`, `duration 44`, sim `simTime(t, [2, 38], [0, 3])`; `lab: { tab: 'interaction', anchor: 'galaxy' }`. Altyazılar (birebir):
  - 0–7: "Bir karanlık madde halesi: görünmez, ama içindeki gazı kütleçekimiyle tutuyor."
  - 7–15: "Gaz başta sıcak ve seyrek. Işınım yaptıkça enerji kaybediyor ve soğuyor (mavi)."
  - 15–24: "Soğuyan gaz merkeze düşüyor ve dönerek bir diske yassılaşıyor. Karanlık madde soğuyamaz: küre olarak kalıyor."
  - 24–33: "Diskte gaz yoğunlaşınca yıldızlar doğuyor. Süpernovalar çevredeki gazı yeniden ısıtıyor (pembe)."
  - 33–44: "Karanlık maddeyi gizleyince yalnız görünen galaksi kalır. Oysa kütlenin %85'i o görünmeyen halede."
  Yöntem satırı: "Barnes-Hut kütleçekimi + SPH gaz, ışınımla soğuma, yıldız oluşumu ve süpernova geri beslemesi; 12 000 karanlık madde + 10 000 gaz parçacığı. Zaman hızlandırılmış: 3 milyar yıl ≈ 36 s."
  Kamera (birim = 10 kpc): 0 s (0, 14, 46) → 10 s (0, 9, 30) → 22 s (12, 7, 16) → 32 s (0, 3.5, 11) → 38 s (0, 11, 4) (yüzden) → 44 s (2, 8, 8).
  DM opaklığı 33–36 s'de 0'a iner (tam), 41–44 s arası %40'a döner. Lejant: DM / gaz (sıcaklık çubuğu) / yıldızlar.
- [ ] **Step 2: Doğrulama (Playwright)** — altyazılar zamanında; bölüm çipleri sırası Galaksi, Mermi Kümesi, Kapanış; galaksi bölümünden "dene" → lab `galaxy` kartı, Mermi Kümesi'nden → `bullet`; 1920×1080 ≤ 16 ms; 390 px kadraj.
- [ ] **Step 3: Commit** — `"Dark matter: film chapter, a galaxy forms in its halo"`
