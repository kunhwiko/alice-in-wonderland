// Everything Alice says lives here, so her tone is tunable in one place.
//
// She narrates the chrome — headers, empty states, buttons, confirmations.
// The one place she speaks about a session is her briefing (server/briefing.js),
// and that sits above the literal request, never in place of it: tool names,
// commands and diffs still render verbatim, in monospace.
export const alice = {
  title: "Alice in Wonderland",
  tagline: "Alice is minding your sessions, and your letters.",

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

  // Alice's desk: everything waiting on you, in one place, oldest first.
  deskWaiting: (n) => {
    const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
    const w = words[n] ?? String(n);
    return n === 1 ? `${w} of them is waiting on you.` : `${w} of them are waiting on you.`;
  },
  deskClear: "Nobody needs you just now.",
  deskBusy: (names) => `Still busy: ${names}.`,
  deskResting: (names) => `Resting: ${names}.`,
  deskTerminal: (n) =>
    n === 1
      ? "One in a terminal wants you too — I can't reach it from here."
      : `${n} in terminals want you too — I can't reach them from here.`,
  waitingFor: (ms) => {
    const m = Math.floor(ms / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `waiting ${m}m`;
    return `waiting ${Math.floor(m / 60)}h ${m % 60}m`;
  },
  deskAsks: "It's asking you —",
  deskTurnBack: "It's finished, and come back to you.",
  noted: "Noted",
  openCard: "Show me the card",

  briefingReading: "Let me have a look at what it's been up to…",
  briefingFailed: "I couldn't make sense of that one — you'll have to read it yourself.",
  // Under every briefing. She read things the session read, and anyone could
  // have written those — so she can be wrong, or be told to be.
  briefingCaveat: "That's only my reading of it — the request itself is what you're deciding.",
  briefingCaveatTurn: "That's only my reading of it — its own words are in the log.",

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

  // Interrupt and stop are deliberately unalike: one is a tap on the shoulder,
  // the other is the Queen. Nothing about "Off with its head!" should suggest
  // you can pick the head back up.
  interrupt: "That will do",
  // Not `interrupted` — that one is the status copy for a session we lost.
  interruptToast: "Stopped where it stood. Say something and it carries on.",

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

  handover: "Hand it to a terminal",
  handoverConfirm: "Quite sure?",
  handoverWarn: "I'll let go of it first — anything it's in the middle of is lost.",
  handedOver: "It's yours now. I'll watch from here.",
  // Said when the handoff worked but the transcript couldn't be found: the
  // session is fine, the card just can't show the conversation.
  handedOverBlind: "It's yours now, but I can't find its transcript to read along.",
  watched: "It's in a terminal now. I'm reading along, but I can't put a word in.",
  watchedLog: "What it's said since I let go",

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

  // ---- the world --------------------------------------------------------
  districts: { tea: "The Tea Party", court: "The Queen's Court", hall: "The Hall of Doors" },
  districtHints: {
    tea: "Slack conversations waiting on you",
    court: "Sessions waiting on your word",
    hall: "Your MCP servers and skills",
  },
  panelWider: "Make it wider (or drag its edge)",
  panelNarrower: "Back to the usual size",
  panelGrip: "Drag to resize — double-click to switch between wide and usual",
  noWorld: "I can't draw Wonderland in this browser (no WebGL), but everything is still here — use the buttons above.",

  // What she says when she arrives somewhere with news. Short: it's a
  // speech bubble, and the panel has the detail.
  errandTea: (items) =>
    items.length === 1
      ? `A letter from ${items[0].item.from}!`
      : `${items.length} new letters at the Tea Party!`,
  errandCourt: (news) => {
    if (news.length > 1) return `${news.length} of them want you at Court!`;
    const { kind, todo } = news[0];
    const name = todo.name ?? "A session";
    if (kind === "question") return `${name} has a question for you.`;
    if (kind === "turn") return `${name} has finished, and come back to you.`;
    if (kind === "terminal") return `${name} wants you, in its terminal.`;
    return `${name} wishes to do something. May it?`;
  },
  errandHall: (news) =>
    news.length > 1
      ? `${news.length} doors won't open in the Hall!`
      : news[0].server.status === "needs-auth"
        ? `The door to ${news[0].server.name} is locked — it wants a key.`
        : `The door to ${news[0].server.name} is stuck fast.`,
  errandStart: "This has been waiting a while…",
  errandOnTheWay: ["Oh! I must go and see.", "Curiouser and curiouser…", "Oh dear, oh dear!", "Coming!"],

  // ---- the Tea Party: Slack ----------------------------------------------
  teaKindDm: "dm",
  teaKindMention: "mentioned",
  teaKindThread: "thread",
  teaDm: "a direct message",
  teaGroupDm: "a group message",
  teaReading: "Let me read this one…",
  teaOpen: "Open in Slack",
  teaDone: "Done with it",
  teaDoneToast: "Crossed off — until somebody says something new.",
  teaCheck: "Look again",
  teaChecking: "Looking…",
  teaChecked: (when) => `I last looked through Slack ${when}.`,
  teaFirstLook: "I'm having my first look through Slack…",
  teaNever: "I haven't looked through Slack yet.",
  teaOff: "Slack is turned off for now (WONDERLAND_SLACK=on brings it back).",
  teaError: (e) => `Something went wrong the last time I looked: ${e}`,
  teaEmpty: "Nobody's waiting on you in Slack. More tea?",
  teaEmptyYet: "Nothing yet — I'll set a place as soon as I've looked.",
  teaChatter: (n) => `Just chatter (${n}) — nobody's waiting on these`,

  // ---- the Hall of Doors: MCP servers and skills ------------------------
  hallDoors: "The doors",
  hallDoorsHint: "Your MCP servers, as Wonderland's own connection finds them.",
  hallBottles: "The bottles",
  hallBottlesHint: "Your skills. Yours and your projects' can be edited here.",
  hallReach:
    "A sign-in here is saved for every session. A reconnect reaches the sessions I run; a terminal that's already open needs /mcp to notice.",
  hallOff: "The Hall is turned off (WONDERLAND_HALL=off).",
  hallChecking: "I'm trying all the doors…",
  hallChecked: (when) => `I last tried the doors ${when}.`,
  hallCheck: "Try them all again",
  hallNoServers: "No MCP servers are set up at all.",
  hallError: (e) => `I couldn't get into the Hall: ${e}`,
  doorStatus: {
    connected: "Open",
    "needs-auth": "Locked — needs a sign-in",
    failed: "Stuck",
    pending: "Opening…",
    disabled: "Boarded up",
  },
  doorTools: (n) => `${n} tool${n === 1 ? "" : "s"}`,
  doorSource: {
    user: "yours", project: "project", local: "local", claudeai: "claude.ai",
    plugin: "plugin", managed: "managed", enterprise: "managed", dynamic: "dynamic",
  },
  authenticate: "Sign in",
  reconnect: "Reconnect",
  reconnecting: "Trying the door…",
  signingIn: "Waiting for you to sign in…",
  signInAgain: "Open the sign-in page again",
  signInBlocked: "Your browser stopped the sign-in page opening — use the link below.",
  reconnected: (r) =>
    r.ok
      ? r.sessions ? `Open again — and passed on to ${r.sessions} session${r.sessions === 1 ? "" : "s"}.` : "Open again!"
      : `Still won't open${r.reason ? `: ${r.reason}` : "."}`,
  skillScope: { user: "Yours", project: "In your projects", plugin: "From plugins", synced: "From claude.ai" },
  skillFilter: "Find a skill…",
  skillNone: "No skills match that.",
  skillEdit: "Edit",
  skillRead: "Read",
  skillReveal: "Show in Finder",
  skillSave: "Save it",
  skillCancel: "Never mind",
  skillSaved: "Saved. New sessions will use it.",
  skillReadOnly: (where) => `This one comes from ${where} — an update there would overwrite an edit here, so it's read-only.`,
  skillUnsaved: "You have unsaved changes to this skill.",
  skillNew: "A new skill",
  skillNewName: "What shall I call it? (lower-case, dashes)",
  skillNewWhat: "What is it for, and when should Claude use it?",
  skillNewGo: "Make it",
  skillFiles: (n) => `${n} more file${n === 1 ? "" : "s"} beside it`,

  // Carroll, 1865 — public domain, and as good a description of a work queue
  // as anyone has managed since.
  quote: "“Begin at the beginning, and go on till you come to the end: then stop.”",
  quoteSource: "The King — Alice's Adventures in Wonderland",
};
