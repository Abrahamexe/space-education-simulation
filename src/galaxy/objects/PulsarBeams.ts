import { AdditiveBlending, Color, ConeGeometry, DoubleSide, Group, Mesh, ShaderMaterial, Vector3, type PerspectiveCamera } from 'three';
import beamVert from '../../shaders/deepsky/beam.vert?raw';
import beamFrag from '../../shaders/deepsky/beam.frag?raw';
import type { PulsarSpin } from '../../config/deepsky';
import { DEG } from './common';
import { makeGlow } from './StarGlow';

/**
 * A pulsar: the neutron star as a point of light and two radio beams along
 * its magnetic axis, swept round the spin axis (shown slowed down). The
 * spin axis is set from its position angle and inclination on the sky, in
 * the parent's sky frame (x west, y north, z towards us). The star flashes
 * whenever a beam sweeps over the camera — the lighthouse effect that
 * makes it a pulsar.
 */
export class PulsarBeams {
  readonly group = new Group();
  readonly glow;
  private readonly rotor = new Group();
  private readonly beams: Mesh<ConeGeometry, ShaderMaterial>[] = [];
  private readonly baseIntensity: number;
  private readonly tmp = new Vector3();
  private readonly toCam = new Vector3();

  constructor(
    readonly spin: PulsarSpin,
    /** Beam length, parent units. */
    length: number,
    color: readonly [number, number, number] = [0.6, 0.78, 1.0],
    glowRadius = length * 0.01,
  ) {
    this.baseIntensity = 1.6;
    this.glow = makeGlow(color, glowRadius, this.baseIntensity, 9, 0.35);
    this.group.add(this.glow);

    const pa = spin.positionAngleDeg * DEG;
    const zeta = spin.inclinationDeg * DEG;
    // East is −x in the sky frame.
    const axis = new Vector3(-Math.sin(pa) * Math.sin(zeta), Math.cos(pa) * Math.sin(zeta), Math.cos(zeta));
    const spinGroup = new Group();
    spinGroup.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), axis);
    spinGroup.add(this.rotor);
    const tilt = new Group();
    tilt.rotation.x = spin.magneticDeg * DEG;
    this.rotor.add(tilt);

    for (const sign of [1, -1]) {
      const g = new ConeGeometry(Math.tan(6 * DEG) * length, length, 48, 1, true);
      g.translate(0, -length / 2, 0); // apex at the origin, opening towards −Y
      if (sign > 0) g.rotateX(Math.PI);
      const m = new Mesh(
        g,
        new ShaderMaterial({
          vertexShader: beamVert,
          fragmentShader: beamFrag,
          uniforms: { uLength: { value: length }, uColor: { value: new Color(color[0], color[1], color[2]) }, uIntensity: { value: 2.4 } },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        }),
      );
      m.frustumCulled = false;
      m.renderOrder = 5;
      m.userData.sign = sign;
      tilt.add(m);
      this.beams.push(m);
    }
    this.group.add(spinGroup);
  }

  update(elapsed: number, camera: PerspectiveCamera): void {
    this.rotor.rotation.y = ((elapsed / this.spin.shownPeriodS) % 1) * Math.PI * 2;
    this.group.updateMatrixWorld(true);
    this.glow.getWorldPosition(this.tmp);
    this.toCam.copy(camera.position).sub(this.tmp).normalize();
    let flash = 0;
    for (const b of this.beams) {
      this.tmp.set(0, b.userData.sign as number, 0).transformDirection(b.matrixWorld);
      flash = Math.max(flash, Math.pow(Math.max(0, this.tmp.dot(this.toCam)), 60));
    }
    this.glow.material.uniforms.uIntensity.value = this.baseIntensity + 25 * flash;
  }
}
