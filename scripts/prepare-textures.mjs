// One-off texture preparation (run: `npm run textures`).
//  - Converts Solar System Scope's TIFF maps (not browser-loadable) to PNG/JPG.
//  - Downscales 8K sources (assets-src/) to 4K for close-up use, keeping
//    GPU memory reasonable on integrated graphics (8K RGBA + mips ≈ 180 MB each).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SRC = 'assets-src/textures/earth';
const OUT = 'public/textures/earth';
mkdirSync(OUT, { recursive: true });

const jobs = [
  // 2K: converted only
  { in: `${SRC}/2k_earth_normal_map.tif`, out: `${OUT}/2k_earth_normal_map.png`, width: 2048, png: true },
  { in: `${SRC}/2k_earth_specular_map.tif`, out: `${OUT}/2k_earth_specular_map.jpg`, width: 2048, gray: true },
  // 4K from 8K sources
  { in: `${SRC}/8k_earth_daymap.jpg`, out: `${OUT}/4k_earth_daymap.jpg`, width: 4096 },
  { in: `${SRC}/8k_earth_nightmap.jpg`, out: `${OUT}/4k_earth_nightmap.jpg`, width: 4096 },
  { in: `${SRC}/8k_earth_clouds.jpg`, out: `${OUT}/4k_earth_clouds.jpg`, width: 4096, gray: true },
  { in: `${SRC}/8k_earth_normal_map.tif`, out: `${OUT}/4k_earth_normal_map.png`, width: 4096, png: true },
  { in: `${SRC}/8k_earth_specular_map.tif`, out: `${OUT}/4k_earth_specular_map.jpg`, width: 4096, gray: true },
  { in: 'assets-src/textures/moon/8k_moon.jpg', out: 'public/textures/moon/4k_moon.jpg', width: 4096 },
  // Planets: 4K close-up maps from Solar System Scope's 8K sources (Venus: its 4K cloud map).
  { in: 'assets-src/textures/mercury/8k_mercury.jpg', out: 'public/textures/mercury/4k_mercury.jpg', width: 4096 },
  { in: 'assets-src/textures/venus/4k_venus_atmosphere.jpg', out: 'public/textures/venus/4k_venus_atmosphere.jpg', width: 4096 },
  { in: 'assets-src/textures/mars/8k_mars.jpg', out: 'public/textures/mars/4k_mars.jpg', width: 4096 },
  { in: 'assets-src/textures/jupiter/8k_jupiter.jpg', out: 'public/textures/jupiter/4k_jupiter.jpg', width: 4096 },
  { in: 'assets-src/textures/saturn/8k_saturn.jpg', out: 'public/textures/saturn/4k_saturn.jpg', width: 4096 },
];

for (const j of jobs) {
  let img = sharp(j.in, { limitInputPixels: false }).resize({ width: j.width, kernel: 'lanczos3' });
  if (j.gray) img = img.grayscale();
  img = j.png ? img.removeAlpha().png({ compressionLevel: 9 }) : img.jpeg({ quality: 90, mozjpeg: true });
  const info = await img.toFile(j.out);
  console.log(`${j.out}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
}
