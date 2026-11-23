import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Data3DTexture,
  DoubleSide,
  Group,
  LinearFilter,
  LineSegments,
  Matrix3,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  RedFormat,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
  Vector3,
} from 'three';
import { unzlibSync } from 'three/addons/libs/fflate.module.js';
import data from '../data/generated/universe.json';
import { CMB_RADIUS_MPC, comovingMpc, EVIDENCE } from '../config/universe';
import lgPhotos from '../data/generated/localgroup.json';
import { DISC_IMAGE, DISC_IMAGE_WIDTH_PC } from '../config/galaxy';
import { GAL } from '../galaxy/GalaxyModel';

import { equatorialToScene } from '../physics/frames';
import galVert from '../shaders/universe/galaxies.vert?raw';
import galFrag from '../shaders/universe/galaxies.frag?raw';
import densVert from '../shaders/universe/density.vert?raw';
import densFrag from '../shaders/universe/density.frag?raw';
import flowVert from '../shaders/universe/flow.vert?raw';
import flowFrag from '../shaders/universe/flow.frag?raw';
import cmbVert from '../shaders/universe/cmb.vert?raw';
import cmbFrag from '../shaders/universe/cmb.frag?raw';
import photoVert from '../shaders/universe/photo.vert?raw';
import photoFrag from '../shaders/universe/photo.frag?raw';
import basinFrag from '../shaders/universe/basin.frag?raw';

/** Galaxies drifting down the flow lines (cinematic flow layer). */
const FLOW_PARTICLES = 14_000;

/** A galaxy picture on a quad; `distMpc` is its distance from the Milky Way. */
export interface GalaxyPhoto {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  name: string;
  widthMpc: number;
}

function photoMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: photoVert,
    fragmentShader: photoFrag,
    uniforms: { uMap: { value: null }, uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

const BASE = `${import.meta.env.BASE_URL}`;

/** Equatorial J2000 unit vector. */
export function radecUnit(raDeg: number, decDeg: number, out = new Vector3()): Vector3 {
  const ra = (raDeg * Math.PI) / 180;
  const de = (decDeg * Math.PI) / 180;
  return out.set(Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de));
}

/** Data frame (equatorial Cartesian) → scene frame, the same orientation as the solar and galaxy scenes. */
export const EQ_TO_SCENE = (() => {
  const x = equatorialToScene(0, 0);
  const y = equatorialToScene(90, 0);
  const z = equatorialToScene(0, 90);
  return new Matrix4().makeBasis(x, y, z);
})();

/** Equatorial → Galactic (rows: the Galactic axes in equatorial coordinates). */
const EQ_TO_GAL = (() => {
  const X = radecUnit(266.405, -28.936);
  const Y = radecUnit(318.004, 48.33);
  const Z = radecUnit(192.8595, 27.1283);
  return new Matrix3().set(X.x, X.y, X.z, Y.x, Y.y, Y.z, Z.x, Z.y, Z.z);
})();

type PointsMat = ShaderMaterial & { uniforms: Record<'uScale' | 'uMinPx' | 'uMaxPx' | 'uBrightness' | 'uCrisp', { value: number }> };

function pointsMaterial(): PointsMat {
  return new ShaderMaterial({
    vertexShader: galVert,
    fragmentShader: galFrag,
    uniforms: { uScale: { value: 1 }, uMinPx: { value: 1 }, uMaxPx: { value: 24 }, uBrightness: { value: 1 }, uCrisp: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  }) as PointsMat;
}

function pointCloud(pos: Float32Array, color: Float32Array, size: Float32Array): Points<BufferGeometry, PointsMat> {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aColor', new BufferAttribute(color, 3));
  g.setAttribute('aSize', new BufferAttribute(size, 1));
  const p = new Points(g, pointsMaterial());
  p.frustumCulled = false;
  return p;
}

const EARLY = [1.0, 0.8, 0.58];
const LATE = [0.68, 0.8, 1.0];

/**
 * The universe map's layers, all in the data frame (equatorial Mpc) inside
 * `group`, which turns them into the scene frame: Local Group members,
 * 2MRS and SDSS galaxies, the dark-matter density volume, the flow lines
 * and the CMB sphere. Built from scripts/build-universe.mjs output; the
 * binary parts load on first use.
 */
export class UniverseModel {
  readonly group = new Group();
  localGroup: Points<BufferGeometry, PointsMat>;
  twoMrs: Points<BufferGeometry, PointsMat> | null = null;
  sdss: Points<BufferGeometry, PointsMat> | null = null;
  density: Mesh<BoxGeometry, ShaderMaterial> | null = null;
  flow: LineSegments<BufferGeometry, ShaderMaterial> | null = null;
  /** Laniakea's boundary (basin of attraction of the Milky Way's flow). */
  basin: Mesh<BoxGeometry, ShaderMaterial> | null = null;
  /** Hot cluster gas (MCXC X-ray clusters): soft pink glows of radius R500. */
  gas: Points<BufferGeometry, PointsMat> | null = null;
  flowParticles: Points<BufferGeometry, PointsMat> | null = null;
  private flowData: Float32Array | null = null;
  private flowStart: Int32Array | null = null;
  private particleLine: Int32Array | null = null;
  private particleT: Float32Array | null = null;
  readonly cmb: Mesh<SphereGeometry, ShaderMaterial>;
  readonly milkyWay: Points<BufferGeometry, PointsMat>;
  private loading: Promise<void> | null = null;
  /** Local Group members drawn from their photos (data frame). */
  readonly photos: GalaxyPhoto[] = [];
  /** Evidence-stop pictures (Bullet Cluster, Abell 1689, Coma), shown near them. */
  readonly evidencePhotos: (GalaxyPhoto & { centre: Vector3 })[] = [];
  /** The Milky Way's own disc (scene frame, outside `group`). */
  readonly milkyWayDisc: Mesh<PlaneGeometry, ShaderMaterial>;
  /** Scene-frame extras (the Milky Way disc); added next to `group`. */
  readonly sceneGroup = new Group();

  constructor() {
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(EQ_TO_SCENE);

    // The Milky Way: a soft glow at the origin.
    this.milkyWay = pointCloud(new Float32Array([0, 0, 0]), new Float32Array([1, 0.9, 0.75]), new Float32Array([0.05]));
    this.milkyWay.material.uniforms.uMinPx.value = 5;

    // Local Group members (McConnachie 2012): size and colour from the V luminosity.
    // Members with a photo are drawn from it, not as a point.
    const withPhoto = new Set(lgPhotos.galaxies.map((g) => g.name));
    const lg = data.localGroup.filter((g) => !withPhoto.has(g.name));
    const pos = new Float32Array(lg.length * 3);
    const col = new Float32Array(lg.length * 3);
    const size = new Float32Array(lg.length);
    const u = new Vector3();
    lg.forEach((g, i) => {
      radecUnit(g.ra, g.dec, u).multiplyScalar(g.dMpc);
      pos.set([u.x, u.y, u.z], i * 3);
      const M = g.vmag ?? -10;
      // Kiloparsecs: dwarfs a few kpc, M31 ~ 40 kpc across.
      // Faint dwarfs: small and dim (most are barely visible even in deep images).
      size[i] = Math.min(0.02, 0.0012 * 10 ** (-0.12 * (M + 10)));
      const k = Math.min(1, Math.max(0.2, 0.2 + (-M - 8) / 10));
      col.set([0.9 * k, 0.85 * k, 0.8 * k], i * 3);
    });
    this.localGroup = pointCloud(pos, col, size);
    this.localGroup.material.uniforms.uMinPx.value = 1.5;

    // The CMB.
    const tex = new TextureLoader().load(`${BASE}textures/universe/cmb.webp`);
    tex.colorSpace = SRGBColorSpace;
    // No mipmaps: they draw seams at the poles and l = 0 of the equirectangular map.
    tex.generateMipmaps = false;
    tex.minFilter = LinearFilter;
    this.cmb = new Mesh(
      new SphereGeometry(CMB_RADIUS_MPC, 128, 64),
      new ShaderMaterial({
        vertexShader: cmbVert,
        fragmentShader: cmbFrag,
        uniforms: { uMap: { value: tex }, uEqToGal: { value: EQ_TO_GAL }, uOpacity: { value: 0 } },
        side: BackSide,
        depthWrite: false,
      }),
    );
    this.cmb.frustumCulled = false;
    this.cmb.renderOrder = -10;

    this.group.add(this.cmb, this.milkyWay, this.localGroup);

    // Local Group photos: each quad faces the Milky Way, north up and east to
    // the left as on the sky, so from home it looks like the photograph.
    const loader = new TextureLoader();
    const dirU = new Vector3();
    const north = new Vector3();
    const west = new Vector3();
    for (const p of lgPhotos.galaxies) {
      const g = data.localGroup.find((x) => x.name === p.name);
      if (!g) continue;
      const W = p.widthPc / 1e6;
      const mesh = new Mesh(new PlaneGeometry(W, W), photoMaterial());
      const ra = (g.ra * Math.PI) / 180;
      const de = (g.dec * Math.PI) / 180;
      radecUnit(g.ra, g.dec, dirU);
      north.set(-Math.sin(de) * Math.cos(ra), -Math.sin(de) * Math.sin(ra), Math.cos(de));
      west.set(Math.sin(ra), -Math.cos(ra), 0);
      const toHome = dirU.clone().negate();
      mesh.matrixAutoUpdate = false;
      // Light-weighted centre of the picture on the galaxy's position.
      const pos = dirU
        .clone()
        .multiplyScalar(g.dMpc)
        .addScaledVector(west, -(p.centre[0] - 0.5) * W)
        .addScaledVector(north, (p.centre[1] - 0.5) * W);
      mesh.matrix.makeBasis(west, north, toHome).setPosition(pos);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.photos.push({ mesh, name: p.name, widthMpc: W });
      this.pendingPhotos.push([mesh, `${BASE}textures/localgroup/${p.file}`]);
    }

    // Evidence stops: their pictures facing the Milky Way, like the Local Group's.
    for (const ev of EVIDENCE) {
      const sp = ev.space;
      if (!sp) continue;
      const d = sp.distMpc ?? comovingMpc(sp.z ?? 0);
      const W = sp.widthMpc;
      const mesh = new Mesh(new PlaneGeometry(W, W / sp.aspect), photoMaterial());
      const ra = (sp.ra * Math.PI) / 180;
      const de = (sp.dec * Math.PI) / 180;
      radecUnit(sp.ra, sp.dec, dirU);
      north.set(-Math.sin(de) * Math.cos(ra), -Math.sin(de) * Math.sin(ra), Math.cos(de));
      west.set(Math.sin(ra), -Math.cos(ra), 0);
      const centre = dirU.clone().multiplyScalar(d);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeBasis(west, north, dirU.clone().negate()).setPosition(centre);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.evidencePhotos.push({ mesh, name: ev.id, widthMpc: W, centre });
      this.pendingPhotos.push([mesh, `${BASE}textures/evidence/${ev.id === 'coma' ? 'coma' : ev.id === 'lensing' ? 'a1689' : 'bullet'}_space.webp`]);
    }

    // The Milky Way: the face-on disc picture in the Galactic plane (scene frame).
    const Wd = DISC_IMAGE_WIDTH_PC / 1e6;
    this.milkyWayDisc = new Mesh(new PlaneGeometry(Wd, Wd), photoMaterial());
    this.milkyWayDisc.matrixAutoUpdate = false;
    const xAxis = GAL.ys.clone().negate();
    const yAxis = GAL.xs.clone().negate();
    this.milkyWayDisc.matrix.makeBasis(xAxis, yAxis, new Vector3().crossVectors(xAxis, yAxis)).setPosition(GAL.centre.clone().multiplyScalar(1e-6));
    this.milkyWayDisc.frustumCulled = false;
    this.milkyWayDisc.visible = false;
    this.pendingPhotos.push([this.milkyWayDisc, `${BASE}${DISC_IMAGE.high}`]);
    this.sceneGroup.add(this.milkyWayDisc);
    this.loader = loader;
  }

  private readonly loader: TextureLoader;
  private readonly pendingPhotos: [Mesh<PlaneGeometry, ShaderMaterial>, string][] = [];

  /** Load the galaxy photos (once). */
  private loadPhotos(): Promise<void> {
    return Promise.all(
      this.pendingPhotos.map(([mesh, url]) =>
        this.loader.loadAsync(url).then((t) => {
          t.colorSpace = SRGBColorSpace;
          mesh.material.uniforms.uMap.value = t;
        }),
      ),
    ).then(() => undefined);
  }

  /** Fetch and build the catalogue layers (once). */
  load(): Promise<void> {
    return (this.loading ??= Promise.all([
      this.loadPhotos().then(() => new ArrayBuffer(0)),
      this.fetch(data.twomrs.file),
      this.fetch(data.sdss.file),
      this.fetch(data.density.file),
      this.fetch(data.flow.file),
      this.fetch(data.basin.file),
      this.fetch(data.gas.file),
    ]).then(([, mrs, sdss, dens, flow, basin, gas]) => {
      this.buildGas(new Float32Array(gas));
      this.build2mrs(new Float32Array(mrs));
      this.buildSdss(new Int16Array(sdss));
      this.buildDensity(unzlibSync(new Uint8Array(dens)));
      this.buildFlow(new Float32Array(flow));
      this.buildBasin(new Uint8Array(basin));
    }));
  }

  private fetch(file: string): Promise<ArrayBuffer> {
    return fetch(`${BASE}data/universe/${file}`).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${file}`);
      return r.arrayBuffer();
    });
  }

  private build2mrs(f: Float32Array): void {
    const n = f.length / 4;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([f[i * 4], f[i * 4 + 1], f[i * 4 + 2]], i * 3);
      const m = f[i * 4 + 3];
      const early = m > 0;
      const M = early ? -m : m;
      col.set(early ? EARLY : LATE, i * 3);
      // Brighter galaxies are bigger: ~15 kpc at M_K = −21, ~60 kpc at −24.
      size[i] = 0.015 * 10 ** (-0.2 * (M + 21));
    }
    this.twoMrs = pointCloud(pos, col, size);
    this.twoMrsBase = pos.slice();
    this.group.add(this.twoMrs);
  }

  /** Redshift-space positions of the 2MRS galaxies, and their shifts to real space (Mpc, along the line of sight). */
  private twoMrsBase: Float32Array | null = null;
  private twoMrsShift: Float32Array | null = null;
  private shiftLoading: Promise<void> | null = null;
  private shiftK = 0;

  /** Move the 2MRS galaxies between redshift space (k = 0) and the reconstructed real space (k = 1). */
  setRealSpace(k: number): Promise<void> {
    this.shiftLoading ??= this.fetch('2mrs_shift.bin').then((b) => void (this.twoMrsShift = new Float32Array(b)));
    return this.shiftLoading.then(() => {
      const p = this.twoMrs;
      const base = this.twoMrsBase;
      const sh = this.twoMrsShift;
      if (!p || !base || !sh || k === this.shiftK) return;
      this.shiftK = k;
      const pos = p.geometry.getAttribute('position') as BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < sh.length; i++) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        const z = base[i * 3 + 2];
        const d = Math.hypot(x, y, z) || 1;
        const s = (sh[i] * k) / d;
        a[i * 3] = x + x * s;
        a[i * 3 + 1] = y + y * s;
        a[i * 3 + 2] = z + z * s;
      }
      pos.needsUpdate = true;
    });
  }

  /**
   * The 2MRS galaxy under a screen point (CSS px), or -1. `toScreen` projects
   * a scene-frame point to CSS px (null when behind the camera).
   */
  pickGalaxy(px: number, py: number, toScreen: (v: Vector3) => { x: number; y: number } | null, maxPx = 9): number {
    const p = this.twoMrs;
    if (!p || !p.visible) return -1;
    const a = (p.geometry.getAttribute('position') as BufferAttribute).array as Float32Array;
    const v = new Vector3();
    let best = -1;
    let bd = maxPx * maxPx;
    for (let i = 0; i < a.length / 3; i++) {
      v.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]).applyMatrix4(EQ_TO_SCENE);
      const s = toScreen(v);
      if (!s) continue;
      const d = (s.x - px) ** 2 + (s.y - py) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Catalogue values for the inspector (loaded on first use). */
  private meta: Promise<{ id: string[]; ra: number[]; dec: number[]; cz: number[]; k: number[]; type: string[] }> | null = null;
  galaxyMeta(): Promise<{ id: string[]; ra: number[]; dec: number[]; cz: number[]; k: number[]; type: string[] }> {
    return (this.meta ??= fetch(`${BASE}data/universe/2mrs_meta.json`).then((r) => r.json()));
  }

  /** Predicted line-of-sight peculiar velocity (km/s) of a 2MRS galaxy (from its real-space shift). */
  galaxyPecVel(i: number): Promise<number> {
    this.shiftLoading ??= this.fetch('2mrs_shift.bin').then((b) => void (this.twoMrsShift = new Float32Array(b)));
    return this.shiftLoading.then(() => -(this.twoMrsShift?.[i] ?? 0) * data.h0);
  }

  private buildSdss(q: Int16Array): void {
    const s = data.sdss.quantMpc;
    const n = q.length / 3;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n).fill(0.025);
    for (let i = 0; i < n * 3; i++) pos[i] = q[i] * s;
    // The equatorial stripe (|Dec| < 6°) bright, the rest dim: seen from the
    // celestial pole it is the classic SDSS slice, Sloan Great Wall included.
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      const sinDec = z / Math.max(Math.hypot(x, y, z), 1e-9);
      const k = Math.abs(sinDec) < 0.105 ? 1.15 : 0.3;
      col.set([0.85 * k, 0.82 * k, 1.0 * k], i * 3);
    }
    this.sdss = pointCloud(pos, col, size);
    this.group.add(this.sdss);
  }

  private buildDensity(d: Uint8Array): void {
    const N = data.density.n;
    const tex = new Data3DTexture(d, N, N, N);
    tex.format = RedFormat;
    tex.type = UnsignedByteType;
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    const H = data.density.halfMpc;
    this.density = new Mesh(
      new BoxGeometry(2 * H, 2 * H, 2 * H),
      new ShaderMaterial({
        vertexShader: densVert,
        fragmentShader: densFrag,
        uniforms: {
          uDensity: { value: tex },
          uCamObj: { value: new Vector3() },
          uHalf: { value: H },
          uIntensity: { value: 1 },
          uScience: { value: 0 },
          uSteps: { value: 144 },
        },
        side: BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    );
    this.density.frustumCulled = false;
    this.density.renderOrder = -5;
    this.group.add(this.density);
  }

  private buildGas(f: Float32Array): void {
    const n = f.length / 5;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([f[i * 5], f[i * 5 + 1], f[i * 5 + 2]], i * 3);
      // Glow out to ~1.5 R500; brighter clusters are hotter and denser.
      size[i] = f[i * 5 + 3] * 1.5;
      const k = Math.min(1.6, 0.35 + 0.6 * Math.sqrt(f[i * 5 + 4]));
      col.set([1.0 * k, 0.42 * k, 0.78 * k], i * 3);
    }
    this.gas = pointCloud(pos, col, size);
    this.gas.visible = false;
    this.group.add(this.gas);
  }

  private buildBasin(m: Uint8Array): void {
    const N = data.basin.n;
    const tex = new Data3DTexture(m, N, N, N);
    tex.format = RedFormat;
    tex.type = UnsignedByteType;
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    const H = data.basin.halfMpc;
    this.basin = new Mesh(
      new BoxGeometry(2 * H, 2 * H, 2 * H),
      new ShaderMaterial({
        vertexShader: densVert,
        fragmentShader: basinFrag,
        uniforms: { uMask: { value: tex }, uCamObj: { value: new Vector3() }, uHalf: { value: H }, uIntensity: { value: 0 } },
        side: BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    );
    this.basin.frustumCulled = false;
    this.basin.renderOrder = -4;
    this.basin.visible = false;
    this.group.add(this.basin);
  }

  /** Move the drifting galaxies along their lines; `rate` scales the pace. */
  updateParticles(dt: number, rate: number): void {
    const p = this.flowParticles;
    const f = this.flowData;
    const start = this.flowStart;
    const line = this.particleLine;
    const tt = this.particleT;
    if (!p || !f || !start || !line || !tt || !p.visible) return;
    const pos = p.geometry.getAttribute('position') as BufferAttribute;
    const arr = pos.array as Float32Array;
    const nLines = start.length - 1;
    for (let i = 0; i < line.length; i++) {
      const l = line[i];
      const n = start[l + 1] - start[l];
      let t = tt[i];
      const k = Math.min(Math.floor(t), n - 2);
      // Points are ~1 Mpc apart: speed in points per second from the flow speed.
      t += dt * rate * (0.6 + f[(start[l] + k) * 4 + 3] / 250);
      if (t >= n - 1) {
        const nl = Math.floor(Math.random() * nLines);
        line[i] = nl;
        t = Math.random() * 3;
      }
      tt[i] = t;
      const L = line[i];
      const m = start[L + 1] - start[L];
      const j = Math.min(Math.floor(t), m - 2);
      const u = t - j;
      const a = (start[L] + j) * 4;
      const b = a + 4;
      arr[i * 3] = f[a] + (f[b] - f[a]) * u;
      arr[i * 3 + 1] = f[a + 1] + (f[b + 1] - f[a + 1]) * u;
      arr[i * 3 + 2] = f[a + 2] + (f[b + 2] - f[a + 2]) * u;
    }
    pos.needsUpdate = true;
  }

  private buildFlow(f: Float32Array): void {
    const lens = data.flow.lengths;
    let segs = 0;
    for (const n of lens) segs += n - 1;
    const pos = new Float32Array(segs * 6);
    const along = new Float32Array(segs * 2);
    const speed = new Float32Array(segs * 2);
    let o = 0;
    let w = 0;
    for (const n of lens) {
      let acc = 0;
      for (let i = 0; i < n - 1; i++) {
        const a = (o + i) * 4;
        const b = a + 4;
        const len = Math.hypot(f[b] - f[a], f[b + 1] - f[a + 1], f[b + 2] - f[a + 2]);
        pos.set([f[a], f[a + 1], f[a + 2], f[b], f[b + 1], f[b + 2]], w * 6);
        along.set([acc, acc + len], w * 2);
        speed.set([f[a + 3], f[b + 3]], w * 2);
        acc += len;
        w++;
      }
      o += n;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aAlong', new BufferAttribute(along, 1));
    g.setAttribute('aSpeed', new BufferAttribute(speed, 1));
    this.flow = new LineSegments(
      g,
      new ShaderMaterial({
        vertexShader: flowVert,
        fragmentShader: flowFrag,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uScience: { value: 0 }, uPeriod: { value: 9 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.flow.frustumCulled = false;
    this.group.add(this.flow);

    // Drifting galaxies: spread over the lines at random phases.
    this.flowData = f;
    const start = new Int32Array(lens.length + 1);
    for (let i = 0; i < lens.length; i++) start[i + 1] = start[i] + lens[i];
    this.flowStart = start;
    this.particleLine = new Int32Array(FLOW_PARTICLES);
    this.particleT = new Float32Array(FLOW_PARTICLES);
    const ppos = new Float32Array(FLOW_PARTICLES * 3);
    const pcol = new Float32Array(FLOW_PARTICLES * 3);
    for (let i = 0; i < FLOW_PARTICLES; i++) {
      const l = Math.floor(Math.random() * lens.length);
      this.particleLine[i] = l;
      this.particleT[i] = Math.random() * (lens[l] - 1);
      const warm = Math.random();
      pcol.set([1.0, 0.75 + 0.2 * warm, 0.5 + 0.4 * warm], i * 3);
    }
    this.flowParticles = pointCloud(ppos, pcol, new Float32Array(FLOW_PARTICLES).fill(0.18));
    this.flowParticles.visible = false;
    this.group.add(this.flowParticles);
  }

  /** Point layers, for per-frame uniforms. */
  get pointLayers(): Points<BufferGeometry, PointsMat>[] {
    return [this.milkyWay, this.localGroup, this.twoMrs, this.sdss, this.flowParticles, this.gas].filter((p): p is Points<BufferGeometry, PointsMat> => !!p);
  }

  /** Camera position in the data frame (for the volume's ray march). */
  toData(scenePos: Vector3, out: Vector3): Vector3 {
    return out.copy(scenePos).applyMatrix4(this.inverse);
  }

  private readonly inverse = new Matrix4().copy(EQ_TO_SCENE).invert();
}
