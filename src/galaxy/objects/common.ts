import { Color, Matrix3, Matrix4, Vector3, type BufferGeometry, type Object3D, type PerspectiveCamera, type Points, type ShaderMaterial } from 'three';
import type { DiscLook } from '../../core/effects/BlackHoleEffect';
import type { BinaryOrbit, Category, Facts } from '../../config/deepsky';
import { solveKepler } from '../../physics/orbits';
import { equatorialToScene } from '../../physics/frames';

export const DEG = Math.PI / 180;
const ICRF_POLE = equatorialToScene(0, 90);

export type StarPoints = Points<BufferGeometry, ShaderMaterial>;

/**
 * Sky-aligned frame at a point seen from the Sun: X = image right (west),
 * Y = celestial north, Z = towards the Sun. A Hubble picture laid in the XY
 * plane then looks from the Sun exactly as it does on the sky.
 */
export function skyFrame(dirFromSun: Vector3, position: Vector3): Matrix4 {
  const toSun = dirFromSun.clone().normalize().negate();
  const north = ICRF_POLE.clone().addScaledVector(toSun, -ICRF_POLE.dot(toSun)).normalize();
  const right = dirFromSun.clone().normalize().cross(north).normalize();
  return new Matrix4().makeBasis(right, north, toSun).setPosition(position);
}

/** Something the galaxy HUD can label and fly to. */
export interface DeepTarget {
  id: string;
  name: string;
  /** Card text (falls back to `fact`). */
  facts?: Facts;
  fact: string;
  kind: 'nebula' | 'galaxy' | 'blackhole' | 'star' | 'pulsar' | 'system' | 'cluster' | 'planet';
  category?: Category;
  position: Vector3;
  range: readonly [number, number];
  framePc: number;
  priority: number;
  /** Arrive from this side (world, unit). */
  viewDir?: Vector3;
  /** Camera up on arrival (world). */
  up?: Vector3;
  /** Closest useful zoom (pc). */
  minPc?: number;
  /** Label only within this camera distance (pc). */
  maxDistPc?: number;
  /** Distance from the Sun for the card (pc). */
  distPc?: number;
}

/** A black hole the screen effect can ray-trace. */
export interface BlackHoleInfo {
  id: string;
  /** World position (pc). */
  position: Vector3;
  /** Schwarzschild radius (pc). */
  rsPc: number;
  /** Hole frame → world rotation; the disc lies in the frame's y = 0 plane. */
  rot: Matrix3;
  disc: DiscLook | null;
  /**
   * Painted Milky Way sky in the lensed background (default 1.4). Far from
   * the Galaxy it would be wrong: there the rendered deep field shows.
   */
  skyGain?: number;
}

export interface DeepContext {
  camera: PerspectiveCamera;
  /** Real seconds since the last frame / since start. */
  dt: number;
  elapsed: number;
}

/** A destination in the galaxy scene. */
export interface DeepObject {
  readonly group: Object3D;
  readonly targets: DeepTarget[];
  readonly blackHoles: BlackHoleInfo[];
  /** Materials with a `uScale` uniform (px per unit at distance 1), set every frame. */
  scaled(): ShaderMaterial[];
  update(ctx: DeepContext): void;
}

/** Approximate blackbody colour (linear RGB, max channel 1) for a temperature. */
export function temperatureColor(K: number, out = new Color()): Color {
  // Tanner Helland's fit, then to linear.
  const t = Math.min(Math.max(K, 1000), 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  const lin = (c: number) => Math.pow(Math.min(Math.max(c, 0), 255) / 255, 2.2);
  out.setRGB(lin(r), lin(g), lin(b));
  const m = Math.max(out.r, out.g, out.b);
  return out.multiplyScalar(1 / m);
}

/**
 * Relative position of a visual-binary companion at decimal year `year`,
 * in the sky frame (x west, y north, z towards us), same units as a.
 */
export function binaryOffset(o: BinaryOrbit, year: number, out = new Vector3()): Vector3 {
  const M = (2 * Math.PI * (year - o.tP)) / o.periodYears;
  const E = solveKepler(M, o.e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + o.e) * Math.sin(E / 2), Math.sqrt(1 - o.e) * Math.cos(E / 2));
  const r = o.aAu * (1 - o.e * Math.cos(E));
  const u = o.omegaDeg * DEG + nu;
  const O = o.OmegaDeg * DEG;
  const i = o.iDeg * DEG;
  const north = r * (Math.cos(u) * Math.cos(O) - Math.sin(u) * Math.sin(O) * Math.cos(i));
  const east = r * (Math.cos(u) * Math.sin(O) + Math.sin(u) * Math.cos(O) * Math.cos(i));
  const away = r * Math.sin(u) * Math.sin(i);
  return out.set(-east, north, -away);
}

/** Decimal year now. */
export function yearNow(): number {
  const d = new Date();
  return d.getUTCFullYear() + (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / (365.25 * 86_400_000);
}

/** Rotation part of a matrix as a Matrix3 (columns normalised: drops any scale). */
export function rotationOf(m: Matrix4): Matrix3 {
  const x = new Vector3().setFromMatrixColumn(m, 0).normalize();
  const y = new Vector3().setFromMatrixColumn(m, 1).normalize();
  const z = new Vector3().setFromMatrixColumn(m, 2).normalize();
  return new Matrix3().set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
}
