import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  MultiplyBlending,
  RedFormat,
  SphereGeometry,
  UnsignedByteType,
  type PerspectiveCamera,
  Group,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three';
import starsVert from '../shaders/galaxy/stars.vert?raw';
import starsFrag from '../shaders/galaxy/stars.frag?raw';
import glowVert from '../shaders/galaxy/glow.vert?raw';
import glowFrag from '../shaders/galaxy/glow.frag?raw';
import bulgeVert from '../shaders/galaxy/bulge.vert?raw';
import bulgeFrag from '../shaders/galaxy/bulge.frag?raw';
import dustVert from '../shaders/galaxy/dust.vert?raw';
import dustFrag from '../shaders/galaxy/dust.frag?raw';
import deepVert from '../shaders/galaxy/deepfield.vert?raw';
import deepFrag from '../shaders/galaxy/deepfield.frag?raw';
import {
  BULGE_HEIGHT_PC,
  DISC_IMAGE_WIDTH_PC,
  DISC_SCALE_HEIGHT_PC,
  GALAXY_VIEW as GV,
  NEIGHBOURHOOD,
  R0_PC,
  SATELLITES,
  Z0_PC,
  type GalaxyMarker,
} from '../config/galaxy';
import { equatorialToScene, galacticToScene } from '../physics/frames';
import { Random } from '../utils/random';

const DEG = Math.PI / 180;
/** Must match LAYERS in glow.frag. */
const DISC_LAYERS = 16;
const DISC_ZMAX_PC = 1400;

/**
 * Galactocentric frame in scene orientation, origin at the Sun (pc).
 * xs: centre → Sun, ys: direction of Galactic rotation at the Sun,
 * n: north Galactic pole. The mid-plane passes Z0 below the Sun.
 */
export const GAL = (() => {
  const toCentre = galacticToScene(0, 0);
  const n = galacticToScene(0, Math.PI / 2);
  const ys = galacticToScene(Math.PI / 2, 0);
  const xs = toCentre.clone().negate();
  const centre = toCentre.clone().multiplyScalar(R0_PC).addScaledVector(n, -Z0_PC);
  return { xs, ys, n, centre };
})();

/**
 * Disc-image coordinates (fractions of the width, y down) → scene pc on the
 * mid-plane, z pc above it. Image right = −ys (l = 270°), image up = −xs
 * (towards the centre), seen from the north pole.
 */
export function imageToScene(nx: number, ny: number, z = 0, out = new Vector3()): Vector3 {
  const W = DISC_IMAGE_WIDTH_PC;
  return out
    .copy(GAL.centre)
    .addScaledVector(GAL.ys, -(nx - 0.5) * W)
    .addScaledVector(GAL.xs, -(0.5 - ny) * W)
    .addScaledVector(GAL.n, z);
}

export function markerPosition(m: GalaxyMarker, out = new Vector3()): Vector3 {
  if (m.ra !== undefined && m.dec !== undefined) return equatorialToScene(m.ra, m.dec, out).multiplyScalar(m.distPc);
  return galacticToScene((m.l ?? 0) * DEG, (m.b ?? 0) * DEG, out).multiplyScalar(m.distPc);
}

type StarPoints = Points<BufferGeometry, ShaderMaterial>;

export function makePoints(
  pos: ArrayLike<number>,
  col: ArrayLike<number>,
  size: ArrayLike<number>,
  o: { brightness: number; nearFade: number; minPx: number; maxPx?: number },
): StarPoints {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(Float32Array.from(pos), 3));
  g.setAttribute('aColor', new BufferAttribute(Float32Array.from(col), 3));
  g.setAttribute('aSize', new BufferAttribute(Float32Array.from(size), 1));
  const pts = new Points(
    g,
    new ShaderMaterial({
      vertexShader: starsVert,
      fragmentShader: starsFrag,
      uniforms: {
        uScale: { value: 1000 },
        uMaxPx: { value: o.maxPx ?? GV.maxPointPx },
        uMinPx: { value: o.minPx },
        uBrightness: { value: o.brightness },
        uNearFade: { value: o.nearFade },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  return pts;
}

/**
 * The galaxy at large: the face-on disc image on the mid-plane, star
 * particles sampled from that image (so the 3-D sparkle and the picture
 * agree, with a thin disc and a puffed-up bulge), a sparse halo, the
 * satellite galaxies, the landmark stars of the solar neighbourhood and
 * the Sun.
 */
export class GalaxyModel {
  readonly group = new Group();
  /** The disc picture as a stack of slices (see glow.frag). */
  readonly discLayers: Mesh<PlaneGeometry, ShaderMaterial>[] = [];
  /** Every point cloud, for the shared per-frame uniforms. */
  readonly points: StarPoints[] = [];
  private discStars: StarPoints | null = null;
  private readonly rnd = new Random(0x6a1a);

  constructor() {
    // Fine grid: the slice weights are interpolated from the vertices.
    const geo = new PlaneGeometry(DISC_IMAGE_WIDTH_PC, DISC_IMAGE_WIDTH_PC, 96, 96);
    // Plane x → image right (−ys), y → image up (−xs), normal → north pole.
    const right = GAL.ys.clone().negate();
    const up = GAL.xs.clone().negate();
    const basis = new Matrix4().makeBasis(right, up, GAL.n);
    const map = { value: null as Texture | null };
    const intensity = { value: 0 };
    const stride = this.sliceStride;
    for (let i = 0; i < DISC_LAYERS; i++) {
      // Same spacing as glow.frag: crowded towards the mid-plane.
      const t = (i / (DISC_LAYERS - 1)) * 2 - 1;
      const z = Math.sign(t) * t * t * DISC_ZMAX_PC;
      const m = new Mesh(
        geo,
        new ShaderMaterial({
          vertexShader: glowVert,
          fragmentShader: glowFrag,
          uniforms: {
            uMap: map,
            uIntensity: intensity,
            uZ: { value: z },
            uZMax: { value: DISC_ZMAX_PC },
            uWidth: { value: DISC_IMAGE_WIDTH_PC },
            uNormal: { value: GAL.n.clone() },
            uStride: stride,
          },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        }),
      );
      m.matrixAutoUpdate = false;
      m.matrix.copy(basis).setPosition(GAL.centre.clone().addScaledVector(GAL.n, z));
      m.frustumCulled = false;
      m.renderOrder = 1;
      m.name = `galaxy-disc-${i}`;
      m.visible = false;
      this.discLayers.push(m);
      this.group.add(m);
    }

    this.addHaloAndSatellites();
    this.addMarkers();
    this.addBulge();
    this.addGlobulars();
    this.addDeepField();
  }

  /** Field clouds (disc stars, halo, satellites) fade in as the camera leaves the neighbourhood. */
  readonly field: StarPoints[] = [];
  private bulge!: Mesh<BoxGeometry, ShaderMaterial>;
  private readonly bulgeInv = new Matrix4();
  private deepField!: Mesh<SphereGeometry, ShaderMaterial>;
  private dust: Mesh<PlaneGeometry, ShaderMaterial> | null = null;

  private add(p: StarPoints, name: string, field = false): void {
    p.name = name;
    p.userData.baseBrightness = p.material.uniforms.uBrightness.value;
    if (field) this.field.push(p);
    this.points.push(p);
    this.group.add(p);
  }

  private addHaloAndSatellites(): void {
    const rnd = this.rnd;
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const p = new Vector3();
    const S = GV.starSizePc;
    for (let i = 0; i < GV.haloStars; i++) {
      p.set(rnd.gaussian(), rnd.gaussian(), rnd.gaussian()).multiplyScalar(9000).add(GAL.centre);
      pos.push(p.x, p.y, p.z);
      col.push(0.9, 0.85, 0.8);
      size.push(S * 0.8);
    }
    for (const sat of SATELLITES) {
      const c = markerPosition(sat);
      for (let i = 0; i < sat.count; i++) {
        p.set(rnd.gaussian(), rnd.gaussian() * 0.6, rnd.gaussian()).multiplyScalar(sat.radiusPc * 0.5).add(c);
        pos.push(p.x, p.y, p.z);
        const t = rnd.next() * 0.5;
        col.push(0.8 + 0.15 * t, 0.85 + 0.1 * t, 1);
        size.push(S * rnd.range(0.7, 1.2));
      }
    }
    this.add(makePoints(pos, col, size, { brightness: GV.brightness * 0.45, nearFade: 40, minPx: 0 }), 'galaxy-halo', true);
  }

  private addMarkers(): void {
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const p = new Vector3();
    for (const m of NEIGHBOURHOOD) {
      if (!m.star) continue;
      markerPosition(m, p);
      pos.push(p.x, p.y, p.z);
      col.push(...m.star);
      size.push(Math.max(0.02, m.distPc * 0.004));
    }
    this.add(makePoints(pos, col, size, { brightness: 1.6, nearFade: 0, minPx: 2.5, maxPx: 10 }), 'galaxy-markers');
    const sun = makePoints([0, 0, 0], [1.0, 0.86, 0.6], [0.02], { brightness: 2.4, nearFade: 0, minPx: 5, maxPx: 10 });
    sun.renderOrder = 3;
    this.add(sun, 'galaxy-sun');
  }

  /** Swap in a (higher-resolution) disc texture. */
  setDiscTexture(tex: Texture): void {
    // The slices share one uniform object.
    this.discLayers[0].material.uniforms.uMap.value = tex;
    this.discOn = true;
    this.applySlices();
  }

  /** Disc slices drawn: every stride-th, mirrored about the mid-plane (glow.vert). */
  private readonly sliceStride = { value: 1 };
  private discOn = false;

  private applySlices(): void {
    const k = this.sliceStride.value;
    const half = DISC_LAYERS / 2;
    this.discLayers.forEach((m, i) => {
      const mirrored = i < half ? i : DISC_LAYERS - 1 - i;
      m.visible = this.discOn && (half - 1 - mirrored) % k === 0;
    });
  }

  /**
   * Fewer slices where they would land on the same pixels anyway: the
   * stride is the largest that keeps the outermost gap between drawn slices
   * under ~1.5 px of parallax anywhere on the disc (face-on or from far away
   * the stack collapses; seen edge-on from close by every slice counts).
   * minStride: quality floor (each slice is a full-disc additive layer).
   */
  updateSlices(camera: PerspectiveCamera, focalPx: number, minStride: number): void {
    const n = GAL.n;
    const probe = this.tmpV;
    const ray = this.tmpV2;
    let worst = 0;
    // Disc centre, four points 12 kpc out and the point under the camera.
    const under = this.tmpV3.copy(camera.position).sub(GAL.centre);
    under.addScaledVector(n, -under.dot(n));
    const pts: [number, number][] = [[0, 0], [12000, 0], [-12000, 0], [0, 12000], [0, -12000]];
    for (let j = 0; j <= pts.length; j++) {
      if (j < pts.length) probe.copy(GAL.centre).addScaledVector(GAL.xs, pts[j][0]).addScaledVector(GAL.ys, pts[j][1]);
      else {
        if (under.length() > 15000) continue;
        probe.copy(GAL.centre).add(under);
      }
      ray.copy(probe).sub(camera.position);
      const d = ray.length();
      if (d < 1e-6) continue;
      const sin = Math.sqrt(Math.max(0, 1 - (ray.dot(n) / d) ** 2));
      worst = Math.max(worst, (sin / d) * focalPx);
    }
    // Outermost gap (pc) between drawn slices for a stride k: z ∝ t², t = ±(1 − 2k/15).
    let k = 8;
    while (k > minStride) {
      const t = 1 - (2 * k) / (DISC_LAYERS - 1);
      const gap = DISC_ZMAX_PC * (1 - t * t);
      if (gap * worst <= 1.5) break;
      k /= 2;
    }
    k = Math.max(k, minStride);
    if (k !== this.sliceStride.value) {
      this.sliceStride.value = k;
      this.applySlices();
    }
  }

  private readonly tmpV = new Vector3();
  private readonly tmpV2 = new Vector3();
  private readonly tmpV3 = new Vector3();

  setDiscIntensity(v: number): void {
    this.discLayers[0].material.uniforms.uIntensity.value = v;
    this.discOn = v > 0.0005 && this.discLayers[0].material.uniforms.uMap.value !== null;
    this.applySlices();
    // Bulge glow and dust lane fade with the disc.
    const k = v / GV.glowIntensity;
    this.bulge.material.uniforms.uIntensity.value = 0.85 * k;
    this.bulge.visible = k > 0.001;
    if (this.dust) {
      this.dust.material.uniforms.uStrength.value = 0.75 * k;
      this.dust.visible = k > 0.001;
    }
  }

  /** Per frame: the bulge needs the camera in its own frame. */
  update(camera: PerspectiveCamera): void {
    if (!this.bulge.visible) return;
    this.bulge.updateMatrixWorld();
    (this.bulge.material.uniforms.uCamObj.value as Vector3).copy(camera.position).applyMatrix4(this.bulgeInv.copy(this.bulge.matrixWorld).invert());
  }

  /** The distant-galaxy background, 0..1. */
  setDeepField(k: number): void {
    this.deepField.material.uniforms.uIntensity.value = 0.55 * k;
    this.deepField.visible = k > 0.002;
  }

  /**
   * Bar and bulge as a real 3-D glow: a Gaussian ellipsoid along the bar
   * (Wegg & Gerhard 2013: half-length about 5 kpc, 27 deg from the Sun to
   * centre line), integrated along each view ray in closed form.
   */
  private addBulge(): void {
    const angle = 27 * DEG;
    const axis = new Vector3().addScaledVector(GAL.xs, Math.cos(angle)).addScaledVector(GAL.ys, Math.sin(angle));
    const side = new Vector3().crossVectors(GAL.n, axis);
    // Plus/minus 3 sigma: along the bar, across it, vertical.
    const size = new Vector3(6 * 1500, 6 * 750, 6 * 520);
    this.bulge = new Mesh(
      new BoxGeometry(1, 1, 1),
      new ShaderMaterial({
        vertexShader: bulgeVert,
        fragmentShader: bulgeFrag,
        uniforms: {
          uCamObj: { value: new Vector3() },
          uSize: { value: size },
          uColor: { value: new Color(1.0, 0.78, 0.52) },
          uIntensity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        side: BackSide,
      }),
    );
    this.bulge.matrixAutoUpdate = false;
    this.bulge.matrix.makeBasis(axis, side, GAL.n).scale(size).setPosition(GAL.centre);
    this.bulge.frustumCulled = false;
    this.bulge.renderOrder = 2;
    this.bulge.name = 'galaxy-bulge';
    this.group.add(this.bulge);
  }

  /** About 150 globular clusters in the halo, concentrated towards the centre (Harris 2010). */
  private addGlobulars(): void {
    const rnd = new Random(0x6c0b);
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const p = new Vector3();
    for (let i = 0; i < 150; i++) {
      // Density falls as r^-3.5 beyond about 1 kpc: r = r0 * u^(-1/2.5).
      const r = Math.min(1200 * Math.pow(Math.max(rnd.next(), 1e-3), -1 / 2.5), 40_000);
      const ct = rnd.range(-1, 1);
      const st = Math.sqrt(1 - ct * ct);
      const ph = rnd.next() * Math.PI * 2;
      p.copy(GAL.centre)
        .addScaledVector(GAL.xs, r * st * Math.cos(ph))
        .addScaledVector(GAL.ys, r * st * Math.sin(ph))
        .addScaledVector(GAL.n, r * ct);
      pos.push(p.x, p.y, p.z);
      col.push(1.0, 0.86, 0.62);
      size.push(45);
    }
    this.add(makePoints(pos, col, size, { brightness: 1.3, nearFade: 20, minPx: 2, maxPx: 8 }), 'galaxy-globulars');
  }

  private addDeepField(): void {
    this.deepField = new Mesh(
      new SphereGeometry(1, 64, 32),
      new ShaderMaterial({
        vertexShader: deepVert,
        fragmentShader: deepFrag,
        uniforms: { uIntensity: { value: 0 } },
        depthWrite: false,
        depthTest: false,
        side: BackSide,
      }),
    );
    this.deepField.frustumCulled = false;
    this.deepField.renderOrder = -10;
    this.deepField.name = 'deep-field';
    this.group.add(this.deepField);
  }

  /** Dust lanes: where the picture is darker than its surroundings, inside the disc. */
  private buildDust(lum: Float32Array, N: number): void {
    const R = 6;
    const blur = new Float32Array(N * N);
    const tmp = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let i = -R; i <= R; i++) acc += lum[j * N + Math.min(Math.max(i, 0), N - 1)];
      for (let i = 0; i < N; i++) {
        tmp[j * N + i] = acc / (2 * R + 1);
        acc += lum[j * N + Math.min(i + R + 1, N - 1)] - lum[j * N + Math.max(i - R, 0)];
      }
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let j = -R; j <= R; j++) acc += tmp[Math.min(Math.max(j, 0), N - 1) * N + i];
      for (let j = 0; j < N; j++) {
        blur[j * N + i] = acc / (2 * R + 1);
        acc += tmp[Math.min(j + R + 1, N - 1) * N + i] - tmp[Math.max(j - R, 0) * N + i];
      }
    }
    const data = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const r = Math.hypot(i / N - 0.5, j / N - 0.5);
        const disc = 1 - Math.min(Math.max((r - 0.36) / 0.08, 0), 1);
        const lane = Math.min(Math.max((blur[k] - lum[k] - 0.015) / 0.12, 0), 1);
        // Plus a faint, smooth layer over the whole inner disc.
        const v = (lane * 0.85 + 0.15 * blur[k]) * disc;
        // Texture rows bottom-up.
        data[(N - 1 - j) * N + i] = Math.round(Math.min(v, 1) * 255);
      }
    }
    const tex = new DataTexture(data, N, N, RedFormat, UnsignedByteType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.needsUpdate = true;
    const right = GAL.ys.clone().negate();
    const up = GAL.xs.clone().negate();
    const mesh = new Mesh(
      new PlaneGeometry(DISC_IMAGE_WIDTH_PC, DISC_IMAGE_WIDTH_PC),
      new ShaderMaterial({
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        uniforms: { uDust: { value: tex }, uStrength: { value: 0 }, uNormal: { value: GAL.n.clone() } },
        transparent: true,
        depthWrite: false,
        blending: MultiplyBlending,
        premultipliedAlpha: true,
        side: DoubleSide,
      }),
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(new Matrix4().makeBasis(right, up, GAL.n).setPosition(GAL.centre));
    mesh.frustumCulled = false;
    // After the disc light and its stars, so the lane shows edge-on.
    mesh.renderOrder = 2.5;
    mesh.name = 'galaxy-dust';
    mesh.visible = false;
    this.dust = mesh;
    this.group.add(mesh);
  }

  /**
   * Disc stars from the image: positions drawn with probability rising with
   * the pixel's brightness, colours from the pixel. Thickness: a thin disc,
   * puffing up into the bulge near the centre.
   */
  buildDiscStars(image: CanvasImageSource): void {
    if (this.discStars) return;
    const N = 512;
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const g2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!g2d) return;
    g2d.drawImage(image, 0, 0, N, N);
    const px = g2d.getImageData(0, 0, N, N).data;
    const lum = new Float32Array(N * N);
    let maxL = 0;
    for (let i = 0; i < N * N; i++) {
      const l = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / (3 * 255);
      lum[i] = l;
      if (l > maxL) maxL = l;
    }
    this.buildDust(lum, N);
    const rnd = this.rnd;
    const count = GV.discStars;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const p = new Vector3();
    const toLinear = (c: number) => Math.pow(c / 255, 2.2);
    const S = GV.starSizePc;
    let n = 0;
    for (let guard = 0; n < count && guard < count * 60; guard++) {
      const fx = rnd.next();
      const fy = rnd.next();
      const i = Math.min(N - 1, Math.floor(fy * N)) * N + Math.min(N - 1, Math.floor(fx * N));
      const l = lum[i] / (maxL || 1);
      if (l < 0.04 || rnd.next() > Math.pow(l, 1.6)) continue;
      // Radius from the centre (pc) sets the thickness: bulge vs thin disc.
      const r = Math.hypot(fx - 0.5, fy - 0.5) * DISC_IMAGE_WIDTH_PC;
      const bulge = Math.max(0, 1 - r / 2600);
      const sigma = DISC_SCALE_HEIGHT_PC * 0.35 + bulge * bulge * BULGE_HEIGHT_PC;
      imageToScene(fx, fy, rnd.gaussian() * sigma, p);
      pos.set([p.x, p.y, p.z], n * 3);
      const rr = toLinear(px[i * 4]);
      const gg = toLinear(px[i * 4 + 1]);
      const bb = toLinear(px[i * 4 + 2]);
      const m = Math.max(rr, gg, bb, 1e-4);
      const k = 0.55 + 0.45 * l;
      col.set([(rr / m) * k, (gg / m) * k, (bb / m) * k], n * 3);
      size[n] = S * rnd.range(0.5, 1.25);
      n++;
    }
    const pts = makePoints(pos.subarray(0, n * 3), col.subarray(0, n * 3), size.subarray(0, n), {
      brightness: GV.brightness * 0.22,
      nearFade: 40,
      minPx: 0,
    });
    this.discStars = pts;
    this.add(pts, 'galaxy-disc-stars', true);
  }
}
