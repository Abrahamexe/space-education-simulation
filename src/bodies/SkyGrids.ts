import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, LineSegments, ShaderMaterial, Vector3 } from 'three';
import gridVert from '../shaders/sky/grid.vert?raw';
import gridFrag from '../shaders/sky/grid.frag?raw';
import { equatorialToScene, galacticToScene } from '../physics/frames';

type Rgb = [number, number, number];

/** Polyline through points from f(t), t ∈ [0, 1], as line segments. */
function curve(pos: number[], col: number[], c: Rgb, steps: number, f: (t: number, out: Vector3) => Vector3): void {
  const a = new Vector3();
  const b = new Vector3();
  f(0, a);
  for (let i = 1; i <= steps; i++) {
    f(i / steps, b);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    col.push(...c, ...c);
    a.copy(b);
  }
}

function lines(pos: number[], col: number[], opacity: number): LineSegments<BufferGeometry, ShaderMaterial> {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  const l = new LineSegments(
    g,
    new ShaderMaterial({
      vertexShader: gridVert,
      fragmentShader: gridFrag,
      uniforms: { uOpacity: { value: opacity } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    }),
  );
  l.frustumCulled = false;
  l.renderOrder = -5;
  l.visible = false;
  return l;
}

/**
 * Reference circles on the sky for the curious (developer panel):
 * equatorial grid (right ascension every hour, declination every 15°, the
 * celestial equator brighter), the ecliptic and the galactic equator.
 */
export class SkyGrids {
  readonly group = new Group();
  readonly equatorial: LineSegments<BufferGeometry, ShaderMaterial>;
  readonly ecliptic: LineSegments<BufferGeometry, ShaderMaterial>;
  readonly galactic: LineSegments<BufferGeometry, ShaderMaterial>;

  constructor(sky: Group) {
    const pos: number[] = [];
    const col: number[] = [];
    const dim: Rgb = [0.35, 0.55, 0.9];
    const eq: Rgb = [0.55, 0.8, 1.0];
    for (let h = 0; h < 24; h++) curve(pos, col, dim, 72, (t, o) => equatorialToScene(h * 15, -89 + t * 178, o));
    for (let d = -75; d <= 75; d += 15) curve(pos, col, d === 0 ? eq : dim, 180, (t, o) => equatorialToScene(t * 360, d, o));
    this.equatorial = lines(pos, col, 0.22);

    const ep: number[] = [];
    const ec: number[] = [];
    // The scene frame is the ecliptic with y up: the ecliptic is the y = 0 circle.
    curve(ep, ec, [1.0, 0.78, 0.4], 360, (t, o) => o.set(Math.cos(t * Math.PI * 2), 0, Math.sin(t * Math.PI * 2)));
    this.ecliptic = lines(ep, ec, 0.45);

    const gp: number[] = [];
    const gc: number[] = [];
    curve(gp, gc, [0.85, 0.55, 1.0], 360, (t, o) => galacticToScene(t * Math.PI * 2, 0, o));
    this.galactic = lines(gp, gc, 0.4);

    this.group.add(this.equatorial, this.ecliptic, this.galactic);
    this.group.name = 'sky-grids';
    sky.add(this.group);
  }

  get opacity(): number {
    return this.equatorial.material.uniforms.uOpacity.value / 0.22;
  }

  /** One brightness for all three (relative to their defaults). */
  set opacity(k: number) {
    this.equatorial.material.uniforms.uOpacity.value = 0.22 * k;
    this.ecliptic.material.uniforms.uOpacity.value = 0.45 * k;
    this.galactic.material.uniforms.uOpacity.value = 0.4 * k;
  }
}
