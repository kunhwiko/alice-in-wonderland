// The Queen's Court: every session, and Alice's desk of the ones waiting on
// your word. This is the old single-page queue, moved into the Court's panel
// more or less as it was — the decisions it renders are the ones that run
// real commands, so it changed as little as the move allowed.
import { alice } from "/alice.js";
import { el, toast, api, SUITS } from "/ui.js";
import { deskItems, waitingTurn } from "/attention.js";

export const todos = new Map();
const logs = new Map(); // todoId -> [{who, text}]
let openId = null;

const $desk = document.getElementById("desk");
const $queue = document.getElementById("queue");
const $archive = document.getElementById("archive");
const $archiveSummary = document.getElementById("archive-summary");

/* ------------------------------------------------------------------ utils */

/** "claude-opus-5" -> "opus 5", for a badge that has to stay narrow. */
function shortModel(id) {
  return String(id).replace(/^claude-/, "").replace(/-(\d)/, " $1").replace(/-/g, ".");
}

/**
 * Paths in the card head are often absurd — a scratchpad cwd runs past 90
 * characters. Show the tail, keep the whole thing on hover.
 */
function prettyCwd(cwd) {
  if (!cwd) return "";
  const parts = cwd.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : cwd;
}

/**
 * Text you've typed, kept across renders.
 *
 * render() rebuilds the page from scratch on every event from every session,
 * so a plain input would be wiped — and lose focus — the moment some other
 * session said anything. Each box gets a key; its text lives here, and
 * render() puts the cursor back where it was.
 */
const drafts = new Map(); // key -> text
let draftEls = new Map(); // key -> the element showing it, rebuilt per render

function draftBox(tag, key, props = {}) {
  const n = el(tag, props);
  n.dataset.draft = key;
  n.value = drafts.get(key) ?? "";
  n.oninput = () => drafts.set(key, n.value);
  draftEls.set(key, n);
  return n;
}

/** Which box had the cursor, so the next render can hand it back. */
function captureFocus() {
  const a = document.activeElement;
  const key = a?.dataset?.draft;
  return key ? { key, start: a.selectionStart, end: a.selectionEnd } : null;
}

function restoreFocus(f) {
  const n = f && draftEls.get(f.key);
  if (!n) return;
  n.focus?.();
  n.setSelectionRange?.(f.start, f.end);
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

/**
 * The decision moment, framed as a decree. Rationale in style.css.
 *
 * Drawn in two places — on Alice's desk and in the open card — so `where`
 * keeps their typing apart.
 */
function renderPermission(todo, where = "card") {
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

  const reason = draftBox("input", `${where}:${p.id}:reason`, {
    className: "decree-reason", placeholder: alice.denyReason,
  });
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

/**
 * Answers picked so far, per request. Kept outside the render for the same
 * reason as drafts, and shared by the desk and the card: it's one question,
 * so picking on either shows on both.
 */
const picksByReq = new Map(); // pending id -> Map(question -> label | Set)

function renderQuestions(todo, where = "card") {
  const p = todo.pending;
  const questions = p.input?.questions ?? [];
  const wrap = el("div");
  if (!picksByReq.has(p.id)) picksByReq.set(p.id, new Map());
  const picks = picksByReq.get(p.id);

  questions.forEach((q, qi) => {
    const box = el("div", { className: "q" });
    box.append(el("div", { className: "qtext", textContent: q.question }));
    (q.options ?? []).forEach((opt) => {
      const picked = picks.get(q.question);
      const input = el("input", {
        type: q.multiSelect ? "checkbox" : "radio",
        // Radio groups are page-wide by name; the desk and the card each
        // draw this question, and must not steal each other's selection.
        name: `${where}-${p.id}-q${qi}`,
        value: opt.label,
        checked: picked instanceof Set ? picked.has(opt.label) : picked === opt.label,
      });
      input.onchange = () => {
        if (q.multiSelect) {
          const set = picks.get(q.question) ?? new Set();
          input.checked ? set.add(opt.label) : set.delete(opt.label);
          picks.set(q.question, set);
        } else {
          picks.set(q.question, opt.label);
        }
        // Mirror it onto the other copy of this question.
        render();
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
  const turn = waitingTurn(todo);
  return turn && b.key === `turn:${turn.id}` ? b : null;
}

/**
 * A box to tell the session what to do next. On the card and on the desk,
 * with separate drafts — so text typed in one isn't sent from the other.
 */
function replyBox(todo, where) {
  const key = `${where}:${todo.id}:reply`;
  const box = draftBox("textarea", key, { rows: 2, placeholder: alice.sendPlaceholder });
  const send = el("button", { className: "primary", textContent: alice.send });
  const submit = async () => {
    const text = box.value.trim();
    if (!text) return;
    drafts.delete(key);
    log(todo.id, "user", text);
    render();
    await api(`/api/todos/${todo.id}/message`, { text });
  };
  send.onclick = submit;
  box.onkeydown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  };
  return { box, send };
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

/** card elements by todo id, so the desk can scroll you to one */
let cardEls = new Map();

function renderCard(todo) {
  const card = el("div", { className: `card ${todo.status}` });
  cardEls.set(todo.id, card);
  // Printed in opposite corners, like a real card's index.
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
  // A card on the desk has its briefing there, right above the decision; once
  // it's off the desk (answered, or Noted) the card is where it lives.
  const briefing = onDeskIds.has(todo.id) ? null : renderBriefing(todo);
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
      body.append(el("div", { className: "row" }, terminalButton(todo), stopButton(todo)));
      card.append(body);
      return card;
    }

    body.append(el("div", { className: "sub", textContent: alice.external }));
    body.append(el("div", { className: "field-label", textContent: alice.externalHow }));
    // Built server-side, on every todo it sends: it knows whether a process
    // still holds this transcript, and so whether it needs --fork-session.
    const cmd = todo.resumeCommand;
    body.append(el("pre", { className: "tool mono", textContent: cmd }));
    const copy = el("button", { textContent: "Copy" });
    copy.onclick = () => navigator.clipboard.writeText(cmd).then(() => toast(alice.copied));
    body.append(el("div", { className: "row" }, copy, terminalButton(todo), stopButton(todo)));
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
    const { box, send } = replyBox(todo, "card");
    body.append(el("div", { className: "row" }, box));
    body.append(el("div", { className: "row" },
      send, interruptButton(todo), terminalButton(todo), stopButton(todo)));
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

/**
 * Ends the session and puts the card down the rabbit-hole. A card whose
 * session has already ended gets a plain one-click version: there's no head
 * left to take, and Bring it back undoes it.
 */
function stopButton(todo) {
  if (DEAD.includes(todo.status)) {
    const b = el("button", { className: "ghost", textContent: alice.putAway });
    b.onclick = async (e) => {
      e.stopPropagation();
      const { ok } = await api(`/api/todos/${todo.id}/stop`, {});
      if (ok) toast(alice.putAwayToast);
    };
    return b;
  }
  return confirmButton({
    label: alice.stop,
    confirmLabel: alice.stopConfirm,
    // Say plainly what's about to happen to somebody's terminal.
    warn: todo.kind === "external" ? alice.stopWarnTerminal : null,
    run: async () => {
      const { ok } = await api(`/api/todos/${todo.id}/stop`, {});
      if (ok) toast(alice.stopped);
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

/*
 * Into a real terminal tab. Two processes can't share one conversation, so a
 * session that's still running either moves (handover: one id, one card,
 * which reads along) or is forked (a second id, and a second card). Which is
 * yours to pick, so the button asks — and only then, since a session with
 * nothing running on it just opens.
 */

const handover = async (todo) => {
  const { ok, data } = await api(`/api/todos/${todo.id}/handover`, {});
  if (ok) toast(data.watching ? alice.handedOver : alice.handedOverBlind);
};

const openTerminal = async (todo, fork) => {
  const { ok } = await api(`/api/todos/${todo.id}/terminal`, { fork });
  if (ok) toast(fork ? alice.openedForked : alice.openedTerminal);
};

const $termDialog = document.getElementById("terminal-dialog");

function askTerminal(todo) {
  const owned = todo.kind === "owned";
  const choice = (label, className, run) => {
    const b = el("button", { type: "button", className, textContent: label });
    b.onclick = () => {
      $termDialog.close();
      run?.();
    };
    return b;
  };
  const why = (label, text) => el("p", {}, el("b", { textContent: label }), ` — ${text}`);

  document.getElementById("terminal-title").textContent = alice.terminalTitle;
  // A terminal session can't be moved: it's already in one.
  document.getElementById("terminal-why").replaceChildren(
    el("p", { textContent: owned ? alice.terminalWhyOwned : alice.terminalWhyExternal }),
    owned ? why(alice.moveIt, alice.moveItWhy) : null,
    why(alice.forkIt, alice.forkItWhy)
  );
  document.getElementById("terminal-choices").replaceChildren(
    choice(alice.neverMind, "ghost"),
    choice(alice.forkIt, owned ? "" : "primary", () => openTerminal(todo, true)),
    owned ? choice(alice.moveIt, "primary", () => handover(todo)) : null
  );
  $termDialog.showModal();
}

function terminalButton(todo) {
  if (!todo.sessionId) return null;
  const b = el("button", { textContent: alice.openTerminal });
  b.onclick = (e) => {
    e.stopPropagation();
    if (todo.live) return askTerminal(todo);
    // Nothing running on it. An owned one is still handed over rather than
    // just opened, or a message from here would revive it under the terminal.
    return todo.kind === "owned" ? handover(todo) : openTerminal(todo, false);
  };
  return b;
}

/* ------------------------------------------------------------ Alice's desk */

/** "waiting 4m" labels, ticked in place rather than by re-rendering the page. */
let waitEls = [];
/** todo ids on the desk this render, so their cards don't repeat the briefing */
let onDeskIds = new Set();

function renderDeskItem({ todo, kind, since }, i) {
  const item = el("div", { className: `desk-item desk-${kind}` });

  const wait = el("span", { className: "desk-wait", textContent: alice.waitingFor(Date.now() - since) });
  waitEls.push({ node: wait, since });
  const show = el("button", { className: "ghost desk-show", textContent: alice.openCard });
  show.onclick = () => {
    openId = todo.id;
    ensureLog(todo);
    render();
    cardEls.get(todo.id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  item.append(
    el("div", { className: "desk-head" },
      el("span", { className: "desk-num", textContent: `${i + 1}.` }),
      el("span", { className: "name", textContent: todo.name ?? "session" }),
      el("span", { className: "cwd mono", textContent: prettyCwd(todo.cwd), title: todo.cwd ?? "" }),
      wait,
      show),
    el("div", { className: "desk-task", textContent: todo.title ?? "" })
  );

  const briefing = renderBriefing(todo);
  if (briefing) item.append(briefing);

  if (kind === "permission") {
    item.append(renderPermission(todo, "desk"));
  } else if (kind === "question") {
    item.append(el("div", { className: "field-label", textContent: alice.deskAsks }));
    item.append(renderQuestions(todo, "desk"));
  } else {
    // Only Alice's summary here, to keep the desk short: its own words are
    // on the card, one click away.
    if (!briefing) item.append(el("div", { className: "sub", textContent: alice.deskTurnBack }));
    const { box, send } = replyBox(todo, "desk");
    const noted = el("button", { className: "ghost", textContent: alice.noted });
    noted.onclick = () => api(`/api/todos/${todo.id}/ack`, { turn: todo.lastTurn.id });
    item.append(el("div", { className: "row" }, box));
    item.append(el("div", { className: "row" }, send, noted));
  }
  return item;
}

function renderDesk(open) {
  waitEls = [];
  const items = deskItems(open);
  const onDesk = (onDeskIds = new Set(items.map((x) => x.todo.id)));

  const names = (list) => list.map((t) => t.name ?? "session").join(", ");
  const busy = open.filter((t) => t.status === "working");
  const resting = open.filter((t) => t.status === "idle" && t.kind === "owned" && !onDesk.has(t.id));
  const terminal = open.filter((t) => t.kind === "external" && t.status === "needs-you");

  const lines = [items.length ? alice.deskWaiting(items.length) : alice.deskClear];
  if (busy.length) lines.push(alice.deskBusy(names(busy)));
  if (resting.length) lines.push(alice.deskResting(names(resting)));
  if (terminal.length) lines.push(alice.deskTerminal(terminal.length));

  $desk.replaceChildren(
    el("div", { className: "desk-say" }, lines.join(" ")),
    ...items.map(renderDeskItem)
  );
  $desk.classList.toggle("has-items", items.length > 0);
}

setInterval(() => {
  for (const { node, since } of waitEls) node.textContent = alice.waitingFor(Date.now() - since);
}, 30_000);

/* ---------------------------------------------------------------- render */

function render() {
  const focus = captureFocus();
  draftEls = new Map();
  cardEls = new Map();

  const open = [...todos.values()].filter((t) => !t.closedAt);
  const needs = open.filter((t) => t.status === "needs-you");
  const working = open.filter((t) => t.status === "working");
  const rest = open.filter((t) => t.status === "idle");
  // Everything without a suit of its own has stopped, one way or another.
  const stopped = open.filter((t) => !(t.status in SUITS));

  $queue.replaceChildren();

  // Nothing at all to oversee, and the empty queue below says so already.
  if (open.length) {
    renderDesk(open);
    $desk.hidden = false;
  } else {
    onDeskIds = new Set();
    $desk.replaceChildren();
    $desk.hidden = true;
    $queue.append(el("div", { className: "empty", textContent: alice.empty }));
  }

  // `key` picks the suit CSS draws beside the heading.
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
    // Everything here has ended, except a card closed back when Close only
    // hid it: that one may still be running, and keeps its way to stop.
    const alive = !DEAD.includes(t.status);
    row.append(el("div", { className: "row" }, b, alive ? stopButton(t) : null, forgetButton(t)));
    $archive.append(row);
  }

  restoreFocus(focus);
}

/* ------------------------------------------------------------------ wire */

/**
 * One event from the SSE stream. Returns whether the Court needs redrawing:
 * a log line only shows on its open card, and with several sessions talking
 * at once, redrawing for each line would make the desk's buttons shift under
 * your cursor for nothing.
 */
export function ingest(ev) {
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
    if (!entry) return false;
    log(ev.todoId, entry.who, entry.text);
    return ev.todoId === openId;
  }
  return true;
}

export { render };
