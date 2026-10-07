// Playground physics off the main thread: the N-body integrator advances on
// request and posts back positions, velocities and events.
import { NBody, type SimBodyInit } from './nbody';

export type ToWorker =
  | { t: 'init'; bodies: SimBodyInit[]; jd: number }
  | { t: 'add'; body: SimBodyInit }
  | { t: 'remove'; id: string }
  | { t: 'advance'; toJd: number; budgetMs: number; stopOnTear?: boolean }
  | { t: 'shatter'; id: string; text: string }
  | { t: 'hit'; radii: [string, number][] };

export interface BodyMeta {
  id: string;
  name: string;
  kind: SimBodyInit['kind'];
  mu: number;
  radius: number;
  lum: number;
  added: boolean;
  feeding: boolean;
  feedLum: number;
  feedJd: number;
  /** Added bodies: when and where they appeared (light and gravity spread from there). */
  addJd: number | null;
  addPos: [number, number, number] | null;
  /** Gone bodies: when and where (its light stops spreading from there). */
  goneJd: number | null;
  gonePos: [number, number, number] | null;
}

export interface FromWorker {
  t: 'state';
  jd: number;
  version: number;
  meta: BodyMeta[] | null;
  pos: Float64Array;
  vel: Float64Array;
  alive: Uint8Array;
  events: ReturnType<NBody['takeEvents']>;
}

let sim: NBody | null = null;
let sentVersion = -1;

function post(): void {
  if (!sim) return;
  const B = sim.bodies;
  const pos = new Float64Array(B.length * 3);
  const vel = new Float64Array(B.length * 3);
  const alive = new Uint8Array(B.length);
  B.forEach((b, i) => {
    pos.set(b.pos, i * 3);
    vel.set(b.vel, i * 3);
    alive[i] = b.alive ? 1 : 0;
  });
  const changed = sim.version !== sentVersion;
  sentVersion = sim.version;
  const msg: FromWorker = {
    t: 'state',
    jd: sim.jd,
    version: sim.version,
    meta: changed
      ? B.map((b) => ({
          id: b.id,
          name: b.name,
          kind: b.kind,
          mu: b.mu,
          radius: b.radius,
          lum: b.lum ?? 0,
          added: !!b.added,
          feeding: !!b.feeding,
          feedLum: b.feedLum ?? 0,
          feedJd: b.feedJd ?? 0,
          addJd: b.addJd ?? null,
          addPos: b.addPos ?? null,
          goneJd: b.goneJd ?? null,
          gonePos: b.gonePos ?? null,
        }))
      : null,
    pos,
    vel,
    alive,
    events: sim.takeEvents(),
  };
  (self as unknown as { postMessage(m: unknown, transfer: Transferable[]): void }).postMessage(msg, [pos.buffer, vel.buffer, alive.buffer]);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.t === 'init') {
    sim = new NBody(m.bodies, m.jd);
    sentVersion = -1;
  } else if (!sim) return;
  else if (m.t === 'add') sim.add(m.body);
  else if (m.t === 'remove') sim.remove(m.id);
  else if (m.t === 'advance') sim.advance(m.toJd, m.budgetMs, m.stopOnTear);
  else if (m.t === 'shatter') sim.shatter(m.id, m.text);
  else if (m.t === 'hit') {
    sim.setHit(m.radii);
    return;
  }
  post();
};
