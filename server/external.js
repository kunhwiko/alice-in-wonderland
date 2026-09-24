// Sessions you started in a terminal tab. Wonderland can see them but can't
// talk to them: there is no IPC into a live interactive process, and Remote
// Control (the one mechanism that could) is disabled by org policy.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { store } from "./store.js";

const run = promisify(execFile);

/** Ingest a Notification hook payload from any session on this machine. */
export function ingestHook(payload, broadcast) {
  const sessionId = payload.session_id;
  if (!sessionId) return null;

  const message = payload.message || "needs your input";
  const existing = store.bySessionId(sessionId);

  // A hook from a session Wonderland already drives is redundant — the
  // canUseTool bridge is authoritative for those.
  if (existing?.kind === "owned") return existing;

  if (existing) {
    const todo = store.update(existing.id, { status: "needs-you", lastText: message });
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
      if (todo.status !== "gone") {
        const t = store.update(todo.id, { status: "gone" });
        broadcast({ type: "todo", todo: t });
      }
      continue;
    }

    // Don't overwrite needs-you: the hook knows it's blocked, the poller doesn't.
    // pid is kept because stopExternal falls back to signalling it.
    const patch = { name: agent.name, cwd: agent.cwd, pid: agent.pid };
    if (todo.status !== "needs-you") {
      patch.status = agent.status === "busy" ? "working" : "idle";
    }
    if (Object.entries(patch).some(([k, v]) => todo[k] !== v)) {
      const t = store.update(todo.id, patch);
      broadcast({ type: "todo", todo: t });
    }
  }
}
