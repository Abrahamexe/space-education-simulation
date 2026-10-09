import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Vector2,
  type BufferGeometry,
  type Material,
} from 'three';

/**
 * Simple models (metres) for spacecraft without a free 3D model, built from
 * their published layouts: Gaia's 10 m sunshield skirt, Euclid's telescope
 * behind its solar panel, Europa Clipper's 30 m solar wings and 3 m dish,
 * JUICE's two long wings and magnetometer boom.
 */
const mats = () => ({
  gold: new MeshStandardMaterial({ color: 0xc89a3c, metalness: 1, roughness: 0.38 }),
  silver: new MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.3 }),
  white: new MeshStandardMaterial({ color: 0xe6e6e2, metalness: 0, roughness: 0.55 }),
  dish: new MeshStandardMaterial({ color: 0xe6e6e2, metalness: 0, roughness: 0.5, side: DoubleSide }),
  cells: new MeshStandardMaterial({ color: 0x18264a, metalness: 0.4, roughness: 0.3, side: DoubleSide }),
  dark: new MeshStandardMaterial({ color: 0x1c1c1c, metalness: 0.2, roughness: 0.7 }),
});

function add(g: Group, geo: BufferGeometry, m: Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Mesh {
  const mesh = new Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  g.add(mesh);
  return mesh;
}

/** A dish opening towards +y. */
function dish(radius: number, depth: number): LatheGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const r = (i / 12) * radius;
    pts.push(new Vector2(r, depth * (r / radius) ** 2));
  }
  return new LatheGeometry(pts, 32);
}

/** Solar wing along +x from x0: n panels of w × h (m). */
function wing(g: Group, m: ReturnType<typeof mats>, x0: number, n: number, w: number, h: number, dir: 1 | -1, y = 0, z = 0): void {
  add(g, new BoxGeometry(x0, 0.08, 0.08), m.silver, (dir * x0) / 2, y, z);
  for (let i = 0; i < n; i++) add(g, new BoxGeometry(w * 0.97, 0.04, h), m.cells, dir * (x0 + w * (i + 0.5)), y, z);
}

export function buildSchematic(kind: 'gaia' | 'euclid' | 'clipper' | 'juice'): Group {
  const m = mats();
  const g = new Group();
  if (kind === 'gaia') {
    // Sunshield skirt (Ø 10.5 m, cells underneath face the Sun at −y), service module, payload drum.
    add(g, new CylinderGeometry(5.25, 5.25, 0.05, 12), m.cells, 0, 0, 0);
    add(g, new CylinderGeometry(5.2, 5.2, 0.02, 12), m.silver, 0, 0.04, 0);
    add(g, new CylinderGeometry(1.75, 2.1, 1.0, 6), m.gold, 0, 0.55, 0);
    add(g, new CylinderGeometry(1.8, 1.8, 2.0, 24), m.silver, 0, 2.05, 0);
    add(g, new CylinderGeometry(0.5, 0.5, 0.1, 16), m.dark, 0, 1.0, 2.0, Math.PI / 2);
  } else if (kind === 'euclid') {
    // Telescope barrel (+y) with its sunshield / solar panel on the +z side.
    add(g, new CylinderGeometry(1.5, 1.5, 1.2, 6), m.gold, 0, 0.6, 0);
    add(g, new CylinderGeometry(0.85, 0.85, 3.0, 24), m.silver, 0, 2.7, -0.2);
    add(g, new BoxGeometry(3.4, 4.4, 0.08), m.cells, 0, 2.3, 1.15);
    add(g, new BoxGeometry(3.3, 4.3, 0.04), m.white, 0, 2.3, 1.08);
  } else if (kind === 'clipper') {
    // Body, 3 m dish on top (+y), two 5-panel wings (14.5 m each).
    add(g, new CylinderGeometry(0.75, 0.75, 3.0, 16), m.white, 0, 0, 0);
    add(g, new BoxGeometry(1.6, 1.0, 1.6), m.gold, 0, -1.0, 0);
    add(g, dish(1.5, 0.5), m.dish, 0, 1.5, 0);
    add(g, new CylinderGeometry(0.05, 0.05, 0.6, 6), m.silver, 0, 2.0, 0);
    wing(g, m, 1.0, 5, 2.85, 4.1, 1);
    wing(g, m, 1.0, 5, 2.85, 4.1, -1);
    add(g, new CylinderGeometry(0.03, 0.03, 8.5, 6), m.silver, 0, -1.3, 4.3, Math.PI / 2);
  } else {
    // JUICE: box body, 2.5 m dish (+y), two five-panel wings, 10.6 m magnetometer boom.
    add(g, new BoxGeometry(2.5, 3.8, 2.5), m.gold, 0, 0, 0);
    add(g, dish(1.25, 0.35), m.dish, 0, 1.9, 0);
    wing(g, m, 1.3, 5, 2.4, 2.6, 1, -0.5, 0);
    wing(g, m, 1.3, 5, 2.4, 2.6, -1, -0.5, 0);
    add(g, new CylinderGeometry(0.03, 0.03, 10.6, 6), m.silver, 0, 0, 6.5, Math.PI / 2);
  }
  return g;
}
