// The Tea Party's guest list, without Slack or a model.
//
//   node test/slack.mjs
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dmItems, threadCandidates, threadItem, cleanText, shapeVerdict, threadTsOf,
  createSlackWatcher, verdictPrompt,
} from "../server/slack.js";

const ME = "UME";
let failures = 0;
function check(name, ok, detail = "") {
  if (ok) return;
  failures++;
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
}

const hit = (over) => ({
  author_name: "Nishant", author_user_id: "UNB", channel_id: "D1", channel_name: "",
  message_ts: "100.0", content: "hi", is_author_bot: false,
  permalink: "https://x.slack.com/archives/D1/p100", content_type: "message", ...over,
});

/* -------------------------------------------------------------------- DMs */

{
  const items = dmItems([
    // D1: they spoke last — waiting on you
    hit({ message_ts: "100.0", author_user_id: ME, author_name: "Me", content: "can you look?" }),
    hit({ message_ts: "200.0", content: "sure, but which PR?" }),
    hit({ message_ts: "210.0", content: "the <https://ghe/pull/1|pull/1> one, <@UME>?" }),
    // D2: you spoke last — not waiting
    hit({ channel_id: "D2", message_ts: "300.0", content: "ping" }),
    hit({ channel_id: "D2", message_ts: "310.0", author_user_id: ME, author_name: "Me", content: "pong" }),
    // D3: a bot — set aside unless asked for
    hit({ channel_id: "D3", message_ts: "400.0", is_author_bot: true, author_name: "Jira" }),
    // D1, but in a thread: its own conversation, and you answered it
    hit({ message_ts: "150.0", permalink: "https://x/p150?thread_ts=120.0&cid=D1" }),
    hit({ message_ts: "160.0", author_user_id: ME, permalink: "https://x/p160?thread_ts=120.0&cid=D1" }),
    // a file, not a message
    hit({ channel_id: "D4", content_type: "file" }),
  ], ME, { names: { UME: "Kun" } });

  check("only the DM waiting on you is listed", items.length === 1 && items[0].channelId === "D1",
    JSON.stringify(items.map((i) => i.key)));
  const d1 = items[0];
  check("a DM carries only what they said since you last spoke", d1?.messages.length === 2,
    JSON.stringify(d1?.messages));
  check("Slack markup is cleaned for reading", d1?.messages.at(-1).text === "the pull/1 one, @Kun?", d1?.messages.at(-1).text);
  check("the item points at the latest message", d1?.latestTs === "210.0");
  check("bots are included when asked",
    dmItems([hit({ channel_id: "D3", is_author_bot: true })], ME, { includeBots: true }).length === 1);
}

/* ---------------------------------------------------------------- threads */

check("thread_ts comes out of the permalink",
  threadTsOf({ permalink: "https://x/p2?thread_ts=1792011256.738679&cid=C1" }) === "1792011256.738679");

{
  const cands = threadCandidates({
    mentions: [
      hit({ channel_id: "C1", channel_name: "infra", message_ts: "500.0", permalink: "https://x/p500?thread_ts=480.0&cid=C1" }),
      hit({ channel_id: "C2", channel_name: "ops", message_ts: "300.0", permalink: "https://x/p300" }),
    ],
    mine: [
      // the same thread as the first mention: one candidate, not two
      hit({ channel_id: "C1", author_user_id: ME, message_ts: "490.0", permalink: "https://x/p490?thread_ts=480.0&cid=C1" }),
      // a top-level post with no replies isn't waiting on anyone
      hit({ channel_id: "C3", author_user_id: ME, message_ts: "600.0", permalink: "https://x/p600" }),
      // a top-level post with replies is a thread you started
      hit({ channel_id: "C4", author_user_id: ME, message_ts: "50.0", reply_count: 3, permalink: "https://x/p50" }),
    ],
  });
  const keys = cands.map((c) => c.key);
  check("threads are deduplicated and lonely posts skipped",
    JSON.stringify(keys) === JSON.stringify(["thread:C1:480.0", "thread:C2:300.0", "thread:C4:50.0"]), JSON.stringify(keys));
  check("a thread knows both that you were mentioned and that you posted",
    cands[0].mentionTs === 500 && cands[0].mine === true, JSON.stringify(cands[0]));

  const m = (user, ts, text = "…") => ({ user, ts, text });
  const names = { UNB: "Nishant", UAK: "Ajay" };

  const answered = threadItem(cands[0], [m("UAK", "480.0"), m("UNB", "500.0", `<@${ME}> thoughts?`), m(ME, "510.0", "yes")], ME, { names });
  check("a mention you've replied to isn't waiting", answered === null);

  const unanswered = threadItem(cands[1], [m("UNB", "300.0", `review please <@${ME}>`), m("UAK", "320.0", "+1")], ME, { names });
  check("a mention with nothing from you since is waiting", unanswered?.kind === "mention", JSON.stringify(unanswered));
  check("names are resolved in a thread", unanswered?.from === "Ajay" && unanswered?.people.join() === "Nishant,Ajay");

  const yours = threadItem(cands[2], [m(ME, "50.0", "proposal"), m("UAK", "60.0", "what about X?")], ME, { names });
  check("a thread you're in, where someone else spoke last, is waiting", yours?.kind === "thread");
  check("the parent is kept for context when it isn't theirs", yours?.parent?.text === "proposal",
    JSON.stringify(yours?.parent));

  const strangers = threadItem({ ...cands[1], mentionTs: null, mine: false }, [m("UNB", "1.0"), m("UAK", "2.0")], ME, { names });
  check("a thread you're neither in nor mentioned in isn't yours", strangers === null);

  const mentionedLongAgo = threadItem({ ...cands[1], mentionTs: "1.0", mine: false },
    [m("UNB", "1.0", `<@${ME}>`), m(ME, "2.0", "on it"), m("UAK", "3.0", "thanks!")], ME, { names });
  check("a thread you've since spoken in is judged on what came after", mentionedLongAgo?.kind === "thread",
    JSON.stringify(mentionedLongAgo));

  const prompt = verdictPrompt(unanswered);
  check("the verdict prompt fences Slack content off", prompt.startsWith("<slack") && prompt.includes("</slack>"));
}

/* ------------------------------------------------------------------ verdicts */

{
  const yes = shapeVerdict("Needs you: yes\nNishant wants a review of PR #22036.");
  check("a yes verdict parses", yes.needsYou === true && yes.text === "Nishant wants a review of PR #22036.", JSON.stringify(yes));
  const no = shapeVerdict("Needs you: No.\nThey said thanks.");
  check("a no verdict parses", no.needsYou === false);
  const unsure = shapeVerdict("Ajay asked something.");
  check("a verdict that doesn't say is null, not no", unsure.needsYou === null && unsure.text === "Ajay asked something.");
}

check("cleanText handles channels and specials",
  cleanText("see <#C1|infra> <!here> &amp; <https://a.b>") === "see #infra @here & https://a.b");
check("cleanText handles user groups",
  cleanText("hi <!subteam^S057GJQLV7D> and <!subteam^S1|@apollo>") === "hi @team and @apollo",
  cleanText("hi <!subteam^S057GJQLV7D> and <!subteam^S1|@apollo>"));

/* ------------------------------------------------------------------ watcher */

const dir = await mkdtemp(join(tmpdir(), "wonderland-slack-"));
try {
  // A fake Slack whose conversation can be moved on between checks.
  let dms = [hit({ message_ts: "200.0", content: "can you review?" })];
  const calls = [];
  const fakeSlack = () => ({
    async call(tool, args) {
      calls.push(tool);
      if (tool === "get-current-user") return { authContext: { user_id: ME } };
      if (tool === "search") return args.channelTypes === "im,mpim" ? dms : [];
      return { messages: [] };
    },
    close() {},
  });
  const events = [];
  let judged = 0;
  const w = createSlackWatcher({
    broadcast: (e) => events.push(e),
    open: fakeSlack,
    judge: async () => { judged++; return "Needs you: yes\nA review."; },
    file: join(dir, "slack.json"),
    enabled: true,
    verdicts: true,
  });

  const first = w.check();
  check("a check in progress says so", events.at(-1)?.slack.checking === true, JSON.stringify(events.at(-1)?.slack));
  await first;
  check("a finished check says so", events.at(-1)?.slack.checking === false);
  await new Promise((r) => setTimeout(r, 20)); // verdicts land after the check
  let snap = w.snapshot();
  check("the watcher lists the waiting DM", snap.items.length === 1, JSON.stringify(snap.items));
  check("Alice's verdict is attached", snap.items[0]?.needsYou === true && snap.items[0]?.summary === "A review." && snap.items[0]?.triaged);
  check("who you are is asked once and remembered", calls.filter((c) => c === "get-current-user").length === 1);

  await w.check();
  await new Promise((r) => setTimeout(r, 20));
  check("an unchanged conversation isn't judged again", judged === 1, `judged ${judged} times`);
  check("who you are isn't asked again", calls.filter((c) => c === "get-current-user").length === 1);

  const id = snap.items[0].id;
  w.done(id);
  check("done hides it", w.snapshot().items.length === 0);

  await w.check();
  check("done survives a re-check with nothing new", w.snapshot().items.length === 0);

  // They say something else: back it comes, freshly read.
  dms = [...dms, hit({ message_ts: "300.0", content: "still there?" })];
  await w.check();
  await new Promise((r) => setTimeout(r, 20));
  snap = w.snapshot();
  check("a newer message brings a done conversation back", snap.items.length === 1 && snap.items[0].latestTs === "300.0");
  check("and it's read again", judged === 2 && snap.items[0].triaged);

  // A failing Slack is reported, not thrown.
  const broken = createSlackWatcher({
    broadcast() {}, open: () => ({ call: async () => { throw new Error("401 from conduit"); }, close() {} }),
    file: join(dir, "broken.json"), enabled: true, verdicts: false,
  });
  await broken.check();
  check("a Slack error is surfaced on the snapshot", /401/.test(broken.snapshot().error ?? ""), broken.snapshot().error);
  check("a check broadcasts before and after", events.filter((e) => e.type === "slack").length >= 2);
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures) process.exit(1);
console.log("PASS: slack triage — DMs, mentions, threads, verdicts, done-until-newer");
