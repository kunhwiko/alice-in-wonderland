// JSON-backed TODO state. Small enough that a file beats a database, and the
// conversation itself is never duplicated here — it lives in Claude's transcript.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, "data");
const FILE = join(DATA_DIR, "todos.json");

// Statuses: needs-you | working | idle | interrupted | failed | stopped | gone
// Kinds:    owned (Wonderland drives it) | external (a terminal tab, read-only)
// `watching` marks an external card whose transcript is being tailed — set by
// a handover, and the reason such a card keeps the name it was given here.

let state = { todos: [] };

function load() {
  if (!existsSync(FILE)) return;
  try {
    state = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    // A corrupt file shouldn't stop Wonderland from starting.
    state = { todos: [] };
  }
  // Owned sessions can't survive a restart: their child process died with us.
  for (const t of state.todos) {
    if (t.kind === "owned" && !t.closedAt && t.status !== "interrupted") {
      t.status = "interrupted";
      t.pending = null;
    }
  }
}

function persist() {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, FILE); // atomic swap, so a crash mid-write can't truncate
}

load();

export const store = {
  all() {
    return state.todos;
  },

  get(id) {
    return state.todos.find((t) => t.id === id) ?? null;
  },

  bySessionId(sessionId) {
    return state.todos.find((t) => t.sessionId === sessionId && !t.closedAt) ?? null;
  },

  create(fields) {
    const todo = {
      id: randomUUID(),
      sessionId: null,
      kind: "owned",
      name: null,
      cwd: null,
      title: null,
      status: "working",
      pending: null,
      watching: false,
      lastText: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      closedAt: null,
      ...fields,
    };
    state.todos.push(todo);
    persist();
    return todo;
  },

  update(id, patch) {
    const todo = state.todos.find((t) => t.id === id);
    if (!todo) return null;
    Object.assign(todo, patch, { updatedAt: Date.now() });
    persist();
    return todo;
  },

  close(id) {
    // Dismiss from the queue only. The underlying session keeps running.
    return store.update(id, { closedAt: Date.now() });
  },

  reopen(id) {
    return store.update(id, { closedAt: null });
  },

  /**
   * Drop the card for good. Only Wonderland's own record goes — Claude's
   * transcript in ~/.claude/projects stays where it is.
   */
  remove(id) {
    const i = state.todos.findIndex((t) => t.id === id);
    if (i < 0) return false;
    state.todos.splice(i, 1);
    persist();
    return true;
  },
};
