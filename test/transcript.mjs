// Exercises server/transcript.js against a fixture it builds itself.
//
// The real transcripts live in ~/.claude/projects and are nobody's business but
// their owner's, so nothing here reads them. Shapes below were taken from a
// real file first and then written down.
//
//   npm test
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTranscript, frameToEvents, watchTranscript, readEvents } from "../server/transcript.js";

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (o) => `${JSON.stringify(o)}\n`;

/* ------------------------------------------------------------ frame parsing */

// A typed message is a bare string; the array form happens too.
check("typed user message", frameToEvents({
  type: "user", message: { content: "do the thing" },
})[0]?.text === "do the thing");

check("user message in block form", frameToEvents({
  type: "user", message: { content: [{ type: "text", text: "hello" }] },
})[0]?.text === "hello");

// Every tool call is followed by its result. Rendering those would double the
// log and show Claude being told what it just did.
check("tool_result echo is dropped", frameToEvents({
  type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
}).length === 0);

check("assistant text", frameToEvents({
  type: "assistant", message: { content: [{ type: "text", text: "right then" }] },
})[0]?.text === "right then");

// Owned cards don't show thinking, so a watched card mustn't either.
check("thinking is dropped", frameToEvents({
  type: "assistant", message: { content: [{ type: "thinking", thinking: "hmm" }] },
}).length === 0);

const mixed = frameToEvents({
  type: "assistant",
  message: { content: [
    { type: "thinking", thinking: "hmm" },
    { type: "text", text: "I'll look." },
    { type: "tool_use", id: "t1", name: "Grep", input: { pattern: "x" } },
    { type: "tool_use", id: "t2", name: "Read", input: { file_path: "/a" } },
  ] },
});
check("one frame can carry text and several calls", mixed.length === 3, `got ${mixed.length}`);
check("tool events name the tool", mixed[1]?.name === "Grep" && mixed[2]?.name === "Read");
check("tool events keep the literal input", mixed[1]?.input?.pattern === "x");

check("subagent frames are skipped", frameToEvents({
  type: "assistant", isSidechain: true,
  message: { content: [{ type: "text", text: "from a helper" }] },
}).length === 0);

// Several of these carry no timestamp at all, so nothing may sort on one.
for (const t of ["ai-title", "mode", "permission-mode", "atis-latch", "last-prompt", "attachment"]) {
  check(`metadata frame ${t} is skipped`, frameToEvents({ type: t, sessionId: "s" }).length === 0);
}

check("a malformed frame doesn't throw", frameToEvents({ type: "assistant" }).length === 0);
check("null is survivable", frameToEvents(null).length === 0);

/* ------------------------------------------------------------ path lookup */

const root = await mkdtemp(join(tmpdir(), "wonderland-transcript-"));
try {
  const id = "8fd7a5b1-e57b-4724-93e8-dae7ee891598";
  // The slug is a mangled cwd. Nothing should depend on being able to spell it.
  const dir = join(root, "-Users-someone-code-wonderland");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  await writeFile(file, "");

  check("finds a transcript by session id alone", findTranscript(id, { root }) === file);
  check("unknown session id resolves to null", findTranscript("nope", { root }) === null);
  check("missing root resolves to null", findTranscript(id, { root: join(root, "gone") }) === null);

  /* ---------------------------------------------------------------- tailing */

  // Content written before the watch starts must NOT replay by default: a card
  // opening on a live session wants what happens next, not the whole history.
  await appendFile(file, line({ type: "assistant", message: { content: [{ type: "text", text: "old" }] } }));

  const seen = [];
  const tail = watchTranscript(file, { onEvents: (evs) => seen.push(...evs), pollMs: 20 });

  await appendFile(file, line({ type: "user", message: { content: "new one" } }));
  await sleep(120);
  check("skips what was already there", !seen.some((e) => e.text === "old"));
  check("picks up an append", seen.some((e) => e.text === "new one"), JSON.stringify(seen));

  // A frame is one long line and the writer may be caught mid-way through it.
  const half = line({ type: "assistant", message: { content: [{ type: "text", text: "split across writes" }] } });
  const cut = Math.floor(half.length / 2);
  await appendFile(file, half.slice(0, cut));
  await sleep(80);
  check("a half-written line yields nothing yet",
    !seen.some((e) => e.text === "split across writes"));
  await appendFile(file, half.slice(cut));
  await sleep(120);
  check("the line is delivered once it completes",
    seen.filter((e) => e.text === "split across writes").length === 1,
    JSON.stringify(seen.map((e) => e.text)));

  // A rewritten file is a different file. Reading on from the old offset would
  // start mid-line and drop everything before it.
  await writeFile(file, line({ type: "user", message: { content: "after truncate" } }));
  await sleep(120);
  check("a truncated file is re-read from the top",
    seen.some((e) => e.text === "after truncate"), JSON.stringify(seen.map((e) => e.text)));

  tail.stop();
  const afterStop = seen.length;
  await appendFile(file, line({ type: "user", message: { content: "ignored" } }));
  await sleep(120);
  check("stop() really stops", seen.length === afterStop);

  /* ----------------------------------------------------- reading it all at once */

  const bulk = join(dir, "bulk.jsonl");
  await writeFile(bulk, [
    line({ type: "user", message: { content: "one" } }),
    line({ type: "assistant", message: { content: [{ type: "thinking", thinking: "skipped" }] } }),
    line({ type: "assistant", message: { content: [
      { type: "text", text: "two" },
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a" } },
    ] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
    line({ type: "ai-title", sessionId: "s" }),
    line({ type: "user", message: { content: "three" } }),
  ].join(""));

  const all = readEvents(bulk);
  check("readEvents keeps file order", all.map((e) => e.text ?? e.name).join(",") === "one,two,Read,three",
    JSON.stringify(all.map((e) => e.text ?? e.name)));
  check("readEvents drops thinking, tool_results and metadata", all.length === 4);

  // A card wants the end of a long conversation, not the start of it.
  const tailOnly = readEvents(bulk, { limit: 2 });
  check("limit keeps the newest", tailOnly.map((e) => e.text ?? e.name).join(",") === "Read,three",
    JSON.stringify(tailOnly.map((e) => e.text ?? e.name)));
  check("limit 0 means no limit", readEvents(bulk, { limit: 0 }).length === 4);

  // A session that hasn't written a transcript yet isn't an error.
  check("a missing file reads as empty", readEvents(join(dir, "nope.jsonl")).length === 0);

  /* ------------------------------------------------------------ replay mode */

  const replayed = [];
  const r = watchTranscript(file, { onEvents: (e) => replayed.push(...e), replay: true, pollMs: 20 });
  await sleep(120);
  r.stop();
  check("replay reads from the top", replayed.some((e) => e.text === "after truncate"),
    JSON.stringify(replayed.map((e) => e.text)));
} finally {
  await rm(root, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("PASS: transcript.js — frame parsing, lookup by session id, tailing, partial lines, truncation");
