import { AdditiveBlending, Color, CylinderGeometry, Group, Mesh, ShaderMaterial, Vector3 } from 'three';

/**
 * Gas boiling off a planet under fierce radiation: a faint tail streaming
 * away from the source, as observed behind hot exoplanets (GJ 436 b's
 * hydrogen cloud, the dusty tails of disintegrating K2-22 b). It starts as
 * wide as the planet and fades outwards; its length and brightness grow
 * with the mass-loss rate.
 */

// Top (y = +0.5) at the planet, as wide as it; the far end 2.5× wider.
const GEO = new CylinderGeometry(1, 2.5, 1, 32, 8, true);

const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <logdepthbuf_fragment>
  // Bright at the planet, fading outwards; brighter through the middle of the column.
  float along = pow(clamp(vUv.y, 0.0, 1.0), 2.4);
  float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.5);
  float a = along * core * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const UP_NEG = new Vector3(0, -1, 0);

export class Outflow {
  private readonly group = new Group();
  private readonly tails = new Map<string, Mesh<CylinderGeometry, ShaderMaterial>>();

  constructor(world: Group) {
    this.group.name = 'playground-outflows';
    world.add(this.group);
  }

  /**
   * Show (or update) the tail of `id`: planet centre and source position in
   * absolute scene units, the planet's drawn radius, mass loss in kg/s and
   * whether it is air (bluish) or rock vapour (orange).
   */
  set(id: string, planet: Vector3, source: Vector3, radius: number, mdot: number, air: boolean): void {
    // Below ~10⁸ kg/s (a million times the Earth's own leak) there is nothing to see.
    const strength = Math.log10(Math.max(mdot, 1) / 1e8) / 5;
    if (strength <= 0) {
      this.hide(id);
      return;
    }
    let mesh = this.tails.get(id);
    if (!mesh) {
      mesh = new Mesh(
        GEO,
        new ShaderMaterial({
          vertexShader: vert,
          fragmentShader: frag,
          uniforms: { uColor: { value: new Color() }, uIntensity: { value: 0 } },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.tails.set(id, mesh);
    }
    const k = Math.min(strength, 1);
    const length = radius * (4 + 26 * k);
    const dir = planet.clone().sub(source);
    if (dir.lengthSq() < 1e-20) return;
    dir.normalize();
    mesh.visible = true;
    mesh.quaternion.setFromUnitVectors(UP_NEG, dir);
    mesh.scale.set(radius, length, radius);
    mesh.position.copy(planet).addScaledVector(dir, length / 2);
    mesh.material.uniforms.uIntensity.value = 0.12 + 0.33 * k;
    (mesh.material.uniforms.uColor.value as Color).setRGB(air ? 0.55 : 1.0, air ? 0.7 : 0.55, air ? 1.0 : 0.3);
  }

  hide(id: string): void {
    const m = this.tails.get(id);
    if (m) m.visible = false;
  }

  clear(): void {
    for (const m of this.tails.values()) {
      m.material.dispose();
      m.removeFromParent();
    }
    this.tails.clear();
  }
}
