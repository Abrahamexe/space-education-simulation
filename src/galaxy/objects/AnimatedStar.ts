import {
  AdditiveBlending,
  Color,
  Group,
  MathUtils,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  type PerspectiveCamera,
} from 'three';
import sunData from '../../data/sun.json';
import surfaceVert from '../../shaders/sun/surface.vert?raw';
import surfaceFrag from '../../shaders/sun/surface.frag?raw';
import coronaVert from '../../shaders/deepsky/corona.vert?raw';
import coronaFrag from '../../shaders/sun/corona.frag?raw';
import { SUN_VISUAL as V } from '../../config/visual';
import { Prominences } from '../../bodies/Prominences';
import { Random } from '../../utils/random';
import { temperatureColor } from './common';

const SPHERE = new SphereGeometry(1, 160, 112);
const QUAD = new PlaneGeometry(2, 2);
const SUN_TEFF = 5772;
const FL = V.flares;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * How a star's surface behaves, by type:
 *  - dwarf: red dwarf, a flare star (Proxima, TRAPPIST-1): many spots,
 *    frequent strong flares;
 *  - sunlike: the Sun's own look, recoloured;
 *  - giant: red supergiant (Betelgeuse, UY Scuti): a few huge convection
 *    cells boiling slowly, no spots, faint loops;
 *  - hot: hot star (Sirius A, R136a1): radiative envelope, almost no
 *    granulation, no spots, a thin bluish corona.
 */
export type StarKind = 'dwarf' | 'sunlike' | 'giant' | 'hot';

export function starKind(tempK: number, radiusSun: number, supergiant: boolean): StarKind {
  if (supergiant) return 'giant';
  if (tempK >= 8000) return 'hot';
  if (tempK < 3900 && radiusSun < 0.7) return 'dwarf';
  return 'sunlike';
}

interface Look {
  brightness: number;
  granScale: number;
  granContrast: number;
  granSpeed: number;
  plasmaScale: number;
  plasmaStrength: number;
  plasmaSpeed: number;
  superStrength: number;
  spotThreshold: number;
  flareEvery: [number, number];
  flareIntensity: number;
  flareSize: number;
  prominences: number;
  promIntensity: number;
  corona: number;
  coronaExtent: number;
  /** Visual rotation period (real seconds). */
  spinS: number;
}

const LOOKS: Record<StarKind, Look> = {
  sunlike: {
    brightness: 1.0, granScale: V.granule.scale, granContrast: V.granule.contrast, granSpeed: V.granule.speed,
    plasmaScale: V.plasma.scale, plasmaStrength: V.plasma.strength, plasmaSpeed: V.plasma.speed, superStrength: V.supergranule.strength,
    spotThreshold: V.spots.threshold, flareEvery: [FL.intervalMin, FL.intervalMax], flareIntensity: FL.intensity, flareSize: FL.size,
    prominences: 12, promIntensity: V.prominences.intensity, corona: V.corona.intensity, coronaExtent: V.corona.extent, spinS: 90,
  },
  dwarf: {
    brightness: 1.0, granScale: 80, granContrast: 0.35, granSpeed: 0.2,
    plasmaScale: 14, plasmaStrength: 0.42, plasmaSpeed: 0.06, superStrength: 0.2,
    spotThreshold: 0.3, flareEvery: [3, 8], flareIntensity: 6, flareSize: 0.09,
    prominences: 10, promIntensity: 2.2, corona: 0.7, coronaExtent: 6, spinS: 40,
  },
  giant: {
    brightness: 0.75, granScale: 3.2, granContrast: 0.75, granSpeed: 0.03,
    plasmaScale: 2.4, plasmaStrength: 0.55, plasmaSpeed: 0.012, superStrength: 0.35,
    spotThreshold: 9, flareEvery: [25, 60], flareIntensity: 1.2, flareSize: 0.18,
    prominences: 6, promIntensity: 0.5, corona: 0.35, coronaExtent: 3.2, spinS: 600,
  },
  hot: {
    brightness: 1.35, granScale: 140, granContrast: 0.06, granSpeed: 0.3,
    plasmaScale: 10, plasmaStrength: 0.1, plasmaSpeed: 0.08, superStrength: 0.05,
    spotThreshold: 9, flareEvery: [30, 80], flareIntensity: 1.5, flareSize: 0.05,
    prominences: 0, promIntensity: 0, corona: 0.4, coronaExtent: 4, spinS: 30,
  },
};

/** The Sun's warm palette recoloured to a temperature; hot stars use the blackbody colour. */
function palette(tempK: number): { core: Color; hot: Color; cool: Color } {
  const tc = temperatureColor(tempK);
  const sunTc = temperatureColor(SUN_TEFF);
  const ratio = new Color(tc.r / sunTc.r, tc.g / sunTc.g, tc.b / sunTc.b);
  const norm = (c: Color) => c.multiplyScalar(1 / Math.max(c.r, c.g, c.b, 1e-6));
  const warm = {
    core: norm(new Color(...V.colorCore).multiply(ratio)),
    hot: norm(new Color(...V.colorHot).multiply(ratio)),
    cool: norm(new Color(...V.colorCool).multiply(ratio)).multiplyScalar(0.9),
  };
  const white = {
    core: tc.clone(),
    hot: temperatureColor(tempK * 1.1),
    cool: tc.clone().multiply(new Color(0.85, 0.78, 0.8)),
  };
  const k = MathUtils.smoothstep(tempK, SUN_TEFF, 7800);
  return { core: warm.core.lerp(white.core, k), hot: warm.hot.lerp(white.hot, k), cool: warm.cool.lerp(white.cool, k) };
}

interface Flare {
  dir: Vector3;
  age: number;
}

/**
 * A star animated like the Sun (galaxy view): the solar photosphere shader
 * (granulation, boiling plasma, spots, faculae, flares), the corona and
 * prominence loops, recoloured to its temperature and tuned to its type.
 * Lives in a parent group in AU; `radiusAu` scales the unit-sphere parts.
 */
export class AnimatedStar {
  readonly group = new Group();
  readonly surface: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly spin = new Group();
  private readonly corona: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly prominences: Prominences | null = null;
  private readonly look: Look;
  private readonly rng: Random;
  private readonly flares: Flare[] = [];
  private nextFlareIn: number;
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly axisW = new Vector3();

  constructor(
    private readonly radiusAu: number,
    private readonly auToView: number,
    tempK: number,
    readonly kind: StarKind,
    seed: number,
  ) {
    const L = (this.look = LOOKS[kind]);
    this.rng = new Random(seed);
    this.nextFlareIn = this.rng.range(1, L.flareEvery[1]);
    const pal = palette(tempK);
    const dr = sunData.differentialRotationDegPerDay;
    const band = sunData.activeLatitudeBandDeg;
    this.spin.scale.setScalar(radiusAu);
    this.group.add(this.spin);

    this.surface = new Mesh(
      SPHERE,
      new ShaderMaterial({
        vertexShader: surfaceVert,
        fragmentShader: surfaceFrag,
        uniforms: {
          uTime: { value: 0 },
          // The galaxy view's exposure is brighter than the solar view's.
          uBrightness: { value: V.brightness * L.brightness * 0.55 },
          uColorCore: { value: pal.core },
          uColorHot: { value: pal.hot },
          uColorCool: { value: pal.cool },
          uLimbExp: { value: new Vector3(...V.limbExponents) },
          uGranScale: { value: L.granScale },
          uGranSpeed: { value: L.granSpeed },
          uGranContrast: { value: L.granContrast },
          uGranFine: { value: V.granule.fineWeight },
          uGranWarp: { value: V.granule.warp },
          uSuperScale: { value: kind === 'giant' ? 1.6 : V.supergranule.scale },
          uSuperStrength: { value: L.superStrength },
          uSpotScale: { value: V.spots.scale },
          uSpotThreshold: { value: L.spotThreshold },
          uSpotPenumbra: { value: V.spots.penumbraWidth },
          uUmbraDark: { value: V.spots.umbraDarkness },
          uPenumbraDark: { value: V.spots.penumbraDarkness },
          uSpotTime: { value: new Vector2() },
          uSpotDays: { value: new Vector2() },
          uSpotMix: { value: 0.5 },
          uDiffRot: { value: new Vector3(dr.A, dr.B, dr.C) },
          uActiveBand: { value: new Vector2(MathUtils.degToRad(band[0]), MathUtils.degToRad(band[1])) },
          uFaculae: { value: kind === 'hot' ? 0 : V.faculae.strength },
          uPlageDisc: { value: kind === 'hot' ? 0 : V.faculae.discStrength },
          uPlasmaScale: { value: L.plasmaScale },
          uPlasmaSpeed: { value: L.plasmaSpeed },
          uPlasmaStrength: { value: L.plasmaStrength },
          uFlares: { value: Array.from({ length: FL.maxActive }, () => new Vector4()) },
          uFlareSize: { value: L.flareSize },
          uFlareIntensity: { value: L.flareIntensity },
          uFlareColor: { value: new Color(...FL.color).lerp(pal.hot, 0.4) },
        },
      }),
    );
    this.surface.frustumCulled = false;
    this.spin.add(this.surface);

    if (L.prominences > 0) {
      this.prominences = new Prominences({
        count: L.prominences,
        intensity: L.promIntensity,
        color: new Color(...V.prominences.color).lerp(pal.cool, 0.35),
        seed,
      });
      this.spin.add(this.prominences.group);
    }

    const c = V.corona;
    this.corona = new Mesh(
      QUAD,
      new ShaderMaterial({
        vertexShader: coronaVert,
        fragmentShader: coronaFrag,
        uniforms: {
          uTime: { value: 0 },
          uAxis: { value: this.axisW },
          uExtent: { value: L.coronaExtent },
          uLimbRadius: { value: 1 },
          uIntensity: { value: L.corona },
          uFalloff: { value: c.falloff },
          uStreamerStrength: { value: kind === 'giant' ? 0.4 : c.streamerStrength },
          uStreamerSharpness: { value: c.streamerSharpness },
          uFlowSpeed: { value: c.flowSpeed },
          uColor: { value: new Color(...c.color).lerp(pal.core, 0.6) },
          uInnerColor: { value: new Color(...c.innerColor).lerp(pal.hot, 0.6) },
          uChromoColor: { value: new Color(...c.chromosphereColor).lerp(pal.cool, 0.5) },
          uChromoIntensity: { value: kind === 'hot' ? 0.3 : c.chromosphereIntensity },
          uSwirl: { value: 0 },
          uBreath: { value: 1 },
          // Coronal arcades read as rings on other scales: subtle, none on giants / hot stars.
          uLoopStrength: { value: kind === 'hot' || kind === 'giant' ? 0 : c.loopStrength * 0.4 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.corona.frustumCulled = false;
    this.corona.renderOrder = 10;
    this.group.add(this.corona);
  }

  private lastElapsed = -1;

  /**
   * Per frame. `elapsed` is the galaxy view's animation clock (stops when
   * paused); the step is taken from it, not from the sped-up orbit time.
   */
  update(_dt: number, elapsed: number, camera: PerspectiveCamera): void {
    const L = this.look;
    const dt = this.lastElapsed < 0 ? 0 : Math.min(Math.max(elapsed - this.lastElapsed, 0), 0.1);
    this.lastElapsed = elapsed;
    this.spin.rotation.y = ((elapsed / L.spinS) % 1) * Math.PI * 2;
    // Spots evolve on a pseudo day clock (the Sun's crossfaded wrap).
    const days = elapsed * 0.4;
    const period = V.spots.wrapPeriodDays;
    const f = (((days / period) % 1) + 1) % 1;
    const su = this.surface.material.uniforms;
    su.uTime.value = elapsed;
    (su.uSpotDays.value as Vector2).set(f * period, ((f + 0.5) % 1) * period);
    (su.uSpotTime.value as Vector2).set(f * period * V.spots.evolutionPerDay, ((f + 0.5) % 1) * period * V.spots.evolutionPerDay + 17);
    su.uSpotMix.value = 1 - Math.abs(2 * f - 1);

    // View-dependent parts, camera-relative.
    this.group.updateMatrixWorld(true);
    const center = this.tmp.setFromMatrixPosition(this.group.matrixWorld);
    const rView = this.radiusAu * this.auToView;
    const dist = center.distanceTo(camera.position);
    const k = Math.min(rView / Math.max(dist, 1e-30), 0.999);
    const cu = this.corona.material.uniforms;
    cu.uLimbRadius.value = rView / Math.sqrt(1 - k * k);
    cu.uTime.value = elapsed;
    cu.uSwirl.value = (elapsed * V.corona.swirlSpeed) % (Math.PI * 2);
    cu.uBreath.value = 1 + V.corona.breathAmp * Math.sin((elapsed * Math.PI * 2) / V.corona.breathPeriodS);
    this.axisW.set(0, 1, 0).transformDirection(this.spin.matrixWorld);

    this.spin.getWorldQuaternion(this.tmpQ).invert();
    const localView = this.tmp2.copy(camera.position).sub(center).applyQuaternion(this.tmpQ).normalize();
    if (this.prominences) {
      this.prominences.sunCenterV.value.copy(center).applyMatrix4(camera.matrixWorldInverse);
      this.prominences.sunRadius.value = rView;
      this.prominences.localViewDir.copy(localView);
      this.prominences.update(dt, elapsed);
    }
    this.updateFlares(dt, localView);
  }

  private updateFlares(dt: number, localView: Vector3): void {
    const L = this.look;
    const slots = this.surface.material.uniforms.uFlares.value as Vector4[];
    for (let i = this.flares.length - 1; i >= 0; i--) {
      this.flares[i].age += dt;
      if (this.flares[i].age > FL.riseS + FL.decayS * 4) this.flares.splice(i, 1);
    }
    this.nextFlareIn -= dt;
    if (this.nextFlareIn <= 0 && !reducedMotion()) {
      this.nextFlareIn = this.rng.range(L.flareEvery[0], L.flareEvery[1]);
      if (this.flares.length < FL.maxActive) {
        for (let t = 0; t < 12; t++) {
          const lat = MathUtils.degToRad(this.rng.range(5, 40)) * (this.rng.next() < 0.5 ? -1 : 1);
          const lon = this.rng.range(0, Math.PI * 2);
          const v = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
          if (v.dot(localView) > FL.minFacing) {
            this.flares.push({ dir: v, age: 0 });
            break;
          }
        }
      }
    }
    for (let i = 0; i < slots.length; i++) {
      const fl = this.flares[i];
      if (!fl) {
        slots[i].w = 0;
        continue;
      }
      const rise = Math.min(1, fl.age / FL.riseS);
      const env = fl.age < FL.riseS ? 1 - Math.pow(1 - rise, 3) : Math.exp(-(fl.age - FL.riseS) / FL.decayS);
      slots[i].set(fl.dir.x, fl.dir.y, fl.dir.z, env);
    }
  }
}
