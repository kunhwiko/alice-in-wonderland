// What's waiting on you, and which of it is news.
//
// No DOM and no three.js here, so the tests can import it as it stands. The
// Court panel uses deskItems to decide what goes on Alice's desk; app.js uses
// the rest to decide when she should walk somewhere.

/** The finished turn an idle card is waiting on you about, if any. */
export function waitingTurn(todo) {
  return todo.kind === "owned" && todo.status === "idle" && !todo.pending ? todo.lastTurn ?? null : null;
}

/**
 * Everything that's stopped to wait on you, and only that: a permission, a
 * question, or a turn that finished and came back. Owned sessions only —
 * they're the ones you can answer from here. Oldest first, since that's the
 * one that's been held up longest.
 */
export function deskItems(open) {
  const items = [];
  for (const t of open) {
    if (t.kind !== "owned") continue;
    if (t.pending && t.status === "needs-you") {
      items.push({ todo: t, kind: t.pending.kind, since: t.pending.askedAt ?? Date.now() });
      continue;
    }
    const turn = waitingTurn(t);
    if (turn && turn.id !== t.ackedTurn) items.push({ todo: t, kind: "turn", since: turn.at });
  }
  return items.sort((a, b) => a.since - b.since);
}

/** A terminal session asking for you: Alice can see it, but not answer it. */
const terminalAsking = (t) => t.kind === "external" && t.status === "needs-you";

/**
 * Who stands where at Court. Before the throne: everything on the desk, plus
 * terminal sessions asking. About the court: every other open session.
 */
export function lineup(todos) {
  const open = todos.filter((t) => !t.closedAt);
  const onDesk = new Set(deskItems(open).map((d) => d.todo.id));
  const waiting = open.filter((t) => onDesk.has(t.id) || terminalAsking(t));
  return { waiting, others: open.filter((t) => !waiting.includes(t)) };
}

/**
 * Court news: one entry per moment a session started waiting. Keyed by the
 * request, turn or notification, not the card, so the same session asking
 * twice is two pieces of news — and a card merely changing isn't any.
 */
export function courtNews(todos) {
  const open = todos.filter((t) => !t.closedAt);
  const news = deskItems(open).map(({ todo, kind, since }) => ({
    key: kind === "turn" ? `turn:${todo.lastTurn.id}` : `req:${todo.pending.id}`,
    district: "court", kind, todo, since,
  }));
  for (const t of open.filter(terminalAsking)) {
    const since = t.askedAt ?? t.createdAt ?? 0;
    news.push({ key: `ext:${t.id}:${since}`, district: "court", kind: "terminal", todo: t, since });
  }
  return news;
}

/**
 * Tea Party news: a conversation that wants you, once Alice has read it. Not
 * before — she'd walk over about every "thanks!" and then quietly set it
 * aside. Keyed by its latest message, so a new reply is new news.
 */
export function teaNews(slack) {
  return (slack?.items ?? [])
    .filter((i) => i.triaged && i.needsYou !== false)
    .map((i) => ({ key: `slack:${i.id}:${i.latestTs}`, district: "tea", kind: i.kind, item: i, since: Number(i.latestTs) * 1000 }));
}

/**
 * Hall news: a door that won't open — locked, or stuck. Keyed by the door and
 * how it's shut, so it's news when it shuts, not on every look that finds it
 * still shut. One being tried right now isn't news: you're the one trying it.
 */
export function hallNews(hall, now = Date.now()) {
  return (hall?.servers ?? [])
    .filter((s) => (s.status === "needs-auth" || s.status === "failed") && !s.busy)
    .map((s) => ({ key: `door:${s.name}:${s.status}`, district: "hall", kind: s.status, server: s, since: hall.checkedAt ?? now }));
}

/**
 * Remembers what's been seen, and hands back only what hasn't. The first look
 * is a baseline — everything already there when the page opens is old news —
 * but it reports the oldest of it, so Alice can start the day there.
 */
export function createNoticer() {
  const seen = new Set();
  let primed = false;
  return {
    notice(news) {
      const fresh = news.filter((n) => !seen.has(n.key));
      for (const n of fresh) seen.add(n.key);
      if (!primed) {
        primed = true;
        const oldest = [...news].sort((a, b) => a.since - b.since)[0] ?? null;
        return { fresh: [], oldest };
      }
      return { fresh, oldest: null };
    },
  };
}
