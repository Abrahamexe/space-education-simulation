import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
  type ShaderMaterial,
} from 'three';
import { scale } from '../core/scale';
import type { Focusable } from '../core/types';
import type { Loader } from '../core/Loader';
import type { AddPreset } from '../config/playground';
import { AnimatedStar, starKind } from '../galaxy/objects/AnimatedStar';
import { PulsarBeams } from '../galaxy/objects/PulsarBeams';
import { makeGlow } from '../galaxy/objects/StarGlow';

const SPHERE = new SphereGeometry(1, 96, 64);
/** Schwarzschild radius per solar mass, km. */
export const RS_KM_PER_SUN = 2.953;

/**
 * What an added body looks like in the Solar System scene: a black hole
 * (ray-traced by the post effect; a faint marker from afar), a pulsar with
 * its beams, a star animated like the Sun, or a textured planet. It sits
 * in `world` at absolute scene coordinates, like the real bodies.
 */
export class AddedView implements Focusable {
  readonly group = new Group();
  readonly radiusKm: number;
  private readonly marker: ReturnType<typeof makeGlow>;
  private star: AnimatedStar | null = null;
  private pulsar: PulsarBeams | null = null;
  private planet: Mesh<SphereGeometry, MeshStandardMaterial> | null = null;
  private readonly absolute = new Vector3();
  private elapsed = 0;
  /** A black hole currently tearing a star apart. */
  feeding = false;
  private readonly tide = new Group();
  private readonly untide = new Group();

  /** Tidal stretch along `dir` by `s` (volume kept); see CelestialBody.setTide. */
  setTide(dir: Vector3 | null, s: number): void {
    if (!dir || s <= 1.0005) {
      this.tide.quaternion.identity();
      this.tide.scale.set(1, 1, 1);
      this.untide.quaternion.identity();
      return;
    }
    this.tide.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), dir);
    const k = 1 / Math.sqrt(s);
    this.tide.scale.set(s, k, k);
    this.untide.quaternion.copy(this.tide.quaternion).invert();
  }

  constructor(
    readonly id: string,
    readonly name: string,
    readonly preset: AddPreset,
    readonly massSun: number,
    world: Group,
    loader: Loader,
  ) {
    this.radiusKm = preset.look === 'hole' ? massSun * RS_KM_PER_SUN : preset.radiusKm;
    this.group.name = `playground-${id}`;
    world.add(this.group);
    const c = preset.color;
    // Point of light while the body is a pixel or two (any type).
    // A quasar outshines everything: a bright beacon even from light-years away.
    const quasar = preset.kind === 'quasar';
    this.marker = makeGlow(c, 1, quasar ? 4 : 1.6, quasar ? 9 : preset.look === 'hole' ? 8 : 5, quasar ? 0.45 : preset.look === 'star' ? 0.3 : 0.1);
    this.group.add(this.marker);

    if (preset.look === 'star') {
      this.star = new AnimatedStar(1, 1, preset.tempK ?? 5772, starKind(preset.tempK ?? 5772, preset.radiusKm / 695_700, false), id.length * 97 + 5);
      this.group.add(this.star.group);
    } else if (preset.look === 'pulsar') {
      this.pulsar = new PulsarBeams({ positionAngleDeg: 30, inclinationDeg: 60, magneticDeg: 40, periodS: 0.089, shownPeriodS: 1.2, beamLengthPc: 1 }, 1, [0.6, 0.78, 1.0], 0.02);
      this.group.add(this.pulsar.group);
    } else if (preset.look === 'planet') {
      const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
      if (preset.texture) {
        void loader
          .load(preset.texture)
          .then((t) => {
            t.colorSpace = SRGBColorSpace;
            mat.map = t;
            mat.needsUpdate = true;
          })
          .catch(() => mat.color.setRGB(c[0], c[1], c[2]));
      } else mat.color.setRGB(c[0], c[1], c[2]);
      this.planet = new Mesh(SPHERE, mat);
      this.tide.add(this.untide);
      this.untide.add(this.planet);
      this.group.add(this.tide);
    }
    this.applyScale();
  }

  /** Largest drawn radius allowed (scene units); see Playground.capHoles. */
  private cap = Infinity;

  /** Visual radius in scene units (the scale system decides, within the cap). */
  get radius(): number {
    return Math.min(scale.radius(Math.max(this.radiusKm, 0.5)), this.cap);
  }

  /** Limit the drawn size (re-applied only when it changes noticeably). */
  setCap(cap: number): void {
    if (Number.isFinite(this.cap) && Math.abs(cap - this.cap) <= this.cap * 0.05) return;
    this.cap = cap;
    this.applyScale();
  }

  /** Re-size after a scale change (cinematic ↔ real). */
  applyScale(): void {
    const r = this.radius;
    if (this.star) {
      this.group.remove(this.star.group);
      this.star = new AnimatedStar(r, 1, this.preset.tempK ?? 5772, this.star.kind, this.id.length * 97 + 5);
      this.group.add(this.star.group);
    }
    if (this.planet) this.planet.scale.setScalar(r);
    if (this.pulsar) {
      // Beams a few hundred stellar radii long, so they read on screen.
      this.pulsar.group.scale.setScalar(Math.max(r * 400, 0.5));
    }
    this.marker.material.uniforms.uRadius.value = Math.max(r * (this.preset.look === 'hole' ? 3 : 1.6), 1e-4);
  }

  setAbsolute(p: Vector3): void {
    this.absolute.copy(p);
    this.group.position.copy(p);
  }

  getAbsolutePosition(out: Vector3): Vector3 {
    return out.copy(this.absolute);
  }

  getRadius(): number {
    return Math.max(this.radius, 1e-4);
  }

  /** Materials needing `uScale` (px per unit at distance 1). */
  scaled(): ShaderMaterial[] {
    const out = [this.marker.material];
    if (this.pulsar) out.push(this.pulsar.glow.material);
    return out;
  }

  /** Heat glow of an added planet (0..1), like the real planets' lava. */
  setHeat(h: number): void {
    if (!this.planet) return;
    this.planet.material.emissive.setRGB(1.0, 0.35, 0.08);
    this.planet.material.emissiveIntensity = h * 1.6;
  }

  update(dt: number, camera: PerspectiveCamera, renderPos: Vector3): void {
    this.elapsed += dt;
    const d = camera.position.distanceTo(renderPos);
    const r = this.radius;
    // The marker guides from afar and steps aside once the body is resolved.
    this.marker.visible = this.preset.look === 'hole' ? d > r * 150 : d > r * 40;
    this.star?.update(dt, this.elapsed, camera);
    this.pulsar?.update(this.elapsed, camera);
    if (this.planet) this.planet.rotation.y += dt * 0.15;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.planet?.material.map?.dispose();
    this.planet?.material.dispose();
  }
}
