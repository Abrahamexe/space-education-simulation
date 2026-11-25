# Galaksiye yeni cisimler

Tarih: 2026-11-25 · Durum: onaylandı (kullanıcı: "A ile devam et")

## Niyet

Galaksi görünümündeki ~40 hedefe dört grupta ~38 yeni cisim eklemek. Kullanıcı: "görüntü kaliteleri güzel olsun, 3 boyutlu olsun".

## Hedefler

- Ünlü yıldızlar ve gezegen sistemleri (12): Vega, Polaris (Aa+Ab), Rigel, Antares (A+B), Aldebaran, Arcturus, Deneb, Barnard Yıldızı (4 gezegen, 2025), 51 Pegasi (b), Kepler-186 (5), Kepler-452 (b), TOI-700 (4).
- Nebulalar (9): Kartal (M16 bütünü), Rozet, Hilal, Kabarcık, Halter (M27), Eskimo, Kum Saati, Kalp, Kuzey Amerika.
- Kümeler (8): Hyades, Arı Kovanı (M44), h Persei ve χ Persei (Çift Küme, iki kayıt), M13, 47 Tukan, M4, Kemer (Arches), Beşli (Quintuplet).
- Kompakt ve egzotik (8): Gaia BH1, Gaia BH2, V404 Cygni, SS 433 (presesyon yapan jetler), Tycho ve Kepler süpernova kalıntıları, PSR J0437−4715 (RX J1856 yerine), Swift J1818.0−1607.

## Hedef dışı

- Yeni bulutsu derinlik modeli, gerçek üye konumlarıyla Gaia kümeleri, bulutsu başına elle derinlik haritası (yaklaşım B, reddedildi).
- CC BY-SA ya da lisansı belirsiz görseller.

## Kısıtlar

- Yalnız kamu malı ya da CC BY görseller; atıflar `docs/CREDITS.md`.
- Konumlar J2000 RA/Dec + uzaklık; yıldız ve yörünge değerleri yayımlanmış kataloglardan (yaklaşık olanlar kartta "yaklaşık").
- Türkçe kart metinleri; mevcut kayıt biçimi (`config/deepsky.ts`).
- Performans: galaksi görünümü bugünkü düzeyde kalır (yeni nebulalar yalnız yakındayken çizilir — mevcut `visibleWidths`).

## Yaklaşımlar

| | Yol | Artı | Eksi |
|---|---|---|---|
| **A (seçildi)** | Mevcut çizim sistemlerini yeniden kullan: her cisim bir veri kaydı; nebulalara foto + derinlik modeli | Hızlı, bugünkü kaliteyle aynı (4K doku + 16K karo + 3D dilim) | Tüm cisimler hazır modellere uymak zorunda |
| B | Cisim başına özel 3D | En özgün | Çok uzun; veri yok |

## Tasarım

- Yeni kod yalnız SS 433 jetleri: `SystemDef.jets?: { precessionDays; coneDeg; lengthAu; speedC }`; `StarSystem` birinci cismin etrafına pulsar ışın geometrisini (`PulsarBeams`) jet renginde ve presesyon süresiyle ekler. Kart "jet" bilgisini facts'ten verir.
- Çift Küme iki ayrı küme kaydı (yeni kod yok).
- Görseller: `fetch-deepsky.mjs` FILES'a eklenir (4K + 1K); > 4K kaynaklar `build-hires.mjs` FILES'a da (16K karolar).
- Benim kararlarım: RX J1856 yerine PSR J0437−4715 (sönük termal nötron yıldızına pulsar ışını çizmek yanıltıcı); Barnard'ın 4 gezegeni (2025) yarıçapları tahmini.
