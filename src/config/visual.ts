/**
 * Art-direction constants. Unlike config/astro.ts these are tuning knobs,
 * not physics: they are the defaults the lil-gui panels start from.
 * Colours are linear-space RGB triplets (HDR values > 1 feed the bloom).
 */

export type RGB = readonly [number, number, number];

export const RENDER = {
  maxPixelRatio: 2,
  fovDeg: 45,
  /** Near plane as a fraction of the camera's distance to the focus surface. */
  nearToSurfaceRatio: 0.05,
  minNear: 1e-5,
  maxNear: 1,
  far: 1e9,
  clearColor: 0x000000,
} as const;

export const POSTFX = {
  exposure: 1.0,
  /** r² coefficient of the vignette falloff; 0 disables it. */
  vignette: 0.45,
  bloom: {
    intensity: 0.9,
    luminanceThreshold: 0.75,
    luminanceSmoothing: 0.35,
    radius: 0.78,
    levels: 8,
  },
} as const;

export const SUN_VISUAL = {
  /** Sphere tessellation (PLAN §5.7: at least 128×128). */
  widthSegments: 256,
  heightSegments: 192,

  /** Overall HDR multiplier of the photosphere. */
  brightness: 0.88,
  /** Disk-centre colour (warm white) and limb tint. */
  colorCore: [1.0, 0.47, 0.1] as RGB,
  colorHot: [1.0, 0.74, 0.34] as RGB,
  colorCool: [0.9, 0.2, 0.03] as RGB,
  /** Per-channel limb-darkening exponents I(μ) = μ^α (blue darkens most). */
  limbExponents: [0.42, 0.62, 0.95] as RGB,

  granule: {
    /** Cells per unit radius. Real granules are far smaller; this is the visible proxy. */
    scale: 105,
    /** How fast cells boil (real seconds). */
    speed: 0.16,
    contrast: 0.42,
    /** Second, finer octave weight. */
    fineWeight: 0.6,
    /** Domain-warp strength (turbulent cell walls). */
    warp: 0.28,
  },
  supergranule: {
    scale: 7,
    strength: 0.18,
  },
  /**
   * Mid-scale convective plasma: a domain-warped, ridged "boiling" layer that
   * keeps the disc alive from viewing distances where granules are below a
   * pixel, and hands over to the real granulation close up.
   */
  plasma: {
    /** Cells per unit radius. */
    scale: 18,
    /** Flow speed (noise units per real second). */
    speed: 0.045,
    strength: 0.38,
  },
  spots: {
    scale: 2.6,
    /** Noise level above which a penumbra starts. Higher = fewer spots. */
    threshold: 0.42,
    penumbraWidth: 0.1,
    umbraDarkness: 0.92,
    penumbraDarkness: 0.55,
    /** Evolution speed in noise units per simulated day. */
    evolutionPerDay: 0.08,
    /** Crossfade wrap period for sim-time-driven noise (days). */
    wrapPeriodDays: 24,
  },
  faculae: {
    strength: 0.55,
    /** Plage brightening on the open disc (faculae proper peak at the limb). */
    discStrength: 0.35,
  },
  /**
   * Flares: an active region brightens over a second or two and decays over
   * several, every so often. Deliberately gentle (no strobing), and off
   * under prefers-reduced-motion.
   */
  flares: {
    maxActive: 2,
    /** Seconds between flare onsets (uniform random in range). */
    intervalMin: 8,
    intervalMax: 20,
    riseS: 1.6,
    decayS: 7,
    /** Angular radius of the bright kernel (radians on the surface). */
    size: 0.04,
    /** Peak HDR brightness added at the kernel. */
    intensity: 3.2,
    color: [1.0, 0.86, 0.62] as RGB,
    /** Prefer the hemisphere facing the camera (min cos of view angle). */
    minFacing: 0.25,
  },

  corona: {
    /** Billboard half-extent in solar radii. */
    extent: 7.0,
    intensity: 0.6,
    falloff: 2.6,
    streamerStrength: 0.85,
    streamerSharpness: 2.4,
    flowSpeed: 0.035,
    color: [1.0, 0.52, 0.22] as RGB,
    innerColor: [1.0, 0.78, 0.5] as RGB,
    chromosphereColor: [1.0, 0.32, 0.18] as RGB,
    chromosphereIntensity: 0.9,
    /** Slow turn of the streamer pattern about the solar axis (rad/s). */
    swirlSpeed: 0.006,
    /** Brightness "breathing": amplitude and period (s). */
    breathAmp: 0.07,
    breathPeriodS: 11,
    /** Thin magnetic loops in the inner corona. */
    loopStrength: 0.55,
  },

  prominences: {
    count: 14,
    /** Loop height range in solar radii. */
    heightMin: 0.06,
    heightMax: 0.4,
    /** Footpoint separation range (radians on the surface). */
    spanMin: 0.06,
    spanMax: 0.3,
    thickness: 0.02,
    lifeMin: 18,
    lifeMax: 42,
    intensity: 1.8,
    color: [1.0, 0.24, 0.07] as RGB,
    flowSpeed: 0.22,
    /** Share of loops that erupt (lift off and balloon outwards) instead of fading in place. */
    eruptFraction: 0.35,
    /** How far an erupting arc's height is multiplied at the end of its eruption. */
    eruptExpansion: 6,
    /** Fraction of an erupting loop's life spent erupting. */
    eruptFractionOfLife: 0.4,
  },

  light: {
    color: 0xfff4e8,
    intensity: 3.0,
  },
} as const;

export const LENS_FLARE = {
  intensity: 0.55,
  ghostIntensity: 0.32,
  haloIntensity: 0.03,
  streakIntensity: 0.2,
  starburstIntensity: 0.16,
  /** NDC distance beyond the viewport edge over which the flare fades out. */
  edgeFade: 0.25,
} as const;

export const STARFIELD = {
  milkyWay: {
    textureLow: 'textures/stars/2k_stars_milky_way.jpg',
    textureHigh: 'textures/stars/8k_stars_milky_way.jpg',
    brightness: 1.6,
    contrast: 1.15,
    saturation: 1.1,
    /** Diffuse band light (mip-blurred copy of the panorama). */
    glow: 6.0,
    glowLod: 5.0,
    glowFloor: 0.004,
    bulgeTint: [1.3, 0.98, 0.62] as RGB,
    nebulaStrength: 0.035,
  },
  stars: {
    count: 9000,
    /** Fraction of stars concentrated around the galactic plane. */
    discFraction: 0.45,
    /** Galactic-latitude spread of the disc population (degrees). */
    discSpreadDeg: 12,
    sizeMin: 0.9,
    sizeMax: 4.2,
    brightness: 1.25,
    twinkleAmount: 0.22,
    twinkleSpeed: 1.6,
  },
  /** Nearer stars at finite distance: gives subtle parallax when travelling. */
  parallax: {
    count: 700,
    minAu: 300,
    maxAu: 2400,
  },
} as const;

export const CAMERA = {
  /** Orbit-controls feel. */
  dampingFactor: 0.06,
  rotateSpeed: 0.55,
  zoomSpeed: 0.9,
  panSpeed: 0.8,
  /** Closest approach as a multiple of the focus body's radius. */
  minDistanceRadii: 1.25,
  maxDistance: 2e7,
  /** Re-centre the floating origin once the focus is this far from it. */
  originRebaseDistance: 100,

  /**
   * Free camera. Once the followed body shrinks below releasePx (apparent
   * radius, CSS px) the camera lets go of it. Free motion is scaled by the
   * distance to the nearest body surface, so it is quick in empty space and
   * slows down on approach without ever passing through anything.
   */
  free: {
    releasePx: 6,
    /** W A S D / R F speed: fractions of the nearest-surface distance per second. */
    flySpeed: 0.9,
    /** Multiplier while Shift is held. */
    boost: 4,
    /** Pending wheel travel cap (log units), so a long spin does not run away. */
    maxPendingLog: 6,
  },

  /** Map mode (grab and slide): glide decay rate after a throw (1/s). */
  map: {
    glideDecay: 4.5,
  },

  /** Opening shot: distances in solar radii, angles in degrees. */
  intro: {
    fromRadii: 160,
    toRadii: 5.2,
    durationS: 7.5,
    /** Azimuth offset from the galactic-centre direction, so the bright core sits beside the Sun. */
    azimuthOffsetDeg: 28,
    elevationDeg: 11,
    /** Extra azimuth swept during the approach (arc, not a straight line). */
    sweepDeg: 34,
    /** Fraction of the intro after which the HUD starts to appear. */
    hudRevealAt: 0.45,
    /** Pause at the Sun before gliding out to the overview (s). */
    holdS: 2.5,
  },
} as const;

export const LOADING = {
  /** Overlay fade after loading (ms). */
  fadeMs: 900,
} as const;

/**
 * Galactic motion: the Sun carries the system through the Milky Way. Each
 * planet's path over the last `trailDays` is drawn in that moving frame
 * (a stretched helix), and faint dust fixed in the galactic frame streams
 * past the camera.
 */
export const GALACTIC = {
  trailDays: 365.25,
  /** Trail vertices per orbit travelled, clamped to [minSamples, maxSamples]. */
  samplesPerOrbit: 140,
  minSamples: 48,
  maxSamples: 1200,
  opacity: 0.6,
  sunColor: [1.0, 0.72, 0.36] as RGB,
  dust: {
    count: 2600,
    /** Dust box edge, in camera distances (two octaves crossfade). */
    boxPerDistance: 9,
    sizePx: 1.7,
    intensity: 0.55,
    color: [0.62, 0.7, 0.85] as RGB,
  },
} as const;

export const PLANETS = {
  /** Sunlight seen by every body's custom shader (direction comes from the Sun's position). */
  sunlight: {
    color: [1.0, 0.97, 0.92] as RGB,
    intensity: 2.2,
    /** Faint starlight so night sides keep a readable silhouette. */
    ambient: 0.004,
  },
  geometry: {
    /** Close-up and distant tessellation (PLAN §5.7: never below 128×128). */
    near: [384, 256] as const,
    far: [128, 128] as const,
    /** Switch to the dense mesh closer than this many radii. */
    lodNearRadii: 30,
    atmosphere: [128, 96] as const,
    ringSegments: 512,
  },
  orbit: {
    segments: 720,
    opacity: 0.32,
    /** Dwarf planets and comets: steep, crossing orbits stay in the background. */
    minorOpacity: 0.12,
    /** Orbit lines fade out within this many focus radii of the camera. */
    fadeNearRadii: 14,
    /** The focused body's own orbit fades within this many of its radii… */
    focusFadeRadii: 40,
    /** …other orbits only right next to it. */
    focusFadeOtherRadii: 1.2,
    /** Re-sample the ellipse when the epoch drifts more than this. */
    rebuildEveryDays: 365,
  },
  marker: {
    sizePx: 5,
    intensity: 1.4,
    /** Apparent disk radius (px) over which the point fades into the real disk. */
    fadeFromPx: 1.2,
    fadeToPx: 3.5,
  },
  flow: {
    /** Crossfade period of the zonal-flow samples (days of flow time). */
    periodDays: 3,
    /** Flow time is capped so fast-forward never turns bands into noise. */
    maxDaysPerSecond: 1.5,
  },
  earth: {
    normalStrength: 1.0,
    cloudShadow: 0.55,
    cloudOpacity: 1.0,
    nightIntensity: 3.0,
    nightTint: [1.0, 0.7, 0.4] as RGB,
    specIntensity: 1.4,
    specPower: 160,
    twilightTint: [1.0, 0.55, 0.32] as RGB,
  },
  moons: {
    markerSizePx: 3,
    orbitSegments: 256,
    orbitOpacity: 0.22,
    /** Moons and their orbits fade out between these camera distances (in units of the moon's orbit radius from its planet). */
    fadeStartOrbits: 8,
    fadeEndOrbits: 20,
  },
  rings: {
    /** Width of generated 1D profiles for procedural ring systems. */
    proceduralWidth: 2048,
    /** Narrow rings are widened to at least this many texels to stay visible. */
    minWidthTexels: 1.5,
  },
} as const;

export const BELTS = {
  asteroid: {
    innerAu: 2.1,
    outerAu: 3.3,
    /** Mean-motion resonances with Jupiter: 3:1, 5:2, 7:3, 2:1 (AU). */
    kirkwoodGapsAu: [2.502, 2.825, 2.958, 3.279],
    gapHalfWidthAu: 0.02,
    trojanFraction: 0.08,
    /** Jupiter's semi-major axis and J2000 mean longitude (JPL table). */
    jupiterAu: 5.202887,
    jupiterMeanLongitudeDeg: 34.39644051,
    sizeMinKm: 2,
    sizeMaxKm: 400,
    sizeBoost: 1.0,
    dustSizePx: 1.3,
    dustIntensity: 8,
  },
  kuiper: {
    sizeMinKm: 40,
    sizeMaxKm: 600,
    sizeBoost: 1.0,
    dustSizePx: 1.3,
    dustIntensity: 6,
  },
} as const;

export const COMET = {
  /** Sublimation starts inside this heliocentric distance (AU)… */
  activeWithinAu: 4.0,
  /** …and activity is full at this distance (Halley's perihelion is 0.59 AU). */
  peakAtAu: 0.6,
  /** Physical tail length at full activity (AU), mapped through the scale curve. */
  tailMaxAu: 0.35,
  widthRatio: 0.08,
  ion: { particles: 4500, rate: 0.12, color: [0.45, 0.65, 1.0] as RGB, intensity: 1.2, particleSizeRatio: 0.008 },
  dust: { particles: 9000, rate: 0.06, color: [1.0, 0.9, 0.72] as RGB, intensity: 0.9, particleSizeRatio: 0.011 },
  coma: { color: [0.85, 0.92, 1.0] as RGB, intensity: 1.2, radiusRatio: 0.045 },
} as const;

export const INTERACTION = {
  pickTolerancePx: 14,
  pickToleranceMoonPx: 9,
  /** Max pointer travel (px) and time (ms) for a press to count as a click. */
  clickMaxMovePx: 5,
  clickMaxMs: 350,
  /** Wheel: log-distance change per 100 px of wheel delta, and smoothing rate (1/s). */
  zoomStep: 0.5,
  zoomSmoothing: 10,
  /**
   * Camera flight along the van Wijk–Nuij zoom/pan path. rho: how far it
   * pulls back (√2 = paper default, larger = higher). Duration = baseS +
   * secondsPerS · path length, clamped to [minS, maxS]. liftMax: upward
   * swing at mid-flight; FOV kick in degrees.
   */
  flight: {
    minS: 1.6,
    maxS: 6.0,
    baseS: 0.9,
    secondsPerS: 0.3,
    rho: 1.5,
    liftMax: 0.3,
    fovKickDeg: 5,
    /** End framing, in body radii, by kind. */
    framingRadii: { star: 6, planet: 4.2, dwarf: 4.2, moon: 4.5, comet: 5 },
    /** An active comet is framed by its coma and tail (multiples of the half tail length). */
    cometTailFraming: 2.4,
    /** Ringed planets need room for the rings. */
    ringFramingRadii: 7,
    phaseDeg: 48,
    elevationDeg: 14,
  },
  /** "Home": overview of the inner system, in solar radii from the Sun. */
  home: { radii: 62, elevationDeg: 32, azimuthDeg: 0 },
} as const;
