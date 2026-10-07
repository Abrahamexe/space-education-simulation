// One-off: download deep-sky images (public domain, Wikimedia Commons) and
// make a 4K (long side) texture plus a 1K copy used for sampling/preview.
// Run: node scripts/fetch-deepsky.mjs
import sharp from 'sharp';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';

const UA = { 'User-Agent': 'space-education-simulation/1.0 (https://github.com/Abrahamexe/space-education-simulation)' };
const SRC = 'assets-src/deepsky';
const OUT = 'public/textures/deepsky';
mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });

const FILES = {
  crab: 'File:Crab_Nebula.jpg',
  orion: 'File:Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg',
  pillars: 'File:Pillars_of_Creation_(NIRCam_Image).jpg',
  ring: 'File:Ring_Nebula_(NIRCam_Image).png',
  carina: 'File:NASA’s Webb Reveals Cosmic Cliffs, Glittering Landscape of Star Birth.jpg',
  southernring: 'File:Southern Ring Nebula (NIRCam Image).png',
  helix: 'File:NGC7293 (2004).jpg',
  catseye: 'File:NGC6543.jpg',
  butterfly: 'File:NGC 6302 Hubble 2009.full.jpg',
  horsehead: 'File:Horsehead-Hubble.jpg',
  casa: 'File:Cassiopeia A (MIRI Image).jpg',
  etacar: 'File:Eta Carinae.jpg',
  westerlund2: 'File:NASA Unveils Celestial Fireworks as Official Hubble 25th Anniversary Image.jpg',
  lagoon: 'File:Lagoon Nebula (Visible-light View) (2018-21-4150).png',
  veil: 'File:Ultraviolet image of the Cygnus Loop Nebula crop.jpg',
  trifid: 'File:The Day of the Trifid Nebula.png',
};

async function info(title) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.search = new URLSearchParams({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|size', format: 'json' });
  const d = await (await fetch(u, { headers: UA })).json();
  return Object.values(d.query.pages)[0].imageinfo[0];
}

async function thumb(title, width) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.search = new URLSearchParams({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(width), format: 'json' });
  const d = await (await fetch(u, { headers: UA })).json();
  const i = Object.values(d.query.pages)[0].imageinfo[0];
  return i.thumburl ?? i.url;
}

const sizes = {};
for (const [id, title] of Object.entries(FILES)) {
  const src = `${SRC}/${id}_src.jpg`;
  if (!existsSync(src)) {
    const { width, height } = await info(title);
    // Long side 4096 (or the original if smaller).
    const long = Math.max(width, height);
    const w = Math.round((Math.min(4096, long) * width) / long);
    const url = await thumb(title, w);
    const buf = Buffer.from(await (await fetch(url, { headers: UA })).arrayBuffer());
    await sharp(buf, { limitInputPixels: false }).jpeg({ quality: 95 }).toFile(src);
  }
  const meta = await sharp(src).metadata();
  const long = Math.max(meta.width, meta.height);
  const hi = await sharp(src).resize({ width: Math.round((Math.min(4096, long) * meta.width) / long) }).jpeg({ quality: 90, mozjpeg: true }).toFile(`${OUT}/${id}_4k.jpg`);
  const lo = await sharp(src).resize({ width: Math.round((1024 * meta.width) / long) }).jpeg({ quality: 88, mozjpeg: true }).toFile(`${OUT}/${id}_1k.jpg`);
  sizes[id] = [hi.width, hi.height];
  console.log(id.padEnd(13), `${hi.width}x${hi.height}`, `${(hi.size / 1024).toFixed(0)} KB`, `1k ${lo.width}x${lo.height}`);
}
writeFileSync(`${SRC}/sizes.json`, JSON.stringify(sizes, null, 1));
