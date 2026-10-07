/**
 * Quality presets (PLAN §9). The active preset is chosen at start-up from a
 * quick device heuristic and can be changed at runtime; an FPS governor
 * steps it down when the frame rate stays low (core/QualityManager.ts).
 */

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

/** SMAA search quality (postprocessing's SMAAPreset: 0 low … 3 ultra). */
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
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: 1, renderScale: 1, antialias: 0, bloomLevels: 5, asteroids: 4000, kuiper: 1500, stars: 4000, highResTextures: false },
  medium: { pixelRatio: 1.25, renderScale: 1, antialias: 1, bloomLevels: 6, asteroids: 8000, kuiper: 2500, stars: 6000, highResTextures: true },
  high: { pixelRatio: 2, renderScale: 1, antialias: 2, bloomLevels: 8, asteroids: 14000, kuiper: 4000, stars: 9000, highResTextures: true },
  ultra: { pixelRatio: 2, renderScale: 1, antialias: 3, bloomLevels: 9, asteroids: 20000, kuiper: 6000, stars: 12000, highResTextures: true },
};

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
