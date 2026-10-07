// The round trip: Wonderland -> terminal -> Wonderland.
//
// Covers the one decision that can corrupt something. A handed-over card whose
// session is missing from `claude agents --json` is ambiguous: either the tab
// has closed (take the session back) or it hasn't opened yet (wait). Getting
// that wrong the wrong way reclaims a session a terminal is about to hold, and
// then Wonderland resumes it underneath them — two processes, one transcript.
//
//   npm test
import { shouldReclaim, HANDOVER_GRACE_MS } from "../server/external.js";

let failures = 0;
function check(label, ok) {
  if (!ok) { console.error(`FAIL: ${label}`); failures++; }
}

const now = 1_000_000_000_000;

// An ordinary external card — a tab someone opened themselves. Wonderland
// never owned it and has no business claiming it.
check("a card that was never handed over is never reclaimed",
  shouldReclaim({ watching: false, seenInTerminal: true, handedOverAt: 0 }, now) === false);
check("watching undefined is not watching",
  shouldReclaim({ status: "gone" }, now) === false);
check("no todo at all is survivable",
  shouldReclaim(null, now) === false);

// The dangerous window: handed over a moment ago, `claude` not yet in the
// agent list. Reclaiming here would undo a handover mid-flight.
check("fresh handover, not yet seen — wait",
  shouldReclaim({ watching: true, seenInTerminal: false, handedOverAt: now - 3_000 }, now) === false);
check("just under the grace period — still wait",
  shouldReclaim({ watching: true, seenInTerminal: false, handedOverAt: now - (HANDOVER_GRACE_MS - 1) }, now) === false);

// Seen in the terminal, now gone from it. That's a closed tab.
check("seen in the terminal and now absent — reclaim",
  shouldReclaim({ watching: true, seenInTerminal: true, handedOverAt: now - 3_000 }, now) === true);
check("seen counts even long afterwards",
  shouldReclaim({ watching: true, seenInTerminal: true, handedOverAt: now - 86_400_000 }, now) === true);

// Never arrived. The tab failed to start, or claude died on launch. Don't
// strand the card as external forever.
check("past the grace period without ever appearing — reclaim",
  shouldReclaim({ watching: true, seenInTerminal: false, handedOverAt: now - (HANDOVER_GRACE_MS + 1) }, now) === true);
check("a missing handedOverAt reads as long ago, not as now",
  shouldReclaim({ watching: true, seenInTerminal: false }, now) === true);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("PASS: handover — reclaim waits out the open-tab window, and never takes an ordinary external card");
