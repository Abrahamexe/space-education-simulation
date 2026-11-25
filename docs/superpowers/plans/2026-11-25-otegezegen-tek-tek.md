# Ötegezegenler tek tek — plan

Kullanıcı kararı: "Veriden sürekli parametre + gezegen başına ölçüm".

**Sorun:** aynı türdeki gezegenler aynı tarifle çiziliyor (yalnız ton ve desen yerleşimi farklı).

**Tasarım**
- `PlanetDef` yeni isteğe bağlı alanlar: `massEarth` (ölçülmüş ya da en az kütle), `atmosphere: 'none' | 'thin' | 'thick'` (yalnız ölçülmüşse), `measured` (kartta "Bilinen" satırı, kaynakla).
- `planetLook(p, star)` (saf): tür + sürekli parametreler: `teq`, `density` (kütle varsa, Dünya = 1), `ice` (soğukla artar), `ocean` (ılıman bant + su zengini yoğunluk), `cloud` (sıcaklıkla artar, atmosfer yoksa 0), `atm` (kenar ışıltısı: yok 0 / ince 0,5 / kalın 1 / bilinmiyor 0,7), `tint` (kaya rengi sıcaklıkla gri → pas → koyu bazalt; alt-Neptün pusu soğuk mavi → sıcak ten; dev bantları), `glow`, `seed` (sistem + gezegen adından; kıta ve bulut yerleşimi).
- Shader bu parametreleri kullanır (okyanus eşiği, buz başlığı genişliği ve donmuş deniz, bulut eşiği, atmosfer gücü, renk).
- Kart: "Bilinen" (yarıçap, kütle, yoğunluk, ölçümler) ve "Tahmin" (görünüm gerekçesi) ayrı.

**Veri (gezegen başına ölçüm)**
- TRAPPIST-1 kütleleri (Agol ve ark. 2021): b 1,374 · c 1,308 · d 0,388 · e 0,692 · f 1,039 · g 1,321 · h 0,326 M⊕. b: JWST 15 µm gündüz ~500 K, kalın atmosfer yok (Greene ve ark. 2023); c: kalın CO₂ atmosferi yok (Zieba ve ark. 2023).
- Barnard en az kütleler (2024–2025): b 0,37 · c 0,34 · d 0,26 · e 0,19 M⊕.
- Proxima b ≥ 1,07 M⊕, d ≥ 0,26 M⊕. 51 Pegasi b ≥ 0,46 M♃ (146 M⊕).

**Görevler**
- [ ] T1 `planetLook.ts` + testler: buz sıcaklıkla tekdüze; `atmosphere: 'none'` → bulut 0, atm 0; yoğunluk < 0,85 → su zengini (okyanus artar); TRAPPIST-1'in yedi gezegeninin parametre demetleri birbirinden farklı; sıcak çöl rengi sıcaklıkla değişir.
- [ ] T2 veri alanları + kayıtlar; katalog testi yeni alanları denetler (kütle > 0).
- [ ] T3 shader + StarSystem + kart; Playwright: TRAPPIST-1 yedi gezegen yakın çekim + Proxima b, Barnard; konsol temiz.
