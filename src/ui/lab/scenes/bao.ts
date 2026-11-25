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
import { EH98_RS, OB, OM, RADII, R_MAX, Z_D, cosmicAge, fieldsAt, h, soundHorizon } from './baoModel';

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
