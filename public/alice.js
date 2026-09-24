// Everything Alice says lives here, so her tone is tunable in one place.
//
// She narrates the chrome only — headers, empty states, buttons, confirmations.
// She never paraphrases Claude's output, and never restates a command: tool
// names, commands and diffs render verbatim, in monospace, elsewhere.
export const alice = {
  title: "Alice in Wonderland",
  tagline: "Alice is minding your sessions.",

  empty: "Curiouser and curiouser — nobody needs me at all just now.",
  emptyArchive: "Nothing down the rabbit-hole yet.",

  needsYou: (n) =>
    n === 1 ? "One of them is waiting on you!" : `${n} of them are waiting on you!`,
  groupNeedsYou: "Waiting on you",
  groupWorking: "Terribly busy",
  groupResting: "Resting",
  // Split out from Resting: a dead session under a heading that says "resting"
  // reads as fine when it isn't.
  groupStopped: "Quite stopped",
  groupArchive: "Down the rabbit-hole",

  helpers: "Helpers it sent off",
  helperCount: (n, running) =>
    running ? `${running} of ${n} still out` : `${n} helper${n === 1 ? "" : "s"}`,
  helperRunning: "still off about it",
  helperDone: "back again",
  helperNoText: "said nothing yet",

  working: "It's terribly busy. Best not to interrupt.",
  resting: "Resting, and rather pleased with itself.",
  interrupted: "Oh dear — I lost hold of this one. Say something and I'll fetch it back.",
  failed: "Something went dreadfully wrong.",
  gone: "It's wandered off entirely.",

  askAllow: "May it?",
  decreeRun: "It wishes to run —",
  decreeDo: "It wishes to —",
  allow: "Oh, do let it",
  deny: "Certainly not",
  denyReason: "Tell it why not (optional)",
  submitAnswers: "There, that's settled",

  close: "Close",
  reopen: "Bring it back",
  closed: "Down the rabbit-hole it goes.",
  reopened: "Back again! How very odd.",

  forget: "Forget it entirely",
  forgetConfirm: "Quite sure?",
  forgotten: "Gone, as if it never was.",
  emptyHole: "Empty the rabbit-hole",
  emptied: (n) => `${n} gone, as if they never were.`,
  transcriptKept: "The conversation itself stays on disk.",

  stop: "Off with its head!",
  stopConfirm: "Quite sure?",
  stopped: "And that was the end of it.",
  stopWarnTerminal:
    "This one lives in a terminal — stopping it closes Claude in that tab.",
  notRunning: "It isn't running. Nothing to stop.",

  openTerminal: "Open in a terminal",
  openedTerminal: "There — through the looking-glass.",
  openedForked: "It's still running here, so I opened a branch of it instead.",
  external: "That one's off in the looking-glass — I can't reach it from here.",
  externalHow: "Open it in a terminal instead:",
  copied: "Copied!",

  newSession: "Shall we begin?",
  newSessionName: "What shall I call it? (optional — I'll name it after the folder)",
  newSessionModel: "Which mind shall it use?",

  // Empty id = pass nothing, so Claude Code resolves its own default. Your
  // org's managed settings currently pin that to Sonnet 5.
  models: [
    { id: "", label: "Whatever it usually uses (Sonnet 5 here)" },
    { id: "claude-opus-5", label: "Opus 5 — the capable one" },
    { id: "claude-sonnet-5", label: "Sonnet 5 — quick and cheap" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5 — quickest, 200K context" },
    { id: "claude-fable-5-1", label: "Fable 5.1 — most capable, priciest" },
  ],
  newSessionWhere: "Where shall I work? (a folder)",
  newSessionWhat: "And what shall I do?",
  newSessionGo: "Off we go!",

  send: "Say something",
  sendPlaceholder: "Tell it what to do next…",
  thinking: "Thinking…",

  // Carroll, 1865 — public domain, and as good a description of a work queue
  // as anyone has managed since.
  quote: "“Begin at the beginning, and go on till you come to the end: then stop.”",
  quoteSource: "The King — Alice's Adventures in Wonderland",
};
