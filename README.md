# Wonderland

A localhost queue for your Claude Code sessions, tended by Alice.

One page that shows every session wanting your attention, and lets you answer it
inline instead of cycling through terminal tabs.

```bash
npm install
npm start          # http://127.0.0.1:7777
```

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

## Two kinds of card

| | Owned | External |
|---|---|---|
| Started by | Wonderland's "Shall we begin?" | `claude` in a terminal |
| Chat inline | yes | no |
| Approve/deny inline | yes | no |
| Shows up via | the SDK message stream | the `Notification` hook |
| What you get | full conversation | a `claude --resume <id>` to copy |

External sessions exist so a session you start out of habit isn't invisible.
They can't be chatted with, and the UI says so rather than pretending.

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
public/
  app.js        SSE client and rendering, no build step
  alice.js      every string Alice says, in one object
data/todos.json state (gitignored)
```

No database and no build step. Conversation content is never duplicated —
Wonderland stores only TODO metadata, and Claude's transcript stays the source
of truth.

## Artwork

Five picture slots in `public/characters/`, named for the role they play so the
artwork can change without the filenames going stale: `front` (masthead),
`waiting`, `busy`, `rest`, and `empty`. Originals as supplied are kept in
`assets/`.

```bash
bin/set-character.sh <front|waiting|busy|rest|empty> <file-or-url>
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

Persona only; no API calls, no cost. She narrates the chrome — headers, empty
states, buttons. She never paraphrases Claude's output: tool names, commands and
file contents render verbatim in monospace. A permission card shows the literal
`command` string, never Alice's version of it.

Retune her in `public/alice.js`.

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
