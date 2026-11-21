// The Cheshire Cat as a model: public/models/cheshire.glb, made with Meshy
// from a picture of him lying on his belly with his chin on a paw — a still
// model, no skeleton, since all he does on his branch is grin and vanish.
//
// He vanishes as the book has it, "beginning with the end of the tail, and
// ending with the grin, which remained some time after the rest of it had
// gone": a dissolve shrinks in on his grin until only his teeth are left,
// then those go too. He comes back eyes first, out of the air around them.
//
// world.js starts with the Cat built from primitives (cheshire-figure.js) and
// swaps this one in once it has loaded. Same interface: { group, update }.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Where his face is in the picture he was made from, as fractions of the
// picture's width and height (from the top left). The model faces +z the way
// he faced the viewer, so these are found on its front.
const FACE = { grin: [0.349, 0.741], eyes: [0.319, 0.6] };

// One cycle, in seconds: there, going, just the grin, gone, coming back.
const CYCLE = 30;
const T = { going: 12, grinOnly: 18, grinGoes: 22, gone: 23.5, back: 25, whole: 30 };

const ease = (x) => x * x * (3 - 2 * x);
const span = (t, a, b) => ease(THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));

/**
 * The dissolve, added to his material: fragments farther than `cut` from
 * `centre` (wobbled a little, so the edge isn't a clean sphere) are gone, the
 * ones at the edge glow, and with `grinOnly` up, all but his teeth fade out.
 */
function dissolve(material) {
  const uniforms = {
    uCentre: { value: new THREE.Vector3() },
    uCut: { value: 1e3 },
    uGrinOnly: { value: 0 },
    uGlow: { value: new THREE.Color(0xff9be6) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCatPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCatPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vCatPos;
uniform vec3 uCentre;
uniform float uCut;
uniform float uGrinOnly;
uniform vec3 uGlow;
float catEdge;
float catTooth;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
{
  vec3 p = vCatPos * 9.0;
  float wobble = sin(p.x) * sin(p.y + 1.3) * sin(p.z + 2.1) * 0.06;
  float d = distance(vCatPos, uCentre) + wobble;
  if (d > uCut) discard;
  catEdge = smoothstep(uCut - 0.05, uCut, d);
  // his teeth: bright and colourless, where the fur around them is pink
  vec3 c = diffuseColor.rgb;
  float lo = min(c.r, min(c.g, c.b)), hi = max(c.r, max(c.g, c.b));
  bool tooth = lo > 0.55 && hi - lo < 0.14;
  catTooth = tooth ? 1.0 : 0.0;
  float grain = fract(sin(dot(floor(vCatPos * 55.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  if (!tooth && grain < uGrinOnly) discard;
}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
totalEmissiveRadiance += uGlow * catEdge * 1.6;
// a grin on its own, out of the shade of his face, catches the light
totalEmissiveRadiance += vec3(0.75) * catTooth * uGrinOnly;`);
  };
  return uniforms;
}

/** The point on the front of `mesh` under a spot in the picture. */
function onFront(mesh, box, [fx, fy]) {
  const size = box.getSize(new THREE.Vector3());
  const from = new THREE.Vector3(box.min.x + fx * size.x, box.max.y - fy * size.y, box.max.z + 1);
  const hit = new THREE.Raycaster(from, new THREE.Vector3(0, 0, -1)).intersectObject(mesh)[0];
  const p = hit ? hit.point : from.setZ(box.max.z);
  return mesh.worldToLocal(p.clone());
}

/** Load him from `url`, `length` long nose to tail, his belly at y = 0. */
export async function loadCheshire(url, { length }) {
  const gltf = await new GLTFLoader().loadAsync(url);
  let mesh = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) throw new Error("the Cat's model has no mesh");
  mesh.castShadow = true;
  mesh.material.metalness = 0;
  mesh.material.roughness = 0.9;

  const model = gltf.scene;
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  const k = length / (box.max.x - box.min.x);
  model.scale.multiplyScalar(k);
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const mid = box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(mid.x, box.min.y, mid.z));
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);

  const grin = onFront(mesh, box, FACE.grin);
  const eyes = onFront(mesh, box, FACE.eyes);
  // far enough out that a cut this wide leaves all of him, wobble and all
  const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
  let whole = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    whole = Math.max(whole, v.distanceTo(grin), v.distanceTo(eyes));
  }
  whole += 0.12;
  // just the grin: about as far as its corners reach. The dissolve works in the
  // model's own units (he's about one across), whatever size he's shown at.
  const grinR = 0.2;

  const u = dissolve(mesh.material);
  const group = new THREE.Group();
  group.name = "cheshire";
  group.add(model);

  function update(clock, { still = false } = {}) {
    const t = still ? 0 : clock % CYCLE;
    let cut = whole, grinOnly = 0, centre = grin;
    if (t >= T.going && t < T.back) {
      // going: in from the tail to the grin, then the face around the teeth thins away
      cut = THREE.MathUtils.lerp(whole, grinR, span(t, T.going, T.grinOnly));
      grinOnly = span(t, T.grinOnly - 1.5, T.grinOnly + 1);
      // and at last the grin itself
      cut *= 1 - span(t, T.grinGoes, T.gone);
    } else if (t >= T.back) {
      // back: out from the eyes
      centre = eyes;
      cut = THREE.MathUtils.lerp(0, whole, span(t, T.back, T.whole));
    }
    u.uCentre.value.copy(centre);
    u.uCut.value = cut;
    u.uGrinOnly.value = grinOnly;
    mesh.visible = cut > 0.001;
    // a cat half gone shouldn't leave a whole shadow
    mesh.castShadow = cut >= whole * 0.98;
  }

  update(0, { still: true });
  return { group, update };
}
