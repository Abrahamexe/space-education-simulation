import { Matrix3, MathUtils, Vector3 } from 'three';
import { EQUATORIAL_TO_GALACTIC, OBLIQUITY_J2000_DEG } from '../config/astro';

/**
 * Reference frames.
 *
 * The scene uses heliocentric ecliptic J2000 coordinates, remapped to the
 * three.js Y-up convention:
 *   scene.x =  ecliptic X  (towards the vernal equinox)
 *   scene.y =  ecliptic Z  (ecliptic north pole)
 *   scene.z = -ecliptic Y
 * This is a proper rotation (det = +1), so handedness is preserved.
 */

/** scene → ecliptic (X, Y, Z). */
export const SCENE_TO_ECLIPTIC = new Matrix3().set(
  1, 0, 0,
  0, 0, -1,
  0, 1, 0,
);

/** ecliptic → scene. */
export const ECLIPTIC_TO_SCENE = SCENE_TO_ECLIPTIC.clone().transpose();

const eps = MathUtils.degToRad(OBLIQUITY_J2000_DEG);

/** ecliptic J2000 → equatorial J2000 (rotation about X by +ε). */
export const ECLIPTIC_TO_EQUATORIAL = new Matrix3().set(
  1, 0, 0,
  0, Math.cos(eps), -Math.sin(eps),
  0, Math.sin(eps), Math.cos(eps),
);

const g = EQUATORIAL_TO_GALACTIC;
export const EQUATORIAL_TO_GALACTIC_M3 = new Matrix3().set(
  g[0], g[1], g[2],
  g[3], g[4], g[5],
  g[6], g[7], g[8],
);

/** scene direction → galactic direction. Used to orient the sky. */
export const SCENE_TO_GALACTIC = new Matrix3()
  .multiplyMatrices(EQUATORIAL_TO_GALACTIC_M3, ECLIPTIC_TO_EQUATORIAL)
  .multiply(SCENE_TO_ECLIPTIC);

/** galactic direction → scene direction (orthonormal, so the transpose). */
export const GALACTIC_TO_SCENE = SCENE_TO_GALACTIC.clone().transpose();

/** equatorial J2000 → scene. */
export const EQUATORIAL_TO_SCENE = new Matrix3()
  .multiplyMatrices(ECLIPTIC_TO_SCENE, ECLIPTIC_TO_EQUATORIAL.clone().transpose());

/** Scene-space unit vector for an ICRF/J2000 right ascension & declination (degrees). */
export function equatorialToScene(raDeg: number, decDeg: number, out = new Vector3()): Vector3 {
  const ra = MathUtils.degToRad(raDeg);
  const dec = MathUtils.degToRad(decDeg);
  const cd = Math.cos(dec);
  return out
    .set(cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec))
    .applyMatrix3(EQUATORIAL_TO_SCENE);
}

/** Unit vector for galactic longitude/latitude (radians), galactic frame. */
export function galacticToVector(l: number, b: number, out = new Vector3()): Vector3 {
  const cb = Math.cos(b);
  return out.set(cb * Math.cos(l), cb * Math.sin(l), Math.sin(b));
}

/** Scene-space unit vector pointing at galactic (l, b) in radians. */
export function galacticToScene(l: number, b: number, out = new Vector3()): Vector3 {
  return galacticToVector(l, b, out).applyMatrix3(GALACTIC_TO_SCENE);
}

const ICRF_Z_SCENE = equatorialToScene(0, 90);
const ICRF_X_SCENE = equatorialToScene(0, 0);

/**
 * Right-handed frame whose Z axis is the given pole (scene space) and whose X
 * axis is the pole plane's ascending node on the ICRF equator — the IAU /
 * JPL convention for body equators and satellite Laplace planes.
 * Returns the frame → scene matrix (columns X, Y, Z).
 */
export function poleFrame(pole: Vector3, out = new Matrix3()): Matrix3 {
  const z = pole.clone().normalize();
  const x = new Vector3().crossVectors(ICRF_Z_SCENE, z);
  if (x.lengthSq() < 1e-12) x.copy(ICRF_X_SCENE);
  x.normalize();
  const y = new Vector3().crossVectors(z, x);
  return out.set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
}

/** Frame → scene matrix for a pole given as ICRF right ascension / declination (deg). */
export function poleFrameFromRaDec(raDeg: number, decDeg: number, out = new Matrix3()): Matrix3 {
  return poleFrame(equatorialToScene(raDeg, decDeg), out);
}
