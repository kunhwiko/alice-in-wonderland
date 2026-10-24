// The Tea Party's panel: Slack conversations waiting on you.
//
// Everything in an item came from Slack, written by other people, so it's
// set with textContent and never as markup. Alice's line on each is her
// reading of it; the messages under it are what was actually said.
import { alice } from "/alice.js";
import { el, api, toast, ago } from "/ui.js";

const $status = document.getElementById("tea-status");
const $list = document.getElementById("tea-list");

let slack = null;
let chatterOpen = false;

export function setSlack(s) {
  slack = s;
}

export function getSlack() {
  return slack;
}

/** The conversations to show as waiting: the ones Alice hasn't set aside. */
export function waiting(s = slack) {
  return (s?.items ?? []).filter((i) => i.needsYou !== false);
}

const KIND = { dm: alice.teaKindDm, mention: alice.teaKindMention, thread: alice.teaKindThread };

function renderItem(item, { quiet = false } = {}) {
  const card = el("div", { className: `invite invite-${item.kind}${quiet ? " quiet" : ""}` });
  const where = item.kind === "dm"
    ? (item.people.length > 1 ? alice.teaGroupDm : alice.teaDm)
    : `#${item.channelName ?? "channel"}`;
  const who = item.people.length ? item.people.join(", ") : item.from;

  card.append(
    el("div", { className: "invite-head" },
      el("span", { className: `badge kind-${item.kind}`, textContent: KIND[item.kind] ?? item.kind }),
      el("span", { className: "name", textContent: who }),
      el("span", { className: "invite-where", textContent: where }),
      el("span", { className: "invite-when", textContent: ago(Date.now() - Number(item.latestTs) * 1000) }))
  );

  if (item.summary) {
    card.append(el("div", { className: "briefing ready" },
      el("div", { className: "briefing-text", textContent: item.summary })));
  } else if (!item.triaged) {
    card.append(el("div", { className: "briefing reading" },
      el("div", { className: "briefing-text", textContent: alice.teaReading })));
  }

  if (!quiet) {
    if (item.parent) {
      card.append(el("div", { className: "invite-parent" },
        el("span", { className: "who", textContent: item.parent.from }),
        el("span", { textContent: item.parent.text })));
    }
    const said = el("div", { className: "invite-said" });
    for (const m of item.messages.slice(-3)) {
      said.append(el("div", { className: "said" },
        el("div", { className: "who", textContent: m.from }),
        el("div", { className: "text", textContent: m.text })));
    }
    card.append(said);
  }

  const open = el("a", {
    className: "button primary", href: item.permalink, target: "_blank", rel: "noopener noreferrer",
    textContent: alice.teaOpen,
  });
  const done = el("button", { className: "ghost", textContent: alice.teaDone });
  done.onclick = async () => {
    done.disabled = true;
    const { ok } = await api(`/api/slack/${item.id}/done`, {});
    if (ok) toast(alice.teaDoneToast);
    else done.disabled = false;
  };
  card.append(el("div", { className: "row" }, open, done));
  return card;
}

export function renderTea() {
  const s = slack;
  const check = el("button", { className: "ghost", textContent: s?.checking ? alice.teaChecking : alice.teaCheck, disabled: Boolean(s?.checking) });
  check.onclick = async () => {
    check.disabled = true;
    await api("/api/slack/check", {});
  };

  let line;
  if (!s || !s.enabled) line = alice.teaOff;
  else if (s.checking && !s.checkedAt) line = alice.teaFirstLook;
  else if (s.checkedAt) line = alice.teaChecked(ago(Date.now() - s.checkedAt));
  else line = alice.teaNever;
  // replaceChildren, unlike el(), would print a null as the word "null".
  $status.replaceChildren(...[
    el("span", { className: "tea-line", textContent: line }),
    s?.enabled ? check : null,
    s?.error ? el("div", { className: "tea-error", textContent: alice.teaError(s.error) }) : null,
  ].filter(Boolean));

  const now = waiting(s);
  const chatter = (s?.items ?? []).filter((i) => i.needsYou === false);
  $list.replaceChildren();
  // Off, the status line has said all there is to say.
  if (!now.length && s?.enabled) {
    $list.append(el("div", { className: "empty", textContent: s?.checkedAt ? alice.teaEmpty : alice.teaEmptyYet }));
  }
  for (const item of now) $list.append(renderItem(item));

  if (chatter.length) {
    // Kept across redraws, which happen on every Slack update.
    const d = el("details", { className: "chatter", open: chatterOpen },
      el("summary", { textContent: alice.teaChatter(chatter.length) }));
    d.ontoggle = () => { chatterOpen = d.open; };
    for (const item of chatter) d.append(renderItem(item, { quiet: true }));
    $list.append(d);
  }
}
