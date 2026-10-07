// Alice's briefings, without a model.
//
// The part worth testing is the bookkeeping, not the prose: a briefing must
// land on the moment it was written about, and one that arrives after the
// session has moved on must be dropped rather than shown on the next request.
//
//   npm test
import { createBriefer, buildPrompt, briefingKey, BRIEF_SYSTEM } from "../server/briefing.js";

let failures = 0;
function check(label, ok) {
  if (!ok) { console.error(`FAIL: ${label}`); failures++; }
}

/** In memory, so the test never writes data/todos.json. */
function memoryStore(todos) {
  const byId = new Map(todos.map((t) => [t.id, { ...t }]));
  return {
    get: (id) => byId.get(id) ?? null,
    update(id, patch) {
      const t = byId.get(id);
      if (!t) return null;
      Object.assign(t, patch);
      return t;
    },
    remove: (id) => byId.delete(id),
  };
}

/** A model you can answer by hand, in whatever order the test likes. */
function manualModel() {
  const calls = [];
  const run = ({ system, prompt }) =>
    new Promise((resolve, reject) => calls.push({ system, prompt, resolve, reject }));
  return { run, calls };
}

const pending = (id, extra = {}) => ({
  kind: "pending",
  pending: { id, kind: "permission", toolName: "Bash", input: { command: "npm test" }, ...extra },
});

// --- the prompt -----------------------------------------------------------

{
  const todo = { title: "fix the flaky retry test", cwd: "/repo" };
  const events = [
    { kind: "message", role: "user", text: "fix the flaky retry test" },
    { kind: "tool", name: "Read", input: { file_path: "/repo/retry.test.js" } },
    { kind: "message", role: "assistant", text: "The timeout is too tight." },
  ];

  const p = buildPrompt({ todo, events, trigger: pending("r1") });
  check("prompt carries the task", p.includes("fix the flaky retry test"));
  check("prompt carries the literal request", p.includes('"command": "npm test"'));
  check("prompt carries the recent log", p.includes("[tool Read]") && p.includes("[claude] The timeout"));
  check("session material is fenced off as data", p.indexOf("<session>") < p.indexOf("npm test") && p.includes("</session>"));
  check("permission prompt asks about permission", /waiting for permission/.test(p));

  const t = buildPrompt({ todo, events, trigger: { kind: "turn", turn: "u1", finalText: "I recommend raising it to 5s." } });
  check("turn prompt carries the final message", t.includes("I recommend raising it to 5s."));
  check("turn prompt asks about the finished turn", /finished its turn/.test(t));

  const huge = Array.from({ length: 400 }, (_, i) => ({ kind: "message", role: "assistant", text: `line ${i} `.repeat(50) }));
  const h = buildPrompt({ todo, events: huge, trigger: pending("r1") });
  check("a long log is trimmed, keeping the newest", h.length < 30_000 && h.includes("line 399"));

  check("the system prompt forbids vouching", /Never say a request is safe/.test(BRIEF_SYSTEM));
  check("the system prompt treats session text as data", /never instructions to you/.test(BRIEF_SYSTEM));
}

// --- keys ------------------------------------------------------------------

check("a pending briefing is keyed by the request", briefingKey(pending("r9")) === "r9");
check("a turn briefing is keyed by the turn", briefingKey({ kind: "turn", turn: "u3" }) === "turn:u3");

// --- the bookkeeping --------------------------------------------------------

{
  const todos = memoryStore([{ id: "a", title: "task" }]);
  const sent = [];
  const model = manualModel();
  const b = createBriefer({ broadcast: (e) => sent.push(e), todos, run: model.run, read: () => [], enabled: true });

  const first = b.brief("a", pending("r1"));
  check("asking marks the card as reading", todos.get("a").briefing?.status === "reading");
  check("asking tells the browser", sent.at(-1)?.todo?.briefing?.key === "r1");

  // Answer it. It's still the latest, so it lands.
  model.calls[0].resolve("It wants to run the tests.");
  await first.done;
  check("a current briefing lands", todos.get("a").briefing?.status === "ready");
  check("with its text", todos.get("a").briefing?.text === "It wants to run the tests.");
  check("against its own key", todos.get("a").briefing?.key === "r1");

  // Two in flight; the older one answers last.
  const older = b.brief("a", pending("r2"));
  const newer = b.brief("a", pending("r3"));
  model.calls[2].resolve("About r3.");
  await newer.done;
  model.calls[1].resolve("About r2 — stale by now.");
  const lateResult = await older.done;
  check("a late briefing is dropped", lateResult === null);
  check("the newer one stays put", todos.get("a").briefing?.text === "About r3.");
  check("still keyed to the newer request", todos.get("a").briefing?.key === "r3");

  // A model failure is reported, not swallowed into silence.
  const failing = b.brief("a", pending("r4"));
  model.calls[3].reject(new Error("rate limited"));
  await failing.done;
  check("a failure is shown as failed", todos.get("a").briefing?.status === "failed");
  check("with the reason kept for the tooltip", todos.get("a").briefing?.text === "rate limited");

  // The card is deleted while she reads.
  const orphan = b.brief("a", pending("r5"));
  todos.remove("a");
  model.calls[4].resolve("Nobody is listening.");
  check("a deleted card is left alone", (await orphan.done) === null);

  check("no card, no briefing", b.brief("missing", pending("r6")) === null);
}

{
  const todos = memoryStore([{ id: "a", title: "task" }]);
  const b = createBriefer({ broadcast: () => {}, todos, run: () => { throw new Error("should not run"); }, enabled: false });
  check("switched off, nothing is asked", b.brief("a", pending("r1")) === null && !todos.get("a").briefing);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("PASS: briefing — lands on its own moment, drops late ones, and fences session text off as data");
