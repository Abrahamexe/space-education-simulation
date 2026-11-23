// Local Group galaxy pictures for the universe map: real photos (Wikimedia
// Commons: ESO / NOIRLab / ESA CC BY, NASA public domain, G. Donatiello CC0),
// sky background removed, saved with alpha, and scaled from the measured
// half-light radius of the picture to the catalogue's (McConnachie 2012 R_h,
// pc) so every galaxy is drawn at its true size.
// Output: public/textures/localgroup/<id>.webp, src/data/generated/localgroup.json
// Run: node scripts/build-localgroup.mjs
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const UA = { 'User-Agent': 'space-education-simulation/1.0 (https://github.com/Abrahamexe/space-education-simulation)' };
const SRC = 'assets-src/localgroup';
const OUT = 'public/textures/localgroup';
const OUT_JSON = 'src/data/generated/localgroup.json';
for (const d of [SRC, OUT]) mkdirSync(d, { recursive: true });

/**
 * name: as in universe.json; rh: half-light radius (pc), catalogue or (big ones) literature; px: output size.
 * M31/M33/LMC: the photos' light is bulge-dominated, so rh is set from the visible disc instead.
 */
const GALAXIES = [
  { id: 'm31', name: 'Andromeda (M31)', file: 'File:Andromeda Galaxy (with h-alpha).jpg', rh: 9000, px: 1024, credit: 'Adam Evans (CC BY 2.0)' },
  { id: 'm33', name: 'Üçgen (M33)', file: 'File:M33 - The Triangulum Galaxy.jpg', rh: 5000, px: 1024, credit: 'Popcorn4life (CC BY 4.0)' },
  { id: 'lmc', name: 'Büyük Macellan Bulutu', file: 'File:LMC snapped by the ESO 1-metre Schmidt telescope.jpg', rh: 2800, px: 1024, credit: 'ESO (CC BY 4.0)' },
  { id: 'smc', name: 'Küçük Macellan Bulutu', file: 'File:SMC - Noirlab2030b.jpg', rh: 1100, px: 768, credit: 'CTIO/NOIRLab/NSF/AURA/SMASH (CC BY 4.0)' },
  { id: 'm32', name: 'M32', file: 'File:Messier 32 from Hubble.jpg', rh: 110, px: 768, credit: 'NASA/ESA' },
  { id: 'ngc205', name: 'NGC 205', file: 'File:NGC 205 (M110) (noao-n205block).jpg', rh: 590, px: 512, credit: 'KPNO/NOIRLab/NSF/AURA/Adam Block (CC BY 4.0)' },
  { id: 'ngc185', name: 'NGC 185', file: 'File:NGC 0185 2MASS.jpg', rh: 458, px: 512, credit: '2MASS' },
  { id: 'ngc147', name: 'NGC 147', file: 'File:NGC 0147 2MASS.jpg', rh: 623, px: 512, credit: '2MASS/NASA/ESA' },
  { id: 'ngc6822', name: 'NGC 6822', file: 'File:Euclid’s view of irregular galaxy NGC 6822 ESA25170768.tiff', rh: 354, px: 768, credit: 'ESA/Euclid/Euclid Consortium/NASA (CC BY-SA 3.0 IGO)' },
  { id: 'ic1613', name: 'IC 1613', file: 'File:Dwarf galaxy IC 1613.jpg', rh: 1496, px: 768, credit: 'ESO (CC BY 4.0)' },
  { id: 'ic10', name: 'IC 10', file: 'File:The Local Group dwarf galaxy IC 10 (noao-IC10).jpg', rh: 612, px: 512, credit: 'P. Massey/Lowell, K. Olsen/NOIRLab (CC BY 4.0)' },
  { id: 'wlm', name: 'WLM (Wolf-Lundmark-Melotte)', file: 'File:Wolf-Lundmark-Melotte - Noao-wlm.jpg', rh: 2111, px: 512, credit: 'Local Group Survey Team, T.A. Rector/NOIRLab (CC BY 4.0)' },
  { id: 'ngc55', name: 'NGC 55', file: 'File:Irregular Galaxy NGC 55 (ESO 0914a).jpg', rh: 2900, px: 768, credit: 'ESO (CC BY 4.0)' },
  { id: 'ngc300', name: 'NGC 300', file: 'File:View of the southern spiral NGC 300.jpg', rh: 3025, px: 768, credit: 'ESO (CC BY 4.0)' },
  { id: 'sexa', name: 'Sextans A', file: 'File:The Local Group dwarf galaxy Sextans A (noao-sexa).jpg', rh: 1029, px: 512, credit: 'P. Massey/Lowell, K. Olsen/NOIRLab (CC BY 4.0)' },
  { id: 'sexb', name: 'Sextans B', file: 'File:The Local Group dwarf galaxy Sextans B (noao-sexb).jpg', rh: 440, px: 512, credit: 'P. Massey/Lowell, K. Olsen/NOIRLab (CC BY 4.0)' },
  { id: 'fornax', name: 'Fornax', file: 'File:Fornax dwarf galaxy.jpg', rh: 710, px: 512, credit: 'ESO/Digitized Sky Survey 2 (CC BY 4.0)' },
  { id: 'sculptor', name: 'Sculptor', file: 'File:Sculptor Dwarf Galaxy ESO.jpg', rh: 283, px: 512, credit: 'ESO (CC BY 4.0)' },
  { id: 'ngc3109', name: 'NGC 3109', file: 'File:NGC 3109 imaged by the Dark Energy Camera.jpg', rh: 1626, px: 768, credit: 'DES/DOE/FNAL/DECam/CTIO/NOIRLab/NSF/AURA (CC BY 4.0)' },
  { id: 'ic5152', name: 'IC 5152', file: 'File:IC 5152 imaged by Legacy Surveys.jpg', rh: 550, px: 768, credit: 'Legacy Surveys/D. Lang (CC BY 4.0)' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.search = new URLSearchParams({ action: 'query', format: 'json', ...params });
  for (let i = 0; ; i++) {
    const r = await fetch(u, { headers: UA });
    if (r.ok) return r.json();
    if (i > 4) throw new Error(`${r.status} ${u}`);
    await sleep(4000);
  }
}

async function download(url) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (i > 4) throw new Error(`${r.status} ${url}`);
    await sleep(5000);
  }
}

const out = [];
for (const g of GALAXIES) {
  const src = `${SRC}/${g.id}.jpg`;
  if (!existsSync(src)) {
    // A 3000 px rendering from Commons (originals reach 30k px).
    const d = await api({ titles: g.file, prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '3000' });
    const info = Object.values(d.query.pages)[0].imageinfo?.[0];
    if (!info) throw new Error(`no image ${g.file}`);
    const url = info.width > 3000 ? info.thumburl : info.url;
    console.log('downloading', g.id);
    const buf = await download(url);
    await sharp(buf).jpeg({ quality: 92 }).toFile(src);
    await sleep(800);
  }
  // Square, centred working copy.
  const meta = await sharp(src).metadata();
  const side = Math.min(meta.width, meta.height);
  const N = g.px;
  const { data } = await sharp(src)
    .extract({ left: Math.floor((meta.width - side) / 2), top: Math.floor((meta.height - side) / 2), width: side, height: side })
    .resize(N, N)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Sky level: a low percentile of luminance per channel.
  const lum = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) lum[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
  const sorted = Float32Array.from(lum).sort();
  const sky = sorted[Math.floor(sorted.length * 0.35)];
  const noise = Math.max(sorted[Math.floor(sorted.length * 0.6)] - sky, 2);
  const rgba = Buffer.alloc(N * N * 4);
  const w = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      // Edge vignette: the frame's border never shows.
      const r = Math.hypot((x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5) * 2;
      const vig = 1 - Math.min(1, Math.max(0, (r - 0.7) / 0.28));
      const v = Math.max(0, lum[i] - sky);
      const a = Math.min(1, v / (noise * 6)) * vig;
      // Colour with the sky taken out, premultiplied by alpha.
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(Math.max(0, data[i * 3 + c] - sky) * vig);
      rgba[i * 4 + 3] = Math.round(a * 255);
      w[i] = v * vig;
    }
  // Half-light radius (fraction of the width) about the light-weighted centre.
  let sw = 0;
  let cx = 0;
  let cy = 0;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = w[y * N + x];
      sw += v;
      cx += v * x;
      cy += v * y;
    }
  cx /= sw;
  cy /= sw;
  const rs = [];
  for (let y = 0; y < N; y += 2)
    for (let x = 0; x < N; x += 2) {
      const v = w[y * N + x];
      if (v > 0) rs.push([Math.hypot(x - cx, y - cy), v]);
    }
  rs.sort((a, b) => a[0] - b[0]);
  const total = rs.reduce((s, r) => s + r[1], 0);
  let acc = 0;
  let r50 = 0;
  for (const [r, v] of rs) {
    acc += v;
    if (acc >= total / 2) {
      r50 = r;
      break;
    }
  }
  const r50frac = r50 / N;
  const widthPc = g.rh / Math.max(r50frac, 0.02);
  await sharp(rgba, { raw: { width: N, height: N, channels: 4 } }).webp({ quality: 80, alphaQuality: 85 }).toFile(`${OUT}/${g.id}.webp`);
  out.push({ id: g.id, name: g.name, file: `${g.id}.webp`, widthPc: Math.round(widthPc), centre: [+(cx / N).toFixed(3), +(cy / N).toFixed(3)], credit: g.credit });
  console.log(g.id.padEnd(9), 'r50', r50frac.toFixed(3), 'width kpc', (widthPc / 1000).toFixed(1));
}
writeFileSync(OUT_JSON, JSON.stringify({ note: 'Generated by scripts/build-localgroup.mjs', galaxies: out }, null, 1));
console.log('wrote', OUT_JSON);
