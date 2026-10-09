// High-resolution tiles for the deep-sky and extragalactic pictures whose
// originals are larger than the 4K textures. Downloads each original once
// (assets-src/hires), caps it at 16K (long side) and cuts a DeepZoom pyramid
// of 1024 px WebP tiles into public/tiles/<id>/, keeping only the levels
// sharper than the 4K base texture. public/tiles/index.json lists them; the
// app streams the tiles it needs up close (SlicedNebula's detail window).
// The tiles are large (~0.5 GB), so they stay out of git: run once with
//   npm run hires            (all)       npm run hires -- orion m51  (some)
import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UA = { 'User-Agent': 'space-education-simulation/1.0 (https://github.com/Abrahamexe/space-education-simulation)' };
const SRC = 'assets-src/hires';
const OUT = 'public/tiles';
const MAX_LONG = 16384;
const BASE_LONG = 4096;
const TILE = 1024;

/** Same pictures as scripts/fetch-deepsky.mjs and fetch-extragalactic.mjs, at full size. */
const FILES = {
  orion: 'File:Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg',
  pillars: 'File:Pillars_of_Creation_(NIRCam_Image).jpg',
  carina: 'File:NASA’s Webb Reveals Cosmic Cliffs, Glittering Landscape of Star Birth.jpg',
  helix: 'File:NGC7293 (2004).jpg',
  westerlund2: 'File:NASA Unveils Celestial Fireworks as Official Hubble 25th Anniversary Image.jpg',
  lagoon: 'File:Lagoon Nebula (Visible-light View) (2018-21-4150).png',
  veil: 'File:Ultraviolet image of the Cygnus Loop Nebula crop.jpg',
  m51: 'File:Messier51 sRGB.jpg',
  m101: 'File:M101 hires STScI-PRC2006-10a.jpg',
  m104: 'File:M104 ngc4594 sombrero galaxy hi-res.jpg',
  ngc1300: 'File:Hubble2005-01-barred-spiral-galaxy-NGC1300.jpg',
  stephan: "File:Stephan's Quintet taken by James Webb Space Telescope.jpg",
  m82: 'File:M82 HST ACS 2006-14-a-large web.jpg',
};

async function original(title) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.search = new URLSearchParams({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|size', format: 'json' });
  const d = await (await fetch(u, { headers: UA })).json();
  return Object.values(d.query.pages)[0].imageinfo[0];
}

async function download(url, file) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return pipeline(Readable.fromWeb(r.body), createWriteStream(file));
    if (i > 4) throw new Error(`${r.status} ${url}`);
    await new Promise((s) => setTimeout(s, 3000 * (i + 1)));
  }
}

mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const indexFile = `${OUT}/index.json`;
const index = existsSync(indexFile) ? JSON.parse((await import('node:fs')).readFileSync(indexFile, 'utf8')) : {};

for (const [id, title] of Object.entries(FILES)) {
  if (only.length && !only.includes(id)) continue;
  const info = await original(title);
  const ext = info.url.split('.').pop().toLowerCase();
  const src = `${SRC}/${id}.${ext}`;
  if (!existsSync(src)) {
    console.log(id.padEnd(12), `downloading ${(info.size / 1e6).toFixed(0)} MB`);
    await download(info.url, src);
  }
  const long = Math.min(MAX_LONG, Math.max(info.width, info.height));
  const scale = long / Math.max(info.width, info.height);
  const w = Math.round(info.width * scale);
  const h = Math.round(info.height * scale);
  const dir = `${OUT}/${id}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // DeepZoom: level L holds the image at 2^(L - maxLevel) of full size.
  await sharp(src, { limitInputPixels: false })
    .resize(w, h, { kernel: 'lanczos3' })
    .webp({ quality: 86, effort: 4 })
    .tile({ size: TILE, overlap: 0, layout: 'dz', container: 'fs' })
    .toFile(`${dir}/dz`);
  const maxLevel = Math.ceil(Math.log2(Math.max(w, h)));
  const levels = [];
  for (const name of readdirSync(`${dir}/dz_files`)) {
    if (!/^\d+$/.test(name)) continue;
    const L = Number(name);
    const f = 2 ** (L - maxLevel);
    const lw = Math.ceil(w * f);
    const lh = Math.ceil(h * f);
    // Only levels sharper than the 4K base texture are ever fetched.
    if (Math.max(lw, lh) <= BASE_LONG * 1.2) rmSync(`${dir}/dz_files/${name}`, { recursive: true });
    else levels.push({ level: L, w: lw, h: lh });
  }
  rmSync(`${dir}/dz.dzi`, { force: true });
  levels.sort((a, b) => a.w - b.w);
  index[id] = { tile: TILE, ext: 'webp', levels };
  writeFileSync(indexFile, JSON.stringify(index, null, 1));
  console.log(id.padEnd(12), `${w}x${h}`, levels.map((l) => `${l.w}x${l.h}`).join(' '));
}
