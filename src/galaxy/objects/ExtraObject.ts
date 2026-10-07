import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Matrix3,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import jetVert from '../../shaders/deepsky/jet.vert?raw';
import jetFrag from '../../shaders/deepsky/jet.frag?raw';
import { KM_PER_AU } from '../../config/astro';
import { AU_PER_PC, RS_KM_PER_SUN } from '../../config/deepsky';
import type { ExtraDef, HaloDef, JetDef } from '../../config/extragalactic';
import type { DiscLook } from '../../core/effects/BlackHoleEffect';
import type { Loader } from '../../core/Loader';
import { equatorialToScene } from '../../physics/frames';
import { Random } from '../../utils/random';
import { makePoints } from '../GalaxyModel';
import { DEG, rotationOf, skyFrame, type BlackHoleInfo, type DeepContext, type DeepObject, type DeepTarget, type StarPoints } from './common';
import { SlicedNebula } from './SlicedNebula';
import { makeGlow } from './StarGlow';

const DISC_LOOKS: Record<'film' | 'quasar', DiscLook> = {
  film: { inner: 3, outer: 14, gain: 1.7, doppler: 0.22, hot: new Color(1.0, 0.92, 0.78), warm: new Color(1.0, 0.48, 0.14) },
  quasar: { inner: 3, outer: 20, gain: 2.1, doppler: 0.35, hot: new Color(0.8, 0.88, 1.0), warm: new Color(1.0, 0.72, 0.45) },
};

/**
 * Jet tube along +Y: rings spaced logarithmically from 3 Rs to the tip, a
 * parabolic base (r ∝ z^0.6, as measured for M87) opening into a cone.
 */
function jetGeometry(rsPc: number, j: JetDef): BufferGeometry {
  const rings = 160;
  const seg = 20;
  const y0 = 3 * rsPc;
  const L = j.lengthPc;
  const tanO = Math.tan(j.openingDeg * DEG);
  const pos: number[] = [];
  const nor: number[] = [];
  const along: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= rings; k++) {
    const f = k / rings;
    const y = y0 * Math.pow(L / y0, f);
    const r = Math.max(0.7 * rsPc * Math.pow(y / y0, 0.6), y * tanO);
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      nor.push(Math.cos(a), 0, Math.sin(a));
      along.push(f);
    }
  }
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < seg; s++) {
      const a = k * (seg + 1) + s;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
  g.setIndex(idx);
  return g;
}

/** Plummer sphere of points, flattened along z (the line of sight). */
function plummer(rnd: Random, n: number, a: number, flatten: number, out: number[]): void {
  for (let i = 0; i < n; i++) {
    const u = Math.max(rnd.next(), 1e-6);
    const r = Math.min(a / Math.sqrt(Math.pow(u, -2 / 3) - 1), a * 14);
    const ct = rnd.range(-1, 1);
    const st = Math.sqrt(1 - ct * ct);
    const ph = rnd.next() * Math.PI * 2;
    out.push(r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct * flatten);
  }
}

/**
 * A famous object beyond the Milky Way at its true distance (out to
 * TON 618, 5.6 Gpc): its Hubble/Webb picture made volumetric (a disc
 * deprojected to its inclination, an edge-on disc, an elliptical), the old
 * stars and globular clusters round it, and its central black hole,
 * ray-traced with the film look, with relativistic jets where it has them.
 * Everything is drawn camera-relative, so nothing shakes even billions of
 * parsecs from the origin.
 */
export class ExtraObject implements DeepObject {
  readonly group = new Group();
  readonly targets: DeepTarget[] = [];
  readonly blackHoles: BlackHoleInfo[] = [];
  readonly position: Vector3;
  private readonly nebula: SlicedNebula | null = null;
  private readonly sky = new Group();
  private readonly holeGroup = new Group();
  private readonly points: StarPoints[] = [];
  private readonly jets: Mesh<BufferGeometry, ShaderMaterial>[] = [];
  private beacon: ReturnType<typeof makeGlow> | null = null;
  private readonly glows: ReturnType<typeof makeGlow>[] = [];
  private readonly extent: number;
  private readonly rsPc: number = 0;

  constructor(
    readonly def: ExtraDef,
    loader: Loader,
  ) {
    const dir = equatorialToScene(def.ra, def.dec);
    this.position = dir.clone().multiplyScalar(def.distPc);
    const frame = skyFrame(dir, this.position);
    const frameRot = rotationOf(frame);
    const toSun = dir.clone().negate();
    const north = new Vector3().setFromMatrixColumn(frame, 1).normalize();
    this.group.name = `extra-${def.id}`;
    this.sky.matrixAutoUpdate = false;
    this.sky.matrix.copy(frame);
    this.group.add(this.sky);
    let extent = 1000;

    // ---- The picture -------------------------------------------------------------------
    if (def.image) {
      const im = def.image;
      this.nebula = new SlicedNebula(
        {
          kind: 'nebula',
          id: def.id,
          name: def.name,
          short: def.short,
          category: 'galaxy',
          ra: def.ra,
          dec: def.dec,
          distPc: def.distPc,
          framePc: def.framePc,
          facts: def.facts,
          image: im.file,
          folder: 'extragalactic',
          aspect: im.aspect,
          widthPc: im.widthPc,
          anchor: im.anchor,
          depth: im.depth,
          brightness: im.brightness,
          particles: 20_000,
          particleSize: 1 / 280,
          particleGain: 0.05,
          // Beyond ~400 widths a galaxy is a few pixels: the marker shows it.
          visibleWidths: 400,
        },
        loader,
      );
      this.group.add(this.nebula.group);
      this.targets.push(...this.nebula.targets);
      extent = Math.max(extent, im.widthPc);
    }

    // ---- Old stars and globular clusters -----------------------------------------------
    const rnd = new Random(def.id.length * 7907 + 13);
    if (def.halo) {
      this.addHalo(def.halo, rnd);
      extent = Math.max(extent, def.halo.scalePc * 12, (def.halo.globularScalePc ?? 0) * 4);
    }
    if (def.nebula) {
      const g = makeGlow(def.nebula.color, def.nebula.radiusPc, def.nebula.intensity, 0, 0);
      g.userData.base = def.nebula.intensity;
      g.userData.radius = def.nebula.radiusPc;
      this.glows.push(g);
      this.sky.add(g);
      extent = Math.max(extent, def.nebula.radiusPc * 2);
    }

    // ---- Black hole, disc, jets ---------------------------------------------------------
    const h = def.hole;
    if (h) {
      const rsPc = (h.massSun * RS_KM_PER_SUN) / KM_PER_AU / AU_PER_PC;
      this.rsPc = rsPc;
      // Spin axis: along the jet; else the galaxy's disc normal; else 10°
      // from celestial north towards us (disc nearly edge-on from Earth).
      const axis = new Vector3();
      if (h.jet) {
        const a = h.jet.angleDeg * DEG;
        const l = h.jet.losDeg * DEG;
        axis.set(Math.cos(a) * Math.sin(l), Math.sin(a) * Math.sin(l), Math.cos(l)).applyMatrix3(frameRot);
      } else if (def.image?.depth.model === 'disc') {
        const d = def.image.depth;
        const a = d.majorDeg * DEG;
        const t = Math.tan(d.incDeg * DEG);
        axis.set(Math.sin(a) * t, -Math.cos(a) * t, 1).normalize().applyMatrix3(frameRot);
      } else {
        axis.set(0, Math.cos(10 * DEG), Math.sin(10 * DEG)).applyMatrix3(frameRot);
      }
      axis.normalize();
      const ref = Math.abs(axis.dot(north)) < 0.9 ? north : toSun;
      const x = new Vector3().crossVectors(axis, ref).normalize();
      const z = new Vector3().crossVectors(x, axis);
      const rot = new Matrix3().set(x.x, axis.x, z.x, x.y, axis.y, z.y, x.z, axis.z, z.z);
      this.blackHoles.push({ id: `${def.id}-hole`, position: this.position.clone(), rsPc, rot, disc: DISC_LOOKS[h.look], skyGain: 0.12 });

      this.holeGroup.matrixAutoUpdate = false;
      this.holeGroup.matrix.copy(new Matrix4().setFromMatrix3(rot).setPosition(this.position));
      this.group.add(this.holeGroup);
      if (h.jet) {
        const geo = jetGeometry(rsPc, h.jet);
        for (const [sign, k] of [
          [1, 1],
          [-1, h.jet.counter],
        ] as const) {
          if (k <= 0) continue;
          const m = new Mesh(
            geo,
            new ShaderMaterial({
              vertexShader: jetVert,
              fragmentShader: jetFrag,
              uniforms: {
                uColor: { value: new Color(...h.jet.color) },
                uIntensity: { value: h.jet.intensity * k },
                uTime: { value: 0 },
                uSeed: { value: sign * 7.3 + def.id.length },
              },
              transparent: true,
              depthWrite: false,
              blending: AdditiveBlending,
              side: DoubleSide,
            }),
          );
          m.frustumCulled = false;
          m.renderOrder = 4;
          if (sign < 0) m.rotation.x = Math.PI;
          this.jets.push(m);
          this.holeGroup.add(m);
        }
        extent = Math.max(extent, h.jet.lengthPc);
      }
      if (h.beacon) {
        this.beacon = makeGlow(h.beacon.color, rsPc * 400, h.beacon.intensity, 4, 0.35);
        this.holeGroup.add(this.beacon);
      }

      // Film view: along the disc, 8° above it, the disc level on screen.
      const inPlane = toSun.clone().addScaledVector(axis, -toSun.dot(axis));
      if (inPlane.lengthSq() < 1e-6) inPlane.copy(x);
      const view = inPlane.normalize().addScaledVector(axis, Math.tan(8 * DEG)).normalize();
      const own = !def.image;
      this.targets.push({
        id: own ? def.id : `${def.id}-hole`,
        name: h.name,
        fact: h.facts.text,
        facts: h.facts,
        kind: 'blackhole',
        category: own ? 'blackhole' : undefined,
        position: this.position,
        range: own ? [0, Infinity] : [0, rsPc * 4000],
        framePc: rsPc * 38,
        priority: 9,
        viewDir: view,
        up: axis.clone(),
        minPc: rsPc * 2.4,
        maxDistPc: own ? def.distPc * 2 : rsPc * 2e5,
        distPc: def.distPc,
      });
      // A black hole without a picture: also a wide view of its surroundings.
      if (own) {
        this.targets.push({
          id: `${def.id}-wide`,
          name: `${def.short.split(' (')[0]}: çevresi`,
          fact: def.facts.text || h.facts.text,
          kind: 'galaxy',
          position: this.position,
          range: [rsPc * 4000, Infinity],
          framePc: extent * 1.4,
          priority: 5,
          viewDir: toSun.clone().addScaledVector(north, 0.35).normalize(),
          up: north,
          maxDistPc: extent * 60,
          distPc: def.distPc,
        });
      }
    }
    this.extent = extent;
  }

  private addHalo(h: HaloDef, rnd: Random): void {
    const pos: number[] = [];
    plummer(rnd, h.stars, h.scalePc, h.flatten ?? 1, pos);
    const col: number[] = [];
    const size: number[] = [];
    for (let i = 0; i < h.stars; i++) {
      const k = rnd.next();
      const f = 0.85 + 0.3 * rnd.next();
      if (k < 0.2) col.push(1.0 * f, 0.62 * f, 0.38 * f);
      else col.push(h.color[0] * f, h.color[1] * f, h.color[2] * f);
      size.push(h.scalePc * (k < 0.2 ? 0.03 : 0.018));
    }
    // With a photo the stars are already in the picture: the halo only adds depth.
    const stars = makePoints(pos, col, size, { brightness: this.def.image ? 0.07 : 0.22, nearFade: h.scalePc * 0.03, minPx: 0, maxPx: 5 });
    stars.name = `${this.def.id}-halo`;
    this.points.push(stars);
    this.sky.add(stars);
    if (h.globulars && h.globularScalePc) {
      const gp: number[] = [];
      plummer(rnd, h.globulars, h.globularScalePc, 1, gp);
      const gc = new Array(h.globulars * 3);
      for (let i = 0; i < h.globulars; i++) {
        const f = 0.8 + 0.4 * rnd.next();
        gc[i * 3] = 1.0 * f;
        gc[i * 3 + 1] = 0.88 * f;
        gc[i * 3 + 2] = 0.7 * f;
      }
      const globs = makePoints(gp, gc, new Array(h.globulars).fill(12), { brightness: 0.9, nearFade: 20, minPx: 0, maxPx: 6 });
      globs.name = `${this.def.id}-globulars`;
      this.points.push(globs);
      this.sky.add(globs);
    }
  }

  scaled(): ShaderMaterial[] {
    const out = [...this.points.map((p) => p.material), ...this.glows.map((g) => g.material)];
    if (this.beacon) out.push(this.beacon.material);
    if (this.nebula) out.push(...this.nebula.scaled());
    return out;
  }

  update(ctx: DeepContext): void {
    this.nebula?.update(ctx);
    const dist = ctx.camera.position.distanceTo(this.position);
    const near = dist < this.extent * 300;
    this.sky.visible = near;
    for (const j of this.jets) {
      j.visible = near;
      j.material.uniforms.uTime.value = ctx.elapsed;
    }
    // A glow seen from inside would only fog the view.
    for (const g of this.glows) {
      const R = g.userData.radius as number;
      g.material.uniforms.uIntensity.value = (g.userData.base as number) * MathUtils.smoothstep(dist, R * 0.3, R * 1.5);
    }
    // A quasar shines from far away; next to the hole the ray-traced disc takes over.
    if (this.beacon) this.beacon.visible = dist > this.rsPc * 3000 && dist < this.extent * 1e6;
  }
}
