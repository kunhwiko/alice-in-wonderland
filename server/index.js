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
import { ingestHook, pollAgents, stopExternal } from "./external.js";
import { openInTerminal, resumeCommandFor } from "./terminal.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, "public");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 7777);

/* ---------------------------------------------------------------- SSE hub */

const clients = new Set();

function broadcast(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(frame);
}

const sessions = createSessionManager({ broadcast });

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
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: "nope" });
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
      res.write(`data: ${JSON.stringify({ type: "hello", todos: store.all() })}\n\n`);
      clients.add(res);
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(keepAlive);
        clients.delete(res);
      });
      return;
    }

    if (path === "/api/todos" && method === "GET") {
      return json(res, 200, {
        todos: store.all().map((t) => ({
          ...t,
          // The client used to build this string itself and omitted
          // --fork-session, which is exactly wrong for a live terminal tab.
          resumeCommand: resumeCommandFor(t, { ownedIsLive: sessions.isLive(t.id) }),
        })),
      });
    }

    if (path === "/api/sessions" && method === "POST") {
      const { cwd, prompt, name, model } = await readBody(req);
      if (!cwd || !prompt) return json(res, 400, { error: "cwd and prompt are required" });
      const todo = sessions.start({ cwd, prompt, name, model });
      return json(res, 200, { todo });
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

      if (action === "stop") {
        const result =
          todo.kind === "owned"
            ? await sessions.stop(id)
            : await stopExternal(todo);

        if (result.ok) {
          const t = store.update(id, { status: "stopped", pending: null });
          broadcast({ type: "todo", todo: t });
        }
        return json(res, result.ok ? 200 : 409, result);
      }

      if (action === "terminal") {
        const result = await openInTerminal(todo, { ownedIsLive: sessions.isLive(id) });
        return json(res, result.ok ? 200 : 409, result);
      }

      if (action === "delete") {
        // A card can be deleted while its session is still running, so stop
        // it first rather than orphaning the process.
        if (todo.kind === "owned" && sessions.isLive(id)) await sessions.stop(id);
        store.remove(id);
        broadcast({ type: "removed", id });
        return json(res, 200, { ok: true });
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

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    clearInterval(poller);
    sessions.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
