# Wonderland

A localhost queue for your Claude Code sessions, tended by Alice.

One page that shows every session wanting your attention, and lets you answer it
inline instead of cycling through terminal tabs.

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
  index.js      http, routes, SSE hub, static
  sessions.js   Agent SDK queries + the canUseTool bridge   <- the core
  store.js      JSON-backed TODO state, atomic writes
  external.js   hook ingest + claude agents poller
  transcript.js read-only tail of a session's JSONL
  briefing.js   Alice's per-card briefings (Haiku, one shot)
  terminal.js   open a session in iTerm2 / Terminal.app
  voice.js      Alice's voice, appended to owned sessions' system prompt
public/
  app.js        SSE client and rendering, no build step
  alice.js      every string Alice says, in one object
data/todos.json state (gitignored)
```

No database and no build step. Conversation content is never duplicated —
Wonderland stores only TODO metadata, and Claude's transcript stays the source
of truth.

## Artwork

Picture slots in `public/characters/`, named for the role they play so the
artwork can change without the filenames going stale: `front` (masthead),
`waiting`, `busy`, `rest`, `stopped`, `archive`, `empty` (nothing in the queue)
and `empty-archive` (nothing down the rabbit-hole). Originals as supplied are
kept in `assets/`.

```bash
bin/set-character.sh <front|waiting|busy|rest|stopped|archive|empty|empty-archive> <file-or-url>
bin/set-character.sh waiting --restore
```

The page background is `public/bg-garden.jpg`, blurred behind a ~.78 cream veil
(`body::before` / `body::after`). The veil is what keeps text readable over a
busy painting — tune `--veil-a`/`--veil-b`, don't remove it. Text that sits
straight on the background carries a cream halo for the same reason.

`public/header-watches.svg` prints the White Rabbit's pocket watches, the little
key and stray hour marks across the masthead, over its white wash. It's a
216×88 tile, sized for that band specifically — the page-sized tile would only
ever show a sliver of one row in a strip that short.

**The images currently in the slots are Disney artwork, for personal local use
only.** Don't publish this repo or deploy it anywhere public without replacing
them. See `public/characters/CREDITS.md`.

## Alice

She narrates the chrome — headers, empty states, buttons — from
`public/alice.js`, which costs nothing.

She also **briefs** you. When an owned session stops to wait — a permission
request, a question, or a turn that ends on its own — `server/briefing.js` reads
the task, the last 40 transcript events and the request itself, and asks Haiku
for at most three sentences: what it's been doing, what it wants or
recommends now, and a concern if there's a concrete one. The briefing shows on
the collapsed card, so you can work down the queue without opening each log.
It's a one-shot, tool-less SDK call on your existing login: about 4s, and a
small Haiku charge per briefing.

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
