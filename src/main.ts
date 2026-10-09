import './ui/styles/base.css';
import './ui/styles/hud.css';
import { LinearMipmapLinearFilter, MathUtils } from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { registerShaderChunks } from './shaders/chunks';
import { Engine } from './core/Engine';
import { Loader } from './core/Loader';
import { directionToPose, type OrbitPose } from './core/CameraRig';
import { Sun } from './bodies/Sun';
import { Starfield } from './bodies/Starfield';
import { SolarSystem } from './bodies/SolarSystem';
import { GalacticMotion } from './bodies/GalacticMotion';
import { HabitableZoneRing } from './bodies/HabitableZoneRing';
import { habitableZone } from './physics/habitable';
import { science } from './core/Science';
import { scale } from './core/scale';
import { KM_PER_AU } from './config/astro';
import { GalaxyView } from './galaxy/GalaxyView';
import { ViewSwitch } from './core/ViewSwitch';
import { GalaxyHud } from './ui/GalaxyHud';
import { Selection } from './core/Selection';
import { Picker } from './core/Picker';
import { Navigator } from './core/Navigator';
import { Input } from './core/Input';
import { ScaleTransition } from './core/ScaleTransition';
import { QualityManager } from './core/QualityManager';
import { Hud } from './ui/Hud';
import { LoadingScreen } from './ui/LoadingScreen';
import { strings } from './i18n';
import { CAMERA, STARFIELD } from './config/visual';
import { QUALITY_PRESETS } from './config/quality';
import { galacticToScene } from './physics/frames';
import { Playground } from './playground/Playground';
import { PlaygroundPanel } from './ui/PlaygroundPanel';
import { SpacecraftLayer } from './spacecraft/SpacecraftLayer';
import { SkyGrids } from './bodies/SkyGrids';

/**
 * Opening shot: the camera looks at the Sun with the galactic core a little
 * to one side, then drifts in on a shallow arc.
 */
function introPoses(sunRadius: number): { from: OrbitPose; to: OrbitPose } {
  const c = CAMERA.intro;
  const towardsCore = galacticToScene(0, 0);
  // Camera sits opposite the core, so looking at the Sun means looking at the core.
  const base = directionToPose(towardsCore.negate(), 1);
  const azimuth = base.azimuth + MathUtils.degToRad(c.azimuthOffsetDeg);
  const elevation = MathUtils.degToRad(c.elevationDeg);
  return {
    from: {
      distance: sunRadius * c.fromRadii,
      azimuth: azimuth - MathUtils.degToRad(c.sweepDeg),
      elevation: elevation * 2.2,
    },
    to: { distance: sunRadius * c.toRadii, azimuth, elevation },
  };
}

async function boot(): Promise<void> {
  registerShaderChunks();

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const loading = new LoadingScreen(document.body);

  if (!WebGL.isWebGL2Available()) {
    loading.showError(strings().errors.webgl);
    return;
  }

  const engine = new Engine(canvas);
  const loader = new Loader(engine.renderer);
  loader.onProgress((r) => loading.setProgress(r));

  // ---- Scene ----------------------------------------------------------------
  const starfield = new Starfield(engine.sky, engine.world);
  starfield.bakeNebula(engine.renderer);
  engine.add(starfield);

  const grids = new SkyGrids(engine.sky);
  const sun = new Sun(engine.world, engine.origin);
  engine.add(sun);
  engine.addLate(sun.viewUpdater);
  engine.postfx.setFlareSource(sun);

  const system = new SolarSystem(engine, loader, sun);
  engine.rig.setSurfaceQuery((p) => system.surfaceDistance(p));
  // Habitable zone round the Sun (Kopparapu et al. 2014), in the ecliptic,
  // drawn through the same distance mapping as the orbits.
  const sunHz = new HabitableZoneRing(habitableZone(5772, 1), (au) => scale.distance(au * KM_PER_AU));
  sunHz.mesh.rotation.x = -Math.PI / 2;
  engine.world.add(sunHz.mesh);
  scale.onChange(() => sunHz.rebuild());
  const syncHz = () => (sunHz.mesh.visible = science.habitableZones);
  science.onChange(syncHz);
  syncHz();

  // Telescopes and probes: registered before the labels and search are built.
  const spacecraft = new SpacecraftLayer(engine, system);

  const galactic = new GalacticMotion(engine, sun, system.planets);
  galactic.onChange((on) => system.setGalacticFrame(on));
  galactic.enabled = true;
  // After the system's view update (focus uniforms are set there).
  engine.addLate(galactic);

  // ---- Interaction --------------------------------------------------------------
  const selection = new Selection();
  const nav = new Navigator(engine, system, selection);
  const picker = new Picker(engine.camera, canvas, system, engine.origin);
  new Input(engine, canvas, picker, selection, nav);
  engine.rig.setPickQuery((x, y) => picker.pick(x, y)?.body ?? null);
  const syncCraftHighlight = () => spacecraft.highlight(selection.selected?.id ?? null, selection.hovered?.id ?? null);
  selection.onSelect(syncCraftHighlight);
  selection.onHover(syncCraftHighlight);

  const galaxy = new GalaxyView(engine, starfield, loader);
  const views = new ViewSwitch(engine, galaxy, sun, nav, selection);
  new GalaxyHud(engine, galaxy);

  const quality = new QualityManager(engine, system, starfield);
  const syncGalaxyQuality = () => (galaxy.discSlices = QUALITY_PRESETS[quality.level].discSlices);
  quality.onChange(syncGalaxyQuality);
  syncGalaxyQuality();
  const scaleTransition = new ScaleTransition();
  // Before bodies move this frame, so positions use the new blend.
  engine.add(scaleTransition, -10);
  const playground = new Playground(engine, system, sun, galactic, starfield, loader);
  views.onChange((on) => on && playground.exit());
  // The playground is its own world: zooming out to light-years stays here.
  views.blocked = () => playground.active;
  playground.onChange(() => spacecraft.setPlayground(playground.active));
  const hud = new Hud({ engine, system, galactic, views, selection, nav, scaleTransition, quality, playground, spacecraft });
  new PlaygroundPanel(engine, playground);
  views.onChange((on) => on && hud.showNotice(strings().galaxy.enterNotice));
  engine.rig.onMapModeChange((on) => on && hud.showNotice(strings().tools.cameraFreeNotice));
  engine.onContextLost(() => hud.showNotice(strings().errors.contextLost));

  engine.rig.setFocus(sun);
  const intro = introPoses(sun.getRadius());
  engine.rig.setPose(intro.from);

  // ---- Textures: low-res first (blocking), high-res swapped in later --------
  const mw = STARFIELD.milkyWay;
  const skyOpts = { mipmaps: false, wrapRepeatS: true } as const;
  loader
    .load(mw.textureLow, skyOpts)
    .then((t) => {
      starfield.setMilkyWayTexture(t);
      // Same image, separate GPU texture with mipmaps for the diffuse glow.
      const glow = t.clone();
      glow.generateMipmaps = true;
      glow.minFilter = LinearMipmapLinearFilter;
      glow.needsUpdate = true;
      starfield.setMilkyWayGlowTexture(glow);
    })
    .catch(() => loading.showError(strings().errors.load));

  await loader.whenIdle();

  // Compile every program and draw one frame while the overlay still hides it.
  await engine.renderer.compileAsync(engine.scene, engine.camera);
  engine.renderOnce();
  engine.start();

  void loading.finish();
  // Opening shot (PLAN §8.2): approach the Sun, hold a beat, then settle
  // into the system overview, unless the user has already taken control.
  let userTookOver = false;
  const takeOver = () => (userTookOver = true);
  const offInterrupt = engine.rig.onInterrupt(takeOver);
  for (const ev of ['pointerdown', 'wheel', 'keydown'] as const) window.addEventListener(ev, takeOver, { once: true });
  void engine.rig.flyPose(intro.from, intro.to, CAMERA.intro.durationS).then(() => {
    window.setTimeout(() => {
      offInterrupt();
      if (!userTookOver && !selection.selected) void nav.home();
    }, CAMERA.intro.holdS * 1000);
  });
  // HUD arrives while the camera settles (PLAN §8.2 step 4).
  window.setTimeout(() => hud.reveal(), CAMERA.intro.durationS * 1000 * CAMERA.intro.hudRevealAt);

  loader
    .loadDeferred(mw.textureHigh, skyOpts)
    .then((t) => starfield.setMilkyWayTexture(t))
    .catch(() => {
      /* keep the low-res sky */
    });

  // Developer panel (F2): also for curious users, loaded as its own chunk.
  const { setupDevTools } = await import('./utils/DevTools');
  setupDevTools(engine, { sun, starfield, system, nav, galactic, views, selection, spacecraft, grids, quality });
  if (import.meta.env.DEV) (window as unknown as { __pg: Playground }).__pg = playground;
}

void boot();
