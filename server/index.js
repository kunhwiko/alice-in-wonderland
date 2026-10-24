// Wonderland — a localhost queue for your Claude sessions.
//
// Binds to 127.0.0.1 only, and deliberately so: this process can approve
// arbitrary tool calls, so it must never be reachable off this machine.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "./store.js";
import { createSessionManager } from "./sessions.js";
import { createBriefer } from "./briefing.js";
import {
  ingestHook, pollAgents, stopExternal,
  startWatching, stopWatching, stopAllWatching, resumeWatching,
} from "./external.js";
import { openInTerminal, resumeCommandFor } from "./terminal.js";
import { findTranscript, readEvents } from "./transcript.js";
import { createSlackWatcher } from "./slack.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, "public");
// three.js, served straight from node_modules: still no build step, and no CDN.
const VENDOR = { "/vendor/three/": join(ROOT, "node_modules", "three") };
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 7777);

/* ---------------------------------------------------------------- SSE hub */

const clients = new Set();

/**
 * A todo as the browser gets it: with the resume command built here, because
 * only the server knows whether a process still holds the transcript, and so
 * whether the command needs --fork-session. Attached to every todo that goes
 * out, not just the first load — a card that has changed since is the one
 * most likely to have changed liveness.
 */
function present(todo) {
  return { ...todo, resumeCommand: resumeCommandFor(todo, { ownedIsLive: sessions.isLive(todo.id) }) };
}

function broadcast(event) {
  const out = event.type === "todo" ? { ...event, todo: present(event.todo) } : event;
  const frame = `data: ${JSON.stringify(out)}\n\n`;
  for (const res of clients) res.write(frame);
}

const briefer = createBriefer({ broadcast });
const sessions = createSessionManager({ broadcast, briefer });
const slack = createSlackWatcher({ broadcast });

/* ------------------------------------------------------------------ utils */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".md": "text/markdown; charset=utf-8",
};

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    chunks.push(c);
    // A hook payload is tiny; anything huge is a mistake or an attack.
    total += c.length;
    if (total > 1_000_000) throw new Error("body too large");
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function serveStatic(res, urlPath) {
  let base = PUBLIC;
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  for (const [prefix, dir] of Object.entries(VENDOR)) {
    if (urlPath.startsWith(prefix)) {
      base = dir;
      rel = urlPath.slice(prefix.length);
    }
  }
  const file = normalize(join(base, rel));
  if (!file.startsWith(base)) return json(res, 403, { error: "nope" });
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

/* ----------------------------------------------------------------- routes */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  try {
    // --- live event stream -------------------------------------------------
    if (path === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      // Everything the page needs to draw itself, so it needs no fetch of its own.
      const hello = { type: "hello", todos: store.all().map(present), slack: slack.snapshot() };
      res.write(`data: ${JSON.stringify(hello)}\n\n`);
      clients.add(res);
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(keepAlive);
        clients.delete(res);
      });
      return;
    }

    // For looking at the state from a terminal: the page itself gets all of
    // this from the event stream's hello. Likewise GET /api/slack below.
    if (path === "/api/todos" && method === "GET") {
      return json(res, 200, { todos: store.all().map(present) });
    }

    if (path === "/api/sessions" && method === "POST") {
      const { cwd, prompt, name, model } = await readBody(req);
      if (!cwd || !prompt) return json(res, 400, { error: "cwd and prompt are required" });
      const todo = sessions.start({ cwd, prompt, name, model });
      return json(res, 200, { todo });
    }

    // --- the Tea Party: Slack conversations waiting on you -----------------
    if (path === "/api/slack" && method === "GET") {
      return json(res, 200, slack.snapshot());
    }
    if (path === "/api/slack/check" && method === "POST") {
      // Answers at once; the result arrives over SSE like everything else.
      slack.check();
      return json(res, 200, { ok: true });
    }
    const done = path.match(/^\/api\/slack\/([0-9a-f]+)\/done$/);
    if (done && method === "POST") {
      return slack.done(done[1])
        ? json(res, 200, { ok: true })
        : json(res, 404, { error: "no such conversation" });
    }

    // --- empty the archive in one go ---------------------------------------
    if (path === "/api/archive/empty" && method === "POST") {
      const ids = store.all().filter((t) => t.closedAt).map((t) => t.id);
      for (const id of ids) {
        const t = store.get(id);
        if (t?.kind === "owned" && sessions.isLive(id)) await sessions.stop(id);
        store.remove(id);
        broadcast({ type: "removed", id });
      }
      return json(res, 200, { ok: true, removed: ids.length });
    }

    // --- hook ingest from terminal sessions --------------------------------
    if (path === "/api/hook" && method === "POST") {
      const payload = await readBody(req);
      ingestHook(payload, broadcast);
      return json(res, 200, { ok: true });
    }

    // --- answer an outstanding permission / question -----------------------
    let m = path.match(/^\/api\/pending\/([^/]+)$/);
    if (m && method === "POST") {
      const decision = await readBody(req);
      if (decision.behavior !== "allow" && decision.behavior !== "deny") {
        return json(res, 400, { error: "behavior must be allow or deny" });
      }
      const ok = sessions.respond(m[1], decision);
      return json(res, ok ? 200 : 409, ok ? { ok: true } : { error: "no longer pending" });
    }

    // --- the conversation so far, from the transcript on disk ---------------
    //
    // The browser keeps its log in memory, so a reload loses it. Fetched per
    // card on opening rather than pushed to every client on connect: most
    // cards are never opened, and some transcripts run to megabytes.
    m = path.match(/^\/api\/todos\/([^/]+)\/log$/);
    if (m && method === "GET") {
      const todo = store.get(m[1]);
      if (!todo) return json(res, 404, { error: "no such todo" });
      const file = todo.sessionId ? findTranscript(todo.sessionId) : null;
      // No transcript is not an error — a session may not have written one yet.
      if (!file) return json(res, 200, { events: [] });

      // Re-shaped into the events the SSE hub broadcasts, so the client turns
      // history and live frames into log lines with the same one converter.
      const events = readEvents(file, { limit: 200 }).map((e) =>
        e.kind === "tool"
          ? { type: "tool", todoId: todo.id, name: e.name, input: e.input }
          : { type: "message", todoId: todo.id, role: e.role, text: e.text }
      );
      return json(res, 200, { events });
    }

    // --- per-todo actions ---------------------------------------------------
    m = path.match(/^\/api\/todos\/([^/]+)\/([a-z]+)$/);
    if (m && method === "POST") {
      const [, id, action] = m;
      const todo = store.get(id);
      if (!todo) return json(res, 404, { error: "no such todo" });

      if (action === "message") {
        if (todo.kind !== "owned") {
          return json(res, 409, { error: "external sessions can't be messaged" });
        }
        const { text } = await readBody(req);
        if (!text?.trim()) return json(res, 400, { error: "text is required" });
        const ok = sessions.send(id, text);
        return json(res, ok ? 200 : 409, ok ? { ok: true } : { error: "could not resume" });
      }

      // Esc, not death. Owned only — there's no IPC into a terminal tab, and
      // signalling one would kill it rather than interrupt it.
      if (action === "interrupt") {
        if (todo.kind !== "owned") {
          return json(res, 409, { error: "external sessions can't be interrupted" });
        }
        // No status update here on purpose: drive() sets it when the
        // aborted turn's result frame arrives, and it is the one that knows
        // whether the session survived.
        const result = await sessions.interrupt(id);
        return json(res, result.ok ? 200 : 409, result);
      }

      if (action === "stop") {
        const result =
          todo.kind === "owned"
            ? await sessions.stop(id)
            : await stopExternal(todo);

        if (result.ok) {
          // Nothing will be appended to that transcript again.
          stopWatching(id);
          const t = store.update(id, { status: "stopped", pending: null, watching: false });
          broadcast({ type: "todo", todo: t });
        }
        return json(res, result.ok ? 200 : 409, result);
      }

      if (action === "terminal") {
        const result = await openInTerminal(todo, { ownedIsLive: sessions.isLive(id) });
        return json(res, result.ok ? 200 : 409, result);
      }

      // --- hand the session to a terminal, keeping the one card -------------
      //
      // Not a fork. Wonderland lets go of the session entirely, the terminal
      // resumes that same id, and the card stays put and watches the
      // transcript. One id, one history, one card.
      if (action === "handover") {
        if (todo.kind !== "owned") {
          return json(res, 409, { error: "that one's already in a terminal" });
        }
        if (!todo.sessionId) {
          return json(res, 409, { error: "that session has no id to resume" });
        }

        // Held across both steps below: between the stop and the terminal
        // taking hold, this is an owned card with no process, which is exactly
        // what send() revives. See sessions.js.
        sessions.latchForHandover(id);
        try {
          if (sessions.isLive(id)) await sessions.stop(id);

          // Re-read: stop() moved the status, and openInTerminal decides
          // whether to fork from it. Nothing holds the transcript now, so it
          // builds a plain --resume.
          const stopped = store.get(id);
          const opened = await openInTerminal(stopped, { ownedIsLive: false });
          if (!opened.ok) {
            // The session is already stopped, so the turn is lost either way,
            // but the card stays owned and can be revived from here.
            return json(res, 409, { error: opened.reason });
          }
          if (opened.forked) {
            // Belt and braces: a fork here would mean the liveness check
            // disagreed with us and we'd be creating the second card again.
            return json(res, 500, { error: "refused: that would have forked the session" });
          }

          // handedOverAt/seenInTerminal are what let pollAgents tell "the tab
          // hasn't opened yet" from "the tab has closed" — see external.js.
          const t = store.update(id, {
            kind: "external", status: "idle", pending: null,
            watching: true, handedOverAt: Date.now(), seenInTerminal: false,
          });
          const watch = startWatching(t, broadcast);
          const final = watch.ok ? t : store.update(id, { watching: false });
          broadcast({ type: "todo", todo: final });
          return json(res, 200, { ok: true, watching: watch.ok, reason: watch.reason, app: opened.app });
        } finally {
          sessions.releaseHandover(id);
        }
      }

      if (action === "delete") {
        // A card can be deleted while its session is still running, so stop
        // it first rather than orphaning the process.
        if (todo.kind === "owned" && sessions.isLive(id)) await sessions.stop(id);
        stopWatching(id);
        store.remove(id);
        broadcast({ type: "removed", id });
        return json(res, 200, { ok: true });
      }

      // "Noted": a finished turn you've read and have nothing to say to. It
      // leaves Alice's desk; the card stays where it is.
      if (action === "ack") {
        const { turn } = await readBody(req);
        if (!turn) return json(res, 400, { error: "turn is required" });
        const t = store.update(id, { ackedTurn: turn });
        broadcast({ type: "todo", todo: t });
        return json(res, 200, { todo: t });
      }

      if (action === "close") {
        const t = store.close(id);
        broadcast({ type: "todo", todo: t });
        return json(res, 200, { todo: t });
      }

      if (action === "reopen") {
        const t = store.reopen(id);
        broadcast({ type: "todo", todo: t });
        return json(res, 200, { todo: t });
      }
    }

    if (path.startsWith("/api/")) return json(res, 404, { error: "no such route" });
    return serveStatic(res, path);
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Wonderland is listening at http://${HOST}:${PORT}`);
  console.log(`Alice is minding ${store.all().filter((t) => !t.closedAt).length} thing(s).`);
});

// Keep external session names and liveness fresh.
const poller = setInterval(() => pollAgents(broadcast).catch(() => {}), 5_000);
pollAgents(broadcast).catch(() => {});

// A handed-over session carries on in its terminal across a restart of this
// process, so the cards that were following one pick the thread back up.
resumeWatching(broadcast);

slack.start();

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    clearInterval(poller);
    slack.stop();
    stopAllWatching();
    sessions.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
