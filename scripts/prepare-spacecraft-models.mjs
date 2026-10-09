// Spacecraft models from NASA 3D Resources (github.com/nasa/NASA-3D-Resources,
// free to use, no copyright) and science.nasa.gov (New Horizons). Expects the
// source .glb files, downloaded from there under their original names, in
// assets-src/spacecraft-src (see docs/CREDITS.md); welds,
// simplifies the heavy ones, resizes textures to ≤ 2048 px WebP, meshopt-
// compresses the geometry (three's MeshoptDecoder) and writes
// public/models/spacecraft/<id>.glb.
// Run: node scripts/prepare-spacecraft-models.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';

const SRC = 'assets-src/spacecraft-src';
const OUT = 'public/models/spacecraft';
mkdirSync(OUT, { recursive: true });

/** id → source file, vertex ratio to keep when simplifying (1 = as is). */
const MODELS = {
  hubble: ['Hubble Space Telescope (A).glb', 1],
  jwst: ['James Webb Space Telescope (A).glb', 0.3],
  chandra: ['Chandra X-ray Observatory.glb', 1],
  spitzer: ['Spitzer Space Telescope.glb', 1],
  kepler: ['Kepler (A).glb', 1],
  tess: ['Transiting Exoplanet Survey Satellite (TESS) (A).glb', 1],
  iss: ['International Space Station (ISS) (B).glb', 1],
  voyager: ['Voyager Probe (A).glb', 1],
  pioneer: ['Pioneer 10.glb', 1],
  newhorizons: ['New Horizons.glb', 1],
  parker: ['Parker Solar Probe.glb', 1],
  juno: ['Juno (A).glb', 1],
  cassini: ['Cassini-Huygens (A).glb', 1],
};

const cli = (args) => execFileSync(process.execPath, ['node_modules/@gltf-transform/cli/bin/cli.js', ...args], { stdio: 'pipe' });
for (const [id, [file, ratio]] of Object.entries(MODELS)) {
  const out = `${OUT}/${id}.glb`;
  cli([
    'optimize',
    `${SRC}/${file}`,
    out,
    '--compress',
    'meshopt',
    '--texture-compress',
    'webp',
    '--texture-size',
    '2048',
    '--simplify',
    ratio < 1 ? 'true' : 'false',
    ...(ratio < 1 ? ['--simplify-ratio', String(ratio), '--simplify-error', '0.002'] : []),
    '--instance',
    'false',
  ]);
  console.log(id.padEnd(12), `${(statSync(`${SRC}/${file}`).size / 1e6).toFixed(1)} MB →`, `${(statSync(out).size / 1e6).toFixed(1)} MB`);
}
