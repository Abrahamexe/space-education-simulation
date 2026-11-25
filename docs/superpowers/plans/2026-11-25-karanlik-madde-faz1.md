# Karanlık madde sinematik — Faz 1 (ortak 3D çekirdek + Mermi Kümesi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ortak WebGL parçacık çekirdeğini kurmak; Mermi Kümesi laboratuvar sahnesini 3D'ye taşımak; tam ekran film modunu Mermi Kümesi bölümü ve kapanış kartıyla açmak.

**Architecture:** `src/ui/darkmatter/` altında kendi renderer'ı olan bir `Stage` (Three.js + postprocessing), GPU'da iki kare arası ara değerleyen `ParticleLayer`, saf matematik modülleri (pişirilmiş veri formatı, yoğunluk, zayıf mercek) ve film kabuğu. Lab sahnesi canlı worker'dan, film önceden pişirilmiş `public/data/darkmatter/bullet.bin` dosyasından beslenir. Ana motor `gate.ts` üzerinden, lab sahnesi görünürken ve film açıkken durdurulur.

**Tech Stack:** TypeScript, Three.js r186, postprocessing 6.x, gsap, Vite; testler Node 24 yerleşik `node --test` (tip ayıklama ile .ts doğrudan çalışır, yeni bağımlılık yok).

**Spec:** `docs/superpowers/specs/2026-11-25-karanlik-madde-sinematik-design.md`

## Global Constraints

- Web; yeni runtime bağımlılığı yok. Three.js r186 + postprocessing 6.x, gsap mevcut.
- Tüm kullanıcı metinleri Türkçe.
- Shader'lar NaN-güvenli: eşit kenarlı `smoothstep` yok, negatif tabanlı `pow` yok; composer'da mevcut `SanitizeEffect` (src/core/effects/SanitizeEffect.ts) bloom'dan önce.
- Karanlık madde asla "parlayan/çarpışan" madde gibi sunulmaz; görünür olduğu her yerde "gerçekte görünmez" etiketi.
- Mermi Kümesi gazının rengi/parlaklığı "X-ışını parlaklığı (∝ ρ²)" diye etiketlenir, "sıcaklık" denmez.
- Her film bölümünde yöntem ve basitleştirme ekranda bir satırla yazılır.
- Lab sahnesi görünürken ve film açıkken ana `Engine` durur; aynı anda yalnız bir sahnenin worker'ı çalışır.
- Performans: Iris Xe, 1920×1080, medium kalite → ≤ 16 ms/kare (lab ve film).
- Testler `tests/` altında (tsconfig yalnız `src`'yi içerir; `node:test` tipleri `src`'ye girmesin). Testlerde içe aktarma yolları `.ts` uzantılı.
- Commit mesajlarında Claude/Co-Authored-By satırı yok (kullanıcı tercihi).

## Review Focus

1. Ana motor zaten durmuşken (ör. başka bir sebeple) film açılıp kapanırsa motor yanlışlıkla başlatılmamalı; iç içe iki tutma (lab + film) tek bırakmayla motoru başlatmamalı. → Task 1 testleri.
2. `bullet.bin` bulunamaz / bozuk gelirse film çökmemeli; Türkçe hata mesajı gösterip kapanabilmeli. → Task 3 (`decodeBake` geçersiz sihirli sözcükte hata) + Task 7 adımı.
3. Film/lab'ı tekrar tekrar açıp kapatmak WebGL bağlamı sızdırmamalı ("Too many active WebGL contexts" uyarısı yok). → Task 5 ve Task 7 doğrulama adımları.
4. Lab kartı ekrandan kaydırılınca ya da sekme gizlenince worker durmalı ve motor tutma bırakılmalı. → Task 5 doğrulama adımı.
5. Dar ekran (390 px) ve DPR 2'de sahne taşmamalı, kontroller erişilebilir kalmalı. → Task 5 ve Task 7 doğrulama adımları.

---

### Task 1: Test komutu + ana motor kapısı (`gate.ts`)

**Files:**
- Create: `src/ui/darkmatter/gate.ts`
- Create: `tests/darkmatter/gate.test.ts`
- Modify: `package.json` (scripts)
- Modify: `src/main.ts:125-127` (QualityManager oluşturulduktan sonra bağlama)

**Interfaces:**
- Produces:
  - `export interface MainRender { start(): void; stop(): void; isRunning(): boolean; level(): QualityLevel }`
  - `export function bindMainRender(target: MainRender): void`
  - `export function holdMainRender(): () => void` — sayaçlı; ilk tutmada motor çalışıyorsa durdurur ve bunu hatırlar; son bırakmada yalnızca kendisi durdurduysa başlatır. Dönen fonksiyon iki kez çağrılırsa ikincisi etkisiz.
  - `export function mainQuality(): QualityLevel` — bağlı değilse `'medium'`.
  - `Engine` için `isRunning()` yoksa ekle: `get running` özel alanını okuyan `isRunning(): boolean` (`src/core/Engine.ts`).

- [ ] **Step 1: Test komutunu ekle** — `package.json` → `"test": "node --test tests/"`.

- [ ] **Step 2: Failing testleri yaz** (`tests/darkmatter/gate.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindMainRender, holdMainRender, mainQuality } from '../../src/ui/darkmatter/gate.ts';

function fake(running: boolean) {
  const log: string[] = [];
  let r = running;
  return { log, t: { start() { r = true; log.push('start'); }, stop() { r = false; log.push('stop'); }, isRunning: () => r, level: () => 'high' as const } };
}

test('hold stops a running engine and release restarts it', () => {
  const f = fake(true); bindMainRender(f.t);
  const release = holdMainRender(); release();
  assert.deepEqual(f.log, ['stop', 'start']);
});
test('nested holds restart only after the last release', () => {
  const f = fake(true); bindMainRender(f.t);
  const a = holdMainRender(); const b = holdMainRender(); a();
  assert.deepEqual(f.log, ['stop']); b();
  assert.deepEqual(f.log, ['stop', 'start']);
});
test('an engine that was already stopped is not started on release', () => {
  const f = fake(false); bindMainRender(f.t);
  holdMainRender()();
  assert.deepEqual(f.log, []);
});
test('double release is harmless', () => {
  const f = fake(true); bindMainRender(f.t);
  const a = holdMainRender(); const b = holdMainRender(); a(); a();
  assert.deepEqual(f.log, ['stop']); b();
});
test('quality comes from the bound target', () => {
  bindMainRender(fake(true).t);
  assert.equal(mainQuality(), 'high');
});
```

- [ ] **Step 3: Çalıştır, başarısız olduğunu gör** — `npm test` → FAIL (modül yok).
- [ ] **Step 4: `gate.ts`'yi yaz; `Engine.isRunning()` ekle; `main.ts`'de `bindMainRender({ start: () => engine.start(), stop: () => engine.stop(), isRunning: () => engine.isRunning(), level: () => quality.level })`.** `gate.ts` yalnız `import type { QualityLevel } from '../../config/quality'` alır (tip içe aktarması Node'da silinir). `bindMainRender` sayaç durumunu sıfırlar (testler arası bağımsızlık için).
- [ ] **Step 5: `npm test` ve `npm run typecheck`** → PASS, hata yok.
- [ ] **Step 6: Commit** — `git add package.json src/ui/darkmatter/gate.ts src/core/Engine.ts src/main.ts tests/darkmatter/gate.test.ts && git commit -m "Dark matter: main render gate and node test runner"`

---

### Task 2: Mermi Kümesi worker'ı 3D konum gönderir

**Files:**
- Modify: `src/ui/lab/scenes/bullet.worker.ts:876-895` (`project` → 3 bileşen)
- Modify: `src/ui/lab/scenes/bullet.ts` (`splat` ve galaksi çizimi stride 3 okur; davranış aynı kalır)
- Test: `tests/darkmatter/bullet-frame.test.ts`

**Interfaces:**
- Produces: `BulletFrame` dizileri (`dmMain`, `dmSub`, `gas`, `gal`) artık `[x,y,z]` üçlüleri (stride 3), birim Mpc. `BulletSim.project(from, to)` aynı imza, 3 bileşen döner. `export const COUNTS = { dmMain: 6000, dmSub: 2000, gasMain: 3000, gasSub: 1000, galMain: 300, galSub: 100 } as const` worker'dan dışa aktarılır (mevcut `N_*` sabitlerinden).

- [ ] **Step 1: Failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BulletSim, COUNTS } from '../../src/ui/lab/scenes/bullet.worker.ts';

test('frames carry xyz triplets for every population', () => {
  const s = new BulletSim(0); s.step();
  const f = s.frame(s.diagnostics());
  assert.equal(f.dmMain.length, COUNTS.dmMain * 3);
  assert.equal(f.dmSub.length, COUNTS.dmSub * 3);
  assert.equal(f.gas.length, (COUNTS.gasMain + COUNTS.gasSub) * 3);
  assert.equal(f.gal.length, (COUNTS.galMain + COUNTS.galSub) * 3);
  assert.ok(f.dmMain.some((v, i) => i % 3 === 2 && v !== 0), 'z is filled');
});
```

- [ ] **Step 2: `npm test`** → FAIL (uzunluk 2·N).
- [ ] **Step 3: `project` 3 bileşen yazsın; `COUNTS`'u dışa aktar; `bullet.ts` içindeki `splat` ve galaksi döngüsü `pts[3*i]`, `pts[3*i+1]` okusun.**
- [ ] **Step 4: `npm test`, `npm run typecheck`** → PASS. Ardından `npm run dev`, Lab → Etkileşim → Mermi Kümesi eskisi gibi oynuyor (Playwright ekran görüntüsü, önceki görünümle aynı).
- [ ] **Step 5: Commit** — `"Bullet worker: send 3D positions"`

---

### Task 3: Pişirilmiş veri formatı, gaz yoğunluğu ve bake betiği

**Files:**
- Create: `src/ui/darkmatter/bake/format.ts`
- Create: `src/ui/darkmatter/bake/density.ts`
- Create: `scripts/bake-darkmatter.ts`
- Create (çıktı): `public/data/darkmatter/bullet.bin`
- Modify: `package.json` → `"bake:dm": "node scripts/bake-darkmatter.ts"`
- Test: `tests/darkmatter/format.test.ts`, `tests/darkmatter/density.test.ts`

**Interfaces:**
- Produces (`format.ts`):
  - `export interface BakeGroup { name: string; count: number }`
  - `export interface BakeHeader { version: 1; times: number[]; groups: BakeGroup[]; half: number; rho?: { group: string; lo: number; hi: number } }` — `half`: konum nicemleme yarı aralığı (Mpc), `x_q = round(x/half·32767)` kırpılmış; `rho`: o grubun parçacık başına log10 yoğunluğu uint8'e `lo..hi` arası nicemlenir.
  - `export function encodeBake(h: BakeHeader, frames: Float32Array[], rho?: Float32Array[]): Uint8Array` — düzen: ASCII `"DMB1"`, uint32 LE başlık uzunluğu, UTF-8 JSON başlık, 4 bayta hizalama, sonra her kare için tüm grupların int16 xyz'si, `rho` varsa her kare için o grubun uint8 dizisi.
  - `export interface Baked { header: BakeHeader; positions(i: number): Float32Array; rho(i: number): Float32Array | null; locate(t: number): { i: number; j: number; mix: number } }` — `positions` tüm grupları art arda (stride 3, Mpc); `rho` lineer yoğunluk; `locate` `t` < ilk zaman → `{0,0,0}`, > son → `{n-1,n-1,0}`.
  - `export function decodeBake(buf: ArrayBuffer): Baked` — sihirli sözcük yanlışsa `Error('Geçersiz karanlık madde veri dosyası')`.
  - `export function groupRange(h: BakeHeader, name: string): [number, number]` — parçacık indeks aralığı.
- Produces (`density.ts`):
  - `export function cicDensity(pos: Float32Array, from: number, to: number, mass: number, grid: Float32Array, n: number, half: number): void` — stride 3, küp `[-half, half]³`, `n³` hücre, ızgaraya ekler (Msun/Mpc³).
  - `export function sampleDensity(grid: Float32Array, n: number, half: number, x: number, y: number, z: number): number` — üç-doğrusal, kutu dışı 0.

- [ ] **Step 1: Failing testler**

```ts
// format.test.ts
test('round trip keeps positions within quantisation error', () => {
  const h: BakeHeader = { version: 1, times: [0, 0.5], groups: [{ name: 'a', count: 2 }, { name: 'b', count: 1 }], half: 5, rho: { group: 'b', lo: 10, hi: 16 } };
  const f0 = new Float32Array([1, -2, 3, 4.9, 0, -4.9, 0.1, 0.2, 0.3]);
  const f1 = f0.map((v) => -v);
  const baked = decodeBake(encodeBake(h, [f0, f1], [new Float32Array([1e13]), new Float32Array([1e15])]).buffer);
  baked.positions(1).forEach((v, k) => assert.ok(Math.abs(v - f1[k]) <= 5 / 32767 + 1e-6));
  assert.ok(Math.abs(Math.log10(baked.rho(1)![0]) - 15) < 6 / 255 + 1e-6);
  assert.deepEqual(groupRange(baked.header, 'b'), [2, 3]);
});
test('locate clamps and interpolates', () => {
  const baked = decodeBake(encodeBake({ version: 1, times: [0, 1, 2], groups: [{ name: 'a', count: 1 }], half: 1 }, [0, 1, 2].map(() => new Float32Array(3))).buffer);
  assert.deepEqual(baked.locate(-1), { i: 0, j: 0, mix: 0 });
  assert.deepEqual(baked.locate(1.25), { i: 1, j: 2, mix: 0.25 });
  assert.deepEqual(baked.locate(9), { i: 2, j: 2, mix: 0 });
});
test('bad magic throws a Turkish error', () => {
  assert.throws(() => decodeBake(new Uint8Array(16).buffer), /Geçersiz karanlık madde veri dosyası/);
});

// density.test.ts
test('CIC conserves mass inside the box', () => {
  const n = 16, half = 2, grid = new Float32Array(n ** 3);
  const pos = new Float32Array([0, 0, 0, 0.3, -0.7, 1.1, -1.5, 1.5, 0.2]);
  cicDensity(pos, 0, 3, 1e12, grid, n, half);
  const cell = ((2 * half) / n) ** 3;
  assert.ok(Math.abs(grid.reduce((s, v) => s + v, 0) * cell - 3e12) / 3e12 < 1e-5);
});
test('sampled density peaks at a lone particle and is 0 outside', () => {
  const n = 16, half = 2, grid = new Float32Array(n ** 3);
  cicDensity(new Float32Array([0.125, 0.125, 0.125]), 0, 1, 1, grid, n, half);
  assert.ok(sampleDensity(grid, n, half, 0.125, 0.125, 0.125) > sampleDensity(grid, n, half, 0.6, 0.6, 0.6));
  assert.equal(sampleDensity(grid, n, half, 9, 0, 0), 0);
});
```

- [ ] **Step 2: `npm test`** → FAIL.
- [ ] **Step 3: `format.ts` ve `density.ts`'yi yaz.** Hücre merkezli CIC (bullet.ts'deki `splat` ile aynı kural, 3B).
- [ ] **Step 4: `npm test`** → PASS.
- [ ] **Step 5: `scripts/bake-darkmatter.ts`** — `BulletSim(0)` (σ/m = 0, sabit tohum); `T_END`'e kadar `DT` adımları; her 8 adımda (0,016 Gyr) bir kare; gruplar `dmMain, dmSub, gas, gal` (`COUNTS`'tan; `gas` = ana + alt, alt ana kümeden sonra); `half: 5`; gaz yoğunluğu her kare için `cicDensity` (64³, `half 3`, ana/alt gaz kütleleri `sim.ready()`'den) + `sampleDensity` ile parçacık başına; `rho.lo/hi` tüm karelerdeki log10 yoğunluğun %1 / %99,9 yüzdelikleri. Ayrıca başlığa `meta: { sigma: 0, method: 'PM + basit hidro, σ/m = 0' }` ekle (`BakeHeader`'a isteğe bağlı `meta?: Record<string, string|number>`). Çıktı `public/data/darkmatter/bullet.bin`. Bitince boyut ve kare sayısını yazdırır.
- [ ] **Step 6: `npm run bake:dm`** → ~76 kare, dosya ≤ 8 MB. Test: `node -e` ile dosyayı `decodeBake` edip `header.times.at(-1) ≈ 1.2` doğrula.
- [ ] **Step 7: Commit** — betik, modüller, testler ve `bullet.bin` → `"Dark matter: bake format, gas density, bullet bake"`

---

### Task 4: Zayıf mercek matematiği

**Files:**
- Create: `src/ui/darkmatter/lensing.ts`
- Test: `tests/darkmatter/lensing.test.ts`

**Interfaces:**
- Produces:
  - `export function projectSigma(pos: Float32Array, ranges: { from: number; to: number; mass: number }[], n: number, half: number): Float32Array` — xy düzlemine (gökyüzü, gözlemci +z'de) CIC yüzey yoğunluğu, `n²`, Msun/Mpc².
  - `export function deflectionField(sigma: Float32Array, n: number, half: number, soft: number): Float32Array` — `2n²` (αx, αy), doğrudan toplam `α(θ) ∝ Σ_k Σ_k·A·(θ−θ_k)/(|θ−θ_k|²+soft²)`, en büyük büyüklüğe 1 olacak şekilde normalize (ekranda "ölçekli" yazılır). `n = 48` hedef; 48⁴ ≈ 5,3 M işlem, bir kare için kabul.

- [ ] **Step 1: Failing test**

```ts
test('a point mass deflects toward itself with |α|·r ~ const', () => {
  const n = 32, half = 4, sigma = new Float32Array(n * n);
  sigma[(n / 2) * n + n / 2] = 1;
  const a = deflectionField(sigma, n, half, 0.05);
  const cell = (2 * half) / n, c = n / 2 + 0.5;
  const probe = (i: number, j: number) => {
    const k = 2 * (j * n + i), dx = i + 0.5 - c, dy = j + 0.5 - c;
    return { dot: a[k] * dx + a[k + 1] * dy, mag: Math.hypot(a[k], a[k + 1]), r: Math.hypot(dx, dy) * cell };
  };
  const p1 = probe(n / 2 + 4, n / 2), p2 = probe(n / 2 + 10, n / 2);
  assert.ok(p1.dot < 0 && p2.dot < 0, 'points toward the mass');
  assert.ok(Math.abs(p1.mag * p1.r - p2.mag * p2.r) / (p1.mag * p1.r) < 0.1);
});
test('projected sigma conserves mass', () => { /* 3 particles, toplam·hücre alanı = toplam kütle, 1e-5 */ });
```

- [ ] **Step 2: `npm test`** → FAIL.
- [ ] **Step 3: `lensing.ts`'yi yaz** (kütle yoksa sıfır alan, sıfıra bölme yok).
- [ ] **Step 4: `npm test`** → PASS.
- [ ] **Step 5: Commit** — `"Dark matter: weak lensing deflection field"`

---

### Task 5: `Stage` + `ParticleLayer` ve 3D Mermi Kümesi lab sahnesi

**Files:**
- Create: `src/ui/darkmatter/render/Stage.ts`
- Create: `src/ui/darkmatter/render/ParticleLayer.ts`
- Create: `src/ui/darkmatter/render/particle.vert`, `particle.frag` (projenin mevcut GLSL içe aktarma düzeniyle; bkz. `src/galaxy` ya da `src/shaders` örnekleri)
- Create: `src/ui/darkmatter/render/palette.ts`
- Modify: `src/ui/lab/scenes/bullet.ts` (2D canvas → Stage; metinler, okumalar, kaydırıcı, açıklama, kaynaklar ve "Basitleştirmeler" notu korunur)
- Modify: `src/ui/lab/scenes/bullet.css`

**Interfaces:**
- Consumes: `holdMainRender`, `mainQuality` (Task 1); `COUNTS`, stride-3 `BulletFrame` (Task 2); `cicDensity`, `sampleDensity` (Task 3).
- Produces:
  - `export class Stage { constructor(host: HTMLElement, opts?: { level?: QualityLevel; fov?: number }); readonly scene: Scene; readonly camera: PerspectiveCamera; readonly controls: OrbitControls; onUpdate(fn: (dt: number, time: number) => void): () => void; start(): void; stop(): void; render(): void; setFullscreen(on: boolean): void; dispose(): void }` — kendi `WebGLRenderer` (alpha yok, arka plan #02030a), `EffectComposer`: RenderPass → Sanitize → Bloom (mipmapBlur, `levels = QUALITY_PRESETS[level].bloomLevels`, luminanceThreshold 0.2) → Vignette (darkness 0.55) → Noise (opacity 0.035, film greni). `ResizeObserver` ile boyut; piksel oranı `min(devicePixelRatio, QUALITY_PRESETS[level].pixelRatio)`. `start()` ilk çağrıda `holdMainRender()` alır, `stop()`/`dispose()` bırakır. `dispose()` renderer'ı `forceContextLoss()` + `dispose()` eder.
  - `export class ParticleLayer { constructor(opts: { count: number; color: Color; size: number; opacity: number; kind: 'dm' | 'gas' | 'star' }); readonly points: Points; setFrames(a: Float32Array, b: Float32Array, mix: number): void; setRho(a: Float32Array, b: Float32Array, ref: number): void; setOpacity(v: number): void; dispose(): void }` — iki konum özniteliği (`position`, `positionB`) + `uMix`; boyut ekran px'i olarak `size · (1 + log)` sınırlı; additive, depthWrite kapalı. `kind 'dm'`: büyük, yumuşak (Gauss) sprite, düşük opaklık, soğuk mor `#7a5cff`; `'gas'`: parlaklık ∝ `rho/ref` (üst üste binen sprite'larla toplam ∝ ρ²), pembe `#ff6fc8`; `'star'`: küçük, keskin, sarı-beyaz `#fff2d8`.
  - `palette.ts`: `export const DM = '#7a5cff', GAS = '#ff6fc8', STAR = '#fff2d8', BG = '#02030a'`.

- [ ] **Step 1: `Stage` ve `ParticleLayer`'ı yaz.** Kamera başlangıcı: (0, 2.2, 7.5) Mpc'ye bakan, hedef (0,0,0); OrbitControls damping 0.08, minDistance 2, maxDistance 16.
- [ ] **Step 2: `bullet.ts`'yi Stage'e taşı.** Kart üstünde 16:9 tam genişlik sahne; köşede "Büyüt" düğmesi (`setFullscreen`). Katman kutuları: "Karanlık madde (gerçekte görünmez)", "X-ışını parlaklığı (∝ ρ²)", "Galaksiler", "Mercek konturları" (kontur bu task'ta gökyüzü düzleminde (z=0) mevcut marching-squares çizgileri `LineSegments` olarak). Canlı worker kareleri iki tampon arasında `uMix = (now − tLast)/STEP_MS` ile yumuşatılır. Gaz ρ: her worker karesinde `cicDensity` (64³, half 3) + parçacık başına `sampleDensity`; `ref` ilk karenin %99'luk değeri, sıfırlamalarda korunur. Görünürlük: mevcut `shown()`/IntersectionObserver mantığı Stage'i de `start/stop` eder (yani motor tutması yalnız görünürken).
- [ ] **Step 3: `npm run typecheck`, `npm test`** → temiz.
- [ ] **Step 4: Tarayıcı doğrulaması (Playwright, `npm run dev`)** — Evren haritası → Lab (T) → Etkileşim → Mermi Kümesi:
  - Ekran görüntüsü: mor DM bulutu, pembe gaz, beyaz galaksiler görünür; oynat → çarpışma sonrası pembe gaz DM tepelerinin gerisinde kalır.
  - Konsolda hata/uyarı yok; sahneyi ekrandan kaydırınca `__space` motoru durur (`engine.isRunning()` false → kaydırma geri → true) ve worker `pause` alır.
  - Lab'ı 10 kez kapat/aç: "Too many active WebGL contexts" uyarısı yok.
  - 390×844 ve DPR 2: sahne kartı taşmıyor, düğmeler görünür.
  - NaN: Stage'in son render hedefinde HalfFloat tarama (bellek notundaki yöntem) → 0 NaN.
  - Perf: `.playwright-mcp/perf-harness.js` yöntemiyle 1920×1080 medium'da kare süresi ≤ 16 ms.
- [ ] **Step 5: Commit** — `"Dark matter: WebGL stage and 3D Bullet Cluster lab scene"`

---

### Task 6: Mercek katmanı (arka plan galaksilerinin bükülmesi)

**Files:**
- Create: `src/ui/darkmatter/render/LensedBackground.ts`, `lensed.vert`, `lensed.frag`
- Modify: `src/ui/lab/scenes/bullet.ts` ("Mercek konturları" kutusu artık kontur + bükülmüş arka plan)

**Interfaces:**
- Consumes: `projectSigma`, `deflectionField` (Task 4); `Stage` (Task 5).
- Produces: `export class LensedBackground { constructor(opts: { count: number; seed: number; half: number; depth: number }); readonly object: Object3D; setField(alpha: Float32Array, n: number, half: number): void; setStrength(s: number): void; setOpacity(v: number): void; dispose(): void }` — kümelerin arkasında (z = −depth) gökyüzü düzleminde rastgele küçük eliptik galaksi sprite'ları (tohumlu); vertex shader `alpha` DataTexture'ından (RG float, `n×n`) örnekleyip konumu `strength · α` kadar kaydırır ve elipsi teğet yönde uzatır. Görünürlük kamera bakış yönüne bağlı: `+z` eksenine açı 25°'den küçükken tam, 45°'de sıfır (smoothstep 0.707→0.906, kenarlar farklı).

- [ ] **Step 1: `LensedBackground`'u yaz;** alan her worker karesinde değil, 0,05 Gyr'de bir (`projectSigma` n=48, half 3, DM+gaz kütleleri; `deflectionField` soft 0.08) güncellenir.
- [ ] **Step 2: `bullet.ts`'ye bağla;** `setStrength` sabit 0.12 Mpc (ekranda not: "Bükülme miktarı görünür olsun diye büyütüldü; yön ve şekil kütle haritasından").
- [ ] **Step 3: Doğrulama (Playwright)** — kamerayı `+z`'den bakışa getir: arka plan galaksileri kütle tepelerinin çevresinde teğet uzar; yandan bakınca arka plan söner. Typecheck/test temiz, NaN taraması 0.
- [ ] **Step 4: Commit** — `"Dark matter: lensed background galaxies"`

---

### Task 7: Film modu kabuğu + Mermi Kümesi bölümü + kapanış kartı

**Files:**
- Create: `src/ui/darkmatter/film/timeline.ts`
- Create: `src/ui/darkmatter/film/chapters.ts`
- Create: `src/ui/darkmatter/film/bulletChapter.ts`
- Create: `src/ui/darkmatter/Film.ts`, `src/ui/darkmatter/film.css`
- Test: `tests/darkmatter/timeline.test.ts`

**Interfaces:**
- Consumes: `Stage`, `ParticleLayer`, `LensedBackground`, `decodeBake`, `groupRange`, `holdMainRender` (önceki task'lar).
- Produces:
  - `timeline.ts`: `export interface Caption { at: number; until: number; text: string }`; `export function captionAt(caps: Caption[], t: number): Caption | null` (yarı açık `[at, until)`); `export function simTime(t: number, film: [number, number], sim: [number, number]): number` (film aralığını sim aralığına doğrusal eşler, dışında kırpar).
  - `chapters.ts`: `export interface ChapterRuntime { update(t: number, dt: number): void; dispose(): void }`; `export interface Chapter { id: string; title: string; duration: number; captions: Caption[]; method: string; lab?: { tab: 'interaction'; anchor: string }; build(stage: Stage): Promise<ChapterRuntime> }`; `export const CHAPTERS: Chapter[]` (Faz 1: `bullet`, `unknowns`).
  - `Film.ts`: `export class Film { constructor(opts: { onTry: (tab: 'interaction', anchor: string) => void }); open(chapterId?: string): Promise<void>; close(): void }` — tam ekran `.dm-film` katmanı; altta: oynat/duraklat, bölüm çipleri, kapat (Esc da kapatır), "Gerçek simülasyonda dene" (bölümün `lab`'ı varsa); altyazı kutusu; sol altta yöntem satırı (`method`). Açıkken `holdMainRender()`; kapanınca Stage `dispose`. Veri yüklenemezse sahne yerine "Film verisi yüklenemedi. İnternet bağlantını kontrol edip tekrar dene." ve kapat düğmesi çalışır.

- [ ] **Step 1: Failing test** (`timeline.test.ts`)

```ts
test('captionAt picks the caption whose window holds t', () => {
  const caps = [{ at: 0, until: 5, text: 'a' }, { at: 5, until: 9, text: 'b' }];
  assert.equal(captionAt(caps, 4.99)?.text, 'a');
  assert.equal(captionAt(caps, 5)?.text, 'b');
  assert.equal(captionAt(caps, 9), null);
});
test('simTime maps and clamps', () => {
  assert.equal(simTime(13, [0, 26], [0, 1.2]), 0.6);
  assert.equal(simTime(-3, [0, 26], [0, 1.2]), 0);
  assert.equal(simTime(40, [0, 26], [0, 1.2]), 1.2);
});
```

- [ ] **Step 2: `npm test`** → FAIL. **Step 3:** `timeline.ts` yaz → PASS.
- [ ] **Step 4: `bulletChapter.ts`** — `fetch(BASE_URL + 'data/darkmatter/bullet.bin')` → `decodeBake`; katmanlar DM (dmMain+dmSub), gaz (rho ile), galaksiler; sim zamanı `simTime(t, [2, 28], [0, 1.2])`; mercek alanı 0,05 Gyr'de bir. Süre 40 s. Kamera (gsap zaman çizelgesi, kullanıcı sürüklerse yol duraklar, "Kameraya dön" ile devam):
  - 0–8 s geniş açı (0, 3, 11) → (0, 1.5, 7);
  - 8–18 s çarpışmaya yakın (1.2, 0.8, 4.5), yavaş yörünge;
  - 18–26 s yan görünüm (0, 0.4, 6) → DM ile gazın ayrılması;
  - 26–33 s gözlemci bakışına dön (0, 0, 8) (+z): DM opaklığı → 0, arka plan mercek → 1;
  - 33–40 s etiketler: DOM etiketleri DM tepesine "Kütle burada (mercekten)", gaz tepesine "Gaz burada (X-ışını)".
  Altyazılar (birebir):
  - 0–8: "İki galaksi kümesi saatte milyonlarca kilometre hızla birbirine yaklaşıyor."
  - 8–18: "Sıcak gaz bulutları çarpışıyor: birbirine sürtünüp yavaşlıyorlar."
  - 18–26: "Karanlık madde ve galaksiler ise neredeyse hiç çarpışmadan birbirinin içinden geçiyor."
  - 26–33: "Karanlık madde gerçekte görünmez. Onu, arkadaki galaksilerin ışığını nasıl büktüğünden buluruz."
  - 33–40: "Kütle ile gaz ayrı yerlerde: kütlenin çoğu görünmeyen maddede."
  Yöntem satırı: "Parçacık-ağ kütleçekimi + basitleştirilmiş gaz, σ/m = 0. Parlaklık X-ışını (∝ ρ²), sıcaklık değil. Zaman hızlandırılmış: 1,2 milyar yıl ≈ 26 s."
  `lab: { tab: 'interaction', anchor: 'bullet' }`.
- [ ] **Step 5: `unknowns` bölümü** — 3D sahne yok; Stage arka planında yavaş dönen karanlık madde sisi + `DM_UNKNOWNS` (src/ui/lab/content.ts'den, dışa aktarılmamışsa dışa aktar) kartı. Süre: kullanıcı kapatana dek.
- [ ] **Step 6: `Film.ts` + `film.css`** (HUD stiliyle uyumlu; `--hud-bottom` ve UiScale zoom kurallarına uy).
- [ ] **Step 7: Doğrulama (Playwright)** — film açılır, 40 s boyunca altyazılar doğru zamanda değişir (ekran görüntüleri 4, 12, 22, 30, 37 s), Esc kapatır ve ana motor yeniden çalışır; `bullet.bin` isteği ağdan engellenince Türkçe hata mesajı görünür ve kapat çalışır; 10 kez aç/kapat sonrası WebGL bağlam uyarısı yok; 390 px'de altyazı ve kontroller taşmıyor; medium 1920×1080 ≤ 16 ms; NaN 0.
- [ ] **Step 8: Commit** — `"Dark matter: film mode with Bullet Cluster chapter"`

---

### Task 8: Giriş noktaları ve son kontrol

**Files:**
- Modify: `src/ui/lab/Lab.ts:167-179` (Etkileşim sekmesinin en üstüne "Filmi izle" kartı)
- Modify: `src/ui/UniverseHud.ts:~114-130` (çubukta film düğmesi, mevcut ikon setinden `film-strip` / uygun Phosphor ikonu)
- Modify: `README.md` (özellik listesine bir satır)

**Interfaces:**
- Consumes: `Film` (Task 7); `Lab.open(tab, anchor)` (mevcut).

- [ ] **Step 1: Lab kartı** — başlık "Film · Karanlık madde ile normal madde", bir cümle açıklama, "Filmi izle" düğmesi. `new Film({ onTry: (tab, anchor) => this.open(tab, anchor) })` (tek örnek, tembel import).
- [ ] **Step 2: UniverseHud düğmesi** — aynı Film örneği; `onTry` → `this.lab.open(tab, anchor)`.
- [ ] **Step 3: Doğrulama** — `npm run typecheck`, `npm test`, `npm run build` temiz; Playwright: iki giriş de filmi açar; "Gerçek simülasyonda dene" filmi kapatır, Lab'ı Etkileşim → Mermi Kümesi'ne kaydırarak açar.
- [ ] **Step 4: Commit** — `"Dark matter: film entry points"`

---

## Sonraki planlar (bu planın dışında)
- Faz 2: galaksi oluşumu (film bölümü 2 + 3D lab, sıcaklık paleti, bake ≤ ~1 saat).
- Faz 3: kozmik ağ / BAO (Zel'dovich bölümü 1 + BAO kabukları lab).
- Faz 4: dönme eğrisi bölümü 3.
- Faz 5: cila ve tüm görünümlerde performans ölçümü.
