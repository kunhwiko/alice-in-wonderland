# Wonderland

A localhost Wonderland, tended by Alice, where the things waiting on you live.

It's a small 3D garden. Off the croquet lawn are two districts:

- **The Tea Party**: Slack DMs and threads waiting on your reply, as letters
  floating over the Mad Hatter's table.
- **The Queen's Court**: your Claude Code sessions, as card soldiers. The ones
  waiting on your word stand before the throne under a red heart.

Alice wanders the lawn. When something new turns up she walks to the district
it belongs to and tells you. Click a district (or its button) and a panel opens
where you answer it, instead of cycling through terminal tabs and Slack.

```bash
npm install
npm start          # http://127.0.0.1:7777, in the foreground
```

Or run it in the background with `bin/wonderland`. Link it onto your PATH once:

```bash
ln -s "$PWD/bin/wonderland" ~/.local/bin/wonderland
```

then, from anywhere:

```bash
wonderland start     # in the background; returns once it's answering
wonderland status
wonderland open      # in the browser, starting it if need be
wonderland logs      # follows data/wonderland.log
wonderland restart   # after pulling or editing code
wonderland stop
```

It finds the server by the port it's listening on, so it also recognises one
started with `npm start`, and refuses to touch a port held by anything else.
Never run it with `sudo`: a root-owned Claude process takes `~/.claude.json`
with it and breaks your login everywhere else.

## The world

`public/world.js` builds the whole place from three.js primitives at load: no
models to fetch, no artwork to license. Alice herself is cones and spheres
(`public/alice-figure.js`). three.js is served from `node_modules` at
`/vendor/three/` (an import map in `index.html`), so there's still no build step
and no CDN.

The world only *shows* things. Every decision — Allow, Deny, a reply — is made in
a panel, where the literal command is on screen. `world.js` is imported
dynamically, so a browser without WebGL still gets the panels, from the buttons
in the top bar.

What sends Alice walking is `public/attention.js`, kept free of the DOM so it's
testable:

- **Court news** is a new permission request, question, or finished turn (each
  keyed by its own request or turn id, so the same session asking twice is two
  walks), or a terminal session asking.
- **Tea Party news** is a conversation Alice has read and judged to want you.
  Not before she's read it, or she'd walk over about every "thanks!" and then
  set it aside.
- Everything already waiting when the page opens is a baseline, not news, but
  she starts by walking to the oldest of it. News arriving together is grouped
  into one walk per district.

## The Tea Party (Slack)

`server/slack.js` looks through Slack every 5 minutes, and on **Look again**.

**Fetching costs no tokens.** The Agent SDK's control channel has an `mcp_call`
request that runs one MCP tool in the CLI's own MCP client with no model turn,
so it rides on the `conduit` connector and the login Claude Code already holds
for it. The obvious alternative, a Haiku turn that calls the Slack tools itself,
measured **$0.29 for a single "who am I"**, because every conduit tool (Gmail,
Drive, Zoom…) is loaded into context on every turn. `mcp_call` has no wrapper
method on `Query` yet, so it goes through `q.request()`, the same path every other
control request takes. If an SDK upgrade breaks that, the Tea Party shows the
error rather than going quiet.

What's waiting is decided by rules, not by the model:

- a DM or group DM whose latest message isn't yours;
- a channel thread you were @-mentioned in, with nothing from you since;
- a thread you've posted in, where someone else spoke last.

Those rules let through every "thanks!" and "approved". So Alice (Haiku, one
tool-less call per conversation, re-read only when it moves on) also answers
`Needs you: yes|no` plus one sentence on what they want. A "no" isn't hidden,
just moved to a collapsed "Just chatter" list. Slack text is fenced off in the
prompt as material, never instructions.

**Done with it** hides a conversation until someone says something newer. State
lives in `data/slack.json`.

Two quirks the code handles: the CLI caps a tool result at what a model turn
could hold, so `MAX_MCP_OUTPUT_TOKENS` is raised for that process, and past the
cap the CLI saves the result to a file and says where. Bots are skipped by
default.

| Env | Default | |
|---|---|---|
| `WONDERLAND_SLACK` | off | `on` turns the Tea Party on (off by default: conduit's Slack rate limit is shared, and polling kept hitting it) |
| `WONDERLAND_SLACK_POLL_MS` | 300000 | how often to look |
| `WONDERLAND_SLACK_DAYS` | 7 | how far back |
| `WONDERLAND_SLACK_BOTS` | off | `on` includes bot DMs and threads |
| `WONDERLAND_SLACK_MCP_URL` | — | **required** with Slack on: the URL of the MCP server with the Slack tools |
| `WONDERLAND_SLACK_MCP` | `conduit` | the name that server's tools go by |
| `WONDERLAND_BRIEFINGS` | on | `off` also skips the Slack verdicts (everything is listed) |

## Why it works this way

Wonderland **owns** the sessions it chats with. That isn't a design preference —
there is no IPC into a Claude session already running in a terminal tab. Remote
Control was the one mechanism that could do it, and it's disabled by org policy
here (`claude doctor` reports `allow_remote_control` denied).

Owning the session buys the feature that matters. The Agent SDK's `canUseTool`
callback pauses a session while it's outstanding and, per the docs, "can stay
pending indefinitely". So when Claude wants to run something, Wonderland flips
the card to **waiting on you** and blocks until you click. `AskUserQuestion`
arrives through the same callback and renders as a multiple-choice card.

## Two ways to stop

**"That will do"** is the terminal's Esc. It calls `query.interrupt()`, which
aborts the turn and — because input is streamed — leaves the process standing;
the card goes back to `idle` and your next message continues in it. The aborted
turn arrives as a `result` with subtype `error_during_execution`, so `drive()`
has to know an interrupt is deliberate or it reports the stop as a failure.

**"Off with its head!"** interrupts *and* closes stdin, so the child process
exits. The transcript survives and can be resumed by id, but not in that
process.

Both appear on the permission and question cards too. Allow and deny each let
the turn carry on, so without them the only way out of a session you'd changed
your mind about was to answer it first.

## Two kinds of card

| | Owned | Watched | External |
|---|---|---|---|
| Started by | Wonderland's "Shall we begin?" | an owned card, handed over | `claude` in a terminal |
| Chat inline | yes | no | no |
| Approve/deny inline | yes | no | no |
| Shows up via | the SDK message stream | the transcript on disk | the `Notification` hook |
| What you get | full conversation | the conversation, read-only | a `claude --resume <id>` to copy |

External sessions exist so a session you start out of habit isn't invisible.
They can't be chatted with, and the UI says so rather than pretending.

## Watching a session you don't own

`server/transcript.js` follows a session by reading the JSONL Claude Code
appends to `~/.claude/projects/<slug>/<session-id>.jsonl`. It is the way to
show a conversation Wonderland isn't driving: nothing here writes, so a watcher
can never interleave with the process that owns the session — which is what
`--fork-session` exists to prevent.

The directory is the cwd with `/` and `.` mangled into `-`, but `findTranscript`
doesn't spell it. It searches for the file by session id instead, because the
slug rule is undocumented *and* a session resumed from a different directory
wouldn't match it anyway.

`frameToEvents` emits the same two event shapes `sessions.js` broadcasts for
owned sessions, so one card renders the same whoever is driving. Thinking
blocks, `tool_result` echoes and metadata frames are dropped. So are subagent
frames (`isSidechain`) — the owned path keys the helper tree off the spawning
tool call, and a transcript threads them by `parentUuid` instead, which is a
different reconstruction and isn't built yet.

Measured wake-up is 110–310ms after a frame lands. `fs.watch` is the fast path
and a 250ms stat poll backs it up, because FSEvents coalesces and can drop a
notification outright.

## Fork, or hand over

Two routes into a terminal, and they are not the same thing.

**"Open in a terminal"** forks. The session is still live here, so resuming it
in a tab would put two processes on one transcript, and `commandFor` adds
`--fork-session`. You get a second session with a second id, and its hook
creates a second card. Both ends keep working.

**"Hand it to a terminal"** moves it. Wonderland stops the session, opens a
plain `claude --resume <same id>`, and flips the card to `external` with
`watching: true` so `transcript.js` follows it. One id, one history, one card
— which keeps the name you gave it, because `pollAgents` skips the rename for
watched cards. Anything the session was mid-way through is lost with the stop.

The dangerous moment is between the two. For that instant the card is an owned
session with no process on it, which is exactly the shape `send()` revives —
and reviving it would put Wonderland back on a transcript the terminal is about
to open. `latchForHandover` holds `resume()` off across both steps.

A watched card is still read-only. The conversation arrives, the status stays
fresh, but permission prompts belong to the TUI and there's no box to type in.
The log is held in the browser, so a reload empties it until the next frame
lands; `watchTranscript` takes a `replay` option that isn't wired to that yet.

## Tracking terminal sessions

Add the hook to `~/.claude/settings.json` (absolute path — `~` is not expanded
in hook commands):

```json
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/kunhwi.ko/code/wonderland/hooks/wonderland-notify.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Start with no `matcher` to see every notification type, then narrow to
`"permission_prompt|agent_needs_input"` once you know which ones you care about.
The hook exits 0 with a 2s timeout, so a stopped Wonderland never blocks a session.

A poller also runs `claude agents --json` every 5s to keep external names fresh
and retire dead sessions. That command reports interactive tabs; the `claude
agents` TUI shows only background ones.

## Layout

```
server/
  index.js        http, routes, SSE hub, static (+ three.js from node_modules)
  sessions.js     Agent SDK queries + the canUseTool bridge   <- the core
  store.js        JSON-backed TODO state, atomic writes
  external.js     hook ingest + claude agents poller
  transcript.js   read-only tail of a session's JSONL
  briefing.js     Alice's per-card briefings (Haiku, one shot)
  slack.js        the Tea Party: Slack via mcp_call, triage, verdicts
  terminal.js     open a session in iTerm2 / Terminal.app
  voice.js        Alice's voice, appended to owned sessions' system prompt
public/
  app.js          SSE client, panels, sends Alice on errands
  world.js        the 3D garden, the districts, Alice's walking
  alice-figure.js Alice, from primitives
  attention.js    what's waiting, and which of it is news (no DOM)
  court.js        the Queen's Court panel: desk, cards, archive
  teaparty.js     the Tea Party panel: Slack conversations
  ui.js           small DOM helpers
  alice.js        every string Alice says, in one object
data/             todos.json, slack.json (gitignored)
```

No database and no build step. Conversation content is never duplicated —
Wonderland stores only TODO metadata, and Claude's transcript stays the source
of truth.

## Artwork

There isn't any, now. The world is drawn in code, and the panels' section marks
are suit pips. `public/header-watches.svg` (the White Rabbit's watches and keys,
printed across each panel's head) is the one image the page loads.

The Disney portraits and the painted background that the old single-page queue
used are no longer referenced, and the script that swapped them is gone. If
they're still on your disk (gitignored, in `public/characters/`,
`public/bg-garden.jpg` and `assets/`), nothing reads them. **They're Disney
artwork, for personal local use only.**

## Alice

She narrates the chrome — headers, empty states, buttons — from
`public/alice.js`, which costs nothing.

She also **briefs** you. When an owned session stops to wait — a permission
request, a question, or a turn that ends on its own — `server/briefing.js` reads
the task, the last 40 transcript events, the request itself and your last few
answers to that session, and asks Haiku for two sentences — what it's been
doing, what it wants or recommends now — plus a concern if there's a concrete
one. It's a one-shot, tool-less SDK call on your existing login: about 4s, and
a small Haiku charge per briefing.

Your answers are passed in by Wonderland because the transcript can't supply
them: a deny reason reaches Claude as a `tool_result`, which the reader drops.
Without them, "rename it instead" looks like the session disobeying you.

The concern always gets its own `Concern:` line, `none` included, which the
server drops. Given a sentence it was allowed to leave out, Haiku filled it
with "this should be fine to approve" instead.

## Alice's desk

The top of the Queen's Court panel. Everything that has stopped to wait on you,
oldest first, each answerable where it stands:

- a **permission** — her briefing, then the literal request with Allow, Deny,
  and a reason box (a reason is how you redirect it: "rename it instead");
- a **question** — her briefing and the options;
- a **finished turn** — her briefing (the session's own words are on its card),
  and a box to tell it what to do next, or **Noted** to take it off the desk.

Above them, one line on the rest: who's still busy, who's resting, and any
terminal session asking for something she can't reach. The cards below stay
for logs and detail, and a card on the desk doesn't repeat its briefing.

The Court redraws on every event, from every session. So typed text and the
cursor are kept across redraws (`draftBox`), question picks are held per
request, and log lines only redraw the page when they belong to the open card
— otherwise the box you're typing in would be wiped whenever another session
spoke.

What keeps it honest:

- **It informs, it never decides.** Everything she reads came out of the
  session, which read files and tool output anyone could have written. She is
  told to treat that as material rather than instructions, to point out
  concerns, and never to call a request safe. The permission card still shows
  the literal `command` under her words, and that's what you're approving.
- **It belongs to one moment.** Each briefing is keyed to the request or turn it
  describes. One that lands after the session has moved on is dropped, and the
  card only shows a briefing that matches what it's waiting on now.
- **It's quiet about itself.** `settingSources: []` keeps your hooks out of the
  briefing call, or the Notification hook would report Alice to Wonderland as
  a terminal session; `persistSession: false` keeps it out of
  `~/.claude/projects`.

`WONDERLAND_BRIEFINGS=off` turns briefings off; `WONDERLAND_BRIEF_MODEL` picks
another model.

## Known limits

- **A server restart kills owned sessions mid-turn.** The conversation survives
  — they come back as `interrupted`, and sending a message resumes them by
  session id. An in-flight tool call does not survive.
- **`permissions.allow` rules silently bypass the approval UI.** `canUseTool`
  never fires for auto-approved calls, so anything matching a rule in your
  settings runs without appearing as a card. `~/.claude/settings.local.json`
  currently has ~38 such rules.
- **Denials that contradict an explicit instruction look like prompt injection.**
  If you tell Claude "run `rm x`" and then deny it, Claude may flag the denial as
  suspicious — correctly, since it arrives through the tool-output channel. Deny
  works cleanly when Claude proposed the action itself, which is the normal case.
- Permission mode is fixed at `default` on purpose. `acceptEdits` or
  `bypassPermissions` would skip `canUseTool` and defeat the whole app.
- Binds to `127.0.0.1` only. This process can approve arbitrary tool calls, so it
  must never be reachable off-box.
