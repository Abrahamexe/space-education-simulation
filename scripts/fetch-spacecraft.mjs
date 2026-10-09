// Spacecraft trajectories from JPL Horizons (state vectors, ecliptic J2000,
// km and km/s). Each craft is split into segments by centre: the Sun for
// cruise, a planet near a flyby or during an orbital tour, the Earth for
// Earth-orbiting and L2 observatories. Flyby windows are found by scanning
// for the planet's sphere of influence around the given closest-approach
// date. Output: public/data/spacecraft/<id>.bin (Float32 x y z vx vy vz per
// sample, segments back to back) and src/data/generated/spacecraft.json
// (segment table). The app interpolates between samples (Kepler about the
// segment's centre, or cubic Hermite for L2 halo orbits).
// Run: node scripts/fetch-spacecraft.mjs [id ...]
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';

const OUT_BIN = 'public/data/spacecraft';
const OUT_JSON = 'src/data/generated/spacecraft.json';
mkdirSync(OUT_BIN, { recursive: true });

const CENTERS = {
  sun: { code: '500@10', gm: 132712440041.9 },
  earth: { code: '500@399', gm: 398600.435 },
  jupiter: { code: '500@599', gm: 126686531.9, soi: 48.2e6 },
  saturn: { code: '500@699', gm: 37931206.2, soi: 54.8e6 },
  uranus: { code: '500@799', gm: 5793951.3, soi: 51.8e6 },
  neptune: { code: '500@899', gm: 6835099.5, soi: 86.8e6 },
  pluto: { code: '500@999', gm: 975.5, soi: 3.1e6 },
};

/**
 * start/end: Horizons coverage (UTC dates). cruise: step for Sun-centred
 * parts. home: a single centre for the whole span (Earth orbiters). visits:
 * planet flybys (closest approach) and tours (arrival .. end of data).
 */
const CRAFT = {
  hubble: { cmd: '-48', start: '1990-04-25T03:00', end: '2026-12-17', home: 'earth', step: '6 h' },
  iss: { cmd: '-125544', start: '1998-11-20', end: '2026-11-07', home: 'earth', step: '6 h' },
  chandra: { cmd: '-151', start: '1999-08-08', end: '2027-03-30', home: 'earth', step: '6 h' },
  tess: { cmd: '-95', start: '2018-04-19', end: '2028-03-29', home: 'earth', step: '6 h' },
  jwst: { cmd: '-170', start: '2021-12-25T14:00', end: '2031-10-04', home: 'earth', step: '1 d', interp: 'hermite' },
  euclid: { cmd: '-680', start: '2023-07-02', end: '2031-10-04', home: 'earth', step: '1 d', interp: 'hermite' },
  gaia: {
    cmd: '-139479',
    start: '2013-12-20',
    end: '2060-01-01',
    parts: [
      { center: 'earth', start: '2013-12-20', end: '2025-04-01', step: '1 d', interp: 'hermite' },
      { center: 'sun', start: '2025-04-01', end: '2060-01-01', step: '5 d' },
    ],
  },
  spitzer: { cmd: '-79', start: '2003-08-26', end: '2060-01-01', cruise: '5 d' },
  kepler: { cmd: '-227', start: '2009-03-08', end: '2060-01-01', cruise: '5 d' },
  voyager1: { cmd: '-31', start: '1977-09-06', end: '2060-01-01', cruise: '3 d', visits: [['jupiter', '1979-03-05'], ['saturn', '1980-11-12']] },
  voyager2: {
    cmd: '-32',
    start: '1977-08-21',
    end: '2060-01-01',
    cruise: '3 d',
    visits: [['jupiter', '1979-07-09'], ['saturn', '1981-08-26'], ['uranus', '1986-01-24'], ['neptune', '1989-08-25']],
  },
  pioneer10: { cmd: '-23', start: '1972-03-04', end: '2049-12-31', cruise: '3 d', visits: [['jupiter', '1973-12-04']] },
  pioneer11: { cmd: '-24', start: '1973-04-07', end: '2049-12-31', cruise: '3 d', visits: [['jupiter', '1974-12-03'], ['saturn', '1979-09-01']] },
  newhorizons: { cmd: '-98', start: '2006-01-20', end: '2049-12-31', cruise: '3 d', visits: [['jupiter', '2007-02-28'], ['pluto', '2015-07-14']] },
  parker: { cmd: '-96', start: '2018-08-13', end: '2029-12-31', cruise: '12 h' },
  juno: { cmd: '-61', start: '2011-08-06', end: '2028-09-01', cruise: '2 d', visits: [['jupiter', '2016-07-05', 'tour']] },
  cassini: { cmd: '-82', start: '1997-10-16', end: '2017-09-15T10:30', cruise: '2 d', visits: [['jupiter', '2000-12-30'], ['saturn', '2004-07-01', 'tour']] },
  clipper: { cmd: '-159', start: '2024-10-15', end: '2034-09-02', cruise: '2 d', visits: [['jupiter', '2030-04-11', 'tour']] },
  juice: { cmd: '-28', start: '2023-04-15', end: '2031-07-20', cruise: '2 d' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JD_UNIX = 2440587.5;
const jd = (iso) => Date.parse(iso.length <= 10 ? `${iso}T00:00Z` : `${iso}Z`) / 86400000 + JD_UNIX;
const iso = (j) => new Date((j - JD_UNIX) * 86400000).toISOString().slice(0, 16).replace('T', ' ');
const stepDays = (s) => {
  const [n, u] = s.split(' ');
  return Number(n) * ({ d: 1, h: 1 / 24, m: 1 / 1440 }[u] ?? 1);
};

/** Rows [jd, x, y, z, vx, vy, vz] from Horizons, chunked under its line limit. */
async function vectors(cmd, center, startJd, endJd, step) {
  const dStep = stepDays(step);
  const rows = [];
  const CHUNK = 20000 * dStep;
  for (let a = startJd; a < endJd - 1e-9; a += CHUNK) {
    const b = Math.min(endJd, a + CHUNK);
    const u = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
    u.search = new URLSearchParams({
      format: 'json',
      COMMAND: `'${cmd}'`,
      EPHEM_TYPE: 'VECTORS',
      CENTER: `'${CENTERS[center].code}'`,
      START_TIME: `'JD ${a.toFixed(6)}'`,
      STOP_TIME: `'JD ${b.toFixed(6)}'`,
      STEP_SIZE: `'${step.replace(' ', '')}'`,
      REF_PLANE: 'ECLIPTIC',
      REF_SYSTEM: 'ICRF',
      OUT_UNITS: 'KM-S',
      VEC_TABLE: '2',
      CSV_FORMAT: 'YES',
      OBJ_DATA: 'NO',
    });
    let text = '';
    for (let i = 0; ; i++) {
      try {
        const j = await (await fetch(u)).json();
        text = j.result ?? '';
        if (!text.includes('$$SOE')) throw new Error(text.slice(0, 400) || JSON.stringify(j).slice(0, 400));
        break;
      } catch (e) {
        if (i > 3) throw e;
        await sleep(3000 * (i + 1));
      }
    }
    const body = text.split('$$SOE')[1].split('$$EOE')[0];
    for (const line of body.trim().split('\n')) {
      const c = line.split(',').map((s) => s.trim());
      const r = [Number(c[0]), ...c.slice(2, 8).map(Number)];
      if (r.every(Number.isFinite) && (!rows.length || r[0] > rows[rows.length - 1][0] + 1e-7)) rows.push(r);
    }
    await sleep(250);
  }
  return rows;
}

/** Span [a, b] (JD) where the craft is inside the planet's sphere of influence. */
async function soiWindow(cmd, planet, caIso, tour, startJd, endJd) {
  const ca = jd(caIso);
  const a = Math.max(startJd, ca - 260);
  const b = tour ? Math.min(endJd, ca + 30) : Math.min(endJd, ca + 260);
  const rows = await vectors(cmd, planet, a, b, '1 d');
  const soi = CENTERS[planet].soi;
  const inside = rows.filter((r) => Math.hypot(r[1], r[2], r[3]) < soi);
  if (!inside.length) throw new Error(`${cmd}: never inside ${planet}'s SOI near ${caIso}`);
  return [inside[0][0], tour ? endJd : inside[inside.length - 1][0]];
}

const only = process.argv.slice(2);
const table = existsSync(OUT_JSON) ? JSON.parse(readFileSync(OUT_JSON, 'utf8')) : { craft: {} };
for (const [id, c] of Object.entries(CRAFT)) {
  if (only.length && !only.includes(id)) continue;
  const startJd = jd(c.start);
  const endJd = jd(c.end);
  // Segment plan: explicit parts, one home centre, or cruise around visits.
  let plan = [];
  if (c.parts) plan = c.parts.map((p) => ({ center: p.center, a: jd(p.start), b: jd(p.end), step: p.step, interp: p.interp ?? 'kepler' }));
  else if (c.home) plan = [{ center: c.home, a: startJd, b: endJd, step: c.step, interp: c.interp ?? 'kepler' }];
  else {
    let t = startJd;
    for (const [planet, ca, tour] of c.visits ?? []) {
      const [a, b] = await soiWindow(c.cmd, planet, ca, !!tour, startJd, endJd);
      if (a > t) plan.push({ center: 'sun', a: t, b: a, step: c.cruise, interp: 'kepler' });
      // Flybys sampled hourly; tours every 3 h (Kepler about the planet fills in).
      plan.push({ center: planet, a, b, step: tour ? '3 h' : '1 h', interp: 'kepler' });
      t = b;
    }
    if (t < endJd) plan.push({ center: 'sun', a: t, b: endJd, step: c.cruise, interp: 'kepler' });
  }
  const segments = [];
  const chunks = [];
  let offset = 0;
  for (const s of plan) {
    const rows = await vectors(c.cmd, s.center, s.a, s.b, s.step);
    const f = new Float32Array(rows.length * 6);
    rows.forEach((r, i) => f.set(r.slice(1), i * 6));
    chunks.push(f);
    segments.push({ center: s.center, gm: CENTERS[s.center].gm, t0: rows[0][0], step: stepDays(s.step), n: rows.length, offset, interp: s.interp });
    offset += rows.length;
    console.log(id.padEnd(12), s.center.padEnd(8), iso(rows[0][0]), '→', iso(rows[rows.length - 1][0]), String(rows.length).padStart(6), 'samples');
  }
  const all = new Float32Array(offset * 6);
  let o = 0;
  for (const f of chunks) {
    all.set(f, o);
    o += f.length;
  }
  writeFileSync(`${OUT_BIN}/${id}.bin`, Buffer.from(all.buffer));
  table.craft[id] = { horizons: c.cmd, startJd: segments[0].t0, endJd: segments[segments.length - 1].t0 + (segments[segments.length - 1].n - 1) * segments[segments.length - 1].step, segments };
  writeFileSync(OUT_JSON, JSON.stringify(table, null, 1));
}
