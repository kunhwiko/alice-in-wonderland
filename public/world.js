// Wonderland, in three dimensions.
//
// A storybook garden, laid out in layout.js: Alice's clearing at the front,
// a stream across the middle, and three districts along the paths from it:
//   - the Mad Hatter's Tea Party, in a glade beside the clearing, where Slack
//     conversations waiting on you float above the table as letters;
//   - the Queen's Court, over a bridge, where sessions are card soldiers —
//     the ones waiting on your decision line up before the throne under a
//     red heart;
//   - the Hall of Doors, over the other bridge, where each MCP server is a
//     door — open, locked, or stuck — and your skills are the bottles on the
//     glass table.
// Alice wanders her clearing. Give her an errand and she walks the path to
// the district it belongs to and says what she found.
//
// Everything is built from primitives, here, at load. No models to fetch, no
// artwork to license. The world only *shows*; deciding things happens in the
// panels, where the literal request is on screen.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { buildAlice } from "/alice-figure.js";
import { buildCheshire } from "/cheshire-figure.js";
import { SUITS } from "/ui.js";
import {
  CLEARING, CLEARING_R, DISTRICTS, KEYS, GREAT_TREE, CROQUET, CASTLE,
  WATER_Y, FALLS, POND, BRIDGES, PATHS, PATH_W,
  groundHeight, walkHeight, wet, pathDist, meadowClear,
} from "/layout.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const PALETTE = {
  skyTop: 0x7fb0e6, skyHorizon: 0xfde3c4, sunGlow: 0xffd9a0,
  // lush, sunlit, deep, warm
  grass: [0x86c25f, 0xb4d872, 0x5f9a48, 0xc9cf6a],
  meadow: 0xd9d49a,
  bank: 0x9c8a62, streambed: 0x5b6a4e,
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

// Smooth-shaded: faceted shading was most of what made the garden look like
// a low-poly game rather than a storybook.
const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra });

/** Smooth, cheap noise in roughly [-1, 1]: sines folded into each other. */
function noise3(x, y, z) {
  return (Math.sin(x * 1.7 + Math.sin(y * 2.3)) + Math.sin(y * 1.9 + Math.sin(z * 2.1)) + Math.sin(z * 1.5 + Math.sin(x * 2.7))) / 3;
}

/**
 * A soft, lumpy ball of radius `r`: foliage, hedges, clouds. A subdivided
 * icosahedron, welded so it shades smooth, pushed in and out by noise.
 * `seed` shifts the noise so neighbouring blobs don't share their lumps.
 */
function blob(r, { detail = 3, wobble = 0.16, freq = 2.2, seed = 0 } = {}) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  const g = mergeVertices(geo);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + wobble * noise3(v.x * freq + seed, v.y * freq + seed * 0.7, v.z * freq - seed * 1.3);
    v.multiplyScalar(r * k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

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

/**
 * The final touch on every frame, before tone mapping: a little more colour,
 * a little warmer, and the edges softly darkened, like an illustration's.
 */
const GRADE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.12);
      c.rgb *= vec3(1.04, 1.0, 0.94);
      float v = smoothstep(0.92, 0.3, distance(vUv, vec2(0.5)));
      c.rgb *= mix(0.8, 1.0, v);
      gl_FragColor = c;
    }`,
};

/* ================================================================ scenery */

/** Where the sun is: the light, and the sky's glow, both come from here. */
// Low and behind the Hall, so the garden is backlit and the sky glows above it.
const SUN = V(-30, 30, -40);

function buildSky(scene) {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      glow: { value: new THREE.Color(PALETTE.sunGlow) },
      sunDir: { value: SUN.clone().normalize() },
    },
    vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    // A gradient, warmed toward the sun: a golden afternoon, not a flat blue.
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; varying vec3 vPos;
      void main() {
        vec3 d = normalize(vPos);
        float h = clamp(d.y * 1.6, 0.0, 1.0);
        vec3 c = mix(horizon, top, pow(h, 0.7));
        float s = max(dot(d, sunDir), 0.0);
        c += glow * (pow(s, 6.0) * 0.45 + pow(s, 60.0) * 0.6);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geo, material));
  scene.fog = new THREE.Fog(PALETTE.skyHorizon, 55, 140);
}


/** The ground: flat where things stand, hills beyond, banks down to the water. */
function buildGround(scene) {
  const geo = new THREE.PlaneGeometry(240, 240, 260, 260);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const tmp = new THREE.Color();
  // Broad drifts of colour, not a random green per vertex — that speckle
  // read as pixels.
  const [lush, sunlit, deep, warm] = PALETTE.grass.map((c) => new THREE.Color(c));
  const meadow = new THREE.Color(PALETTE.meadow);
  const bank = new THREE.Color(PALETTE.bank), bed = new THREE.Color(PALETTE.streambed);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = groundHeight(x, z);
    pos.setY(i, y);
    const a = noise3(x * 0.045, 0.3, z * 0.045) * 0.5 + 0.5;
    const b = noise3(x * 0.11 + 4, 1.1, z * 0.11 - 2) * 0.5 + 0.5;
    tmp.copy(deep).lerp(lush, a).lerp(sunlit, b * 0.55).lerp(warm, Math.max(0, a - 0.7) * 1.2);
    // the hills fade warm toward the haze
    tmp.lerp(meadow, THREE.MathUtils.smoothstep(Math.hypot(x, z), 40, 95) * 0.5);
    // the banks: earth where the grass gives out, a dark bed under the water
    if (y < 0) tmp.lerp(bank, THREE.MathUtils.smoothstep(-y, 0.05, 0.3)).lerp(bed, THREE.MathUtils.smoothstep(-y, 0.4, 1.0));
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  scene.add(mesh(geo, mat(0xffffff, { vertexColors: true, roughness: 0.95 }), [0, 0, 0], { cast: false, receive: true }));
}

/**
 * Water: one sheet at the water's level over the stream, the pond and the
 * pool, hidden wherever the ground stands above it. How shallow it is comes
 * from the ground beneath each vertex, so the foam follows the real shore.
 */
const WATER = {
  vertexShader: `attribute float shallow; varying float vShallow; varying vec3 vW;
    void main() {
      vShallow = shallow;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `uniform float time; uniform vec3 deep; uniform vec3 clear; uniform vec3 sky; varying float vShallow; varying vec3 vW;
    void main() {
      vec3 c = mix(deep, clear, smoothstep(0.1, 0.9, vShallow));
      // glints moving on the surface
      float r = sin(vW.x * 2.9 + time * 1.3 + sin(vW.z * 1.9 + time * 0.7) * 1.6) * sin(vW.z * 3.4 - time * 1.1 + sin(vW.x * 1.5) * 1.3);
      c += vec3(1.0, 0.94, 0.8) * smoothstep(0.86, 1.0, r) * 0.4;
      // the sky, where you see the water at a slant
      vec3 v = normalize(cameraPosition - vW);
      c = mix(c, sky, pow(1.0 - max(v.y, 0.0), 2.0) * 0.5);
      // foam where it laps the bank
      c = mix(c, vec3(0.97, 0.98, 1.0), smoothstep(0.8, 1.0, vShallow) * 0.55);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

function buildWater(scene) {
  const material = new THREE.ShaderMaterial({
    ...WATER,
    uniforms: {
      time: { value: 0 },
      deep: { value: new THREE.Color(0x2c7aa6) },
      clear: { value: new THREE.Color(0x86cfd6) },
      sky: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
  });
  const X0 = -40, X1 = 30, Z0 = -27, Z1 = 10, STEP = 0.45;
  const nx = Math.ceil((X1 - X0) / STEP), nz = Math.ceil((Z1 - Z0) / STEP);
  const positions = [], shallow = [], ground = [], index = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = X0 + i * STEP, z = Z0 + j * STEP;
    const g = groundHeight(x, z);
    positions.push(x, WATER_Y, z);
    ground.push(g);
    shallow.push(1 - THREE.MathUtils.clamp((WATER_Y - g) / 0.45, 0, 1));
  }
  const at = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const q = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
    // only where there's water, give or take the bank
    if (q.every((k) => ground[k] > WATER_Y + 0.25)) continue;
    index.push(q[0], q[2], q[1], q[1], q[2], q[3]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("shallow", new THREE.Float32BufferAttribute(shallow, 1));
  geo.setIndex(index);
  scene.add(mesh(geo, material, [0, 0, 0], { cast: false }));

  // lily pads on the pond, a few in flower
  const rand = rng(77);
  const pad = mat(0x5f9e4a, { roughness: 0.6, side: THREE.DoubleSide });
  const lotus = mat(0xf7a8c8, { roughness: 0.5 });
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (POND.r - 1.6);
    const x = POND.centre.x + Math.cos(a) * d, z = POND.centre.z + Math.sin(a) * d;
    const r = 0.35 + rand() * 0.35;
    scene.add(mesh(new THREE.CircleGeometry(r, 18, 0.3, Math.PI * 2 - 0.6), pad, [x, WATER_Y + 0.02, z], { rot: [-Math.PI / 2, 0, rand() * 6], cast: false }));
    if (rand() < 0.35) {
      for (let k = 0; k < 6; k++) {
        const p = mesh(new THREE.SphereGeometry(0.09, 10, 6).scale(0.6, 1.4, 0.4), lotus, [x, WATER_Y + 0.12, z], { cast: false });
        p.rotation.set(0.5, (k / 6) * Math.PI * 2, 0, "YXZ");
        p.translateY(0.06);
        scene.add(p);
      }
    }
  }
  return { material };
}

/** Where the stream comes from: a fall of water over mossy rocks, back left. */
function buildFalls(scene) {
  const rand = rng(31);
  const g = new THREE.Group();
  g.position.set(FALLS.x, 0, FALLS.z);
  scene.add(g);
  // The rocks stand behind the pool, away from the camera and the stream.
  const back = V(-0.75, 0, -0.66).normalize();
  const rock = [0x9a968a, 0x8a8f7c, 0xa8a294, 0x7d8a6c].map((c) => mat(c, { roughness: 0.95 }));
  for (let i = 0; i < 16; i++) {
    const side = (rand() - 0.5) * 9, up = rand() * 5.5, out = 2.6 + rand() * 1.6 + up * 0.2;
    const p = back.clone().multiplyScalar(out).add(V(-back.z * side, up, back.x * side));
    const r = 1.2 + rand() * 1.4 - up * 0.08;
    g.add(mesh(blob(r, { wobble: 0.25, freq: 1.6, seed: i * 1.7 }), rock[i % rock.length], [p.x, p.y, p.z], { rot: [rand(), rand(), rand()], receive: true }));
  }
  // moss and ferns on top
  for (let i = 0; i < 8; i++) {
    const side = (rand() - 0.5) * 8;
    const p = back.clone().multiplyScalar(3.6 + rand()).add(V(-back.z * side, 6 + rand() * 0.8, back.x * side));
    g.add(mesh(blob(0.9 + rand() * 0.6, { seed: i }), mat(0x6fae5a), [p.x, p.y, p.z]));
  }
  // the fall itself: streaks running down a sheet, curving out at the top
  const sheet = new THREE.PlaneGeometry(2.2, 6.6, 1, 24);
  const sp = sheet.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const t = (sp.getY(i) + 3.3) / 6.6;
    sp.setZ(i, Math.sin(t * Math.PI * 0.5) * 0.9 - 0.4);
  }
  const falls = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float time; varying vec2 vUv;
      void main() {
        float s = sin(vUv.x * 40.0 + sin(vUv.x * 9.0) * 3.0) * 0.5 + 0.5;
        float flow = sin(vUv.y * 18.0 + time * 7.0 + s * 4.0) * 0.5 + 0.5;
        vec3 c = mix(vec3(0.62, 0.84, 0.92), vec3(1.0), s * 0.5 + flow * 0.35);
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        gl_FragColor = vec4(c * 1.1, edge * (0.7 + 0.25 * flow));
      }`,
  });
  const fall = mesh(sheet, falls, [0, 0, 0], { cast: false });
  fall.position.copy(back.clone().multiplyScalar(1.9)).setY(WATER_Y + 3.3);
  fall.rotation.y = Math.atan2(-back.x, -back.z);
  g.add(fall);
  return { material: falls };
}

/** Cobbles, laid in rough rows, warm in the sun. */
function cobbleTexture() {
  const rand = rng(5);
  const t = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = "#9d8c72"; c.fillRect(0, 0, w, h);
    const tones = ["#d9ccb4", "#cbbca1", "#e4d8c2", "#c0b199", "#d4c6aa", "#b9ab92"];
    for (let row = 0; row < 7; row++) {
      let x = -rand() * 30;
      while (x < w) {
        const sw = 30 + rand() * 22, sh = 30 + rand() * 6;
        const y = row * (h / 7) + rand() * 4;
        c.fillStyle = tones[Math.floor(rand() * tones.length)];
        c.beginPath();
        c.ellipse(x + sw / 2, y + sh / 2, sw / 2 - 2, sh / 2 - 2, (rand() - 0.5) * 0.3, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "rgba(255,250,235,0.35)";
        c.beginPath(); c.ellipse(x + sw / 2 - 4, y + sh / 2 - 4, sw / 4, sh / 5, 0, 0, Math.PI * 2); c.fill();
        x += sw + 2;
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A strip of cobbles laid along `curve`, following the ground and the bridges. */
function pathRibbon(curve, material) {
  const n = Math.ceil(curve.getLength() / 0.35);
  const positions = [], uvs = [], index = [];
  let along = 0, prev = null;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    if (prev) along += p.distanceTo(prev);
    prev = p;
    for (const s of [-1, 1]) {
      const x = p.x - t.z * (PATH_W / 2) * s, z = p.z + t.x * (PATH_W / 2) * s;
      positions.push(x, walkHeight(x, z) + 0.04, z);
      uvs.push((s + 1) / 2, along / PATH_W);
    }
    if (i) index.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return mesh(geo, material, [0, 0, 0], { cast: false, receive: true });
}

/** A humped stone bridge: one arch, parapets, the path running over the top. */
function bridge(b) {
  const g = new THREE.Group();
  g.position.copy(b.centre).setY(0);
  // local x runs across the stream, along b.dir
  g.rotation.y = Math.atan2(-b.dir.z, b.dir.x);
  const stone = mat(0xd8cab0, { roughness: 0.9 });
  const N = 24;
  const top = (t) => 0.05 + b.rise * Math.sin(Math.PI * t);
  const body = new THREE.Shape();
  body.moveTo(-b.half, -1.2);
  for (let i = 0; i <= N; i++) body.lineTo(-b.half + (2 * b.half * i) / N, top(i / N));
  body.lineTo(b.half, -1.2);
  // the arch underneath, the water showing through it
  const ah = b.half - 0.9;
  body.lineTo(ah, -1.2);
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI;
    body.lineTo(Math.cos(a) * ah, -1.2 + Math.sin(a) * (b.rise + 0.6));
  }
  body.lineTo(-b.half, -1.2);
  const geo = new THREE.ExtrudeGeometry(body, { depth: b.width, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -b.width / 2);
  g.add(mesh(geo, stone, [0, 0, 0], { receive: true }));
  // parapets, a low wall either side
  for (const side of [-1, 1]) {
    const wall = new THREE.Shape();
    wall.moveTo(-b.half, top(0));
    for (let i = 0; i <= N; i++) wall.lineTo(-b.half + (2 * b.half * i) / N, top(i / N) + 0.5);
    for (let i = N; i >= 0; i--) wall.lineTo(-b.half + (2 * b.half * i) / N, top(i / N));
    const wg = new THREE.ExtrudeGeometry(wall, { depth: 0.2, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
    wg.translate(0, 0, side * (b.width / 2 + 0.05) - 0.1);
    g.add(mesh(wg, stone, [0, 0, 0]));
  }
  return g;
}

function buildPaths(scene) {
  const cobbles = new THREE.MeshStandardMaterial({ map: cobbleTexture(), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const key of KEYS) scene.add(pathRibbon(PATHS[key].curve, cobbles));
  for (const b of Object.values(BRIDGES)) scene.add(bridge(b));
}

/** Alice's clearing: softer, paler grass, ringed with flat stones. */
function buildClearing(scene) {
  const fade = canvasTexture(256, 256, (c, w, h) => {
    const gr = c.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.8, "rgba(255,255,255,0.8)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
  });
  scene.add(mesh(new THREE.CircleGeometry(CLEARING_R + 0.8, 48), new THREE.MeshStandardMaterial({
    color: 0xc4e08a, alphaMap: fade, transparent: true, roughness: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  }), [CLEARING.x, 0.015, CLEARING.z], { rot: [-Math.PI / 2, 0, 0], cast: false, receive: true }));
  const rand = rng(12);
  const stone = mat(0xe2d6c0, { roughness: 0.9 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.2;
    const x = CLEARING.x + Math.cos(a) * (CLEARING_R + 0.2), z = CLEARING.z + Math.sin(a) * (CLEARING_R + 0.2);
    if (pathDist(x, z) < PATH_W / 2 + 0.3) continue;
    scene.add(mesh(new THREE.CylinderGeometry(0.28 + rand() * 0.16, 0.34 + rand() * 0.16, 0.12, 14), stone, [x, 0.05, z], { receive: true }));
  }
}

/** The Queen's croquet lawn, chequered, with hoops — and a hedgehog for a ball. */
function buildCroquet(scene) {
  const { centre, r } = CROQUET;
  const tex = canvasTexture(512, 512, (g, w, h) => {
    const n = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? PALETTE.lawnA : PALETTE.lawnB;
      g.fillRect((i * w) / n, (j * h) / n, w / n + 1, h / n + 1);
    }
  });
  scene.add(mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    [centre.x, 0.02, centre.z], { rot: [-Math.PI / 2, 0, 0], cast: false, receive: true }));
  scene.add(mesh(new THREE.TorusGeometry(r, 0.1, 8, 64), mat(PALETTE.stone), [centre.x, 0.04, centre.z], { rot: [-Math.PI / 2, 0, 0], cast: false }));
  const hoop = mat(0xffffff);
  for (const [x, z, a] of [[-1.6, 1.2, 0.4], [1.4, -1.5, -0.3], [0.4, 1.9, 1.2]]) {
    scene.add(mesh(new THREE.TorusGeometry(0.35, 0.03, 6, 16, Math.PI), hoop, [centre.x + x, 0.02, centre.z + z], { rot: [0, a, 0] }));
  }
  scene.add(mesh(blob(0.22, { detail: 2, wobble: 0.3, freq: 7 }), mat(0x8a6a4a), [centre.x - 0.8, 0.2, centre.z + 0.4]));
}




function tree(scene, x, z, s, rand, palette = [0x6fae5a, 0x86c06a, 0x5d9c4c]) {
  const y = groundHeight(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh(new THREE.CylinderGeometry(0.18 * s, 0.3 * s, 2.4 * s, 7), mat(0x8a6040), [0, 1.2 * s, 0]));
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const r = (1.1 + rand() * 0.6) * s;
    g.add(mesh(blob(r, { seed: x * 0.37 + z * 0.11 + i * 3.1 }), mat(palette[i % palette.length]),
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
    g.add(mesh(blob(1.2 + rand() * 1.4, { wobble: 0.1, seed: i * 1.9 }), white, [i * 1.6 - 3.2, rand() * 0.8, rand() * 1.2], { cast: false }));
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

/**
 * The great tree by the pond, with the Cat on a branch and the rabbit-hole
 * in its roots: a dark arched doorway, sparkling, as in the painting.
 */
function buildGreatTree(scene, rand) {
  const { x, z } = GREAT_TREE;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const bark = mat(0x7a5236);
  const trunk = new THREE.LatheGeometry(
    [V(1.5, 0, 0), V(0.95, 1, 0), V(0.62, 3, 0), V(0.66, 4.5, 0), V(0.95, 5.2, 0), V(0, 5.4, 0)].map((p) => new THREE.Vector2(p.x, p.y)), 16);
  g.add(mesh(trunk, bark));
  // roots spreading into the grass
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const root = mesh(new THREE.CapsuleGeometry(0.22, 1.4, 4, 10), bark, [Math.cos(a) * 1.4, 0.12, Math.sin(a) * 1.4]);
    root.rotation.set(0, -a, Math.PI / 2 - 0.15);
    g.add(root);
  }
  // All green: a pink cat in pink leaves was a cat nobody could find.
  const leaves = [0x6fae5a, 0x86c06a, 0xb8d77a, 0x5d9c4c];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(mesh(blob(1.9 + rand() * 0.8, { seed: i * 2.3 }), mat(leaves[i % leaves.length]),
      [Math.cos(a) * 2, 6 + rand() * 1.4, Math.sin(a) * 1.7], { rot: [rand(), rand(), rand()] }));
  }
  g.add(mesh(blob(2.6, { seed: 9 }), mat(0x9fcf72), [0, 7.8, 0]));

  // The rabbit-hole: a doorway into the trunk, facing the clearing.
  const toward = CLEARING.clone().sub(GREAT_TREE).setY(0).normalize();
  const door = new THREE.Shape();
  door.moveTo(-0.45, 0); door.lineTo(-0.45, 0.75); door.absarc(0, 0.75, 0.45, Math.PI, 0, true); door.lineTo(0.45, 0); door.closePath();
  const hole = mesh(new THREE.ShapeGeometry(door, 16), new THREE.MeshBasicMaterial({ color: 0x120c08 }), [0, 0, 0], { cast: false });
  hole.position.copy(toward.clone().multiplyScalar(1.08)).setY(0.05);
  hole.rotation.y = Math.atan2(toward.x, toward.z);
  hole.rotation.x = -0.12;
  g.add(hole);
  const rim = mesh(new THREE.TorusGeometry(0.47, 0.08, 8, 20, Math.PI), bark, [0, 0, 0]);
  rim.position.copy(hole.position).setY(0.8);
  rim.rotation.copy(hole.rotation);
  g.add(rim);

  // His branch: out toward the clearing, so he lies in the open.
  const BRANCH = { y: 3.6, len: 4.2, r0: 0.24, r1: 0.1, dir: V(-0.8, 0.06, 0.6).normalize() };
  const limb = mesh(new THREE.CylinderGeometry(BRANCH.r1, BRANCH.r0, BRANCH.len, 9), bark,
    BRANCH.dir.clone().multiplyScalar(BRANCH.len / 2).add(V(0, BRANCH.y, 0)));
  limb.quaternion.setFromUnitVectors(V(0, 1, 0), BRANCH.dir);
  g.add(limb);
  scene.add(g);

  const cheshire = buildCheshire();
  const cat = cheshire.group;
  // Along the branch, belly on its top, face turned to the camera. He's built
  // head to +x; mirrored, his head leads out along a branch that points -x.
  // A big cat, but a cat: well under Alice's height, not the tree's.
  const along = 2.9, CAT_SCALE = 0.6;
  const radius = BRANCH.r0 + (BRANCH.r1 - BRANCH.r0) * (along / BRANCH.len);
  cat.position.copy(BRANCH.dir.clone().multiplyScalar(along).add(V(x, BRANCH.y + radius * 0.85, z)));
  cat.scale.set(-CAT_SCALE, CAT_SCALE, CAT_SCALE);
  cat.rotation.y = Math.atan2(BRANCH.dir.z, -BRANCH.dir.x);
  scene.add(cat);

  return { cat: cheshire, hole: hole.getWorldPosition(new THREE.Vector3()).add(V(0, 0.7, 0)) };
}

/** Toadstools along the way, wherever they're clear of the water and the paths. */
function buildMushrooms(scene) {
  for (const [x, z, s, c] of [
    [-21.5, -3.5, 1.4, PALETTE.heart], [-9.5, 1.2, 1.1, 0xe08a2e], [-3.8, -2.2, 1.3, PALETTE.heart], [3.8, -1.6, 0.9, PALETTE.chesh],
    [16.5, 10.5, 1.2, PALETTE.heart], [-6.5, 12.5, 1, 0xe08a2e], [6.8, 12.8, 0.8, PALETTE.heart], [-18.5, -16, 1.6, PALETTE.heart],
    [-3.5, -14.5, 1.2, 0xe08a2e], [5.5, -14, 1.4, PALETTE.heart], [20, -6.5, 1, PALETTE.chesh], [-25, 9, 1.3, 0xe08a2e],
  ]) {
    if (wet(x, z, 1) || pathDist(x, z) < PATH_W / 2 + 0.9) continue;
    mushroom(scene, x, z, s, c);
  }
}

/** A weeping willow: a crown, and long fronds hanging down to the water. */
function willow(scene, x, z, s, seed) {
  const rand = rng(seed);
  const g = new THREE.Group();
  g.position.set(x, groundHeight(x, z), z);
  g.add(mesh(new THREE.CylinderGeometry(0.22 * s, 0.36 * s, 3.4 * s, 10), mat(0x7a5a3e), [0, 1.7 * s, 0]));
  const leaf = mat(0x93c45e, { roughness: 0.85 });
  g.add(mesh(blob(1.7 * s, { seed }), leaf, [0, 3.9 * s, 0]));
  const fronds = [];
  for (let i = 0; i < 80; i++) {
    const a = rand() * Math.PI * 2, r = (1.1 + rand() * 0.9) * s, len = (1.8 + rand() * 1.8) * s;
    const f = new THREE.CylinderGeometry(0.07 * s, 0.02 * s, len, 4);
    f.translate(Math.cos(a) * r, 3.9 * s - len / 2 + rand() * 0.4 * s, Math.sin(a) * r);
    fronds.push(f);
  }
  g.add(mesh(mergeGeometries(fronds), leaf));
  scene.add(g);
}

/** The Queen's castle, on its hill, pale in the haze behind the Court. */
function buildCastle(scene) {
  const g = new THREE.Group();
  g.position.set(CASTLE.x, groundHeight(CASTLE.x, CASTLE.z) - 0.5, CASTLE.z);
  const wall = mat(0xf4e6d6, { roughness: 0.9 });
  const roof = mat(0xdf6f8a, { roughness: 0.7 });
  const gold = new THREE.MeshStandardMaterial({ color: PALETTE.gold, metalness: 0.6, roughness: 0.35 });
  const tower = (x, z, r, h) => {
    g.add(mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 20), wall, [x, h / 2, z]));
    g.add(mesh(new THREE.ConeGeometry(r * 1.3, r * 3, 20), roof, [x, h + r * 1.5, z]));
    g.add(mesh(new THREE.SphereGeometry(r * 0.15, 8, 6), gold, [x, h + r * 3.05, z], { cast: false }));
    // windows: dark slits, a few lit
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + x;
      g.add(mesh(new THREE.PlaneGeometry(r * 0.25, r * 0.6), new THREE.MeshStandardMaterial({ color: 0x4a3a5a, emissive: k === 0 ? 0xffc070 : 0x000000, emissiveIntensity: 1.2 }),
        [x + Math.sin(a) * r * 1.01, h * 0.7, z + Math.cos(a) * r * 1.01], { rot: [0, a, 0], cast: false }));
    }
  };
  tower(0, 0, 2.6, 15);
  for (const [x, z, r, h] of [[-6, 2, 1.4, 10], [6, 2, 1.4, 10.5], [-4.5, -4, 1.2, 12], [4.5, -4, 1.2, 11.5], [-9, -1, 1, 8], [9, -1.5, 1, 8.5]]) tower(x, z, r, h);
  // curtain walls between the front towers, with battlements
  g.add(mesh(new THREE.BoxGeometry(12, 5.5, 1), wall, [0, 2.75, 2.4]));
  for (let i = 0; i < 11; i++) g.add(mesh(new THREE.BoxGeometry(0.6, 0.6, 1.05), wall, [-5 + i, 5.8, 2.4]));
  g.add(mesh(heartGeometry(1.1, 0.3), mat(PALETTE.heart), [0, 12, 2.7]));
  g.scale.setScalar(1.05);
  scene.add(g);
}

/** Trees: a far ring, groves framing either side, willows by the water. */
function buildOutskirts(scene, rand) {
  const open = (x, z) => !wet(x, z, 2) && pathDist(x, z) > 3.5
    && Math.hypot(x - CASTLE.x, z - CASTLE.z) > 16
    && Math.hypot(x - CLEARING.x, z - CLEARING.z) > 9
    && Math.hypot(x - CROQUET.centre.x, z - CROQUET.centre.z) > 7
    && Math.hypot(x - GREAT_TREE.x, z - GREAT_TREE.z) > 6
    && Math.hypot(x - FALLS.x, z - FALLS.z) > 7
    && !KEYS.some((k) => Math.hypot(x - DISTRICTS[k].anchor.x, z - DISTRICTS[k].anchor.z) < 10.5);
  const blossom = [PALETTE.cheshSoft, 0xf2b8d8, 0x86c06a];
  for (let i = 0; i < 110; i++) {
    const a = rand() * Math.PI * 2, r = 30 + rand() * 34;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 4;
    if (z > 16 && Math.abs(x) < 36) continue; // keep the camera's foreground open
    if (open(x, z)) tree(scene, x, z, 0.9 + rand() * 1.0, rand, rand() < 0.22 ? blossom : undefined);
  }
  // groves either side, framing the picture as a painter would
  for (const side of [-1, 1]) {
    for (let i = 0; i < 16; i++) {
      const x = side * (26 + rand() * 10), z = -16 + rand() * 34;
      if (open(x, z)) tree(scene, x, z, 1 + rand() * 0.9, rand, rand() < 0.3 ? blossom : undefined);
    }
  }
  // a glade behind the Tea Party
  for (const [x, z, s] of [[-23.5, -3.5, 1.3], [-11.5, -5, 1.1], [-25, 7, 1.2], [-20.5, -6.5, 1]]) tree(scene, x, z, s, rand, blossom);
  // willows along the stream, leaning over it
  [[-22, -15.5, 1.1], [-12, -4.6, 1], [2.2, -11.2, 1.15], [11, -0.2, 0.95], [16.2, -6.5, 1.05], [-30, -15, 1.2]]
    .forEach(([x, z, s], i) => { if (!wet(x, z, 0.3)) willow(scene, x, z, s, 100 + i); });
}

/** Giant flowers along the front of the picture, as tall as Alice or taller. */
function buildGiantFlowers(scene) {
  const rand = rng(404);
  const daisy = (g, s, petal) => {
    const pm = mat(petal, { roughness: 0.6 });
    for (let i = 0; i < 16; i++) {
      const p = mesh(new THREE.SphereGeometry(0.22 * s, 12, 8).scale(0.45, 0.14, 1.6), pm, [0, 0, 0]);
      p.rotation.y = (i / 16) * Math.PI * 2;
      p.translateZ(0.42 * s);
      g.add(p);
    }
    g.add(mesh(new THREE.SphereGeometry(0.24 * s, 16, 10).scale(1, 0.55, 1), mat(0xffc93a, { roughness: 0.5 }), [0, 0.04 * s, 0]));
  };
  const tulip = (g, s, petal) => {
    const pm = mat(petal, { roughness: 0.55 });
    for (let i = 0; i < 5; i++) {
      const p = mesh(new THREE.SphereGeometry(0.3 * s, 14, 10).scale(0.6, 1.25, 0.4), pm, [0, 0.28 * s, 0]);
      p.rotation.set(0.28, (i / 5) * Math.PI * 2, 0, "YXZ");
      p.translateZ(0.13 * s);
      g.add(p);
    }
  };
  const kinds = [[daisy, 0xffffff], [daisy, 0xffd24a], [tulip, 0xe8384f], [tulip, 0xf2668b], [daisy, 0xffa6c9], [tulip, 0xffa13d]];
  const spots = [[-20, 17.5], [-16, 20], [-12.5, 17], [-8.5, 19.5], [-23.5, 13.5], [9, 19.5], [13, 17.5], [17, 20], [20.5, 16], [24, 13.5], [-4.5, 21.5], [5, 21.5]];
  spots.forEach(([x, z], i) => {
    const [make, petal] = kinds[i % kinds.length];
    const s = 1.4 + rand() * 1.1, h = (1.8 + rand() * 1.6) * s * 0.7;
    const g = new THREE.Group();
    g.position.set(x, groundHeight(x, z), z);
    const stem = mat(0x4f8a3e);
    g.add(mesh(new THREE.CylinderGeometry(0.05 * s, 0.08 * s, h, 8), stem, [0, h / 2, 0]));
    for (const side of [-1, 1]) {
      const leaf = mesh(new THREE.SphereGeometry(0.3 * s, 12, 8).scale(0.35, 0.08, 1.6), stem, [side * 0.18 * s, h * 0.3, 0]);
      leaf.rotation.set(0.6, side * 1.2, 0, "YXZ");
      g.add(leaf);
    }
    const head = new THREE.Group();
    head.position.y = h;
    // tipped toward the camera, as if to look at you
    head.rotation.set(0.55 + rand() * 0.3, 0, (rand() - 0.5) * 0.4);
    make(head, s, petal);
    g.add(head);
    g.rotation.y = (rand() - 0.5) * 0.6;
    scene.add(g);
  });
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
  g.add(mesh(new RoundedBoxGeometry(9.1, 0.35, 2.3, 3, 0.1), mat(0xf6c9d8), [0, 0.82, 0]));
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
  // paper lanterns between the flags, lit from within
  [0xffb35c, 0xff8fb0, 0xffe07a, 0xff9d5c, 0xffc8e0].forEach((c, i) => {
    const t = (i + 0.5) / 5, x = -4.6 + t * 9.2, y = 3.1 - Math.sin(t * Math.PI) * 0.6 - 0.55;
    g.add(mesh(new THREE.SphereGeometry(0.26, 16, 12).scale(1, 1.25, 1), new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.6,
    }), [x, y, -2.25], { cast: false }));
    g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10), mat(0x8a6040), [x, y + 0.34, -2.25], { cast: false }));
  });

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
  g.add(mesh(blob(0.8, { seed: x + z }), mat(0x4f8a3e), [0, 0.7, 0], { rot: [rand(), rand(), 0] }));
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Vector3().setFromSphericalCoords(0.78, 0.4 + rand() * 1.1, rand() * Math.PI * 2);
    // Some still white: the gardeners haven't finished painting them.
    const c = rand() < painted ? PALETTE.heart : 0xffffff;
    g.add(mesh(blob(0.16, { detail: 2, wobble: 0.22, freq: 9, seed: i }), mat(c), [p.x, 0.7 + p.y, p.z], { cast: false }));
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
  throne.add(mesh(new RoundedBoxGeometry(2.2, 0.5, 1.6, 3, 0.08), gold, [0, 0.25, 0]));
  throne.add(mesh(new RoundedBoxGeometry(1.6, 0.4, 1.2, 3, 0.15), red, [0, 0.7, 0.1]));
  throne.add(mesh(new RoundedBoxGeometry(1.8, 2.6, 0.3, 3, 0.12), red, [0, 1.8, -0.55]));
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
    g.add(mesh(new RoundedBoxGeometry(1.8, 1.6, 0.9, 4, 0.32), hedge, [Math.cos(a) * 6.6, 0.8, Math.sin(a) * 6.6], { rot: [0, -a + Math.PI / 2, 0] }));
  }

  // a heart-shaped topiary arch over the way in
  const door = DISTRICTS.court.door.clone().sub(K);
  const arch = new THREE.Group();
  arch.position.set(door.x * 0.78, 0, door.z * 0.78);
  arch.rotation.y = Math.atan2(door.x, door.z) + Math.PI / 2;
  arch.add(mesh(new THREE.TorusGeometry(1.5, 0.28, 6, 18, Math.PI), hedge, [0, 1.2, 0]));
  for (const x of [-1.5, 1.5]) arch.add(mesh(new RoundedBoxGeometry(0.56, 1.2, 0.56, 4, 0.2), hedge, [x, 0.6, 0]));
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

/* ========================================================= hall of doors */

const DOOR_LOOK = {
  connected: { panel: 0x5d9c6c, light: 0xffe9a8, open: -1.15 },
  "needs-auth": { panel: 0x7d4a8e, light: 0x2a1f2e, open: 0 },
  failed: { panel: 0xa3343c, light: 0x2a1f2e, open: -0.12 },
  pending: { panel: 0xd29b1e, light: 0x5a4630, open: -0.3 },
  disabled: { panel: 0x9a948c, light: 0x2a1f2e, open: 0 },
};
/** A bottle's glass, by where the skill comes from. */
const BOTTLE_GLASS = { user: 0xf28ab2, project: 0x6fb0f0, plugin: 0x7cc47a, synced: 0xf0b84a };

/** The little golden key, as found on the glass table. */
function goldenKey(gold) {
  const k = new THREE.Group();
  k.add(mesh(new THREE.TorusGeometry(0.15, 0.045, 8, 18), gold, [-0.32, 0, 0], { cast: false }));
  k.add(mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), gold, [0.02, 0, 0], { cast: false }));
  k.add(mesh(new THREE.BoxGeometry(0.06, 0.14, 0.06), gold, [0.22, -0.08, 0], { cast: false }));
  k.add(mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), gold, [0.12, -0.06, 0], { cast: false }));
  return k;
}

/**
 * A door, facing +z: a gilt frame, the doorway behind it (lit when the door's
 * open), and the door itself on a hinge. A padlock and a floating key for one
 * that wants signing into; boards for one that's switched off.
 */
function hallDoor(gold) {
  const g = new THREE.Group();
  for (const x of [-0.56, 0.56]) g.add(mesh(new THREE.BoxGeometry(0.14, 2.3, 0.2), gold, [x, 1.15, 0]));
  g.add(mesh(new THREE.BoxGeometry(1.26, 0.16, 0.2), gold, [0, 2.35, 0]));
  const light = new THREE.MeshStandardMaterial({ color: 0x2a1f2e, emissive: 0x000000, roughness: 1 });
  g.add(mesh(new THREE.PlaneGeometry(0.98, 2.2), light, [0, 1.1, -0.06], { cast: false }));

  const panelMat = mat(0x7d4a8e, { flatShading: false, roughness: 0.6 });
  const hinge = new THREE.Group();
  hinge.position.set(-0.49, 0, 0.02);
  hinge.add(mesh(new THREE.BoxGeometry(0.98, 2.2, 0.07), panelMat, [0.49, 1.1, 0]));
  // two raised panels, and a knob
  for (const y of [0.6, 1.6]) hinge.add(mesh(new THREE.BoxGeometry(0.7, 0.75, 0.03), panelMat, [0.49, y, 0.045], { cast: false }));
  hinge.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), gold, [0.86, 1.05, 0.07], { cast: false }));
  g.add(hinge);

  const lock = new THREE.Group();
  lock.position.set(0.49, 1.05, 0.08);
  lock.add(mesh(new THREE.BoxGeometry(0.26, 0.22, 0.08), gold, [0, 0, 0], { cast: false }));
  lock.add(mesh(new THREE.TorusGeometry(0.085, 0.022, 6, 14, Math.PI), gold, [0, 0.11, 0], { cast: false }));
  hinge.add(lock);

  const boards = new THREE.Group();
  const wood = mat(0x8a6040);
  for (const r of [0.55, -0.55]) boards.add(mesh(new THREE.BoxGeometry(1.25, 0.16, 0.05), wood, [0, 1.15, 0.12], { rot: [0, 0, r] }));
  g.add(boards);

  const keyMat = new THREE.MeshStandardMaterial({ color: PALETTE.gold, metalness: 0.7, roughness: 0.3, emissive: 0x6a4a08, emissiveIntensity: 0.6 });
  const key = goldenKey(keyMat);
  key.position.set(0, 3.05, 0.35);
  g.add(key);

  // a red glow at the foot of a stuck door
  const warn = mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0, depthWrite: false }),
    [0, 0.02, 0.6], { rot: [-Math.PI / 2, 0, 0], cast: false });
  g.add(warn);

  g.userData = { light, panelMat, hinge, lock, boards, key, warn };
  return g;
}

/** A "DRINK ME" bottle: coloured glass, a paper label, a cork. */
function bottle() {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0xf28ab2, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.05 });
  const body = new THREE.LatheGeometry(
    [[0, 0], [0.11, 0], [0.12, 0.04], [0.12, 0.2], [0.07, 0.28], [0.04, 0.33], [0.042, 0.4]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  g.add(mesh(body, glass));
  g.add(mesh(new THREE.CylinderGeometry(0.124, 0.124, 0.08, 14, 1, true), mat(PALETTE.cream, { side: THREE.DoubleSide }), [0, 0.13, 0], { cast: false }));
  g.add(mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.08, 8), mat(0xb88a5a), [0, 0.43, 0], { cast: false }));
  g.userData.glass = glass;
  return g;
}

/** Where the doors stand: along the back wall, the first in the middle. */
const DOOR_SLOTS = 9;
const WALL_R = 6.2;
function doorAngle(slot) {
  const order = [4, 3, 5, 2, 6, 1, 7, 0, 8][slot];
  return Math.PI + 0.45 + (order / (DOOR_SLOTS - 1)) * (Math.PI - 0.9);
}

function buildHall(scene) {
  const H = DISTRICTS.hall.anchor;
  const g = new THREE.Group();
  g.position.copy(H);
  g.userData.district = "hall";
  scene.add(g);

  // a floor of lilac and cream, as on the far side of the looking-glass
  const tiles = canvasTexture(256, 256, (c, w, h) => {
    const n = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      c.fillStyle = (i + j) % 2 ? "#fbf6e9" : "#c9b6dc";
      c.fillRect((i * w) / n, (j * h) / n, w / n + 1, h / n + 1);
    }
  });
  g.add(mesh(new THREE.CylinderGeometry(6.4, 6.6, 0.22, 48), [
    mat(0xe8dcef), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.6 }), mat(0xe8dcef),
  ], [0, 0.11, 0], { receive: true }));

  // the wall the doors are set in, curving round the back
  const plaster = mat(0xf6e7f0, { roughness: 0.9 });
  const trim = mat(PALETTE.cheshSoft);
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + 0.1 + (i / n) * (Math.PI - 0.2);
    const pos = [Math.cos(a) * (WALL_R + 0.35), 0, Math.sin(a) * (WALL_R + 0.35)];
    const rot = [0, -a + Math.PI / 2, 0];
    g.add(mesh(new THREE.BoxGeometry(1.5, 4.4, 0.3), plaster, [pos[0], 2.42, pos[2]], { rot, receive: true }));
    g.add(mesh(new THREE.BoxGeometry(1.56, 0.22, 0.42), trim, [pos[0], 4.66, pos[2]], { rot, cast: false }));
  }

  const gold = new THREE.MeshStandardMaterial({ color: PALETTE.gold, metalness: 0.6, roughness: 0.35 });
  const doors = [];
  for (let i = 0; i < DOOR_SLOTS; i++) {
    const a = doorAngle(i);
    const d = hallDoor(gold);
    d.position.set(Math.cos(a) * WALL_R, 0.22, Math.sin(a) * WALL_R);
    d.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
    d.visible = false;
    g.add(d);
    doors.push(d);
  }

  // the little three-legged table, all made of solid glass
  const glass = new THREE.MeshStandardMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.4, roughness: 0.05, metalness: 0.1 });
  const table = new THREE.Group();
  table.position.set(0, 0.22, 1.6);
  table.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.07, 36), glass, [0, 1.05, 0], { cast: false }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    table.add(mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.05, 8), glass, [Math.cos(a) * 0.85, 0.52, Math.sin(a) * 0.85], { cast: false }));
  }
  const key = goldenKey(gold);
  key.position.set(0.15, 1.12, 0.75);
  key.rotation.set(-Math.PI / 2, 0, 0.5);
  key.scale.setScalar(0.6);
  table.add(key);
  g.add(table);

  // Bottles: a fixed pool on the table top, two rings of them.
  const bottles = [];
  for (let i = 0; i < 16; i++) {
    const b = bottle();
    const inner = i < 5;
    const a = inner ? (i / 5) * Math.PI * 2 : ((i - 5) / 11) * Math.PI * 2 + 0.3;
    const r = inner ? 0.42 : 0.98;
    b.position.set(Math.cos(a) * r, 1.09, Math.sin(a) * r);
    b.scale.setScalar(1.35);
    b.visible = false;
    table.add(b);
    bottles.push(b);
  }

  // lamps either side of the way in
  for (const x of [-2.9, 2.9]) {
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 3, 8), gold, [x, 1.72, 5.2]));
    g.add(mesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd27a, emissiveIntensity: 0.9 }),
      [x, 3.4, 5.2], { cast: false }));
  }

  const glow = mesh(new THREE.CircleGeometry(6, 40), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }),
    [0, 0.235, 0], { rot: [-Math.PI / 2, 0, 0], cast: false });
  g.add(glow);

  return { group: g, doors, bottles, glow };
}

/* ================================================================ world */

/* =============================================================== meadow */


/** A spot in the meadow, thicker toward the middle, thinning out. */
function meadowSpot(rand) {
  for (;;) {
    const a = rand() * Math.PI * 2;
    const r = 5 + Math.pow(rand(), 1.4) * 40;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 4;
    if (meadowClear(x, z)) return [x, z];
  }
}

function flowerHead() {
  const petals = [];
  for (let i = 0; i < 6; i++) {
    const p = new THREE.SphereGeometry(0.1, 10, 6);
    p.scale(1, 0.32, 0.55);
    p.translate(0.11, 0, 0);
    p.rotateY((i / 6) * Math.PI * 2);
    petals.push(p);
  }
  return mergeGeometries(petals);
}

function grassTuft() {
  const blades = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.ConeGeometry(0.03, 0.42, 4);
    b.translate(0, 0.21, 0);
    b.rotateZ((i - 2) * 0.22);
    b.rotateY(i * 1.3);
    blades.push(b);
  }
  return mergeGeometries(blades);
}

/**
 * Flowers and grass tufts, as instances so a few thousand cost about what
 * one would, and sparkles drifting round the great tree and the rabbit-hole.
 */
function buildMeadow(scene, { hole }) {
  // Its own seed: drawing from the garden's would move every tree after it.
  const rand = rng(1951);
  const FLOWERS = 2200, TUFTS = 2600;
  const petalColors = [0xf2668b, 0xffd24a, 0xffffff, 0xb37be0, 0xff8a3d, 0xe8384f, 0xffa6c9, 0x7fb3ff].map((c) => new THREE.Color(c));

  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.02, 1, 5).translate(0, 0.5, 0), mat(0x4f8a3e), FLOWERS);
  const heads = new THREE.InstancedMesh(flowerHead(), mat(0xffffff, { roughness: 0.55 }), FLOWERS);
  const hearts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 10, 8).scale(1, 0.6, 1).translate(0, 0.02, 0), mat(0xffc93a, { roughness: 0.5 }), FLOWERS);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  // In drifts of one or two colours, as a garden grows, with a few strays
  // between them: scattered evenly, they read as confetti.
  const flowers = [];
  while (flowers.length < FLOWERS * 0.88) {
    const [cx, cz] = meadowSpot(rand);
    const r = 0.8 + rand() * 1.8, n = 10 + Math.floor(rand() * 26);
    const colours = [petalColors[Math.floor(rand() * petalColors.length)], petalColors[Math.floor(rand() * petalColors.length)]];
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (meadowClear(x, z)) flowers.push([x, z, colours[rand() < 0.75 ? 0 : 1]]);
    }
  }
  while (flowers.length < FLOWERS) flowers.push([...meadowSpot(rand), petalColors[Math.floor(rand() * petalColors.length)]]);
  for (let i = 0; i < FLOWERS; i++) {
    const [x, z, colour] = flowers[i];
    const y = groundHeight(x, z);
    const h = 0.28 + rand() * 0.5, size = 0.75 + rand() * 0.75;
    m4.compose(p.set(x, y, z), q.identity(), sc.set(1, h, 1));
    stems.setMatrixAt(i, m4);
    // heads tip toward the camera's side a little, as if turned to the sun
    q.setFromEuler(e.set(0.25 + rand() * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.4));
    m4.compose(p.set(x, y + h, z), q, sc.setScalar(size));
    heads.setMatrixAt(i, m4);
    hearts.setMatrixAt(i, m4);
    heads.setColorAt(i, colour);
  }

  const tufts = new THREE.InstancedMesh(grassTuft(), mat(0xffffff, { roughness: 0.9 }), TUFTS);
  const greens = [0x5f9a48, 0x77b257, 0x8fc464, 0xa7cf6c].map((c) => new THREE.Color(c));
  for (let i = 0; i < TUFTS; i++) {
    const [x, z] = meadowSpot(rand);
    q.setFromEuler(e.set(0, rand() * Math.PI * 2, 0));
    m4.compose(p.set(x, groundHeight(x, z), z), q, sc.setScalar(0.8 + rand() * 0.9));
    tufts.setMatrixAt(i, m4);
    tufts.setColorAt(i, greens[Math.floor(rand() * greens.length)]);
  }
  for (const m of [stems, heads, hearts, tufts]) {
    m.castShadow = false;
    m.receiveShadow = m !== tufts;
    scene.add(m);
  }

  // Sparkles: points that drift and twinkle, bright enough to bloom.
  const spots = [];
  const cloud = (n, cx, cy, cz, r, h) => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
      spots.push(cx + Math.cos(a) * d, cy + rand() * h, cz + Math.sin(a) * d);
    }
  };
  cloud(100, GREAT_TREE.x, 2.5, GREAT_TREE.z, 4.5, 6.5); // the great tree
  cloud(50, hole.x, hole.y - 0.6, hole.z, 0.7, 1.6); // the rabbit-hole in its roots
  cloud(45, FALLS.x, 0, FALLS.z, 2.5, 3); // spray from the falls
  cloud(70, 0, 0.4, -4, 26, 2.5); // here and there over the meadow
  const n = spots.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(spots, 3));
  geo.setAttribute("phase", new THREE.Float32BufferAttribute(Array.from({ length: n }, () => rand() * 100), 1));
  geo.setAttribute("size", new THREE.Float32BufferAttribute(Array.from({ length: n }, () => 0.35 + rand() * 0.55), 1));
  const sparkles = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, scale: { value: 1 } },
    vertexShader: `attribute float phase; attribute float size; uniform float time; uniform float scale; varying float vA;
      void main() {
        vec3 p = position;
        p.y += sin(time * 0.6 + phase) * 0.3;
        p.x += sin(time * 0.4 + phase * 1.3) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(time * 1.8 + phase * 3.0), 2.0);
        gl_PointSize = size * scale * 300.0 / -mv.z;
      }`,
    fragmentShader: `varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.65) * 2.2, a * a * vA);
      }`,
  }));
  sparkles.frustumCulled = false;
  scene.add(sparkles);
  return { sparkles };
}

export function createWorld({ canvas, overlay, onDistrict, names }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
  // Far enough up and back to see the whole map: the clearing and the giant
  // flowers at the front, the stream across the middle, the Hall and the Court
  // beyond it, and the castle on its hill at the back.
  const HOME = { pos: V(0, 28, 39), target: V(0, 0, -11) };
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
  // A golden afternoon: warm sun from behind, a sky-coloured fill from above
  // and the grass's green bounced up from below, so nothing goes muddy.
  scene.add(new THREE.HemisphereLight(0xffeed8, 0x5d8a48, 1.35));
  const sun = new THREE.DirectionalLight(0xffd9a4, 2.7);
  sun.position.copy(SUN);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 30, bottom: -30, near: 1, far: 120 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  // Soft-edged shadows, as a painter would leave them.
  sun.shadow.radius = 4;
  scene.add(sun);
  // A faint warm light from the camera's side, so faces turned to you aren't
  // lost in the backlight.
  const fill = new THREE.DirectionalLight(0xffe6cc, 0.55);
  fill.position.set(10, 14, 30);
  scene.add(fill);

  /* --- the picture: bloom and a storybook grade ------------------------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Only what's really bright blooms: sparkles, the sun's glow, a lit window.
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new ShaderPass(GRADE));
  composer.addPass(new OutputPass());

  /* --- the place -------------------------------------------------------- */
  const rand = rng(1865);
  buildSky(scene);
  buildGround(scene);
  const water = buildWater(scene);
  const falls = buildFalls(scene);
  buildPaths(scene);
  buildClearing(scene);
  buildCroquet(scene);
  const centre = buildGreatTree(scene, rand);
  buildMushrooms(scene);
  buildOutskirts(scene, rand);
  buildCastle(scene);
  buildGiantFlowers(scene);
  const tea = buildTeaParty(scene);
  const court = buildCourt(scene, rand);
  const hall = buildHall(scene);
  const meadow = buildMeadow(scene, centre);
  meadow.sparkles.material.uniforms.scale.value = renderer.getPixelRatio();

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
    // high over the back of the map, clear of the districts
    w.position.set(-30 + i * 13, 17 + rand() * 6, -34 - rand() * 10);
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
  me.position.copy(CLEARING);
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
  for (const key of KEYS) {
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

  /** Names over the doors that won't open. The doors don't move, so neither do these. */
  hall.group.updateMatrixWorld(true); // nothing's been drawn yet to work out where they are
  const doorTags = hall.doors.map((d) => label("tag tag-door", d.getWorldPosition(new THREE.Vector3()).add(V(0, 3.6, 0)), { shown: false }));

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
  let hallShut = 0;

  /** Doors and bottles: one door per MCP server, one bottle per skill. */
  function updateHall({ servers = [], skills = [] } = {}) {
    const doors = [...servers].sort((a, b) => a.name.localeCompare(b.name));
    hallShut = 0;
    hall.doors.forEach((d, i) => {
      const s = doors[i];
      const tag = doorTags[i];
      d.visible = Boolean(s);
      if (!s) { tag.node.hidden = true; return; }
      const look = DOOR_LOOK[s.status] ?? DOOR_LOOK.pending;
      const u = d.userData;
      u.status = s.status;
      u.panelMat.color.setHex(look.panel);
      u.light.color.setHex(look.light);
      u.light.emissive.setHex(s.status === "connected" ? 0xffd27a : 0x000000);
      u.hinge.rotation.y = look.open;
      u.lock.visible = s.status === "needs-auth";
      u.key.visible = s.status === "needs-auth";
      u.boards.visible = s.status === "disabled";
      const shut = s.status === "needs-auth" || s.status === "failed";
      if (shut) hallShut++;
      tag.node.hidden = !shut;
      tag.node.textContent = s.name;
    });
    hall.bottles.forEach((b, i) => {
      const k = skills[i];
      b.visible = Boolean(k);
      if (k) b.userData.glass.color.setHex(BOTTLE_GLASS[k.scope] ?? BOTTLE_GLASS.user);
    });
    signs.hall.count.textContent = hallShut ? String(hallShut) : "";
    signs.hall.node.classList.toggle("has-items", hallShut > 0);
  }

  function update({ tea: teaState, court: courtState, hall: hallState }) {
    updateHall(hallState);
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

  /**
   * Along the paths: back from wherever she is to the clearing, then out
   * along the path to `key`'s door — or, with no key, to `spot` in the
   * clearing. Paths keep her out of the stream; the bridges are on them.
   */
  let at = null; // the district she's standing at, or null in the clearing
  let headed = null;
  function routeTo(key, spot = null) {
    route = [];
    if (at && at !== key) route.push(...[...PATHS[at].walk].reverse());
    if (key && key !== at) route.push(...PATHS[key].walk);
    else if (key) route.push(DISTRICTS[key].door.clone());
    if (!key && spot) route.push(spot);
    route = route.map((p) => p.clone());
    headed = key;
  }

  function wanderSpot() {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (CLEARING_R - 1.2);
    return V(CLEARING.x + Math.cos(a) * r, 0, CLEARING.z + Math.sin(a) * r);
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
      routeTo(current.district);
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
        me.position.x = target.x;
        me.position.z = target.z;
        route.shift();
        if (!route.length) at = headed;
      } else {
        me.position.x += (dx / dist) * step;
        me.position.z += (dz / dist) * step;
        turnToward(target.x, target.z, dt);
        walking = true;
      }
      // up and over the bridges
      me.position.y = walkHeight(me.position.x, me.position.z);
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
          const busy = [teaCount && "tea", courtWaiting && "court", hallShut && "hall"].filter(Boolean);
          const peek = busy.length && Math.random() < 0.25;
          if (peek) routeTo(busy[Math.floor(Math.random() * busy.length)]);
          else routeTo(null, wanderSpot());
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
    shot = { pos: target.clone().add(V({ tea: 2, court: -2, hall: 0 }[key], 11, 15)), target };
  }
  controls.addEventListener("start", () => { shot = null; });

  /* --- pointing at things ------------------------------------------------ */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const districtGroups = [tea.group, court.group, hall.group];
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
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
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
    hall.glow.material.opacity = hallShut ? 0.16 + Math.sin(clock * 2.2) * 0.06 * m : 0;
    hall.doors.forEach((d, i) => {
      if (!d.visible) return;
      const u = d.userData;
      if (u.key.visible) {
        // the key that would open it, turning in the air
        u.key.position.y = 3.05 + Math.sin(clock * 2 + i) * 0.12 * m;
        u.key.rotation.y = clock * 1.4 * m;
      }
      u.warn.material.opacity = u.status === "failed" ? 0.3 + Math.sin(clock * 3 + i) * 0.15 * m : 0;
      u.panelMat.emissive.setHex(u.status === "pending" ? 0x3a2a08 : 0x000000);
      u.panelMat.emissiveIntensity = u.status === "pending" ? 0.5 + Math.sin(clock * 5) * 0.5 * m : 1;
    });
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
    meadow.sparkles.material.uniforms.time.value = reduceMotion ? 0 : clock;
    water.material.uniforms.time.value = clock * m;
    falls.material.uniforms.time.value = clock * m;
    // The Cat comes and goes, tail first and grin last.
    centre.cat.update(clock, { still: reduceMotion });

    composer.render();
    placeLabels();
  }
  requestAnimationFrame(frame);

  return { update, errand, focus };
}
