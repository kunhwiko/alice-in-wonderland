// Executes public/app.js against a minimal DOM stub.
//
// `node --check` only parses — it won't catch a temporal-dead-zone reference,
// a missing element id, or anything else that throws at module load. Those
// break the entire page silently, so run this after editing app.js:
//
//   npm test
import { mkdtemp, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(dirname(fileURLToPath(import.meta.url))), "public");

// Every node created is recorded, so the test can find one and fire its
// handler — that's how we reach code behind a click, such as the decree.
const created = [];

const mk = () => {
  const node = {
    textContent: "", className: "", href: "", src: "", value: "", disabled: false,
    style: {}, dataset: {}, onclick: null, onchange: null, onkeydown: null, onsubmit: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append() {}, replaceChildren() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    showModal() {}, close() {}, reset() {}, querySelector: () => mk(),
    cwd: { value: "" }, prompt: { value: "" }, sessionName: { value: "" }, sessionModel: { value: "" },
  };
  created.push(node);
  return node;
};

const ids = [
  "tagline", "new-btn", "new-go", "new-where-label", "new-what-label",
  "footer", "queue", "archive", "archive-summary", "new-dialog", "new-form",
  "new-dismiss", "favicon", "portrait", "new-name-label", "new-model-label", "new-model", "title",
];
const nodes = Object.fromEntries(ids.map((i) => [i, mk()]));
const missing = new Set();

globalThis.document = {
  getElementById: (id) => {
    if (!nodes[id]) missing.add(id);
    return nodes[id] ?? mk();
  },
  createElement: () => mk(),
  addEventListener() {},
  // A full stub node: app.js touches body.classList and body.dataset.
  body: { ...mk(), dataset: {} },
  title: "",
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.EventSource = class { set onmessage(_) {} };

// One todo per status, so every branch of renderCard runs: each pip, each
// group, the archive row, and the buttons attached to all of them.
const base = { kind: "owned", cwd: "/tmp/x", name: "x", title: "t", lastText: null,
               pending: null, closedAt: null, sessionId: "s1", isLive: true };
const todos = [
  { ...base, id: "a", status: "needs-you", pending: {
      id: "r1", kind: "permission", toolName: "Bash",
      input: { command: "rm -rf ./cache", description: "Remove the cache" }, suggestions: [] } },
  { ...base, id: "b", status: "working", subagents: {
      t1: { id: "t1", type: "Explore", description: "survey the CRD tree",
            status: "running", tools: { Grep: 12, Read: 3 }, lastText: "Looking…" },
      t2: { id: "t2", type: "Plan", description: "design the migration",
            status: "done", tools: { Read: 4 }, lastText: null } } },
  { ...base, id: "c", status: "idle" },
  { ...base, id: "d", status: "interrupted" },
  { ...base, id: "e", status: "failed" },
  { ...base, id: "f", status: "stopped" },
  { ...base, id: "g", status: "gone", kind: "external" },
  { ...base, id: "h", status: "idle", closedAt: Date.now() },
  { ...base, id: "i", status: "needs-you", kind: "external", pending: null },
  { ...base, id: "j", status: "needs-you", pending: {
      id: "r2", kind: "question", toolName: "AskUserQuestion",
      input: { questions: [{ question: "Which?", header: "H", multiSelect: false,
        options: [{ label: "One", description: "d" }, { label: "Two", description: "d" }] }] },
      suggestions: [] } },
];
globalThis.fetch = async () => ({ ok: true, json: async () => ({ todos }) });
globalThis.HTMLInputElement = class {};
globalThis.HTMLTextAreaElement = class {};
globalThis.queueMicrotask = (f) => f();
// Node 22 defines a getter-only `navigator`, so assignment throws.
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true,
});

// app.js imports "/alice.js", an absolute URL only the browser resolves.
// Stage both files side by side and rewrite that one specifier.
const dir = await mkdtemp(join(tmpdir(), "wonderland-smoke-"));
try {
  await copyFile(join(PUBLIC, "alice.js"), join(dir, "alice.js"));
  const src = await readFile(join(PUBLIC, "app.js"), "utf8");
  await writeFile(join(dir, "app.js"), src.replace('from "/alice.js"', 'from "./alice.js"'));
  await import(join(dir, "app.js"));
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (missing.size) {
  console.error(`FAIL: app.js asked for element ids absent from index.html: ${[...missing].join(", ")}`);
  process.exit(1);
}

// Card bodies only render for the open card, so the decree and the question
// form sit behind a click. Fire every card-head handler to reach them.
const heads = created.filter((n) => n.className === "card-head" && typeof n.onclick === "function");
if (!heads.length) {
  console.error("FAIL: no card-head nodes were created — renderCard did not run");
  process.exit(1);
}
// Only one card is open at a time, so a card's children must be exercised
// while that card is still the open one — clicking every head first and then
// its children would find them all closed again.
let subHeadCount = 0;
for (const head of heads) {
  const before = created.length;
  head.onclick({ stopPropagation() {} });
  const subHeads = created
    .slice(before)
    .filter((n) => n.className === "helper-head" && typeof n.onclick === "function");
  subHeadCount += subHeads.length;
  for (const h of subHeads) h.onclick({ stopPropagation() {} });
}

const decrees = created.filter((n) => String(n.className).startsWith("decree"));
if (!decrees.length) {
  console.error("FAIL: opening a pending card produced no decree — renderPermission did not run");
  process.exit(1);
}

if (subHeadCount !== 2) {
  console.error(`FAIL: expected 2 subagent rows, rendered ${subHeadCount}`);
  process.exit(1);
}
// A subagent's answer must be on screen without clicking anything.
const texts = created.filter((n) => String(n.className).startsWith("helper-text"));
if (!texts.length) {
  console.error("FAIL: no helper-text rendered — a subagent's answer is invisible");
  process.exit(1);
}
if (!texts.some((n) => n.textContent === "Looking…")) {
  console.error("FAIL: helper-text did not carry the subagent's own words");
  process.exit(1);
}
if (!texts.some((n) => String(n.className).includes("open"))) {
  console.error("FAIL: clicking a helper row did not un-clamp its text");
  process.exit(1);
}

// The collapsed card must advertise its helpers, or they're undiscoverable.
const helperBadge = created.find((n) => String(n.className).includes("badge helpers"));
if (!helperBadge) {
  console.error("FAIL: a card with subagents rendered no helper badge on its head");
  process.exit(1);
}
if (!/still out|helper/.test(helperBadge.textContent)) {
  console.error(`FAIL: helper badge text looks wrong: ${helperBadge.textContent}`);
  process.exit(1);
}

console.log(
  `PASS: app.js ran; ${heads.length} cards, decree (${decrees.length} nodes), ` +
  `${subHeadCount} subagent rows expandable, helper badge "${helperBadge.textContent}"`
);
