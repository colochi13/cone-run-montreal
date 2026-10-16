import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glassTexture } from "./textures";

/**
 * Procedural Montréal landmarks. Everything is modelled in real-world metres and the caller scales
 * each group down for the backdrop ("diorama scale") so the whole skyline fits above the street canyon.
 */

type Rng = () => number;

export type Landmarks = {
  /** Everything for the far backdrop. Origin = street axis; -z is straight down the street. */
  group: THREE.Group;
  /** The part of the backdrop that slides sideways as you run, as if the street gently curves. */
  drift: THREE.Group;
  /** Y of the river surface in world units. */
  waterY: number;
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  texs: THREE.Texture[];
  /** Advance animated bits (beacon, water shimmer). */
  update: (t: number) => void;
};

class Kit {
  geos: THREE.BufferGeometry[] = [];
  mats: THREE.Material[] = [];
  texs: THREE.Texture[] = [];
  private dummy = new THREE.Object3D();

  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  std(color: string, rough = 0.8, metal = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
    this.mats.push(m);
    return m;
  }

  tex<T extends THREE.Texture>(t: T): T {
    this.texs.push(t);
    return t;
  }

  /** A square-section beam between two points, as raw geometry for merging. */
  beam(out: THREE.BufferGeometry[], a: THREE.Vector3, b: THREE.Vector3, t: number, t2 = t) {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(t, t2, Math.max(0.001, len));
    this.dummy.position.copy(a).add(b).multiplyScalar(0.5);
    this.dummy.up.set(0, 1, 0);
    this.dummy.lookAt(b);
    this.dummy.updateMatrix();
    g.applyMatrix4(this.dummy.matrix);
    out.push(g);
  }

  merged(list: THREE.BufferGeometry[], mat: THREE.Material, shadow = false) {
    const g = this.geo(mergeGeometries(list, false));
    list.forEach((x) => x.dispose());
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow;
    return m;
  }

  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
    const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    return m;
  }
}

// ---------------------------------------------------------------- Jacques Cartier Bridge

function buildBridge(k: Kit) {
  const g = new THREE.Group();
  const steel = k.std("#6e9b86", 0.5, 0.45);
  const steelDark = k.std("#557a69", 0.55, 0.4);
  const concrete = k.std("#aaa69d", 0.95);
  const deckMat = k.std("#2e3033", 0.92);
  const HALF_W = 10;
  const PANEL = 12.5;
  const N = 14;
  const depthAt = (x: number) => {
    const ax = Math.abs(x);
    if (ax <= 75) return 12 + 24 * Math.pow(ax / 75, 1.6);
    return 36 - 24 * Math.pow(Math.min(1, (ax - 75) / 100), 1.15);
  };

  const chords: THREE.BufferGeometry[] = [];
  const webs: THREE.BufferGeometry[] = [];
  const braces: THREE.BufferGeometry[] = [];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  for (const z of [-HALF_W, HALF_W]) {
    k.beam(chords, V(-N * PANEL, 0, z), V(N * PANEL, 0, z), 1.7, 1.7);
    for (let i = -N; i < N; i += 1) {
      const x0 = i * PANEL;
      const x1 = (i + 1) * PANEL;
      const d0 = depthAt(x0);
      const d1 = depthAt(x1);
      k.beam(chords, V(x0, d0, z), V(x1, d1, z), 1.9, 1.9);
      if (i % 2 === 0) k.beam(webs, V(x0, 0, z), V(x1, d1, z), 0.85);
      else k.beam(webs, V(x0, d0, z), V(x1, 0, z), 0.85);
    }
    for (let i = -N; i <= N; i += 1) k.beam(webs, V(i * PANEL, 0, z), V(i * PANEL, depthAt(i * PANEL), z), 1.0);
  }
  // portal / lateral bracing across the roadway
  for (let i = -N; i < N; i += 1) {
    const x0 = i * PANEL;
    const x1 = (i + 1) * PANEL;
    k.beam(braces, V(x0, depthAt(x0), -HALF_W), V(x0, depthAt(x0), HALF_W), 0.8);
    k.beam(braces, V(x0, depthAt(x0), -HALF_W), V(x1, depthAt(x1), HALF_W), 0.55);
    k.beam(braces, V(x0, depthAt(x0), HALF_W), V(x1, depthAt(x1), -HALF_W), 0.55);
  }
  // approach girders
  for (const side of [-1, 1]) {
    for (const z of [-HALF_W, HALF_W]) {
      k.beam(chords, V(side * N * PANEL, 3, z), V(side * 262, 3, z), 1.2, 6);
    }
  }
  const trussA = k.merged(chords, steel, true);
  const trussB = k.merged(webs, steelDark, true);
  const trussC = k.merged(braces, steelDark, true);
  g.add(trussA, trussB, trussC);

  const deck = k.box(2 * 262, 2.4, 22.5, deckMat, 0, -1.3, 0);
  deck.castShadow = true;
  const deckEdge = k.box(2 * 262, 0.8, 23.5, concrete, 0, -2.9, 0);
  g.add(deck, deckEdge);

  // piers rising out of the river (deck is 34m above the water)
  const piers: [number, number][] = [
    [-175, 22],
    [-75, 28],
    [75, 28],
    [175, 22],
    [-222, 16],
    [222, 16],
    [-262, 12],
    [262, 12],
  ];
  for (const [x, w] of piers) {
    const p = k.box(w * 0.5, 34, 15, concrete, x, -20, 0);
    p.castShadow = true;
    const cap = k.box(w * 0.5 + 3, 3, 19, concrete, x, -4.4, 0);
    g.add(p, cap);
  }
  return g;
}

// ---------------------------------------------------------------- Olympic Stadium

function buildStadium(k: Kit) {
  const g = new THREE.Group();
  const concrete = k.std("#bdb9af", 0.92);
  const concreteDark = k.std("#9d998f", 0.95);
  const fabric = k.std("#ece9e2", 0.75, 0, { side: THREE.DoubleSide });
  const cableMat = k.std("#d8d8d6", 0.5, 0.5);
  const RX = 135;
  const RZ = 92;

  // Concrete bowl: elliptical lathe, outer wall flaring inward at the top.
  const profile = [
    new THREE.Vector2(1.04, 0),
    new THREE.Vector2(1.03, 8),
    new THREE.Vector2(0.97, 20),
    new THREE.Vector2(0.88, 31),
    new THREE.Vector2(0.78, 36),
    new THREE.Vector2(0.72, 36),
    new THREE.Vector2(0.72, 4),
    new THREE.Vector2(0.6, 0),
  ];
  const bowl = new THREE.Mesh(k.geo(new THREE.LatheGeometry(profile, 72)), concrete);
  bowl.material = k.std("#bdb9af", 0.92, 0, { side: THREE.DoubleSide });
  bowl.scale.set(RX, 1, RZ);
  bowl.castShadow = true;
  g.add(bowl);

  // Giant radial ribs (the Big O has 38 of them).
  const ribs: THREE.BufferGeometry[] = [];
  const COUNT = 38;
  for (let i = 0; i < COUNT; i += 1) {
    const a = (i / COUNT) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const foot = new THREE.Vector3(c * RX * 1.05, 0, s * RZ * 1.05);
    const mid = new THREE.Vector3(c * RX * 0.99, 16, s * RZ * 0.99);
    const top = new THREE.Vector3(c * RX * 0.86, 33, s * RZ * 0.86);
    k.beam(ribs, foot, mid, 4.2, 3.2);
    k.beam(ribs, mid, top, 4.0, 3.0);
  }
  g.add(k.merged(ribs, concreteDark, true));

  // Roof membrane.
  const roof = new THREE.Mesh(
    k.geo(new THREE.SphereGeometry(1, 56, 14, 0, Math.PI * 2, 0, Math.PI / 2.1)),
    fabric,
  );
  roof.scale.set(RX * 0.76, 15, RZ * 0.76);
  roof.position.y = 35;
  roof.castShadow = true;
  g.add(roof);

  // Inclined Montréal Tower: a tapering square shaft leaning over the stadium.
  const base = new THREE.Vector3(RX * 1.12, 0, 0);
  const top = new THREE.Vector3(RX * 0.42, 165, 0);
  const axis = top.clone().sub(base);
  const len = axis.length();
  const shaft = new THREE.Mesh(
    k.geo(new THREE.CylinderGeometry(7.5, 17, len, 4, 1)),
    k.std("#c9c5bb", 0.9),
  );
  shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
  shaft.rotateY(Math.PI / 4);
  shaft.position.copy(base).add(top).multiplyScalar(0.5);
  shaft.castShadow = true;
  g.add(shaft);
  // observation deck pod at the summit
  const pod = new THREE.Mesh(
    k.geo(new THREE.CylinderGeometry(11, 8, 9, 8)),
    k.std("#a9a79f", 0.6, 0.3),
  );
  pod.position.copy(top).add(new THREE.Vector3(1, 1, 0));
  g.add(pod);
  const glassBand = new THREE.Mesh(
    k.geo(new THREE.CylinderGeometry(11.3, 11.3, 3.2, 8)),
    k.std("#3a5163", 0.15, 0.6),
  );
  glassBand.position.copy(pod.position);
  g.add(glassBand);

  // Cable fan from the summit to the roof rim.
  const cables: THREE.BufferGeometry[] = [];
  const anchor = top.clone().add(new THREE.Vector3(0, -8, 0));
  for (let i = 0; i < 26; i += 1) {
    const a = Math.PI * 0.55 + (i / 25) * Math.PI * 0.9;
    const rim = new THREE.Vector3(Math.cos(a) * RX * 0.62 + RX * 0.05, 40, Math.sin(a) * RZ * 0.62);
    k.beam(cables, anchor, rim, 0.9);
  }
  // back-stay cables down to the base of the tower
  for (const z of [-14, 0, 14]) {
    k.beam(cables, top.clone().add(new THREE.Vector3(2, -10, 0)), new THREE.Vector3(RX * 1.3, 0, z), 0.8);
  }
  g.add(k.merged(cables, cableMat));
  return g;
}

// ---------------------------------------------------------------- Downtown skyline

type TowerSpec = {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  tint: string;
  kind: "glass" | "stone" | "pvm" | "dlg" | "stepped";
};

function buildSkyline(k: Kit, rng: Rng) {
  const g = new THREE.Group();
  const specs: TowerSpec[] = [
    { x: -210, z: 20, w: 40, d: 40, h: 118, tint: "#7b8c9b", kind: "glass" },
    { x: -150, z: -10, w: 36, d: 52, h: 146, tint: "#8d9aa6", kind: "glass" },
    { x: -110, z: 30, w: 30, d: 30, h: 96, tint: "#a9a79f", kind: "stone" },
    // 1250 René-Lévesque: stepped crown
    { x: -70, z: -20, w: 44, d: 44, h: 199, tint: "#b8c3cb", kind: "stepped" },
    // 1000 De La Gauchetière: pyramid roof
    { x: -10, z: 0, w: 46, d: 46, h: 205, tint: "#45566a", kind: "dlg" },
    // Place Ville Marie: cruciform
    { x: 55, z: -10, w: 56, d: 56, h: 188, tint: "#8fa6b8", kind: "pvm" },
    { x: 118, z: 10, w: 40, d: 56, h: 150, tint: "#657789", kind: "glass" },
    { x: 165, z: -15, w: 34, d: 34, h: 124, tint: "#93a1ac", kind: "glass" },
    { x: 205, z: 25, w: 30, d: 44, h: 90, tint: "#7d8c99", kind: "glass" },
  ];
  let beacon: THREE.Mesh | null = null;
  for (const t of specs) {
    const tile = k.tex(glassTexture(t.tint));
    tile.repeat.set(Math.max(1, t.w / 32), Math.max(1, t.h / 64));
    const wallMat =
      t.kind === "stone"
        ? k.std(t.tint, 0.9)
        : k.std("#ffffff", 0.18, 0.55, { map: tile, envMapIntensity: 1.2 });
    const body = new THREE.Mesh(k.geo(new THREE.BoxGeometry(t.w, t.h, t.d)), wallMat);
    body.position.set(t.x, t.h / 2, t.z);
    body.castShadow = true;
    g.add(body);
    const roofMat = k.std("#8a8f94", 0.8);
    if (t.kind === "dlg") {
      const pyr = new THREE.Mesh(
        k.geo(new THREE.ConeGeometry(t.w * 0.72, 34, 4)),
        k.std("#7aa593", 0.4, 0.55),
      );
      pyr.rotation.y = Math.PI / 4;
      pyr.position.set(t.x, t.h + 17, t.z);
      g.add(pyr);
    } else if (t.kind === "stepped") {
      for (let s = 1; s <= 3; s += 1) {
        const sw = t.w * (1 - s * 0.2);
        g.add(k.box(sw, 14, sw, k.std("#ece8de", 0.5, 0.2, { emissive: "#fff2d0", emissiveIntensity: 0.08 }), t.x, t.h + 7 + (s - 1) * 14, t.z));
      }
    } else if (t.kind === "pvm") {
      // cross-shaped plan: two long wings through the centre
      const wing = new THREE.Mesh(k.geo(new THREE.BoxGeometry(t.w * 0.38, t.h, t.d)), wallMat);
      wing.position.set(t.x, t.h / 2, t.z);
      wing.castShadow = true;
      g.add(wing);
      const wing2 = new THREE.Mesh(k.geo(new THREE.BoxGeometry(t.w, t.h, t.d * 0.38)), wallMat);
      wing2.position.set(t.x, t.h / 2, t.z);
      wing2.castShadow = true;
      g.add(wing2);
      body.visible = false;
      g.add(k.box(t.w * 0.2, 6, t.w * 0.2, roofMat, t.x, t.h + 3, t.z));
      beacon = new THREE.Mesh(
        k.geo(new THREE.SphereGeometry(3.2, 12, 8)),
        k.std("#ffffff", 0.3, 0, { emissive: "#bfe6ff", emissiveIntensity: 2.2 }),
      );
      beacon.position.set(t.x, t.h + 9, t.z);
      g.add(beacon);
    } else {
      g.add(k.box(t.w * 0.5, 9 + rng() * 8, t.d * 0.5, roofMat, t.x, t.h + 6, t.z));
      if (rng() > 0.5) g.add(k.box(1.2, 26, 1.2, k.std("#c8c8c8", 0.4, 0.6), t.x + 4, t.h + 22, t.z));
    }
  }

  // Notre-Dame Basilica: low gothic nave and twin towers, in front of the skyline.
  const stone = k.std("#a39a8b", 0.9);
  const copper = k.std("#6fa391", 0.5, 0.4);
  g.add(k.box(36, 34, 66, stone, -118, 17, 86));
  for (const dx of [-12, 12]) {
    g.add(k.box(11, 62, 11, stone, -118 + dx, 31, 120));
    const spire = new THREE.Mesh(k.geo(new THREE.ConeGeometry(8.2, 15, 4)), copper);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(-118 + dx, 69.5, 120);
    g.add(spire);
  }
  g.add(k.box(36, 6, 14, stone, -118, 37, 118));

  return { g, beacon: beacon as THREE.Mesh | null };
}

// ---------------------------------------------------------------- Mount Royal

function buildMountain(k: Kit, rng: Rng) {
  const g = new THREE.Group();
  const geo = k.geo(new THREE.SphereGeometry(1, 56, 22, 0, Math.PI * 2, 0, Math.PI / 2));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 7.3) * Math.cos(z * 6.1) * 0.5 + Math.sin(x * 17 + z * 11) * 0.25;
    pos.setY(i, y * (1 + n * 0.06));
    c.set("#3d5a2e").lerp(new THREE.Color("#5f7a3a"), 0.5 + n * 0.5).lerp(new THREE.Color("#8a5a2c"), Math.max(0, n * 0.35));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const hill = new THREE.Mesh(geo, k.std("#ffffff", 0.95, 0, { vertexColors: true }));
  hill.scale.set(520, 130, 210);
  g.add(hill);

  // Cross on the summit (lit white, ~31m tall in life; exaggerated for readability).
  const crossMat = k.std("#ffffff", 0.4, 0, { emissive: "#fff6e0", emissiveIntensity: 0.9 });
  g.add(k.box(4, 34, 4, crossMat, 90, 131 + 17 - 6, 0));
  g.add(k.box(18, 4, 4, crossMat, 90, 131 + 24, 0));

  // Saint Joseph's Oratory dome on the shoulder of the mountain.
  const dome = new THREE.Mesh(
    k.geo(new THREE.SphereGeometry(18, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
    k.std("#6fa391", 0.45, 0.4),
  );
  dome.position.set(-150, 92, 80);
  g.add(dome);
  g.add(k.box(46, 30, 40, k.std("#cfc8ba", 0.85), -150, 78, 80));

  // Forest speckle
  const treeGeo = k.geo(new THREE.ConeGeometry(5, 14, 6));
  const treeMat = k.std("#4a6a35", 0.95);
  const forest = new THREE.InstancedMesh(treeGeo, treeMat, 260);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 260; i += 1) {
    const a = rng() * Math.PI;
    const r = 0.25 + rng() * 0.7;
    const x = Math.cos(a) * r * 500 * (rng() > 0.5 ? 1 : -1);
    const z = Math.sin(a) * r * 190;
    const yy = Math.max(0, 130 * Math.sqrt(Math.max(0, 1 - (x / 520) ** 2 - (z / 210) ** 2)));
    m.makeTranslation(x, yy, z);
    forest.setMatrixAt(i, m);
  }
  g.add(forest);
  return g;
}

// ---------------------------------------------------------------- Public

export function buildLandmarks(rng: Rng): Landmarks {
  const k = new Kit();
  const group = new THREE.Group();
  const drift = new THREE.Group();
  group.add(drift);
  const WATER_Y = -1.2;

  // River: reflective flat plane, a quay edge where the street ends.
  const water = new THREE.Mesh(
    k.geo(new THREE.PlaneGeometry(2400, 900)),
    k.std("#3d6a86", 0.12, 0.35, { envMapIntensity: 1.1 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, WATER_Y, -196 - 450);
  group.add(water);
  const quay = k.box(2400, 1.2, 2, k.std("#8f8b82", 0.95), 0, WATER_Y + 0.6, -196);
  group.add(quay);
  // far bank land so the skyline stands on something
  const land = new THREE.Mesh(k.geo(new THREE.PlaneGeometry(2400, 500)), k.std("#59624f", 0.97));
  land.rotation.x = -Math.PI / 2;
  land.position.set(0, -0.05, -330 - 250);
  group.add(land);
  // street continues as a paved approach to the quay
  const approach = new THREE.Mesh(k.geo(new THREE.PlaneGeometry(5.5 + 3.4, 40)), k.std("#34322f", 0.9));
  approach.rotation.x = -Math.PI / 2;
  approach.position.set(0, -0.01, -196 + 8);
  group.add(approach);

  // Jacques Cartier Bridge across the river.
  const bridge = buildBridge(k);
  const BS = 0.62;
  bridge.scale.setScalar(BS);
  bridge.position.set(6, WATER_Y + 34 * BS, -238);
  drift.add(bridge);

  // Skyline across the water.
  const sky = buildSkyline(k, rng);
  const SS = 0.42;
  sky.g.scale.setScalar(SS);
  sky.g.position.set(-14, 0, -318);
  drift.add(sky.g);

  // Olympic Stadium + tower, off to the right.
  const stadium = buildStadium(k);
  const OS = 0.5;
  stadium.scale.setScalar(OS);
  stadium.position.set(58, 0, -292);
  stadium.rotation.y = 0.5;
  drift.add(stadium);

  // Mount Royal behind everything.
  const mountain = buildMountain(k, rng);
  const MS = 0.62;
  mountain.scale.setScalar(MS);
  mountain.position.set(-20, 0, -500);
  drift.add(mountain);

  return {
    group,
    drift,
    waterY: WATER_Y,
    geos: k.geos,
    mats: k.mats,
    texs: k.texs,
    update: (t: number) => {
      if (sky.beacon) {
        const m = sky.beacon.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 1.2 + Math.max(0, Math.sin(t * 2.4)) * 2.2;
      }
      const wm = water.material as THREE.MeshStandardMaterial;
      wm.roughness = 0.12 + Math.sin(t * 0.7) * 0.02;
    },
  };
}
