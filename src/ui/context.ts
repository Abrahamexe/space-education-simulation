import type { Engine } from '../core/Engine';
import type { Navigator } from '../core/Navigator';
import type { Selection } from '../core/Selection';
import type { ScaleTransition } from '../core/ScaleTransition';
import type { QualityManager } from '../core/QualityManager';
import type { SolarSystem } from '../bodies/SolarSystem';
import type { GalacticMotion } from '../bodies/GalacticMotion';
import type { ViewSwitch } from '../core/ViewSwitch';
import type { Playground } from '../playground/Playground';

/** What UI components may talk to. */
export interface UiContext {
  engine: Engine;
  system: SolarSystem;
  galactic: GalacticMotion;
  views: ViewSwitch;
  selection: Selection;
  nav: Navigator;
  scaleTransition: ScaleTransition;
  quality: QualityManager;
  playground?: Playground;
}
