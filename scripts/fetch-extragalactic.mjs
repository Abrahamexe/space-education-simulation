// One-off: download extragalactic images (Wikimedia Commons; NASA/ESA/CSA
// public domain, ESA/Hubble and ESO CC BY 4.0, a few CC BY 2.0 / 4.0
// amateur mosaics, see docs/CREDITS.md) and make a 4K (long side) texture
// plus a 1K copy used for sampling/preview.
// Run: node scripts/fetch-extragalactic.mjs
import sharp from 'sharp';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';

const UA = { 'User-Agent': 'space-education-simulation/1.0 (https://github.com/Abrahamexe/space-education-simulation)' };
const SRC = 'assets-src/extragalactic';
const OUT = 'public/textures/extragalactic';
mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });

const FILES = {
  m31: 'File:Andromeda Galaxy (with h-alpha).jpg',
  m33: 'File:M33 - The Triangulum Galaxy.jpg',
  m51: 'File:Messier51 sRGB.jpg',
  m101: 'File:M101 hires STScI-PRC2006-10a.jpg',
  m104: 'File:M104 ngc4594 sombrero galaxy hi-res.jpg',
  m87: 'File:M87 jet.jpg',
  cena: "File:Composite of Centaurus A revealing lobes and jets from galaxy's black hole (eso0903a-h).jpg",
  ngc1300: 'File:Hubble2005-01-barred-spiral-galaxy-NGC1300.jpg',
  cartwheel: 'File:Cartwheel Galaxy (NIRCam and MIRI Composite Image) (weic2211a).jpeg',
  stephan: "File:Stephan's Quintet taken by James Webb Space Telescope.jpg",
  antennae: 'File:Antennae galaxies xl.jpg',
  m82: 'File:M82 HST ACS 2006-14-a-large web.jpg',
  hoag: "File:Hoag's object.jpg",
  smacs: "File:Webb's First Deep Field.jpg",
  q3c273: 'File:Best image of bright quasar 3C 273 (10953173335).jpg',
};

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

const sizes = {};
for (const [id, title] of Object.entries(FILES)) {
  const src = `${SRC}/${id}_src.jpg`;
  if (!existsSync(src)) {
    const d = await api({ titles: title, prop: 'imageinfo', iiprop: 'url|size' });
    const { width, height } = Object.values(d.query.pages)[0].imageinfo[0];
    const long = Math.max(width, height);
    const w = Math.round((Math.min(4096, long) * width) / long);
    const t = await api({ titles: title, prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(w) });
    const info = Object.values(t.query.pages)[0].imageinfo[0];
    const buf = await download(w < width ? info.thumburl : info.url);
    await sharp(buf, { limitInputPixels: false }).flatten().jpeg({ quality: 95 }).toFile(src);
    await sleep(1500);
  }
  const meta = await sharp(src).metadata();
  const long = Math.max(meta.width, meta.height);
  const hi = await sharp(src).resize({ width: Math.round((Math.min(4096, long) * meta.width) / long) }).jpeg({ quality: 90, mozjpeg: true }).toFile(`${OUT}/${id}_4k.jpg`);
  const lo = await sharp(src).resize({ width: Math.round((1024 * meta.width) / long) }).jpeg({ quality: 88, mozjpeg: true }).toFile(`${OUT}/${id}_1k.jpg`);
  sizes[id] = [hi.width, hi.height];
  console.log(id.padEnd(10), `${hi.width}x${hi.height}`, `${(hi.size / 1024).toFixed(0)} KB`, `1k ${lo.width}x${lo.height}`);
}
writeFileSync(`${SRC}/sizes.json`, JSON.stringify(sizes, null, 1));
