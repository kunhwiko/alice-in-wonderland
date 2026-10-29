// The Hall of Doors, without a CLI or the real ~/.claude.
//
//   node test/hall.mjs
import { mkdtemp, rm, mkdir, writeFile, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHall, scanSkills, frontmatter, shapeServer } from "../server/hall.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) return;
  failures++;
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
}

const skillMd = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
async function put(path, text) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

/* ----------------------------------------------------------- frontmatter */

{
  const fm = frontmatter(`---\nname: "pdf"\ndescription: >\n  Use this for PDFs,\n  of all kinds.\nlicense: MIT\n---\nbody`);
  check("a quoted value loses its quotes", fm.name === "pdf", JSON.stringify(fm));
  check("a folded block is one line", fm.description === "Use this for PDFs, of all kinds.", JSON.stringify(fm));
  check("keys after a block still read", fm.license === "MIT");
  check("no frontmatter is nothing", Object.keys(frontmatter("# just a heading")).length === 0);
}

/* --------------------------------------------------------- shapeServer */

{
  const s = shapeServer({ name: "jira", status: "failed", scope: "user", config: { type: "http", url: "https://x.example.com/mcp?token=secret" }, error: "boom" });
  check("only a server's host goes out, not its URL", s.host === "x.example.com" && !JSON.stringify(s).includes("secret"), JSON.stringify(s));
  check("source falls back to scope", s.source === "user");
}

/* ---------------------------------------------------------------- skills */

const home = await mkdtemp(join(tmpdir(), "wl-hall-"));
const project = join(home, "code", "proj");
try {
  await put(join(home, ".claude", "skills", "mine", "SKILL.md"), skillMd("mine", "My own skill"));
  await put(join(home, ".claude", "skills", "mine", "scripts", "run.sh"), "echo hi");
  await put(join(home, ".claude", "skills", ".trash", "old", "SKILL.md"), skillMd("old", "binned"));
  await put(join(home, ".claude", "skills", "synced", "bucket1", "pdf", "SKILL.md"), skillMd("pdf", "PDFs"));
  const pluginPath = join(home, ".claude", "plugins", "cache", "mkt", "fancy", "v2");
  await put(join(pluginPath, "skills", "design", "SKILL.md"), skillMd("design", "Design things"));
  // an older copy of the same plugin, not the one installed
  await put(join(home, ".claude", "plugins", "cache", "mkt", "fancy", "v1", "skills", "design", "SKILL.md"), skillMd("design", "old"));
  await put(join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "fancy@mkt": [{ scope: "user", installPath: pluginPath }] } }));
  await put(join(project, ".claude", "skills", "conventions", "SKILL.md"), skillMd("conventions", "How we do things"));
  await put(join(home, ".claude.json"), JSON.stringify({ projects: { [project]: {}, [join(home, "gone")]: {} } }));

  const skills = scanSkills({ home });
  const by = Object.fromEntries(skills.map((s) => [s.name, s]));
  check("finds yours, a project's, a plugin's and claude.ai's", ["mine", "conventions", "fancy:design", "pdf"].every((n) => by[n]),
    skills.map((s) => s.name).join(", "));
  check("skips the bin", !by.old);
  check("reads the installed plugin, not every cached copy", skills.filter((s) => s.name === "fancy:design").length === 1 && by["fancy:design"].description === "Design things");
  check("yours and projects' are editable", by.mine.editable && by.conventions.editable);
  check("plugins' and claude.ai's aren't", !by["fancy:design"].editable && !by.pdf.editable);
  check("a project skill says which project", by.conventions.where === project);
  check("lists the files beside SKILL.md", by.mine.files.join() === join("scripts", "run.sh"), by.mine.files.join());

  /* --- saving and creating, through the hall ------------------------------ */
  const sent = [];
  const hall = createHall({ broadcast: (e) => sent.push(e), home, enabled: false });
  hall.start();

  const saved = hall.saveSkill(by.mine.id, { content: skillMd("mine", "Better"), baseModifiedAt: by.mine.modifiedAt });
  check("saves your skill", saved.ok && (await readFile(by.mine.path, "utf8")).includes("Better"), JSON.stringify(saved));
  check("a save is announced", sent.some((e) => e.type === "hall"));
  check("the snapshot has the new description", hall.snapshot().skills.find((s) => s.name === "mine")?.description === "Better");

  const ro = hall.saveSkill(by.pdf.id, { content: "x" });
  check("won't write a claude.ai skill", !ro.ok && ro.code === 409, JSON.stringify(ro));
  check("a refused save leaves it be", (await readFile(by.pdf.path, "utf8")).includes("PDFs"));
  check("won't write a skill it didn't find", hall.saveSkill("000000000000", { content: "x" }).code === 404);

  // Someone edits it elsewhere after you opened it.
  const opened = hall.snapshot().skills.find((s) => s.name === "conventions");
  const later = new Date(Date.now() + 5000);
  await writeFile(opened.path, skillMd("conventions", "Changed in vim"));
  await utimes(opened.path, later, later);
  const stale = hall.saveSkill(opened.id, { content: "mine now", baseModifiedAt: opened.modifiedAt });
  check("won't save over a change made since it was opened", !stale.ok && stale.code === 409, JSON.stringify(stale));
  check("...and the change survives", (await readFile(opened.path, "utf8")).includes("Changed in vim"));

  const made = hall.createSkill({ name: "New-Thing", description: "Does a thing" });
  check("makes a new skill of yours", made.ok && made.skill?.name === "new-thing" && made.skill.editable, JSON.stringify(made));
  check("...from a template that has its description", (await readFile(made.skill.path, "utf8")).includes("description: Does a thing"));
  check("won't make one twice", hall.createSkill({ name: "new-thing" }).code === 409);
  check("won't take a path for a name", hall.createSkill({ name: "../escape" }).code === 400);

  const revealed = [];
  const h2 = createHall({ broadcast() {}, home, enabled: false, reveal: (p) => revealed.push(p) });
  check("shows a skill in Finder", h2.revealSkill(by.mine.id) && revealed[0] === by.mine.path);
} finally {
  await rm(home, { recursive: true, force: true });
}

/* ------------------------------------------------------------ the doors */

{
  const calls = [];
  let statuses = [
    { name: "wiki", status: "connected", source: "user", config: { type: "stdio" }, tools: [{}, {}] },
    { name: "jira", status: "failed", source: "user", config: { type: "http", url: "https://jira.example.com/mcp" }, error: "ECONNREFUSED" },
    { name: "cloud thing", status: "needs-auth", source: "claudeai", config: { type: "claudeai-proxy", url: "https://claude.ai/x" } },
  ];
  const steward = {
    status: async () => statuses,
    reconnect: async (name) => {
      calls.push(["reconnect", name]);
      statuses = statuses.map((s) => (s.name === name ? { ...s, status: "connected", error: undefined } : s));
    },
    authenticate: async (name) => {
      calls.push(["auth", name]);
      return name === "cloud thing"
        ? { authUrl: "https://claude.ai/connect", requiresUserAction: true, callbackExpected: false }
        : { requiresUserAction: false };
    },
    close() {},
  };
  const reconnected = [];
  const sessions = { reconnectMcp: async (name) => { reconnected.push(name); return 2; } };
  const sent = [];
  const hall = createHall({ broadcast: (e) => sent.push(e), sessions, open: () => steward, home: tmpdir(), enabled: true, pollMs: 1e9 });

  await hall.look();
  const snap = hall.snapshot();
  check("lists every door", snap.servers.map((s) => s.name).join() === "cloud thing,jira,wiki", snap.servers.map((s) => s.name).join());
  check("counts a door's tools", snap.servers.find((s) => s.name === "wiki").tools === 2);

  const r = await hall.reconnect("jira");
  check("reconnects through the steward", calls.some(([k, n]) => k === "reconnect" && n === "jira"));
  check("...and in Wonderland's own sessions", reconnected.includes("jira") && r.sessions === 2, JSON.stringify(r));
  check("...and says it's open now", r.ok && r.status === "connected", JSON.stringify(r));
  check("won't try a door that isn't there", !(await hall.reconnect("nope")).ok);

  const a = await hall.authenticate("cloud thing");
  check("a sign-in hands back the page to open", a.ok && a.url === "https://claude.ai/connect", JSON.stringify(a));
  const during = hall.snapshot().servers.find((s) => s.name === "cloud thing");
  check("...and the door says it's waiting on you", during.busy === "signing-in" && during.signIn === "https://claude.ai/connect", JSON.stringify(during));

  const b = await hall.authenticate("wiki");
  check("a sign-in that needs nothing just reconnects", b.ok && calls.some(([k, n]) => k === "reconnect" && n === "wiki"), JSON.stringify(b));

  // A steward that has died is opened afresh.
  let opens = 0;
  const flaky = createHall({
    broadcast() {}, home: tmpdir(), enabled: true, pollMs: 1e9,
    open: () => (++opens === 1 ? { status: async () => { throw new Error("CLI exited"); }, close() {} } : steward),
  });
  await flaky.look();
  check("a dead steward shows as the Hall's error", /CLI exited/.test(flaky.snapshot().error ?? ""));
  await flaky.look();
  check("...and the next look opens a new one", opens === 2 && !flaky.snapshot().error, `opens=${opens}`);
  hall.stop();
  flaky.stop();
}

if (failures) process.exit(1);
console.log("PASS: hall — skills found, edited only where safe; doors tried, signed into, passed on to sessions");
// The sign-in watcher sleeps between looks; nothing here needs to wait for it.
process.exit(0);
