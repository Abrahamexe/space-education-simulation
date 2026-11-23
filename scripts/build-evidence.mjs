// Pictures for the universe map's "evidence for dark matter" stops (Wikimedia
// Commons: NASA public domain, NOIRLab CC BY 4.0). Two versions each: a card
// picture (WebP) and a sky-subtracted one with alpha, placed in the map.
// Output: public/textures/evidence/<id>.webp and <id>_space.webp
// Run: node scripts/build-evidence.mjs
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';

const UA = { 'User-Agent': 'space-education-simulation/1.0 (https://github.com/Abrahamexe/space-education-simulation)' };
const SRC = 'assets-src/evidence';
const OUT = 'public/textures/evidence';
for (const d of [SRC, OUT]) mkdirSync(d, { recursive: true });

const IMAGES = {
  bullet: 'File:Bullet Cluster (Webb and Chandra Image) (2025-128).png',
  a1689: 'File:Abell 1689 (captured by the Hubble Space Telescope).jpg',
  coma: 'File:Coma Cluster (noirlab2420a).jpg',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, json) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return json ? r.json() : Buffer.from(await r.arrayBuffer());
    if (i > 4) throw new Error(`${r.status} ${url}`);
    await sleep(4000);
  }
}

for (const [id, title] of Object.entries(IMAGES)) {
  const src = `${SRC}/${id}.jpg`;
  if (!existsSync(src)) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    u.search = new URLSearchParams({ action: 'query', format: 'json', titles: title, prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '2400' });
    const info = Object.values((await get(u, true)).query.pages)[0].imageinfo[0];
    console.log('downloading', id);
    await sharp(await get(info.width > 2400 ? info.thumburl : info.url, false)).flatten({ background: '#000' }).jpeg({ quality: 92 }).toFile(src);
    await sleep(800);
  }
  // Card picture.
  await sharp(src).resize(1400, 1400, { fit: 'inside' }).webp({ quality: 84 }).toFile(`${OUT}/${id}.webp`);
  // In-map picture: sky level subtracted, alpha from brightness, soft edges.
  const { data, info } = await sharp(src).resize(1024, 1024, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
  const sorted = Float32Array.from(lum).sort();
  const sky = sorted[Math.floor(sorted.length * 0.3)];
  const rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ex = Math.min(x, W - 1 - x) / (W * 0.08);
      const ey = Math.min(y, H - 1 - y) / (H * 0.08);
      const vig = Math.min(1, ex, ey);
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(Math.max(0, data[i * 3 + c] - sky) * vig);
      rgba[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, lum[i] - sky) / 30) * vig * 255);
    }
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 82 }).toFile(`${OUT}/${id}_space.webp`);
  console.log(id, W, 'x', H);
}
