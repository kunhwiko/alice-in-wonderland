// Wonderland's map: where everything is, and the ground and water it stands
// on. Nothing here draws — world.js builds the place from it — so the parts
// that have to be right (Alice never wades through the stream; nothing is
// planted in a path) can be checked in node.
//
// Seen from the camera, which looks from +z toward -z: Alice's clearing at
// the front, the Tea Party in a glade to its left, the great tree with the
// Cat to its right by a pond. A stream runs across the middle from a
// waterfall at the back left, and beyond it, over two bridges, are the Hall of
// Doors (left) and the Queen's Court (right), with her castle on the hill.
import * as THREE from "three";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = ([x, z]) => V(x, 0, z);

/** Where Alice waits, and wanders when there's nothing to do. */
export const CLEARING = V(0, 0, 9);
export const CLEARING_R = 4.8;

/**
 * Each district: its centre, the spot Alice stands on to say what she found,
 * and how high its sign floats.
 */
export const DISTRICTS = {
  tea: { anchor: V(-16, 0, 3), door: V(-9.8, 0, 5.6), sign: 6.6 },
  court: { anchor: V(14, 0, -19), door: V(11.4, 0, -11), sign: 6.2 },
  hall: { anchor: V(-12, 0, -22), door: V(-10.4, 0, -14), sign: 6.4 },
};
export const KEYS = Object.keys(DISTRICTS);

export const GREAT_TREE = V(12.5, 0, 7.5);
export const CROQUET = { centre: V(23.5, 0, -12.5), r: 4 };
export const CASTLE = V(24, 0, -37);

/* ------------------------------------------------------------------ water */

/** The level of the water; the ground is carved below it where there's water. */
export const WATER_Y = -0.32;
export const FALLS = V(-34, 0, -21);
export const POND = { centre: V(21.5, 0, 2.5), r: 5.2 };
/** The stream, from the pool under the falls to the pond. */
export const STREAM = new THREE.CatmullRomCurve3(
  [[-34, -21], [-26, -15], [-17, -9.6], [-8, -8.2], [1, -7.6], [8, -5.6], [13.5, -2.6], [18, 0.6]].map(flat)
);
/** How far from the stream's middle the water reaches before the bank rises out of it. */
export const SHORE = 2.1;

const STREAM_PTS = STREAM.getSpacedPoints(320);

/** Distance from a point to a polyline, on the ground plane. */
function polyDist(pts, x, z) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}

export const streamDist = (x, z) => polyDist(STREAM_PTS, x, z);

/** How deep the ground is carved here, for the stream, the pond and the pool. */
function carve(x, z) {
  const ds = streamDist(x, z);
  const stream = 1.1 * (1 - THREE.MathUtils.smoothstep(ds, 1.1, 2.7));
  const dp = Math.hypot(x - POND.centre.x, z - POND.centre.z);
  const pond = 1.3 * (1 - THREE.MathUtils.smoothstep(dp, POND.r - 1.8, POND.r + 0.6));
  const df = Math.hypot(x - FALLS.x, z - FALLS.z);
  const pool = 1.2 * (1 - THREE.MathUtils.smoothstep(df, 1.2, 3.2));
  return Math.max(stream, pond, pool);
}

/** Water anywhere near here? (For keeping flowers and trees out of it.) */
export function wet(x, z, margin = 0.6) {
  return streamDist(x, z) < SHORE + margin
    || Math.hypot(x - POND.centre.x, z - POND.centre.z) < POND.r + margin
    || Math.hypot(x - FALLS.x, z - FALLS.z) < 3 + margin;
}

/* ---------------------------------------------------------------- bridges */

/**
 * A bridge over the stream near `near`: centred on the water, square to the
 * current, spanning from bank to bank. `dir` points across, from the near
 * (camera) side to the far side.
 */
function bridgeAt(near) {
  let best = 0, bestD = Infinity;
  STREAM_PTS.forEach((p, i) => {
    const d = Math.hypot(p.x - near.x, p.z - near.z);
    if (d < bestD) { bestD = d; best = i; }
  });
  const u = best / (STREAM_PTS.length - 1);
  const centre = STREAM.getPointAt(u);
  const t = STREAM.getTangentAt(u);
  const dir = V(-t.z, 0, t.x).normalize();
  if (dir.z > 0) dir.negate();
  const half = SHORE + 1.4;
  const at = (d) => centre.clone().addScaledVector(dir, d);
  // `way` is the path's line over it: a straight run-up either side, so the
  // cobbles meet the bridge square-on instead of curving onto it askew.
  return {
    centre, dir, half, width: 2.2, rise: 0.95,
    start: at(-half), end: at(half),
    way: [at(-half - 1.6), at(-half), at(0), at(half), at(half + 1.6)],
  };
}
export const BRIDGES = { hall: bridgeAt(V(-7.5, 0, -8)), court: bridgeAt(V(7.5, 0, -5.6)) };

/** The top of a bridge's deck here, or -Infinity off every bridge. */
export function deckHeight(x, z) {
  let h = -Infinity;
  for (const b of Object.values(BRIDGES)) {
    const lx = x - b.centre.x, lz = z - b.centre.z;
    const along = lx * b.dir.x + lz * b.dir.z;
    const across = -lx * b.dir.z + lz * b.dir.x;
    if (Math.abs(along) > b.half || Math.abs(across) > b.width / 2 + 0.15) continue;
    const t = (along + b.half) / (2 * b.half);
    h = Math.max(h, 0.05 + b.rise * Math.sin(Math.PI * t));
  }
  return h;
}

/* ------------------------------------------------------------------ paths */

const rim = (toward) => CLEARING.clone().add(toward.clone().sub(CLEARING).setY(0).normalize().multiplyScalar(CLEARING_R - 0.4));
/** A little way past the door, into the district, where the paving stops. */
const into = (key, by = 2) => {
  const d = DISTRICTS[key];
  return d.door.clone().add(d.anchor.clone().sub(d.door).setY(0).normalize().multiplyScalar(by));
};

function route(key, via) {
  const d = DISTRICTS[key];
  const points = [rim(via[0]), ...via, d.door, into(key)];
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const samples = curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.5));
  // Alice walks as far as the door; the paving goes a little further in.
  let stop = 0, best = Infinity;
  samples.forEach((p, i) => {
    const dd = p.distanceTo(d.door);
    if (dd < best) { best = dd; stop = i; }
  });
  return { curve, samples, walk: samples.slice(0, stop + 1) };
}

/** The paths from the clearing to each district, and the way Alice walks them. */
export const PATHS = {
  tea: route("tea", [flat([-7, 7.6])]),
  hall: route("hall", [flat([-2.6, 4.8]), flat([-5.2, 0.8]), ...BRIDGES.hall.way]),
  court: route("court", [flat([2.6, 4.8]), flat([4.6, 1.6]), ...BRIDGES.court.way]),
};
export const PATH_W = 1.9;

export const pathDist = (x, z) => Math.min(...KEYS.map((k) => polyDist(PATHS[k].samples, x, z)));

/* ----------------------------------------------------------------- ground */

/** Flat where things stand, rolling into hills past them, carved for water. */
export function groundHeight(x, z) {
  const r = Math.hypot(x, z + 4);
  const ramp = THREE.MathUtils.smoothstep(r, 30, 64);
  const n = Math.sin(x * 0.11) * Math.cos(z * 0.13) * 3 + Math.sin((x + z) * 0.05) * 4 + Math.cos(x * 0.31 - z * 0.27) * 0.8;
  // The castle's hill, a rise behind the Court — out where the hills are, so
  // it doesn't tilt the Court's own floor.
  const hill = 5 * Math.exp(-((x - CASTLE.x) ** 2 + (z - CASTLE.z) ** 2) / 500) * THREE.MathUtils.smoothstep(r, 26, 44);
  return ramp * (n + 3.5) + hill - carve(x, z);
}

/** What Alice stands on: the ground, or a bridge's deck where there is one. */
export const walkHeight = (x, z) => Math.max(groundHeight(x, z), deckHeight(x, z));

/* ----------------------------------------------------------------- meadow */

/**
 * Where flowers and grass may grow: not in the water, on a path, in a
 * district, the clearing, or round the great tree.
 */
export function meadowClear(x, z) {
  if (Math.hypot(x - CLEARING.x, z - CLEARING.z) < CLEARING_R + 0.6) return false;
  if (Math.hypot((x - DISTRICTS.tea.anchor.x - 0.5) / 7.6, (z - DISTRICTS.tea.anchor.z + 0.6) / 4.4) < 1) return false;
  if (Math.hypot(x - DISTRICTS.court.anchor.x, z - DISTRICTS.court.anchor.z) < 9) return false;
  if (Math.hypot(x - DISTRICTS.hall.anchor.x, z - DISTRICTS.hall.anchor.z) < 8.2) return false;
  if (Math.hypot(x - CROQUET.centre.x, z - CROQUET.centre.z) < CROQUET.r + 0.5) return false;
  if (Math.hypot(x - GREAT_TREE.x, z - GREAT_TREE.z) < 2.4) return false;
  if (wet(x, z)) return false;
  return pathDist(x, z) > PATH_W / 2 + 0.5;
}
