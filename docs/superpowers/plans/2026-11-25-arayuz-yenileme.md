# Arayüz Yenileme Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bugünkü arayüzü "Görev Kontrol" diline (E taslağı) taşımak. Hiçbir düğme, bilgi ya da kısayol kaybolmayacak.

**Architecture:** Yeniden boyama ve yeniden yerleştirme. Bileşenlerin mantığı, olay işleyicileri, `aria` etiketleri ve
kısayolları yerinde kalır. Değişen dosyalar `tokens.css`, `hud.css` ve gerekli yerlerde kapsayıcı DOM'dur. Yeni
mantık iki parçadır, ikisi de testlidir: saf `scalePath` / `routeTo` modülü ve `ViewSwitch.navigateTo`. Kayıpları
Playwright envanter betiği yakalar. Betik eski arayüzde önce yeşil olmalı ve her görevden sonra yeşil kalmalıdır.

**Tech Stack:** TypeScript, Vite, Three.js, düz CSS (tokenlar), node:test (`npm test`), Playwright (MCP
`browser_run_code_unsafe`, `filename` ile).

**Spec:** `docs/superpowers/specs/2026-11-25-arayuz-yenileme-design.md`

## Global Constraints

- Hiçbir `aria-label`, `title`, kısayol ya da Türkçe metin değişmez. Uygulama adı "Güneş Sistemi" kalır.
- Köşe yarıçapı 0. Çizgiler 1 px, beyaz %10–22. Gri dolgulu cam yüzey yok. Etkin durum beyaz dolgu ve siyah yazı.
- Yazı tipleri Geist (başlık 300, gövde 400) ve Geist Mono (etiket, sayı, düğme). Barlow ve IBM Plex Mono kalkar.
- Canlı veri rengi `#8ff0c4`. Başka yerde kullanılmaz.
- Okunurluk için kenar perdeleri (koyu geçişler) kullanılır. Hiçbir büyük alanda `backdrop-filter` olmaz. Açılır
  kutular opak koyu (`rgba(6,7,10,.94)`), ince çerçeveli ve keskin köşelidir.
- Mevcut hareket tokenları (`--ease-*`, `--d-*`) korunur. `prefers-reduced-motion` davranışı korunur.
- Mobil kırılma noktası 760 px (`Hud.ts` `MOBILE_MAX_WIDTH`) aynen kalır.
- Commit mesajlarına Claude ya da Co-Authored-By satırı eklenmez (kullanıcı kuralı).
- Taslak referansı: `public/__mock/ui-mock2.html#e`, `#f`, `#g`, `#h` (Vite ile servis edilir, git'e girmez).

## Review Focus

1. **Parlak sahnede okunurluk** (evren katmanları açık, Güneş yakın plan, galaksi diski merkezde): beyaz %40
   etiketlerin kaybolmaması. Görev 2, 4, 6 ve 7'de parlak sahne ekran görüntüsü alınır ve kontrol edilir.
2. **Çok adımlı ölçek yolu gezintisi:** Güneş Sisteminden "Laniakea"ya tıklayınca galaksi, sonra evren, sonra o
   ölçek gelmeli. Yolda Esc ya da başka bir tıklama gelirse kuyruk iptal edilmeli. Görev 3'teki `routeTo` testi ve
   Görev 5'teki iptal testi bunu sabitler.
3. **Bilgi paneli odak kaydırması:** sağ sütunun genişliği değişince `setViewShift` cismi açık alanda tutmalı. Görev
   4'te panel açıkken ekran görüntüsü alınır.
4. **Mobil 390×844:** sol sütun yatay şerit, sağ sütun alt sayfa olmalı ve hiçbir kontrol ekran dışına taşmamalı.
   Görev 8'de envanter betiği mobil ölçüde de çalışır.
5. **Arayüz boyutu Küçük/Büyük (UiScale):** üst satır sığmazsa sarmamalı, `UiScale`'in yığma mantığı çalışmalı.
   Görev 8'de üç boyutta da ekran görüntüsü alınır.

---

### Task 1: Envanter betiği (eski arayüzde yeşil)

**Files:**
- Create: `tests/ui/inventory.pw.js`

**Interfaces:**
- Produces: `async (page) => { ok: boolean, missing: string[], checked: number }`. Betik
  `mcp__playwright__browser_run_code_unsafe` ile `filename` verilerek çalışır. Dev sunucusu `http://localhost:5173/`.
  Ekran boyutu `page.__mobile` yoksa 1600×900, varsa 390×844.

- [ ] **Step 1: Betiği yaz.** Spec'teki envanterin her satırı bir giriştir: `{ view, name, any: [selector...], key? }`.
  `any` içindeki seçicilerden **biri** görünür (`isVisible`) olmalıdır. Taşınan ya da yeri değişen öğeler için hem
  eski hem yeni seçici yazılır (örn. Güneş Sistemi'ne dön: `['.galaxy-bar [data-back]', '[data-level="solar"]']`).
  Görünüm sırası: solar (açılış) → cisim seçili (Mars, `.nav-item[data-id="mars"]`) → ayarlar açılır kutusu → arama
  (`/`) → yardım (`?`) → uzay araçları menüsü → galaksi (`views.goToGalaxy()`) → Keşfet (`K`) → Samanyolu kartı →
  evren (`views.goToUniverse()`) → Katmanlar ve Kanıtlar açılır kutuları → Laboratuvar (`T`) → çıkış → Film → çıkış →
  oyun alanı (`P`) → çıkış. Kısayol girişleri tuşa basar ve bir durum değişikliğini doğrular
  (`aria-pressed`, `aria-checked`, `data-open` ya da `window.__space` alanı). Sonuç `missing` listesidir.
- [ ] **Step 2: Bugünkü arayüzde çalıştır.**
  Run: `browser_run_code_unsafe` `filename: tests/ui/inventory.pw.js`
  Expected: `ok: true`, `missing: []`. Eksik çıkarsa seçici yanlıştır, arayüz değil. Seçiciyi düzelt.
- [ ] **Step 3: Kanıtla.** Envanterden bir seçiciyi geçici olarak bozup betiğin onu `missing` içinde
  raporladığını gör, sonra geri al.
- [ ] **Step 4: Commit.** `git add tests/ui/inventory.pw.js && git commit -m "UI inventory check: every control, panel and shortcut"`

### Task 2: Tokenlar, yazı tipleri, ortak kontroller

**Files:**
- Modify: `package.json` (bağımlılık), `src/ui/styles/tokens.css`, `src/ui/styles/hud.css:70-183` (Shared controls),
  `src/ui/styles/base.css`

**Interfaces:**
- Produces: tokenlar `--f-display: 'Geist'`, `--f-ui: 'Geist'`, `--f-num: 'Geist Mono'`, `--f-label: 'Geist Mono'`,
  `--r-pill: 0`, `--r-surface: 0`, `--c-accent: #fff`, `--c-accent-ink: #000`, `--c-live: #8ff0c4`,
  `--c-pop: rgba(6,7,10,.94)`, `--c-glass: transparent`, `--t-cap-xs: 400 10px/1.2 var(--f-label)`,
  `--t-cap-sm: 400 11px/1.2 var(--f-label)`, `--t-title: 300 60px/1 var(--f-display)`, `--track-caps: .16em`,
  `--track-title: -.02em`. Sonraki görevler yalnızca bu adları kullanır.

- [ ] **Step 1:** `npm i @fontsource/geist @fontsource/geist-mono && npm rm @fontsource/barlow @fontsource/barlow-condensed @fontsource/ibm-plex-mono`. Expected: kurulum hatasız.
- [ ] **Step 2:** `tokens.css` içe aktarımlarını Geist 300/400/500 ve Geist Mono 300/400 olarak değiştir. Tokenları
  yukarıdaki değerlere çek. `--c-focus` beyaz olsun.
- [ ] **Step 3:** Ortak kontrolleri kare ve ince çizgili yap: `.pill`, `.btn-icon`, `.segmented`, `.chip`. Etkin
  durumlar (`aria-pressed=true`, `aria-checked=true`, `.pill-accent`) beyaz dolgu ve siyah yazı alır. Altın
  `--c-accent` kullanan tüm kurallar artık beyaz token'ı okur; `grep -n "f2b35e\|242, 179, 94" src/ui` ile kalan
  sabit altın değerleri bul ve `var(--c-accent)` yap. İstisnalar yaşanabilir bölge ve katman renk örnekleridir
  (`.ul-sw`, `.nav-swatch`); bunlar veri rengi, aynen kalır.
- [ ] **Step 4:** `npm run build`. Expected: hatasız. Envanter betiği → `ok: true`.
- [ ] **Step 5:** 1600×900'de solar, Mars seçili, galaksi ve evren ekran görüntüleri al, scratchpad'e kaydet ve
  bak. Yazının Geist olduğunu, köşelerin keskin olduğunu ve altın kalmadığını gör.
- [ ] **Step 6: Commit.** `git commit -am "UI tokens: Geist, square hairline controls, white active state"`

### Task 3: Ölçek yolu modeli ve rota planlayıcı (saf, testli)

**Files:**
- Create: `src/ui/scalePath.ts`, `tests/ui/scalePath.test.ts`

**Interfaces:**
- Produces:
  - `export type Level = 'observable' | 'web' | 'laniakea' | 'local' | 'milkyWay' | 'solar'`. İlk dört değer
    `SCALES` id'leriyle aynıdır.
  - `export const LEVEL_ORDER: readonly Level[]` (büyükten küçüğe, yukarıdaki sırayla).
  - `export function crumbs(here: Level): { level: Level; name: string; current: boolean }[]`. Adlar: Evren,
    Kozmik ağ, Laniakea, Yerel Grup, Samanyolu, Güneş Sistemi.
  - `export type Step = { kind: 'toGalaxy' } | { kind: 'toUniverse' } | { kind: 'toSolar' } | { kind: 'toGalaxyFromUniverse' } | { kind: 'scale'; id: 'observable' | 'web' | 'laniakea' | 'local' }`
  - `export function routeTo(from: Level, to: Level): Step[]`

- [ ] **Step 1: Failing test yaz.**
  ```ts
  test('crumbs mark the current level', () => {
    const c = crumbs('milkyWay');
    assert.deepEqual(c.map((x) => x.level), ['observable', 'web', 'laniakea', 'local', 'milkyWay', 'solar']);
    assert.deepEqual(c.filter((x) => x.current).map((x) => x.level), ['milkyWay']);
    assert.equal(c[5].name, 'Güneş Sistemi');
  });
  test('routes', () => {
    assert.deepEqual(routeTo('solar', 'milkyWay'), [{ kind: 'toGalaxy' }]);
    assert.deepEqual(routeTo('solar', 'laniakea'), [{ kind: 'toGalaxy' }, { kind: 'toUniverse' }, { kind: 'scale', id: 'laniakea' }]);
    assert.deepEqual(routeTo('milkyWay', 'solar'), [{ kind: 'toSolar' }]);
    assert.deepEqual(routeTo('web', 'solar'), [{ kind: 'toGalaxyFromUniverse' }, { kind: 'toSolar' }]);
    assert.deepEqual(routeTo('laniakea', 'local'), [{ kind: 'scale', id: 'local' }]);
    assert.deepEqual(routeTo('local', 'milkyWay'), [{ kind: 'toGalaxyFromUniverse' }]);
    assert.deepEqual(routeTo('solar', 'solar'), []);
  });
  ```
- [ ] **Step 2:** `npm test`. Expected: FAIL, "Cannot find module … scalePath".
- [ ] **Step 3:** `scalePath.ts`'yi yaz. Dosya DOM ya da Three.js içe aktarmaz.
- [ ] **Step 4:** `npm test`. Expected: tüm testler PASS (65 + yeni).
- [ ] **Step 5: Commit.** `git commit -m "Scale path model and route planner"`

### Task 4: Güneş Sistemi iskeleti (üst satır, sol liste, sağ sütun, alt bant, kenar perdeleri)

**Files:**
- Modify: `src/ui/Hud.ts`, `src/ui/NavBar.ts`, `src/ui/TimeControls.ts`, `src/ui/Toolbar.ts`, `src/ui/CraftMenu.ts`,
  `src/ui/InfoPanel.ts` (yalnızca sınıf/kapsayıcı), `src/ui/styles/hud.css` (Layout, Top bar, Layer toggles,
  Navigation bar, Time controls, Info panel, Settings, Notice, Hint bölümleri)
- Create: `src/ui/ScalePath.ts`

**Interfaces:**
- Consumes: `crumbs`, `Level` (Görev 3), tokenlar (Görev 2).
- Produces: `class ScalePath { el: HTMLElement; constructor(onGo: (l: Level) => void); set(here: Level, leaf?: string): void }`.
  Her kırıntı `<button data-level="…">`; bulunulan seviye `aria-current="location"`; `leaf` (örn. "Mars") düğme
  olmayan son metindir. Yeni kapsayıcılar `.hud-left` (sol sütun) ve `.vignette` (kenar perdeleri,
  `pointer-events:none`, `z-index: var(--z-labels)` altında).

- [ ] **Step 1:** `.hud` ızgarasını üç bölgeye ayır: üst satır, orta (sol sütun ve boş alan), alt bant. NavBar
  `.hud-left` içine dikey liste olarak girer; renk işareti 5 px kare; etkin öğe `◂`; `nav-indicator` dikey hareket
  eder. CraftMenu düğmesi listenin altında "Uzay araçları ▸"; menüsü sağa açılır.
- [ ] **Step 2:** Üst satır: marka, okuma (`.readout`), geliştirici rozeti markanın altında; ince ayırıcı çizgi
  (`flex:1`); katman anahtarları bitişik grup (kare gösterge `i`, açık = dolu beyaz); Ara kutusu; ? ve ⚙ kare.
  `white-space: nowrap`.
- [ ] **Step 3:** Alt bant: üstte tam genişlik 1 px çizgi; gruplar dikey çizgilerle ayrılır: zaman (⏮ ⏸ ⏭, tarih
  ve hız, ⟲ şimdi) | `ScalePath` (`here = 'solar'`, `leaf` = odaklanan cisim adı, `ctx.engine.rig.focusTarget`'tan
  250 ms aralıkla) | Sinematik/Gerçek, Yörünge/Serbest, oyun alanı, tam ekran, ev. Toolbar'daki "Galaksiye çık"
  düğmesi kırıntı eklendikten sonra kaldırılır; envanter girişi `[data-level="milkyWay"]` kırıntısını kabul eder. `onGo` geçici olarak yalnızca `milkyWay` için `ctx.views.goToGalaxy()`
  çağırır; tam rota Görev 5'tedir.
- [ ] **Step 4:** Bilgi paneli sağ sütun: cam arka planı kalkar, keskin köşe, başlık `--t-title`, istatistikler
  iki sütun ince çizgili satır, karşılaştırma çubukları 2 px, kapat kare. Panel kaydırma alanının sağında 1 px ray
  (`scrollbar` stilize). Okunurluk için `.vignette` sağ kenarı panel açıkken koyulaşır (`body:has(.panel[data-open=true])`).
- [ ] **Step 5:** Bildirim, ipucu ve ayarlar açılır kutusu: `--c-pop` zemin, keskin köşe, ince çerçeve.
- [ ] **Step 6:** `npm run build` hatasız. Envanter `ok: true`. `npm test` yeşil.
- [ ] **Step 7:** Ekran görüntüleri: açılış, Mars seçili, Güneş yakın plan (parlak), ayarlar açık, arama açık.
  `#f` taslağıyla yan yana karşılaştır. Odak kaydırmasında Mars açık alanda olmalı.
- [ ] **Step 8: Commit.** `git commit -am "Solar HUD in the mission-control layout"`

### Task 5: Görünümler arası tam rota (`ViewSwitch.navigateTo`)

**Files:**
- Modify: `src/core/ViewSwitch.ts`, `src/universe/UniverseView.ts` (giriş tamamlandı olayı), `src/ui/Hud.ts`
- Test: `tests/ui/scalePath.test.ts` (yürütücü testi)

**Interfaces:**
- Consumes: `routeTo`, `Step` (Görev 3).
- Produces: `export async function runRoute(steps: Step[], ops: RouteOps, isCancelled: () => boolean): Promise<void>`
  `scalePath.ts` içinde; `type RouteOps = { toGalaxy(): Promise<void>; toUniverse(): Promise<void>; toSolar(): Promise<void>; toGalaxyFromUniverse(): Promise<void>; scale(id): Promise<void> }`.
  `ViewSwitch.navigateTo(to: Level): void` ve `ViewSwitch.level: Level`. `UniverseView.scaleId` (bulunulan ölçek).
  `UniverseView.onEntered(fn)` ve `GalaxyView` için mevcut `onChange` kullanılır.

- [ ] **Step 1: Failing test.**
  ```ts
  test('runRoute runs steps in order and stops when cancelled', async () => {
    const log: string[] = [];
    let cancel = false;
    const op = (n: string) => async () => { log.push(n); if (n === 'toUniverse') cancel = true; };
    const ops = { toGalaxy: op('toGalaxy'), toUniverse: op('toUniverse'), toSolar: op('toSolar'), toGalaxyFromUniverse: op('back'), scale: async (id: string) => { log.push(id); } };
    await runRoute(routeTo('solar', 'laniakea'), ops, () => cancel);
    assert.deepEqual(log, ['toGalaxy', 'toUniverse']);
  });
  ```
- [ ] **Step 2:** `npm test`. Expected: FAIL, `runRoute` tanımsız.
- [ ] **Step 3:** `runRoute`'u yaz. Ardından `ViewSwitch` içinde her işlemi, geçiş bittiğinde çözülen bir Promise
  olarak sar: `goToGalaxy` → `onChange(true)`; `goToUniverse` → `UniverseView` girişi; `returnToSun` →
  `onChange(false)`; `universe.returnHome` → çıkış işleyicisi; `goScale`. İptal koşulları: kullanıcı Esc'e basarsa,
  başka bir kırıntıya tıklarsa ya da yeni bir `navigateTo` gelirse. Bunun için bir sayaç (`routeToken`) kullan.
- [ ] **Step 4:** `npm test` yeşil. Tarayıcıda: Mars seçiliyken "Laniakea" kırıntısına tıkla, galaksi → evren →
  Laniakea geçişini gör; "Güneş Sistemi"ne tıkla, Güneş Sistemi'ne geri dön; yolda Esc'e bas, kuyruğun durduğunu gör.
- [ ] **Step 5: Commit.** `git commit -am "Scale path navigates across views (queued, cancellable)"`

### Task 6: Galaksi görünümü (Keşfet sol sütunda, kart sağ sütunda)

**Files:**
- Modify: `src/ui/GalaxyHud.ts`, `src/ui/styles/hud.css:1578-2168` (Galaxy view)

**Interfaces:**
- Consumes: `ScalePath` (Görev 4), `ViewSwitch.navigateTo` (Görev 5).

- [ ] **Step 1:** Üst satır (galaksi kipi): marka, okuma (`.galaxy-readout` buraya taşınır); sağda Yörüngeler (Y),
  Etiketler (E), Yaşanabilir bölge (B) anahtar grubu, Keşfet arama kutusu (odaklanınca listeye geçer, K), ? (`data-info`), ⚙.
- [ ] **Step 2:** `.galaxy-explore` sol sütunda kalıcı (masaüstünde `data-open` her zaman `true`; mobilde bugünkü
  gibi açılır kapanır). İçindeki sekmeler, arama, kategoriler, satırlar aynı DOM; satırlar ince çizgili tek satır
  "ad … uzaklık". `role="dialog"` masaüstünde `role="region"` olur. Esc yalnızca aramayı temizler. K arama kutusuna
  odaklanır. Liste dikey kaydırılır.
- [ ] **Step 3:** `.galaxy-card` sağ sütun (bilgi paneliyle aynı stil). Yıldız sistemi gezegen çubuğu
  (`.galaxy-system`) sol sütunda Keşfet'in yerine geçer, sistem içindeyken görünür.
- [ ] **Step 4:** Alt bant: ⏸, hız | `ScalePath` (`here='milkyWay'`) | Yörünge/Serbest, ev (H). `data-back` ve
  `data-universe` düğmeleri kaldırılır; işlevleri kırıntılardadır (`navigateTo('solar')`, `navigateTo('local')`).
  Kaynak yazısı sağ alt.
- [ ] **Step 5:** Build, test, envanter yeşil. Galaksi diski merkezdeyken ve TRAPPIST-1 kartı açıkken ekran görüntüsü,
  `#g` ile karşılaştır.
- [ ] **Step 6: Commit.** `git commit -am "Galaxy HUD: explore list on the left, cards on the right, scale path"`

### Task 7: Evren görünümü

**Files:**
- Modify: `src/ui/UniverseHud.ts`, `src/ui/styles/hud.css` (universe kuralları)

- [ ] **Step 1:** Üst satır: marka, okuma; sağda Etiketler (E), Katmanlar ▾ (açılır kutu aynı içerik), Bileşim ▾, ? (`data-info`), ⚙.
- [ ] **Step 2:** Sol sütun: "ÖLÇEK" başlığı altında `data-scale` düğmeleri dikey (1–4 kısayolları gösterilir);
  "ÖĞREN" başlığı altında Oluşum (O), Laboratuvar (T), Film, Kanıtlar ▸ (açılır kutu sağa).
- [ ] **Step 3:** Ölçek kartı (`.galaxy-card`) sağ sütun. Simülasyon paneli (`.sim-panel`) ve `data-sim` kuralları
  korunur. `.vignette` evrende güçlü kipe geçer (`body.mode-universe`).
- [ ] **Step 4:** Alt bant: oynat/durdur, evren yaşı · kırmızıya kayma okuması | `ScalePath`
  (`here` = `UniverseView.scaleId`) | Sinematik/Bilimsel, ev. `data-back` kaldırılır (kırıntı "Samanyolu").
- [ ] **Step 5:** Build, test, envanter yeşil. Tüm katmanlar açıkken (en parlak) ekran görüntüsü, `#h` ile
  karşılaştır. Etiket karşıtlığı göz kontrolü; gerekirse perde koyuluğunu artır.
- [ ] **Step 6: Commit.** `git commit -am "Universe HUD: scale and learn lists, scale card, scale path"`

### Task 8: Laboratuvar, Film, oyun alanı, yardım, yükleme, geliştirici paneli, mobil, arayüz boyutu

**Files:**
- Modify: `src/ui/lab/*.css` ve `Lab.ts` stil sınıfları, `src/ui/darkmatter/film.css`, `src/ui/styles/hud.css`
  (Playground, Help, Responsive), `src/ui/styles/devtools.css`, `src/ui/LoadingScreen.ts` stilleri, `src/ui/UiScale.ts`

- [ ] **Step 1:** Bu yüzeylerde yalnızca dil değişir: zemin `--c-pop` ya da perde, keskin köşe, mono etiket. Sabit
  `border-radius`, `f2b35e` ve Barlow kalıntılarını `grep -rn "border-radius\|Barlow\|f2b35e" src/ui` ile bul.
  Grafik ve veri renkleri kalır.
- [ ] **Step 2:** Mobil (≤760): sol sütun alt bandın üstünde yatay kaydırılan şerit; anahtarlar "Görünüm ▾"
  açılır kutusunda (`tool-optional` mantığı); ölçek yolu yalnızca üst ve bulunulan seviye; panel bugünkü alt sayfa.
- [ ] **Step 3:** `UiScale`: üst satır sığmazsa okuma metni gizlenir, sonra anahtar etiketleri yalnızca kare
  göstergeye düşer (`title` korunur). Yığma eşiği yeni bant yüksekliğine (`--hud-bottom`) göre güncellenir.
- [ ] **Step 4:** Envanter betiğini 1600×900 ve 390×844'te (`page.__mobile = true`) çalıştır. Expected: iki ölçüde
  de `ok: true`. Arayüz boyutu Küçük/Normal/Büyük ekran görüntüleri; sarma ya da taşma yok.
- [ ] **Step 5: Commit.** `git commit -am "Lab, film, playground, help, loading, dev panel and mobile in the new language"`

### Task 9 (isteğe bağlı): Hedef köşe çerçevesi

**Files:**
- Create: `src/ui/TargetFrame.ts`; Modify: `src/ui/Hud.ts`, `hud.css`

**Interfaces:**
- Produces: `class TargetFrame { el; update(): void }`. Her karede odaklanan `CelestialBody`'nin ekran yarıçapını
  (`radius / distance` ve kamera fov) hesaplar; dört köşe ve "HEDEF · AD · x,x° GÖRÜŞ" etiketi. Yarıçap 24 px'ten
  küçük ya da ekranın %80'inden büyükse gizlenir. Serbest kamerada gizli.
- [ ] **Step 1:** Açısal çap için saf `angularDiameterDeg(radiusKm, distanceKm)` + test (`tests/ui/targetFrame.test.ts`:
  Mars 6.792 km çap, 10.000 km mesafede ≈ 37,6°; 0 mesafe → 180).
- [ ] **Step 2:** `npm test` FAIL → uygula → PASS.
- [ ] **Step 3:** Bileşeni bağla, ekran görüntüsü `#f` ile karşılaştır, envanter yeşil.
- [ ] **Step 4: Commit.** `git commit -am "Target frame around the focused body"`

### Son

- [ ] `npm test`, `npm run build`, envanter (iki ölçü) yeşil.
- [ ] Önce/sonra ekran görüntüleri (solar, Mars, galaksi, evren, Laboratuvar, mobil) kullanıcıya gösterilir.
- [ ] Birleştirme ve push için kullanıcıya sorulur. Bu dal `exoplanet-looks`'un üstünde; ikisi birlikte `main`'e girer.
