// The map: Alice's routes stay dry except over a bridge, the bridges land on
// dry banks, and nothing that stands on the ground stands in the water.
import {
  CLEARING, DISTRICTS, KEYS, PATHS, BRIDGES, GREAT_TREE, CROQUET, WATER_Y,
  groundHeight, walkHeight, deckHeight, wet, meadowClear,
} from "../public/layout.js";

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const dry = (p) => groundHeight(p.x, p.z) > WATER_Y + 0.15;

for (const key of KEYS) {
  const { walk } = PATHS[key];
  for (const p of walk) {
    const onBridge = deckHeight(p.x, p.z) > -Infinity;
    if (!dry(p) && !onBridge) fail(`the way to ${key} wades through water at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    if (walkHeight(p.x, p.z) < WATER_Y + 0.1) fail(`the way to ${key} dips under the water at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  }
  // Consecutive steps close together, so she never cuts a corner across water.
  for (let i = 1; i < walk.length; i++) {
    if (walk[i].distanceTo(walk[i - 1]) > 0.8) fail(`the way to ${key} has a ${walk[i].distanceTo(walk[i - 1]).toFixed(2)} gap`);
  }
  if (walk.at(-1).distanceTo(DISTRICTS[key].door) > 0.6) fail(`the way to ${key} stops short of its door`);
  if (walk[0].distanceTo(CLEARING) > 5) fail(`the way to ${key} doesn't start at the clearing`);
  const d = DISTRICTS[key];
  for (const p of [d.anchor, d.door]) {
    if (wet(p.x, p.z, 1) || Math.abs(groundHeight(p.x, p.z)) > 0.05) fail(`${key} doesn't stand on flat, dry ground`);
  }
}

for (const [key, b] of Object.entries(BRIDGES)) {
  if (!dry(b.start) || !dry(b.end)) fail(`the ${key} bridge doesn't reach dry land at both ends`);
  if (dry(b.centre)) fail(`the ${key} bridge isn't over the water`);
}

for (const [name, p] of [["clearing", CLEARING], ["great tree", GREAT_TREE], ["croquet lawn", CROQUET.centre]]) {
  if (wet(p.x, p.z, 1) || Math.abs(groundHeight(p.x, p.z)) > 0.05) fail(`the ${name} isn't on flat, dry ground`);
}
if (meadowClear(CLEARING.x, CLEARING.z)) fail("flowers would grow in the clearing");
if (meadowClear(PATHS.hall.walk[10].x, PATHS.hall.walk[10].z)) fail("flowers would grow on a path");

console.log("PASS: layout — dry routes, bridges bank to bank, everything on solid ground");
