/** Angular size and the target frame's caption. Pure: no DOM, no Three.js. */

/** Apparent diameter (degrees) of a sphere `diameterKm` across whose centre is `distanceKm` away. */
export function angularDiameterDeg(diameterKm: number, distanceKm: number): number {
  const r = diameterKm / 2;
  if (distanceKm <= r) return 180;
  return (2 * Math.atan(r / distanceKm) * 180) / Math.PI;
}

/** "HEDEF · MARS · 4,1° GÖRÜŞ"; below a degree in arcminutes, from 10° whole degrees. */
export function frameLabel(name: string, deg: number): string {
  const size =
    deg < 1 ? `${Math.round(deg * 60)}′` : deg < 10 ? `${deg.toFixed(1).replace('.', ',')}°` : `${Math.round(deg)}°`;
  return `HEDEF · ${name.toLocaleUpperCase('tr-TR')} · ${size} GÖRÜŞ`;
}
