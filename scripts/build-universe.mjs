// Universe map data (src/universe): galaxy catalogues, a matter-density
// field with its linear-theory flow, and the CMB sky.
//
//  - 2MRS (Huchra et al. 2012, VizieR J/ApJS/199/26): 44,599 galaxies over
//    the whole sky out to ~250 Mpc. Positions from cz / H0.
//  - SDSS DR17 spectroscopic galaxies (0.01 < z < 0.2, a third of them):
//    the cosmic web over the northern sky, out to ~820 Mpc.
//  - Local Group (McConnachie 2012, J/AJ/144/4): ~100 galaxies within ~3 Mpc.
//  - Matter density: 2MRS galaxies weighted by the inverse of the survey's
//    selection function (K-band Schechter function), smoothed with a 4 Mpc
//    Gaussian. Galaxies trace the dark matter (bias ~1.2), so this is the
//    dark-matter map at that resolution.
//  - Flow: linear theory, v(k) = i β H0 δ(k) k / k², with β and the external
//    bulk flow fitted to Cosmicflows-4 group peculiar velocities (Tully+ 2023);
//    streamlines integrated through it converge on the Great Attractor and
//    Shapley, as in the Cosmicflows reconstructions.
//  - CMB: WMAP 9-year ILC map (NASA / WMAP Science Team, public domain),
//    HEALPix → equirectangular in Galactic coordinates.
//
// Everything is in J2000 equatorial Cartesian Mpc (x → RA 0, z → north);
// the app turns it into the scene frame.
// Run: node scripts/build-universe.mjs  (downloads cached in assets-src/universe)
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SRC = 'assets-src/universe';
const OUT = 'public/data/universe';
const OUT_TEX = 'public/textures/universe';
const OUT_JSON = 'src/data/generated/universe.json';
for (const d of [SRC, OUT, OUT_TEX, 'src/data/generated']) mkdirSync(d, { recursive: true });

const H0 = 70;
/** Numbers for the student lab (src/ui/lab): P(k), δ histogram, the Cosmicflows fit. */
const LAB = {};
const C_KMS = 299792.458;
const OMEGA_M = 0.3;
const DEG = Math.PI / 180;

// ---- Downloads ------------------------------------------------------------------------------

async function cached(file, url, opts = {}) {
  const path = `${SRC}/${file}`;
  if (existsSync(path)) return readFileSync(path);
  console.log('downloading', file);
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const b = Buffer.from(await r.arrayBuffer());
      // VizieR answers 200 with an error page when its database is down: retry, don't cache it.
      if (file.endsWith('.tsv') && b.includes('#INFO	Error=')) throw new Error(`VizieR error for ${file}`);
      writeFileSync(path, b);
      return b;
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
    }
  }
}

const VIZIER = 'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv';
const vizier = (source, cols, extra = '') =>
  `${VIZIER}?-source=${source}&-out.max=unlimited&-out=${cols.join(',')}${extra}`;

/** Rows of a VizieR TSV (header names → values as strings). */
function tsv(buf) {
  const lines = buf.toString('utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const head = lines[0].split('\t').map((s) => s.trim());
  // Line 1: units, line 2: dashes.
  return lines.slice(3).map((l) => {
    const c = l.split('\t');
    const o = {};
    head.forEach((h, i) => (o[h] = (c[i] ?? '').trim()));
    return o;
  });
}

// ---- Geometry -------------------------------------------------------------------------------

/** Unit vector, J2000 equatorial. */
function radec(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const de = decDeg * DEG;
  return [Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)];
}

function sexaRa(s) {
  const [h, m, x] = s.split(/\s+/).map(Number);
  return (h + m / 60 + x / 3600) * 15;
}
function sexaDec(s) {
  const neg = s.trim().startsWith('-');
  const [d, m, x] = s.replace('-', '').replace('+', '').split(/\s+/).map(Number);
  return (neg ? -1 : 1) * (d + m / 60 + x / 3600);
}

/** Comoving distance (Mpc) for redshift z, flat ΛCDM. */
function comoving(z) {
  const n = 200;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const zi = ((i + 0.5) / n) * z;
    s += 1 / Math.sqrt(OMEGA_M * (1 + zi) ** 3 + (1 - OMEGA_M));
  }
  return (C_KMS / H0) * (s * z) / n;
}

/** Galactic latitude (deg) of an equatorial unit vector. */
const NGP = radec(192.85948, 27.12825);
const galLat = (u) => Math.asin(u[0] * NGP[0] + u[1] * NGP[1] + u[2] * NGP[2]) / DEG;

// ---- 2MRS ----------------------------------------------------------------------------------

const twomrs = tsv(await cached('2mrs_v2.tsv', vizier('J/ApJS/199/26/table3', ['ID', 'RAJ2000', 'DEJ2000', 'Ktmag', 'cz', 'type'])));
const K_LIMIT = 11.75;
const gal2 = [];
for (const r of twomrs) {
  const cz = Number(r.cz);
  const K = Number(r.Ktmag);
  if (!Number.isFinite(cz) || !Number.isFinite(K) || cz < 300) continue;
  const d = cz / H0;
  const u = radec(Number(r.RAJ2000), Number(r.DEJ2000));
  const M = K - (5 * Math.log10(d) + 25);
  // Morphology: early (E/S0, T ≤ 0) or late (spiral, irregular).
  const T = parseInt(r.type, 10);
  gal2.push({ x: u[0] * d, y: u[1] * d, z: u[2] * d, d, M, K, early: Number.isFinite(T) && T <= 0 ? 1 : 0, u, id: r.ID, ra: Number(r.RAJ2000), dec: Number(r.DEJ2000), cz, type: r.type.trim() });
}
console.log('2MRS galaxies', gal2.length);

// ---- Selection function (K-band Schechter, Kochanek et al. 2001) ----------------------------

const M_STAR = -23.39 + 5 * Math.log10(H0 / 100);
const ALPHA = -1.09;
const M_FAINT = -20.5; // galaxies counted down to this absolute magnitude
const schechter = (M) => {
  const x = 10 ** (-0.4 * (M - M_STAR));
  return x ** (ALPHA + 1) * Math.exp(-x);
};
const integrate = (a, b) => {
  let s = 0;
  const n = 400;
  for (let i = 0; i < n; i++) s += schechter(a + ((i + 0.5) / n) * (b - a));
  return (s * (b - a)) / n;
};
const TOTAL = integrate(-27, M_FAINT);
/** Fraction of galaxies brighter than M_FAINT that the survey still sees at distance d (Mpc). */
const selection = (d) => {
  const Mlim = K_LIMIT - (5 * Math.log10(d) + 25);
  return Mlim >= M_FAINT ? 1 : integrate(-27, Mlim) / TOTAL;
};

// ---- FFT (radix 2, in place, complex interleaved) -------------------------------------------

function fft1(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

function fft3(re, im, N, inverse) {
  const r = new Float64Array(N);
  const i_ = new Float64Array(N);
  const idx = (x, y, z) => (z * N + y) * N + x;
  for (const axis of [0, 1, 2])
    for (let a = 0; a < N; a++)
      for (let b = 0; b < N; b++) {
        for (let k = 0; k < N; k++) {
          const p = axis === 0 ? idx(k, a, b) : axis === 1 ? idx(a, k, b) : idx(a, b, k);
          r[k] = re[p];
          i_[k] = im[p];
        }
        fft1(r, i_, inverse);
        for (let k = 0; k < N; k++) {
          const p = axis === 0 ? idx(k, a, b) : axis === 1 ? idx(a, k, b) : idx(a, b, k);
          re[p] = r[k];
          im[p] = i_[k];
        }
      }
}

// ---- Density and flow ---------------------------------------------------------------------

const HALF = 200; // Mpc, box ±HALF
const R_MAX = 190; // weights capped beyond: selection gets too small
const ZOA = 6; // |b| below this is the zone of avoidance (filled with the mean)

/** Overdensity δ of the selection-weighted 2MRS galaxies on an N³ grid over ±HALF, Fourier transformed. */
function densityFourier(N) {
  const CELL = (2 * HALF) / N;
  const rho = new Float64Array(N * N * N);
  const cellOf = (v) => Math.floor((v + HALF) / CELL);
  const add = (x, y, z, w) => {
    const i = cellOf(x);
    const j = cellOf(y);
    const k = cellOf(z);
    if (i < 0 || j < 0 || k < 0 || i >= N || j >= N || k >= N) return;
    rho[(k * N + j) * N + i] += w;
  };
  for (const g of gal2) {
    if (g.d > R_MAX || g.M > M_FAINT) continue;
    // Capped: a few far, bright galaxies must not stand for whole clusters.
    const w = Math.min(1 / Math.max(selection(g.d), 1e-6), 10);
    add(g.x, g.y, g.z, w);
    // Zone of avoidance: filled by mirroring the strip just outside it (|b| in [ZOA, 2·ZOA]).
    const b = galLat(g.u);
    if (Math.abs(b) > ZOA && Math.abs(b) < 2 * ZOA) {
      const nb = Math.sign(b) * (2 * ZOA - Math.abs(b)) * DEG;
      // Rotate the direction towards the plane: keep longitude, change latitude.
      const n = NGP;
      const sb = Math.sin(b * DEG);
      const cb = Math.cos(b * DEG);
      const inPlane = [g.u[0] - sb * n[0], g.u[1] - sb * n[1], g.u[2] - sb * n[2]].map((c) => c / cb);
      const u2 = inPlane.map((c, m) => c * Math.cos(nb) + n[m] * Math.sin(nb));
      add(u2[0] * g.d, u2[1] * g.d, u2[2] * g.d, w);
    }
  }
  // Mean over the surveyed volume (inside R_MAX, outside the zone of avoidance).
  const centre = (n) => (n + 0.5) * CELL - HALF;
  const inSurvey = new Uint8Array(N * N * N);
  let sum = 0;
  let cnt = 0;
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = centre(i);
        const y = centre(j);
        const z = centre(k);
        const r = Math.hypot(x, y, z);
        if (r > R_MAX || r < 2) continue;
        const p = (k * N + j) * N + i;
        inSurvey[p] = 1;
        sum += rho[p];
        cnt++;
      }
  const mean = sum / cnt;
  const re = new Float64Array(N * N * N);
  const im = new Float64Array(N * N * N);
  for (let p = 0; p < rho.length; p++) re[p] = inSurvey[p] ? rho[p] / mean - 1 : 0;
  console.log('FFT density', N + '³');
  fft3(re, im, N, false);
  return { re, im };
}
const kfOf = (N) => (n) => ((n <= N / 2 ? n : n - N) * 2 * Math.PI) / (2 * HALF);

// Velocity (128³, 9 Mpc smoothing: the large-scale flow that defines basins) for unit β: v1(k) = i H0 δ(k) k / k². β and the
// external bulk flow are fitted to Cosmicflows-4 below.
const N = 128;
const CELL = (2 * HALF) / N;
const SIGMA_V = 9;
const vx = [new Float64Array(N ** 3), new Float64Array(N ** 3)];
const vy = [new Float64Array(N ** 3), new Float64Array(N ** 3)];
const vz = [new Float64Array(N ** 3), new Float64Array(N ** 3)];
{
  const { re: dRe, im: dIm } = densityFourier(N);
  const kf = kfOf(N);
  {
    const L = 2 * HALF;
    const fV = ((4 / 3) * Math.PI * R_MAX ** 3) / L ** 3;
    const nb = 18;
    const kmin = (2 * Math.PI) / L;
    const kmax = Math.PI / CELL;
    const sum = new Float64Array(nb);
    const cnt = new Float64Array(nb);
    for (let k = 0; k < N; k++)
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const kk = Math.hypot(kf(i), kf(j), kf(k));
          if (kk < kmin || kk > kmax) continue;
          const b = Math.floor((Math.log(kk / kmin) / Math.log(kmax / kmin)) * nb);
          if (b < 0 || b >= nb) continue;
          const p = (k * N + j) * N + i;
          sum[b] += dRe[p] ** 2 + dIm[p] ** 2;
          cnt[b]++;
        }
    LAB.pk = [];
    for (let b = 0; b < nb; b++) {
      if (!cnt[b]) continue;
      const k = kmin * (kmax / kmin) ** ((b + 0.5) / nb);
      // P(k) = V |δ_k|² / N⁶, divided by the surveyed fraction of the box.
      LAB.pk.push([+k.toFixed(4), +((sum[b] / cnt[b]) * (L ** 3 / N ** 6) / fV).toFixed(1)]);
    }
  }
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const p = (k * N + j) * N + i;
        const kx = kf(i);
        const ky = kf(j);
        const kz = kf(k);
        const k2 = kx * kx + ky * ky + kz * kz;
        if (k2 === 0) continue;
        const g = Math.exp(-0.5 * k2 * SIGMA_V * SIGMA_V);
        const re = dRe[p] * g;
        const im = dIm[p] * g;
        // v = i H0 δ k / k²  →  re_v = -H0 im δ k/k², im_v = H0 re δ k/k²
        const s = H0 / k2;
        vx[0][p] = -s * im * kx;
        vx[1][p] = s * re * kx;
        vy[0][p] = -s * im * ky;
        vy[1][p] = s * re * ky;
        vz[0][p] = -s * im * kz;
        vz[1][p] = s * re * kz;
      }
  for (const v of [vx, vy, vz]) fft3(v[0], v[1], N, true);
}

// Display density: 256³ at 3 Mpc smoothing, log-encoded, zlib-compressed.
const ND = 256;
const SIGMA = 3;
{
  const { re, im } = densityFourier(ND);
  const kf = kfOf(ND);
  for (let k = 0; k < ND; k++)
    for (let j = 0; j < ND; j++)
      for (let i = 0; i < ND; i++) {
        const p = (k * ND + j) * ND + i;
        const k2 = kf(i) ** 2 + kf(j) ** 2 + kf(k) ** 2;
        const g = Math.exp(-0.5 * k2 * SIGMA * SIGMA);
        re[p] *= g;
        im[p] *= g;
      }
  fft3(re, im, ND, true);
  // Histogram of log10(1 + δ) inside 150 Mpc (3 Mpc smoothing).
  {
    const bins = new Array(50).fill(0);
    const C = (2 * HALF) / ND;
    for (let k = 0; k < ND; k += 2)
      for (let j = 0; j < ND; j += 2)
        for (let i = 0; i < ND; i += 2) {
          const r = Math.hypot((i + 0.5) * C - HALF, (j + 0.5) * C - HALF, (k + 0.5) * C - HALF);
          if (r > 150) continue;
          const l = Math.log10(Math.max(1 + re[(k * ND + j) * ND + i], 1e-3));
          const b = Math.floor(((l + 1.5) / 3) * 50);
          if (b >= 0 && b < 50) bins[b]++;
        }
    LAB.hist = { from: -1.5, to: 1.5, smoothingMpc: SIGMA, counts: bins };
  }
  const dens = new Uint8Array(ND ** 3);
  for (let p = 0; p < dens.length; p++) {
    const l = Math.log10(Math.max(1 + re[p], 0.05));
    dens[p] = Math.max(0, Math.min(255, Math.round(((l + 1) / 2) * 255)));
  }
  writeFileSync(`${OUT}/density.bin.z`, deflateSync(dens, { level: 9 }));
}

// Velocity lookup (trilinear, km/s): β·v1 (+ the external bulk flow when `ext`).
let BETA = 0.43;
/** Groups closer than this (km/s) are used for the β / bulk-flow fit. */
const FIT_CZ = 4000;
let V_EXT = [0, 0, 0];
function vel(x, y, z, out, ext = false) {
  const fx = (x + HALF) / CELL - 0.5;
  const fy = (y + HALF) / CELL - 0.5;
  const fz = (z + HALF) / CELL - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const k = Math.floor(fz);
  if (i < 0 || j < 0 || k < 0 || i >= N - 1 || j >= N - 1 || k >= N - 1) return false;
  const tx = fx - i;
  const ty = fy - j;
  const tz = fz - k;
  out[0] = out[1] = out[2] = 0;
  for (let c = 0; c < 8; c++) {
    const di = c & 1;
    const dj = (c >> 1) & 1;
    const dk = (c >> 2) & 1;
    const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
    const p = ((k + dk) * N + (j + dj)) * N + (i + di);
    out[0] += w * vx[0][p];
    out[1] += w * vy[0][p];
    out[2] += w * vz[0][p];
  }
  for (let c = 0; c < 3; c++) out[c] = BETA * out[c] + (ext ? V_EXT[c] : 0);
  return true;
}

// ---- Cosmicflows-4: fit β and the external bulk flow to measured peculiar velocities ----
{
  const cf4 = tsv(await cached('cf4groups.tsv', vizier('J/ApJ/944/94/groups', ['RAJ2000', 'DEJ2000', 'Vcmb', 'Vpec', 'e_DMav', 'Dist'])));
  // Normal equations for [β, Vx, Vy, Vz]: v_r = β u·v1(x) + u·V_ext.
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const b = [0, 0, 0, 0];
  const saved = BETA;
  BETA = 1;
  const v1 = [0, 0, 0];
  let used = 0;
  const fitRows = [];
  const hubble = [];
  for (const r of cf4) {
    // Hubble diagram: every group with a distance.
    const D = Number(r.Dist);
    const V = Number(r.Vcmb);
    const E = Number(r.e_DMav);
    if ([D, V, E].every(Number.isFinite) && D > 0 && V > 0 && V < 32000) hubble.push(D, V, E);
    const cz = Number(r.Vcmb);
    const vp = Number(r.Vpec);
    const e = Number(r.e_DMav);
    if (![cz, vp, e].every(Number.isFinite) || cz < 500 || cz > 10500) continue;
    // Only nearby groups (cz < FIT_CZ) enter the fit: farther, CF4 distance errors and the
    // noise of the un-filtered 2MRS field dominate (all groups are still stored for the lab).
    const inFit = cz < FIT_CZ;
    const u = radec(Number(r.RAJ2000), Number(r.DEJ2000));
    // Redshift-space position, as the 2MRS grid.
    const d = cz / H0;
    if (Math.abs(galLat(u)) < ZOA || !vel(u[0] * d, u[1] * d, u[2] * d, v1)) continue;
    const a = [u[0] * v1[0] + u[1] * v1[1] + u[2] * v1[2], u[0], u[1], u[2]];
    // Distance errors (0.46·e_DM of the distance, as velocity) plus 250 km/s of small-scale motion.
    const sig2 = (0.46 * e * cz) ** 2 + 250 ** 2;
    fitRows.push([cz, vp, Math.sqrt(sig2), a[0], u[0], u[1], u[2]]);
    if (!inFit) continue;
    for (let m = 0; m < 4; m++) {
      for (let n = 0; n < 4; n++) A[m][n] += (a[m] * a[n]) / sig2;
      b[m] += (a[m] * vp) / sig2;
    }
    used++;
  }
  // Gaussian elimination.
  const M = A.map((row, m) => [...row, b[m]]);
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k];
    }
  }
  const sol = M.map((row, m) => row[4] / row[m]);
  // No clamping: the value found is the value used (and reported).
  BETA = Number.isFinite(sol[0]) && sol[0] > 0 ? sol[0] : saved;
  V_EXT = [sol[1], sol[2], sol[3]].map((x) => (Number.isFinite(x) ? x : 0));
  const vmag = Math.hypot(...V_EXT);
  const vra = ((Math.atan2(V_EXT[1], V_EXT[0]) / DEG + 360) % 360).toFixed(0);
  const vdec = (Math.asin(V_EXT[2] / Math.max(vmag, 1e-9)) / DEG).toFixed(0);
  console.log('CF4 groups used', used, 'β =', BETA.toFixed(3), 'V_ext =', vmag.toFixed(0), 'km/s toward RA', vra, 'Dec', vdec);
  // Lab data: cz, measured v_pec, σ, unit-β model u·v1, u·V_ext per fitted group; the Hubble diagram.
  const fit = new Float32Array(fitRows.length * 5);
  fitRows.forEach((r, i) => fit.set([r[0], r[1], r[2], r[3], r[4] * V_EXT[0] + r[5] * V_EXT[1] + r[6] * V_EXT[2]], i * 5));
  writeFileSync(`${OUT}/cf4fit.bin`, Buffer.from(fit.buffer));
  writeFileSync(`${OUT}/hubble.bin`, Buffer.from(Float32Array.from(hubble).buffer));
  LAB.cf4 = { fitCz: FIT_CZ, fitGroups: used, groups: fitRows.length, hubble: hubble.length / 3, beta: +BETA.toFixed(3), vExt: V_EXT.map((x) => Math.round(x)), vExtMag: Math.round(vmag), vExtRa: Number(vra), vExtDec: Number(vdec) };
}

// Streamlines of the local field (no bulk flow): where each region falls.
console.log('streamlines');
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function stream(p0, maxSteps, stepMpc, minSpeed) {
  const v = [0, 0, 0];
  let p = [...p0];
  const pts = [];
  for (let s = 0; s < maxSteps; s++) {
    if (!vel(p[0], p[1], p[2], v)) break;
    const sp = Math.hypot(...v);
    if (sp < minSpeed) break;
    pts.push(p[0], p[1], p[2], sp);
    const h = stepMpc / sp;
    p = [p[0] + v[0] * h, p[1] + v[1] * h, p[2] + v[2] * h];
  }
  return { pts, end: p };
}
const lines = [];
for (let n = 0; n < 4000 && lines.length < 1400; n++) {
  const p = [(rnd() * 2 - 1) * 150, (rnd() * 2 - 1) * 150, (rnd() * 2 - 1) * 150];
  if (Math.hypot(...p) > 150) continue;
  const { pts } = stream(p, 260, 1, 30);
  if (pts.length >= 4 * 14) lines.push(pts);
}
const flowLen = lines.map((l) => l.length / 4);
writeFileSync(`${OUT}/flow.bin`, Buffer.from(Float32Array.from(lines.flat()).buffer));
console.log('flow lines', lines.length, 'points', flowLen.reduce((a, b) => a + b, 0));

// Laniakea: the basin of attraction of the point the Milky Way flows to.
console.log('basin');
const home = stream([0, 0, 0], 2000, 0.8, 8).end;
const NB = 72;
const HB = 160;
const basin = new Uint8Array(NB ** 3);
let inBasin = 0;
for (let k = 0; k < NB; k++)
  for (let j = 0; j < NB; j++)
    for (let i = 0; i < NB; i++) {
      const p = [((i + 0.5) / NB) * 2 * HB - HB, ((j + 0.5) / NB) * 2 * HB - HB, ((k + 0.5) / NB) * 2 * HB - HB];
      if (Math.hypot(...p) > R_MAX - 5) continue;
      const { end } = stream(p, 900, 0.8, 8);
      if (Math.hypot(end[0] - home[0], end[1] - home[1], end[2] - home[2]) < 12) {
        basin[(k * NB + j) * NB + i] = 255;
        inBasin++;
      }
    }
// Keep the part connected to the Milky Way's cell, then blur (σ ≈ 1.2 cells) for a smooth shell.
{
  const idx = (i, j, k) => (k * NB + j) * NB + i;
  const keep = new Uint8Array(NB ** 3);
  const c = Math.floor(NB / 2);
  const stack = [[c, c, c]];
  keep[idx(c, c, c)] = 1;
  while (stack.length) {
    const [i, j, k] = stack.pop();
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di;
      const b = j + dj;
      const d = k + dk;
      if (a < 0 || b < 0 || d < 0 || a >= NB || b >= NB || d >= NB) continue;
      const q = idx(a, b, d);
      if (keep[q] || !basin[q]) continue;
      keep[q] = 1;
      stack.push([a, b, d]);
    }
  }
  let f = Float32Array.from(keep);
  const K = [0.11, 0.24, 0.3, 0.24, 0.11];
  for (const axis of [0, 1, 2]) {
    const g = new Float32Array(f.length);
    for (let k = 0; k < NB; k++)
      for (let j = 0; j < NB; j++)
        for (let i = 0; i < NB; i++) {
          let acc = 0;
          for (let t = -2; t <= 2; t++) {
            const a = axis === 0 ? i + t : i;
            const b = axis === 1 ? j + t : j;
            const d = axis === 2 ? k + t : k;
            if (a < 0 || b < 0 || d < 0 || a >= NB || b >= NB || d >= NB) continue;
            acc += K[t + 2] * f[idx(a, b, d)];
          }
          g[idx(i, j, k)] = acc;
        }
    f = g;
  }
  for (let q = 0; q < basin.length; q++) basin[q] = Math.round(Math.min(1, f[q]) * 255);
}
writeFileSync(`${OUT}/basin.bin`, basin);
{
  const d = Math.hypot(...home);
  console.log(
    'Milky Way flows to RA',
    ((Math.atan2(home[1], home[0]) / DEG + 360) % 360).toFixed(0),
    'Dec',
    (Math.asin(home[2] / d) / DEG).toFixed(0),
    'd',
    d.toFixed(0),
    'Mpc; basin cells',
    inBasin,
    '≈',
    ((inBasin * ((2 * HB) / NB) ** 3) / 1e6).toFixed(2),
    'million Mpc³',
  );
}

// Each 2MRS galaxy's predicted line-of-sight peculiar velocity → shift to real space (Mpc),
// and catalogue values for the inspector.
{
  const v = [0, 0, 0];
  const shift = new Float32Array(gal2.length);
  gal2.forEach((g, i) => {
    if (g.d < R_MAX && vel(g.x, g.y, g.z, v, true)) shift[i] = -(g.u[0] * v[0] + g.u[1] * v[1] + g.u[2] * v[2]) / H0;
  });
  writeFileSync(`${OUT}/2mrs_shift.bin`, Buffer.from(shift.buffer));
  writeFileSync(
    `${OUT}/2mrs_meta.json`,
    JSON.stringify({ id: gal2.map((g) => g.id), ra: gal2.map((g) => +g.ra.toFixed(4)), dec: gal2.map((g) => +g.dec.toFixed(4)), cz: gal2.map((g) => Math.round(g.cz)), k: gal2.map((g) => +g.K.toFixed(2)), type: gal2.map((g) => g.type) }),
  );
}
writeFileSync('src/data/generated/lab.json', JSON.stringify(LAB));

// 2MRS points: x y z (Mpc) + absolute K magnitude, early-type flag in the sign of the 4th value's fraction.
const pts2 = new Float32Array(gal2.length * 4);
gal2.forEach((g, i) => pts2.set([g.x, g.y, g.z, g.early ? -g.M : g.M], i * 4));
writeFileSync(`${OUT}/2mrs.bin`, Buffer.from(pts2.buffer));

// ---- SDSS ---------------------------------------------------------------------------------

const sql =
  "SELECT ra, dec, z FROM SpecObj WHERE class='GALAXY' AND z BETWEEN 0.01 AND 0.2 AND zWarning=0 AND (specObjID % 3) = 0";
const sdssCsv = await cached(
  'sdss.csv',
  `https://skyserver.sdss.org/dr17/SkyServerWS/SearchTools/SqlSearch?format=csv&cmd=${encodeURIComponent(sql)}`,
);
const sdssRows = sdssCsv.toString('utf8').split('\n').filter((l) => /^[\d.-]+,[\d.-]+,[\d.eE-]+/.test(l));
// Comoving distance table.
const zTab = [];
for (let i = 0; i <= 400; i++) zTab.push(comoving((i / 400) * 0.21));
const dOfZ = (z) => {
  const f = (z / 0.21) * 400;
  const i = Math.min(Math.floor(f), 399);
  return zTab[i] + (zTab[i + 1] - zTab[i]) * (f - i);
};
const SDSS_Q = 0.03; // Mpc per int16 step (±983 Mpc)
const sdss = new Int16Array(sdssRows.length * 3);
sdssRows.forEach((l, i) => {
  const [ra, dec, z] = l.split(',').map(Number);
  const u = radec(ra, dec);
  const d = dOfZ(z);
  sdss.set([Math.round((u[0] * d) / SDSS_Q), Math.round((u[1] * d) / SDSS_Q), Math.round((u[2] * d) / SDSS_Q)], i * 3);
});
writeFileSync(`${OUT}/sdss.bin`, Buffer.from(sdss.buffer));
console.log('SDSS galaxies', sdssRows.length);

// ---- Hot gas: X-ray galaxy clusters (MCXC, Piffaretti+ 2011) ------------------------------

const mcxc = tsv(await cached('mcxc.tsv', vizier('J/A+A/534/A109/mcxc', ['MCXC', 'RAJ2000', 'DEJ2000', 'z', 'L500', 'M500', 'R500'])));
const gas = [];
for (const r of mcxc) {
  const z = Number(r.z);
  const L = Number(r.L500);
  const R = Number(r.R500);
  if (![z, L, R].every(Number.isFinite) || z <= 0) continue;
  const u = radec(sexaRa(r.RAJ2000), sexaDec(r.DEJ2000));
  // Comoving distance, consistent with cz / H0 close by.
  const d = z < 0.21 ? dOfZ(z) : comoving(z);
  gas.push(u[0] * d, u[1] * d, u[2] * d, R, L);
}
writeFileSync(`${OUT}/gas.bin`, Buffer.from(Float32Array.from(gas).buffer));
console.log('MCXC clusters', gas.length / 5);

// Blank magnitudes in the catalogue (M31: V = 3.44, M−m = 24.47 → −21.0) and Turkish names.
const LG_FIX = {
  Andromeda: { vmag: -21.0, name: 'Andromeda (M31)' },
  Triangulum: { name: 'Üçgen (M33)' },
  LMC: { name: 'Büyük Macellan Bulutu' },
  SMC: { name: 'Küçük Macellan Bulutu' },
};

// ---- Local Group ---------------------------------------------------------------------------

const lg = tsv(await cached('localgroup.tsv', vizier('J/AJ/144/4/catalog', ['Name', 'SubG', 'MType', 'RAJ2000', 'DEJ2000', 'D', 'VMag'])))
  .filter((r) => r.Name && r.RAJ2000 && Number(r.D) > 0)
  .map((r) => ({
    name: r.Name,
    group: r.SubG,
    type: r.MType,
    ra: +sexaRa(r.RAJ2000).toFixed(4),
    dec: +sexaDec(r.DEJ2000).toFixed(4),
    dMpc: +(Number(r.D) / 1000).toFixed(4),
    vmag: r.VMag ? Number(r.VMag) : (LG_FIX[r.Name]?.vmag ?? null),
  }))
  .map((g) => ({ ...g, name: LG_FIX[g.name]?.name ?? g.name }));
console.log('Local Group', lg.length);

// ---- CMB (WMAP 9-yr ILC, HEALPix) ------------------------------------------------------------

const fits = await cached('wmap_ilc_9yr_v5.fits', 'https://lambda.gsfc.nasa.gov/data/map/dr5/dfp/ilc/wmap_ilc_9yr_v5.fits');
function fitsHeader(buf, start) {
  const cards = {};
  let p = start;
  for (;;) {
    const card = buf.toString('latin1', p, p + 80);
    p += 80;
    const key = card.slice(0, 8).trim();
    if (key === 'END') break;
    if (card[8] === '=') {
      let v = card.slice(10).split('/')[0].trim();
      if (v.startsWith("'")) v = v.slice(1, v.lastIndexOf("'")).trim();
      cards[key] = v;
    }
  }
  return { cards, dataStart: Math.ceil(p / 2880) * 2880 };
}
const h0 = fitsHeader(fits, 0);
const h1 = fitsHeader(fits, h0.dataStart + 0);
const ext = h1.cards;
const nside = Number(ext.NSIDE);
const nested = (ext.ORDERING ?? '').toUpperCase().startsWith('NEST');
const rowBytes = Number(ext.NAXIS1);
// Column 1 is the temperature (TFORM1 like '1E' or '1024E' for chunked tables).
const tform = ext.TFORM1;
const perRow = parseInt(tform, 10) || 1;
const npix = 12 * nside * nside;
const temp = new Float32Array(npix);
for (let r = 0, pix = 0; pix < npix; r++)
  for (let k = 0; k < perRow && pix < npix; k++, pix++) temp[pix] = fits.readFloatBE(h1.dataStart + r * rowBytes + k * 4);
console.log('CMB', { nside, nested, tform, unit: ext.TUNIT1 });

function ang2pix(theta, phi) {
  const z = Math.cos(theta);
  const za = Math.abs(z);
  const tt = (((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2);
  if (!nested) {
    if (za <= 2 / 3) {
      const t1 = nside * (0.5 + tt);
      const t2 = nside * z * 0.75;
      const jp = Math.floor(t1 - t2);
      const jm = Math.floor(t1 + t2);
      const ir = nside + 1 + jp - jm;
      const kshift = 1 - (ir & 1);
      let ip = Math.floor((jp + jm - nside + kshift + 1) / 2);
      ip = ((ip % (4 * nside)) + 4 * nside) % (4 * nside);
      return 2 * nside * (nside - 1) + (ir - 1) * 4 * nside + ip;
    }
    const tp = tt - Math.floor(tt);
    const tmp = nside * Math.sqrt(3 * (1 - za));
    const jp = Math.floor(tp * tmp);
    const jm = Math.floor((1 - tp) * tmp);
    const ir = jp + jm + 1;
    let ip = Math.floor(tt * ir);
    ip = ((ip % (4 * ir)) + 4 * ir) % (4 * ir);
    return z > 0 ? 2 * ir * (ir - 1) + ip : npix - 2 * ir * (ir + 1) + ip;
  }
  let face;
  let ix;
  let iy;
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt);
    const t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2);
    const jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    ix = jm & (nside - 1);
    iy = nside - (jp & (nside - 1)) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt));
    const tp = tt - ntt;
    const tmp = nside * Math.sqrt(3 * (1 - za));
    const jp = Math.min(Math.floor(tp * tmp), nside - 1);
    const jm = Math.min(Math.floor((1 - tp) * tmp), nside - 1);
    if (z >= 0) {
      face = ntt;
      ix = nside - jm - 1;
      iy = nside - jp - 1;
    } else {
      face = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }
  let ipf = 0;
  for (let b = 0; b < 16; b++) ipf |= (((ix >> b) & 1) << (2 * b)) | (((iy >> b) & 1) << (2 * b + 1));
  return face * nside * nside + ipf;
}

// Planck-like palette: deep blue → light blue → white → orange → red (±0.3 mK).
const STOPS = [
  [-1, [0, 0, 70]],
  [-0.55, [10, 90, 230]],
  [-0.15, [120, 200, 255]],
  [0, [255, 240, 225]],
  [0.2, [255, 170, 60]],
  [0.6, [220, 60, 10]],
  [1, [110, 0, 0]],
];
const palette = (t) => {
  t = Math.max(-1, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++)
    if (t <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1];
      const [b, cb] = STOPS[i];
      const f = (t - a) / (b - a);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * f));
    }
  return STOPS[STOPS.length - 1][1];
};
const W = 4096;
const H = 2048;
const img = Buffer.alloc(W * H * 3);
// Pixel (u, v): Galactic longitude 180° at u = 0 decreasing to the right? Keep it simple and
// explicit: l = 360° · (u + 0.5) / W, b = 90° − 180° · (v + 0.5) / H (the app samples the same way).
for (let v = 0; v < H; v++) {
  const b = 90 - (180 * (v + 0.5)) / H;
  const theta = (90 - b) * DEG;
  for (let u = 0; u < W; u++) {
    const l = (360 * (u + 0.5)) / W;
    const t = temp[ang2pix(theta, l * DEG)] / 0.3;
    img.set(palette(t), (v * W + u) * 3);
  }
}
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 88 }).toFile(`${OUT_TEX}/cmb.webp`);
console.log('CMB texture', `${OUT_TEX}/cmb.webp`);

writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      note: 'Generated by scripts/build-universe.mjs. Equatorial J2000 Cartesian Mpc.',
      h0: H0,
      twomrs: { count: gal2.length, file: '2mrs.bin', stride: 4 },
      sdss: { count: sdssRows.length, file: 'sdss.bin', quantMpc: SDSS_Q },
      density: { file: 'density.bin.z', n: ND, halfMpc: HALF, smoothingMpc: SIGMA, encoding: 'zlib(u8 = (log10(1+δ)+1)/2·255)' },
      flow: { file: 'flow.bin', beta: +BETA.toFixed(3), vExt: V_EXT.map((x) => Math.round(x)), lengths: flowLen },
      gas: { file: 'gas.bin', count: gas.length / 5, stride: 5, fields: 'x y z (Mpc) R500 (Mpc) L500 (1e37 W)' },
      basin: { file: 'basin.bin', n: NB, halfMpc: HB, attractor: home.map((x) => +x.toFixed(1)) },
      localGroup: lg,
    },
    null,
    0,
  ),
);
console.log('wrote', OUT_JSON);
