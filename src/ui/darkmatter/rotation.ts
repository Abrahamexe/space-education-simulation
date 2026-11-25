/** Rotation-curve helpers for the film (tables of [R kpc, v km/s], e.g. M33_ROTATION). */
export type RotTable = readonly (readonly [number, number])[];

/** km/s in kpc/Myr. */
const KMS_KPC_MYR = 1.0227e-3;

/** Speed at radius R: linear in the table, from v(0) = 0 to the first point, flat after the last. */
export function vAt(table: RotTable, R: number): number {
  if (!(R > 0)) return 0;
  const [r0, v0] = table[0];
  if (R <= r0) return (v0 * R) / r0;
  for (let i = 1; i < table.length; i++) {
    const [r1, v1] = table[i];
    if (R <= r1) {
      const [ra, va] = table[i - 1];
      return va + ((v1 - va) * (R - ra)) / (r1 - ra);
    }
  }
  return table[table.length - 1][1];
}

/** What the unseen mass must add in quadrature: v_halo = √max(0, v_obs² − v_vis²). */
export function vHalo(vObs: number, vVis: number): number {
  return Math.sqrt(Math.max(0, vObs * vObs - vVis * vVis));
}

/** Orbital angle after dtMyr at radius R (kpc) and speed v (km/s). */
export function advance(angle: number, R: number, vKms: number, dtMyr: number): number {
  if (!(R > 0)) return angle;
  return angle + (vKms * KMS_KPC_MYR * dtMyr) / R;
}
