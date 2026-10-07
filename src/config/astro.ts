/**
 * Astronomical constants. Every value here is a published standard; see
 * docs/CREDITS.md for the sources. Nothing in this file is a tuning knob.
 */

/** Astronomical unit in km (IAU 2012 Resolution B2, exact). */
export const KM_PER_AU = 149_597_870.7;

/** Speed of light in vacuum, km/s (exact, SI definition). */
export const SPEED_OF_LIGHT_KM_S = 299_792.458;

/** Julian Date of the J2000.0 epoch (2000-01-01 12:00 TT). */
export const JD_J2000 = 2_451_545.0;

/** Julian Date of the Unix epoch (1970-01-01 00:00 UTC). */
export const JD_UNIX_EPOCH = 2_440_587.5;

export const SECONDS_PER_DAY = 86_400;
export const DAYS_PER_JULIAN_YEAR = 365.25;

/** Mean obliquity of the ecliptic at J2000.0 (IAU 2006: 84381.406″). */
export const OBLIQUITY_J2000_DEG = 23.439_279_4;

/**
 * Rotation matrix from ICRS/J2000 equatorial to galactic coordinates
 * (Hipparcos catalogue, ESA 1997, Vol. 1 §1.5.3). Row-major:
 * r_gal = M · r_eq. Rows are the galactic x/y/z axes in equatorial frame.
 */
export const EQUATORIAL_TO_GALACTIC: readonly number[] = [
  -0.054_875_560_4, -0.873_437_090_2, -0.483_835_015_5,
  +0.494_109_427_9, -0.444_829_630_0, +0.746_982_244_5,
  -0.867_666_149_0, -0.198_076_373_4, +0.455_983_776_2,
];

/**
 * The Sun's velocity relative to the Galactic rest frame, km/s, galactic
 * Cartesian (U towards the Galactic centre, V along rotation, W towards the
 * north Galactic pole): peculiar motion (U, V, W) = (11.1, 12.24, 7.25)
 * (Schönrich, Binney & Dehnen 2010) plus the circular speed of the local
 * standard of rest Θ0 = 236 km/s (Reid et al. 2019). |v| ≈ 248 km/s,
 * towards l ≈ 87°, b ≈ 2° (Cygnus).
 */
export const SUN_GALACTIC_VELOCITY_KM_S: readonly [number, number, number] = [11.1, 12.24 + 236, 7.25];
