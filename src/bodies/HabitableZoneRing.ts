import { AdditiveBlending, DoubleSide, Mesh, RingGeometry, ShaderMaterial } from 'three';
import hzVert from '../shaders/common/hz.vert?raw';
import hzFrag from '../shaders/common/hz.frag?raw';
import type { HabitableZone } from '../physics/habitable';

/**
 * A habitable-zone band in its local XY plane. `map` turns AU into the
 * band's units (identity in AU groups; the Solar System's scale mapping
 * for the solar view), so the band always lines up with the orbits drawn
 * through the same mapping.
 */
export class HabitableZoneRing {
  readonly mesh: Mesh<RingGeometry, ShaderMaterial>;

  constructor(
    private zone: HabitableZone,
    private map: (au: number) => number = (au) => au,
  ) {
    this.mesh = new Mesh(
      new RingGeometry(1, 2, 256, 1),
      new ShaderMaterial({
        vertexShader: hzVert,
        fragmentShader: hzFrag,
        uniforms: {
          uOptIn: { value: 0 },
          uConsIn: { value: 0 },
          uConsOut: { value: 0 },
          uOptOut: { value: 0 },
          uOpacity: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    this.mesh.name = 'habitable-zone';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.rebuild();
  }

  /** Re-derive radii (after a scale-mode change, say). */
  rebuild(map = this.map, zone = this.zone): void {
    this.map = map;
    this.zone = zone;
    const z = this.zone;
    const m = this.map;
    const inner = m(z.optimisticInner) * 0.97;
    const outer = m(z.optimisticOuter) * 1.03;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new RingGeometry(inner, outer, 256, 1);
    const u = this.mesh.material.uniforms;
    u.uOptIn.value = m(z.optimisticInner);
    u.uConsIn.value = m(z.conservativeInner);
    u.uConsOut.value = m(z.conservativeOuter);
    u.uOptOut.value = m(z.optimisticOuter);
  }
}
