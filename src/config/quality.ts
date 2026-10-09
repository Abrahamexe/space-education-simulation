/**
 * Quality presets (PLAN §9). The active preset is chosen at start-up from a
 * quick device heuristic and can be changed at runtime; an FPS governor
 * steps it down when the frame rate stays low (core/QualityManager.ts).
 */

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

/** Antialiasing: 0–1 FXAA (one pass), 2–3 SMAA high / ultra (SMAAPreset). */
export type AntialiasLevel = 0 | 1 | 2 | 3;

export interface QualityPreset {
  /** Cap on devicePixelRatio. */
  pixelRatio: number;
  /**
   * Fraction of the canvas resolution the scene renders at. Kept at 1: an
   * upscaled image reads as "blurry", which costs more than it saves.
   * Savings come from pixel-ratio caps, bloom depth, AA and counts instead.
   */
  renderScale: number;
  antialias: AntialiasLevel;
  bloomLevels: number;
  asteroids: number;
  kuiper: number;
  stars: number;
  /** Load high-resolution textures when approaching a body. */
  highResTextures: boolean;
  /** Galaxy view: most disc slices drawn (fewer where they overlap on screen anyway). */
  discSlices: 4 | 8 | 16;
  /** Black-hole ray march: step as a fraction of the radius. */
  lensStep: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: 1, renderScale: 1, antialias: 0, bloomLevels: 5, asteroids: 4000, kuiper: 1500, stars: 4000, highResTextures: false, discSlices: 4, lensStep: 0.13 },
  medium: { pixelRatio: 1.25, renderScale: 1, antialias: 1, bloomLevels: 6, asteroids: 8000, kuiper: 2500, stars: 6000, highResTextures: true, discSlices: 8, lensStep: 0.1 },
  high: { pixelRatio: 2, renderScale: 1, antialias: 2, bloomLevels: 8, asteroids: 14000, kuiper: 4000, stars: 9000, highResTextures: true, discSlices: 16, lensStep: 0.07 },
  ultra: { pixelRatio: 2, renderScale: 1, antialias: 3, bloomLevels: 9, asteroids: 20000, kuiper: 6000, stars: 12000, highResTextures: true, discSlices: 16, lensStep: 0.07 },
};

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
