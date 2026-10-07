import { MathUtils } from 'three';
import { L_EDD_PER_SUN } from '../config/playground';
import { C_AU_DAY, GM_SUN } from './nbody';
import type { BodyMeta } from './physics.worker';

/**
 * What the playground's light, radiation and tides do to the planets.
 *
 * Light and radiation travel at c: a source's light reaches a planet only
 * once the front from where (and when) it started shining has arrived, a
 * planet sees each source as it was d/c ago (a flare reaches far planets
 * later), and a source that vanishes keeps shining on a planet until the
 * news of its end has got there.
 * Sources: stars (L), a quasar or a feeding black hole (its disc: a peak
 * that fades as t^-5/3 for a torn-apart star), pulsars (γ/X only).
 *
 * Per planet, from the light received S (S⊕) and X-ray/EUV dose X
 * (relative to what the Earth gets from the Sun today):
 *  - temperature: heads for equilibrium 255 K·S^¼ (Bond albedo 0.3) plus a
 *    greenhouse term that shrinks with the atmosphere (Earth +33 K, Venus
 *    +500 K) on the radiative time C / 4σT³ (C: heat capacity per m², the
 *    oceans' for the Earth): about a year to cool at today's 15 °C, days to
 *    heat under a thousand Suns. Impacts add heat at once;
 *  - mass loss: energy-limited escape (Watson et al. 1981; Erkaev et al.
 *    2007), ṁ = π R³ (ε_X F_X + ε_b F_bol) / (G M): X-rays and extreme UV
 *    heat the upper atmosphere, which flows off (ε_X = 0.15); above ~2000 K
 *    rock itself starts to vaporise and the starlight drives that vapour
 *    off as well (ε_b up to 1 %). The atmosphere goes first, then the body;
 *    integrity is the share of the body still there. Under a thousand Suns
 *    the Earth loses its air in months and its oceans boil, but the planet
 *    itself would take ~10⁵–10⁶ years to evaporate;
 *  - tides τ = 2 (M/m)(R/d)³ stretch the body (shown) and shake it; tearing
 *    it apart is the simulation's Roche-limit disruption;
 *  - impacts: heat, air blown off, shattering above Q*.
 * Order-of-magnitude physics meant to show what would happen.
 */

const XUV_SUN_FRACTION = 3.4e-6; // the Sun's X-ray + EUV share of its light (4.6 mW/m² of 1361 W/m²)
const PULSAR_HE_WM2_AT_1AU = 3550;
const SUN_XUV_WM2 = 4.6e-3;
const GREENHOUSE: Record<string, number> = { earth: 33, venus: 500, mars: 5 };
const SIGMA = 5.670374e-8;
const SECONDS_PER_YEAR = 3.15576e7;
/** Heat capacity per m² (J/m²/K): the Earth's ~70 m ocean mixed layer, a gas giant's deep weather layer, rock. */
function heatCapacity(id: string, mu: number): number {
  if (id === 'earth') return 3e8;
  return mu > GM_SUN * 1e-5 ? 1e9 : 3e7;
}
/** Specific impact energy (J/kg) that shatters a body (catastrophic disruption, Earth-mass ~ 10⁷–10⁸). */
function shatterEnergy(mu: number): number {
  return 3e7 * Math.pow(mu / (GM_SUN * 3.003e-6), 0.5);
}
const HAS_AIR = new Set(['venus', 'earth', 'mars', 'titan', 'pluto']);
/** Atmosphere masses, kg. */
const ATM_KG: Record<string, number> = { venus: 4.8e20, earth: 5.15e18, mars: 2.5e16, pluto: 1e13, titan: 9e18 };
const M_SUN_KG = 1.98847e30;
const M_PER_AU = 1.495978707e11;
const G_SI = 6.674e-11;
const EPS_XUV = 0.15;

export interface PlanetState {
  id: string;
  name: string;
  T: number;
  S: number;
  X: number;
  tau: number;
  /** Index (in the current state) of the body raising the strongest tide; -1: none. */
  tideFrom: number;
  /** 0..1 (null: no atmosphere to speak of). */
  atm: number | null;
  /** Mass flowing off, kg/s (energy-limited escape). */
  mdot: number;
  /** Where the radiation driving it comes from (sim frame, AU); null: none. */
  windFrom: [number, number, number] | null;
  integrity: number;
  heat: number;
  flags: Set<string>;
}

export interface Source {
  id: string;
  name: string;
  /** L☉ of light emitted at time `te` (jd). */
  lumAt: (te: number) => number;
  /** Share of it in X-rays / EUV. */
  xFrac: number;
  /** Pulsar: high-energy flux at 1 AU (W/m²). */
  pulsarWm2: number;
  startJd: number;
  /** Where it was when it started shining (AU, sim frame); null: always there. */
  startPos: [number, number, number] | null;
  /** Index into the current state; -1 once it has gone (see endJd). */
  index: number;
  /** Gone (removed, swallowed, torn apart): when and where its light stopped. */
  endJd?: number;
  endPos?: [number, number, number];
}

export interface Arrival {
  source: string;
  days: number;
}

export class Climate {
  readonly planets = new Map<string, PlanetState>();
  private lastJd = -1;
  private sAvg = new Map<string, number>();
  private earthInHz = true;
  private readonly arrived = new Set<string>();
  /** Gone sources whose last light has passed everybody. */
  private readonly expired = new Set<string>();
  /** Impacts waiting to be applied (body id → J/kg). */
  private readonly impacts = new Map<string, number>();

  /** A collision delivered `perKg` J/kg to body `id`. */
  impact(id: string, perKg: number): void {
    this.impacts.set(id, (this.impacts.get(id) ?? 0) + perKg);
  }

  reset(): void {
    this.impacts.clear();
    this.expired.clear();
    this.planets.clear();
    this.lastJd = -1;
    this.sAvg.clear();
    this.earthInHz = true;
    this.arrived.clear();
  }

  /** Luminous / radiating bodies right now. `tempOf` gives an added star's temperature. */
  sources(meta: BodyMeta[], alive: Uint8Array, pos: Float64Array, jd: number, pulsarIds: Set<string>, tempOf: (id: string) => number): Source[] {
    const out: Source[] = [];
    meta.forEach((m, i) => {
      // A body that is gone keeps shining outward from where and when it
      // ended (the simulation records both) until the news has passed everyone.
      const gone = !alive[i];
      if (gone && (m.goneJd === null || !m.gonePos || this.expired.has(m.id))) return;
      const p: [number, number, number] = gone ? m.gonePos! : [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      const src = this.sourceOf(m, i, p, pulsarIds, tempOf);
      if (!src) return;
      if (gone) {
        src.index = -1;
        src.endJd = m.goneJd!;
        src.endPos = m.gonePos!;
        // Dark everywhere once the news has passed every live body.
        const front = C_AU_DAY * (jd - m.goneJd!);
        let lit = false;
        meta.forEach((_, k) => {
          if (alive[k] && Math.hypot(pos[k * 3] - p[0], pos[k * 3 + 1] - p[1], pos[k * 3 + 2] - p[2]) > front) lit = true;
        });
        if (!lit) {
          this.expired.add(m.id);
          return;
        }
      }
      out.push(src);
    });
    return out;
  }

  /** The light a body gives (null: none), positioned at `p`. */
  private sourceOf(m: BodyMeta, i: number, p: [number, number, number], pulsarIds: Set<string>, tempOf: (id: string) => number): Source | null {
    const start = m.addJd ?? -Infinity;
    const at = m.addPos;
    if (m.id === 'sun') return { id: m.id, name: m.name, lumAt: () => 1, xFrac: XUV_SUN_FRACTION, pulsarWm2: 0, startJd: -Infinity, startPos: null, index: i };
    if ((m.kind === 'star' || m.kind === 'wd') && m.lum > 0) {
      const T = tempOf(m.id);
      const L = m.lum;
      return { id: m.id, name: m.name, lumAt: () => L, xFrac: T > 10_000 ? 1e-4 : XUV_SUN_FRACTION, pulsarWm2: 0, startJd: start, startPos: at, index: i };
    }
    if (m.kind === 'bh') {
      // A quasar's steady disc plus a feeding black hole's flare (t^-5/3),
      // each seen as it was when the light left.
      const steady = m.lum;
      const feedLum = m.feeding ? m.feedLum : 0;
      const feedJd = m.feedJd;
      if (steady <= 0 && feedLum <= 0) return null;
      const lumAt = (te: number) => steady + (feedLum > 0 && te >= feedJd ? feedLum * Math.pow(1 + (te - feedJd) / 30, -5 / 3) : 0);
      // A quiet hole starts shining where it began to feed.
      const fresh = steady <= 0;
      return { id: m.id, name: m.name, lumAt, xFrac: 0.1, pulsarWm2: 0, startJd: fresh ? feedJd : start, startPos: fresh ? p : at, index: i };
    }
    if (pulsarIds.has(m.id)) return { id: m.id, name: m.name, lumAt: () => 0, xFrac: 0, pulsarWm2: PULSAR_HE_WM2_AT_1AU, startJd: start, startPos: at, index: i };
    return null;
  }

  /**
   * Light of `src` at body `i` now: where it was seen from and the
   * luminosity it had when the light left; null if none is arriving.
   */
  received(src: Source, i: number, pos: Float64Array, jd: number): { r2: number; lum: number } | null {
    if (this.delay(src, i, pos, jd) > 0) return null;
    const j = src.index;
    const p = src.endPos ?? [pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]];
    const r2 = Math.max((pos[i * 3] - p[0]) ** 2 + (pos[i * 3 + 1] - p[1]) ** 2 + (pos[i * 3 + 2] - p[2]) ** 2, 1e-12);
    const te = jd - Math.sqrt(r2) / C_AU_DAY;
    // Gone: dark once the news has arrived.
    if (src.endJd !== undefined && te >= src.endJd) return null;
    return { r2, lum: src.lumAt(te) };
  }

  /** Days until a source's light reaches body `i` (0: arrived). */
  delay(src: Source, i: number, pos: Float64Array, jd: number): number {
    if (!src.startPos) return 0;
    const d = Math.hypot(pos[i * 3] - src.startPos[0], pos[i * 3 + 1] - src.startPos[1], pos[i * 3 + 2] - src.startPos[2]);
    return Math.max(0, d / C_AU_DAY - (jd - src.startJd));
  }

  /**
   * Advance every planet's state to `jd`. Returns event texts and the ids
   * of planets destroyed this time.
   */
  step(meta: BodyMeta[], alive: Uint8Array, pos: Float64Array, jd: number, sources: Source[]): { events: { text: string; type: string; jd?: number }[]; gone: { id: string; text: string }[] } {
    const events: { text: string; type: string; jd?: number }[] = [];
    const gone: { id: string; text: string }[] = [];
    const dtY = this.lastJd < 0 ? 0 : Math.max(0, jd - this.lastJd) / 365.25;
    this.lastJd = jd;
    const heavy = meta.map((m, i) => ({ m, i })).filter(({ m, i }) => alive[i] && m.mu > GM_SUN * 1e-3);
    meta.forEach((m, i) => {
      if (!alive[i] || (m.kind !== 'planet' && m.kind !== 'dwarf')) return;
      let st = this.planets.get(m.id);
      if (!st) {
        st = { id: m.id, name: m.name, T: 0, S: 0, X: 0, tau: 0, tideFrom: -1, mdot: 0, windFrom: null, atm: HAS_AIR.has(m.id) ? 1 : null, integrity: 1, heat: 0, flags: new Set() };
        this.planets.set(m.id, st);
      }
      // Light and radiation that have arrived.
      let S = 0;
      let X = 0;
      let strongest = 0;
      let windFrom: [number, number, number] | null = null;
      for (const src of sources) {
        const got = this.received(src, i, pos, jd);
        if (!got) continue;
        const { r2, lum } = got;
        S += lum / r2;
        const x = (lum * src.xFrac) / r2 / XUV_SUN_FRACTION + src.pulsarWm2 / r2 / SUN_XUV_WM2;
        X += x;
        if (x > strongest) {
          strongest = x;
          const j = src.index;
          windFrom = src.endPos ?? [pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]];
        }
        if (m.id === 'earth' && src.startPos && !this.arrived.has(src.id)) {
          this.arrived.add(src.id);
          // When it really arrived (this frame may have covered a long jump).
          const travel = Math.hypot(pos[i * 3] - src.startPos[0], pos[i * 3 + 1] - src.startPos[1], pos[i * 3 + 2] - src.startPos[2]) / C_AU_DAY;
          if (travel > 3) events.push({ type: 'arrival', jd: src.startJd + travel, text: `${src.name}: ışığı ${fmtDays(travel)} yol alıp Dünya'ya ulaştı.` });
        }
      }
      // Tidal stress from the heavy bodies whose pull has arrived.
      let tau = 0;
      let tideFrom = -1;
      for (const h of heavy) {
        if (h.i === i || h.m.mu <= m.mu) continue;
        const ap = h.m.addPos;
        if (ap && h.m.addJd !== null && Math.hypot(pos[i * 3] - ap[0], pos[i * 3 + 1] - ap[1], pos[i * 3 + 2] - ap[2]) > C_AU_DAY * (jd - h.m.addJd)) continue;
        const d = Math.hypot(pos[i * 3] - pos[h.i * 3], pos[i * 3 + 1] - pos[h.i * 3 + 1], pos[i * 3 + 2] - pos[h.i * 3 + 2]);
        const tk = 2 * (h.m.mu / Math.max(m.mu, 1e-30)) * (m.radius / d) ** 3;
        if (tk > tau) {
          tau = tk;
          tideFrom = h.i;
        }
      }
      const atm = st.atm ?? 0;
      const Teq = Math.max(255 * Math.pow(S, 0.25) + (GREENHOUSE[m.id] ?? 0) * atm, m.kind === 'planet' && m.mu > GM_SUN * 1e-5 ? 60 : 30);
      // Thermal inertia: relax towards equilibrium on the radiative time.
      let T = st.T > 0 ? st.T : Teq;
      const hot = Math.max(T, Teq);
      const tauTh = heatCapacity(m.id, m.mu) / (4 * SIGMA * hot * hot * hot);
      T = Teq + (T - Teq) * Math.exp((-dtY * SECONDS_PER_YEAR) / tauTh);
      // An impact: heat at once (≈1 kJ/kg per K of rock), air blown off, the body maybe shattered.
      const hitE = this.impacts.get(m.id);
      if (hitE) {
        this.impacts.delete(m.id);
        const dT = Math.min(hitE / 1200, 6000);
        T += dT;
        if (st.atm !== null) st.atm *= Math.exp(-hitE / 2e6);
        st.integrity = MathUtils.clamp(st.integrity - hitE / shatterEnergy(m.mu), 0, 1);
        if (dT > 300)
          events.push({
            type: 'damage',
            text: dT > 1500 ? `Çarpışma ${m.name} yüzeyini eritti: gezegen bir magma okyanusuyla kaplandı (yaklaşık +${Math.round(dT).toLocaleString('tr-TR')} °C).` : `Çarpışma ${m.name} yüzeyini ısıttı (yaklaşık +${Math.round(dT).toLocaleString('tr-TR')} °C).`,
          });
      }
      st.S = S;
      st.X = X;
      st.tau = tau;
      st.tideFrom = tideFrom;
      st.T = T;
      // Mass loss (energy-limited escape): the air first, then the body.
      const kg = (m.mu / GM_SUN) * M_SUN_KG;
      const R = m.radius * M_PER_AU;
      const epsBol = 0.01 * MathUtils.clamp((T - 2000) / 2000, 0, 1);
      const mdot = kg > 0 ? (Math.PI * R * R * R * (EPS_XUV * X * SUN_XUV_WM2 + epsBol * S * 1361)) / (G_SI * kg) : 0;
      let lost = mdot * dtY * SECONDS_PER_YEAR;
      if (st.atm !== null && st.atm > 0) {
        const air = st.atm * (ATM_KG[m.id] ?? 1e16);
        const fromAir = Math.min(air, lost);
        st.atm = MathUtils.clamp((air - fromAir) / (ATM_KG[m.id] ?? 1e16), 0, 1);
        lost -= fromAir;
      }
      if (kg > 0) st.integrity = MathUtils.clamp(st.integrity - lost / kg, 0, 1);
      st.mdot = mdot;
      st.windFrom = windFrom;
      st.heat = MathUtils.smoothstep(T, 500, 2200);

      const once = (flag: string, text: string, type = 'damage') => {
        if (st!.flags.has(flag)) return;
        st!.flags.add(flag);
        events.push({ type, text });
      };
      if (m.id === 'earth' && atm > 0.1 && T > 373) once('boil', "Dünya'nın okyanusları kaynıyor; su buharı atmosferi dolduruyor.");
      if (m.id === 'earth' && T < 240) once('freeze', 'Dünya donuyor: okyanuslar buz tuttu.');
      if (T > 1400 && m.kind !== 'planet') once('melt', `${m.name} yüzeyi eriyor.`);
      if (T > 1400 && m.kind === 'planet' && m.mu < GM_SUN * 1e-5) once('melt', `${m.name}: yüzey eriyor, lav okyanusuna dönüşüyor.`);
      if (st.atm !== null && st.atm < 0.5) once('atm50', `${m.name} atmosferinin yarısını kaybetti.`);
      if (st.atm !== null && st.atm <= 0.02) once('atm0', `${m.name} atmosferini tamamen kaybetti; yüzey uzaya açık.`);
      if (tau > 0.05) once('tide', `${m.name}: gelgit kuvvetleri depremleri ve volkanları tetikliyor; gezegen esneyip ısınıyor.`);
      if (mdot > 1e9) once('wind', `${m.name}: ışınım ${m.id === 'earth' || HAS_AIR.has(m.id) ? 'atmosferini' : 'yüzeyini'} uzaya üflüyor; arkasında bir gaz kuyruğu uzanıyor (saniyede ~${fmtMass(mdot)}).`);
      if (st.integrity < 0.5) once('half', `${m.name} ağır hasar aldı (bütünlük %${Math.round(st.integrity * 100)}).`);
      if (st.integrity <= 0 && !st.flags.has('gone')) {
        st.flags.add('gone');
        gone.push({
          id: m.id,
          text: hitE && hitE > shatterEnergy(m.mu) * 0.5 ? `${m.name} çarpışmayla paramparça oldu.` : T > 2000 ? `${m.name} tamamen buharlaşıp uzaya dağıldı.` : `${m.name} ışınımla aşınıp dağıldı.`,
        });
      }

      // The Earth's zone, on the year-averaged light (no flicker on eccentric orbits).
      if (m.id === 'earth') {
        const k = Math.min(1, dtY);
        const avg = this.sAvg.has('earth') ? this.sAvg.get('earth')! + (S - this.sAvg.get('earth')!) * k : S;
        this.sAvg.set('earth', avg);
        const inHz = this.earthInHz ? avg >= 0.36 * 0.96 && avg <= 1.11 * 1.04 : avg >= 0.36 && avg <= 1.11;
        if (inHz !== this.earthInHz) {
          this.earthInHz = inHz;
          events.push({
            type: inHz ? 'hz-enter' : 'hz-exit',
            text: inHz ? 'Dünya yeniden yaşanabilir bölgede.' : avg > 1.11 ? 'Dünya yaşanabilir bölgeden çıktı: fazla sıcak.' : 'Dünya yaşanabilir bölgeden çıktı: fazla soğuk.',
          });
        }
      }
    });
    return { events, gone };
  }
}

/** "3 milyon ton" style mass. */
function fmtMass(kg: number): string {
  const t = kg / 1000;
  if (t >= 1e9) return `${Math.round(t / 1e9).toLocaleString('tr-TR')} milyar ton`;
  if (t >= 1e6) return `${Math.round(t / 1e6).toLocaleString('tr-TR')} milyon ton`;
  if (t >= 1e3) return `${Math.round(t / 1e3).toLocaleString('tr-TR')} bin ton`;
  return `${Math.round(t).toLocaleString('tr-TR')} ton`;
}

/** "4 yıl 87 gün" / "12 gün" / "5 saat". */
export function fmtDays(days: number): string {
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} saat`;
  const y = Math.floor(days / 365.25);
  const d = Math.round(days - y * 365.25);
  return y > 0 ? `${y.toLocaleString('tr-TR')} yıl ${d} gün` : `${d} gün`;
}

/** Quasar luminosity for a black-hole mass (L☉). */
export function quasarLuminosity(massSun: number, eddington: number): number {
  return eddington * L_EDD_PER_SUN * massSun;
}
