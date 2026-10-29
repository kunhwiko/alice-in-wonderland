// Executes public/app.js — and the Court and Tea Party panels it pulls in —
// against a minimal DOM stub.
//
// `node --check` only parses — it won't catch a temporal-dead-zone reference,
// a missing element id, or anything else that throws at module load. Those
// break the entire page silently, so run this after editing the client:
//
//   npm test
//
// world.js is swapped for a stand-in that records what it's told: there's no
// WebGL here, and what matters is that app.js sends Alice on the right errands.
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
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
    addEventListener() {}, removeEventListener() {}, setAttribute() {},
    showModal() {}, close() {}, reset() {}, querySelector: () => mk(),
    cwd: { value: "" }, prompt: { value: "" }, sessionName: { value: "" }, sessionModel: { value: "" },
  };
  created.push(node);
  return node;
};

const ids = [
  "tagline", "new-btn", "new-go", "new-where-label", "new-what-label",
  "footer", "desk", "queue", "archive", "archive-summary", "new-dialog", "new-form",
  "new-dismiss", "favicon", "new-name-label", "new-model-label", "new-model", "title",
  "world", "overlay", "no-world", "go-tea", "go-court", "panel", "panel-title", "panel-hint",
  "panel-close", "tea", "court", "tea-status", "tea-list", "panel-expand", "panel-grip",
  "go-hall", "hall", "hall-status", "hall-doors", "hall-bottles",
  "terminal-dialog", "terminal-title", "terminal-why", "terminal-choices",
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
  documentElement: { style: { setProperty() {} } },
  title: "",
};
// The panel sizes itself to the window.
globalThis.innerWidth = 1440;
globalThis.addEventListener = () => {};
// Kept, so the test can play events into the page as the server would.
let sse = null;
globalThis.EventSource = class { set onmessage(f) { sse = f; } };
const send = (ev) => sse({ data: JSON.stringify(ev) });

// One todo per status, so every branch of renderCard runs: each pip, each
// group, the archive row, and the buttons attached to all of them.
const base = { kind: "owned", cwd: "/tmp/x", name: "x", title: "t", lastText: null,
               pending: null, closedAt: null, sessionId: "s1", live: true };
const todos = [
  { ...base, id: "a", status: "needs-you", pending: {
      id: "r1", kind: "permission", toolName: "Bash",
      input: { command: "rm -rf ./cache", description: "Remove the cache" }, suggestions: [] },
    briefing: { key: "r1", status: "ready", text: "BRIEF-PENDING" } },
  { ...base, id: "b", status: "working", subagents: {
      t1: { id: "t1", type: "Explore", description: "survey the CRD tree",
            status: "running", tools: { Grep: 12, Read: 3 }, lastText: "Looking…" },
      t2: { id: "t2", type: "Plan", description: "design the migration",
            status: "done", tools: { Read: 4 }, lastText: null } } },
  { ...base, id: "c", status: "idle", lastText: "I recommend raising the timeout.",
    lastTurn: { id: "u1", at: Date.now() - 120_000 },
    briefing: { key: "turn:u1", status: "ready", text: "BRIEF-TURN" } },
  // A finished turn you've already marked "Noted": off the desk.
  { ...base, id: "m", status: "idle", lastTurn: { id: "u2", at: Date.now() }, ackedTurn: "u2",
    briefing: { key: "turn:u2", status: "ready", text: "BRIEF-NOTED" } },
  // Nothing running on these, as the server would say.
  { ...base, id: "d", status: "interrupted", live: false },
  // Briefings about moments that have passed: neither may be shown.
  { ...base, id: "e", status: "failed", live: false,
    briefing: { key: "turn:u0", status: "ready", text: "BRIEF-STALE-TURN" } },
  { ...base, id: "f", status: "stopped", live: false,
    briefing: { key: "r0", status: "ready", text: "BRIEF-STALE-PENDING" } },
  { ...base, id: "g", status: "gone", kind: "external", live: false },
  { ...base, id: "h", status: "idle", closedAt: Date.now() },
  { ...base, id: "i", status: "needs-you", kind: "external", pending: null },
  // Handed over: external, but tailed, so it shows the conversation rather
  // than a resume command.
  { ...base, id: "k", status: "idle", kind: "external", watching: true },
  { ...base, id: "j", status: "needs-you", pending: {
      id: "r2", kind: "question", toolName: "AskUserQuestion",
      input: { questions: [{ question: "Which?", header: "H", multiSelect: false,
        options: [{ label: "One", description: "d" }, { label: "Two", description: "d" }] }] },
      suggestions: [] } },
];
// Slack: one conversation wanting a review, one that's only a thank-you.
// One timestamp for all: the same letter twice must be the same news.
const NOW_TS = String(Math.floor(Date.now() / 1000));
const slackItem = (id, needsYou, extra = {}) => ({
  id, key: `dm:D1:${id}`, kind: "dm", channelId: "D1", channelName: null, threadTs: null,
  people: ["Nishant"], from: "Nishant", messages: [{ from: "Nishant", text: `TEXT-${id}`, ts: "1" }],
  latestTs: NOW_TS, permalink: "https://slack.example/x",
  summary: `SUMMARY-${id}`, needsYou, triaged: true, ...extra,
});
const slack = {
  enabled: true, checking: false, checkedAt: Date.now(), error: null,
  items: [slackItem("aaa", true), slackItem("bbb", false)],
};
// The page draws from the event stream alone; fetch is only for actions.
// Recorded, to tell which action a click took.
const posts = [];
globalThis.fetch = async (url, opts = {}) => {
  posts.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
  return { ok: true, json: async () => ({}) };
};
globalThis.queueMicrotask = (f) => f();
// The desk ticks its "waiting 4m" labels on an interval, which would keep
// this process alive forever after the checks finish.
globalThis.setInterval = () => 0;
// Node 22 defines a getter-only `navigator`, so assignment throws.
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true,
});

// The stand-in world: records errands and updates, draws nothing.
const world = { errands: [], updates: [], focused: [] };
globalThis.__world = world;
const STUB_WORLD = `export function createWorld() {
  const w = globalThis.__world;
  return {
    update: (s) => w.updates.push(s),
    errand: (district, text) => w.errands.push({ district, text }),
    focus: (k) => w.focused.push(k),
  };
}`;

// The modules import each other by absolute URL ("/alice.js"), which only the
// browser resolves. Stage them side by side and make those relative.
const dir = await mkdtemp(join(tmpdir(), "wonderland-smoke-"));
try {
  for (const f of (await readdir(PUBLIC)).filter((f) => f.endsWith(".js"))) {
    if (f === "world.js" || f === "alice-figure.js") continue;
    const src = await readFile(join(PUBLIC, f), "utf8");
    await writeFile(join(dir, f), src.replace(/(from |import\()"\/([\w-]+\.js)"/g, '$1"./$2"'));
  }
  await writeFile(join(dir, "world.js"), STUB_WORLD);
  await import(join(dir, "app.js"));
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (missing.size) {
  console.error(`FAIL: app.js asked for element ids absent from index.html: ${[...missing].join(", ")}`);
  process.exit(1);
}

const { alice } = await import(join(PUBLIC, "alice.js"));

// Before the hello the page knows of nothing, so it mustn't take its
// baseline yet: if it did, everything already waiting would arrive as news.
if (world.errands.length) {
  console.error(`FAIL: Alice set off before the server said hello: ${JSON.stringify(world.errands)}`);
  process.exit(1);
}

// The hello is everything the page has to draw from. It's the baseline:
// nothing in it is news, but Alice starts the day at the oldest thing waiting.
send({ type: "hello", todos, slack });
if (world.errands.length !== 1 || world.errands[0].text !== alice.errandStart) {
  console.error(`FAIL: the hello should send Alice to the oldest thing waiting, once; got ${JSON.stringify(world.errands)}`);
  process.exit(1);
}

// A briefing shows once: on the desk while the card is there, on the card
// once it's left (here, a turn marked Noted).
for (const text of ["BRIEF-PENDING", "BRIEF-TURN", "BRIEF-NOTED"]) {
  const n = created.filter((x) => x.textContent === text).length;
  if (n !== 1) {
    console.error(`FAIL: briefing ${text} rendered ${n} times on first paint, expected exactly once`);
    process.exit(1);
  }
}
for (const text of ["BRIEF-STALE-TURN", "BRIEF-STALE-PENDING"]) {
  if (created.some((n) => n.textContent === text)) {
    console.error(`FAIL: stale briefing ${text} was shown`);
    process.exit(1);
  }
}

// Alice's desk: the permission (a), the question (j) and the finished turn (c)
// — owned sessions waiting on you. Not the external one (i), and not the turn
// already marked Noted (m).
const deskItems = created.filter((n) => String(n.className).startsWith("desk-item"));
const kinds = deskItems.map((n) => n.className.replace("desk-item desk-", "")).sort();
if (JSON.stringify(kinds) !== JSON.stringify(["permission", "question", "turn"])) {
  console.error(`FAIL: desk should hold one permission, one question and one turn; got ${JSON.stringify(kinds)}`);
  process.exit(1);
}
// A finished turn keeps the desk short — its words are on the card, not
// repeated here — and has a way to dismiss it.
if (created.some((n) => n.className === "desk-words")) {
  console.error("FAIL: the desk repeated a finished turn's last words; they belong on the card");
  process.exit(1);
}
if (!created.some((n) => n.textContent === alice.noted)) {
  console.error("FAIL: a finished turn on the desk has no Noted button");
  process.exit(1);
}
// The desk and the open card each draw the question; sharing radio names
// would let one steal the other's selection.
const radioNames = new Set(created.filter((n) => n.type === "radio").map((n) => n.name));
if (![...radioNames].some((n) => n.startsWith("desk-"))) {
  console.error("FAIL: desk radios aren't namespaced away from the card's");
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
// Open in a terminal asks before a fork, so each click either fills the
// dialog's choices or posts straight away. Both are recorded.
const asked = [];
nodes["terminal-choices"].replaceChildren = (...kids) =>
  asked.push(kids.filter(Boolean));
let subHeadCount = 0;
let terminalClicks = 0;
for (const head of heads) {
  const before = created.length;
  head.onclick({ stopPropagation() {} });
  const mine = created.slice(before);
  const subHeads = mine.filter((n) => n.className === "helper-head" && typeof n.onclick === "function");
  subHeadCount += subHeads.length;
  for (const h of subHeads) h.onclick({ stopPropagation() {} });
  for (const b of mine.filter((n) => n.textContent === alice.openTerminal)) {
    b.onclick({ stopPropagation() {} });
    terminalClicks++;
  }
}

const decrees = created.filter((n) => String(n.className).startsWith("decree"));
if (!decrees.length) {
  console.error("FAIL: opening a pending card produced no decree — renderPermission did not run");
  process.exit(1);
}

// A blocked card must offer a way out that isn't answering it. Both kinds
// that block a turn — the permission decree and the question form — get one.
const escapes = created.filter((n) => n.className === "row escape");
if (escapes.length < 2) {
  console.error(
    `FAIL: expected an escape row on both the decree and the question card, got ${escapes.length}`
  );
  process.exit(1);
}
if (!created.some((n) => n.textContent === alice.interrupt)) {
  console.error("FAIL: no interrupt button rendered — nothing short of a kill can end a turn");
  process.exit(1);
}

// A card whose session has ended is put away in one click; one still running
// is put away only by taking its head, so nothing hidden is left running.
if (!created.some((n) => n.textContent === alice.putAway)) {
  console.error("FAIL: a dead card has no way down the rabbit-hole");
  process.exit(1);
}
if (!created.some((n) => n.textContent === alice.stop)) {
  console.error("FAIL: a live card has no Off with its head");
  process.exit(1);
}

// A running session can't be opened in a terminal without forking it, so the
// page asks: an owned one can move or fork, a terminal one can only fork.
// One with nothing running just goes, and an owned one goes by handover.
if (!terminalClicks) fail("no Open in a terminal button on any card");
const labels = (kids) => kids.map((k) => k.textContent).join("|");
const both = [alice.neverMind, alice.forkIt, alice.moveIt].join("|");
const forkOnly = [alice.neverMind, alice.forkIt].join("|");
if (!asked.some((k) => labels(k) === both)) fail("a running owned session wasn't offered both move and fork");
if (!asked.some((k) => labels(k) === forkOnly)) fail("a running terminal session wasn't offered just a fork");
const unasked = posts.filter((p) => /\/(terminal|handover)$/.test(p.url));
if (unasked.some((p) => p.body?.fork)) fail("a fork was made without asking");
if (!unasked.some((p) => p.url.endsWith("/handover"))) fail("an owned session with nothing running wasn't handed over");
if (!unasked.some((p) => p.url.endsWith("/terminal"))) fail("a dead terminal session wasn't simply opened");
// Picking Fork it is what asks the server for one.
asked.find((k) => labels(k) === both).find((k) => k.textContent === alice.forkIt).onclick();
if (!posts.at(-1).url.endsWith("/terminal") || posts.at(-1).body.fork !== true) {
  fail("choosing Fork it didn't ask the server for a fork");
}
// A watched card must say it's being read, and must NOT offer the resume
// command: following that would fork the session it's already following.
if (!created.some((n) => n.textContent === alice.watched)) {
  console.error("FAIL: a watching external card didn't render the watched branch");
  process.exit(1);
}
if (created.some((n) => n.textContent === alice.externalHow) &&
    !created.some((n) => n.textContent === alice.external)) {
  console.error("FAIL: watched card fell through to the blind-external branch");
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

// Typing must survive a re-render: other sessions redraw the page all the time.
// Last, because the redraw creates fresh card heads the checks above count.
const reasonKey = "desk:r1:reason";
const reason = created.filter((n) => n.dataset?.draft === reasonKey).at(-1);
if (!reason) {
  console.error("FAIL: the desk's deny-reason box isn't a draft box");
  process.exit(1);
}
reason.value = "use the retry helper instead";
reason.oninput();
created.find((n) => n.className === "card-head" && typeof n.onclick === "function").onclick({});
const redrawn = created.filter((n) => n.dataset?.draft === reasonKey).at(-1);
if (redrawn === reason || redrawn.value !== "use the retry helper instead") {
  console.error("FAIL: a re-render wiped what was typed into the deny reason");
  process.exit(1);
}

/* ------------------------------------------------------------ tea party */

// A declaration, so the checks above it can use it too.
function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }
const shown = (text) => created.some((n) => n.textContent === text);

// A conversation that wants you shows Alice's reading and what was said; one
// she set aside is listed under the chatter, without its messages.
if (!shown("SUMMARY-aaa") || !shown("TEXT-aaa")) fail("the Tea Party didn't render a conversation waiting on you");
if (!shown("SUMMARY-bbb")) fail("the chatter section didn't list the conversation Alice set aside");
if (shown("TEXT-bbb")) fail("a set-aside conversation rendered its messages — it should be one quiet line");
if (!created.some((n) => n.href === "https://slack.example/x")) fail("no Open in Slack link");

/* ---------------------------------------------------------------- world */

const lastUpdate = world.updates.at(-1);
if (!lastUpdate) fail("app.js never told the world what's in it");
if (lastUpdate.tea.items.length !== 1) {
  fail(`the Tea Party should hold one letter (chatter excluded), got ${lastUpdate.tea.items.length}`);
}
// Before the throne: the permission (a), the question (j), the finished turn
// (c) — the desk — and the terminal session asking (i).
const before = lastUpdate.court.waiting.map((t) => t.id).sort().join(",");
if (before !== "a,c,i,j") fail(`soldiers before the throne should be a,c,i,j; got ${before}`);
if (lastUpdate.court.others.some((t) => t.closedAt)) fail("an archived session is standing about the court");

// A reconnect's hello is old news too.
send({ type: "hello", todos, slack });
if (world.errands.length !== 1) fail(`a second hello sent Alice walking: ${JSON.stringify(world.errands)}`);

// A session asking for something new is a walk to Court.
send({ type: "todo", todo: { ...base, id: "n", name: "fresh-one", status: "needs-you",
  pending: { id: "r9", kind: "permission", toolName: "Bash", input: { command: "ls" }, askedAt: Date.now() } } });
const toCourt = world.errands.at(-1);
if (toCourt?.district !== "court" || !toCourt.text.includes("fresh-one")) {
  fail(`a new permission didn't send Alice to Court by name; got ${JSON.stringify(toCourt)}`);
}

// Slack: a new conversation that wants you is a walk to the Tea Party. One
// she hasn't read yet, or has read and set aside, isn't.
let n = world.errands.length;
send({ type: "slack", slack: { ...slack, items: [...slack.items,
  slackItem("ddd", false), slackItem("eee", null, { triaged: false, summary: null })] } });
if (world.errands.length !== n) fail(`chatter or an unread letter sent Alice walking: ${JSON.stringify(world.errands.at(-1))}`);
send({ type: "slack", slack: { ...slack, items: [...slack.items, slackItem("ccc", true, { from: "Ajay" })] } });
const toTea = world.errands.at(-1);
if (world.errands.length !== n + 1 || toTea.district !== "tea" || !toTea.text.includes("Ajay")) {
  fail(`a new letter didn't send Alice to the Tea Party; got ${JSON.stringify(toTea)}`);
}
// The same letter again is old news.
n = world.errands.length;
send({ type: "slack", slack: { ...slack, items: [...slack.items, slackItem("ccc", true, { from: "Ajay" })] } });
if (world.errands.length !== n) fail("the same letter sent Alice walking twice");

// The Hall: a door that shuts is a walk there; one you're signing into isn't,
// and one that stays shut isn't news twice.
const door = (name, status, extra = {}) => ({ name, status, source: "user", transport: "http", host: null, tools: 0, busy: null, signIn: null, error: null, ...extra });
const skills = [{ id: "aaaaaaaaaaaa", name: "mine", description: "d", scope: "user", where: null, editable: true, path: "/x/SKILL.md", dir: "/x", files: [], modifiedAt: 1 }];
n = world.errands.length;
send({ type: "hall", hall: { enabled: true, checkedAt: Date.now(), error: null, skills, servers: [door("wiki", "connected"), door("jira", "needs-auth", { busy: "signing-in" })] } });
if (world.errands.length !== n) fail(`a door being signed into sent Alice walking: ${JSON.stringify(world.errands.at(-1))}`);
send({ type: "hall", hall: { enabled: true, checkedAt: Date.now(), error: null, skills, servers: [door("wiki", "connected"), door("jira", "needs-auth")] } });
const toHall = world.errands.at(-1);
if (world.errands.length !== n + 1 || toHall.district !== "hall" || !toHall.text.includes("jira")) {
  fail(`a locked door didn't send Alice to the Hall; got ${JSON.stringify(toHall)}`);
}
send({ type: "hall", hall: { enabled: true, checkedAt: Date.now(), error: null, skills, servers: [door("wiki", "connected"), door("jira", "needs-auth")] } });
if (world.errands.length !== n + 1) fail("a door still locked sent Alice walking again");
const hallUpdate = world.updates.at(-1)?.hall;
if (hallUpdate?.servers?.length !== 2 || hallUpdate?.skills?.length !== 1) fail(`the world wasn't told about the Hall: ${JSON.stringify(hallUpdate)}`);
if (!created.some((n) => n.textContent === alice.authenticate)) fail("a locked door has no Sign in button");

console.log(
  `PASS: app.js ran; ${heads.length} cards, decree (${decrees.length} nodes), ` +
  `${escapes.length} escape rows, ` +
  `${subHeadCount} subagent rows expandable, helper badge "${helperBadge.textContent}"`
);
