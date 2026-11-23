/**
 * Small SVG plotting for the lab: linear or log axes with ticks and labels,
 * scatter (optionally with error bars), lines and step histograms. Returns
 * markup; colours come from CSS classes (.s-*) so both looks share a theme.
 */

export interface Axis {
  min: number;
  max: number;
  log?: boolean;
  label: string;
  ticks?: number[];
  fmt?: (v: number) => string;
}

export interface Series {
  kind: 'scatter' | 'line' | 'step';
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  err?: ArrayLike<number>;
  cls: string;
  r?: number;
  label?: string;
}

export const W = 460;
export const H = 260;
const L = 52;
const R = 12;
const T = 14;
const B = 38;

export function scaler(a: Axis, from: number, to: number): (v: number) => number {
  if (a.log) {
    const l0 = Math.log10(a.min);
    const l1 = Math.log10(a.max);
    return (v) => from + ((Math.log10(Math.max(v, 1e-300)) - l0) / (l1 - l0)) * (to - from);
  }
  return (v) => from + ((v - a.min) / (a.max - a.min)) * (to - from);
}

function defaultTicks(a: Axis): number[] {
  if (a.ticks) return a.ticks;
  if (a.log) {
    const t: number[] = [];
    for (let e = Math.ceil(Math.log10(a.min)); e <= Math.floor(Math.log10(a.max)); e++) t.push(10 ** e);
    return t;
  }
  const span = a.max - a.min;
  const step = 10 ** Math.floor(Math.log10(span / 4));
  const s = [1, 2, 5, 10].map((m) => m * step).find((x) => span / x <= 6) ?? step * 10;
  const t: number[] = [];
  for (let v = Math.ceil(a.min / s) * s; v <= a.max + 1e-9; v += s) t.push(+v.toPrecision(10));
  return t;
}

const fmtDefault = (v: number) =>
  Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(0).replace('e+', 'e') : v.toLocaleString('tr-TR', { maximumFractionDigits: 3 });

/** The whole figure as SVG markup. */
export function plot(xa: Axis, ya: Axis, series: Series[], aria: string, extra = ''): string {
  const sx = scaler(xa, L, W - R);
  const sy = scaler(ya, H - B, T);
  const clip = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  let g = '';
  for (const t of defaultTicks(xa)) {
    const x = sx(t);
    g += `<line class="grid" x1="${x}" x2="${x}" y1="${T}" y2="${H - B}"/><text x="${x}" y="${H - B + 14}" text-anchor="middle">${(xa.fmt ?? fmtDefault)(t)}</text>`;
  }
  for (const t of defaultTicks(ya)) {
    const y = sy(t);
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${(ya.fmt ?? fmtDefault)(t)}</text>`;
  }
  let s = '';
  for (const se of series) {
    const n = se.x.length;
    if (se.kind === 'scatter') {
      let d = '';
      for (let i = 0; i < n; i++) {
        const x = sx(se.x[i]);
        const y = sy(se.y[i]);
        if (!(x >= L && x <= W - R && y >= T && y <= H - B)) continue;
        if (se.err) {
          const y0 = clip(sy(se.y[i] - se.err[i]), T, H - B);
          const y1 = clip(sy(se.y[i] + se.err[i]), T, H - B);
          s += `<line class="${se.cls} err" x1="${x}" x2="${x}" y1="${y0}" y2="${y1}"/>`;
        }
        const r = se.r ?? 1.2;
        d += `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
      }
      s += `<path class="${se.cls} dots" d="${d}"/>`;
    } else {
      let d = '';
      for (let i = 0; i < n; i++) {
        const x = clip(sx(se.x[i]), L, W - R);
        const y = clip(sy(se.y[i]), T, H - B);
        if (se.kind === 'step' && i > 0) d += `H${x.toFixed(1)}`;
        d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      s += `<path class="${se.cls} line" d="${d}"/>`;
    }
  }
  const legend = series
    .filter((x) => x.label)
    .map((x, i) => `<g transform="translate(${L + 10},${T + 12 + i * 15})"><rect class="${x.cls} sw" width="10" height="3" y="-4"/><text x="16" y="0" class="leg">${x.label}</text></g>`)
    .join('');
  return `<svg class="lab-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">
    <rect class="frame" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
    ${g}${s}${extra}${legend}
    <text class="axis" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${xa.label}</text>
    <text class="axis" transform="translate(12,${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${ya.label}</text>
  </svg>`;
}

/** Pixel position of a data point (for overlays drawn on top of a plot). */
export function project(xa: Axis, ya: Axis, x: number, y: number): [number, number] {
  return [scaler(xa, L, W - R)(x), scaler(ya, H - B, T)(y)];
}
