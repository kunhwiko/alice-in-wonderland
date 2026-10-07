// Read a session's conversation without attaching to it.
//
// Claude Code appends every session to ~/.claude/projects/<slug>/<id>.jsonl as
// it goes. Reading that file is the only way to follow a session Wonderland
// doesn't own: there's no IPC into a terminal tab, and putting a second process
// on the transcript would interleave the two (see terminal.js).
//
// Nothing in here writes. A watcher is a reader, and can never disturb the
// session it's watching — which is the whole reason this approach beats the
// fork.
import {
  watch, statSync, existsSync, createReadStream, readdirSync, readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECTS = join(homedir(), ".claude", "projects");

/**
 * Find a session's transcript.
 *
 * The directory is named for the cwd with `/` and `.` beaten into `-`, but
 * deriving that means trusting an undocumented rule *and* knowing the directory
 * the session started in — and a resume from somewhere else breaks the second
 * one. The file itself is named by session id, so look for that and let the
 * directory be whatever it turns out to be.
 */
export function findTranscript(sessionId, { root = PROJECTS } = {}) {
  if (!sessionId || !existsSync(root)) return null;
  const leaf = `${sessionId}.jsonl`;
  for (const dir of readdirSync(root)) {
    const p = join(root, dir, leaf);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Frame types that are session bookkeeping rather than conversation. Several
 * carry no `timestamp` at all, so nothing downstream may assume one.
 */
const META = new Set([
  "ai-title", "mode", "permission-mode", "atis-latch", "last-prompt",
  "file-history-snapshot", "file-history-delta", "attachment", "system",
]);

/**
 * One transcript line becomes the events Wonderland already broadcasts for its
 * own sessions — deliberately the same two shapes as sessions.js `drive()`, so
 * a card renders identically whoever is driving it.
 *
 * Returns [] for anything that isn't conversation: metadata, thinking blocks,
 * and the tool_result echoes that follow every call.
 */
export function frameToEvents(frame) {
  if (!frame || META.has(frame.type)) return [];

  // Subagent frames. The owned path renders these as the helper tree, keyed by
  // the tool call that spawned them; a transcript threads them by parentUuid
  // instead, which is a different reconstruction and not this change. Dropped
  // deliberately rather than rendered as though they were the main thread.
  if (frame.isSidechain) return [];

  const content = frame.message?.content;
  if (content == null) return [];

  const role = frame.type === "user" ? "user" : "assistant";
  if (frame.type !== "user" && frame.type !== "assistant") return [];

  // A typed message arrives as a bare string; everything else is blocks.
  if (typeof content === "string") {
    return content.trim() ? [{ kind: "message", role, text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const out = [];
  const text = content
    .filter((b) => b?.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (text.trim()) out.push({ kind: "message", role, text });
  for (const b of content) {
    if (b?.type === "tool_use") out.push({ kind: "tool", name: b.name, input: b.input });
  }
  return out;
}

/**
 * Read a whole transcript at once, keeping the newest `limit` events.
 *
 * The page holds its log in memory only, so a reload empties it. For a
 * handed-over card there's nothing to re-stream either — those frames arrived
 * while the browser wasn't being told about them. This is where both get their
 * conversation back.
 */
export function readEvents(path, { limit = 200 } = {}) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return []; }

  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let frame;
    try { frame = JSON.parse(line); } catch { continue; }
    events.push(...frameToEvents(frame));
  }
  return limit > 0 && events.length > limit ? events.slice(-limit) : events;
}

/**
 * Follow a transcript, handing `onEvents` each batch in file order.
 *
 * fs.watch is the fast path. FSEvents coalesces, and can drop a notification
 * outright under load, so a slow stat poll backs it up — measured wake-up is
 * 110-310ms after a frame lands, which reads as live.
 *
 * `replay: true` starts from the top of the file instead of from the end, for
 * a card that's being opened on a conversation already in progress.
 */
export function watchTranscript(path, { onEvents, replay = false, pollMs = 250 } = {}) {
  let offset = replay ? 0 : statSync(path).size;
  let partial = "";
  let reading = false;
  let again = false;
  let stopped = false;

  function drain() {
    if (stopped) return;
    // Reads are async, so a second wake-up mid-read would double-read the same
    // bytes. Coalesce instead, and repeat once if anything arrived meanwhile.
    if (reading) { again = true; return; }

    let size;
    try { size = statSync(path).size; } catch { return; }
    // Shorter than last time means the file was replaced, not appended to.
    if (size < offset) { offset = 0; partial = ""; }
    if (size === offset) return;

    reading = true;
    const start = offset;
    offset = size;

    const stream = createReadStream(path, { start, end: size - 1, encoding: "utf8" });
    let buf = "";
    stream.on("data", (d) => { buf += d; });
    stream.on("error", () => { reading = false; });
    stream.on("end", () => {
      const lines = (partial + buf).split("\n");
      // The final line is very often half-written. Hold it for the next drain.
      partial = lines.pop() ?? "";

      const events = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        events.push(...frameToEvents(frame));
      }

      reading = false;
      if (events.length) onEvents(events);
      if (again) { again = false; drain(); }
    });
  }

  const watcher = watch(path, drain);
  const timer = setInterval(drain, pollMs);
  timer.unref?.();
  if (replay) drain();

  return {
    path,
    stop() {
      stopped = true;
      watcher.close();
      clearInterval(timer);
    },
  };
}
