// Wonderland, in three dimensions.
//
// A garden with a croquet lawn at its heart, and two districts off it:
//   - the Mad Hatter's Tea Party, where Slack conversations waiting on you
//     float above the table as letters;
//   - the Queen's Court, where sessions are card soldiers — the ones waiting
//     on your decision line up before the throne under a red heart.
// Alice wanders the lawn. Give her an errand and she walks to the district it
// belongs to and says what she found.
//
// Everything is built from primitives, here, at load. No models to fetch, no
// artwork to license. The world only *shows*; deciding things happens in the
// panels, where the literal request is on screen.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildAlice } from "/alice-figure.js";
import { SUITS } from "/ui.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Where things are. The lawn is the hub; districts sit either side of it. */
const PLAZA = V(0, 0, 5);
const PLAZA_R = 6.5;
const DISTRICTS = {
  tea: { anchor: V(-15, 0, 0), door: V(-10.2, 0, 3.6), sign: 6.6 },
  court: { anchor: V(15, 0, -1), door: V(10.2, 0, 3.6), sign: 6.2 },
};

const PALETTE = {
  skyTop: 0x8fb8e8, skyHorizon: 0xfbe9d2,
  grass: [0x8cc46a, 0x7fb95f, 0x9bcd75, 0x76ad57],
  lawnA: "#8fcb69", lawnB: "#7bb956",
  path: 0xe9d7b0, stone: 0xf1e4cf,
  heart: 0xcf1f36, heartDeep: 0xa5142a, gold: 0xd29b1e,
  chesh: 0xb8489b, cheshSoft: 0xe79ccb,
  ink: 0x29263a, cream: 0xfbf6e9,
};

/** Seeded, so the garden is laid out the same way on every load. */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, flatShading: true, ...extra });

function mesh(geo, material, [x = 0, y = 0, z = 0] = [], { rot, cast = true, receive = false } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(...rot);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A heart, extruded — the court's one recurring shape. */
function heartGeometry(size = 1, depth = 0.2) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.9);
  s.bezierCurveTo(-0.2, -0.65, -1, -0.2, -1, 0.3);
  s.bezierCurveTo(-1, 0.85, -0.35, 1.05, 0, 0.55);
  s.bezierCurveTo(0.35, 1.05, 1, 0.85, 1, 0.3);
  s.bezierCurveTo(1, -0.2, 0.2, -0.65, 0, -0.9);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  g.center();
  g.scale(size, size, size);
  return g;
}

/* ================================================================ scenery */

function buildSky(scene) {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
      void main() { float h = clamp(normalize(vPos).y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, material));
  scene.fog = new THREE.Fog(PALETTE.skyHorizon, 55, 140);
}

/** Flat meadow in the middle, rolling hills past the districts. */
function groundHeight(x, z) {
  const r = Math.hypot(x, z - 2);
  const ramp = THREE.MathUtils.smoothstep(r, 30, 55);
  const n = Math.sin(x * 0.11) * Math.cos(z * 0.13) * 3 + Math.sin((x + z) * 0.05) * 4 + Math.cos(x * 0.31 - z * 0.27) * 0.8;
  return ramp * (n + 3.5);
}

function buildGround(scene, rand) {
  const geo = new THREE.PlaneGeometry(220, 220, 90, 90);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    tmp.setHex(PALETTE.grass[Math.floor(rand() * PALETTE.grass.length)]);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = mesh(geo, mat(0xffffff, { vertexColors: true, roughness: 0.95 }), [0, 0, 0], { cast: false, receive: true });
  scene.add(ground);
}

/** The croquet lawn, checkered in two greens, with hoops. */
function buildPlaza(scene) {
  const tex = canvasTexture(512, 512, (g, w, h) => {
    const n = 10;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? PALETTE.lawnA : PALETTE.lawnB;
      g.fillRect((i * w) / n, (j * h) / n, w / n + 1, h / n + 1);
    }
  });
  const lawn = mesh(new THREE.CircleGeometry(PLAZA_R, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    [PLAZA.x, 0.02, PLAZA.z], { rot: [-Math.PI / 2, 0, 0], cast: false, receive: true });
  scene.add(lawn);
  scene.add(mesh(new THREE.TorusGeometry(PLAZA_R, 0.12, 6, 64), mat(PALETTE.stone),
    [PLAZA.x, 0.04, PLAZA.z], { rot: [-Math.PI / 2, 0, 0], cast: false, receive: true }));

  const hoop = mat(0xffffff);
  for (const [x, z, r] of [[-2.5, 3.5, 0.4], [2.2, 6.8, -0.3], [0.4, 2.2, 1.2]]) {
    scene.add(mesh(new THREE.TorusGeometry(0.35, 0.03, 6, 16, Math.PI), hoop, [PLAZA.x + x, 0.02, PLAZA.z + z], { rot: [0, r, 0] }));
  }
  // a hedgehog, curled up as a croquet ball
  scene.add(mesh(new THREE.IcosahedronGeometry(0.22, 0), mat(0x8a6a4a), [PLAZA.x - 1.4, 0.2, PLAZA.z + 4.3]));
}

/** A strip of path from a to b, lying on the ground. */
function pathStrip(scene, a, b, { width = 1.8, material }) {
  const d = b.clone().sub(a);
  const len = d.length();
  const geo = new THREE.PlaneGeometry(width, len);
  geo.rotateX(-Math.PI / 2);
  const m = mesh(geo, material, [(a.x + b.x) / 2, 0.025, (a.z + b.z) / 2], { cast: false, receive: true });
  m.rotation.y = Math.atan2(d.x, d.z);
  scene.add(m);
  return { mesh: m, len };
}

function buildPaths(scene) {
  for (const key of ["tea", "court"]) {
    const door = DISTRICTS[key].door;
    const from = PLAZA.clone().add(door.clone().sub(PLAZA).setY(0).normalize().multiplyScalar(PLAZA_R - 0.3));
    const into = door.clone().add(DISTRICTS[key].anchor.clone().sub(door).normalize().multiplyScalar(2.5));
    if (key === "court") {
      // the Queen's own black-and-white tiles
      const len = into.distanceTo(from);
      const tex = canvasTexture(64, 64, (g) => {
        g.fillStyle = "#fbf6e9"; g.fillRect(0, 0, 64, 64);
        g.fillStyle = "#29263a"; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
      });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, Math.round(len / 0.9));
      tex.magFilter = THREE.NearestFilter;
      pathStrip(scene, from, into, { width: 1.8, material: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }) });
    } else {
      pathStrip(scene, from, into, { width: 1.9, material: mat(PALETTE.path, { roughness: 1 }) });
    }
  }
}

function tree(scene, x, z, s, rand, palette = [0x6fae5a, 0x86c06a, 0x5d9c4c]) {
  const y = groundHeight(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh(new THREE.CylinderGeometry(0.18 * s, 0.3 * s, 2.4 * s, 7), mat(0x8a6040), [0, 1.2 * s, 0]));
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const r = (1.1 + rand() * 0.6) * s;
    g.add(mesh(new THREE.IcosahedronGeometry(r, 0), mat(palette[i % palette.length]),
      [(rand() - 0.5) * s, (2.6 + i * 0.9) * s, (rand() - 0.5) * s], { rot: [rand(), rand(), 0] }));
  }
  scene.add(g);
}

function mushroom(scene, x, z, s, cap = PALETTE.heart) {
  const g = new THREE.Group();
  g.position.set(x, groundHeight(x, z), z);
  g.add(mesh(new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 1 * s, 10), mat(0xf6ecd8), [0, 0.5 * s, 0]));
  g.add(mesh(new THREE.SphereGeometry(0.7 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(cap), [0, 0.95 * s, 0]));
  const dot = mat(0xffffff);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + s;
    const p = new THREE.Vector3().setFromSphericalCoords(0.7 * s, 0.75, a);
    g.add(mesh(new THREE.SphereGeometry(0.09 * s, 6, 4), dot, [p.x, 0.95 * s + p.y, p.z], { cast: false }));
  }
  scene.add(g);
  return g;
}

function cloud(rand) {
  const g = new THREE.Group();
  const white = mat(0xffffff, { roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.15 });
  for (let i = 0; i < 5; i++) {
    g.add(mesh(new THREE.IcosahedronGeometry(1.2 + rand() * 1.4, 1), white, [i * 1.6 - 3.2, rand() * 0.8, rand() * 1.2], { cast: false }));
  }
  return g;
}

/** The White Rabbit's pocket watch, drifting overhead. */
function pocketWatch() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: PALETTE.gold, metalness: 0.7, roughness: 0.35 });
  g.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.22, 24), gold, [0, 0, 0], { rot: [Math.PI / 2, 0, 0], cast: false }));
  const face = canvasTexture(128, 128, (c) => {
    c.fillStyle = "#fffaf0"; c.beginPath(); c.arc(64, 64, 62, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#29263a"; c.font = "bold 16px Georgia"; c.textAlign = "center"; c.textBaseline = "middle";
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      c.fillText(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][i - 1], 64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46);
    }
    c.strokeStyle = "#29263a"; c.lineWidth = 4;
    c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 30); c.moveTo(64, 64); c.lineTo(88, 70); c.stroke();
  });
  g.add(mesh(new THREE.CircleGeometry(0.7, 24), new THREE.MeshBasicMaterial({ map: face }), [0, 0, 0.115], { cast: false }));
  g.add(mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 12), gold, [0, 0.95, 0], { cast: false }));
  return g;
}

/** Just the grin and the eyes, as he's usually seen. */
function cheshire() {
  const g = new THREE.Group();
  const pink = new THREE.MeshStandardMaterial({ color: PALETTE.chesh, roughness: 0.5, transparent: true });
  const teeth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, transparent: true });
  const eyes = new THREE.MeshStandardMaterial({ color: 0xd8e04a, emissive: 0x8a9a10, roughness: 0.3, transparent: true });
  g.add(mesh(new THREE.TorusGeometry(0.9, 0.16, 8, 24, Math.PI), pink, [0, 0, 0], { rot: [0, 0, Math.PI], cast: false }));
  g.add(mesh(new THREE.TorusGeometry(0.82, 0.08, 6, 24, Math.PI * 0.9), teeth, [0, 0.02, 0.06], { rot: [0, 0, Math.PI * 1.05], cast: false }));
  for (const x of [-0.5, 0.5]) {
    const e = mesh(new THREE.SphereGeometry(0.2, 12, 8), eyes, [x, 0.65, 0], { cast: false });
    e.scale.set(1, 0.6, 0.5);
    g.add(e);
  }
  g.userData.materials = [pink, teeth, eyes];
  return g;
}

/** The great tree behind the lawn, with the Cat in it. */
function buildCentre(scene, rand) {
  const x = 0, z = -6;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const trunk = new THREE.LatheGeometry(
    [V(1.2, 0, 0), V(0.75, 1, 0), V(0.55, 3, 0), V(0.6, 4.5, 0), V(0.9, 5.2, 0), V(0, 5.4, 0)].map((p) => new THREE.Vector2(p.x, p.y)), 9);
  g.add(mesh(trunk, mat(0x7a5236)));
  const leaves = [PALETTE.cheshSoft, 0x86c06a, 0xb8d77a, 0xf2b8d8];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(mesh(new THREE.IcosahedronGeometry(1.8 + rand() * 0.8, 0), mat(leaves[i % leaves.length]),
      [Math.cos(a) * 1.8, 6 + rand() * 1.4, Math.sin(a) * 1.5], { rot: [rand(), rand(), rand()] }));
  }
  g.add(mesh(new THREE.IcosahedronGeometry(2.4, 0), mat(0x9fcf72), [0, 7.6, 0]));
  scene.add(g);

  const cat = cheshire();
  cat.position.set(x + 2.6, 5.6, z + 1.8);
  scene.add(cat);

  for (const [mx, mz, s, c] of [[-3.2, -3.6, 1.5, PALETTE.heart], [3.4, -3.2, 1.1, PALETTE.chesh], [-1.6, -9.5, 2.2, PALETTE.heart],
    [4.5, -8.5, 1.8, 0xe08a2e], [-5.5, -6, 1.2, PALETTE.chesh], [6.5, 9.5, 0.9, PALETTE.heart], [-7, 11, 1.1, 0xe08a2e]]) {
    mushroom(scene, mx, mz, s, c);
  }

  // the rabbit-hole, in the corner of the lawn
  const hx = -5.5, hz = 13;
  scene.add(mesh(new THREE.CircleGeometry(0.95, 24), new THREE.MeshBasicMaterial({ color: 0x16120e }),
    [hx, 0.03, hz], { rot: [-Math.PI / 2, 0, 0], cast: false }));
  scene.add(mesh(new THREE.TorusGeometry(1.05, 0.22, 6, 20), mat(0x8a6a4a), [hx, 0.05, hz], { rot: [-Math.PI / 2, 0, 0] }));
  return { cat };
}

function buildOutskirts(scene, rand) {
  // Trees in a loose ring, kept off the districts and the view of them.
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const r = 26 + rand() * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 4;
    if (z > 10 && Math.abs(x) < 30) continue; // keep the camera's foreground open
    tree(scene, x, z, 0.8 + rand() * 0.9, rand, rand() < 0.2 ? [PALETTE.cheshSoft, 0xf2b8d8, 0x86c06a] : undefined);
  }
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2, r = 18 + rand() * 12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > 8 && Math.abs(x) < 22) continue;
    if (Math.hypot(x - DISTRICTS.tea.anchor.x, z) < 8 || Math.hypot(x - DISTRICTS.court.anchor.x, z + 1) < 9) continue;
    mushroom(scene, x, z, 0.5 + rand() * 1.2, [PALETTE.heart, PALETTE.chesh, 0xe08a2e][i % 3]);
  }
}

/* ============================================================ tea party */

function teapot(color) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.4 });
  g.add(mesh(new THREE.SphereGeometry(0.32, 14, 10), m, [0, 0.28, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.38, 8), m, [0.36, 0.36, 0], { rot: [0, 0, -0.9] }));
  g.add(mesh(new THREE.TorusGeometry(0.15, 0.035, 6, 12), m, [-0.32, 0.32, 0]));
  g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), m, [0, 0.6, 0]));
  return g;
}

function teacup(color) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 14), mat(0xffffff), [0, 0.012, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.13, 12), mat(color, { roughness: 0.4 }), [0, 0.09, 0]));
  g.add(mesh(new THREE.TorusGeometry(0.045, 0.014, 4, 8), mat(color), [0.12, 0.09, 0]));
  return g;
}

function chair(color, back = 1) {
  const g = new THREE.Group();
  const m = mat(color);
  g.add(mesh(new THREE.BoxGeometry(0.75, 0.1, 0.7), m, [0, 0.6, 0]));
  for (const [x, z] of [[-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]]) {
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), m, [x, 0.3, z]));
  }
  g.add(mesh(new THREE.BoxGeometry(0.75, 0.9 * back, 0.08), m, [0, 0.6 + 0.45 * back, -0.33]));
  return g;
}

/** A letter with a red seal — one per Slack conversation waiting on you. */
function envelope() {
  const g = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color: 0xfffdf5, roughness: 0.6, emissive: 0xffe9a8, emissiveIntensity: 0 });
  g.add(mesh(new THREE.BoxGeometry(0.62, 0.42, 0.03), paper, [0, 0, 0], { cast: true }));
  const flap = new THREE.Shape();
  flap.moveTo(-0.31, 0.21); flap.lineTo(0.31, 0.21); flap.lineTo(0, -0.02); flap.closePath();
  g.add(mesh(new THREE.ShapeGeometry(flap), mat(0xefe6d0, { side: THREE.DoubleSide }), [0, 0, 0.017], { cast: false }));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), mat(PALETTE.heart, { roughness: 0.4 }), [0, 0.0, 0.03], { rot: [Math.PI / 2, 0, 0], cast: false }));
  g.userData.paper = paper;
  return g;
}

function buildTeaParty(scene) {
  const T = DISTRICTS.tea.anchor;
  const g = new THREE.Group();
  g.position.copy(T);
  g.userData.district = "tea";
  scene.add(g);

  // the table, with a cloth that hangs over its edges
  const cloth = mat(0xffffff, { roughness: 0.9 });
  g.add(mesh(new THREE.BoxGeometry(9, 0.1, 2.2), cloth, [0, 1.0, 0], { receive: true }));
  g.add(mesh(new THREE.BoxGeometry(9.1, 0.35, 2.3), mat(0xf6c9d8), [0, 0.82, 0]));
  for (const x of [-4, 4]) for (const z of [-0.85, 0.85]) {
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.95, 6), mat(0x8a6040), [x, 0.47, z]));
  }

  // mismatched chairs, as there would be
  const chairColors = [0x4f8fd4, 0xd29b1e, 0xb8489b, 0x5b9147, 0xcf1f36, 0xe08a2e];
  [-3, -1.5, 0, 1.5, 3].forEach((x, i) => {
    const c = chair(chairColors[i % chairColors.length], 1 + (i % 2) * 0.4);
    c.position.set(x, 0, -1.7);
    g.add(c);
  });
  [-2.2, 2.2].forEach((x, i) => {
    const c = chair(chairColors[(i + 3) % chairColors.length], 0.6);
    c.position.set(x, 0, 1.7);
    c.rotation.y = Math.PI;
    g.add(c);
  });
  // the Hatter's armchair at the head of the table
  const arm = chair(0x2f6bad, 1.8);
  arm.scale.setScalar(1.3);
  arm.position.set(-5.3, 0, 0);
  arm.rotation.y = Math.PI / 2;
  g.add(arm);

  // crockery
  const pots = [[-2.4, 0x4f8fd4], [0.6, 0xcf1f36], [3.1, 0xd29b1e]];
  for (const [x, c] of pots) {
    const p = teapot(c);
    p.position.set(x, 1.05, 0.1);
    g.add(p);
  }
  const cupColors = [PALETTE.cheshSoft, 0x8fb8e8, 0xfbe9a0, 0xb8d77a];
  for (let i = 0; i < 10; i++) {
    const cup = teacup(cupColors[i % 4]);
    cup.position.set(-4 + i * 0.88, 1.05, i % 2 ? 0.6 : -0.55);
    cup.rotation.y = i;
    g.add(cup);
  }
  const cake = new THREE.Group();
  cake.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16), mat(0xfbe9d2), [0, 0.15, 0]));
  cake.add(mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 16), mat(PALETTE.cheshSoft), [0, 0.32, 0]));
  cake.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(PALETTE.heart), [0, 0.4, 0]));
  cake.position.set(-1, 1.05, 0.2);
  g.add(cake);

  // the Hatter's hat, enormous, on a pole — you can find the party from anywhere
  const hat = new THREE.Group();
  const felt = mat(0x5b8a52);
  hat.add(mesh(new THREE.CylinderGeometry(0.95, 0.8, 1.7, 16), felt, [0, 0.85, 0]));
  hat.add(mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.1, 20), felt, [0, 0.02, 0]));
  hat.add(mesh(new THREE.CylinderGeometry(0.84, 0.82, 0.3, 16), mat(0xe9d7b0), [0, 0.32, 0]));
  const tag = canvasTexture(128, 96, (c) => {
    c.fillStyle = "#fffaf0"; c.fillRect(0, 0, 128, 96);
    c.fillStyle = "#29263a"; c.font = "bold 40px Georgia"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("10/6", 64, 50);
  });
  hat.add(mesh(new THREE.PlaneGeometry(0.6, 0.45), new THREE.MeshStandardMaterial({ map: tag, side: THREE.DoubleSide }), [0.35, 0.55, 0.88], { rot: [0, 0.2, 0.15], cast: false }));
  hat.position.set(0, 4.3, -3.2);
  hat.rotation.z = 0.12;
  g.add(hat);
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.3, 6), mat(0x8a6040), [0, 2.15, -3.2]));

  // bunting
  const colors = [PALETTE.heart, PALETTE.cream, 0x4f8fd4, PALETTE.gold, PALETTE.chesh];
  for (const x of [-4.7, 4.7]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), mat(0x8a6040), [x, 1.6, -2.4]));
  for (let i = 0; i < 15; i++) {
    const t = i / 14;
    const x = -4.6 + t * 9.2;
    const y = 3.1 - Math.sin(t * Math.PI) * 0.6;
    const f = new THREE.Shape();
    f.moveTo(-0.22, 0); f.lineTo(0.22, 0); f.lineTo(0, -0.4); f.closePath();
    g.add(mesh(new THREE.ShapeGeometry(f), mat(colors[i % colors.length], { side: THREE.DoubleSide }), [x, y, -2.4], { cast: false }));
  }

  // Letters: a fixed pool, shown as conversations arrive.
  const letters = [];
  for (let i = 0; i < 9; i++) {
    const e = envelope();
    e.visible = false;
    e.scale.setScalar(1.5);
    e.userData.base = V(-3.6 + i * 0.9, 2.5 + (i % 2) * 0.45, 0.05);
    e.position.copy(e.userData.base);
    g.add(e);
    letters.push(e);
  }

  // A soft glow under the table while something waits.
  const glow = mesh(new THREE.CircleGeometry(6, 40), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false }),
    [0, 0.035, 0.3], { rot: [-Math.PI / 2, 0, 0], cast: false });
  g.add(glow);

  return { group: g, letters, glow, hat };
}

/* ========================================================= queen's court */

const faceTextures = new Map();
function cardFace(suit) {
  if (faceTextures.has(suit)) return faceTextures.get(suit);
  const red = suit === "♥" || suit === "♦";
  const t = canvasTexture(128, 180, (c, w, h) => {
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#e0d4b8"; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = red ? "#cf1f36" : "#29263a";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "88px Georgia"; c.fillText(suit, w / 2, h / 2 + 4);
    c.font = "28px Georgia"; c.fillText(suit, 24, 26); c.fillText(suit, w - 24, h - 24);
  });
  faceTextures.set(suit, t);
  return t;
}
const cardBack = () => canvasTexture(64, 90, (c, w, h) => {
  c.fillStyle = "#cf1f36"; c.fillRect(0, 0, w, h);
  c.strokeStyle = "#fbf6e9"; c.lineWidth = 2;
  for (let i = -h; i < w + h; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.moveTo(i + h, 0); c.lineTo(i, h); c.stroke(); }
});

function soldier(back) {
  const g = new THREE.Group();
  const faceMat = new THREE.MeshStandardMaterial({ map: cardFace("♠"), roughness: 0.6 });
  const backMat = new THREE.MeshStandardMaterial({ map: back, roughness: 0.6 });
  const edge = mat(PALETTE.cream);
  const card = mesh(new THREE.BoxGeometry(0.72, 1.0, 0.06), [edge, edge, edge, edge, faceMat, backMat], [0, 1.08, 0]);
  g.add(card);
  const skin = mat(0xf6d7c3);
  g.add(mesh(new THREE.SphereGeometry(0.17, 12, 8), skin, [0, 1.76, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.12, 10), mat(PALETTE.heartDeep), [0, 1.93, 0]));
  const legM = mat(PALETTE.ink);
  for (const x of [-0.15, 0.15]) g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.58, 6), legM, [x, 0.29, 0]));
  for (const x of [-0.42, 0.42]) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), legM, [x, 1.15, 0], { rot: [0, 0, x > 0 ? -0.3 : 0.3] }));
  // a spear, held upright
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 5), mat(0x8a6040), [0.55, 1.1, 0.05]));
  g.add(mesh(new THREE.ConeGeometry(0.07, 0.22, 6), mat(PALETTE.gold, { metalness: 0.5, roughness: 0.4 }), [0.55, 2.3, 0.05]));
  // the heart that floats over a soldier waiting on your word
  const heart = mesh(heartGeometry(0.22, 0.08), new THREE.MeshStandardMaterial({ color: PALETTE.heart, emissive: PALETTE.heart, emissiveIntensity: 0.5, roughness: 0.4 }),
    [0, 2.55, 0], { cast: false });
  heart.visible = false;
  g.add(heart);
  g.userData = { faceMat, heart, suit: "♠" };
  return g;
}

function roseBush(scene, x, z, rand, painted = 0.7) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.add(mesh(new THREE.IcosahedronGeometry(0.8, 0), mat(0x4f8a3e), [0, 0.7, 0], { rot: [rand(), rand(), 0] }));
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Vector3().setFromSphericalCoords(0.78, 0.4 + rand() * 1.1, rand() * Math.PI * 2);
    // Some still white: the gardeners haven't finished painting them.
    const c = rand() < painted ? PALETTE.heart : 0xffffff;
    g.add(mesh(new THREE.IcosahedronGeometry(0.16, 0), mat(c), [p.x, 0.7 + p.y, p.z], { cast: false }));
  }
  scene.add(g);
}

function buildCourt(scene, rand) {
  const K = DISTRICTS.court.anchor;
  const g = new THREE.Group();
  g.position.copy(K);
  g.userData.district = "court";
  scene.add(g);

  g.add(mesh(new THREE.CylinderGeometry(5.2, 5.4, 0.24, 40), mat(0xf3e2da), [0, 0.12, 0], { receive: true }));
  g.add(mesh(new THREE.PlaneGeometry(1.4, 5.6), mat(PALETTE.heart, { roughness: 1 }), [0, 0.25, 0.4], { rot: [-Math.PI / 2, 0, 0], cast: false, receive: true }));

  // the throne
  const throne = new THREE.Group();
  throne.position.set(0, 0.24, -3.4);
  const red = mat(PALETTE.heart, { roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: PALETTE.gold, metalness: 0.6, roughness: 0.35 });
  throne.add(mesh(new THREE.BoxGeometry(2.2, 0.5, 1.6), gold, [0, 0.25, 0]));
  throne.add(mesh(new THREE.BoxGeometry(1.6, 0.4, 1.2), red, [0, 0.7, 0.1]));
  throne.add(mesh(new THREE.BoxGeometry(1.8, 2.6, 0.3), red, [0, 1.8, -0.55]));
  throne.add(mesh(heartGeometry(0.75, 0.25), red, [0, 3.5, -0.55]));
  throne.add(mesh(new THREE.TorusGeometry(0.9, 0.07, 6, 24), gold, [0, 3.5, -0.4], { cast: false }));
  for (const x of [-1, 1]) throne.add(mesh(new THREE.BoxGeometry(0.25, 0.7, 1.4), gold, [x, 0.85, 0.1]));
  g.add(throne);

  // banners either side
  for (const x of [-3.2, 3.2]) {
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.4, 6), gold, [x, 2.4, -3]));
    g.add(mesh(new THREE.PlaneGeometry(1, 1.6), mat(PALETTE.heart, { side: THREE.DoubleSide }), [x + 0.55, 3.7, -3], { cast: false }));
    g.add(mesh(heartGeometry(0.22, 0.04), mat(PALETTE.cream), [x + 0.55, 3.7, -2.95], { cast: false }));
  }

  // a hedge wall behind, in an arc
  const hedge = mat(0x467e37);
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (i / 10) * Math.PI;
    g.add(mesh(new THREE.BoxGeometry(1.8, 1.6, 0.9), hedge, [Math.cos(a) * 6.6, 0.8, Math.sin(a) * 6.6], { rot: [0, -a + Math.PI / 2, 0] }));
  }

  // a heart-shaped topiary arch over the way in
  const door = DISTRICTS.court.door.clone().sub(K);
  const arch = new THREE.Group();
  arch.position.set(door.x * 0.78, 0, door.z * 0.78);
  arch.rotation.y = Math.atan2(door.x, door.z) + Math.PI / 2;
  arch.add(mesh(new THREE.TorusGeometry(1.5, 0.28, 6, 18, Math.PI), hedge, [0, 1.2, 0]));
  for (const x of [-1.5, 1.5]) arch.add(mesh(new THREE.BoxGeometry(0.56, 1.2, 0.56), hedge, [x, 0.6, 0]));
  arch.add(mesh(heartGeometry(0.4, 0.1), red, [0, 3.05, 0]));
  g.add(arch);

  // roses all round, some still being painted
  for (let i = 0; i < 9; i++) {
    const a = -0.25 + (i / 8) * Math.PI * 1.25 + Math.PI * 0.5;
    roseBush(scene, K.x + Math.cos(a) * 7.6, K.z + Math.sin(a) * 6.6, rand, 0.6);
  }

  // Soldiers: a fixed pool. Waiting ones stand in a row before the throne;
  // the rest are about the court.
  const back = cardBack();
  const soldiers = [];
  for (let i = 0; i < 14; i++) {
    const s = soldier(back);
    s.visible = false;
    g.add(s);
    soldiers.push(s);
  }

  const glow = mesh(new THREE.CircleGeometry(5.6, 40), new THREE.MeshBasicMaterial({ color: 0xff8a9a, transparent: true, opacity: 0, depthWrite: false }),
    [0, 0.26, 0], { rot: [-Math.PI / 2, 0, 0], cast: false });
  g.add(glow);

  return { group: g, soldiers, glow };
}

/** Where a soldier stands: waiting ones in the front rows, the rest about the edge. */
function soldierSpot(kind, i) {
  if (kind === "waiting") {
    const row = Math.floor(i / 5), col = i % 5;
    return { x: -2.4 + col * 1.2 + row * 0.6, z: -1.4 + row * 1.3, rot: 0 };
  }
  const spots = [[-4.2, 1.2, 0.6], [4.2, 1.6, -0.6], [-3.6, -2.4, 0.3], [3.8, -2.2, -0.3], [-4.6, -0.6, 0.9], [4.6, 0, -0.9],
    [-2.6, 3, 0.2], [2.8, 3.2, -0.2], [-1.6, -4.2, 0], [1.6, -4.4, 0]];
  const [x, z, rot] = spots[i % spots.length];
  return { x, z, rot };
}

/* ================================================================ world */

export function createWorld({ canvas, overlay, onDistrict, names }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
  const HOME = { pos: V(0, 20, 31), target: V(0, 1, 1.5) };
  camera.position.copy(HOME.pos);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 10;
  controls.maxDistance = 75;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.screenSpacePanning = false;

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /* --- light ------------------------------------------------------------ */
  scene.add(new THREE.HemisphereLight(0xfff6e0, 0x6a8f4a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(18, 32, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 24, bottom: -24, near: 1, far: 90 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  /* --- the place -------------------------------------------------------- */
  const rand = rng(1865);
  buildSky(scene);
  buildGround(scene, rand);
  buildPlaza(scene);
  buildPaths(scene);
  const centre = buildCentre(scene, rand);
  buildOutskirts(scene, rand);
  const tea = buildTeaParty(scene);
  const court = buildCourt(scene, rand);

  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const c = cloud(rand);
    c.position.set(-90 + rand() * 180, 22 + rand() * 12, -70 + rand() * 60);
    c.userData.speed = 0.4 + rand() * 0.6;
    scene.add(c);
    clouds.push(c);
  }
  const watches = [];
  for (let i = 0; i < 5; i++) {
    const w = pocketWatch();
    w.position.set(-24 + i * 12, 12 + rand() * 6, -20 - rand() * 10);
    w.userData.phase = rand() * 10;
    scene.add(w);
    watches.push(w);
  }

  /* --- Alice ------------------------------------------------------------ */
  // Larger than life, as she so often was: at true scale against the
  // furniture she's a speck from where the camera sits.
  const ALICE_SCALE = 1.6;
  const figure = buildAlice();
  const me = figure.group;
  me.scale.setScalar(ALICE_SCALE);
  me.position.copy(PLAZA);
  scene.add(me);

  /* --- labels: HTML over the canvas, placed each frame ------------------ */
  const labels = [];
  /** `anchor` is followed live, so passing an object's own position tracks it. */
  function label(className, anchor, { onClick, offset = 0, shown = true } = {}) {
    const node = document.createElement(onClick ? "button" : "div");
    node.className = `world-label ${className}`;
    if (onClick) node.onclick = onClick;
    node.hidden = !shown;
    overlay.append(node);
    const l = { node, anchor, offset };
    labels.push(l);
    return l;
  }

  const signs = {};
  for (const key of ["tea", "court"]) {
    const d = DISTRICTS[key];
    const l = label(`sign sign-${key}`, d.anchor.clone().setY(d.sign), { onClick: () => onDistrict(key) });
    const name = Object.assign(document.createElement("span"), { className: "sign-name", textContent: names[key] });
    l.count = Object.assign(document.createElement("span"), { className: "sign-count" });
    l.node.append(name, l.count);
    signs[key] = l;
  }

  const bubble = label("bubble", me.position, { offset: figure.height * ALICE_SCALE + 0.5, shown: false });

  /** Name tags over the soldiers waiting on you; each follows its soldier. */
  const tags = court.soldiers.map((s) => {
    const l = label("tag", new THREE.Vector3(), { shown: false });
    l.soldier = s;
    return l;
  });

  const v = new THREE.Vector3();
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const l of labels) {
      if (l.node.hidden) continue;
      if (l.soldier) l.soldier.getWorldPosition(l.anchor).add(V(0, 3.0, 0));
      v.copy(l.anchor);
      v.y += l.offset;
      v.project(camera);
      const behind = v.z > 1;
      l.node.style.visibility = behind ? "hidden" : "";
      l.node.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  /* --- what's in each district ------------------------------------------ */
  let teaCount = 0;
  let courtWaiting = 0;

  function update({ tea: teaState, court: courtState }) {
    const waiting = teaState?.items ?? [];
    teaCount = waiting.length;
    tea.letters.forEach((e, i) => {
      e.visible = i < waiting.length;
      e.userData.fresh = Boolean(waiting[i]?.fresh);
    });
    signs.tea.count.textContent = teaCount ? String(teaCount) : "";
    signs.tea.node.classList.toggle("has-items", teaCount > 0);

    const pending = courtState?.waiting ?? [];
    const others = courtState?.others ?? [];
    courtWaiting = pending.length;
    let slot = 0;
    const place = (t, kind, i) => {
      const s = court.soldiers[slot++];
      if (!s) return;
      const spot = soldierSpot(kind, i);
      const waiting = kind === "waiting";
      // A stopped session lies face-down, as a dropped card does.
      const down = !waiting && !(t.status in SUITS);
      s.visible = true;
      s.userData.baseY = down ? 0.3 : 0.24;
      s.position.set(spot.x, s.userData.baseY, spot.z);
      s.rotation.set(down ? Math.PI / 2 : 0, spot.rot, 0);
      const suit = waiting ? "♥" : SUITS[t.status] ?? "♠";
      if (s.userData.suit !== suit) {
        s.userData.faceMat.map = cardFace(suit);
        s.userData.faceMat.needsUpdate = true;
        s.userData.suit = suit;
      }
      s.userData.heart.visible = waiting;
      s.userData.status = t.status;
      const tag = tags[slot - 1];
      tag.node.hidden = !waiting;
      tag.node.textContent = t.name ?? "session";
    };
    pending.forEach((t, i) => place(t, "waiting", i));
    others.forEach((t, i) => place(t, "other", i));
    for (let i = slot; i < court.soldiers.length; i++) {
      court.soldiers[i].visible = false;
      tags[i].node.hidden = true;
    }
    signs.court.count.textContent = courtWaiting ? String(courtWaiting) : "";
    signs.court.node.classList.toggle("has-items", courtWaiting > 0);
  }

  /* --- Alice's errands --------------------------------------------------- */
  const SPEED = 3.4;
  let route = [];
  let state = "pause";
  let stateUntil = 1.5;
  let current = null; // the errand she's on
  const errands = [];
  let clock = 0;

  /** Straight across the lawn, or via the middle of it when changing sides. */
  function routeTo(to) {
    const fromOut = me.position.distanceTo(PLAZA) > PLAZA_R + 0.5;
    const toOut = to.distanceTo(PLAZA) > PLAZA_R + 0.5;
    route = fromOut && toOut ? [PLAZA.clone().add(V(0, 0, 1.5)), to.clone()] : [to.clone()];
  }

  function wanderSpot() {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (PLAZA_R - 1.4);
    return V(PLAZA.x + Math.cos(a) * r, 0, PLAZA.z + Math.sin(a) * r);
  }

  function say(text, seconds) {
    bubble.node.textContent = text;
    bubble.node.hidden = false;
    bubble.until = clock + seconds;
  }

  function hush() {
    bubble.node.hidden = true;
  }

  function nextErrand() {
    current = errands.shift() ?? null;
    if (current) {
      hush();
      routeTo(DISTRICTS[current.district].door);
      state = "walking";
      if (current.onTheWay) say(current.onTheWay, 2.5);
    }
  }

  function errand(district, text, { onTheWay } = {}) {
    // The same news twice in a row is once.
    const last = errands.at(-1) ?? current;
    if (last && last.district === district && last.text === text) return;
    errands.push({ district, text, onTheWay });
    // Breaks off a stroll at once; an errand already under way finishes first.
    if (!current) nextErrand();
  }

  function turnToward(x, z, dt, rate = 8) {
    const want = Math.atan2(x - me.position.x, z - me.position.z);
    const d = want - me.rotation.y;
    // the short way round
    me.rotation.y += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * rate);
  }

  function stepAlice(dt) {
    let walking = false;
    if (route.length) {
      const target = route[0];
      const dx = target.x - me.position.x, dz = target.z - me.position.z;
      const dist = Math.hypot(dx, dz);
      const step = SPEED * (current ? 1.25 : 0.6) * dt;
      if (dist <= step) {
        me.position.set(target.x, 0, target.z);
        route.shift();
      } else {
        me.position.x += (dx / dist) * step;
        me.position.z += (dz / dist) * step;
        turnToward(target.x, target.z, dt);
        walking = true;
      }
    }

    if (!route.length) {
      if (state === "walking" && current) {
        // Arrived: face the district and say what she found.
        state = "announce";
        stateUntil = clock + 5.5;
        say(current.text, 5.5);
      } else if (state === "walking") {
        state = "pause";
        stateUntil = clock + 2 + Math.random() * 4;
      } else if (state === "announce") {
        const a = DISTRICTS[current.district].anchor;
        turnToward(a.x, a.z, dt, 5);
        if (!reduceMotion) figure.wave(clock); else figure.unwave();
        if (clock > stateUntil) {
          figure.unwave();
          current = null;
          if (errands.length) nextErrand();
          else { state = "pause"; stateUntil = clock + 3; }
        }
      } else if (state === "pause" && clock > stateUntil) {
        if (errands.length) nextErrand();
        else {
          // Mostly the lawn; now and then a look in on a district that has
          // something waiting, without making an announcement of it.
          const busy = [teaCount && "tea", courtWaiting && "court"].filter(Boolean);
          const peek = busy.length && Math.random() < 0.25;
          routeTo(peek ? DISTRICTS[busy[Math.floor(Math.random() * busy.length)]].door : wanderSpot());
          state = "walking";
        }
      }
    }

    figure.pose(dt, { walking, speed: current ? 1.25 : 0.75 });
    if (!bubble.node.hidden && clock > bubble.until) hush();
  }

  /* --- the camera: home, or framing a district -------------------------- */
  let shot = null; // { pos, target } being eased toward
  let focused = null;
  let fitted = false; // has the overview been sized to the screen yet?
  /** `cover` is how much of the screen's width the panel takes. */
  function focus(key, { cover = 0.4 } = {}) {
    focused = key;
    // The panel names the district already; its sign would only sit in the way.
    for (const k of Object.keys(signs)) signs[k].node.classList.toggle("focused", k === key);
    if (!key) { shot = home(); return; }
    const a = DISTRICTS[key].anchor;
    // The panel covers the right of the screen, so frame the district in
    // what's left of it by aiming to its right — further, the wider it is.
    const wide = canvas.clientWidth > 900;
    const target = a.clone().add(V(wide ? 11.5 * cover : 0, 1.2, wide ? 0 : 2));
    shot = { pos: target.clone().add(V(key === "tea" ? 2 : -2, 11, 15)), target };
  }
  controls.addEventListener("start", () => { shot = null; });

  /* --- pointing at things ------------------------------------------------ */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const districtGroups = [tea.group, court.group];
  function districtAt(e) {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(districtGroups, true)[0];
    let o = hit?.object;
    while (o && !o.userData?.district) o = o.parent;
    return o?.userData.district ?? null;
  }
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const key = districtAt(e);
    if (key) onDistrict(key);
  });
  let hovered = null;
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons) return;
    const key = districtAt(e);
    if (key === hovered) return;
    hovered = key;
    canvas.style.cursor = key ? "pointer" : "";
    for (const k of Object.keys(signs)) signs[k].node.classList.toggle("hover", k === key);
  });

  /* --- the loop ---------------------------------------------------------- */
  /**
   * The overview has to fit both districts across, so a narrow screen pulls
   * the camera back — and the fog with it, or the far side would vanish.
   */
  function reach() {
    return THREE.MathUtils.clamp(1.5 / camera.aspect, 1, 3.4);
  }
  function home() {
    return { pos: HOME.pos.clone().sub(HOME.target).multiplyScalar(reach()).add(HOME.target), target: HOME.target.clone() };
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const r = reach();
    controls.maxDistance = 75 * r;
    scene.fog.near = 55 * r;
    scene.fog.far = 140 * r;
    if (focused) return;
    // The first fit is a cut; later ones (a window dragged narrower) a glide.
    if (!fitted) camera.position.copy(home().pos);
    else shot = home();
    fitted = true;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const timer = new THREE.Timer();
  function frame(time) {
    requestAnimationFrame(frame);
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.1);
    clock += dt;

    stepAlice(dt);

    if (shot) {
      const k = 1 - Math.exp(-dt * 3);
      camera.position.lerp(shot.pos, k);
      controls.target.lerp(shot.target, k);
      if (camera.position.distanceTo(shot.pos) < 0.05) shot = null;
    }
    controls.update();

    const m = reduceMotion ? 0 : 1;
    tea.letters.forEach((e, i) => {
      if (!e.visible) return;
      e.position.y = e.userData.base.y + Math.sin(clock * 1.6 + i) * 0.12 * m;
      e.rotation.y = Math.sin(clock * 0.8 + i * 1.3) * 0.5 * m;
      e.userData.paper.emissiveIntensity = e.userData.fresh ? 0.35 + Math.sin(clock * 4) * 0.25 : 0.08;
    });
    tea.glow.material.opacity = teaCount ? 0.22 + Math.sin(clock * 2) * 0.06 * m : 0;
    tea.hat.rotation.y = Math.sin(clock * 0.4) * 0.3 * m;
    court.glow.material.opacity = courtWaiting ? 0.2 + Math.sin(clock * 2.6) * 0.08 * m : 0;
    court.soldiers.forEach((s, i) => {
      if (!s.visible) return;
      const h = s.userData.heart;
      if (h.visible) {
        h.rotation.y = clock * 1.5 * m;
        h.scale.setScalar(1 + Math.sin(clock * 5 + i) * 0.12 * m);
      }
      // Working soldiers bob about their painting; the rest stand to attention.
      const bob = s.userData.status === "working" ? Math.abs(Math.sin(clock * 4 + i)) * 0.12 * m : 0;
      s.position.y = s.userData.baseY + bob;
    });
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt * m;
      if (c.position.x > 110) c.position.x = -110;
    }
    for (const w of watches) {
      w.rotation.y = Math.sin(clock * 0.3 + w.userData.phase) * 0.8 * m;
      w.position.y += Math.sin(clock * 0.7 + w.userData.phase) * 0.004 * m;
    }
    // The Cat comes and goes.
    const fade = reduceMotion ? 1 : THREE.MathUtils.clamp(0.5 + Math.sin(clock * 0.35) * 0.9, 0, 1);
    for (const mtl of centre.cat.userData.materials) mtl.opacity = fade;
    centre.cat.visible = fade > 0.02;

    renderer.render(scene, camera);
    placeLabels();
  }
  requestAnimationFrame(frame);

  return { update, errand, focus };
}
