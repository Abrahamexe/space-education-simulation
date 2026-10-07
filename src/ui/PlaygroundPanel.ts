import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Plane,
  Points,
  PointsMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { ADD_PRESETS, PLAYGROUND_RATES, SCENARIOS, massInSun, type AddPreset, type MassUnit } from '../config/playground';
import { GM_SUN } from '../playground/nbody';
import { KM_PER_AU } from '../config/astro';
import { julianToDate } from '../core/Time';
import type { Engine } from '../core/Engine';
import type { Playground, LogEntry, FallStatus } from '../playground/Playground';
import { formatNumber as fmt, fmtDays } from '../playground/Playground';
import { icon } from './icons';
import { isTypingOrChord } from './Toolbar';

const AU_DAY_TO_KM_S = KM_PER_AU / 86_400;
/** Drag to velocity: km/s per CSS pixel. */
const KMS_PER_PX = 0.2;
const AU_PER_LY = 63_241.1;

function massLabel(m: number, unit: MassUnit): string {
  const u = unit === 'sun' ? 'M☉' : unit === 'jup' ? 'M♃' : 'M⊕';
  const v = m >= 1e6 ? `${(m / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} milyon` : m >= 1e9 ? '' : fmt(m);
  return m >= 1e9 ? `${(m / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} milyar ${u}` : `${v} ${u}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function duration(days: number): string {
  const y = Math.floor(days / 365.25);
  const d = Math.floor(days - y * 365.25);
  return y > 0 ? `${y.toLocaleString('tr-TR')} yıl ${d} gün` : `${d} gün`;
}

/**
 * Click-and-drag placement in the scene: press on the ecliptic plane to
 * put the body there, drag to give it a velocity (arrow, km/s shown), let
 * go to add it. A click without dragging puts it on a circular orbit round
 * the Sun. Escape cancels. Pointer events are captured so the camera and
 * selection do not react meanwhile.
 */
class Placement {
  private preset: AddPreset | null = null;
  private getMass: () => number = () => 1;
  private massText = '';
  private start: { au: Vector3; abs: Vector3; x: number; y: number } | null = null;
  private readonly ray = new Raycaster();
  private readonly arrow: Line<BufferGeometry, LineBasicMaterial>;
  private readonly dot: Points<BufferGeometry, PointsMaterial>;
  private readonly tip: HTMLElement;
  private doneFn: (() => void) | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly pg: Playground,
  ) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    this.arrow = new Line(g, new LineBasicMaterial({ color: 0xf2b35e, depthTest: false, transparent: true }));
    this.arrow.frustumCulled = false;
    this.arrow.renderOrder = 20;
    const d = new BufferGeometry();
    d.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    this.dot = new Points(d, new PointsMaterial({ color: 0xf2b35e, size: 10, sizeAttenuation: false, depthTest: false, transparent: true }));
    this.dot.frustumCulled = false;
    this.dot.renderOrder = 20;
    this.tip = document.createElement('div');
    this.tip.className = 'pg-tip';
    this.tip.hidden = true;
    document.body.appendChild(this.tip);
    const c = engine.canvas;
    c.addEventListener('pointerdown', this.onDown, { capture: true });
    c.addEventListener('pointermove', this.onMove, { capture: true });
    c.addEventListener('pointerup', this.onUp, { capture: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.preset) {
        e.stopImmediatePropagation();
        this.cancel();
      }
    }, { capture: true });
  }

  get active(): boolean {
    return this.preset !== null;
  }

  begin(preset: AddPreset, getMass: () => number, massText: () => string, done: () => void): void {
    this.preset = preset;
    this.getMass = getMass;
    this.massText = massText();
    this.doneFn = done;
    this.engine.canvas.style.cursor = 'crosshair';
    this.tip.hidden = false;
    this.tip.textContent = `${preset.name} (${this.massText}): ekliptik düzleminde bir yere tıkla, sürükleyerek hız ver. Halkalar uzaklığı gösterir.`;
  }

  cancel(): void {
    this.preset = null;
    this.start = null;
    this.arrow.removeFromParent();
    this.dot.removeFromParent();
    this.tip.hidden = true;
    this.engine.canvas.style.cursor = '';
    this.doneFn?.();
    this.doneFn = null;
  }

  /** Absolute scene point on the ecliptic plane under the cursor. */
  private hit(x: number, y: number): Vector3 | null {
    const r = this.engine.canvas.getBoundingClientRect();
    const ndc = new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.engine.camera);
    const sunRender = this.engine.origin.toRender(new Vector3());
    const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), sunRender);
    const p = this.ray.ray.intersectPlane(plane, new Vector3());
    return p ? this.engine.origin.toAbsolute(p, p) : null;
  }

  private readonly onDown = (e: PointerEvent) => {
    if (!this.preset || e.button !== 0) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const abs = this.hit(e.clientX, e.clientY);
    if (!abs) return;
    this.start = { au: this.pg.sceneToAu(abs), abs, x: e.clientX, y: e.clientY };
    this.engine.world.add(this.arrow, this.dot);
    (this.dot.geometry.getAttribute('position') as BufferAttribute).setXYZ(0, abs.x, abs.y, abs.z);
    this.dot.geometry.getAttribute('position').needsUpdate = true;
    try {
      this.engine.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already released pointer */
    }
  };

  private readonly onMove = (e: PointerEvent) => {
    if (!this.preset) return;
    e.stopImmediatePropagation();
    this.tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
    if (!this.start) return;
    const abs = this.hit(e.clientX, e.clientY) ?? this.start.abs;
    const pos = this.arrow.geometry.getAttribute('position') as BufferAttribute;
    pos.setXYZ(0, this.start.abs.x, this.start.abs.y, this.start.abs.z);
    pos.setXYZ(1, abs.x, abs.y, abs.z);
    pos.needsUpdate = true;
    const px = Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y);
    const r = this.start.au.length();
    const vc = Math.sqrt(GM_SUN / Math.max(r, 1e-6)) * AU_DAY_TO_KM_S;
    const where = r > 6000 ? `${fmt(r / AU_PER_LY)} ışık yılı` : `${fmt(r)} AU`;
    this.tip.textContent = `${this.massText} · ` + (
      px < 6
        ? `Bırak: dairesel yörünge (${fmt(vc)} km/s) · Güneş'e ${where}`
        : `${fmt(px * KMS_PER_PX)} km/s · Güneş'e ${where} (dairesel: ${fmt(vc)} km/s)`);
  };

  private readonly onUp = (e: PointerEvent) => {
    if (!this.preset || !this.start) return;
    e.stopImmediatePropagation();
    const massSun = this.getMass();
    const px = Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y);
    const end = this.hit(e.clientX, e.clientY);
    const pos = this.start.au.clone();
    let vel: Vector3;
    if (px < 6 || !end) {
      // Circular, prograde orbit round the Sun.
      const r = Math.max(pos.length(), 1e-6);
      const vc = Math.sqrt((GM_SUN * (1 + massSun)) / r) * AU_DAY_TO_KM_S;
      vel = new Vector3(-pos.y, pos.x, 0).normalize().multiplyScalar(vc);
    } else {
      const dir = this.pg.sceneToAu(end).sub(pos);
      dir.z = 0;
      vel = dir.normalize().multiplyScalar(px * KMS_PER_PX);
    }
    this.pg.add({ preset: this.preset, massSun, posAu: pos, velKmS: vel });
    this.cancel();
  };
}

/**
 * Playground panel (left): time controls, adding bodies (palette, mass,
 * click-to-place or the numeric form), ready scenarios, the event log and
 * the Earth's state. Shown while the playground is on (body.mode-playground).
 */
export class PlaygroundPanel {
  readonly el: HTMLElement;
  private readonly placement: Placement;
  private preset: AddPreset = ADD_PRESETS[0];
  private unit: MassUnit = ADD_PRESETS[0].unit;
  private readonly q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
  private readonly tab: HTMLButtonElement;
  private unread = 0;

  /** Hide the panel to a small tab (remembered), or bring it back. */
  private setCollapsed(on: boolean): void {
    document.body.classList.toggle('pg-collapsed', on);
    try {
      localStorage.setItem('pg-collapsed', on ? '1' : '0');
    } catch {
      /* private mode: not remembered */
    }
    if (!on) {
      this.unread = 0;
      this.drawTab('');
    }
  }

  private drawTab(last: string): void {
    const badge = this.tab.querySelector('.pg-badge') as HTMLElement;
    badge.hidden = this.unread === 0;
    badge.textContent = String(this.unread);
    const lastEl = this.tab.querySelector('.pg-last') as HTMLElement;
    if (last) lastEl.textContent = last;
    else if (!this.unread) lastEl.textContent = '';
  }

  constructor(
    private readonly engine: Engine,
    private readonly pg: Playground,
  ) {
    this.placement = new Placement(engine, pg);
    const el = document.createElement('aside');
    el.className = 'pg-panel';
    el.setAttribute('aria-label', 'Oyun alanı');
    el.innerHTML = `
      <header class="pg-head">
        <div><p class="pg-kicker">Oyun alanı</p><h2 data-date></h2><p class="pg-sub" data-elapsed></p></div>
        <div class="pg-head-btns">
          <button type="button" class="btn-icon" data-collapse aria-label="Paneli gizle" title="Paneli gizle">${icon('back')}</button>
          <button type="button" class="btn-icon" data-exit aria-label="Oyun alanından çık" title="Çık (P)">${icon('close')}</button>
        </div>
      </header>
      <div class="pg-time">
        <button type="button" class="btn-icon" data-pause aria-label="Durdur">${icon('pause')}</button>
        <div class="pg-rates">${PLAYGROUND_RATES.map((r, i) => `<button type="button" class="chip" data-rate="${i}">${r.label}</button>`).join('')}</div>
        <div class="pg-jumps">
          <button type="button" class="chip" data-jump="365.25">+1 yıl</button>
          <button type="button" class="chip" data-jump="1826.25">+5 yıl</button>
          <button type="button" class="chip" data-jump="36525">+100 yıl</button>
          <button type="button" class="chip" data-reset>Başa dön</button>
        </div>
        <p class="pg-busy" data-busy hidden></p>
        <p class="pg-arrive" data-arrive hidden></p>
      </div>
      <div class="segmented pg-tabs" role="tablist">
        <button type="button" role="tab" data-tab="add" aria-checked="true">Ekle</button>
        <button type="button" role="tab" data-tab="scen" aria-checked="false">Senaryolar</button>
        <button type="button" role="tab" data-tab="log" aria-checked="false">Olaylar</button>
        <button type="button" role="tab" data-tab="earth" aria-checked="false">Gezegenler</button>
      </div>
      <section class="pg-sec" data-sec="add">
        <div class="pg-types">${ADD_PRESETS.map((p, i) => `<button type="button" class="pg-type" data-type="${i}"><span class="pg-sw" style="--sw: rgb(${p.color.map((c) => Math.round(c * 255)).join(',')})"></span><b>${p.name}</b><small>${p.hint}</small></button>`).join('')}</div>
        <label class="pg-field"><span>Kütle</span><span class="pg-row"><input type="number" min="0" step="any" data-mass><select data-unit><option value="sun">Güneş kütlesi</option><option value="jup">Jüpiter kütlesi</option><option value="earth">Dünya kütlesi</option></select></span></label>
        <div class="pg-masses" data-masses></div>
        <button type="button" class="pill pill-accent pg-place" data-place>${icon('target')}<span>Sahneye tıklayarak yerleştir</span></button>
        <details class="pg-form">
          <summary>Sayıyla yerleştir</summary>
          <label class="pg-field"><span>Kütle</span><span class="pg-row"><input type="number" min="0" step="any" data-fmass><select data-funit><option value="sun">Güneş kütlesi</option><option value="jup">Jüpiter kütlesi</option><option value="earth">Dünya kütlesi</option></select></span></label>
          <label class="pg-field"><span>Neyin yanına</span><select data-ref></select></label>
          <label class="pg-field"><span>Uzaklık</span><span class="pg-row"><input type="number" step="any" value="1" data-dist><select data-dunit><option value="au">AU</option><option value="ly">ışık yılı</option></select></span></label>
          <label class="pg-field"><span>Konum açısı (°, 0 = Güneş'ten dışarı)</span><input type="number" step="any" value="0" data-angle></label>
          <label class="pg-field"><span>Ekliptiğin üstünde (AU)</span><input type="number" step="any" value="0" data-height></label>
          <label class="pg-field"><span>Hız</span><select data-vmode><option value="circular">Dairesel yörünge</option><option value="rest">Durgun (referansa göre)</option><option value="custom">Belirli hız</option></select></label>
          <div class="pg-row" data-custom hidden>
            <label class="pg-field"><span>km/s</span><input type="number" step="any" value="20" data-speed></label>
            <label class="pg-field"><span>Yön (°)</span><input type="number" step="any" value="180" data-dir></label>
          </div>
          <button type="button" class="pill pill-accent" data-add>Ekle</button>
          <p class="pg-note" data-formnote></p>
        </details>
        <h3>Eklenenler</h3>
        <ul class="pg-list" data-added></ul>
        <h3>Gerçek bir cismi kaldır</h3>
        <div class="pg-row"><select data-realrm></select><button type="button" class="chip" data-rmreal>Kaldır</button></div>
      </section>
      <section class="pg-sec" data-sec="scen" hidden>
        ${SCENARIOS.map((s, i) => `<button type="button" class="pg-scen" data-scen="${i}"><b>${esc(s.name)}</b><small>${esc(s.text)}</small></button>`).join('')}
      </section>
      <section class="pg-sec" data-sec="log" hidden><ol class="pg-log" data-log></ol></section>
      <section class="pg-sec" data-sec="earth" hidden><dl class="pg-earth" data-earth></dl><h3>Bütün gezegenler</h3><table class="pg-planets" data-planets></table><p class="pg-note">Sıcaklık: Dünya'nın aldığı toplam yıldız ışığından, bugünkü sera etkisiyle (+33 °C) kabaca tahmin. Yaşanabilir bölge: Kopparapu ve ark. 2014. Işık ve kütle çekimi ışık hızıyla yol alır. Pulsar: ~10²⁷ W gama/X (Vela benzeri). Kuasar: Eddington'ın %8'i, ışığının %10'u X ışını. Hasar kuralları kaba, büyüklük mertebesi tahminleridir.</p></section>`;
    this.el = el;
    document.body.appendChild(el);
    // Collapsed: a small tab brings the panel back (with unread events counted).
    this.tab = document.createElement('button');
    this.tab.type = 'button';
    this.tab.className = 'pg-reopen';
    this.tab.setAttribute('aria-label', 'Oyun alanı panelini aç');
    this.tab.innerHTML = `${icon('atom')}<span>Oyun alanı</span><b class="pg-badge" hidden></b><span class="pg-last"></span>`;
    this.tab.addEventListener('click', () => this.setCollapsed(false));
    document.body.appendChild(this.tab);
    try {
      this.setCollapsed(localStorage.getItem('pg-collapsed') === '1');
    } catch {
      this.setCollapsed(false);
    }
    this.wire();
    this.selectType(0);
    pg.onChange(() => this.sync());
    pg.onLog((e) => {
      this.appendLog(e);
      // Hidden panel: count what happened and show the latest on the tab.
      if (document.body.classList.contains('pg-collapsed') && e.type !== 'added') {
        this.unread++;
        this.drawTab(e.text);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (isTypingOrChord(e) || document.body.classList.contains('mode-galaxy')) return;
      if (e.code === 'KeyP') pg.toggle();
    });
  }

  private wire(): void {
    const pg = this.pg;
    const t = this.engine.time;
    this.q('[data-exit]').addEventListener('click', () => pg.exit());
    this.q('[data-collapse]').addEventListener('click', () => this.setCollapsed(true));
    this.q('[data-pause]').addEventListener('click', () => {
      t.togglePause();
      this.sync();
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach((b) =>
      b.addEventListener('click', () => {
        t.setRate(PLAYGROUND_RATES[Number(b.dataset.rate)].days);
        t.paused = false;
        this.sync();
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-jump]').forEach((b) => b.addEventListener('click', () => pg.jump(Number(b.dataset.jump))));
    this.q('[data-reset]').addEventListener('click', () => pg.reset());
    const tabs = [...this.el.querySelectorAll<HTMLButtonElement>('[data-tab]')];
    tabs.forEach((b) =>
      b.addEventListener('click', () => {
        tabs.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        this.el.querySelectorAll<HTMLElement>('[data-sec]').forEach((s) => (s.hidden = s.dataset.sec !== b.dataset.tab));
        if (b.dataset.tab === 'earth') this.syncEarth();
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) => b.addEventListener('click', () => this.selectType(Number(b.dataset.type))));
    // One mass, two editors (top and in the form), kept in step.
    const pairs: [string, string][] = [['[data-mass]', '[data-unit]'], ['[data-fmass]', '[data-funit]']];
    pairs.forEach(([mi, ui], k) => {
      const [om, ou] = pairs[1 - k];
      const mass = this.q<HTMLInputElement>(mi);
      const unit = this.q<HTMLSelectElement>(ui);
      unit.addEventListener('change', () => {
        // Keep the same physical mass in the new unit.
        const m = massInSun(Number(mass.value) || 0, this.unit);
        this.unit = unit.value as MassUnit;
        mass.value = String(+(m / massInSun(1, this.unit)).toPrecision(4));
        this.q<HTMLSelectElement>(ou).value = this.unit;
        this.q<HTMLInputElement>(om).value = mass.value;
      });
      mass.addEventListener('input', () => (this.q<HTMLInputElement>(om).value = mass.value));
    });
    this.q('[data-masses]').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-m]') as HTMLElement | null;
      if (!b) return;
      // The real TON 618 is a quasar (a feeding hole brighter than a galaxy): switch to that card.
      if (b.dataset.as) this.selectType(ADD_PRESETS.findIndex((p) => p.kind === b.dataset.as));
      this.setMass(Number(b.dataset.m));
    });
    this.q('[data-place]').addEventListener('click', () => {
      if (!pg.active) pg.enter();
      const btn = this.q<HTMLButtonElement>('[data-place]');
      btn.setAttribute('aria-pressed', 'true');
      this.placement.begin(this.preset, () => this.massSun(), () => massLabel(Number(this.q<HTMLInputElement>('[data-mass]').value) || 0, this.unit), () => btn.setAttribute('aria-pressed', 'false'));
    });
    const vmode = this.q<HTMLSelectElement>('[data-vmode]');
    vmode.addEventListener('change', () => (this.q('[data-custom]').hidden = vmode.value !== 'custom'));
    this.q('[data-add]').addEventListener('click', () => this.addFromForm());
    this.q('[data-rmreal]').addEventListener('click', () => {
      const id = this.q<HTMLSelectElement>('[data-realrm]').value;
      if (id) pg.remove(id);
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-scen]').forEach((b) => b.addEventListener('click', () => pg.scenario(SCENARIOS[Number(b.dataset.scen)])));
    this.q('[data-added]').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const id = b.dataset.id!;
      if (b.dataset.act === 'rm') pg.remove(id);
      else {
        const f = pg.focusable(id);
        if (f) void this.engine.rig.flyTo(f, { distance: Math.max(f.getRadius() * 12, 1), direction: this.engine.camera.position.clone().sub(this.engine.rig.controls.target).normalize() });
      }
    });
  }

  private massSun(): number {
    return massInSun(Number(this.q<HTMLInputElement>('[data-mass]').value) || 0, this.unit);
  }

  private selectType(i: number): void {
    this.preset = ADD_PRESETS[i];
    this.unit = this.preset.unit;
    this.el.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.type) === i)));
    this.q<HTMLSelectElement>('[data-unit]').value = this.unit;
    this.q<HTMLSelectElement>('[data-funit]').value = this.unit;
    this.setMass(this.preset.mass);
    this.q('[data-masses]').innerHTML = (this.preset.masses ?? [])
      .map(([m, l]) => `<button type="button" class="chip" data-m="${m}"${this.preset.kind === 'bh' && l === 'TON 618' ? ' data-as="quasar" title="Gerçek TON 618 bir kuasardır: Kuasar kartına geçer"' : ''}>${esc(l)}</button>`)
      .join('');
  }

  /** Set the mass (in the preset's unit) in both editors. */
  private setMass(m: number): void {
    this.unit = this.preset.unit;
    for (const [mi, ui] of [['[data-mass]', '[data-unit]'], ['[data-fmass]', '[data-funit]']]) {
      this.q<HTMLInputElement>(mi).value = String(m);
      this.q<HTMLSelectElement>(ui).value = this.unit;
    }
  }

  private addFromForm(): void {
    const pg = this.pg;
    if (!pg.active) pg.enter();
    const num = (s: string) => Number(this.q<HTMLInputElement>(s).value) || 0;
    const mode = this.q<HTMLSelectElement>('[data-vmode]').value;
    const id = pg.addRelative({
      preset: this.preset,
      massSun: this.massSun(),
      ref: this.q<HTMLSelectElement>('[data-ref]').value || 'sun',
      distanceAu: Math.max(num('[data-dist]') * (this.q<HTMLSelectElement>('[data-dunit]').value === 'ly' ? AU_PER_LY : 1), 1e-6),
      angleDeg: num('[data-angle]'),
      heightAu: num('[data-height]'),
      speedKmS: mode === 'circular' ? 'circular' : mode === 'rest' ? 0 : num('[data-speed]'),
      dirDeg: num('[data-dir]'),
    });
    this.q('[data-formnote]').textContent = id ? '' : 'Bu cisim artık yok; başka bir referans seç.';
  }

  private sync(): void {
    const pg = this.pg;
    const t = this.engine.time;
    if (!pg.active) return;
    this.q('[data-date]').textContent = julianToDate(pg.jd).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' });
    this.q('[data-elapsed]').textContent = `Başlangıçtan beri ${duration(Math.max(pg.elapsedDays, 0))}`;
    const pause = this.q<HTMLButtonElement>('[data-pause]');
    pause.innerHTML = icon(t.paused ? 'play' : 'pause');
    pause.setAttribute('aria-label', t.paused ? 'Başlat' : 'Durdur');
    this.el.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach((b) =>
      b.setAttribute('aria-pressed', String(Math.abs(PLAYGROUND_RATES[Number(b.dataset.rate)].days - t.rate) < 1e-6)),
    );
    const ar = this.q('[data-arrive]');
    const st = pg.earthStatus();
    const lines = st.arrivals.map((a) => `${a.name}: ışığı ve çekimi ${fmtDays(a.days)} sonra Dünya'ya ulaşacak`);
    if (st.fall) lines.push(fallText(st.fall));
    ar.hidden = !lines.length;
    if (lines.length) ar.textContent = lines.join(' · ');
    const busy = this.q('[data-busy]');
    busy.hidden = !pg.jumping;
    if (pg.jumping) busy.textContent = `İleri sarılıyor… ${duration(pg.backlogDays)} kaldı`;
    // References and removable real bodies.
    const refs = pg.references();
    const refSel = this.q<HTMLSelectElement>('[data-ref]');
    const rmSel = this.q<HTMLSelectElement>('[data-realrm]');
    const sig = refs.map((r) => r.id).join(',');
    if (refSel.dataset.sig !== sig) {
      const keep = refSel.value;
      refSel.innerHTML = refs.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
      refSel.value = refs.some((r) => r.id === keep) ? keep : 'sun';
      rmSel.innerHTML = refs.filter((r) => !r.id.startsWith('add-')).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
      refSel.dataset.sig = sig;
    }
    const list = this.q('[data-added]');
    const added = pg.added;
    const asig = added.map((a) => a.id + a.feeding).join(',');
    if (list.dataset.sig !== asig) {
      list.innerHTML = added.length
        ? added
            .map(
              (a) => `<li><span class="pg-sw" style="--sw: rgb(${a.preset.color.map((c) => Math.round(c * 255)).join(',')})"></span><span>${esc(a.name)}${a.feeding ? ' · yıldız yutuyor' : ''}<small class="pg-inf" data-inf="${a.id}"></small></span>
              <button type="button" class="btn-icon" data-id="${a.id}" data-act="go" aria-label="${esc(a.name)}: yaklaş" title="Yaklaş">${icon('target')}</button>
              <button type="button" class="btn-icon" data-id="${a.id}" data-act="rm" aria-label="${esc(a.name)}: kaldır" title="Kaldır">${icon('close')}</button></li>`,
            )
            .join('')
        : '<li class="pg-empty">Henüz bir şey eklemedin.</li>';
      list.dataset.sig = asig;
    }
    // What each added body does to the Earth right now.
    list.querySelectorAll<HTMLElement>('[data-inf]').forEach((el) => {
      const f = pg.influence(el.dataset.inf!);
      if (!f) return;
      const bits = [`Güneş'e ${fmt(f.sunAu)} AU`];
      if (f.pullInDays > 0.01) bits.push(`çekimi ${fmtDays(f.pullInDays)} sonra gelir`);
      else bits.push(f.tide >= 0.01 ? `yörüngeleri bozuyor (%${fmt(f.tide * 100)})` : f.sunAu < f.stripNeptuneAu ? 'dış gezegenleri sarsıyor' : `etkisi yok denecek kadar az (Dünya için < ${fmt(f.stripEarthAu)} AU gerek)`);
      if (f.light > 1e-4) bits.push(`ışığı Güneş'in ${fmt(f.light)} katı`);
      const text = bits.join(' · ');
      if (el.textContent !== text) el.textContent = text;
    });
    if (!this.q('[data-sec="earth"]').hidden) this.syncEarth();
  }

  private syncEarth(): void {
    const s = this.pg.earthStatus();
    const dl = this.q('[data-earth]');
    if (!s.alive) {
      dl.innerHTML = '<div><dt>Durum</dt><dd>Dünya artık yok.</dd></div>';
      return;
    }
    const zone = { hz: 'Yaşanabilir bölgede', hot: 'Fazla sıcak: okyanuslar buharlaşır', cold: 'Fazla soğuk: okyanuslar donar', none: '—' }[s.zone];
    const pct = (x: number | null) => (x === null ? '—' : `%${Math.round(x * 100)}`);
    const rows: [string, string][] = [
      ['Durum', zone],
      ['Bütünlük', pct(s.integrity)],
      ['Atmosfer', pct(s.atm)],
      ['Gelgit gerilmesi', s.tide < 1e-4 ? 'yok' : s.tide < 0.03 ? `${s.tide.toExponential(1)} (zararsız)` : `${fmt(s.tide)} (Roche sınırı = 1)`],
      ["Güneş'e uzaklık", `${fmt(s.distanceAu)} AU`],
      ['Aldığı ışık', `${fmt(s.flux * 100)}% (bugün %100)`],
      ['Tahmini ortalama sıcaklık', `${fmt(s.tempC)} °C (bugün ~15 °C)`],
      ['Yörünge', Number.isFinite(s.aAu) ? `a = ${fmt(s.aAu)} AU, e = ${s.e.toFixed(3)}` : "Güneş'e bağlı değil"],
      ['Yıl uzunluğu', Number.isFinite(s.yearDays) ? `${fmt(s.yearDays)} gün` : '—'],
    ];
    if (s.nearest) rows.push(['En yakın eklenen cisim', `${s.nearest.name}: ${fmt(s.nearest.au)} AU`]);
    if (s.radiation)
      rows.push(['Yüksek enerjili ışınım', `Güneş'in X/UV ışınımının ${fmt(s.radiation.ratio)} katı. ${s.radiation.text}`]);
    for (const a of s.arrivals) rows.push(['Yolda', `${a.name}: ${fmtDays(a.days)} sonra ulaşacak`]);
    if (s.fall) rows.push(['Düşüş', fallText(s.fall)]);
    dl.innerHTML = rows.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('');
    // Every planet's state.
    const rowsP = [...this.pg.climate.planets.values()]
      .map(
        (p) => `<tr data-gone="${p.flags.has('gone')}"><td>${esc(p.name)}</td><td>${Math.round(p.T - 273.15).toLocaleString('tr-TR')} °C</td><td>${p.atm === null ? '—' : `%${Math.round(p.atm * 100)}`}</td><td><span class="pg-bar"><i style="width:${Math.round(p.integrity * 100)}%"></i></span></td></tr>`,
      )
      .join('');
    this.q('[data-planets]').innerHTML = `<thead><tr><th>Gezegen</th><th>Sıcaklık</th><th>Atmosfer</th><th>Bütünlük</th></tr></thead><tbody>${rowsP}</tbody>`;
  }

  private appendLog(e: LogEntry): void {
    const ol = this.q('[data-log]');
    if (!this.pg.log.length || this.pg.log.length === 1) ol.innerHTML = '';
    const li = document.createElement('li');
    li.dataset.type = e.type;
    li.innerHTML = `<time>+${duration(Math.max(e.jd - this.pg.startJd, 0))}</time><span>${esc(e.text)}</span>`;
    ol.prepend(li);
    // Important events also flash on the Events tab label.
    if (['collision', 'swallowed', 'disrupted', 'ejected', 'captured', 'hz-exit', 'hz-enter', 'radiation', 'damage', 'arrival'].includes(e.type)) {
      const tab = this.q<HTMLElement>('[data-tab="log"]');
      tab.dataset.alert = 'true';
      window.setTimeout(() => (tab.dataset.alert = 'false'), 2500);
      this.toast(e.text);
    }
  }

  private toasts: HTMLElement | null = null;

  /** Stacked notices at the top (at most three at once). */
  private toast(text: string): void {
    if (!this.toasts) {
      this.toasts = document.createElement('div');
      this.toasts.className = 'pg-toasts';
      this.toasts.setAttribute('role', 'status');
      document.body.appendChild(this.toasts);
    }
    while (this.toasts.children.length >= 3) this.toasts.firstElementChild!.remove();
    const n = document.createElement('div');
    n.className = 'pg-toast';
    n.textContent = text;
    this.toasts.appendChild(n);
    window.setTimeout(() => n.classList.add('out'), 4200);
    window.setTimeout(() => n.remove(), 4800);
  }
}

/** The Solar System's fall towards a heavy body, in one sentence. */
function fallText(f: FallStatus): string {
  const head = Number.isFinite(f.arriveDays)
    ? `Güneş Sistemi bütün olarak ${f.name} yönüne düşüyor`
    : f.bound
      ? `Güneş ile ${f.name} birbirinin çevresinde dolanıyor`
      : `${f.name} Güneş'in yanından geçiyor`;
  const parts = [`${head}: ${fmt(f.distanceAu)} AU uzakta, ${fmt(Math.abs(f.kmS))} km/s ${f.kmS >= 0 ? 'yaklaşıyor' : 'uzaklaşıyor'}`];
  if (f.stripped.length) parts.push(`${f.stripped.slice(0, 4).join(', ')} şu an Güneş'in çekim alanının dışında kalıyor (koparılıyor)`);
  for (const s of f.strips.slice(0, 3)) parts.push(`${s.name} ~${fmtDays(s.days)} sonra Güneş'ten koparılır`);
  if (Number.isFinite(f.arriveDays)) parts.push(`Güneş ~${fmtDays(f.arriveDays)} sonra ${f.name} ile buluşur`);
  else if (f.kmS > 0 && f.closestDays > 0) parts.push(`en yakın geçiş ~${fmtDays(f.closestDays)} sonra, ${fmt(f.closestAu)} AU`);
  return parts.join('; ') + '.';
}
