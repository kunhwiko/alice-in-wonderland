// Owns Claude sessions through the Agent SDK.
//
// The whole point of this file is the canUseTool bridge: the SDK pauses the
// session while the callback is outstanding, and the docs guarantee it "can stay
// pending indefinitely". So we park a promise there, flip the TODO to needs-you,
// and resolve it from an HTTP route when the browser answers.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { store } from "./store.js";
import { ALICE_VOICE } from "./voice.js";

/** Async iterable you can push into after iteration has started. */
function inputQueue() {
  const items = [];
  let waiting = null;
  let done = false;

  return {
    push(text) {
      const msg = {
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      };
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: msg, done: false });
      } else {
        items.push(msg);
      }
    },
    end() {
      done = true;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: undefined, done: true });
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (items.length) return Promise.resolve({ value: items.shift(), done: false });
          if (done) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };
}

/** live sessions, keyed by todo id */
const live = new Map();
/** outstanding canUseTool promises: reqId -> { resolve, todoId } */
const pendingResolvers = new Map();
/** todo ids being stopped on purpose, so drive() doesn't call it a failure */
const stopping = new Set();
/** todo ids being interrupted on purpose — same reason, different ending */
const interrupting = new Set();
/**
 * todo ids mid-handoff: stopped here, not yet running in a terminal.
 *
 * For that moment the card is an owned session with no process on it, which is
 * exactly the shape `send()` revives. Reviving it would put Wonderland's
 * process on a transcript a terminal is about to open — the interleaving that
 * --fork-session exists to prevent. So resume() refuses while this is set.
 */
const handingOver = new Set();

/**
 * Answer, with a deny, every canUseTool this todo is parked on. A blocked
 * callback holds the turn open, so neither stop nor interrupt can land while
 * one is outstanding.
 */
function releasePending(todoId, message) {
  for (const [reqId, p] of [...pendingResolvers]) {
    if (p.todoId !== todoId) continue;
    pendingResolvers.delete(reqId);
    p.resolve({ behavior: "deny", message });
  }
}

/**
 * A name is only useful as an address if it points at one thing. Duplicates
 * get a numeric suffix rather than being rejected — nobody wants their
 * session refused because a card from last week has the same name.
 */
function uniqueName(wanted) {
  const taken = new Set(
    store.all().filter((t) => !t.closedAt).map((t) => t.name)
  );
  if (!taken.has(wanted)) return wanted;
  for (let i = 2; ; i++) {
    const candidate = `${wanted}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function createSessionManager({ broadcast, briefer = null }) {
  function setStatus(todoId, status, extra = {}) {
    const todo = store.update(todoId, { status, ...extra });
    if (todo) broadcast({ type: "todo", todo });
  }

  /**
   * Blocks until the browser answers. Handles both plain tool approvals and
   * AskUserQuestion, which arrives through this same callback.
   */
  function makeCanUseTool(todoId) {
    return async (toolName, input, { signal } = {}) => {
      const req = {
        id: randomUUID(),
        todoId,
        toolName,
        input,
        kind: toolName === "AskUserQuestion" ? "question" : "permission",
        askedAt: Date.now(),
      };

      setStatus(todoId, "needs-you", { pending: req });
      briefer?.brief(todoId, { kind: "pending", pending: req });

      const decision = await new Promise((resolve) => {
        pendingResolvers.set(req.id, { resolve, todoId });
        // If the SDK aborts the call, stop waiting and deny cleanly.
        signal?.addEventListener("abort", () => {
          if (pendingResolvers.delete(req.id)) {
            resolve({ behavior: "deny", message: "Cancelled." });
          }
        });
      });

      pendingResolvers.delete(req.id);
      setStatus(todoId, "working", { pending: null });
      return decision;
    };
  }

  /**
   * Record what a subagent is doing. Keyed by the id of the `Agent` call that
   * spawned it, which the SDK repeats in `parent_tool_use_id` on every frame
   * it produces — so nesting at any depth reconstructs itself.
   */
  function upsertSub(todoId, subId, patch) {
    const todo = store.get(todoId);
    if (!todo) return;
    const subagents = { ...(todo.subagents ?? {}) };
    const cur = subagents[subId] ?? {
      id: subId, type: null, description: null, status: "running",
      tools: {}, lastText: null, startedAt: Date.now(),
    };
    const next = { ...cur };
    if (patch.type) next.type = patch.type;
    if (patch.description) next.description = patch.description;
    if (patch.status) next.status = patch.status;
    if (patch.text?.trim()) next.lastText = patch.text.slice(0, 400);
    if (patch.toolNames?.length) {
      next.tools = { ...cur.tools };
      for (const n of patch.toolNames) next.tools[n] = (next.tools[n] ?? 0) + 1;
    }
    subagents[subId] = next;
    const updated = store.update(todoId, { subagents });
    if (updated) broadcast({ type: "todo", todo: updated });
  }

  /**
   * Open a session and start driving it. Fresh and resumed differ only by the
   * `resume` id. Three options are traps, not preferences:
   * `permissionMode: "default"` (looser modes resolve calls before
   * `canUseTool`), `systemPrompt.append` (`appendSystemPrompt` is silently
   * ignored), and `forwardSubagentText` (or subagents never speak).
   */
  function launch(todo, text, { resume } = {}) {
    const queue = inputQueue();
    queue.push(text);

    const q = query({
      prompt: queue,
      options: {
        cwd: todo.cwd,
        ...(todo.model ? { model: todo.model } : {}),
        ...(resume ? { resume } : {}),
        permissionMode: "default",
        canUseTool: makeCanUseTool(todo.id),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: ALICE_VOICE,
          snapshot: true,
        },
        forwardSubagentText: true,
      },
    });

    live.set(todo.id, { queue, q });
    drive(todo.id, q);
  }

  async function drive(todoId, q) {
    // The turn's last words, in full — lastText on the card is clipped, and
    // when a turn ends on a recommendation the end is the part that matters.
    let finalText = "";
    try {
      for await (const msg of q) {
        if (msg.type === "system" && msg.subtype === "init") {
          const todo = store.update(todoId, { sessionId: msg.session_id });
          if (todo) broadcast({ type: "todo", todo });
          continue;
        }

        // Non-null means this frame came from inside a subagent, not the
        // main conversation.
        const parentTool = msg.parent_tool_use_id ?? null;

        if (msg.type === "assistant") {
          const blocks = msg.message?.content ?? [];
          const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
          const tools = blocks.filter((b) => b.type === "tool_use");

          if (parentTool) {
            upsertSub(todoId, parentTool, {
              type: msg.subagent_type,
              description: msg.task_description,
              text,
              toolNames: tools.map((t) => t.name),
            });
            continue;
          }

          if (text.trim()) {
            finalText = text;
            store.update(todoId, { lastText: text.slice(0, 400) });
            broadcast({ type: "message", todoId, role: "assistant", text });
          }
          for (const t of tools) {
            // An Agent call is a subagent being spawned; its id is what the
            // children will carry as parent_tool_use_id.
            if (t.name === "Agent" || t.name === "Task") {
              upsertSub(todoId, t.id, {
                type: t.input?.subagent_type,
                description: t.input?.description,
              });
            }
            broadcast({ type: "tool", todoId, name: t.name, input: t.input });
          }
          continue;
        }

        // The tool_result for an Agent call is that subagent finishing.
        if (msg.type === "user" && !parentTool) {
          for (const b of msg.message?.content ?? []) {
            if (b.type === "tool_result" && b.tool_use_id) {
              if (store.get(todoId)?.subagents?.[b.tool_use_id]) {
                upsertSub(todoId, b.tool_use_id, { status: "done" });
              }
            }
          }
          continue;
        }

        if (msg.type === "result") {
          if (stopping.has(todoId)) break;
          // A subagent can't outlive the turn that spawned it, so anything
          // still marked running here never got its tool_result.
          for (const [id, sub] of Object.entries(store.get(todoId)?.subagents ?? {})) {
            if (sub.status === "running") upsertSub(todoId, id, { status: "done" });
          }
          // An interrupted turn reports error_during_execution. That's the
          // user pressing stop, not a failure — and because input is streamed
          // the session lives on, so this is `idle` and not `interrupted`.
          if (interrupting.delete(todoId)) {
            setStatus(todoId, "idle", { pending: null });
            finalText = "";
            continue;
          }
          // Turn finished. Claude is now waiting on your next message.
          setStatus(todoId, msg.subtype === "success" ? "idle" : "failed");
          // Only a turn that came back to you on its own. One you interrupted
          // left through the branch above — you already know why it's waiting.
          if (msg.subtype === "success" && finalText.trim()) {
            briefer?.brief(todoId, { kind: "turn", turn: msg.uuid ?? Date.now(), finalText });
          }
          finalText = "";
        }
      }
      // The generator only ends when we end it, so reaching here means shutdown.
      setStatus(todoId, stopping.has(todoId) ? "stopped" : "idle");
    } catch (err) {
      // interrupt() makes the generator throw. That's us, not a failure —
      // without this check a deliberate stop reports as "failed".
      if (stopping.has(todoId)) {
        setStatus(todoId, "stopped", { pending: null });
      } else if (interrupting.has(todoId)) {
        // An interrupt is meant to leave the session standing, so landing
        // here means it took the process with it. Recoverable, but by resume.
        setStatus(todoId, "interrupted", { pending: null });
      } else {
        setStatus(todoId, "failed", { lastText: String(err?.message ?? err) });
        broadcast({ type: "error", todoId, error: String(err?.message ?? err) });
      }
    } finally {
      live.delete(todoId);
      stopping.delete(todoId);
      interrupting.delete(todoId);
    }
  }

  return {
    /** Start a new Wonderland-owned session. */
    start({ cwd, prompt, name, model }) {
      const todo = store.create({
        kind: "owned",
        cwd,
        // Stored so a resume uses the same mind, and so the card can show it.
        model: model || null,
        name: uniqueName(name || cwd.split("/").filter(Boolean).pop() || "wonderland"),
        title: prompt.slice(0, 120),
        status: "working",
      });

      launch(todo, prompt);
      broadcast({ type: "todo", todo });
      return todo;
    },

    /** Resume a session whose process died (server restart) and send a message. */
    resume({ todoId, text }) {
      const todo = store.get(todoId);
      if (!todo || todo.kind !== "owned" || !todo.sessionId) return null;
      if (handingOver.has(todoId)) return null;

      launch(todo, text, { resume: todo.sessionId });
      setStatus(todo.id, "working");
      return store.get(todoId);
    },

    /** Push a follow-up turn into a running session, reviving it if needed. */
    send(todoId, text) {
      const entry = live.get(todoId);
      if (entry) {
        entry.queue.push(text);
        setStatus(todoId, "working");
        return true;
      }
      return Boolean(this.resume({ todoId, text }));
    },

    /** Answer an outstanding canUseTool. */
    respond(reqId, decision) {
      const entry = pendingResolvers.get(reqId);
      if (!entry) return false;
      pendingResolvers.delete(reqId);
      entry.resolve(decision);
      return true;
    },

    /**
     * The terminal's Esc: end the turn and leave the session standing. stdin
     * stays open, so the process survives and the next message continues in
     * it. drive() turns the aborted turn's result into `idle`.
     */
    async interrupt(todoId) {
      const entry = live.get(todoId);
      if (!entry) return { ok: false, reason: "not running" };

      interrupting.add(todoId);
      releasePending(todoId, "The user interrupted before this could run.");

      try {
        await entry.q.interrupt();
      } catch (err) {
        interrupting.delete(todoId);
        return { ok: false, reason: String(err?.message ?? err) };
      }
      return { ok: true };
    },

    /**
     * Stop an owned session for good: interrupt the turn, then close stdin so
     * the child process exits. The transcript survives, so the session can
     * still be resumed later by id — this ends the process, not the history.
     */
    async stop(todoId) {
      const entry = live.get(todoId);
      if (!entry) return { ok: false, reason: "not running" };

      stopping.add(todoId);
      releasePending(todoId, "The user stopped this session.");

      try {
        await entry.q.interrupt();
      } catch {
        // Older CLIs and already-dead processes both land here; closing
        // stdin below still ends the session.
      }
      entry.queue.end();
      live.delete(todoId);

      setStatus(todoId, "stopped", { pending: null });
      return { ok: true, how: "interrupted" };
    },

    isLive(todoId) {
      return live.has(todoId);
    },

    /**
     * Close the window between "Wonderland let go" and "the terminal took
     * hold". Held by the handover route across the stop and the AppleScript,
     * and released either way — on success the card is `external` by then,
     * which refuses a resume on its own.
     */
    latchForHandover(todoId) {
      handingOver.add(todoId);
    },
    releaseHandover(todoId) {
      handingOver.delete(todoId);
    },

    shutdown() {
      for (const [, entry] of live) entry.queue.end();
    },
  };
}
