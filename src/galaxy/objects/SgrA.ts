import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineLoop, Matrix3, Matrix4, Vector3, type ShaderMaterial } from 'three';
import { KM_PER_AU } from '../../config/astro';
import { AU_PER_PC, DEEP_DAYS_PER_SECOND, RS_KM_PER_SUN, S_STARS, SGR_A_FACTS, SGR_A_MASS_SUN, type SStar } from '../../config/deepsky';
import { R0_PC } from '../../config/galaxy';
import { solveKepler } from '../../physics/orbits';
import { makePoints } from '../GalaxyModel';
import { makeGlow } from './StarGlow';
import { GAL } from '../GalaxyModel';
import { DEG, rotationOf, skyFrame, yearNow, type BlackHoleInfo, type DeepContext, type DeepObject, type DeepTarget, type StarPoints } from './common';

/**
 * Sgr A*, the black hole at the centre of the Milky Way: ray-traced with an
 * accretion disc seen nearly edge-on (the "Interstellar" view), and the
 * S-stars on their measured orbits around it, in AU (the group maps AU to
 * pc so these tiny sizes stay well-conditioned).
 */
export class SgrA implements DeepObject {
  readonly group = new Group();
  readonly targets: DeepTarget[] = [];
  readonly blackHoles: BlackHoleInfo[] = [];
  readonly position = GAL.centre.clone();
  private readonly frame: Matrix4;
  private readonly sStars: StarPoints;
  private readonly sTargets: DeepTarget[] = [];
  private readonly orbitLines: LineLoop<BufferGeometry, LineBasicMaterial>[] = [];
  private year = yearNow();
  private readonly tmp = new Vector3();
  private readonly marker: ReturnType<typeof makeGlow>;

  constructor() {
    const dirFromSun = this.position.clone().normalize();
    const sky = skyFrame(dirFromSun, this.position);
    this.frame = sky.clone().multiply(new Matrix4().makeScale(1 / AU_PER_PC, 1 / AU_PER_PC, 1 / AU_PER_PC));
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(this.frame);
    this.group.name = 'sgr-a';

    // Hole frame: disc normal tilted 10° from celestial north towards us,
    // so from Earth's side the disc is seen almost edge-on (inclination 80°).
    const tilt = 10 * DEG;
    const y = new Vector3(0, Math.cos(tilt), Math.sin(tilt));
    const x = new Vector3(1, 0, 0);
    const z = new Vector3().crossVectors(x, y);
    const local = new Matrix3().set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
    const rot = rotationOf(sky).multiply(local);
    const rsPc = (SGR_A_MASS_SUN * RS_KM_PER_SUN) / KM_PER_AU / AU_PER_PC;
    this.blackHoles.push({
      id: 'sgr-a',
      position: this.position.clone(),
      rsPc,
      rot,
      disc: { inner: 3, outer: 14, gain: 1.7, doppler: 0.22, hot: new Color(1.0, 0.92, 0.78), warm: new Color(1.0, 0.48, 0.14) },
    });

    // S-stars and their orbits.
    const pos = new Float32Array(S_STARS.length * 3);
    const col = new Float32Array(S_STARS.length * 3);
    for (let i = 0; i < S_STARS.length; i++) col.set([0.75, 0.85, 1.0], i * 3);
    this.sStars = makePoints(pos, col, new Float32Array(S_STARS.length).fill(3), { brightness: 1.8, nearFade: 0, minPx: 3, maxPx: 8 });
    this.sStars.name = 's-stars';
    this.group.add(this.sStars);
    for (const s of S_STARS) {
      const g = new BufferGeometry();
      const seg = 720;
      const arr = new Float32Array(seg * 3);
      for (let k = 0; k < seg; k++) {
        this.orbitPoint(s, s.tP + (k / seg) * s.P, this.tmp);
        arr.set([this.tmp.x, this.tmp.y, this.tmp.z], k * 3);
      }
      g.setAttribute('position', new BufferAttribute(arr, 3));
      const line = new LineLoop(
        g,
        new LineBasicMaterial({
          color: s.id === 'S2' ? 0xf2b35e : 0x6f86b8,
          transparent: true,
          opacity: s.id === 'S2' ? 0.55 : 0.3,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      line.frustumCulled = false;
      line.userData.opacity = line.material.opacity;
      this.orbitLines.push(line);
      this.group.add(line);
      const t: DeepTarget = {
        id: `sstar-${s.id}`,
        name: s.id,
        fact:
          s.id === 'S2'
            ? "Kara deliğe en çok yaklaşan yıldızlardan: 16 yılda bir tur, en yakın geçişte saatte 25 milyon km. Yörüngesi Einstein'ın genel göreliliğini doğruladı (Nobel 2020)."
            : 'Sgr A* çevresinde dolanan S yıldızlarından biri. Yörüngeleri kara deliğin kütlesini verir: 4,3 milyon Güneş.',
        kind: 'star',
        position: new Vector3(),
        range: [0, 0.12],
        framePc: 0.03,
        priority: s.id === 'S2' ? 6 : 2,
        maxDistPc: 0.5,
      };
      this.sTargets.push(t);
    }

    const toSun = dirFromSun.clone().negate();
    // Arrive along the disc plane, 8° above it, from Earth's side.
    const view = new Vector3(0, 0, 1).applyMatrix3(rotationOf(sky));
    const normalW = y.clone().applyMatrix3(rotationOf(sky));
    view.addScaledVector(normalW, -view.dot(normalW)).normalize().addScaledVector(normalW, Math.tan(8 * DEG)).normalize();
    // "Sgr A*" goes straight to the film view: along the disc, 8° above it,
    // disc level on screen. The S-star orbits are a separate stop.
    this.targets.push(
      {
        id: 'sgr-a',
        name: 'Sgr A* kara deliği',
        fact: SGR_A_FACTS.text,
        facts: SGR_A_FACTS,
        kind: 'blackhole',
        category: 'blackhole',
        position: this.position,
        range: [rsPc * 400, 1500],
        framePc: rsPc * 38,
        priority: 9,
        viewDir: view,
        up: normalW.clone(),
        minPc: rsPc * 2.4,
        maxDistPc: 2500,
        distPc: R0_PC,
      },
      {
        id: 'sstars',
        name: 'S yıldızları',
        fact: "Sgr A*'nın çevresinde birkaç on yılda bir dolanan yıldızlar. Yörüngeleri kara deliğin kütlesini ölçtü ve genel göreliliği doğruladı (Nobel 2020). Kara delik bu ölçekte bir nokta kadar küçük.",
        kind: 'blackhole',
        position: this.position,
        range: [0.004, 0.2],
        framePc: 0.03,
        priority: 7,
        viewDir: toSun,
        maxDistPc: 0.5,
      },
      ...this.sTargets,
    );
    // From afar the hole is far too small to see: a warm glow marks it.
    this.marker = makeGlow([1.0, 0.62, 0.3], 30, 1.8, 7, 0.15);
    this.group.add(this.marker);
  }

  /** S-star position (AU, sky frame: x west, y north, z towards us) at a decimal year. */
  private orbitPoint(s: SStar, year: number, out: Vector3): Vector3 {
    const aAu = s.a * R0_PC;
    const M = (2 * Math.PI * (year - s.tP)) / s.P;
    const E = solveKepler(M, s.e);
    const nu = 2 * Math.atan2(Math.sqrt(1 + s.e) * Math.sin(E / 2), Math.sqrt(1 - s.e) * Math.cos(E / 2));
    const r = aAu * (1 - s.e * Math.cos(E));
    const u = s.omega * DEG + nu;
    const O = s.Omega * DEG;
    const inc = s.i * DEG;
    const north = r * (Math.cos(u) * Math.cos(O) - Math.sin(u) * Math.sin(O) * Math.cos(inc));
    const east = r * (Math.cos(u) * Math.sin(O) + Math.sin(u) * Math.cos(O) * Math.cos(inc));
    const away = r * Math.sin(u) * Math.sin(inc);
    return out.set(-east, north, -away);
  }

  scaled(): ShaderMaterial[] {
    return [this.sStars.material, this.marker.material];
  }

  update(ctx: DeepContext): void {
    // S-star positions always (labels and flights need them).
    this.year += (ctx.dt * DEEP_DAYS_PER_SECOND) / 365.25;
    const pos = this.sStars.geometry.getAttribute('position') as BufferAttribute;
    S_STARS.forEach((s, i) => {
      this.orbitPoint(s, this.year, this.tmp);
      pos.setXYZ(i, this.tmp.x, this.tmp.y, this.tmp.z);
      this.sTargets[i].position.copy(this.tmp).applyMatrix4(this.frame);
    });
    pos.needsUpdate = true;

    const dist = ctx.camera.position.distanceTo(this.position);
    const near = dist < 50;
    this.group.visible = near;
    if (!near) return;
    // At horizon scale the S-star orbits would only cut across the view,
    // and the ray-traced hole replaces the marker glow.
    const k = Math.min(Math.max((dist - 0.0002) / 0.002, 0), 1);
    for (const l of this.orbitLines) {
      l.material.opacity = (l.userData.opacity as number) * k;
      l.visible = k > 0.01;
    }
    this.marker.visible = dist > 0.0008;
  }
}
