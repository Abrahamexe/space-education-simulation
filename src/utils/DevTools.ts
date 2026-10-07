import GUI from 'lil-gui';
import { ToneMappingMode } from 'postprocessing';
import '../ui/styles/devtools.css';
import { icon } from '../ui/icons';
import type { GalacticMotion } from '../bodies/GalacticMotion';
import type { ViewSwitch } from '../core/ViewSwitch';
import { MathUtils, Vector3, type IUniform } from 'three';
import type { Engine } from '../core/Engine';
import { TIME_RATE_PRESETS } from '../core/Time';
import type { Sun } from '../bodies/Sun';
import type { Starfield } from '../bodies/Starfield';
import type { SolarSystem } from '../bodies/SolarSystem';
import type { Navigator } from '../core/Navigator';
import { directionToPose } from '../core/CameraRig';
import { sunUniforms } from '../core/lighting';
import { scale } from '../core/scale';
import { galacticToScene } from '../physics/frames';

const STORE_KEY = 'space.devtools';

interface DevState {
  open: boolean;
  folders: string[];
}

function loadState(): DevState {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? '') as Partial<DevState>;
    return { open: !!s.open, folders: Array.isArray(s.folders) ? s.folders : [] };
  } catch {
    return { open: false, folders: [] };
  }
}

function saveState(s: DevState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode: not remembered */
  }
}

/** Folder path such as "Güneş/Korona", stable across reloads. */
function folderPath(f: GUI): string {
  const parts: string[] = [];
  for (let g: GUI | undefined = f; g && g.parent; g = g.parent) parts.unshift(g._title);
  return parts.join('/');
}

/** Human labels for the time-rate presets. */
const RATE_LABELS: Record<string, string> = {
  realtime: 'Gerçek zaman',
  minutePerSecond: '1 dakika / sn',
  hourPerSecond: '1 saat / sn',
  dayPerSecond: '1 gün / sn',
  tenDaysPerSecond: '10 gün / sn',
  monthPerSecond: '1 ay / sn',
  yearPerSecond: '1 yıl / sn',
};

/**
 * Panel shell: a pill (top left) that opens a glass panel with a live
 * frame-time readout, a filter field and the lil-gui controls.
 */
function createShell(engine: Engine) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dev-toggle';
  toggle.title = 'Geliştirici paneli (F2)';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'dev-panel');
  toggle.innerHTML = `${icon('dev')}<span>Geliştirici</span><span class="dev-fps">–</span>`;

  const panel = document.createElement('section');
  panel.className = 'dev-panel';
  panel.id = 'dev-panel';
  panel.setAttribute('aria-label', 'Geliştirici paneli');
  panel.dataset.open = 'false';
  panel.innerHTML = `
    <div class="dev-head">
      <div class="dev-title-row">
        <h2 class="dev-title">Geliştirici</h2>
        <span class="dev-badge">DEV</span>
        <button type="button" class="btn-icon" data-close aria-label="Paneli kapat" title="Kapat (F2)">${icon('close')}</button>
      </div>
      <div class="dev-perf" aria-live="off">
        <div class="dev-stat" data-fps><b>–</b><span>FPS</span></div>
        <div class="dev-stat" data-ms><b>–</b><span>ms / kare</span></div>
        <div class="dev-stat" data-calls><b>–</b><span>çizim</span></div>
        <canvas class="dev-spark" aria-hidden="true"></canvas>
      </div>
      <label class="dev-search">${icon('search')}<input type="search" placeholder="Ayar ara… (ör. bloom, korona)" aria-label="Ayar ara" spellcheck="false" /></label>
    </div>
    <div class="dev-body"></div>
    <div class="dev-foot"><span><kbd>F2</kbd> aç / kapat</span><button type="button" data-reset>Varsayılana dön</button></div>`;
  document.body.append(toggle, panel);

  const body = panel.querySelector('.dev-body') as HTMLElement;
  const search = panel.querySelector('input') as HTMLInputElement;
  const fpsEl = panel.querySelector('[data-fps]') as HTMLElement;
  const msEl = panel.querySelector('[data-ms]') as HTMLElement;
  const callsEl = panel.querySelector('[data-calls]') as HTMLElement;
  const pillFps = toggle.querySelector('.dev-fps') as HTMLElement;
  const spark = panel.querySelector('canvas') as HTMLCanvasElement;
  const g2d = spark.getContext('2d')!;

  // ---- Frame-time meter -------------------------------------------------------
  const history = new Float32Array(90);
  let head = 0;
  let last = performance.now();
  let acc = 0;
  let frames = 0;
  let lastText = 0;
  const level = (el: HTMLElement, fps: number) => (el.dataset.level = fps >= 55 ? '' : fps >= 30 ? 'warn' : 'bad');
  const drawSpark = () => {
    // Backing store at device resolution so the line stays crisp.
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(spark.clientWidth * dpr);
    const h = Math.round(spark.clientHeight * dpr);
    if (spark.width !== w || spark.height !== h) {
      spark.width = w;
      spark.height = h;
    }
    g2d.clearRect(0, 0, w, h);
    const maxMs = 50;
    // 60 FPS guide.
    g2d.strokeStyle = 'rgba(236,238,242,0.18)';
    g2d.lineWidth = dpr;
    const y60 = h - (16.7 / maxMs) * h;
    g2d.beginPath();
    g2d.moveTo(0, y60);
    g2d.lineTo(w, y60);
    g2d.stroke();
    g2d.strokeStyle = '#f2b35e';
    g2d.lineWidth = 1.5 * dpr;
    g2d.lineJoin = 'round';
    g2d.beginPath();
    for (let i = 0; i < history.length; i++) {
      const ms = history[(head + i) % history.length];
      const x = (i / (history.length - 1)) * w;
      const y = h - Math.min(ms / maxMs, 1) * (h - dpr) - dpr / 2;
      if (i === 0) g2d.moveTo(x, y);
      else g2d.lineTo(x, y);
    }
    g2d.stroke();
  };
  engine.onFrame(() => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    history[head] = dt;
    head = (head + 1) % history.length;
    acc += dt;
    frames++;
    if (now - lastText < 400) return;
    const fps = (frames * 1000) / acc;
    const text = fps.toFixed(0);
    pillFps.textContent = `${text} FPS`;
    if (panel.dataset.open === 'true') {
      (fpsEl.firstElementChild as HTMLElement).textContent = text;
      (msEl.firstElementChild as HTMLElement).textContent = (acc / frames).toFixed(1);
      (callsEl.firstElementChild as HTMLElement).textContent = String(engine.renderer.info.render.calls);
      level(fpsEl, fps);
      level(msEl, fps);
      drawSpark();
    }
    acc = 0;
    frames = 0;
    lastText = now;
  });

  return { toggle, panel, body, search };
}

/**
 * Development-only tooling (PLAN §2): frame-time meter and live tuning in a
 * HUD-styled panel. F2 (or the key left of 1) toggles it; open state and
 * open folders are remembered. Loaded through a dynamic import guarded by
 * import.meta.env.DEV, so none of this reaches the production bundle.
 */
export function setupDevTools(
  engine: Engine,
  bodies: { sun: Sun; starfield: Starfield; system: SolarSystem; nav: Navigator; galactic: GalacticMotion; views: ViewSwitch },
): GUI {
  const { sun, starfield, system, nav, galactic, views } = bodies;

  const shell = createShell(engine);
  const gui = new GUI({ container: shell.body, title: 'Geliştirici' });

  const uni = (u: IUniform, folder: GUI, name: string, min: number, max: number, step?: number) =>
    folder.add(u, 'value', min, max, step).name(name);

  // ---- Time -----------------------------------------------------------------
  const time = engine.time;
  const tf = gui.addFolder('Zaman');
  const rateOptions = Object.fromEntries(TIME_RATE_PRESETS.map((p) => [RATE_LABELS[p.id] ?? p.id, p.daysPerSecond]));
  const timeState = {
    get date() {
      return time.date.toISOString().replace('T', ' ').slice(0, 19);
    },
    rate: time.rate,
  };
  tf.add(time, 'paused').name('durdur').listen();
  tf.add(timeState, 'rate', rateOptions).name('hız').listen().onChange((v: number) => time.setRate(v));
  // The HUD time controls change the rate too: keep the dropdown in step.
  engine.onFrame(() => (timeState.rate = time.rate));
  tf.add(timeState, 'date').name('tarih (UTC)').listen().disable();
  tf.add({ now: () => time.setNow() }, 'now').name('bugün');
  tf.add({ j2000: () => time.setJ2000() }, 'j2000').name('J2000');

  // ---- Render / post ----------------------------------------------------------
  const post = engine.postfx;
  const rf = gui.addFolder('Görüntü');
  rf.add(post.grade, 'exposure', 0.1, 4, 0.01).name('pozlama');
  rf.add(post.grade, 'vignette', 0, 2, 0.01).name('vinyet');
  rf.add(post.toneMapping, 'mode', {
    ACES: ToneMappingMode.ACES_FILMIC,
    AgX: ToneMappingMode.AGX,
    Neutral: ToneMappingMode.NEUTRAL,
    Reinhard: ToneMappingMode.REINHARD,
  }).name('ton eşleme');
  rf.add(post.bloom, 'intensity', 0, 4, 0.01).name('bloom yoğunluk');
  rf.add(post.bloom.luminanceMaterial, 'threshold', 0, 4, 0.01).name('bloom eşik');
  rf.add(post.bloom.luminanceMaterial, 'smoothing', 0, 1, 0.01).name('bloom yumuşaklık');
  rf.add(post.bloom.mipmapBlurPass, 'radius', 0, 1, 0.01).name('bloom yarıçap');

  const ff = rf.addFolder('Lens parlaması');
  uni(post.flare.u('uIntensity'), ff, 'yoğunluk', 0, 3, 0.01);
  uni(post.flare.u('uGhost'), ff, 'hayaletler', 0, 3, 0.01);
  uni(post.flare.u('uHalo'), ff, 'hale', 0, 3, 0.01);
  uni(post.flare.u('uStreak'), ff, 'yatay çizgi', 0, 3, 0.01);
  uni(post.flare.u('uStarburst'), ff, 'ışınlar', 0, 3, 0.01);
  ff.close();

  // ---- Sun ----------------------------------------------------------------------
  const sf = gui.addFolder('Güneş');
  const su = sun.surface.material.uniforms;
  uni(su.uBrightness, sf, 'parlaklık', 0.2, 10, 0.01);
  sf.addColor(su.uColorCore, 'value').name('renk (orta)');
  sf.addColor(su.uColorHot, 'value').name('renk (sıcak)');
  sf.addColor(su.uColorCool, 'value').name('renk (kenar)');
  const limb = su.uLimbExp.value as Vector3;
  sf.add(limb, 'x', 0, 2, 0.01).name('kenar karartma R');
  sf.add(limb, 'y', 0, 2, 0.01).name('kenar karartma G');
  sf.add(limb, 'z', 0, 2, 0.01).name('kenar karartma B');

  const gf = sf.addFolder('Granülasyon');
  uni(su.uGranScale, gf, 'ölçek', 5, 200, 0.5);
  uni(su.uGranSpeed, gf, 'hız', 0, 1, 0.001);
  uni(su.uGranContrast, gf, 'kontrast', 0, 1.5, 0.01);
  uni(su.uGranFine, gf, 'ince katman', 0, 1, 0.01);
  uni(su.uGranWarp, gf, 'bükülme', 0, 1, 0.01);
  uni(su.uSuperScale, gf, 'süpergranül ölçek', 0.5, 30, 0.1);
  uni(su.uSuperStrength, gf, 'süpergranül güç', 0, 0.6, 0.01);
  gf.close();

  const pf = sf.addFolder('Lekeler ve faküla');
  uni(su.uSpotScale, pf, 'ölçek', 0.5, 10, 0.01);
  uni(su.uSpotThreshold, pf, 'eşik', 0, 1, 0.005);
  uni(su.uSpotPenumbra, pf, 'penumbra', 0.01, 0.4, 0.005);
  uni(su.uUmbraDark, pf, 'umbra koyuluk', 0, 1, 0.01);
  uni(su.uPenumbraDark, pf, 'penumbra koyuluk', 0, 1, 0.01);
  uni(su.uFaculae, pf, 'faküla', 0, 2, 0.01);
  pf.close();

  const cf = sf.addFolder('Korona');
  const cu = sun.corona.material.uniforms;
  uni(cu.uIntensity, cf, 'yoğunluk', 0, 4, 0.01);
  uni(cu.uFalloff, cf, 'düşüş', 0.5, 6, 0.01);
  uni(cu.uStreamerStrength, cf, 'flamalar', 0, 3, 0.01);
  uni(cu.uStreamerSharpness, cf, 'keskinlik', 0.5, 8, 0.01);
  uni(cu.uFlowSpeed, cf, 'akış hızı', 0, 0.3, 0.001);
  uni(cu.uExtent, cf, 'boyut', 2, 12, 0.1);
  uni(cu.uChromoIntensity, cf, 'kromosfer', 0, 6, 0.01);
  cf.addColor(cu.uColor, 'value').name('renk');
  cf.addColor(cu.uInnerColor, 'value').name('iç renk');
  cf.close();

  const prf = sf.addFolder('Fışkırmalar');
  prf.add(sun.prominences, 'intensity', 0, 10, 0.01).name('yoğunluk');
  prf.add(sun.prominences, 'flowSpeed', 0, 1, 0.001).name('akış hızı');
  prf.add(sun.prominences.group, 'visible').name('görünür');
  prf.close();

  sf.add(sun.light, 'intensity', 0, 20, 0.01).name('ışık şiddeti');

  // ---- Starfield ---------------------------------------------------------------
  const stf = gui.addFolder('Yıldızlar');
  const mu = starfield.sky.material.uniforms;
  uni(mu.uBrightness, stf, 'Samanyolu parlaklık', 0, 4, 0.01);
  uni(mu.uContrast, stf, 'Samanyolu kontrast', 0.5, 2, 0.01);
  uni(mu.uSaturation, stf, 'Samanyolu doygunluk', 0, 2, 0.01);
  uni(mu.uGlow, stf, 'Samanyolu ışıma', 0, 30, 0.1);
  uni(mu.uGlowLod, stf, 'ışıma bulanıklık', 0, 8, 0.1);
  uni(mu.uGlowFloor, stf, 'ışıma tabanı', 0, 0.1, 0.001);
  uni(mu.uNebula, stf, 'nebula', 0, 0.3, 0.001);
  const st = starfield.stars.material.uniforms;
  uni(st.uBrightness, stf, 'yıldız parlaklık', 0, 4, 0.01);
  uni(st.uSizeScale, stf, 'yıldız boyut', 0.2, 3, 0.01);
  uni(st.uTwinkle, stf, 'parıltı', 0, 0.8, 0.01);
  uni(st.uTwinkleSpeed, stf, 'parıltı hızı', 0, 5, 0.01);
  stf.close();

  // ---- Planets ---------------------------------------------------------------------
  /**
   * Instant focus (Phase 4 replaces this with cinematic flights): camera on
   * the day side, at a phase angle that shows the terminator.
   */
  const focus = (id: string, radii = 4, phaseDeg = 50, elevationDeg = 14) => {
    const entry = system.focusables.find((f) => f.id === id);
    if (!entry) return;
    const rig = engine.rig;
    rig.cancelFlight();
    rig.setFocus(entry.body);
    system.highlight(id === 'sun' ? null : id);
    const pos = entry.body.getAbsolutePosition(new Vector3());
    const toSun = pos.lengthSq() > 0 ? pos.clone().negate().normalize() : new Vector3(0, 0, 1);
    toSun.applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(phaseDeg));
    const pose = directionToPose(toSun, entry.body.getRadius() * radii);
    pose.elevation = MathUtils.degToRad(elevationDeg);
    rig.setPose(pose);
  };
  const pf2 = gui.addFolder('Gezegenler');
  const focusState = { odak: 'sun' };
  pf2
    .add(focusState, 'odak', Object.fromEntries(system.focusables.map((f) => [f.name, f.id])))
    .name('odak')
    .onChange((id: string) => focus(id));
  pf2.add(system, 'showOrbits').name('yörüngeler');
  pf2.add(system, 'showBelts').name('kuşaklar');
  const scaleState = { gerçek: false };
  pf2.add(scaleState, 'gerçek').name('gerçek ölçek').onChange((v: boolean) => {
    scale.setMode(v ? 'real' : 'cinematic');
    focus(focusState.odak);
  });
  pf2.add(sunUniforms.uSunIntensity, 'value', 0, 6, 0.01).name('güneş ışığı');
  pf2.add(sunUniforms.uAmbient, 'value', 0, 0.05, 0.0005).name('ortam');
  const earth = system.get('earth');
  if (earth) {
    const ef = pf2.addFolder('Dünya');
    const eu = earth.surfaceMaterial.uniforms;
    uni(eu.uNightIntensity, ef, 'şehir ışıkları', 0, 6, 0.01);
    uni(eu.uSpecIntensity, ef, 'okyanus parlaması', 0, 4, 0.01);
    uni(eu.uSpecPower, ef, 'parlama keskinliği', 10, 600, 1);
    uni(eu.uNormalStrength, ef, 'kabartma', 0, 4, 0.01);
    uni(eu.uCloudShadow, ef, 'bulut gölgesi', 0, 1, 0.01);
    ef.close();
  }
  const af = pf2.addFolder('Atmosferler');
  for (const p of system.planets) {
    if (p.atmosphere) af.add(p.atmosphere, 'intensity', 0, 60, 0.1).name(p.name);
  }
  af.close();

  // ---- Galactic motion ------------------------------------------------------------
  const galf = gui.addFolder('Galaktik hareket');
  galf.add(galactic, 'enabled').name('açık').listen();
  galf.add(galactic, 'trailOpacity', 0, 2, 0.01).name('iz parlaklığı');
  galf.add(galactic, 'dustIntensity', 0, 2, 0.01).name('toz parlaklığı');

  // ---- Camera / floating origin ------------------------------------------------
  const camf = gui.addFolder('Kamera');
  const camState = {
    get distance() {
      return engine.camera.position.distanceTo(engine.rig.controls.target).toFixed(3);
    },
    get origin() {
      const o = engine.origin.origin;
      return `${o.x.toFixed(1)}, ${o.y.toFixed(1)}, ${o.z.toFixed(1)}`;
    },
    get near() {
      return engine.camera.near.toExponential(2);
    },
  };
  camf.add(camState, 'distance').name('odak mesafesi').listen().disable();
  camf.add(camState, 'near').name('near').listen().disable();
  camf.add(camState, 'origin').name('köken').listen().disable();
  camf.close();

  // Preset camera views for visual regression checks (radii from the Sun).
  const view = (name: 'close' | 'limb' | 'mid' | 'far' | 'core') => {
    const rig = engine.rig;
    rig.cancelFlight();
    const R = sun.getRadius();
    const cam = engine.camera;
    const target = sun.getRenderPosition(new Vector3());
    const dir = cam.position.clone().sub(rig.controls.target).normalize();
    if (name === 'core') {
      // Look straight at the galactic centre with the Sun at the frame edge.
      const gc = galacticToScene(0, 0);
      cam.position.copy(target).addScaledVector(gc, -4 * R).setY(target.y + 3 * R);
      rig.controls.target.copy(cam.position).addScaledVector(gc, 50);
      cam.lookAt(rig.controls.target);
      return;
    }
    const dist = { close: 1.9, limb: 1.35, mid: 5.2, far: 120 }[name] * R;
    cam.position.copy(target).addScaledVector(dir, dist);
    rig.controls.target.copy(target);
    if (name === 'close' || name === 'limb') {
      const right = new Vector3().crossVectors(dir, cam.up).normalize();
      rig.controls.target.addScaledVector(right, R * (name === 'limb' ? 0.95 : 0.75));
    }
    cam.lookAt(rig.controls.target);
  };

  // ---- Shell wiring: open state, folders, filter, reset ------------------------------
  const state = loadState();
  const folders = gui.foldersRecursive();
  for (const f of folders) f.open(state.folders.includes(folderPath(f)));
  const persist = () =>
    saveState({
      open: shell.panel.dataset.open === 'true',
      folders: folders.filter((f) => !f._closed).map(folderPath),
    });
  let filtering = false;
  gui.onOpenClose(() => {
    if (!filtering) persist();
  });

  const setOpen = (open: boolean) => {
    shell.panel.dataset.open = String(open);
    shell.toggle.setAttribute('aria-expanded', String(open));
    persist();
  };
  setOpen(state.open);
  shell.toggle.addEventListener('click', () => {
    setOpen(true);
    shell.search.focus({ preventScroll: true });
  });
  (shell.panel.querySelector('[data-close]') as HTMLElement).addEventListener('click', () => {
    setOpen(false);
    shell.toggle.focus();
  });
  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.code === 'F2' || (e.code === 'Backquote' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
      e.preventDefault();
      setOpen(shell.panel.dataset.open !== 'true');
    }
  });
  // Typing in the panel must not fly the camera (W A S D, numbers, G…).
  shell.panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target === shell.search && shell.search.value) {
      shell.search.value = '';
      shell.search.dispatchEvent(new Event('input'));
      e.stopPropagation();
    } else if (e.code !== 'F2' && e.key !== 'Escape') e.stopPropagation();
  });

  // Filter: matching controllers, or whole folders whose title matches.
  const empty = document.createElement('p');
  empty.className = 'dev-empty';
  empty.textContent = 'Eşleşen ayar yok';
  empty.hidden = true;
  shell.body.appendChild(empty);
  let openBeforeFilter: Set<GUI> | null = null;
  shell.search.addEventListener('input', () => {
    const q = shell.search.value.trim().toLocaleLowerCase('tr');
    if (q && !openBeforeFilter) openBeforeFilter = new Set(folders.filter((f) => !f._closed));
    const matches = (s: string) => s.toLocaleLowerCase('tr').includes(q);
    filtering = true;
    const visit = (f: GUI, parentHit: boolean): boolean => {
      const hit = parentHit || (f !== gui && matches(f._title));
      let any = hit;
      for (const c of f.controllers) {
        const show = !q || hit || matches(c._name);
        c.domElement.classList.toggle('dev-hidden', !show);
        any ||= show;
      }
      for (const sub of f.folders) any = visit(sub, hit) || any;
      if (f !== gui) {
        f.domElement.classList.toggle('dev-hidden', !!q && !any);
        if (q && any) f.open();
      }
      return any;
    };
    const any = visit(gui, false);
    empty.hidden = !q || any;
    if (!q && openBeforeFilter) {
      for (const f of folders) f.open(openBeforeFilter.has(f));
      openBeforeFilter = null;
    }
    filtering = false;
  });

  (shell.panel.querySelector('[data-reset]') as HTMLElement).addEventListener('click', () => gui.reset());

  // Expose for console debugging.
  (window as unknown as Record<string, unknown>).__space = { engine, sun, starfield, system, gui, view, focus, nav, galactic, views };
  return gui;
}
