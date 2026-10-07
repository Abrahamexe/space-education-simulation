/** Turkish number/date formatting for the UI (tr-TR conventions). */

const LOCALE = 'tr-TR';
const nf = (digits: number) =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function num(v: number, digits = 1): string {
  return nf(digits).format(v);
}

/** Fixed decimals, keeping trailing zeros: fixed(9, 1) → "9,0". */
export function fixed(v: number, digits: number): string {
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** Significant-figure formatting: 0,000132 → "0,00013", 1898 → "1.898". */
export function sig(v: number, figures = 3): string {
  if (v === 0 || !Number.isFinite(v)) return '0';
  const d = Math.max(0, figures - 1 - Math.floor(Math.log10(Math.abs(v))));
  return nf(Math.min(d, 8)).format(Number(v.toPrecision(figures)));
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const sup = (n: number) => String(n).split('').map((c) => SUP[c] ?? c).join('');

/** 5.97e24 → "5,97 × 10²⁴". */
export function sci(v: number, figures = 3): string {
  const e = Math.floor(Math.log10(Math.abs(v)));
  return `${sig(v / 10 ** e, figures)} × 10${sup(e)}`;
}

export function km(v: number): string {
  if (v >= 1e9) return `${sig(v / 1e9, 3)} milyar km`;
  if (v >= 1e6) return `${sig(v / 1e6, 4)} milyon km`;
  return `${num(Math.round(v), 0)} km`;
}

export function au(v: number): string {
  return `${sig(v, v < 10 ? 3 : 4)} AU`;
}

/** Durations in days → the most readable unit. */
export function period(days: number): string {
  const a = Math.abs(days);
  if (a >= 730) return `${sig(a / 365.25, 3)} yıl`;
  if (a >= 2) return `${sig(a, 3)} gün`;
  return `${sig(a * 24, 3)} saat`;
}

export function hours(h: number): string {
  const a = Math.abs(h);
  if (a >= 72) return `${sig(a / 24, 3)} gün`;
  return `${sig(a, 3)} saat`;
}

/** Light travel time for a distance in km: "8 dk 19 sn", "4 sa 10 dk". */
export function lightTime(distanceKm: number): string {
  const exact = distanceKm / 299_792.458;
  if (exact < 59.95) return `${num(exact, 1)} sn`;
  // Round once, then split, so 299.7 s reads "5 dk 0 sn", never "4 dk 60 sn".
  const total = Math.round(exact);
  const m = Math.floor(total / 60);
  if (m < 60) return `${m} dk ${total - m * 60} sn`;
  const totalMin = Math.round(exact / 60);
  const h = Math.floor(totalMin / 60);
  return `${h} sa ${totalMin - h * 60} dk`;
}

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false });

export function date(d: Date): string {
  return dateFmt.format(d);
}

export function time(d: Date): string {
  return `${timeFmt.format(d)} UTC`;
}
