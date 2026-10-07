import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { PulsarDef } from '../../config/deepsky';
import { equatorialToScene } from '../../physics/frames';
import { Random } from '../../utils/random';
import { makePoints } from '../GalaxyModel';
import { DEG, skyFrame, type BlackHoleInfo, type DeepContext, type DeepObject, type DeepTarget, type StarPoints } from './common';
import { PulsarBeams } from './PulsarBeams';

/**
 * A lone pulsar at beam scale: the neutron star (a point of light — it is
 * only ~20 km across), its sweeping beams, and what surrounds it: Vela's
 * Chandra-imaged wind nebula (a bright torus round the spin axis with jets
 * along it), or for a magnetar, its enormous dipole field and the giant
 * flares that make it famous.
 */
export class PulsarObject implements DeepObject {
  readonly group = new Group();
  readonly targets: DeepTarget[] = [];
  readonly blackHoles: BlackHoleInfo[] = [];
  readonly position: Vector3;
  private readonly beams: PulsarBeams;
  private wind: StarPoints | null = null;
  private field: LineSegments | null = null;
  private flare: Mesh<SphereGeometry, ShaderMaterial> | null = null;
  private readonly spinAxis: Vector3;

  constructor(readonly def: PulsarDef) {
    const dir = equatorialToScene(def.ra, def.dec);
    this.position = dir.clone().multiplyScalar(def.distPc);
    const frame: Matrix4 = skyFrame(dir, this.position);
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(frame);
    this.group.name = `deepsky-${def.id}`;

    const s = def.spin;
    this.beams = new PulsarBeams(s, s.beamLengthPc, def.magnetar ? [1.0, 0.7, 0.95] : [0.6, 0.78, 1.0], s.beamLengthPc * 0.012);
    this.group.add(this.beams.group);
    const pa = s.positionAngleDeg * DEG;
    const zeta = s.inclinationDeg * DEG;
    this.spinAxis = new Vector3(-Math.sin(pa) * Math.sin(zeta), Math.cos(pa) * Math.sin(zeta), Math.cos(zeta));

    if (def.windNebulaPc) this.addWind(def.windNebulaPc);
    if (def.magnetar) this.addMagnetar(s.beamLengthPc * 0.6);

    const north = new Vector3().setFromMatrixColumn(frame, 1).normalize();
    this.targets.push({
      id: def.id,
      name: def.name,
      fact: def.facts.text,
      facts: def.facts,
      kind: 'pulsar',
      category: def.category,
      position: this.position,
      range: [0, 6000],
      framePc: def.framePc,
      priority: 8,
      viewDir: dir.clone().negate().addScaledVector(north, 0.35).normalize(),
      minPc: def.framePc * 0.05,
      maxDistPc: 4000,
      distPc: def.distPc,
    });
  }

  /** Pulsar wind nebula: equatorial torus + polar jets (Chandra's Vela picture). */
  private addWind(size: number): void {
    const rnd = new Random(0x7e1a);
    const n = 9000;
    const pos: number[] = [];
    const col: number[] = [];
    const sz: number[] = [];
    const up = this.spinAxis;
    const a = new Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
    const b = new Vector3().crossVectors(up, a);
    const p = new Vector3();
    for (let i = 0; i < n; i++) {
      if (i < n * 0.65) {
        // Two nested rings in the equatorial plane.
        const r = size * (rnd.next() < 0.6 ? 0.55 : 1) * (1 + rnd.gaussian() * 0.08);
        const t = rnd.next() * Math.PI * 2;
        p.copy(a).multiplyScalar(Math.cos(t) * r).addScaledVector(b, Math.sin(t) * r).addScaledVector(up, rnd.gaussian() * size * 0.05);
      } else {
        // Jets along the spin axis, slightly wiggling.
        const sgn = rnd.next() < 0.5 ? -1 : 1;
        const h = rnd.next() * size * 1.8;
        p.copy(up).multiplyScalar(sgn * h).addScaledVector(a, Math.sin(h / size * 3) * size * 0.08 + rnd.gaussian() * size * 0.03).addScaledVector(b, rnd.gaussian() * size * 0.03);
      }
      pos.push(p.x, p.y, p.z);
      const w = 0.6 + 0.4 * rnd.next();
      col.push(0.55 * w, 0.7 * w, 1.0 * w);
      sz.push(size * 0.022);
    }
    this.wind = makePoints(pos, col, sz, { brightness: 0.18, nearFade: 0, minPx: 0, maxPx: 14 });
    this.wind.name = `${this.def.id}-wind`;
    this.group.add(this.wind);
  }

  /** Magnetar: dipole field lines (r = L sin²θ) round the magnetic axis, and a giant-flare flash. */
  private addMagnetar(L: number): void {
    const pts: number[] = [];
    const lines = 14;
    for (let k = 0; k < lines; k++) {
      const phi = (k / lines) * Math.PI * 2;
      const Lk = L * (0.45 + 0.55 * ((k * 5) % 7) / 6);
      let prev: Vector3 | null = null;
      for (let j = 1; j < 64; j++) {
        const th = (j / 64) * Math.PI;
        const r = Lk * Math.sin(th) ** 2;
        const v = new Vector3(r * Math.sin(th) * Math.cos(phi), r * Math.cos(th), r * Math.sin(th) * Math.sin(phi));
        if (prev) pts.push(prev.x, prev.y, prev.z, v.x, v.y, v.z);
        prev = v;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    this.field = new LineSegments(g, new LineBasicMaterial({ color: 0xd88cff, transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending }));
    this.field.frustumCulled = false;
    // Align its axis with the beams' magnetic axis (inside the rotor).
    const tiltHolder = this.beams.group.children.find((c) => c.type === 'Group');
    const rotor = tiltHolder?.children[0];
    const tilt = rotor?.children[0];
    (tilt ?? this.group).add(this.field);

    this.flare = new Mesh(
      new SphereGeometry(1, 48, 32),
      new ShaderMaterial({
        uniforms: { uAlpha: { value: 0 }, uColor: { value: new Color(1.0, 0.75, 1.0) } },
        vertexShader: `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          uniform float uAlpha; uniform vec3 uColor;
          varying vec3 vN; varying vec3 vV;
          void main() {
            #include <logdepthbuf_fragment>
            float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
            vec3 c = uColor * uAlpha * (0.15 + rim);
            if (!(max(c.r, max(c.g, c.b)) >= 0.0005)) discard;
            gl_FragColor = vec4(c, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.flare.frustumCulled = false;
    this.group.add(this.flare);
  }

  scaled(): ShaderMaterial[] {
    const out: ShaderMaterial[] = [this.beams.glow.material];
    if (this.wind) out.push(this.wind.material);
    return out;
  }

  update(ctx: DeepContext): void {
    const dist = ctx.camera.position.distanceTo(this.position);
    this.group.visible = dist < 60;
    if (!this.group.visible) return;
    this.beams.update(ctx.elapsed, ctx.camera);
    if (this.flare) {
      // A giant flare every 14 s: a flash and an expanding shell.
      const t = (ctx.elapsed % 14) / 14;
      const r = this.def.spin.beamLengthPc * (0.05 + 1.6 * t);
      this.flare.scale.setScalar(r);
      this.flare.material.uniforms.uAlpha.value = t < 0.6 ? 2.2 * (1 - t / 0.6) ** 2 : 0;
      this.beams.glow.material.uniforms.uIntensity.value += t < 0.03 ? 60 : 0;
    }
  }
}
