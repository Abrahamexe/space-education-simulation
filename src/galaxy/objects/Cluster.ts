import { Group, Matrix4, Vector3, type ShaderMaterial } from 'three';
import { AU_PER_PC, RS_KM_PER_SUN, type ClusterDef } from '../../config/deepsky';
import { KM_PER_AU } from '../../config/astro';
import { equatorialToScene } from '../../physics/frames';
import { Random } from '../../utils/random';
import { makePoints } from '../GalaxyModel';
import { rotationOf, skyFrame, type BlackHoleInfo, type DeepContext, type DeepObject, type DeepTarget, type StarPoints } from './common';
import { makeGlow } from './StarGlow';

/**
 * A star cluster in 3-D. Globular: a Plummer sphere of old stars (yellow,
 * red giants, a few blue stragglers) with its central black hole. Open
 * (Ülker): its named bright members at their true sky positions, fainter
 * members around them, and the blue reflection nebula their light picks
 * out of the dust cloud they are passing through.
 */
export class Cluster implements DeepObject {
  readonly group = new Group();
  readonly targets: DeepTarget[] = [];
  readonly blackHoles: BlackHoleInfo[] = [];
  readonly position: Vector3;
  private readonly clouds: StarPoints[] = [];
  private readonly glows: ReturnType<typeof makeGlow>[] = [];

  constructor(readonly def: ClusterDef) {
    const dir = equatorialToScene(def.ra, def.dec);
    this.position = dir.clone().multiplyScalar(def.distPc);
    const frame: Matrix4 = skyFrame(dir, this.position);
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(frame);
    this.group.name = `deepsky-${def.id}`;
    const rnd = new Random(def.id.length * 104729);

    // Plummer sphere: r = a / sqrt(u^(−2/3) − 1).
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const a = def.scalePc;
    for (let i = 0; i < def.stars; i++) {
      const u = Math.max(rnd.next(), 1e-6);
      const r = Math.min(a / Math.sqrt(Math.pow(u, -2 / 3) - 1), a * 12);
      const ct = rnd.range(-1, 1);
      const st = Math.sqrt(1 - ct * ct);
      const ph = rnd.next() * Math.PI * 2;
      pos.push(r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct);
      const k = rnd.next();
      if (def.globular) {
        if (k < 0.04) col.push(0.6, 0.72, 1.0); // blue stragglers / horizontal branch
        else if (k < 0.3) col.push(1.0, 0.62, 0.35); // red giants
        else col.push(1.0, 0.86, 0.66);
        size.push(a * (k < 0.3 ? 0.022 : 0.012));
      } else {
        col.push(0.78, 0.86, 1.0);
        size.push(a * 0.03);
      }
    }
    const field = makePoints(pos, col, size, { brightness: def.globular ? 0.3 : 0.9, nearFade: a * 0.05, minPx: 0, maxPx: 6 });
    field.name = `${def.id}-stars`;
    this.clouds.push(field);
    this.group.add(field);

    const toSun = dir.clone().negate();
    const north = new Vector3().setFromMatrixColumn(frame, 1).normalize();
    this.targets.push({
      id: def.id,
      name: def.name,
      fact: def.facts.text,
      facts: def.facts,
      kind: 'cluster',
      category: def.category,
      position: this.position,
      range: [0, 8000],
      framePc: def.framePc,
      priority: 8,
      viewDir: toSun.clone().addScaledVector(north, 0.3).normalize(),
      minPc: a * 0.02,
      maxDistPc: 6000,
      distPc: def.distPc,
    });

    // Named members (open clusters) at their real sky positions.
    if (def.members) {
      const inv = new Matrix4().copy(frame).invert();
      for (const m of def.members) {
        const w = equatorialToScene(m.ra, m.dec).multiplyScalar(def.distPc + rnd.gaussian() * 1.5);
        const local = w.clone().applyMatrix4(inv);
        const g = makeGlow(m.color, 0.02, 2.4, 6, 0.5);
        g.position.copy(local);
        this.glows.push(g);
        this.group.add(g);
        this.targets.push({
          id: `${def.id}-${m.name}`,
          name: m.name,
          fact: def.facts.text,
          kind: 'star',
          position: w,
          range: [0, a * 12],
          framePc: a * 1.2,
          priority: 3,
          maxDistPc: a * 30,
        });
      }
      if (def.reflectionNebula) {
        // Blue haze: dust lit by the bright members, densest round Merope.
        const hp: number[] = [];
        const hc: number[] = [];
        const hs: number[] = [];
        for (const g of this.glows) {
          const weight = g === this.glows[4] ? 2200 : 900;
          for (let i = 0; i < weight; i++) {
            const r = Math.abs(rnd.gaussian()) * 0.55;
            const ct = rnd.range(-1, 1);
            const st = Math.sqrt(1 - ct * ct);
            const ph = rnd.next() * Math.PI * 2;
            // Wispy: stretched along one direction, like the real streaks.
            hp.push(g.position.x + r * st * Math.cos(ph) * 1.6, g.position.y + r * st * Math.sin(ph) * 0.6, g.position.z + r * ct * 0.8);
            const f = 0.5 + 0.5 * rnd.next();
            hc.push(0.35 * f, 0.5 * f, 1.0 * f);
            hs.push(0.18 + rnd.next() * 0.2);
          }
        }
        const haze = makePoints(hp, hc, hs, { brightness: 0.07, nearFade: 0.05, minPx: 0, maxPx: 60 });
        haze.name = `${def.id}-haze`;
        this.clouds.push(haze);
        this.group.add(haze);
      }
    }

    if (def.blackHoleMassSun) {
      const rsPc = (def.blackHoleMassSun * RS_KM_PER_SUN) / KM_PER_AU / AU_PER_PC;
      this.blackHoles.push({ id: `${def.id}-hole`, position: this.position.clone(), rsPc, rot: rotationOf(frame), disc: null });
      this.targets.push({
        id: `${def.id}-hole`,
        name: 'Merkezdeki kara delik',
        fact: "Omega Centauri'nin çekirdeğindeki hızlı yıldızlardan bulunan, en az 8.200 Güneş kütleli ara kütleli kara delik (Häberle ve ark. 2024).",
        kind: 'blackhole',
        position: this.position.clone(),
        range: [0, 3],
        framePc: rsPc * 60,
        priority: 6,
        viewDir: toSun,
        minPc: rsPc * 2.4,
        maxDistPc: 20,
      });
    }
  }

  scaled(): ShaderMaterial[] {
    return [...this.clouds.map((c) => c.material), ...this.glows.map((g) => g.material)];
  }

  update(ctx: DeepContext): void {
    const dist = ctx.camera.position.distanceTo(this.position);
    this.group.visible = dist < this.def.scalePc * 4000;
  }
}
