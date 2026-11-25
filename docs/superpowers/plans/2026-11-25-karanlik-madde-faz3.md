# Karanlık madde sinematik — Faz 3 (kozmik ağ / BAO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (user chose inline execution). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BAO laboratuvar sahnesine profillerden türetilmiş 3D ses kabuğu görünümü eklemek ve filme ilk bölüm "Karanlık ağ"ı (ses kabuğu → Zel'dovich kozmik ağı) eklemek.

**Architecture:** BAO yarı-analitik modeli saf bir modüle (`baoModel.ts`) taşınır; kabuk görünümü her bileşen için parçacık başına sabit (yön, u) çiftinden ters-CDF ile yarıçap çizer, böylece zaman kaydırıcısıyla kabuklar akıcı hareket eder. Kozmik ağ, tohumlu Gauss rastgele alanından (BBKS P(k)) FFT ile hesaplanan Zel'dovich yer değiştirmesidir; gaz, basınç ölçeğinde süzülmüş yer değiştirmeyi gecikmeyle izler. FFT `bullet.worker.ts`'teki `FFT3`'ten ortak modüle taşınır. Hepsi çalışma anında üretilir (bake yok).

**Tech Stack:** Faz 1–2 ile aynı.

**Spec:** `docs/superpowers/specs/2026-11-25-karanlik-madde-sinematik-design.md` (özellikle "Gözden geçirme sonrası netleştirmeler": BAO kabukları + "simülasyon değil" etiketi; bölüm 1 önce kabuk, sonra Zel'dovich).

## Global Constraints

- Faz 1 Global Constraints aynen geçerli.
- BAO 3D görünümünde açıkça: "Bu bir simülasyon değil: modelin kütle profilinin 3D çizimi."
- Kozmik ağ bölümünde yöntem satırı: Zel'dovich yaklaşımı ve gaz gecikmesinin basitleştirme olduğu yazılır.
- Mevcut BAO lab içeriği (grafik, kaydırıcı, okumalar, notlar) korunur; 3D görünüm grafiğin üstüne eklenir.

## Review Focus

1. Profil r²δ bazı yarıçaplarda negatif olabilir (drag sonrası fark terimi): örnekleyici negatifi 0 saymalı, NaN/sonsuz yarıçap üretmemeli. → Task 2 testi.
2. Zaman kaydırıcısı hızla sürüklenince kabuk görünümü her olayda yeniden hesaplanır: kare başına en fazla bir yeniden örnekleme. → Task 2 doğrulaması.
3. D = 0'da ağ parçacıkları tam ızgarada; D büyüdükçe yoğunluk varyansı tekdüze artmalı (ters gitmemeli). → Task 3 testi.
4. Kozmik ağ üretimi ana iş parçacığını kilitler (FFT): bölüm "Yükleniyor…" gösterirken yapılmalı, < 1 s. → Task 4 doğrulaması.
5. Bölüm sırası: Karanlık ağ, Galaksi, Mermi, Kapanış; "dene" bağlantısı BAO kartına. → Task 4 doğrulaması.

---

### Task 1: BAO modeli saf modül + ortak FFT

**Files:**
- Create: `src/ui/lab/scenes/baoModel.ts` (bao.ts'deki kozmoloji, tablolar, `fieldsAt`, `RADII`, `NR`, `Z_D`, `soundHorizon`, `cosmicAge` vb. buraya taşınır ve dışa aktarılır; bao.ts içe aktarır)
- Create: `src/ui/darkmatter/fft.ts` (`FFT3` bullet.worker.ts'den taşınır, dışa aktarılır; bullet.worker içe aktarır)
- Test: `tests/darkmatter/baoModel.test.ts`, `tests/darkmatter/fft.test.ts`

**Interfaces:**
- Produces: `fieldsAt(z): Fields` (`dm, baryon, photon, neutrino: Float64Array` NR uzunlukta, `centralGrowth`), `RADII`, `NR`, `Z_D`, `soundHorizon(z)`, `cosmicAge(z)`; `class FFT3 { constructor(n); forward(re, im); inverse(re, im) }` (mevcut imza neyse aynen).
- [ ] **Step 1: Failing testler** — `soundHorizon(Z_D)` 140–155 Mpc; `fieldsAt(Z_D)` baryon profilinin tepe yarıçapı 140–155 Mpc; `fieldsAt(0)` karanlık madde profilinde de ~150 Mpc civarında yerel tepe (yarıçap 120–170 arası yerel maksimum var); FFT ileri+geri birim (rastgele 8³, hata < 1e-9).
- [ ] **Step 2:** FAIL. **Step 3:** taşı (davranış değişmez). **Step 4:** `npm test`, typecheck; BAO ve Mermi lab sahneleri değişmeden çalışır (Playwright, konsol temiz).
- [ ] **Step 5: Commit** — `"Dark matter: BAO model and FFT as shared modules"`

### Task 2: BAO 3D kabuk görünümü (lab)

**Files:**
- Create: `src/ui/darkmatter/shells.ts` — `export function profileSampler(radii: Float64Array, profile: Float64Array): (u: number) => number` (negatifler 0, kümülatif ters CDF, doğrusal ara değer; profil tümüyle ≤ 0 ise 0 döner).
- Modify: `src/ui/lab/scenes/bao.ts`, `bao.css`
- Test: `tests/darkmatter/shells.test.ts`

**Interfaces:**
- Consumes: `fieldsAt`, `RADII` (Task 1); `Stage`, `ParticleLayer`.
- [ ] **Step 1: Failing testler** — tek Gauss kabuğu (μ = 100, w = 5) için `u = 0.5` → 99–101; `u = 0`/`1` sınırlar içinde; profil tümüyle negatif/sıfır → her u için 0, NaN yok; negatif kısımlı profilde dönen değerler yalnız pozitif bölgede.
- [ ] **Step 2–4:** uygula, PASS.
- [ ] **Step 5:** bao.ts'e grafiğin üstüne 16:9 `Stage` (Büyüt, kaplama: zaman/yaş, "Bu bir simülasyon değil: modelin kütle profilinin 3D çizimi."). Bileşen başına 3000 parçacık, sabit tohumlu yön + u; yarıçap = örnekleyici(u); renkler: karanlık madde DM moru, baryon `#ffd27a`, foton `#9fd8ff`, nötrino `#8fe3b0`; ölçek 1 birim = 30 Mpc. Grafikteki onay kutuları 3D katmanları da açar/kapar. Yeniden örnekleme yalnız zaman değişince ve kare başına en fazla bir kez. Motor kapısı bullet düzeniyle.
- [ ] **Step 6: Doğrulama (Playwright)** — z = 10⁵'te merkezde top; drag civarında baryon+foton kabuğu ~150 Mpc; bugün karanlık maddede de kabuk izi; kaydırıcı hızlı sürüklenince takılma yok; kapı; perf ≤ 16 ms.
- [ ] **Step 7: Commit** — `"Dark matter: 3D sound-shell view in the BAO lab scene"`

### Task 3: Zel'dovich kozmik ağı (saf modül)

**Files:**
- Create: `src/ui/darkmatter/cosmicWeb.ts`
- Test: `tests/darkmatter/cosmicWeb.test.ts`

**Interfaces:**
- Produces: `export interface Web { n: number; box: number; q: Float32Array; psi: Float32Array; psiGas: Float32Array }` (q: ızgara konumları, ψ: yer değiştirme alanı, birim Mpc başına D=1) ve `export function makeWeb(opts: { n: number; box: number; seed: number; gasScale: number }): Web` — BBKS P(k) (Ω_m h = 0.21) ile Gauss alan, `ψ_k = i k δ_k / k²`, k = 0 modu sıfır; gaz için ψ ayrıca `exp(−k² gasScale²/2)` ile süzülür. `export function positionsAt(web: Web, D: number, Dgas: number, out: Float32Array, outGas: Float32Array): void` (periyodik sarma).
- [ ] **Step 1: Failing testler** — n = 16: ψ ortalaması ≈ 0 (|ort| < 1e-6·rms); D = 0'da konumlar = q; D artınca hücre-sayısı varyansı artar (D = 0.5 < D = 1 < D = 2); `psiGas` rms < `psi` rms; aynı tohum aynı sonuç.
- [ ] **Step 2–4:** uygula, PASS. n = 40 üretim süresi Node'da < 500 ms (test yazdırır).
- [ ] **Step 5: Commit** — `"Dark matter: Zel'dovich cosmic web generator"`

### Task 4: Film bölümü "Karanlık ağ"

**Files:**
- Create: `src/ui/darkmatter/film/webChapter.ts`
- Modify: `src/ui/darkmatter/film/chapters.ts` (ilk bölüm), `src/ui/lab/Lab.ts` (film kartı metni)

**Interfaces:**
- Consumes: `fieldsAt`, `soundHorizon`, `cosmicAge`, `profileSampler` (Task 1–2); `makeWeb`, `positionsAt` (Task 3).
- [ ] **Step 1:** bölüm: `id 'web'`, `title 'Karanlık ağ'`, `duration 46`, `lab: { tab: 'interaction', anchor: 'bao' }`.
  - 0–18 s ses kabuğu: log10(1+z) 5 → 0 doğrusal; karanlık madde, baryon, foton kabukları (Task 2 görünümüyle aynı); kaplama yaş.
  - 18–22 s geçiş: kabuk sönerken ağ parçacıkları belirir.
  - 22–46 s ağ: 40³ karanlık madde + 40³ gaz, kutu 300 Mpc (1 birim = 30 Mpc); D(t) 0.05 → 1.6 (smoothstep); gaz Dgas = D·g(t), g 22–30 s arası 0.35 → 1 ("gaz önce geride kalır, sonra kuyulara akar"); gaz `gasScale` 4 Mpc.
  - Altyazılar (birebir):
    - 0–9: "Büyük Patlama'dan hemen sonra: madde neredeyse pürüzsüz. Küçük bir fazlalıkta ses dalgası dışarı yayılıyor."
    - 9–18: "Gaz ışıkla birlikte sürüklenip kabuk oluyor. Karanlık madde ışıkla etkileşmez, merkezde kalıp çökmeye başlıyor."
    - 18–28: "Karanlık madde ışıkla etkileşmez, bu yüzden ilk çöken o olur. Gaz önce geride kalır."
    - 28–38: "Karanlık madde ince iplikler ve düğümlerden bir ağ örüyor; gaz kütleçekimiyle bu kuyulara akıyor."
    - 38–46: "Galaksiler bu ağın düğümlerinde doğacak. İskeleti görünmeyen madde kuruyor."
  - Yöntem satırı: "Ses kabuğu: yarı-analitik model (Eisenstein, Seo & White 2007), simülasyon değil. Ağ: Zel'dovich yaklaşımı, BBKS güç tayfı; gaz basınç ölçeğinde (4 Mpc) süzülmüş ve gecikmeli izliyor (basitleştirme)."
  - Kamera (birim = 30 Mpc): 0 s (0, 3, 22) → 18 s (0, 2, 14) → 22 s (0, 6, 22) → 34 s (8, 4, 14) → 46 s (4, 2, 9).
- [ ] **Step 2: Doğrulama (Playwright)** — altyazılar zamanında; çip sırası Karanlık ağ / Halede bir galaksi / Mermi Kümesi / Bildiklerimiz; "dene" → `interaction#bao`; üretim < 1 s; 1920×1080 ≤ 16 ms; konsol temiz.
- [ ] **Step 3: Commit** — `"Dark matter: film chapter, the dark web"`
