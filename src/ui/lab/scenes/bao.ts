/**
 * Scene 1 of the lab: how the baryon acoustic oscillation scale was imprinted.
 * A semi-analytic version of Eisenstein, Seo & White (2007, ApJ 664, 675), Fig. 1:
 * a point-like adiabatic overdensity at r = 0 whose dark-matter, baryon, photon
 * and neutrino mass profiles r²·δ(r) are followed from z = 10⁵ to today.
 *
 * Shapes and the ~150 Mpc scale come from the cosmology below; amplitudes are
 * representative (see the note in the UI).
 */
import './bao.css';
import { plot, project, type Axis, type Series } from '../plot';
import { num } from '../physics';

// ---------------------------------------------------------------- cosmology

const C_KMS = 299792.458;
const h = 0.677;
const OM = 0.31;
const OB = 0.049;
const OC = OM - OB;
const OG = 2.47e-5 / (h * h); // photons
const OR = OG * (1 + 0.2271 * 3.046); // photons + massless neutrinos
const OL = 1 - OM - OR;
const H0 = 100 * h; // km/s/Mpc
const A_EQ = OR / OM;
const FB = OB / OM; // baryon fraction of the clustering matter
const FC = OC / OM;
const Z_D = 1060; // drag epoch
const R_COEF = (3 * OB) / (4 * OG); // R(z) = R_COEF / (1 + z)
const YR_PER_MPC_KMS = 3.08568e19 / 3.15576e7; // (Mpc / (km/s)) in years

const hubble = (z: number): number => H0 * Math.sqrt(OR * (1 + z) ** 4 + OM * (1 + z) ** 3 + OL);
const soundSpeed = (z: number): number => C_KMS / Math.sqrt(3 * (1 + R_COEF / (1 + z)));

/**
 * Integrals over redshift tabulated in u = ln(1+z): the integrands span many
 * decades in z, so equal steps in u keep a plain trapezoid rule accurate.
 * Each table holds the integral from u up to z = 1e8 (everything earlier is
 * negligible: the light horizon there is ~5·10⁻³ Mpc).
 */
const N_STEPS = 2000;
const U_MAX = Math.log(1e8 + 1);
const DU = U_MAX / N_STEPS;

interface Tables {
  rs: Float64Array; // sound horizon (Mpc)
  chi: Float64Array; // comoving light horizon (Mpc)
  age: Float64Array; // cosmic time (yr)
}

function cumulate(f: (z: number) => number): Float64Array {
  const out = new Float64Array(N_STEPS + 1);
  const g = (i: number): number => {
    const z = Math.exp(i * DU) - 1;
    return f(z) * (1 + z); // dz = (1+z) du
  };
  let prev = g(N_STEPS);
  for (let i = N_STEPS - 1; i >= 0; i--) {
    const cur = g(i);
    out[i] = out[i + 1] + 0.5 * (cur + prev) * DU;
    prev = cur;
  }
  return out;
}

let tables: Tables | null = null;
function getTables(): Tables {
  tables ??= {
    rs: cumulate((z) => soundSpeed(z) / hubble(z)),
    chi: cumulate((z) => C_KMS / hubble(z)),
    age: cumulate((z) => YR_PER_MPC_KMS / ((1 + z) * hubble(z))),
  };
  return tables;
}

function lookup(tab: Float64Array, z: number): number {
  const x = Math.min(Math.max(Math.log(1 + z) / DU, 0), N_STEPS);
  const i = Math.min(Math.floor(x), N_STEPS - 1);
  return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
}

const soundHorizon = (z: number): number => lookup(getTables().rs, z);
const lightHorizon = (z: number): number => lookup(getTables().chi, z);
const cosmicAge = (z: number): number => lookup(getTables().age, z);

/** Scale factor at which the sound horizon equalled `r` (0 if r <= 0). */
function scaleFactorAtSoundHorizon(r: number): number {
  if (r <= 0) return 0;
  const tab = getTables().rs; // decreasing with index
  let lo = 0;
  let hi = N_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab[mid] > r) lo = mid;
    else hi = mid;
  }
  return Math.exp(-(lo + (tab[lo] - r) / (tab[lo] - tab[hi])) * DU);
}

/** Eisenstein & Hu (1998) eq. 26 fitting formula for the sound horizon at drag (Mpc). */
const EH98_RS = (44.5 * Math.log(9.83 / (OM * h * h))) / Math.sqrt(1 + 10 * (OB * h * h) ** 0.75);

// ------------------------------------------------------------------ growth

/** Carroll, Press & Turner (1992) suppression factor g(a) for matter + Λ (g = 1 deep in the matter era). */
function cptSuppression(a: number): number {
  const e = OM / a ** 3 + OL;
  const om = OM / a ** 3 / e;
  const ol = OL / e;
  return (2.5 * om) / (om ** (4 / 7) - ol + (1 + om / 2) * (1 + ol / 70));
}

/** Meszaros solution: growth of dark matter through matter-radiation equality. */
const meszaros = (a: number): number => 1 + (1.5 * a) / A_EQ;

/** Growth factor G(a) for the clustering matter after decoupling (Meszaros × CPT; ∝ a near a_d). */
const growthFactor = (a: number): number => meszaros(a) * cptSuppression(a);

// ---------------------------------------------------------- profile shapes

const R_MAX = 220;
const R_STEP = 0.5;
const NR = Math.round(R_MAX / R_STEP) + 1;
const RADII = Float64Array.from({ length: NR }, (_, i) => i * R_STEP);
const SIGMA0 = 6; // initial Gaussian width (Mpc)
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Abramowitz & Stegun 7.1.26 error function (|error| < 1.5e-7). */
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const normCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));
const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / SQRT_2PI;

/**
 * Adds the mass profile r²·δ of a Gaussian shell (δ ∝ exp(-(r-μ)²/2w²)) with
 * total "mass" ∫r²δ dr = mass. The integral over r ≥ 0 is exact, so a shell
 * sitting at the origin (μ = 0, the initial condition) is also normalised.
 */
function addShell(out: Float64Array, mu: number, w: number, mass: number): void {
  const m = mu / w;
  const integral = w * SQRT_2PI * ((mu * mu + w * w) * normCdf(m) + mu * w * normPdf(m));
  const k = mass / integral;
  for (let i = 0; i < NR; i++) {
    const r = RADII[i];
    const d = (r - mu) / w;
    out[i] += k * r * r * Math.exp(-0.5 * d * d);
  }
}

/** Approximate Silk damping width (Mpc): 8 Mpc at the drag epoch, scaling as r_s^1.5. */
const silkWidth = (z: number): number => Math.max(2, 8 * (soundHorizon(z) / soundHorizon(Z_D)) ** 1.5);

interface Fields {
  dm: Float64Array;
  baryon: Float64Array;
  photon: Float64Array;
  neutrino: Float64Array;
  centralGrowth: number; // dark-matter central amplitude relative to the start
}

const zeros = (): Float64Array => new Float64Array(NR);

/** Neutrinos free-stream from the start: a broad shell at the light horizon, small amplitude. */
function neutrinoShell(z: number): Float64Array {
  const chi = lightHorizon(z);
  const out = zeros();
  addShell(out, chi, Math.hypot(SIGMA0, 0.3 * chi), 0.6);
  return out;
}

/** Before the drag epoch: baryons and photons are one fluid carrying a sound shell. */
function fieldsBeforeDrag(z: number): Fields {
  const a = 1 / (1 + z);
  const D = meszaros(a);
  const rs = soundHorizon(z);
  const w = Math.hypot(SIGMA0, silkWidth(z));
  // Baryons are pressure-supported, so only a modest part follows the deepening
  // dark-matter well at the centre (representative amplitude).
  const centralBaryon = 0.25 * FC * (1 - 1 / D);
  // The shell pulls the dark matter it passes: the wake grows by the extra
  // growth accumulated since the shell was one width further in.
  const aCross = scaleFactorAtSoundHorizon(rs - w);
  const wake = FB * (1 - meszaros(aCross) / D) * (1 - centralBaryon);

  const dm = zeros();
  addShell(dm, 0, SIGMA0, D);
  addShell(dm, rs, w, wake);
  const baryon = zeros();
  addShell(baryon, rs, w, 1 - centralBaryon);
  addShell(baryon, 0, SIGMA0, centralBaryon);
  const photon = zeros();
  addShell(photon, rs, w, 4 / 3); // adiabatic: δ_γ = (4/3) δ_b
  return { dm, baryon, photon, neutrino: neutrinoShell(z), centralGrowth: D };
}

let atDrag: Fields | null = null;

/** After the drag epoch: both matter components are pressureless and converge. */
function fieldsAfterDrag(z: number): Fields {
  atDrag ??= fieldsBeforeDrag(Z_D);
  const d = atDrag;
  const aD = 1 / (1 + Z_D);
  const a = 1 / (1 + z);
  const f = growthFactor(a) / growthFactor(aD);
  const dm = zeros();
  const baryon = zeros();
  for (let i = 0; i < NR; i++) {
    const mean = FC * d.dm[i] + FB * d.baryon[i]; // δ_m at z_d
    const diff = d.baryon[i] - d.dm[i]; // Δ = δ_b - δ_c, frozen
    dm[i] = f * mean - FB * diff;
    baryon[i] = f * mean + FC * diff;
  }
  // Photons leave at c from the stalled shell and fade; they also spread out.
  const dChi = Math.max(lightHorizon(z) - lightHorizon(Z_D), 0);
  const photon = zeros();
  const w = Math.hypot(Math.hypot(SIGMA0, silkWidth(Z_D)), 0.35 * dChi);
  addShell(photon, soundHorizon(Z_D) + dChi, w, (4 / 3) * (aD / a));
  return { dm, baryon, photon, neutrino: neutrinoShell(z), centralGrowth: growthFactor(a) };
}

function fieldsAt(z: number): Fields {
  return z > Z_D ? fieldsBeforeDrag(z) : fieldsAfterDrag(z);
}

// ----------------------------------------------------------- text and units

/** "380 bin yıl", "1,2 milyar yıl" style age. */
function formatAge(years: number): string {
  const sig = (x: number) => x.toLocaleString('tr-TR', { maximumSignificantDigits: 3 });
  if (years < 1e3) return `${sig(years)} yıl`;
  if (years < 1e6) return `${sig(years / 1e3)} bin yıl`;
  if (years < 1e9) return `${sig(years / 1e6)} milyon yıl`;
  return `${sig(years / 1e9)} milyar yıl`;
}

function formatZ(z: number): string {
  const digits = z >= 100 ? 0 : z >= 10 ? 1 : 2;
  return z.toLocaleString('tr-TR', { maximumFractionDigits: digits });
}

function stageCaption(z: number): string {
  if (z > 3400) return 'Işınım çağı: fotonlar baskın, karanlık madde çukuru yavaş derinleşiyor; baryon–foton akışkanı ses dalgası olarak dışa yayılıyor.';
  if (z > Z_D) return 'Madde çağı başladı: karanlık madde çukuru hızla büyüyor; ses dalgası hâlâ yayılıyor (c<sub>s</sub> ≈ c/√3).';
  if (z > 100) return 'Saydamlaşma: baryonlar fotonlardan koptu; ses dalgası ~150 Mpc’de dondu. Fotonlar ışık hızıyla uzaklaşıyor (bugün CMB olarak görüyoruz).';
  return 'Baryonlar karanlık maddenin çukuruna düşüyor, karanlık madde de baryon kabuğuna çekiliyor; iki profil birleşiyor: merkezde büyük tepe, 150 Mpc’de küçük bir iz (BAO). Mavi (karanlık madde) ve pembe (baryon) eğriler giderek üst üste biner: bugün ikisi aynı dağılımda. İzi görmek için “Zayıf yapıları büyüt” kutusunu işaretle.';
}

// ---------------------------------------------------------------------- UI

type Component = 'dm' | 'baryon' | 'photon' | 'neutrino';
const COMPONENTS: { key: Component; cls: string; label: string }[] = [
  { key: 'dm', cls: 's-dm', label: 'Karanlık madde' },
  { key: 'baryon', cls: 's-baryon', label: 'Sıradan madde (baryon)' },
  { key: 'photon', cls: 's-photon', label: 'Fotonlar' },
  { key: 'neutrino', cls: 's-neutrino', label: 'Nötrinolar' },
];

const S_START = 5; // log10(1+z) at the start of time
const CYCLE_SECONDS = 20;
const MIN_FRAME_MS = 33; // ~30 fps for the SVG redraw
const ZOOM = 15;

export function mountBao(container: HTMLElement): void {
  const rD = soundHorizon(Z_D);
  const root = document.createElement('div');
  root.className = 'bao';
  root.innerHTML = `
    <p class="note">Evrenin ilk anında tek bir noktada küçük bir yoğunluk fazlalığı olsun. Karanlık madde basınçsızdır ve olduğu yerde kalır; baryonlar ise fotonlara bağlı olduğundan baryon–foton akışkanı bir ses dalgası gibi dışa yayılır. Saydamlaşmada dalga durur ve geride yaklaşık ${num(rD, 0)} Mpc yarıçaplı bir kabuk bırakır: BAO ölçeği.</p>
    <p class="lab-readout bao-stage" data-stage></p>
    <div data-plot></div>
    <div class="bao-legend">${COMPONENTS.map((c) => `<label class="lab-check bao-leg"><input type="checkbox" data-comp="${c.key}" checked><i class="bao-sw bao-sw-${c.key}"></i>${c.label}</label>`).join('')}</div>
    <div class="lab-acts"><button type="button" class="pill pill-accent" data-play>▶ Oynat</button><button type="button" class="pill" data-rewind>Başa sar</button></div>
    <label class="lab-slider">Zaman <input type="range" min="0" max="${S_START}" step="0.005" data-time aria-label="Zaman (log10(1+z) azalırken ilerler)"><output data-z></output></label>
    <p class="lab-readout" data-readout></p>
    <label class="lab-check"><input type="checkbox" data-zoom> Zayıf yapıları büyüt (dikey eksen ×${ZOOM}; merkezdeki tepe kırpılır)</label>
    <p class="note">Yarı-analitik model: şekiller ve 150 Mpc ölçeği hesaplanıyor; genlikler temsili. Ses ufku r<sub>s</sub> = ∫c<sub>s</sub>dz/H sayısal integralle bulundu (Ω<sub>m</sub> = ${OM}, Ω<sub>b</sub> = ${OB}, h = ${h}); r<sub>d</sub> = ${num(rD, 1)} Mpc. Karşılaştırma: Eisenstein &amp; Hu (1998) uyum formülü ${num(EH98_RS, 0)} Mpc, Planck ≈ 147 Mpc. Silk sönümleme genişliği yaklaşık (8 Mpc · (r<sub>s</sub>/r<sub>d</sub>)<sup>1,5</sup>), nötrino ve çekimle indüklenen izin genlikleri basitleştirilmiştir. Eğriler her karede merkezdeki karanlık madde tepesine göre ölçeklenir; tepenin gerçek büyümesi aşağıdaki satırda yazılıdır.</p>
    <p class="note"><b>Gözlemle bağlantı.</b> Bu ~150 Mpc’lik iz, galaksilerin kümelenmesinde 105 h<sup>−1</sup> Mpc’de bir tepe olarak ölçüldü: SDSS ışıklı kırmızı galaksileri (<a href="https://arxiv.org/abs/astro-ph/0501171" target="_blank" rel="noopener">Eisenstein ve ark. 2005</a>) ve sonrasında DESI. Model için bkz. <a href="https://arxiv.org/abs/astro-ph/0604361" target="_blank" rel="noopener">Eisenstein, Seo &amp; White 2007</a>.</p>`;
  container.replaceChildren(root);

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel) as T;
  const stageEl = q<HTMLElement>('[data-stage]');
  const plotEl = q<HTMLElement>('[data-plot]');
  const playBtn = q<HTMLButtonElement>('[data-play]');
  const slider = q<HTMLInputElement>('[data-time]');
  const zOut = q<HTMLOutputElement>('[data-z]');
  const readout = q<HTMLElement>('[data-readout]');
  const zoomBox = q<HTMLInputElement>('[data-zoom]');
  const checks = [...root.querySelectorAll<HTMLInputElement>('[data-comp]')];

  // Time coordinate s = log10(1+z) runs 5 → 0; the slider shows progress 0 → 5.
  let progress = S_START - Math.log10(1 + Z_D);
  let playing = false;
  let lastTs = 0;
  let lastDraw = 0;
  let raf = 0;

  const xa: Axis = { min: 0, max: R_MAX, label: 'yarıçap r (eş hareketli Mpc)', ticks: [0, 50, 100, 150, 200] };

  function render(): void {
    const z = 10 ** (S_START - progress) - 1;
    const f = fieldsAt(z);
    const peak = Math.max(...f.dm) || 1; // scale to the central dark-matter peak
    const zoom = zoomBox.checked ? ZOOM : 1;
    const ya: Axis = { min: 0, max: 1.45 / zoom, label: 'kütle profili r²·δ (keyfi birim)', ticks: [] };
    const series: Series[] = COMPONENTS.filter((c) => checks.find((k) => k.dataset.comp === c.key)?.checked).map((c) => ({
      kind: 'line',
      x: RADII,
      y: f[c.key].map((v) => v / peak),
      cls: c.cls,
    }));
    const [mx, top] = project(xa, ya, rD, ya.max);
    const bottom = project(xa, ya, rD, 0)[1];
    const mark = `<line class="bao-mark" x1="${mx}" x2="${mx}" y1="${top}" y2="${bottom}"/><text class="bao-mark-label" x="${mx - 4}" y="${top + 11}" text-anchor="end">r_d ≈ ${num(rD, 0)} Mpc</text>`;
    plotEl.innerHTML = plot(xa, ya, series, 'Kütle profili r²·δ ile yarıçap: karanlık madde, baryonlar, fotonlar ve nötrinolar', mark);

    slider.value = String(progress);
    zOut.textContent = `z = ${formatZ(z)}`;
    stageEl.innerHTML = stageCaption(z);
    const horizon = z > Z_D ? soundHorizon(z) : rD;
    readout.innerHTML = `Evren ${formatAge(cosmicAge(z))} yaşında · ses ufku r<sub>s</sub> = ${num(horizon, 0)} Mpc${z > Z_D ? '' : ' (donmuş)'} · karanlık madde merkez tepesi başlangıca göre ×${num(f.centralGrowth, f.centralGrowth < 10 ? 1 : 0)}`;
  }

  function setPlaying(on: boolean): void {
    playing = on;
    playBtn.textContent = on ? '❚❚ Duraklat' : '▶ Oynat';
    cancelAnimationFrame(raf);
    if (on) {
      lastTs = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  // The loop runs only while playing, attached and visible, so a hidden panel costs nothing.
  function tick(ts: number): void {
    if (!root.isConnected || root.offsetParent === null) {
      setPlaying(false);
      return;
    }
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
    lastTs = ts;
    progress = Math.min(progress + (dt * S_START) / CYCLE_SECONDS, S_START);
    if (ts - lastDraw >= MIN_FRAME_MS || progress >= S_START) {
      lastDraw = ts;
      render();
    }
    if (progress >= S_START) {
      setPlaying(false); // stop at z = 0
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  playBtn.addEventListener('click', () => {
    if (!playing && progress >= S_START) progress = 0; // replay from the beginning
    setPlaying(!playing);
  });
  q<HTMLButtonElement>('[data-rewind]').addEventListener('click', () => {
    progress = 0;
    render();
  });
  slider.addEventListener('input', () => {
    progress = Number(slider.value);
    render();
  });
  zoomBox.addEventListener('change', render);
  for (const c of checks) c.addEventListener('change', render);

  render();
}
