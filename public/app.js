import { alice } from "/alice.js";

const todos = new Map();
const logs = new Map(); // todoId -> [{who, text}]
let openId = null;

const $queue = document.getElementById("queue");
const $archive = document.getElementById("archive");
const $archiveSummary = document.getElementById("archive-summary");

document.getElementById("title").textContent = alice.title;
document.getElementById("tagline").textContent = alice.tagline;
document.getElementById("new-btn").textContent = alice.newSession;
document.getElementById("new-go").textContent = alice.newSessionGo;
document.getElementById("new-name-label").textContent = alice.newSessionName;
document.getElementById("new-model-label").textContent = alice.newSessionModel;
for (const m of alice.models) {
  const opt = document.createElement("option");
  opt.value = m.id;
  opt.textContent = m.label;
  document.getElementById("new-model").append(opt);
}
document.getElementById("new-where-label").textContent = alice.newSessionWhere;
document.getElementById("new-what-label").textContent = alice.newSessionWhat;
document.getElementById("footer").append(
  alice.quote,
  // NOT el() — it is declared below and would be in the temporal dead zone
  // here, which crashes the whole module. This footer runs before the utils.
  Object.assign(document.createElement("cite"), { textContent: alice.quoteSource })
);

/* ------------------------------------------------------------------ utils */

/**
 * Paths in the card head are often absurd — a scratchpad cwd runs past 90
 * characters. Show the tail, keep the whole thing on hover.
 */
/** "claude-opus-5" -> "opus 5", for a badge that has to stay narrow. */
function shortModel(id) {
  return String(id).replace(/^claude-/, "").replace(/-(\d)/, " $1").replace(/-/g, ".");
}

function prettyCwd(cwd) {
  if (!cwd) return "";
  const parts = cwd.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : cwd;
}

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
};

const HEART = (ring) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<rect width="32" height="32" rx="6" fill="${ring ? "#b8902f" : "#fffdf8"}"/>` +
      `<path d="M16 26S5 19 5 12.5A5.5 5.5 0 0 1 16 10a5.5 5.5 0 0 1 11 2.5C27 19 16 26 16 26z" fill="#c4384a"/>` +
      `</svg>`
  );

let faviconRing = null;
function setFavicon(ring) {
  if (faviconRing === ring) return; // don't thrash the DOM on every render
  faviconRing = ring;
  document.getElementById("favicon").href = HEART(ring);
}

function toast(text) {
  const t = el("div", { className: "toast", textContent: text });
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) toast(data.error ?? "Something went wrong.");
  return { ok: res.ok, data };
}

function log(todoId, who, text) {
  if (!logs.has(todoId)) logs.set(todoId, []);
  logs.get(todoId).push({ who, text });
}

/**
 * The event shapes that become log lines, and what they look like as one.
 * Shared by the SSE stream and the replayed history so there's a single place
 * that decides how a tool call reads.
 */
function logEntry(ev) {
  if (ev.type === "message") return { who: ev.role, text: ev.text };
  if (ev.type === "tool") return { who: "assistant", text: `→ ${ev.name}` };
  if (ev.type === "error") return { who: "assistant", text: `error: ${ev.error}` };
  return null;
}

/** cards we've already asked the server for history for */
const logFetched = new Set();

/**
 * Fill a card's conversation in from the transcript on disk.
 *
 * Only when we have nothing for it. A card we've been watching all along
 * already holds its recent lines from the stream, and the transcript holds
 * those same lines — merging the two would need de-duplication, so the older
 * history stays missing on such a card until the next reload. The case that
 * matters is the one where we have nothing: a fresh page, or a card handed to
 * a terminal whose frames were never streamed here at all.
 */
async function ensureLog(todo) {
  if (!todo.sessionId || logFetched.has(todo.id)) return;
  if (logs.get(todo.id)?.length) return;
  logFetched.add(todo.id);

  const { ok, data } = await api(`/api/todos/${todo.id}/log`);
  if (!ok || !data.events?.length) return;

  const history = data.events.map(logEntry).filter(Boolean);
  // Anything that streamed in while we were fetching came after this history.
  logs.set(todo.id, [...history, ...(logs.get(todo.id) ?? [])]);
  render();
}

/* ------------------------------------------------------------- pending UI */

const HEADLINE_KEYS = ["command", "file_path", "url", "pattern"];

/** The decision moment, framed as a decree. Rationale in style.css. */
function renderPermission(todo) {
  const p = todo.pending;
  const input = p.input ?? {};
  const decree = el("div", { className: "decree" });

  decree.append(
    el("div", { className: "decree-banner" },
      el("span", { className: "decree-tool", textContent: p.toolName })
    )
  );

  // The literal values, never a paraphrase. The first one found is the
  // headline: it's what you're actually deciding about.
  const headline = HEADLINE_KEYS.find((k) => input[k]);
  decree.append(
    el("div", { className: "decree-intro", textContent: headline ? alice.decreeRun : alice.decreeDo })
  );
  if (headline) {
    decree.append(el("pre", { className: "decree-cmd mono", textContent: String(input[headline]) }));
  }

  // Claude's own one-line explanation of the call. Plain prose, not JSON —
  // but below the command, never above it: the literal text decides.
  if (typeof input.description === "string" && input.description.trim()) {
    decree.append(el("div", { className: "decree-why", textContent: input.description }));
  }

  const rest = Object.fromEntries(
    Object.entries(input).filter(([k]) => k !== headline && k !== "description")
  );
  if (Object.keys(rest).length) {
    decree.append(el("div", { className: "field-label", textContent: "and with" }));
    decree.append(el("pre", { className: "tool mono", textContent: JSON.stringify(rest, null, 2) }));
  }

  const reason = el("input", { className: "decree-reason", placeholder: alice.denyReason });
  const allow = el("button", { className: "seal seal-allow", textContent: alice.allow });
  const deny = el("button", { className: "seal seal-deny", textContent: alice.deny });

  allow.onclick = () =>
    api(`/api/pending/${p.id}`, { behavior: "allow", updatedInput: p.input });
  deny.onclick = () => {
    // Attribute the reason to the user explicitly. A bare instruction here
    // ("delete it instead") arrives as tool output and Claude correctly reads
    // it as possible prompt injection; framing it as reported user intent is
    // what the SDK docs model, and it lands as guidance instead.
    const why = reason.value.trim();
    const message = why
      ? `The user declined this action. They said: ${why}`
      : "The user declined this action.";
    api(`/api/pending/${p.id}`, { behavior: "deny", message });
  };

  decree.append(el("div", { className: "decree-seals" }, allow, deny));
  decree.append(reason);
  // Both seals let the turn carry on, so without this row the only way out of
  // a session you'd changed your mind about was to answer it first.
  decree.append(
    el("div", { className: "row escape" }, interruptButton(todo), stopButton(todo))
  );
  return decree;
}

function renderQuestions(todo) {
  const p = todo.pending;
  const questions = p.input?.questions ?? [];
  const wrap = el("div");
  const picks = new Map();

  questions.forEach((q, qi) => {
    const box = el("div", { className: "q" });
    box.append(el("div", { className: "qtext", textContent: q.question }));
    (q.options ?? []).forEach((opt) => {
      const input = el("input", {
        type: q.multiSelect ? "checkbox" : "radio",
        name: `q${qi}`,
        value: opt.label,
      });
      input.onchange = () => {
        if (q.multiSelect) {
          const set = picks.get(q.question) ?? new Set();
          input.checked ? set.add(opt.label) : set.delete(opt.label);
          picks.set(q.question, set);
        } else {
          picks.set(q.question, opt.label);
        }
      };
      box.append(
        el(
          "label",
          {},
          input,
          el("span", {}, el("div", { textContent: opt.label }),
            el("div", { className: "odesc", textContent: opt.description ?? "" }))
        )
      );
    });
    wrap.append(box);
  });

  const go = el("button", { className: "primary", textContent: alice.submitAnswers });
  go.onclick = () => {
    const answers = {};
    for (const [k, v] of picks) answers[k] = v instanceof Set ? [...v].join(", ") : v;
    api(`/api/pending/${p.id}`, {
      behavior: "allow",
      updatedInput: { questions, answers },
    });
  };
  wrap.append(el("div", { className: "row" }, go));
  // A question blocks the turn exactly as a permission does — same way out.
  wrap.append(el("div", { className: "row escape" }, interruptButton(todo), stopButton(todo)));
  return wrap;
}

/* ---------------------------------------------------------------- card UI */

const STATUS_COPY = {
  "needs-you": alice.askAllow,
  working: alice.working,
  idle: alice.resting,
  interrupted: alice.interrupted,
  failed: alice.failed,
  gone: alice.gone,
};

// Suit per state, printed in opposite corners like a real card's index.
// Anything not listed is a stopped session and falls through to ♠.
const SUITS = { "needs-you": "♥", working: "♦", idle: "♣" };

/** subagent ids the user has expanded */
const openSubs = new Set();

/** The subagent tree for one card. Nested rows, never cards — see sessions.js. */
function renderSubagents(subs) {
  const wrap = el("div", { className: "helpers" });
  wrap.append(el("div", { className: "field-label", textContent: alice.helpers }));

  for (const sub of subs) {
    const row = el("div", {
      className: `helper helper-${sub.status}${openSubs.has(sub.id) ? " open" : ""}`,
    });

    const tools = Object.entries(sub.tools ?? {})
      .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
      .join(", ");

    const head = el("div", { className: "helper-head" },
      el("span", { className: "helper-type", textContent: sub.type ?? "agent" }),
      el("span", { className: "helper-desc", textContent: sub.description ?? "" }),
      el("span", {
        className: "helper-state",
        textContent: sub.status === "running" ? alice.helperRunning : alice.helperDone,
      })
    );
    head.onclick = (e) => {
      e.stopPropagation();
      openSubs.has(sub.id) ? openSubs.delete(sub.id) : openSubs.add(sub.id);
      render();
    };
    row.append(head);

    if (tools) row.append(el("div", { className: "helper-tools mono", textContent: `→ ${tools}` }));

    // Always show what it said. Hiding the one useful thing behind a caret
    // meant the answer was invisible unless you clicked on spec.
    const open = openSubs.has(sub.id);
    if (sub.lastText || sub.status !== "running") {
      row.append(
        el("div", {
          className: `helper-text${open ? " open" : ""}`,
          textContent: sub.lastText ?? alice.helperNoText,
        })
      );
    }
    wrap.append(row);
  }
  return wrap;
}

/** The conversation so far, as the SSE stream has delivered it. */
function renderLog(todo) {
  const entries = logs.get(todo.id) ?? [];
  if (!entries.length) return null;
  const logBox = el("div", { className: "log" });
  for (const e of entries) {
    logBox.append(
      el("div", { className: `msg ${e.who}` },
        el("div", { className: "who", textContent: e.who }),
        el("div", { className: "text", textContent: e.text })
      )
    );
  }
  queueMicrotask(() => { logBox.scrollTop = logBox.scrollHeight; });
  return logBox;
}

/**
 * Alice's briefing, if it's about the moment the card is in now. A pending
 * request carries its own id; a finished turn is current only while the card
 * is idle. Anything else is a briefing about a moment that has passed.
 */
function currentBriefing(todo) {
  const b = todo.briefing;
  if (!b || todo.kind !== "owned") return null;
  if (todo.pending) return b.key === todo.pending.id ? b : null;
  return todo.status === "idle" && b.key.startsWith("turn:") ? b : null;
}

/**
 * Shown on the card even when it's collapsed — not having to open each one is
 * the point. Plain text, never markup: what she says is drawn from the
 * session.
 */
function renderBriefing(todo) {
  const b = currentBriefing(todo);
  if (!b) return null;
  const box = el("div", { className: `briefing ${b.status}` });
  if (b.status === "reading") {
    box.append(el("div", { className: "briefing-text", textContent: alice.briefingReading }));
    return box;
  }
  if (b.status === "failed") {
    box.append(el("div", { className: "briefing-text", textContent: alice.briefingFailed, title: b.text ?? "" }));
    return box;
  }
  box.append(
    el("div", { className: "briefing-text", textContent: b.text }),
    el("div", {
      className: "briefing-caveat",
      textContent: todo.pending ? alice.briefingCaveat : alice.briefingCaveatTurn,
    })
  );
  return box;
}

function renderCard(todo) {
  const card = el("div", { className: `card ${todo.status}` });
  const suit = SUITS[todo.status] ?? "♠";
  card.append(
    el("span", { className: "pip pip-tl", textContent: suit }),
    el("span", { className: "pip pip-br", textContent: suit })
  );

  // A collapsed card gives no hint that it has helpers inside, so say so on
  // the head — otherwise the only way to find them is to click speculatively.
  const subCount = Object.keys(todo.subagents ?? {}).length;
  const subsRunning = Object.values(todo.subagents ?? {})
    .filter((x) => x.status === "running").length;

  const head = el(
    "div",
    { className: "card-head" },
    el("span", { className: "name", textContent: todo.name ?? "session" }),
    el("span", { className: `badge ${todo.status}`, textContent: todo.status }),
    todo.kind === "external" ? el("span", { className: "badge external", textContent: "terminal" }) : null,
    todo.model
      ? el("span", { className: "badge model", textContent: shortModel(todo.model) })
      : null,
    subCount
      ? el("span", {
          className: `badge helpers${subsRunning ? " running" : ""}`,
          textContent: alice.helperCount(subCount, subsRunning),
        })
      : null,
    el("span", {
      className: "cwd mono",
      textContent: prettyCwd(todo.cwd),
      title: todo.cwd ?? "",
    })
  );
  head.onclick = () => {
    openId = openId === todo.id ? null : todo.id;
    // Opening is the moment we know the conversation is wanted.
    if (openId === todo.id) ensureLog(todo);
    render();
  };
  card.append(head);
  card.append(el("div", { className: "sub", textContent: todo.title ?? STATUS_COPY[todo.status] ?? "" }));
  const briefing = renderBriefing(todo);
  if (briefing) card.append(briefing);

  if (openId !== todo.id) return card;

  const body = el("div", { className: "body" });

  if (todo.kind === "external") {
    // A handed-over card is external too, but it isn't blind: transcript.js is
    // tailing it, so the conversation keeps arriving. Read-only either way.
    if (todo.watching) {
      body.append(el("div", { className: "sub", textContent: alice.watched }));
      const log = renderLog(todo);
      if (log) {
        body.append(el("div", { className: "field-label", textContent: alice.watchedLog }));
        body.append(log);
      }
      body.append(el("div", { className: "row" }, terminalButton(todo), closeButton(todo), stopButton(todo)));
      card.append(body);
      return card;
    }

    body.append(el("div", { className: "sub", textContent: alice.external }));
    body.append(el("div", { className: "field-label", textContent: alice.externalHow }));
    // Built server-side: it knows whether a process still holds this
    // transcript, and so whether the command needs --fork-session.
    const cmd = todo.resumeCommand ?? `claude --resume ${todo.sessionId}`;
    body.append(el("pre", { className: "tool mono", textContent: cmd }));
    const copy = el("button", { textContent: "Copy" });
    copy.onclick = () => navigator.clipboard.writeText(cmd).then(() => toast(alice.copied));
    body.append(el("div", { className: "row" }, copy, terminalButton(todo), closeButton(todo), stopButton(todo)));
    card.append(body);
    return card;
  }

  const log = renderLog(todo);
  if (log) body.append(log);

  const subs = Object.values(todo.subagents ?? {});
  if (subs.length) body.append(renderSubagents(subs));

  if (todo.pending) {
    body.append(todo.pending.kind === "question" ? renderQuestions(todo) : renderPermission(todo));
  } else if (todo.status === "working") {
    body.append(el("div", { className: "sub", textContent: alice.thinking }));
  }

  // Follow-up input — available whenever Claude isn't mid-decision.
  if (!todo.pending) {
    const box = el("textarea", { rows: 2, placeholder: alice.sendPlaceholder });
    const send = el("button", { className: "primary", textContent: alice.send });
    const submit = async () => {
      const text = box.value.trim();
      if (!text) return;
      box.value = "";
      log(todo.id, "user", text);
      render();
      await api(`/api/todos/${todo.id}/message`, { text });
    };
    send.onclick = submit;
    box.onkeydown = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
    };
    body.append(el("div", { className: "row" }, box));
    body.append(el("div", { className: "row" },
      send, interruptButton(todo), terminalButton(todo), handoverButton(todo),
      closeButton(todo), stopButton(todo)));
  }

  card.append(body);
  return card;
}

const DEAD = ["stopped", "gone", "failed", "interrupted"];

/**
 * Two-step button for anything irreversible. The first click only arms it;
 * it disarms after a few seconds so a stray click can't sit there loaded.
 */
function confirmButton({ label, confirmLabel, className = "danger", warn, run }) {
  const b = el("button", { className, textContent: label });
  let armed = false;
  let timer = null;

  b.onclick = async (e) => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      b.textContent = confirmLabel;
      b.classList.add("armed");
      if (warn) toast(warn);
      timer = setTimeout(() => {
        armed = false;
        b.textContent = label;
        b.classList.remove("armed");
      }, 4000);
      return;
    }
    clearTimeout(timer);
    b.disabled = true;
    await run();
  };
  return b;
}

/**
 * Esc: ends the turn, keeps the session. One click, no arming — it's cheap
 * and undoable, and making you confirm would cost you the thing you wanted,
 * which was to stop it now.
 */
function interruptButton(todo) {
  if (todo.kind !== "owned") return null;
  if (!["working", "needs-you"].includes(todo.status)) return null;
  const b = el("button", { className: "ghost-danger", textContent: alice.interrupt });
  b.onclick = async (e) => {
    e.stopPropagation();
    b.disabled = true;
    const { ok, data } = await api(`/api/todos/${todo.id}/interrupt`, {});
    if (ok) toast(alice.interruptToast);
    else if (data.reason === "not running") toast(alice.notRunning);
    b.disabled = false;
  };
  return b;
}

/** Ends the process. Hidden once there's nothing left running to end. */
function stopButton(todo) {
  if (DEAD.includes(todo.status)) return null;
  return confirmButton({
    label: alice.stop,
    confirmLabel: alice.stopConfirm,
    // Say plainly what's about to happen to somebody's terminal.
    warn: todo.kind === "external" ? alice.stopWarnTerminal : null,
    run: async () => {
      const { ok, data } = await api(`/api/todos/${todo.id}/stop`, {});
      if (ok) toast(alice.stopped);
      else if (data.reason === "not running") toast(alice.notRunning);
    },
  });
}

/**
 * Removes the card itself. Always available — a dead session still leaves a
 * card behind, and that card was previously impossible to get rid of.
 */
function forgetButton(todo) {
  return confirmButton({
    label: alice.forget,
    confirmLabel: alice.forgetConfirm,
    warn: alice.transcriptKept,
    run: async () => {
      const { ok } = await api(`/api/todos/${todo.id}/delete`, {});
      if (ok) toast(alice.forgotten);
    },
  });
}

/**
 * Move the session into a terminal for good, keeping this one card.
 *
 * Distinct from "Open in a terminal", which forks: that leaves a second
 * session with a second id and a second card. This one lets go, so the
 * terminal can have the original.
 */
function handoverButton(todo) {
  if (todo.kind !== "owned" || !todo.sessionId) return null;
  return confirmButton({
    label: alice.handover,
    confirmLabel: alice.handoverConfirm,
    className: "ghost-danger",
    warn: alice.handoverWarn,
    run: async () => {
      const { ok, data } = await api(`/api/todos/${todo.id}/handover`, {});
      if (ok) toast(data.watching ? alice.handedOver : alice.handedOverBlind);
    },
  });
}

/** Hand the session off to a real terminal tab. */
function terminalButton(todo) {
  if (!todo.sessionId) return null;
  const b = el("button", { textContent: alice.openTerminal });
  b.onclick = async (e) => {
    e.stopPropagation();
    const { ok, data } = await api(`/api/todos/${todo.id}/terminal`, {});
    if (ok) toast(data.forked ? alice.openedForked : alice.openedTerminal);
  };
  return b;
}

function closeButton(todo) {
  const b = el("button", { className: "ghost", textContent: alice.close });
  b.onclick = async (e) => {
    e.stopPropagation();
    await api(`/api/todos/${todo.id}/close`, {});
    toast(alice.closed);
  };
  return b;
}

/* ---------------------------------------------------------------- render */

function render() {
  const open = [...todos.values()].filter((t) => !t.closedAt);
  const needs = open.filter((t) => t.status === "needs-you");
  const working = open.filter((t) => t.status === "working");
  const rest = open.filter((t) => t.status === "idle");
  const stopped = open.filter(
    (t) => !["needs-you", "working", "idle"].includes(t.status)
  );

  $queue.replaceChildren();

  if (!open.length) {
    $queue.append(el("div", { className: "empty", textContent: alice.empty }));
  }

  // `key` picks the character portrait CSS draws beside the heading.
  const group = (key, label, items, count) => {
    if (!items.length) return;
    const l = el("div", { className: `group-label g-${key}` }, label);
    if (count) l.append(el("span", { className: "count", textContent: String(items.length) }));
    $queue.append(l);
    for (const t of items) $queue.append(renderCard(t));
  };

  group("needs", alice.groupNeedsYou, needs, true);
  group("working", alice.groupWorking, working);
  group("resting", alice.groupResting, rest);
  group("stopped", alice.groupStopped, stopped);

  const closed = [...todos.values()].filter((t) => t.closedAt);
  $archiveSummary.textContent = `${alice.groupArchive} (${closed.length})`;
  $archive.replaceChildren();
  if (!closed.length) {
    $archive.append(el("div", { className: "empty empty-archive", textContent: alice.emptyArchive }));
  } else {
    $archive.append(
      el("div", { className: "row archive-tools" },
        confirmButton({
          label: alice.emptyHole,
          confirmLabel: alice.forgetConfirm,
          className: "danger ghost-danger",
          warn: alice.transcriptKept,
          run: async () => {
            const { ok, data } = await api("/api/archive/empty", {});
            if (ok) toast(alice.emptied(data.removed));
          },
        })
      )
    );
  }
  for (const t of closed) {
    const row = el("div", { className: `card ${t.status}` },
      el("div", { className: "card-head" },
        el("span", { className: "name", textContent: t.name ?? "session" }),
        el("span", { className: `badge ${t.status}`, textContent: t.status }),
        el("span", { className: "cwd mono", textContent: prettyCwd(t.cwd), title: t.cwd ?? "" })));
    const b = el("button", { className: "ghost", textContent: alice.reopen });
    b.onclick = async () => { await api(`/api/todos/${t.id}/reopen`, {}); toast(alice.reopened); };
    // Closing only dismisses, so an archived session may well still be alive.
    row.append(el("div", { className: "row" }, b, stopButton(t), forgetButton(t)));
    $archive.append(row);
  }

  // Make a pending update obvious even when the tab is in the background:
  // a count in the tab title, and a gold ring on the favicon.
  document.title = needs.length ? `(${needs.length}) ${alice.title}` : alice.title;
  document.getElementById("tagline").textContent =
    needs.length ? alice.needsYou(needs.length) : alice.tagline;
  setFavicon(needs.length > 0);
}

/* ------------------------------------------------------------------ wire */

const es = new EventSource("/api/events");
es.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  if (ev.type === "hello") {
    for (const t of ev.todos) todos.set(t.id, t);
  } else if (ev.type === "todo") {
    todos.set(ev.todo.id, ev.todo);
  } else if (ev.type === "removed") {
    todos.delete(ev.id);
    logs.delete(ev.id);
    logFetched.delete(ev.id);
    if (openId === ev.id) openId = null;
  } else {
    const entry = logEntry(ev);
    if (entry) log(ev.todoId, entry.who, entry.text);
  }
  render();
};

const dialog = document.getElementById("new-dialog");
const newForm = document.getElementById("new-form");

document.getElementById("new-btn").onclick = () => dialog.showModal();

// Three ways out: the ✕, "Never mind", and Esc (which <dialog> gives us free).
const dismiss = () => {
  newForm.reset();
  dialog.close();
};
document.getElementById("new-dismiss").onclick = dismiss;
dialog.addEventListener("cancel", () => newForm.reset()); // Esc

// Clicking the backdrop lands on the dialog element itself, not its contents.
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dismiss();
});

newForm.onsubmit = async (e) => {
  if (e.submitter?.value === "cancel") return dismiss();
  const cwd = newForm.cwd.value.trim();
  const prompt = newForm.prompt.value.trim();
  const name = newForm.sessionName.value.trim();
  const model = newForm.sessionModel.value;
  if (!cwd || !prompt) return;
  newForm.reset();
  await api("/api/sessions", { cwd, prompt, name, model });
};


/* ------------------------------------------------------------ first paint */

const { data } = await api("/api/todos");
for (const t of data.todos ?? []) todos.set(t.id, t);
render();
