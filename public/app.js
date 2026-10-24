// Wonderland's front door: one event stream, two panels, and the world.
//
// The world is drawn by world.js and only shows things; anything you decide
// is decided in a panel, where the literal request is on screen. world.js is
// imported dynamically, so a browser without WebGL — or the smoke test, which
// has no three.js — still gets a working page.
import { alice } from "/alice.js";
import { api } from "/ui.js";
import { ingest, render as renderCourt, todos } from "/court.js";
import { setSlack, getSlack, renderTea, waiting as teaWaiting } from "/teaparty.js";
import { createNoticer, courtNews, teaNews, lineup } from "/attention.js";

/* ------------------------------------------------------------ the chrome */

document.getElementById("title").textContent = alice.title;
document.getElementById("tagline").textContent = alice.tagline;
document.getElementById("new-btn").textContent = alice.newSession;
document.getElementById("new-go").textContent = alice.newSessionGo;
document.getElementById("new-name-label").textContent = alice.newSessionName;
document.getElementById("new-model-label").textContent = alice.newSessionModel;
for (const m of alice.models) {
  const opt = document.createElement("option");
  opt.value = m.id;
  opt.textContent = m.label;
  document.getElementById("new-model").append(opt);
}
document.getElementById("new-where-label").textContent = alice.newSessionWhere;
document.getElementById("new-what-label").textContent = alice.newSessionWhat;
document.getElementById("footer").append(
  alice.quote,
  Object.assign(document.createElement("cite"), { textContent: alice.quoteSource })
);

const places = {
  tea: document.getElementById("go-tea"),
  court: document.getElementById("go-court"),
};
for (const [key, b] of Object.entries(places)) {
  b.querySelector(".place-name").textContent = alice.districts[key];
  b.title = alice.districtHints[key];
  b.onclick = () => openPanel(panelKey === key ? null : key);
}

const HEART = (ring) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<rect width="32" height="32" rx="6" fill="${ring ? "#b8902f" : "#fffdf8"}"/>` +
      `<path d="M16 26S5 19 5 12.5A5.5 5.5 0 0 1 16 10a5.5 5.5 0 0 1 11 2.5C27 19 16 26 16 26z" fill="#c4384a"/>` +
      `</svg>`
  );

let faviconRing = null;
function setFavicon(ring) {
  if (faviconRing === ring) return; // don't thrash the DOM on every render
  faviconRing = ring;
  document.getElementById("favicon").href = HEART(ring);
}

/* ------------------------------------------------------------- the panel */

const $panel = document.getElementById("panel");
const views = { tea: document.getElementById("tea"), court: document.getElementById("court") };
let panelKey = null;

function openPanel(key) {
  panelKey = key;
  $panel.hidden = !key;
  document.body.classList.toggle("panel-open", Boolean(key));
  for (const [k, v] of Object.entries(views)) v.hidden = k !== key;
  for (const [k, b] of Object.entries(places)) b.classList.toggle("active", k === key);
  if (key) {
    document.getElementById("panel-title").textContent = alice.districts[key];
    document.getElementById("panel-hint").textContent = alice.districtHints[key];
  }
  world?.focus(key, { cover: panelW / innerWidth });
}

document.getElementById("panel-close").onclick = () => openPanel(null);

/*
 * Wider, for reading: drag the panel's left edge, or let « / » switch it
 * between its usual width and most of the screen. The width you chose is
 * kept in this browser (and only this browser — it's a convenience).
 */
const USUAL_W = 560;
const WIDTH_KEY = "wonderland.panelWidth";
const $expand = document.getElementById("panel-expand");
const $grip = document.getElementById("panel-grip");
$grip.title = alice.panelGrip;

let wantedW = USUAL_W;
let panelW = USUAL_W; // wantedW, as far as this window allows
try {
  wantedW = Number(localStorage.getItem(WIDTH_KEY)) || USUAL_W;
} catch {
  // no storage (a private window, say): the usual width it is
}
const wideW = () => Math.min(1100, innerWidth * 0.92);
const isWide = () => wantedW > USUAL_W + 40;

/** Apply `wantedW`, clamped to what this window can hold. */
function sizePanel() {
  panelW = Math.round(Math.min(Math.max(wantedW, 380), innerWidth - 60));
  document.documentElement.style.setProperty("--panel-w", `${panelW}px`);
  // No room left beside it for the HUD's buttons.
  document.body.classList.toggle("panel-wide", innerWidth - panelW < 820);
  $expand.textContent = isWide() ? "»" : "«";
  $expand.title = isWide() ? alice.panelNarrower : alice.panelWider;
  $expand.setAttribute("aria-label", $expand.title);
  // Keep the district in view in whatever the panel leaves of the screen.
  if (panelKey) world?.focus(panelKey, { cover: panelW / innerWidth });
}
function setPanelWidth(w) {
  wantedW = w;
  sizePanel();
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
  } catch {
    // not remembered, then
  }
}
const toggleWide = () => setPanelWidth(isWide() ? USUAL_W : wideW());
$expand.onclick = toggleWide;
$grip.addEventListener("dblclick", toggleWide);
$grip.addEventListener("pointerdown", (e) => {
  $grip.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
  const move = (ev) => setPanelWidth(innerWidth - ev.clientX);
  const up = () => {
    document.body.classList.remove("resizing");
    $grip.removeEventListener("pointermove", move);
    $grip.removeEventListener("pointerup", up);
    $grip.removeEventListener("pointercancel", up);
  };
  $grip.addEventListener("pointermove", move);
  $grip.addEventListener("pointerup", up);
  $grip.addEventListener("pointercancel", up);
});
addEventListener("resize", sizePanel);
sizePanel();
document.addEventListener("keydown", (e) => {
  // Esc belongs to the dialog while it's open.
  if (e.key === "Escape" && panelKey && !dialog.open) openPanel(null);
});

/* ------------------------------------------------------------------ state */

// Declared before the stream opens: events can arrive while the world is
// still being built, and render() must not meet these uninitialised.
let world = null;
// Whether the server's hello has arrived. Until it has, the page knows of
// nothing, and a baseline taken then would make everything news.
let greeted = false;
const noticer = createNoticer();
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

/**
 * Send Alice wherever there's news. Grouped by district, so five letters
 * arriving together are one walk to the Tea Party, not five.
 */
function sendAlice() {
  if (!world || !greeted) return;
  const { fresh, oldest } = noticer.notice([...teaNews(getSlack()), ...courtNews([...todos.values()])]);
  if (oldest) world.errand(oldest.district, alice.errandStart);
  const tea = fresh.filter((n) => n.district === "tea");
  const court = fresh.filter((n) => n.district === "court");
  if (court.length) world.errand("court", alice.errandCourt(court), { onTheWay: pick(alice.errandOnTheWay) });
  if (tea.length) world.errand("tea", alice.errandTea(tea), { onTheWay: pick(alice.errandOnTheWay) });
}

/* ----------------------------------------------------------------- render */

/**
 * Redraw. The Court is skipped for Slack news and the Tea Party for session
 * news: each panel rebuilds itself whole, and there's no sense disturbing the
 * one that didn't change.
 */
function render({ court = true, tea = true } = {}) {
  if (court) renderCourt();
  if (tea) renderTea();

  const { waiting, others } = lineup([...todos.values()]);
  const letters = teaWaiting();
  const count = (n) => (n ? String(n) : "");
  places.tea.querySelector(".place-count").textContent = count(letters.length);
  places.court.querySelector(".place-count").textContent = count(waiting.length);

  world?.update({
    // A letter glows for its first half hour.
    tea: { items: letters.map((i) => ({ id: i.id, fresh: Date.now() - Number(i.latestTs) * 1000 < 30 * 60_000 })) },
    court: { waiting, others },
  });

  // A count in the tab title and a gold ring on the favicon, so a waiting
  // thing is obvious even with the tab in the background.
  const total = waiting.length + letters.length;
  document.title = total ? `(${total}) ${alice.title}` : alice.title;
  document.getElementById("tagline").textContent = waiting.length ? alice.needsYou(waiting.length) : alice.tagline;
  setFavicon(waiting.length > 0);
}

/* ------------------------------------------------------------------ wire */

function onEvent(e) {
  const ev = JSON.parse(e.data);
  if (ev.type === "slack") {
    setSlack(ev.slack);
    render({ court: false });
    sendAlice();
    return;
  }
  if (ev.type === "hello") {
    greeted = true;
    setSlack(ev.slack);
  }
  if (!ingest(ev)) return;
  render({ tea: ev.type === "hello" });
  sendAlice();
}

/**
 * The stream reconnects by itself after a dropped connection, but not once
 * it's CLOSED — which Chrome was seen to do to a stream opened while the page
 * was busy building the world. A closed stream would leave the page deaf
 * until reloaded, so open a new one. Each reconnect starts with a hello, which
 * brings everything back up to date.
 */
function connect() {
  const es = new EventSource("/api/events");
  es.onmessage = onEvent;
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, 2000);
  };
}
connect();

/* ------------------------------------------------------------- the world */

try {
  const { createWorld } = await import("/world.js");
  world = createWorld({
    canvas: document.getElementById("world"),
    overlay: document.getElementById("overlay"),
    names: alice.districts,
    onDistrict: (key) => openPanel(key),
  });
  // The hello may well have arrived while it was being built. If it has,
  // what it brought is the baseline, and Alice starts at the oldest of it.
  render();
  sendAlice();
} catch (err) {
  console.warn("Wonderland couldn't be drawn:", err);
  const n = document.getElementById("no-world");
  n.textContent = alice.noWorld;
  n.hidden = false;
}

const dialog = document.getElementById("new-dialog");
const newForm = document.getElementById("new-form");

document.getElementById("new-btn").onclick = () => dialog.showModal();

// Three ways out: the ✕, "Never mind", and Esc (which <dialog> gives us free).
const dismiss = () => {
  newForm.reset();
  dialog.close();
};
document.getElementById("new-dismiss").onclick = dismiss;
dialog.addEventListener("cancel", () => newForm.reset()); // Esc

// Clicking the backdrop lands on the dialog element itself, not its contents.
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dismiss();
});

newForm.onsubmit = async (e) => {
  if (e.submitter?.value === "cancel") return dismiss();
  const cwd = newForm.cwd.value.trim();
  const prompt = newForm.prompt.value.trim();
  const name = newForm.sessionName.value.trim();
  const model = newForm.sessionModel.value;
  if (!cwd || !prompt) return;
  newForm.reset();
  const { ok } = await api("/api/sessions", { cwd, prompt, name, model });
  // It'll be a soldier at Court, so that's where to look.
  if (ok) openPanel("court");
};

// Ages ("3m ago") drift; redraw the Tea Party now and then to keep them honest.
setInterval(() => render({ court: false }), 60_000);
