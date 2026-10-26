/**
 * What Hubble and Webb are observing now. Source: Space Telescope Live
 * (spacetelescopelive.org, STScI scheduling data: target, coordinates, planned
 * start and end). It is the plan, not a camera feed; the sites state that
 * themselves. The site sends no CORS headers, so the request goes through the
 * dev / preview server's proxy (vite.config.ts: /stl/<telescope>).
 */

export type Telescope = 'hubble' | 'webb';

export interface Observation {
  telescope: Telescope;
  /** Webb names its targets; Hubble's feed carries coordinates only. */
  targetName: string | null;
  targetCategory: string | null;
  /** Pointing, ICRS degrees. */
  raDeg: number;
  decDeg: number;
  start: Date;
  end: Date;
  instruments: string[];
  title: string;
  programId: string | null;
  programType: string | null;
  science: string | null;
  investigator: string | null;
}

const url = (t: Telescope) => `${import.meta.env.BASE_URL}stl/${t}`;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number => Number(v);
const when = (v: unknown): Date => new Date(String(v));

function parseWebb(d: Json): Observation | null {
  const target = d.targets?.[0];
  const ra = num(d.boreSightRightAscensionInDegrees ?? target?.rightAscensionInDegrees);
  const dec = num(d.boreSightDeclinationInDegrees ?? target?.declinationInDegrees);
  const start = when(d.scheduledStartTime);
  const end = when(d.scheduledEndTime);
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || Number.isNaN(+start) || Number.isNaN(+end)) return null;
  const p = d.proposal ?? {};
  return {
    telescope: 'webb',
    targetName: target?.standardName || target?.name || null,
    targetCategory: target?.category ?? null,
    raDeg: ra,
    decDeg: dec,
    start,
    end,
    instruments: (p.instruments ?? []).map((i: Json) => String(i.code ?? i.title)),
    title: p.title ?? '',
    programId: p.proposalID ?? null,
    programType: p.proposalType?.title ?? null,
    science: p.scientificCategory?.title ?? null,
    investigator: p.primaryInvestigator?.formalName ?? null,
  };
}

/** Hubble lists a visit's exposures: the one running now, else the nearest in time. */
function parseHubble(d: Json, now: number): Observation | null {
  const list: Json[] = d.observations ?? [];
  if (!list.length) return null;
  const span = (o: Json) => [+when(o.predictedStartTime), +when(o.predictedEndTime)] as const;
  const running = list.find((o) => {
    const [a, b] = span(o);
    return a <= now && now <= b;
  });
  const o =
    running ??
    list.reduce((best, c) => {
      const [a, b] = span(c);
      const [ba, bb] = span(best);
      const dist = now < a ? a - now : now > b ? now - b : 0;
      const bdist = now < ba ? ba - now : now > bb ? now - bb : 0;
      return dist < bdist ? c : best;
    });
  const ra = num(o.targetRightAscensionInDegrees);
  const dec = num(o.targetDeclinationInDegrees);
  const [a, b] = span(o);
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || Number.isNaN(a) || Number.isNaN(b)) return null;
  const p = d.proposal ?? {};
  return {
    telescope: 'hubble',
    targetName: null,
    targetCategory: null,
    raDeg: ra,
    decDeg: dec,
    start: new Date(a),
    end: new Date(b),
    instruments: o.scienceInstrument ? [String(o.scienceInstrument)] : [],
    title: p.title ?? '',
    programId: p.proposalID ?? null,
    programType: p.proposalType?.title ?? null,
    science: p.scientificCategory?.title ?? null,
    investigator: p.primaryInvestigator?.formalName ?? null,
  };
}

/** One fetch (with a retry: the service answers empty now and then). Null when unavailable. */
export async function fetchObservation(t: Telescope): Promise<Observation | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url(t), { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const j = (await r.json()) as Json;
      const d = j.data as Json | undefined;
      if (!d) continue;
      const o = t === 'webb' ? parseWebb(d) : parseHubble(d, Date.now());
      if (o) return o;
    } catch {
      /* try again, then give up */
    }
  }
  return null;
}

/**
 * Sky survey cutout centred on the target: the same 2MASS colour map the Space
 * Telescope Live page shows behind its reticle (CDS hips2fits; open CORS, so
 * the browser asks it directly). Not the telescope's own image.
 */
export function skyCutoutUrl(raDeg: number, decDeg: number, fovDeg: number, px = 480): string {
  const q = new URLSearchParams({
    hips: 'CDS/P/2MASS/color',
    width: String(px),
    height: String(px),
    fov: String(fovDeg),
    projection: 'TAN',
    coordsys: 'icrs',
    ra: raDeg.toFixed(5),
    dec: decDeg.toFixed(5),
    format: 'jpg',
  });
  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${q}`;
}

/** Field widths the cutout offers (degrees). */
export const SKY_FOVS = [2, 0.5, 0.1] as const;

/** 5h 34m 31.9s */
export function formatRa(deg: number): string {
  const h = (((deg % 360) + 360) % 360) / 15;
  const hh = Math.floor(h);
  const m = (h - hh) * 60;
  const mm = Math.floor(m);
  return `${hh}h ${String(mm).padStart(2, '0')}m ${((m - mm) * 60).toFixed(1).padStart(4, '0')}s`;
}

/** +22° 00′ 52″ */
export function formatDec(deg: number): string {
  const a = Math.abs(deg);
  const dd = Math.floor(a);
  const m = (a - dd) * 60;
  const mm = Math.floor(m);
  return `${deg < 0 ? '−' : '+'}${dd}° ${String(mm).padStart(2, '0')}′ ${Math.round((m - mm) * 60)
    .toString()
    .padStart(2, '0')}″`;
}
