import type { OrbitalElementsData } from '../physics/orbits';

export type Triplet = [number, number, number];

/** IAU rotation model: pole [value at J2000, rate per century], W = w0 + wDot·d. */
export interface IauRotation {
  poleRaDeg: [number, number];
  poleDecDeg: [number, number];
  w0Deg: number;
  wDotDegPerDay: number;
}

/**
 * How a body spins.
 *  - IAU model (planets, Ceres, Pluto, the Moon's parent frame).
 *  - "synchronous": tidally locked, prime meridian facing the parent; the
 *    rotation is uniform, so optical libration appears naturally.
 *  - fixed period about the orbit normal, for bodies without a published
 *    pole (approximation, flagged in the data).
 */
export type RotationData =
  | IauRotation
  | { kind: 'synchronous' }
  | { kind: 'period'; periodHours: number; _note?: string };

/** Shape of an entry in src/data/planets.json (major planets). */
export interface PlanetData {
  id: string;
  name: string;
  type: 'terrestrial' | 'gas-giant' | 'ice-giant' | 'dwarf' | 'moon';
  radiusKm: { equatorial: number; polar: number };
  /** Tri-axial semi-axes (km): long axis X (towards parent), Y polar, Z. */
  triaxialKm?: Triplet;
  obliquityDeg?: number;
  orbit: OrbitalElementsData;
  rotation: IauRotation;
  render: PlanetRender;
}

/** Artistic atmosphere: optical depths and heights relative to the planet. */
export interface AtmosphereVisual {
  /** Shell thickness, planet radii. */
  thickness: number;
  /** Vertical (zenith) Rayleigh optical depth per channel. */
  rayleigh: Triplet;
  /** Vertical Mie optical depth. */
  mie: number;
  mieTint: Triplet;
  /** Scale heights as fractions of the thickness. */
  rayleighHeight: number;
  mieHeight: number;
  g: number;
  intensity: number;
}

/** Physically specified atmosphere (Earth): sea-level coefficients per km. */
export interface AtmospherePhysical {
  physical: true;
  rayleighPerKm: Triplet;
  miePerKm: number;
  rayleighHeightKm: number;
  mieHeightKm: number;
  topKm: number;
  /** Exaggeration of the shell; densities are rescaled to keep optical depth. */
  visualScale: number;
  g: number;
  intensity: number;
}

export type AtmosphereConfig = AtmosphereVisual | AtmospherePhysical;

export interface FlowConfig {
  amplitudes: [number, number, number, number];
  frequencies: [number, number, number, number];
  phases: [number, number, number, number];
  turbulence: number;
}

export interface RingConfig {
  texture?: string;
  /** [radius km, width km, opacity] for generated ring systems. */
  procedural?: [number, number, number][];
  innerKm: number;
  outerKm: number;
  color?: Triplet;
  opacity: number;
  brightness: number;
}

export type ProceduralStyle =
  | 'cratered'
  | 'io'
  | 'europa'
  | 'ganymede'
  | 'titan'
  | 'enceladus'
  | 'iapetus'
  | 'triton'
  | 'miranda'
  | 'pluto';

export interface SurfaceFeature {
  latDeg: number;
  lonDeg: number;
  radiusDeg: number;
  /** Spot: colour-C blend strength. Big crater: relief depth. */
  strength: number;
}

export interface PlanetRender {
  shader: 'rocky' | 'earth' | 'gas' | 'procedural';
  orbitColor: Triplet;
  markerColor: Triplet;
  textures?: Record<string, string>;
  texturesHigh?: Record<string, string>;
  highResWithinRadii?: number;
  tint?: Triplet;
  bumpStrength?: number;
  lommel?: number;
  flow?: FlowConfig;
  flowCalm?: { latitudeDeg: number; widthDeg: number };
  limbDarkening?: number;
  bands?: number;
  storms?: number;
  cloudRotationDays?: number;
  cloudAltitude?: number;
  cloudDriftDegPerDay?: number;
  rings?: RingConfig;
  atmosphere?: AtmosphereConfig;
  // Procedural surfaces
  style?: ProceduralStyle;
  colorA?: Triplet;
  colorB?: Triplet;
  colorC?: Triplet;
  regionScale?: number;
  regionContrast?: number;
  craterDensity?: number;
  craterScale?: number;
  relief?: number;
  rimBrightness?: number;
  lineae?: number;
  spot?: SurfaceFeature;
  bigCrater?: SurfaceFeature;
  seed?: number;
  /** Lumpy, non-spherical small bodies: displacement amplitude (radii). */
  irregularity?: number;
}
