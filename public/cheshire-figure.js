// The Cheshire Cat, from primitives, lying along a branch: a striped body, a
// tail hanging down, and a face whose grin and eyes are painted on shells
// over the head, so they can stay behind when the rest of him has gone.
//
// He vanishes as the book has it — "beginning with the end of the tail, and
// ending with the grin, which remained some time after the rest of it had
// gone" — and comes back eyes first.
//
// He lies along +x with his face to +z, his belly on y = 0 (the top of the
// branch). `update(clock, { still })` runs the vanishing and the tail's sway;
// world.js places the group.
import * as THREE from "three";

const C = {
  deep: "#9c3a8a",
  soft: "#ee9fd0",
  belly: "#f6c4e2",
  eye: "#d6e64a",
  ink: "#2a1630",
  nose: 0xd0457f,
  whisker: 0xfff5fb,
};

const mat = (extra = {}) =>
  new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0, ...extra });

function part(geo, material, [x = 0, y = 0, z = 0] = [], rot = null, scale = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(...rot);
  if (scale) m.scale.set(...scale);
  m.castShadow = true;
  return m;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Bands across a texture: rows when `across` is "v", columns when "u". Each
 * band is wobbled a little, or they read as a barber's pole.
 */
function stripes(across, n, { from = 0, to = 1, base = C.soft } = {}) {
  return canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    c.fillStyle = C.deep;
    const len = across === "v" ? h : w;
    for (let i = 0; i < n; i++) {
      const at = (from + ((i + 0.5) / n) * (to - from)) * len;
      const half = (len / n) * 0.24 * (to - from);
      c.beginPath();
      for (let s = 0; s <= 32; s++) {
        const k = s / 32;
        const wob = Math.sin(k * Math.PI * 4 + i * 1.7) * half * 0.35;
        if (across === "v") c.lineTo(k * w, at - half + wob);
        else c.lineTo(at - half + wob, k * h);
      }
      for (let s = 32; s >= 0; s--) {
        const k = s / 32;
        const wob = Math.sin(k * Math.PI * 4 + i * 1.7 + 0.8) * half * 0.35;
        if (across === "v") c.lineTo(k * w, at + half + wob);
        else c.lineTo(at + half + wob, k * h);
      }
      c.fill();
    }
  });
}

/** A tube whose radius narrows from `r0` to `r1` along its length. */
function taperedTube(curve, r0, r1, segments = 48, radial = 12) {
  const geo = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const pos = geo.attributes.position;
  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / (radial + 1)) / segments;
    curve.getPointAt(t, centre);
    v.fromBufferAttribute(pos, i).sub(centre).multiplyScalar(r0 + (r1 - r0) * t).add(centre);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/*
 * The face, as two transparent shells just proud of the head. A patch of
 * sphere `phiLength` wide around +z and `thetaLength` tall around the
 * equator, so the canvas maps across the front of the face left to right.
 */
const FACE = { thetaStart: 0.72, thetaLength: 1.7 };
function faceShell(r, texture, phiLength) {
  const { thetaStart, thetaLength } = FACE;
  const geo = new THREE.SphereGeometry(r, 40, 24, Math.PI / 2 - phiLength / 2, phiLength, thetaStart, thetaLength);
  const m = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, depthWrite: false, roughness: 0.5,
    // A touch of glow, so the grin still shows when the head's in shade.
    emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.25,
  });
  m.userData.alwaysTransparent = true;
  const mesh = new THREE.Mesh(geo, m);
  return { mesh, material: m };
}

/**
 * Eyes: big and round, pupils glancing in a little, as in the studio's
 * drawings of him — friendly, not a predator's slits.
 */
function eyesTexture() {
  return canvasTexture(512, 400, (c, w, h) => {
    for (const x of [0.33, 0.67]) {
      const cx = x * w, cy = 0.3 * h;
      const look = x < 0.5 ? 7 : -7;
      c.fillStyle = C.ink;
      c.beginPath(); c.ellipse(cx, cy, 50, 56, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = C.eye;
      c.beginPath(); c.ellipse(cx, cy, 45, 51, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = C.ink;
      c.beginPath(); c.ellipse(cx + look, cy + 6, 23, 27, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#ffffff";
      c.beginPath(); c.arc(cx + look + 9, cy - 4, 9, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(cx + look - 8, cy + 18, 4, 0, Math.PI * 2); c.fill();
    }
  });
}

/**
 * The grin: wide, as it has to be, but a smile rather than a snarl — one
 * clean band of teeth between soft lips, no dark mouth and no fangs.
 */
function grinTexture() {
  return canvasTexture(512, 400, (c, w, h) => {
    const l = 0.12 * w, r = 0.88 * w, top = 0.5 * h;
    // A quadratic's middle sits halfway to its control point, so these
    // controls are twice as far down as the curves they draw.
    const smile = new Path2D();
    smile.moveTo(l, top);
    smile.quadraticCurveTo(w / 2, top + 44, r, top);
    smile.quadraticCurveTo(w / 2, top + 210, l, top);
    c.fillStyle = "#fffdf8"; c.fill(smile);
    // where the teeth meet, faintly
    c.strokeStyle = "#e3d3dc"; c.lineWidth = 3;
    c.beginPath(); c.moveTo(l + 24, top + 12); c.quadraticCurveTo(w / 2, top + 126, r - 24, top + 12); c.stroke();
    c.strokeStyle = C.ink; c.lineWidth = 5; c.lineJoin = "round"; c.stroke(smile);
    // the corners, curling up into the cheeks
    c.lineWidth = 5; c.lineCap = "round";
    for (const [x, d] of [[l, -1], [r, 1]]) {
      c.beginPath(); c.moveTo(x, top); c.quadraticCurveTo(x + d * 18, top - 6, x + d * 20, top - 24); c.stroke();
    }
  });
}

/**
 * The head's fur, wrapped round a sphere whose front (+z) is a quarter of the
 * way across: curved stripes over the brow, and a paler muzzle below the
 * eyes, where the grin sits. Nothing striped on the face itself.
 */
function headTexture() {
  return canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = C.soft; c.fillRect(0, 0, w, h);
    c.fillStyle = C.deep;
    for (const [v, t] of [[0.1, 0.045], [0.19, 0.045], [0.28, 0.04]]) {
      c.beginPath();
      for (let s = 0; s <= 64; s++) c.lineTo((s / 64) * w, (v - t / 2 + Math.sin(s * 0.6) * 0.008) * h);
      for (let s = 64; s >= 0; s--) c.lineTo((s / 64) * w, (v + t / 2 + Math.sin(s * 0.6 + 1) * 0.008) * h);
      c.fill();
    }
    c.fillStyle = C.belly;
    c.beginPath(); c.ellipse(0.25 * w, 0.72 * h, 0.17 * w, 0.24 * h, 0, 0, Math.PI * 2); c.fill();
  });
}

/* ------------------------------------------------------------- vanishing */

// Seconds into each cycle. Gone tail first, grin last; back eyes first.
const CYCLE = 30;
const PARTS = ["tail", "body", "head", "eyes", "grin"];
const GOES = { tail: 16, body: 17.2, head: 18.4, eyes: 19.4, grin: 20.8 };
const COMES = { eyes: 25, grin: 25.8, head: 26.8, body: 27.6, tail: 28.2 };
const FADE = 1.3;

const ease = (t) => t * t * (3 - 2 * t);
function presence(name, t) {
  const out = THREE.MathUtils.clamp((t - GOES[name]) / FADE, 0, 1);
  const back = THREE.MathUtils.clamp((t - COMES[name]) / FADE, 0, 1);
  return t < COMES[name] ? 1 - ease(out) : ease(back);
}

/* ------------------------------------------------------------------- Cat */

export function buildCheshire() {
  const cat = new THREE.Group();
  cat.name = "cheshire";
  // Each part fades on its own, so each keeps its own materials.
  const parts = Object.fromEntries(PARTS.map((p) => [p, { meshes: [], materials: [] }]));
  const add = (name, parent, mesh) => {
    parent.add(mesh);
    parts[name].meshes.push(mesh);
    if (!parts[name].materials.includes(mesh.material)) parts[name].materials.push(mesh.material);
    return mesh;
  };

  // --- body: a long loaf on the branch, rings of stripes along it ----------
  const furBody = mat({ map: stripes("v", 9, { from: 0.08, to: 0.92 }) });
  const bodyGeo = new THREE.SphereGeometry(1, 40, 24).rotateZ(Math.PI / 2);
  add("body", cat, part(bodyGeo, furBody, [0, 0.46, 0], null, [1.25, 0.5, 0.56]));
  // a haunch, and front paws hanging over the front of the branch
  add("body", cat, part(new THREE.SphereGeometry(1, 24, 16).rotateZ(Math.PI / 2), furBody, [-0.62, 0.52, 0.18], null, [0.55, 0.42, 0.4]));
  const paw = mat({ color: C.belly });
  for (const x of [0.82, 1.18]) {
    add("body", cat, part(new THREE.CapsuleGeometry(0.11, 0.22, 6, 12), paw, [x, 0.1, 0.5], [1.25, 0, 0]));
  }

  // --- tail: down off the back of the branch, curling up at the tip --------
  const tail = new THREE.Group();
  tail.position.set(-1.15, 0.42, 0.05);
  cat.add(tail);
  const tailCurve = new THREE.CatmullRomCurve3([
    [0, 0, 0], [-0.4, -0.2, 0.08], [-0.6, -0.75, 0.15], [-0.5, -1.35, 0.2], [-0.15, -1.6, 0.25], [0.12, -1.38, 0.26], [0.08, -1.12, 0.24],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const furTail = mat({ map: stripes("u", 7, { from: 0.05, to: 0.95 }) });
  add("tail", tail, part(taperedTube(tailCurve, 0.16, 0.07), furTail));

  // --- head: turned to look at you, ears up --------------------------------
  const head = new THREE.Group();
  head.position.set(1.4, 0.98, 0.18);
  head.rotation.set(0.12, 0.28, -0.06);
  cat.add(head);
  const R = 0.62;
  const furHead = mat({ map: headTexture() });
  add("head", head, part(new THREE.SphereGeometry(R, 40, 28), furHead, [0, 0, 0], null, [1.08, 0.94, 1]));
  // Fur in soft lobes, not cones: cones read as thorns. A tuft on the
  // crown, which also hides where the brow's stripes meet...
  const lobe = new THREE.SphereGeometry(1, 16, 12);
  const tuft = mat({ color: C.soft });
  for (const [x, lean] of [[-0.1, 0.45], [0, 0], [0.1, -0.45]]) {
    add("head", head, part(lobe, tuft, [x, 0.58, 0.08], [0.3, 0, lean], [0.07, 0.17, 0.07]));
  }
  // ...and cheek fluff flaring out past the grin, pale like the muzzle.
  const fluff = mat({ color: C.belly });
  for (const s of [-1, 1]) {
    for (const [y, a] of [[-0.04, 0.3], [-0.18, 0], [-0.31, -0.3]]) {
      add("head", head, part(lobe, fluff, [s * 0.66, y, 0.12], [0, 0, s * a], [0.22, 0.1, 0.1]));
    }
  }
  const earOut = mat({ color: C.deep });
  const earIn = mat({ color: C.belly });
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.36, 0.46, -0.04);
    ear.rotation.set(-0.1, 0, -s * 0.32);
    head.add(ear);
    add("head", ear, part(new THREE.ConeGeometry(0.22, 0.48, 16), earOut, [0, 0.16, 0]));
    add("head", ear, part(new THREE.ConeGeometry(0.13, 0.32, 16), earIn, [0, 0.12, 0.08], null, [1, 1, 0.4]));
  }
  add("head", head, part(new THREE.SphereGeometry(0.1, 16, 12), mat({ color: C.nose }), [0, -0.01, R * 0.99], null, [1.3, 0.85, 0.8]));
  const whisker = mat({ color: C.whisker });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const w = part(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 5), whisker,
        [s * 0.8, -0.04 - i * 0.07, 0.3], [0, s * 0.35, Math.PI / 2 + s * (i - 1) * 0.18]);
      w.castShadow = false;
      add("head", head, w);
    }
  }
  // The face, last of all to go. The grin's shell sits outside the eyes' so
  // the two never fight over the same depth.
  const eyes = faceShell(R * 1.01, eyesTexture(), 2.1);
  eyes.mesh.scale.set(1.08, 0.94, 1);
  add("eyes", head, eyes.mesh);
  // Wider than the eyes' shell, so the grin can reach nearly round to the ears.
  const grin = faceShell(R * 1.03, grinTexture(), 2.8);
  grin.mesh.scale.set(1.08, 0.94, 1);
  add("grin", head, grin.mesh);

  function show(name, o) {
    const p = parts[name];
    for (const m of p.materials) {
      m.opacity = o;
      m.transparent = o < 1 || Boolean(m.userData.alwaysTransparent);
    }
    for (const mesh of p.meshes) {
      mesh.visible = o > 0.01;
      // A cat half gone shouldn't leave a whole shadow.
      if (mesh.material !== eyes.material && mesh.material !== grin.material) mesh.castShadow = o > 0.6;
    }
  }

  function update(clock, { still = false } = {}) {
    if (still) {
      for (const p of PARTS) show(p, 1);
      return;
    }
    const t = clock % CYCLE;
    for (const p of PARTS) show(p, presence(p, t));
    tail.rotation.set(Math.sin(clock * 0.9) * 0.12, 0, Math.sin(clock * 0.6) * 0.1);
    head.rotation.z = -0.06 + Math.sin(clock * 0.4) * 0.05;
  }

  update(0);
  return { group: cat, update };
}
