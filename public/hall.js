// The Hall of Doors' panel: your MCP servers (the doors) and your skills
// (the bottles on the glass table).
//
// The panel redraws whole whenever the Hall changes, which is often while a
// door is being tried. So anything you're in the middle of — the skill open
// in the editor, the filter, a new skill half-named — is built once and kept
// here, and put back into each redraw rather than rebuilt.
import { alice } from "/alice.js";
import { el, api, toast, ago } from "/ui.js";

const $status = document.getElementById("hall-status");
const $doors = document.getElementById("hall-doors");
const $bottles = document.getElementById("hall-bottles");

let hall = null;

export function setHall(h) {
  hall = h;
}

export function getHall() {
  return hall;
}

/** The doors that won't open: what the Hall's sign counts. */
export function troubled(h = hall) {
  return (h?.servers ?? []).filter((s) => s.status === "needs-auth" || s.status === "failed");
}

const home = (p) => String(p ?? "").replace(/^\/Users\/[^/]+/, "~");

/* ----------------------------------------------------------------- doors */

/**
 * Opened before the request goes out: a page opened only once the answer is
 * back no longer counts as the click's doing, and the browser blocks it.
 */
async function signIn(server, button) {
  button.disabled = true;
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  const { ok, data } = await api(`/api/mcp/${encodeURIComponent(server.name)}/auth`, {});
  if (ok && data.url) {
    if (tab) tab.location.href = data.url;
    else toast(alice.signInBlocked);
    return;
  }
  tab?.close();
  button.disabled = false;
  if (ok) toast(data.reason ? alice.reconnected(data) : alice.reconnected({ ok: true, ...data }));
}

async function reconnect(server, button) {
  button.disabled = true;
  const { ok, data } = await api(`/api/mcp/${encodeURIComponent(server.name)}/reconnect`, {});
  if (ok) toast(alice.reconnected(data));
  button.disabled = false;
}

function renderDoor(s) {
  const row = el("div", { className: `door door-${s.status}` });
  const facts = [
    alice.doorSource[s.source] ?? s.source,
    s.transport,
    s.host,
    s.status === "connected" ? alice.doorTools(s.tools) : null,
  ].filter(Boolean).join(" · ");

  row.append(
    el("div", { className: "door-head" },
      el("span", { className: `door-dot dot-${s.status}`, title: alice.doorStatus[s.status] ?? s.status }),
      el("span", { className: "name", textContent: s.name }),
      el("span", { className: "door-state", textContent: s.busy === "reconnecting" ? alice.reconnecting : s.busy === "signing-in" ? alice.signingIn : alice.doorStatus[s.status] ?? s.status })),
    el("div", { className: "door-facts mono", textContent: facts })
  );
  if (s.error && s.status !== "connected") row.append(el("div", { className: "door-error", textContent: s.error }));

  const buttons = [];
  if (s.status === "needs-auth") {
    const b = el("button", { className: "primary", textContent: alice.authenticate, disabled: Boolean(s.busy) });
    b.onclick = () => signIn(s, b);
    buttons.push(b);
  }
  if (s.status !== "disabled") {
    const b = el("button", { className: s.status === "failed" ? "primary" : "ghost", textContent: alice.reconnect, disabled: Boolean(s.busy) });
    b.onclick = () => reconnect(s, b);
    buttons.push(b);
  }
  if (s.signIn) {
    buttons.push(el("a", { className: "door-link", href: s.signIn, target: "_blank", rel: "noopener noreferrer", textContent: alice.signInAgain }));
  }
  if (buttons.length) row.append(el("div", { className: "row" }, ...buttons));
  return row;
}

/* --------------------------------------------------------------- bottles */

// Kept between redraws: see the top of the file.
const filter = el("input", { className: "skill-filter", type: "search", placeholder: alice.skillFilter });
filter.oninput = () => renderBottles();
let editor = null; // { id, node }
let creating = null; // the new-skill form, while it's open

function closeEditor() {
  editor = null;
  renderBottles();
}

async function openEditor(skill) {
  const { ok, data } = await api(`/api/skills/${skill.id}`);
  if (!ok) return;
  const node = el("div", { className: "skill-editor" });
  if (skill.editable) {
    const text = el("textarea", { className: "mono", value: data.content, rows: 20, spellcheck: false });
    const save = el("button", { className: "primary", textContent: alice.skillSave });
    const cancel = el("button", { className: "ghost", textContent: alice.skillCancel });
    save.onclick = async () => {
      save.disabled = true;
      const r = await api(`/api/skills/${skill.id}`, { content: text.value, baseModifiedAt: data.skill.modifiedAt });
      save.disabled = false;
      if (r.ok) {
        toast(alice.skillSaved);
        closeEditor();
      }
    };
    cancel.onclick = closeEditor;
    node.append(text, el("div", { className: "row" }, save, cancel));
  } else {
    const close = el("button", { className: "ghost", textContent: alice.close });
    close.onclick = closeEditor;
    node.append(
      el("div", { className: "sub", textContent: alice.skillReadOnly(skill.where) }),
      el("pre", { className: "skill-text mono", textContent: data.content }),
      el("div", { className: "row" }, close));
  }
  editor = { id: skill.id, node };
  renderBottles();
  node.querySelector("textarea")?.focus();
}

function renderSkill(skill) {
  const card = el("div", { className: `bottle bottle-${skill.scope}` });
  const where = skill.scope === "project" ? home(skill.where) : skill.scope === "plugin" ? skill.where : null;
  card.append(
    el("div", { className: "bottle-head" },
      el("span", { className: "name", textContent: skill.name }),
      where ? el("span", { className: "bottle-where mono", textContent: where }) : null),
    el("div", { className: "bottle-desc", textContent: skill.description }),
    el("div", { className: "bottle-path mono", textContent: home(skill.path), title: skill.path })
  );
  if (skill.files.length) card.append(el("div", { className: "bottle-files", textContent: alice.skillFiles(skill.files.length), title: skill.files.join("\n") }));

  if (editor?.id === skill.id) {
    card.append(editor.node);
    return card;
  }
  const open = el("button", { className: skill.editable ? "primary" : "ghost", textContent: skill.editable ? alice.skillEdit : alice.skillRead });
  open.onclick = () => openEditor(skill);
  const reveal = el("button", { className: "ghost", textContent: alice.skillReveal });
  reveal.onclick = () => api(`/api/skills/${skill.id}/reveal`, {});
  card.append(el("div", { className: "row" }, open, reveal));
  return card;
}

function newSkillForm() {
  const name = el("input", { className: "mono", placeholder: "my-skill", autocomplete: "off", spellcheck: false });
  const what = el("textarea", { rows: 3 });
  const go = el("button", { className: "primary", textContent: alice.skillNewGo });
  const cancel = el("button", { className: "ghost", textContent: alice.skillCancel });
  cancel.onclick = () => {
    creating = null;
    renderBottles();
  };
  go.onclick = async () => {
    go.disabled = true;
    const { ok, data } = await api("/api/skills", { name: name.value, description: what.value });
    go.disabled = false;
    if (!ok) return;
    creating = null;
    // Straight into the editor: the template is only a start.
    openEditor(data.skill);
  };
  return el("div", { className: "skill-new" },
    el("label", {}, el("span", { textContent: alice.skillNewName }), name),
    el("label", {}, el("span", { textContent: alice.skillNewWhat }), what),
    el("div", { className: "row" }, go, cancel));
}

function renderBottles() {
  const skills = hall?.skills ?? [];
  const q = filter.value.trim().toLowerCase();
  const shown = q ? skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q)) : skills;

  const add = el("button", { className: "ghost", textContent: alice.skillNew });
  add.onclick = () => {
    creating = newSkillForm();
    renderBottles();
    creating.querySelector("input").focus();
  };
  $bottles.replaceChildren(
    el("div", { className: "hall-section-head" },
      el("h3", { textContent: alice.hallBottles }),
      el("span", { className: "sub", textContent: alice.hallBottlesHint })),
    el("div", { className: "row" }, filter, creating ? null : add),
  );
  if (creating) $bottles.append(creating);
  if (!shown.length) $bottles.append(el("div", { className: "empty", textContent: alice.skillNone }));
  for (const scope of ["user", "project", "plugin", "synced"]) {
    const group = shown.filter((s) => s.scope === scope);
    if (!group.length) continue;
    $bottles.append(el("div", { className: "skill-group", textContent: `${alice.skillScope[scope]} (${group.length})` }));
    for (const s of group) $bottles.append(renderSkill(s));
  }
}

/* ----------------------------------------------------------------- panel */

export function renderHall() {
  const h = hall;
  const busy = (h?.servers ?? []).some((s) => s.busy);
  const check = el("button", { className: "ghost", textContent: alice.hallCheck, disabled: busy });
  check.onclick = async () => {
    check.disabled = true;
    await api("/api/hall/check", {});
  };
  let line;
  if (!h || !h.enabled) line = alice.hallOff;
  else if (!h.checkedAt) line = alice.hallChecking;
  else line = alice.hallChecked(ago(Date.now() - h.checkedAt));
  $status.replaceChildren(...[
    el("span", { className: "tea-line", textContent: line }),
    h?.enabled ? check : null,
    h?.error ? el("div", { className: "tea-error", textContent: alice.hallError(h.error) }) : null,
  ].filter(Boolean));

  const servers = h?.servers ?? [];
  // The ones that won't open first: they're why you came.
  const order = { "needs-auth": 0, failed: 1, pending: 2, connected: 3, disabled: 4 };
  const sorted = [...servers].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.name.localeCompare(b.name));
  $doors.replaceChildren(
    el("div", { className: "hall-section-head" },
      el("h3", { textContent: alice.hallDoors }),
      el("span", { className: "sub", textContent: alice.hallDoorsHint })),
    el("div", { className: "hall-reach", textContent: alice.hallReach }),
  );
  if (h?.enabled && h.checkedAt && !servers.length) $doors.append(el("div", { className: "empty", textContent: alice.hallNoServers }));
  for (const s of sorted) $doors.append(renderDoor(s));

  renderBottles();
}
