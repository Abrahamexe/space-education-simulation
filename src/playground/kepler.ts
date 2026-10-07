/**
 * Two-body propagation in universal variables (Battin; Vallado, alg. 8):
 * exact for any conic, any time span, in O(1). Used for debris on orbits
 * far too tight to step through (a piece circling a black hole every few
 * minutes while the system takes days per step).
 */

function stumpC(z: number): number {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}

function stumpS(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/**
 * Advance relative position `r` and velocity `v` (in place) by `dt` round a
 * body of gravitational parameter `mu`. Returns false if it did not converge
 * (the state is then left unchanged).
 */
export function keplerStep(r: number[], v: number[], mu: number, dt: number): boolean {
  const r0 = Math.hypot(r[0], r[1], r[2]);
  const v02 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  const sq = Math.sqrt(mu);
  const alpha = 2 / r0 - v02 / mu;
  let t = dt;
  // Bound orbits: whole revolutions change nothing.
  if (alpha > 1e-12) {
    const period = (2 * Math.PI) / Math.sqrt(mu * alpha * alpha * alpha);
    t = dt - Math.floor(dt / period) * period;
  }
  let chi: number;
  if (alpha > 1e-12) chi = sq * t * alpha;
  else if (alpha < -1e-12) {
    const a = 1 / alpha;
    const s = Math.sign(t) || 1;
    const arg = (-2 * mu * alpha * t) / (rv + s * Math.sqrt(-mu * a) * (1 - r0 * alpha));
    chi = arg > 0 ? s * Math.sqrt(-a) * Math.log(arg) : (sq * t) / r0;
  } else chi = (sq * t) / r0;
  // Laguerre–Conway iteration (n = 5): converges where Newton's method
  // wanders off, e.g. on long, nearly radial orbits.
  let ok = false;
  const n = 5;
  for (let i = 0; i < 200; i++) {
    const z = alpha * chi * chi;
    const C = stumpC(z);
    const S = stumpS(z);
    const F = (rv / sq) * chi * chi * C + (1 - alpha * r0) * chi * chi * chi * S + r0 * chi - sq * t;
    const dF = (rv / sq) * chi * (1 - z * S) + (1 - alpha * r0) * chi * chi * C + r0;
    const ddF = (rv / sq) * (1 - z * C) + (1 - alpha * r0) * chi * (1 - z * S);
    const root = Math.sqrt(Math.abs((n - 1) * (n - 1) * dF * dF - n * (n - 1) * F * ddF));
    const den = dF + (dF >= 0 ? root : -root);
    const step = den !== 0 ? (n * F) / den : F / dF;
    chi -= step;
    if (!Number.isFinite(chi)) return false;
    if (Math.abs(step) < 1e-12 * Math.max(1, Math.abs(chi))) {
      ok = true;
      break;
    }
  }
  if (!ok) return false;
  const z = alpha * chi * chi;
  const C = stumpC(z);
  const S = stumpS(z);
  const f = 1 - ((chi * chi) / r0) * C;
  const g = t - ((chi * chi * chi) / sq) * S;
  const nr = [f * r[0] + g * v[0], f * r[1] + g * v[1], f * r[2] + g * v[2]];
  const rn = Math.hypot(nr[0], nr[1], nr[2]);
  const fd = (sq / (rn * r0)) * (alpha * chi * chi * chi * S - chi);
  const gd = 1 - ((chi * chi) / rn) * C;
  const nv = [fd * r[0] + gd * v[0], fd * r[1] + gd * v[1], fd * r[2] + gd * v[2]];
  if (!nr.every(Number.isFinite) || !nv.every(Number.isFinite)) return false;
  for (let c = 0; c < 3; c++) {
    r[c] = nr[c];
    v[c] = nv[c];
  }
  return true;
}

/** Periapsis distance of a relative orbit. */
export function periapsis(r: number[], v: number[], mu: number): number {
  const r0 = Math.hypot(r[0], r[1], r[2]);
  const hx = r[1] * v[2] - r[2] * v[1];
  const hy = r[2] * v[0] - r[0] * v[2];
  const hz = r[0] * v[1] - r[1] * v[0];
  const h2 = hx * hx + hy * hy + hz * hz;
  const v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const energy = v2 / 2 - mu / r0;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)));
  return h2 / mu / (1 + e);
}
