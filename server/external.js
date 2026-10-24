// Sessions you started in a terminal tab. Wonderland can see them but can't
// talk to them: there is no IPC into a live interactive process, and Remote
// Control (the one mechanism that could) is disabled by org policy.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { store } from "./store.js";
import { findTranscript, watchTranscript } from "./transcript.js";

const run = promisify(execFile);

/** todo id -> transcript watcher. See transcript.js: these only ever read. */
const watchers = new Map();

/** How long a handover gets to show up in the agent list before we give up. */
export const HANDOVER_GRACE_MS = 60_000;

/**
 * A watched card's session is absent from the agent list. Is that because the
 * terminal closed, or because it hasn't opened yet?
 *
 * The handover turns the card external the moment the AppleScript returns, but
 * `claude` takes a moment to appear in `claude agents --json`. Reclaiming in
 * that window would undo the handover while the tab was still starting, so we
 * wait until it's actually been seen there — or until it plainly never showed.
 *
 * Exported for the tests, which shouldn't have to run `claude agents --json`.
 */
export function shouldReclaim(todo, now = Date.now()) {
  if (!todo?.watching) return false;
  if (todo.seenInTerminal) return true;
  return now - (todo.handedOverAt ?? 0) > HANDOVER_GRACE_MS;
}

/**
 * Follow a session's conversation by tailing its transcript.
 *
 * This is how a card keeps showing what's happening after Wonderland has let
 * go of the session. The events are the same two shapes sessions.js broadcasts
 * for owned cards, so the client needs no new cases.
 */
export function startWatching(todo, broadcast) {
  stopWatching(todo.id);
  const path = findTranscript(todo.sessionId);
  // Degrade to what an ordinary external card shows rather than leaving a
  // stale conversation on screen looking current.
  if (!path) return { ok: false, reason: "no transcript on disk for that session id" };

  const handle = watchTranscript(path, {
    onEvents: (events) => {
      for (const e of events) {
        if (e.kind === "message") broadcast({ type: "message", todoId: todo.id, role: e.role, text: e.text });
        else if (e.kind === "tool") broadcast({ type: "tool", todoId: todo.id, name: e.name, input: e.input });
      }
    },
  });
  watchers.set(todo.id, handle);
  return { ok: true, path };
}

export function stopWatching(todoId) {
  watchers.get(todoId)?.stop();
  watchers.delete(todoId);
}

export function stopAllWatching() {
  for (const [, h] of watchers) h.stop();
  watchers.clear();
}

/** Re-establish watchers after a restart, for cards that were handed over. */
export function resumeWatching(broadcast) {
  for (const todo of store.all()) {
    if (todo.closedAt || !todo.watching) continue;
    const { ok } = startWatching(todo, broadcast);
    // The flag is the card's promise that it's being followed. If the file has
    // gone, clear it rather than let the card claim a liveness it hasn't got.
    if (!ok) store.update(todo.id, { watching: false });
  }
}

/** Ingest a Notification hook payload from any session on this machine. */
export function ingestHook(payload, broadcast) {
  const sessionId = payload.session_id;
  if (!sessionId) return null;

  const message = payload.message || "needs your input";
  const existing = store.bySessionId(sessionId);

  // A hook from a session Wonderland already drives is redundant — the
  // canUseTool bridge is authoritative for those.
  if (existing?.kind === "owned") return existing;

  // `askedAt` marks this notification, so the page can tell a new one from
  // any other change to the card (a rename by the poller, say).
  const askedAt = Date.now();
  if (existing) {
    const todo = store.update(existing.id, { status: "needs-you", lastText: message, askedAt });
    broadcast({ type: "todo", todo });
    return todo;
  }

  const todo = store.create({
    kind: "external",
    sessionId,
    cwd: payload.cwd || null,
    name: (payload.cwd || "").split("/").filter(Boolean).pop() || "session",
    title: message,
    lastText: message,
    status: "needs-you",
    askedAt,
  });
  broadcast({ type: "todo", todo });
  return todo;
}

/**
 * Stop a session Wonderland doesn't own.
 *
 * `claude stop` only handles background sessions — it keeps the conversation
 * and is the clean path. An interactive terminal tab has no such mechanism, so
 * the only lever left is a signal to the process, which yanks Claude out from
 * under whoever is sitting in that tab. The caller must have confirmed first.
 */
export async function stopExternal(todo) {
  if (todo.sessionId) {
    try {
      await run("claude", ["stop", todo.sessionId], { timeout: 15_000 });
      return { ok: true, how: "claude stop", destructive: false };
    } catch {
      // Not a background session; fall through to the signal.
    }
  }

  if (todo.pid) {
    try {
      process.kill(todo.pid, "SIGTERM");
      return { ok: true, how: "SIGTERM", destructive: true };
    } catch (err) {
      if (err.code === "ESRCH") return { ok: true, how: "already gone", destructive: false };
      return { ok: false, reason: String(err.message ?? err) };
    }
  }

  return { ok: false, reason: "nothing left to stop" };
}

/**
 * `claude agents --json` reports interactive tabs as well as background
 * sessions (the TUI shows only the latter). Use it to keep names fresh and
 * retire sessions whose process has gone.
 */
export async function pollAgents(broadcast) {
  let agents = [];
  try {
    const { stdout } = await run("claude", ["agents", "--json"], { timeout: 10_000 });
    agents = JSON.parse(stdout);
  } catch {
    return; // claude not on PATH, or no sessions — neither is an error here
  }

  const byId = new Map(agents.map((a) => [a.sessionId, a]));

  for (const todo of store.all()) {
    if (todo.kind !== "external" || todo.closedAt) continue;
    const agent = byId.get(todo.sessionId);

    if (!agent) {
      // A watched card is a session Wonderland handed over. The tab closing
      // means nothing holds the transcript any more — the one condition under
      // which resuming it here is safe again. So take it back, rather than
      // leaving a dead end that can only be reopened in another terminal.
      if (todo.watching) {
        if (!shouldReclaim(todo)) continue;

        stopWatching(todo.id);
        const t = store.update(todo.id, {
          kind: "owned", status: "interrupted", watching: false,
          seenInTerminal: false, pending: null,
        });
        broadcast({ type: "todo", todo: t });
        continue;
      }

      if (todo.status !== "gone") {
        const t = store.update(todo.id, { status: "gone" });
        broadcast({ type: "todo", todo: t });
      }
      continue;
    }

    // Don't overwrite needs-you: the hook knows it's blocked, the poller doesn't.
    // pid is kept because stopExternal falls back to signalling it.
    const patch = { cwd: agent.cwd, pid: agent.pid };
    // A handed-over card was named here, by the person who started it. Taking
    // the agent's own name would rename `fix-yourself` to `wonderland-49`
    // mid-session, which is half of what made the fork so disorienting.
    if (!todo.watching) patch.name = agent.name;
    // Seeing it here once is what licenses the reclaim above.
    if (todo.watching && !todo.seenInTerminal) patch.seenInTerminal = true;
    if (todo.status !== "needs-you") {
      patch.status = agent.status === "busy" ? "working" : "idle";
    }
    if (Object.entries(patch).some(([k, v]) => todo[k] !== v)) {
      const t = store.update(todo.id, patch);
      broadcast({ type: "todo", todo: t });
    }
  }
}
