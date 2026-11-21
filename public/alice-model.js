// Alice as a rigged, animated character: a glTF model of her, made with Meshy
// from a front view of her in her blue dress and pinafore. public/models/
// alice.glb is the textured, rigged model with Idle and Wave clips;
// alice-walk.glb is only the skeleton with its walk, which plays on the same
// bones. Walk stays on the spot — world.js moves her along the paths.
//
// world.js starts with the Alice built from primitives (alice-figure.js) and
// swaps this one in once it has loaded, so a missing or broken file costs
// nothing but the upgrade. The interface is the same: a group facing +z, and
// pose / wave / unwave.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** A clip by name, allowing for Blender's "Armature|name|layer" style. */
const find = (clips, name) => clips.find((c) => c.name === name || c.name.split("|").includes(name));

/**
 * How far the walk would carry her each second at its own speed, in her
 * group's units: while a foot is planted it sweeps back under her by the
 * distance she covers, and it's planted for about 60% of each step.
 */
function strideRate(model, mixer, clip) {
  const action = mixer.clipAction(clip).play();
  const toe = model.getObjectByName("LeftToeBase") ?? model.getObjectByName("LeftFoot");
  const v = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 60; i++) {
    mixer.setTime((clip.duration * i) / 60);
    model.updateMatrixWorld(true);
    toe.getWorldPosition(v);
    lo = Math.min(lo, v.z);
    hi = Math.max(hi, v.z);
  }
  action.stop();
  mixer.setTime(0);
  return (hi - lo) / 0.6 / clip.duration;
}

/**
 * Load Alice from `url` (and her walk from `walkUrl`), scaled to `height`.
 * Resolves to the same shape as buildAlice(): { group, pose, wave, unwave, height }.
 */
export async function loadAlice(url, walkUrl, { height }) {
  const loader = new GLTFLoader();
  const [gltf, walk] = await Promise.all([loader.loadAsync(url), loader.loadAsync(walkUrl)]);
  const model = gltf.scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false; // skinned: its bounds don't follow the animation
    // Painted colour only, no maps for shine: keep her matte like the rest of the world.
    o.material.metalness = 0;
    o.material.roughness = 0.8;
  });

  // Her height, feet on the ground.
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const k = height / (box.max.y - box.min.y);
  model.scale.multiplyScalar(k);
  model.position.y -= box.min.y * k;

  const group = new THREE.Group();
  group.name = "alice";
  group.add(model);
  group.updateMatrixWorld(true);

  const mixer = new THREE.AnimationMixer(model);
  const clips = { Idle: find(gltf.animations, "Idle"), Wave: find(gltf.animations, "Wave_One_Hand"), Walk: walk.animations[0] };
  if (!clips.Idle || !clips.Walk) throw new Error("Alice's model needs Idle and Walk animations");
  const rate = strideRate(model, mixer, clips.Walk);
  const actions = Object.fromEntries(Object.entries(clips).map(([n, c]) => [n, c && mixer.clipAction(c)]));
  let playing = actions.Idle;
  playing.play();
  let waving = false;

  function play(next, fade = 0.3) {
    if (!next || next === playing) return;
    // Picked up where it is if it's still fading out: starting the walk over
    // from the first frame each time is a stutter in her step.
    if (!next.isRunning()) next.reset();
    next.play();
    playing.crossFadeTo(next, fade, false);
    playing = next;
  }

  /** `pace` is how fast she's going, in her own units a second: her steps keep up with it. */
  function pose(dt, { walking = false, pace = rate } = {}) {
    play(waving && !walking ? actions.Wave ?? actions.Idle : walking ? actions.Walk : actions.Idle);
    actions.Walk.timeScale = pace / rate;
    mixer.update(dt);
  }

  return {
    group, pose, height,
    wave() { waving = true; },
    unwave() { waving = false; },
  };
}
