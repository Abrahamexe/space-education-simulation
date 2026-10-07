import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineLoop,
  MathUtils,
  Matrix3,
  Matrix4,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Quaternion,
  type PlaneGeometry,
} from 'three';
import planetVert from '../../shaders/deepsky/planet.vert?raw';
import planetFrag from '../../shaders/deepsky/planet.frag?raw';
import diskVert from '../../shaders/deepsky/disk.vert?raw';
import diskFrag from '../../shaders/deepsky/disk.frag?raw';
import { AU_PER_PC, EARTH_RADIUS_AU, RS_KM_PER_SUN, SUN_RADIUS_AU, type Facts, type SystemDef } from '../../config/deepsky';
import { KM_PER_AU } from '../../config/astro';
import { equatorialToScene } from '../../physics/frames';
import { makePoints } from '../GalaxyModel';
import {
  DEG,
  binaryOffset,
  rotationOf,
  skyFrame,
  temperatureColor,
  yearNow,
  type BlackHoleInfo,
  type DeepContext,
  type DeepObject,
  type DeepTarget,
  type StarPoints,
} from './common';
import { makeGlow } from './StarGlow';
import { HabitableZoneRing } from '../../bodies/HabitableZoneRing';
import { habitableZone, luminosity } from '../../physics/habitable';
import { science } from '../../core/Science';
import { Matrix4 as M4 } from 'three';
import { PulsarBeams } from './PulsarBeams';
import { AnimatedStar, starKind } from './AnimatedStar';

const SPHERE = new SphereGeometry(1, 96, 64);

/** Days per real second for a system: its fastest orbit takes ~14 s. */
function rateFor(def: SystemDef): number {
  const periods: number[] = [];
  if (def.orbit) periods.push(def.orbit.periodYears * 365.25);
  for (const p of def.planets ?? []) periods.push(p.periodDays);
  const fastest = periods.length ? Math.min(...periods) : 365;
  return MathUtils.clamp(fastest / 14, 0.002, 30);
}

/** One body of the system for the HUD's navigation bar and cards. */
export interface SystemMember {
  targetId: string;
  name: string;
  /** Swatch colour (CSS). */
  swatch: string;
  facts: Facts;
}

const KM_PER_EARTH_RADIUS = 6371;
const KM_PER_SUN_RADIUS = 695_700;

function num(v: number, digits = 2): string {
  const d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? Math.min(digits, 1) : digits;
  return v.toLocaleString('tr-TR', { maximumFractionDigits: d });
}

function spectralClass(K: number): string {
  return K >= 30_000 ? 'O' : K >= 10_000 ? 'B' : K >= 7500 ? 'A' : K >= 6000 ? 'F' : K >= 5200 ? 'G' : K >= 3700 ? 'K' : 'M';
}

function period(days: number): string {
  if (days < 2) return `${num(days * 24, 1)} saat`;
  if (days < 800) return `${num(days, 1)} gün`;
  return `${num(days / 365.25, 1)} yıl`;
}

function hex(c: Color): string {
  return `#${c.clone().convertLinearToSRGB().getHexString()}`;
}

interface Body {
  group: Group;
  star?: AnimatedStar;
  glow?: Mesh<PlaneGeometry, ShaderMaterial>;
  pulsar?: PulsarBeams;
  hole?: BlackHoleInfo;
  massSun: number;
}

/**
 * A star system at true scale in AU (the group maps AU → pc): stars with
 * blackbody colours, limb darkening and convection (giant cells for a red
 * supergiant), binary orbits from published elements, exoplanets lit by
 * their star, and — for an X-ray binary — a black hole fed by a gas stream
 * from its companion through an accretion disc. Black holes and neutron
 * stars hand over to the ray-traced hole effect and pulsar beams.
 */
export class StarSystem implements DeepObject {
  readonly group = new Group();
  readonly targets: DeepTarget[] = [];
  readonly blackHoles: BlackHoleInfo[] = [];
  readonly position: Vector3;
  readonly frame: Matrix4;
  private readonly frameRot: Matrix3;
  private readonly bodies: Body[] = [];
  private readonly planets: { mesh: Mesh<SphereGeometry, ShaderMaterial>; def: NonNullable<SystemDef['planets']>[number]; phase: number }[] = [];
  private planetPoints: StarPoints | null = null;
  private readonly planetFrame = new Matrix3();
  private year = yearNow();
  private readonly rate: number;
  private stream: { pts: StarPoints; s: Float32Array } | null = null;
  private disc: Mesh<RingGeometry, ShaderMaterial> | null = null;
  private readonly discGroup = new Group();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly orbitNormal = new Vector3(0, 0, 1);
  private readonly extent: number;
  private readonly orbitLines: LineLoop[] = [];
  private readonly planetLines: LineLoop[] = [];
  private readonly hzRings: HabitableZoneRing[] = [];
  /** Orbit lines on/off (HUD layer toggle). */
  showOrbits = true;
  /** Bodies for the HUD (stars first, then planets outwards). */
  readonly members: SystemMember[] = [];

  constructor(readonly def: SystemDef) {
    const dir = equatorialToScene(def.ra, def.dec);
    this.position = dir.clone().multiplyScalar(def.distPc);
    this.frame = skyFrame(dir, this.position).multiply(new Matrix4().makeScale(1 / AU_PER_PC, 1 / AU_PER_PC, 1 / AU_PER_PC));
    this.frameRot = rotationOf(this.frame);
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(this.frame);
    this.group.name = `deepsky-${def.id}`;
    this.rate = rateFor(def);
    this.extent = Math.max(def.orbit?.aAu ?? 0, ...(def.planets ?? []).map((p) => p.aAu), (def.stars[0]?.radiusSun ?? 1) * SUN_RADIUS_AU * 4);

    // Orbital plane normal (sky frame), from two points of the relative orbit.
    if (def.orbit) {
      const a = binaryOffset(def.orbit, def.orbit.tP + def.orbit.periodYears * 0.1, new Vector3());
      const b = binaryOffset(def.orbit, def.orbit.tP + def.orbit.periodYears * 0.35, new Vector3());
      this.orbitNormal.crossVectors(a, b).normalize();
    }

    def.stars.forEach((s, i) => this.addBody(s, i));
    if (def.orbit) this.addBinaryOrbits();
    if (def.planets) this.addPlanets();
    if (def.accretion) this.addAccretion();
    this.addHabitableZones();
    this.buildMembers();

    // Main target: from the Sun's side, 25° above the orbital plane, the
    // plane level on screen.
    const planeN = (def.planets ? new Vector3(0, 0, 1).applyMatrix3(this.planetFrame) : def.orbit ? this.orbitNormal.clone() : new Vector3(0, 1, 0))
      .applyMatrix3(this.frameRot)
      .normalize();
    const toSun = dir.clone().negate();
    const inPlane = toSun.clone().addScaledVector(planeN, -toSun.dot(planeN));
    if (inPlane.lengthSq() < 1e-6) inPlane.set(1, 0, 0).addScaledVector(planeN, -planeN.x);
    const arrive = inPlane.normalize().addScaledVector(planeN, Math.tan(25 * DEG)).normalize();
    this.targets.push({
      id: def.id,
      name: def.name,
      fact: def.facts.text,
      facts: def.facts,
      kind: def.category === 'blackhole' ? 'blackhole' : def.category === 'pulsar' ? 'pulsar' : 'system',
      category: def.category,
      position: this.position,
      range: [0, 6000],
      framePc: def.framePc,
      priority: 8,
      viewDir: arrive,
      up: planeN,
      minPc: def.framePc * 0.002,
      maxDistPc: 4000,
      distPc: def.distPc,
    });
  }

  private addBody(s: SystemDef['stars'][number], index: number): void {
    const body: Body = { group: new Group(), massSun: s.massSun };
    this.group.add(body.group);
    if (s.blackHole) {
      const rsPc = (s.massSun * RS_KM_PER_SUN) / KM_PER_AU / AU_PER_PC;
      // Hole frame: its disc in the orbital plane.
      const y = this.orbitNormal.clone();
      const x = new Vector3(1, 0, 0).addScaledVector(y, -y.x).normalize();
      const z = new Vector3().crossVectors(x, y);
      const local = new Matrix3().set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
      const rot = this.frameRot.clone().multiply(local);
      body.hole = {
        id: `${this.def.id}-hole`,
        position: new Vector3(),
        rsPc,
        rot,
        disc: this.def.accretion
          ? { inner: 3, outer: 24, gain: 1.9, doppler: 0.55, hot: new Color(0.95, 0.95, 1.0), warm: new Color(1.0, 0.55, 0.25) }
          : null,
      };
      this.blackHoles.push(body.hole);
      // View along the disc, slightly above it: the film shot.
      const inPlane = new Vector3(0, 0, 1).addScaledVector(y, -y.z);
      if (inPlane.lengthSq() < 1e-6) inPlane.copy(x);
      const view = inPlane.normalize().addScaledVector(y, Math.tan(9 * DEG)).normalize().applyMatrix3(this.frameRot);
      this.targets.push({
        id: `${this.def.id}-hole`,
        name: `${this.def.short}: olay ufku`,
        fact: 'Işığın bile kaçamadığı sınır. Kara gölgenin çevresinde, arkadaki her şeyin ışığı bükülerek halkalara dönüşür.',
        kind: 'blackhole',
        position: new Vector3(),
        range: [0, this.extent * 3 / AU_PER_PC],
        framePc: rsPc * (this.def.accretion ? 70 : 30),
        priority: 9,
        viewDir: view,
        up: this.orbitNormal.clone().applyMatrix3(this.frameRot),
        minPc: rsPc * 2.4,
        maxDistPc: (this.extent * 6) / AU_PER_PC,
      });
    } else if (s.pulsar) {
      body.pulsar = new PulsarBeams(s.pulsar, s.pulsar.beamLengthPc * AU_PER_PC, [0.6, 0.78, 1.0], 2e-5);
      body.group.add(body.pulsar.group);
    } else {
      const R = s.radiusSun * SUN_RADIUS_AU;
      const color = temperatureColor(s.tempK);
      const giant = !!this.def.supergiant;
      // Animated like the Sun: granulation, spots, flares, corona, loops.
      const star = new AnimatedStar(R, 1 / AU_PER_PC, s.tempK, starKind(s.tempK, s.radiusSun, giant), this.def.id.length * 131 + index * 17);
      body.star = star;
      body.group.add(star.group);
      const glow = makeGlow(color, R * (giant ? 1.8 : 2.6), giant ? 0.45 : 2.2, 16, giant ? 0.02 : 0.12);
      glow.userData.base = giant ? 0.45 : 2.2;
      glow.userData.radiusAu = R;
      body.glow = glow;
      body.group.add(glow);
      this.targets.push({
        id: `${this.def.id}-star-${index}`,
        name: s.name,
        fact: this.def.facts.text,
        kind: 'star',
        position: new Vector3(),
        range: [0, (this.extent * 4) / AU_PER_PC],
        // Close enough to watch the surface boil (zoom out for the system).
        framePc: (R * 5) / AU_PER_PC,
        priority: 5,
        minPc: (R * 1.3) / AU_PER_PC,
        maxDistPc: (this.extent * 10) / AU_PER_PC,
      });
    }
    this.bodies.push(body);
  }

  /**
   * Habitable zone round each ordinary star (Kopparapu et al. 2014), in the
   * planets' orbital plane, or the binary's, or the sky plane. Around a
   * binary star each band is the zone of that star alone — an
   * approximation, fair for wide pairs like Alfa Centauri.
   */
  private addHabitableZones(): void {
    const orient = new M4();
    if (this.def.planets) orient.setFromMatrix3(this.planetFrame);
    else if (this.def.orbit) orient.makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), this.orbitNormal));
    this.def.stars.forEach((s, i) => {
      if (s.blackHole || s.pulsar || s.tempK < 1500) return;
      const ring = new HabitableZoneRing(habitableZone(s.tempK, luminosity(s.radiusSun, s.tempK)));
      ring.mesh.quaternion.setFromRotationMatrix(orient);
      this.bodies[i].group.add(ring.mesh);
      this.hzRings.push(ring);
    });
    const sync = () => this.hzRings.forEach((r) => (r.mesh.visible = science.habitableZones));
    science.onChange(sync);
    sync();
  }

  private addBinaryOrbits(): void {
    const o = this.def.orbit!;
    const [m1, m2] = [this.bodies[0].massSun, this.bodies[1].massSun];
    const f1 = m2 / (m1 + m2);
    const f2 = m1 / (m1 + m2);
    for (const [f, color] of [
      [-f1, 0x8fa6d6],
      [f2, 0xf2b35e],
    ] as const) {
      const seg = 360;
      const arr = new Float32Array(seg * 3);
      for (let k = 0; k < seg; k++) {
        binaryOffset(o, o.tP + (k / seg) * o.periodYears, this.tmp).multiplyScalar(f);
        arr.set([this.tmp.x, this.tmp.y, this.tmp.z], k * 3);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(arr, 3));
      const line = new LineLoop(g, new LineBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending }));
      line.frustumCulled = false;
      this.orbitLines.push(line);
      this.group.add(line);
    }
  }

  private addPlanets(): void {
    const inc = (this.def.planetInclinationDeg ?? 60) * DEG;
    // Planet orbit plane: tilted about x from the sky plane.
    this.planetFrame.set(1, 0, 0, 0, Math.cos(inc), -Math.sin(inc), 0, Math.sin(inc), Math.cos(inc));
    const star = this.def.stars[0];
    const light = temperatureColor(star.tempK);
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    (this.def.planets ?? []).forEach((p, i) => {
      const R = p.radiusEarth * EARTH_RADIUS_AU;
      const mesh = new Mesh(
        SPHERE,
        new ShaderMaterial({
          vertexShader: planetVert,
          fragmentShader: planetFrag,
          uniforms: {
            uColor: { value: new Color(p.color[0], p.color[1], p.color[2]) },
            uLightColor: { value: light.clone().multiplyScalar(1.4) },
            uLightPosV: { value: new Vector3() },
          },
        }),
      );
      mesh.scale.setScalar(R);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.planets.push({ mesh, def: p, phase: (i * 2.399) % (Math.PI * 2) });
      pos.push(0, 0, 0);
      col.push(p.color[0] * 0.9, p.color[1] * 0.9, p.color[2] * 0.9);
      size.push(R * 2);
      // Orbit line.
      const seg = 256;
      const arr = new Float32Array(seg * 3);
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        this.tmp.set(Math.cos(a) * p.aAu, Math.sin(a) * p.aAu, 0).applyMatrix3(this.planetFrame);
        arr.set([this.tmp.x, this.tmp.y, this.tmp.z], k * 3);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(arr, 3));
      const hab = p.note?.includes('yaşanabilir');
      const line = new LineLoop(
        g,
        new LineBasicMaterial({ color: hab ? 0x7fd6a0 : 0x8fa6d6, transparent: true, opacity: 0.4, depthWrite: false, blending: AdditiveBlending }),
      );
      line.frustumCulled = false;
      this.planetLines.push(line);
      this.group.add(line);
      this.targets.push({
        id: `${this.def.id}-planet-${p.name}`,
        name: this.def.id === 'trappist1' ? `TRAPPIST-1${p.name}` : p.name,
        fact: `${p.radiusEarth.toLocaleString('tr-TR')} Dünya yarıçapı · yörünge ${p.periodDays.toLocaleString('tr-TR')} gün${p.note ? ' · ' + p.note : ''}.`,
        kind: 'planet',
        position: new Vector3(),
        range: [0, (this.extent * 3) / AU_PER_PC],
        framePc: (R * 8) / AU_PER_PC,
        priority: hab ? 4 : 3,
        minPc: (R * 1.4) / AU_PER_PC,
        maxDistPc: (this.extent * 8) / AU_PER_PC,
      });
    });
    this.planetPoints = makePoints(pos, col, size, { brightness: 1.2, nearFade: 0, minPx: 2.5, maxPx: 6 });
    this.planetPoints.name = `${this.def.id}-planets`;
    this.group.add(this.planetPoints);
  }

  /** X-ray binary: accretion disc around the hole and the stream feeding it. */
  private addAccretion(): void {
    const outer = this.def.accretion!.outerAu;
    const inner = outer * 0.02;
    this.disc = new Mesh(
      new RingGeometry(inner, outer, 256, 8),
      new ShaderMaterial({
        vertexShader: diskVert,
        fragmentShader: diskFrag,
        uniforms: {
          uInner: { value: inner },
          uOuter: { value: outer },
          uTime: { value: 0 },
          uIntensity: { value: 1.6 },
          uCamLocal: { value: new Vector3() },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    this.disc.frustumCulled = false;
    // Ring in the orbital plane: its local XY → plane ⟂ orbit normal.
    this.disc.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), this.orbitNormal);
    this.discGroup.add(this.disc);
    this.group.add(this.discGroup);

    const n = 2400;
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = i / n;
    const pts = makePoints(new Float32Array(n * 3), new Float32Array(n * 3).fill(0.9), new Float32Array(n).fill(0.0012), {
      brightness: 0.35,
      nearFade: 0,
      minPx: 0.8,
      maxPx: 4,
    });
    const colAttr = pts.geometry.getAttribute('aColor') as BufferAttribute;
    for (let i = 0; i < n; i++) colAttr.setXYZ(i, 0.75 + 0.25 * Math.random(), 0.8, 1.0);
    pts.name = `${this.def.id}-stream`;
    this.stream = { pts, s };
    this.group.add(pts);
  }

  /** Extent of the system (pc): its widest orbit or a few star radii. */
  get extentPc(): number {
    return this.extent / AU_PER_PC;
  }

  /**
   * Card data per body, as rich as the solar panel's: size, mass,
   * temperature, luminosity and habitable zone for stars; orbit, light
   * received, equilibrium temperature and zone verdict for planets.
   */
  private buildMembers(): void {
    const def = this.def;
    def.stars.forEach((s, i) => {
      if (s.blackHole) {
        const rsKm = s.massSun * RS_KM_PER_SUN;
        this.members.push({
          targetId: `${def.id}-hole`,
          name: s.name,
          swatch: '#9aa4b8',
          facts: {
            type: 'Yıldız kütleli kara delik',
            stats: [
              ['Kütle', `${num(s.massSun, 1)} Güneş`],
              ['Olay ufku yarıçapı', `${num(rsKm, 0)} km`],
            ],
            text: 'Işığın bile kaçamadığı sınır. Kara gölgenin çevresinde, arkadaki her şeyin ışığı bükülerek halkalara dönüşür.',
          },
        });
        return;
      }
      if (s.pulsar) {
        this.members.push({
          targetId: def.id,
          name: s.name,
          swatch: '#9fc4ff',
          facts: {
            type: 'Nötron yıldızı · pulsar',
            stats: [
              ['Kütle', `${num(s.massSun)} Güneş`],
              ['Çap', '≈ 20 km'],
              ['Dönme süresi', `${num(s.pulsar.periodS * 1000, 2)} ms`],
            ],
            text: def.facts.text,
          },
        });
        return;
      }
      const L = luminosity(s.radiusSun, s.tempK);
      const stats: [string, string][] = [
        ['Tür', `${spectralClass(s.tempK)} türü yıldız`],
        ['Yarıçap', `${num(s.radiusSun)}× Güneş · ${num(s.radiusSun * KM_PER_SUN_RADIUS, 0)} km`],
        ['Kütle', `${num(s.massSun)} Güneş`],
        ['Yüzey sıcaklığı', `${num(s.tempK, 0)} K`],
        ['Parlaklık', `${num(L, L < 0.01 ? 5 : 2)} Güneş`],
      ];
      if (s.tempK >= 1500) {
        const hz = habitableZone(s.tempK, L);
        stats.push(['Yaşanabilir bölge', `${num(hz.conservativeInner, 3)} – ${num(hz.conservativeOuter, 3)} AU`]);
      }
      this.members.push({
        targetId: `${def.id}-star-${i}`,
        name: s.name,
        swatch: hex(temperatureColor(s.tempK)),
        facts: {
          type: def.stars.length > 1 ? `Çoklu sistemin ${i === 0 ? 'baş' : 'eş'} yıldızı` : 'Yıldız',
          stats,
          text: def.facts.text,
        },
      });
    });
    const host = def.stars[0];
    const L = luminosity(host.radiusSun, host.tempK);
    const hz = host.tempK >= 1500 && !host.blackHole && !host.pulsar ? habitableZone(host.tempK, L) : null;
    for (const p of def.planets ?? []) {
      const flux = L / (p.aAu * p.aAu);
      // Equilibrium temperature for an Earth-like Bond albedo of 0.3.
      const teq = (255 * Math.pow(L, 0.25)) / Math.sqrt(p.aAu);
      const lightMin = (p.aAu * KM_PER_AU) / 299_792.458 / 60;
      const zone = !hz
        ? null
        : p.aAu < hz.optimisticInner
          ? 'iç sınırın içinde (çok sıcak)'
          : p.aAu < hz.conservativeInner
            ? 'iyimser bölgede (sıcak kenar)'
            : p.aAu <= hz.conservativeOuter
              ? 'bölgenin içinde'
              : p.aAu <= hz.optimisticOuter
                ? 'iyimser bölgede (soğuk kenar)'
                : 'dış sınırın ötesinde (çok soğuk)';
      const stats: [string, string][] = [
        ['Yarıçap', `${num(p.radiusEarth)}× Dünya · ${num(p.radiusEarth * KM_PER_EARTH_RADIUS, 0)} km`],
        ['Yıldızına uzaklık', `${num(p.aAu, 4)} AU`],
        ['Yörünge süresi', period(p.periodDays)],
        ['Aldığı ışık', `${num(flux)}× Dünya`],
        ['Denge sıcaklığı', `≈ ${num(teq - 273.15, 0)} °C`],
        ['Yıldız ışığının varışı', lightMin < 1 ? `${num(lightMin * 60, 0)} s` : `${num(lightMin, 1)} dk`],
      ];
      if (zone) stats.push(['Yaşanabilir bölge', zone]);
      const note = p.note ? ` ${p.note.charAt(0).toLocaleUpperCase('tr-TR')}${p.note.slice(1)}.` : '';
      this.members.push({
        targetId: `${def.id}-planet-${p.name}`,
        name: def.id === 'trappist1' ? `TRAPPIST-1${p.name}` : p.name,
        swatch: hex(new Color(p.color[0], p.color[1], p.color[2])),
        facts: {
          type: p.radiusEarth < 1.6 ? 'Kayalık ötegezegen' : p.radiusEarth < 4 ? 'Süper Dünya / mini Neptün' : 'Dev ötegezegen',
          stats,
          text: `${host.name} çevresinde dolanıyor.${note} Denge sıcaklığı, ışığın %30'unu yansıtan ve sera etkisi olmayan bir yüzey için hesaplandı.`,
        },
      });
    }
  }

  scaled(): ShaderMaterial[] {
    const out: ShaderMaterial[] = [];
    for (const b of this.bodies) {
      if (b.glow) out.push(b.glow.material);
      if (b.pulsar) out.push(b.pulsar.glow.material);
    }
    if (this.planetPoints) out.push(this.planetPoints.material);
    if (this.stream) out.push(this.stream.pts.material);
    return out;
  }

  update(ctx: DeepContext): void {
    const cam = ctx.camera.position;
    const dist = cam.distanceTo(this.position);
    this.year += (ctx.dt * this.rate) / 365.25;

    // Positions are always kept current (cheap): labels, flights and the
    // black-hole effect need them even while the system is not drawn.
    if (this.def.orbit && this.bodies.length >= 2) {
      const [m1, m2] = [this.bodies[0].massSun, this.bodies[1].massSun];
      binaryOffset(this.def.orbit, this.year, this.tmp);
      this.bodies[0].group.position.copy(this.tmp).multiplyScalar(-m2 / (m1 + m2));
      this.bodies[1].group.position.copy(this.tmp).multiplyScalar(m1 / (m1 + m2));
    }
    for (const b of this.bodies) if (b.hole) b.hole.position.copy(b.group.position).applyMatrix4(this.frame);
    for (const t of this.targets) {
      if (t.id.startsWith(`${this.def.id}-star-`)) {
        const idx = Number(t.id.slice(`${this.def.id}-star-`.length));
        t.position.copy(this.bodies[idx].group.position).applyMatrix4(this.frame);
      } else if (t.id === `${this.def.id}-hole`) {
        const hb = this.bodies.find((b) => b.hole);
        if (hb) t.position.copy(hb.group.position).applyMatrix4(this.frame);
      }
    }
    this.planets.forEach((p) => {
      const a = p.phase + ((this.year * 365.25) / p.def.periodDays) * Math.PI * 2;
      p.mesh.position.set(Math.cos(a) * p.def.aAu, Math.sin(a) * p.def.aAu, 0).applyMatrix3(this.planetFrame);
      const t = this.targets.find((x) => x.id === `${this.def.id}-planet-${p.def.name}`);
      if (t) t.position.copy(p.mesh.position).applyMatrix4(this.frame);
    });

    // Drawn only within a few thousand system sizes (the label guides you in).
    this.group.visible = dist < Math.max((this.extent * 3000) / AU_PER_PC, 0.5);
    if (!this.group.visible) return;
    this.group.updateMatrixWorld(true);
    // Right next to a black hole the orbit lines would only be lensed into
    // stray arcs across the view.
    const hole = this.bodies.find((b) => b.hole)?.hole;
    const nearHole = !!hole && cam.distanceTo(hole.position) < (this.extent * 0.04) / AU_PER_PC;
    for (const l of this.orbitLines) l.visible = !nearHole && this.showOrbits;
    for (const l of this.planetLines) l.visible = this.showOrbits;
    for (const b of this.bodies) {
      b.star?.update(ctx.dt, ctx.elapsed, ctx.camera);
      // The point-of-light glow guides from afar; once the disc is resolved
      // (a few dozen pixels) the animated surface takes over.
      if (b.glow && b.star) {
        const r = (b.glow.userData.radiusAu as number) / AU_PER_PC;
        const d = cam.distanceTo(this.tmp.setFromMatrixPosition(b.group.matrixWorld));
        const k = MathUtils.smoothstep(r / Math.max(d, 1e-30), 0.004, 0.03);
        b.glow.material.uniforms.uIntensity.value = (b.glow.userData.base as number) * (1 - k);
        b.glow.visible = k < 0.999;
      }
      if (b.pulsar) b.pulsar.update(ctx.elapsed, ctx.camera);
    }
    if (this.planets.length && this.planetPoints) {
      const pos = this.planetPoints.geometry.getAttribute('position') as BufferAttribute;
      const starV = this.tmp2.set(0, 0, 0).applyMatrix4(this.group.matrixWorld).applyMatrix4(ctx.camera.matrixWorldInverse);
      this.planets.forEach((p, i) => {
        pos.setXYZ(i, p.mesh.position.x, p.mesh.position.y, p.mesh.position.z);
        (p.mesh.material.uniforms.uLightPosV.value as Vector3).copy(starV);
      });
      pos.needsUpdate = true;
    }

    // Accretion disc and stream.
    if (this.disc && this.stream) {
      const hole = this.bodies.find((b) => b.hole)!;
      const star = this.bodies.find((b) => b.star)!;
      this.discGroup.position.copy(hole.group.position);
      const u = this.disc.material.uniforms;
      u.uTime.value = ctx.elapsed;
      this.disc.updateMatrixWorld();
      (u.uCamLocal.value as Vector3).copy(cam).applyMatrix4(this.disc.matrixWorld.clone().invert());
      // Stream from the companion's inner face (≈ L1) spiralling into the disc edge.
      const outer = this.def.accretion!.outerAu;
      const from = star.group.position;
      const to = hole.group.position;
      const sep = this.tmp.subVectors(to, from);
      const dirN = sep.clone().normalize();
      const side = new Vector3().crossVectors(this.orbitNormal, dirN).normalize();
      const pos = this.stream.pts.geometry.getAttribute('position') as BufferAttribute;
      const starR = this.def.stars.find((s) => !s.blackHole)!.radiusSun * SUN_RADIUS_AU;
      const start = from.clone().addScaledVector(dirN, starR);
      const len = Math.max(sep.length() - starR - outer, 0);
      for (let i = 0; i < this.stream.s.length; i++) {
        let s = this.stream.s[i] + ctx.dt * 0.12;
        if (s > 1) s -= 1;
        this.stream.s[i] = s;
        // Curve: straight out of L1, swinging sideways (Coriolis) as it falls.
        const jitter = ((i * 7919) % 97) / 97 - 0.5;
        const p = start.clone().addScaledVector(dirN, len * s);
        p.addScaledVector(side, Math.sin(s * Math.PI * 0.9) * outer * 0.9 + jitter * outer * 0.25 * (0.2 + s));
        p.addScaledVector(this.orbitNormal, (((i * 3571) % 89) / 89 - 0.5) * outer * 0.12 * (0.2 + s));
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
    }
  }
}
