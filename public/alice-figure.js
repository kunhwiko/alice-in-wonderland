// Alice, from primitives: the blue dress, the white pinafore and collar, the
// black hairband. Nothing here is borrowed artwork — it's spheres and cones,
// so the world carries none of the licensing caveats the old portraits did.
//
// Her face is painted, not modelled: a canvas texture on the head, the way a
// doll's face is. Features built from little spheres stood proud of the head
// and read as beads and wire from any angle; paint sits flush and stays soft.
//
// She faces +z. The returned `pose(dt, { walking, speed })` animates her in
// place; world.js moves and turns the group.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const C = {
  dress: 0x5c9fe6,
  white: 0xfffefa,
  skin: 0xffd5c2,
  hair: 0xf7d684,
  band: 0x1f1d2b,
  shoe: 0x1f1d2b,
};

// She's the one character in the world, so she's smooth-shaded: the facets
// that suit a mushroom make a face look blotchy.
const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra });

/** A mesh that casts a shadow, positioned in one go. */
function part(geo, material, [x = 0, y = 0, z = 0] = [], rot = null, scale = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(...rot);
  if (scale) m.scale.set(...scale);
  m.castShadow = true;
  return m;
}

/**
 * A surface of revolution through `profile` ([radius, y] pairs, top to
 * bottom), rippled into soft folds — cloth, where a cone would be tin.
 *
 * Each ripple is `{ folds, depth, span }`: `folds` per full turn, deepening
 * from nothing at the top of `span` ([top, bottom]; the profile's own by
 * default) to `depth` at its bottom. A layer laid over the skirt takes the
 * skirt's ripple as well as its own, so it lies in the same folds rather
 * than cutting through them.
 */
function cloth(profile, { ripples = [], segments = 56, phiStart = 0, phiLength = Math.PI * 2 } = {}) {
  // A lathe wants its points bottom to top, or it turns out inside out.
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y)).reverse();
  const geo = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  const pos = geo.attributes.position;
  const own = [profile[0][1], profile.at(-1)[1]];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(x, z);
    let k = 1;
    for (const { folds, depth, span: [top, bottom] = own } of ripples) {
      const t = Math.max(0, (top - y) / (top - bottom));
      k += depth * t * t * Math.sin(a * folds);
    }
    pos.setXYZ(i, x * k, y, z * k);
  }
  // Welded, so the seam where the lathe closes doesn't shade as a crease.
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  const out = mergeVertices(geo);
  out.computeVertexNormals();
  return out;
}

/** The radius of `profile` at height `y`, for laying one cloth over another. */
function radiusAt(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
    if (y <= y0 && y >= y1) return r0 + ((y0 - y) / (y0 - y1)) * (r1 - r0);
  }
  return profile.at(-1)[0];
}

/** Lift every radius of `profile` by `by`, keeping only the part between `from` and `to`. */
function over(profile, by, from, to) {
  const ys = [from, ...profile.map(([, y]) => y).filter((y) => y < from && y > to), to];
  return ys.map((y) => [radiusAt(profile, y) + by, y]);
}

/* ------------------------------------------------------------------ face */

const HEAD_R = 0.2;

/**
 * The face, painted on an equirectangular canvas that wraps the whole head.
 * Front (+z) is a quarter of the way across, the equator half way down, and
 * at 1024×512 one pixel is the same size both ways — so features can be laid
 * out in head-units without stretching.
 */
function faceTexture() {
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const px = W / (2 * Math.PI * HEAD_R); // pixels per world unit
  const cx = W / 4, cy = H / 2;
  const at = (x, y) => [cx + x * px, cy - y * px]; // head-units, y up

  const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

  // Hair everywhere, then the face cut out of it. A sphere can only open a
  // straight-edged window for the face; paint can give her a hairline — a
  // centre parting, curving down past the temples.
  g.fillStyle = hex(C.hair);
  g.fillRect(0, 0, W, H);
  const face = new Path2D();
  const p = (x, y) => at(x, y);
  face.moveTo(...p(0, 0.078));
  face.quadraticCurveTo(...p(-0.05, 0.112), ...p(-0.112, 0.082));
  // Below the temples the skin runs on round under the modelled hair, so
  // from the side the edge of her face is the hair itself, not a painted line.
  face.quadraticCurveTo(...p(-0.158, 0.045), ...p(-0.155, -0.01));
  face.quadraticCurveTo(...p(-0.17, -0.06), ...p(-0.3, -0.08));
  face.lineTo(...p(-0.3, -0.32));
  face.lineTo(...p(0.3, -0.32));
  face.lineTo(...p(0.3, -0.08));
  face.quadraticCurveTo(...p(0.17, -0.06), ...p(0.155, -0.01));
  face.quadraticCurveTo(...p(0.158, 0.045), ...p(0.112, 0.082));
  face.quadraticCurveTo(...p(0.05, 0.112), ...p(0, 0.078));
  g.fillStyle = hex(C.skin);
  g.fill(face);
  // the faintest strands, swept back from the parting
  g.strokeStyle = "rgba(205, 160, 70, 0.22)";
  g.lineWidth = 2;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(...p(s * 0.004, 0.09 + i * 0.014));
      g.quadraticCurveTo(...p(s * (0.06 + i * 0.01), 0.125 + i * 0.014), ...p(s * (0.14 + i * 0.012), 0.07 + i * 0.022));
      g.stroke();
    }
  }

  // blush, under everything else
  for (const s of [-1, 1]) {
    const [x, y] = at(s * 0.112, -0.078);
    const r = 0.04 * px;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(247, 145, 150, 0.5)");
    grad.addColorStop(1, "rgba(247, 145, 150, 0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  for (const s of [-1, 1]) {
    const [ex, ey] = at(s * 0.07, -0.014);
    const rx = 0.034 * px, ry = 0.044 * px;

    // the white of the eye, just showing round the iris
    g.fillStyle = "#ffffff";
    g.beginPath(); g.ellipse(ex, ey + 2, rx * 1.12, ry * 0.98, 0, 0, Math.PI * 2); g.fill();

    // iris: a deep blue at the top shading to bright, like her dress
    const iris = g.createLinearGradient(ex, ey - ry, ex, ey + ry);
    iris.addColorStop(0, "#1f3f7a");
    iris.addColorStop(0.55, "#3d74c4");
    iris.addColorStop(1, "#79b4ec");
    g.fillStyle = iris;
    g.beginPath(); g.ellipse(ex, ey + 3, rx * 0.88, ry * 0.9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#14203d";
    g.beginPath(); g.ellipse(ex, ey + 4, rx * 0.42, ry * 0.46, 0, 0, Math.PI * 2); g.fill();

    // catchlights — the thing that makes an eye look alive
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.beginPath(); g.ellipse(ex - s * rx * 0.3, ey - ry * 0.3, rx * 0.26, ry * 0.22, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(ex + s * rx * 0.32, ey + ry * 0.38, rx * 0.11, 0, Math.PI * 2); g.fill();

    // upper lid and lashes: one confident line, flicked at the outer corner
    g.strokeStyle = "#3a2622";
    g.lineCap = "round";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(ex - s * rx * 1.15, ey - ry * 0.15);
    g.quadraticCurveTo(ex, ey - ry * 1.35, ex + s * rx * 1.2, ey - ry * 0.35);
    g.stroke();
    // two lashes at the outer corner, fanning out
    g.lineWidth = 3.5;
    for (const [dx, dy] of [[1.55, 0.78], [1.35, 1.05]]) {
      g.beginPath();
      g.moveTo(ex + s * rx * 1.05, ey - ry * (0.45 + (dy - 0.78) * 0.6));
      g.lineTo(ex + s * rx * dx, ey - ry * dy);
      g.stroke();
    }
    // a faint lower lid
    g.strokeStyle = "rgba(150, 95, 80, 0.45)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ex - s * rx * 0.7, ey + ry * 1.0);
    g.quadraticCurveTo(ex, ey + ry * 1.25, ex + s * rx * 0.8, ey + ry * 0.9);
    g.stroke();

    // brows: fine, fair, a little raised — she's always curious
    const [bx, by] = at(s * 0.072, 0.068);
    g.strokeStyle = "#c29447";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(bx - s * 0.022 * px, by + 4);
    g.quadraticCurveTo(bx, by - 6, bx + s * 0.026 * px, by + 2);
    g.stroke();
  }

  // the merest hint of a nose
  {
    const [nx, ny] = at(0, -0.062);
    g.strokeStyle = "rgba(190, 120, 100, 0.55)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(nx - 5, ny);
    g.quadraticCurveTo(nx, ny + 4, nx + 5, ny);
    g.stroke();
  }

  // a small, closed smile with a touch of colour on the lip
  {
    const [mx, my] = at(0, -0.094);
    const w = 0.022 * px;
    g.fillStyle = "#e58a8f";
    g.beginPath();
    g.moveTo(mx - w, my);
    g.quadraticCurveTo(mx, my + 13, mx + w, my);
    g.quadraticCurveTo(mx, my + 5, mx - w, my);
    g.fill();
    g.strokeStyle = "#b9575e";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(mx - w * 1.05, my - 1);
    g.quadraticCurveTo(mx, my + 7, mx + w * 1.05, my - 1);
    g.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ----------------------------------------------------------------- Alice */

export function buildAlice() {
  const alice = new THREE.Group();
  alice.name = "alice";
  // Everything that bobs while she walks hangs off `body`, so the group's own
  // position stays on the ground for the world to path with.
  const body = new THREE.Group();
  alice.add(body);

  // Skin and hair glow a touch from within, so the light from above doesn't
  // leave her chin in a muddy shadow.
  const dress = mat(C.dress, { side: THREE.DoubleSide });
  const white = mat(C.white, { roughness: 0.8, side: THREE.DoubleSide });
  const skin = mat(C.skin, { roughness: 0.6, emissive: C.skin, emissiveIntensity: 0.26 });
  // The same glow as the painted head, so modelled hair and painted hair meet
  // without a seam.
  const hair = mat(C.hair, { roughness: 0.5, emissive: C.hair, emissiveIntensity: 0.2 });
  const black = mat(C.band, { roughness: 0.4 });

  // --- legs, pivoting at the hip so they can swing -------------------------
  const legs = [-0.09, 0.09].map((x) => {
    const hip = new THREE.Group();
    hip.position.set(x, 0.62, 0);
    hip.add(part(new THREE.CylinderGeometry(0.055, 0.04, 0.54, 14), white, [0, -0.27, 0]));
    // Mary Janes: rounded, with a strap
    hip.add(part(new THREE.SphereGeometry(0.068, 16, 10), black, [0, -0.55, 0.03], null, [0.85, 0.55, 1.35]));
    hip.add(part(new THREE.TorusGeometry(0.043, 0.008, 6, 14), black, [0, -0.52, 0.02], [Math.PI / 2, 0, 0]));
    body.add(hip);
    return hip;
  });

  // --- the dress: a bell of a skirt over a petticoat, a fitted bodice ------
  const SKIRT = [[0.15, 1.21], [0.21, 1.12], [0.3, 0.98], [0.38, 0.82], [0.44, 0.68], [0.47, 0.59], [0.465, 0.55], [0.44, 0.535]];
  const FOLDS = { folds: 9, depth: 0.06, span: [SKIRT[0][1], SKIRT.at(-1)[1]] };
  body.add(part(cloth(SKIRT, { ripples: [FOLDS] }), dress));
  // The petticoat's frill, peeking out under the hem.
  body.add(part(cloth([[0.43, 0.58], [0.45, 0.53], [0.46, 0.5]], { ripples: [FOLDS, { folds: 34, depth: 0.04 }] }), white));
  const BODICE = [[0, 1.56], [0.085, 1.555], [0.13, 1.5], [0.155, 1.4], [0.168, 1.28], [0.16, 1.2]];
  body.add(part(cloth(BODICE), dress));

  // The pinafore: a front panel in the skirt's own folds that stops short of
  // the hem, so the blue still reads as a skirt, finished with a ruffle...
  const front = { phiStart: -Math.PI * 0.29, phiLength: Math.PI * 0.58 };
  body.add(part(cloth(over(SKIRT, 0.012, 1.2, 0.68), { ripples: [FOLDS], ...front }), white));
  const r = radiusAt(SKIRT, 0.68) + 0.012;
  body.add(part(cloth([[r, 0.69], [r + 0.02, 0.645], [r + 0.03, 0.62]], { ripples: [FOLDS, { folds: 60, depth: 0.03 }], ...front }), white));
  // ...a bib, and straps over the shoulders.
  body.add(part(cloth(over(BODICE, 0.008, 1.46, 1.2), { phiStart: -Math.PI * 0.2, phiLength: Math.PI * 0.4 }), white));
  for (const s of [-1, 1]) {
    const strap = new THREE.CatmullRomCurve3([
      [0.085, 1.455, 0.13], [0.1, 1.535, 0.06], [0.105, 1.55, -0.02], [0.095, 1.46, -0.12], [0.085, 1.25, -0.165],
    ].map(([x, y, z]) => new THREE.Vector3(s * x, y, z)));
    body.add(part(new THREE.TubeGeometry(strap, 24, 0.014, 8), white));
  }
  // the waistband, and the big bow it ties into at the back
  body.add(part(new THREE.TorusGeometry(0.167, 0.024, 8, 32), white, [0, 1.2, 0], [Math.PI / 2, 0, 0]));
  for (const s of [-1, 1]) {
    body.add(part(new THREE.SphereGeometry(0.08, 16, 10), white, [s * 0.08, 1.22, -0.19], [0, 0, s * 0.45], [1.4, 0.72, 0.42]));
    body.add(part(cloth([[0.02, 1.2], [0.028, 1.1], [0.04, 0.98]], { segments: 10 }), white,
      [s * 0.05, 0, -0.19], [0.12, 0, s * 0.1], [1, 1, 0.3]));
  }
  body.add(part(new THREE.SphereGeometry(0.032, 10, 8), white, [0, 1.22, -0.19]));

  // Alice's white collar: two rounded halves, parted at the throat
  for (const s of [-1, 1]) {
    body.add(part(new THREE.CylinderGeometry(0.08, 0.16, 0.035, 24, 1, false, s > 0 ? 0.08 : Math.PI, Math.PI - 0.08),
      white, [0, 1.555, 0.005]));
  }

  // --- arms, pivoting at the shoulder --------------------------------------
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.175, 1.47, 0);
    // a puffed sleeve, banded in white
    shoulder.add(part(new THREE.SphereGeometry(0.088, 18, 14), dress, [0, -0.025, 0], null, [1, 0.88, 1]));
    shoulder.add(part(new THREE.TorusGeometry(0.056, 0.013, 8, 18), white, [0, -0.095, 0], [Math.PI / 2, 0, 0]));
    // a slender arm, tapering to the wrist
    shoulder.add(part(cloth([[0.036, -0.09], [0.034, -0.25], [0.027, -0.43], [0.024, -0.45]], { segments: 14 }), skin, [side * 0.01, 0, 0]));
    shoulder.add(part(new THREE.SphereGeometry(0.035, 14, 10), skin, [side * 0.012, -0.47, 0.005], null, [0.85, 1.1, 0.7]));
    shoulder.rotation.z = side * 0.14;
    body.add(shoulder);
    return shoulder;
  });

  // --- head ------------------------------------------------------------------
  const head = new THREE.Group();
  head.position.set(0, 1.76, 0);
  body.add(head);
  head.add(part(new THREE.CylinderGeometry(0.042, 0.048, 0.1, 14), skin, [0, -0.17, 0]));
  // The face and hairline are painted on (see faceTexture); the sphere's own
  // UVs put the painting's front, a quarter of the way round, at +z.
  const faceMap = faceTexture();
  head.add(part(new THREE.SphereGeometry(HEAD_R, 48, 32), mat(0xffffff, {
    map: faceMap, roughness: 0.6, emissive: 0xffffff, emissiveMap: faceMap, emissiveIntensity: 0.26,
  })));

  // Hair with some volume: a second sphere, set back a little, that the head
  // pokes out of at the front. Where the two meet is a smooth curve round
  // the face, and it falls behind the painted hairline, on painted hair...
  const HAIR_C = [0, 0.015, -0.03];
  head.add(part(new THREE.SphereGeometry(0.215, 48, 32), hair, HAIR_C));
  // ...a long fall down her back, loosening into waves at the ends...
  const FALL = [[0, 0.1], [0.17, 0.02], [0.215, -0.12], [0.225, -0.3], [0.21, -0.43], [0.15, -0.51], [0, -0.53]];
  head.add(part(cloth(FALL, { ripples: [{ folds: 14, depth: 0.07 }] }), hair, [0, 0, -0.1], null, [1, 1, 0.62]));
  // ...and a lock either side of her face, from the temple to the shoulder,
  // softening where face meets hair.
  // Its top starts inside the hair, so the lock grows out of it.
  const LOCK = [[0.03, 0.02], [0.05, -0.06], [0.052, -0.16], [0.042, -0.27], [0.026, -0.34], [0, -0.37]];
  for (const s of [-1, 1]) {
    const lock = new THREE.Group();
    lock.position.set(s * 0.178, -0.02, 0.035);
    lock.rotation.set(0.14, 0, s * 0.08);
    lock.add(part(cloth(LOCK, { segments: 18, ripples: [{ folds: 5, depth: 0.12 }] }), hair, [0, 0, 0], null, [0.7, 1, 0.55]));
    lock.add(part(new THREE.SphereGeometry(0.026, 12, 10), hair, [s * 0.006, -0.345, 0.02]));
    head.add(lock);
  }

  // The hairband, hugging the hair from ear to ear, with its little bow.
  head.add(part(new THREE.TorusGeometry(0.223, 0.016, 8, 40, Math.PI), black, HAIR_C, [0.42, 0, 0]));
  const bow = new THREE.Group();
  bow.position.set(0.11, 0.2, 0.05);
  bow.rotation.set(0.5, 0.3, -0.45);
  for (const s of [-1, 1]) bow.add(part(new THREE.ConeGeometry(0.035, 0.07, 10), black, [s * 0.035, 0, 0], [0, 0, s * Math.PI / 2]));
  bow.add(part(new THREE.SphereGeometry(0.018, 8, 6), black));
  head.add(bow);

  // A soft contact shadow, for when the real one is faint.
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 24),
    new THREE.MeshBasicMaterial({ color: 0x1f2a18, transparent: true, opacity: 0.18, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  alice.add(blob);

  let phase = 0;
  let idle = 0;

  /** Animate in place. `walking` blends her from a stroll into standing still. */
  function pose(dt, { walking = false, speed = 1 } = {}) {
    idle += dt;
    if (walking) {
      phase += dt * 7.5 * speed;
      const s = Math.sin(phase);
      legs[0].rotation.x = s * 0.5;
      legs[1].rotation.x = -s * 0.5;
      arms[0].rotation.x = -s * 0.45;
      arms[1].rotation.x = s * 0.45;
      body.position.y = Math.abs(Math.cos(phase)) * 0.04;
      head.rotation.y *= 0.9;
      head.rotation.z = s * 0.03;
    } else {
      // Settle the limbs, then breathe and look about a little.
      for (const l of [...legs, ...arms]) l.rotation.x *= 0.85;
      body.position.y = Math.sin(idle * 2) * 0.006;
      head.rotation.y = Math.sin(idle * 0.6) * 0.3;
      head.rotation.z = Math.sin(idle * 0.9) * 0.04;
    }
  }

  /** A little wave, for when she's arrived with news. */
  function wave(t) {
    arms[1].rotation.x = -2.6;
    arms[1].rotation.z = 0.25 + Math.sin(t * 9) * 0.35;
  }
  function unwave() {
    arms[1].rotation.z = 0.14;
  }

  return { group: alice, pose, wave, unwave, height: 2 };
}
