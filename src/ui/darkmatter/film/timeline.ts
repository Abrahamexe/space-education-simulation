/** A caption shown over the film between `at` and `until` (seconds of chapter time, half-open). */
export interface Caption {
  at: number;
  until: number;
  text: string;
}

export function captionAt(caps: Caption[], t: number): Caption | null {
  for (const c of caps) if (t >= c.at && t < c.until) return c;
  return null;
}

/** Maps film time in [film0, film1] linearly onto simulation time in [sim0, sim1], clamped. */
export function simTime(t: number, film: [number, number], sim: [number, number]): number {
  const u = Math.min(1, Math.max(0, (t - film[0]) / (film[1] - film[0])));
  return sim[0] + u * (sim[1] - sim[0]);
}

export type Vec3 = [number, number, number];

/** A camera key: position (and look-at target, default the origin) reached at time `at`. */
export interface CamKey {
  at: number;
  pos: Vec3;
  target?: Vec3;
}

/** Camera pose at time t: smoothstep between the surrounding keys, held before the first and after the last. */
export function poseAt(keys: CamKey[], t: number): { pos: Vec3; target: Vec3 } {
  const tgt = (k: CamKey): Vec3 => k.target ?? [0, 0, 0];
  if (t <= keys[0].at) return { pos: [...keys[0].pos], target: tgt(keys[0]) };
  const last = keys[keys.length - 1];
  if (t >= last.at) return { pos: [...last.pos], target: tgt(last) };
  let i = 0;
  while (keys[i + 1].at <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = (t - a.at) / (b.at - a.at);
  const e = u * u * (3 - 2 * u);
  const lerp = (p: Vec3, q: Vec3): Vec3 => [p[0] + (q[0] - p[0]) * e, p[1] + (q[1] - p[1]) * e, p[2] + (q[2] - p[2]) * e];
  return { pos: lerp(a.pos, b.pos), target: lerp(tgt(a), tgt(b)) };
}
