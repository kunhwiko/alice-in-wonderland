// The Hall of Doors: your MCP servers, and your skills.
//
// Each MCP server is a door. Wonderland keeps one quiet CLI process of its
// own — the steward — that loads your settings the way a session would and
// connects to every server, but never runs a turn. Through it the Hall can
// say which doors are open, try one again, and start a sign-in.
//
// What the steward can and can't reach: a sign-in is saved where every
// session finds it, and a reconnect is passed on to the sessions Wonderland
// runs itself. A terminal session that's already open keeps its own
// connections, and notices with /mcp; there's no reaching into it from here.
//
// Skills are the bottles on the glass table, read straight from disk. Yours
// and your projects' can be edited here; a plugin's or claude.ai's would be
// overwritten by their next update, so those are read-only.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const ENABLED = process.env.WONDERLAND_HALL !== "off";
const POLL_MS = Number(process.env.WONDERLAND_HALL_POLL_MS ?? 60_000);
/** How long a sign-in page is waited on before the Hall gives up on it. */
const SIGN_IN_MS = 5 * 60_000;
const SKILL_MAX_BYTES = 256_000;
/** Other files in a skill's folder listed beside its SKILL.md. */
const FILES_SHOWN = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (err) => String(err?.message ?? err);

/* ----------------------------------------------------------- the steward */

/**
 * A CLI that never gets a prompt, holding your MCP connections. It loads
 * your user, project and local settings — that's where the servers are
 * configured — but with every hook off: Wonderland's own hooks would
 * otherwise report it as a terminal session and give it a card at Court.
 */
export function openSteward({ cwd = homedir() } = {}) {
  let close;
  const idle = {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise((r) => { close = () => r({ value: undefined, done: true }); }),
    }),
  };
  const q = query({
    prompt: idle,
    options: {
      settingSources: ["user", "project", "local"],
      settings: { disableAllHooks: true },
      persistSession: false,
      cwd,
      tools: [],
    },
  });
  return {
    status: () => q.mcpServerStatus(),
    reconnect: (name) => q.reconnectMcpServer(name),
    async authenticate(name) {
      // Not in the SDK's types yet, though the method is there.
      if (typeof q.mcpAuthenticate === "function") return q.mcpAuthenticate(name);
      return (await q.request({ subtype: "mcp_authenticate", serverName: name })).response;
    },
    close() {
      close?.();
      q.close?.();
    },
  };
}

/** Only the host of a URL: the rest can carry tokens, and isn't news. */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function shapeServer(s) {
  return {
    name: s.name,
    status: s.status,
    source: s.source ?? s.scope ?? null,
    transport: s.config?.type ?? null,
    host: hostOf(s.config?.url),
    tools: s.tools?.length ?? 0,
    version: s.serverInfo?.version ?? null,
    error: s.error ? String(s.error).slice(0, 400) : null,
  };
}

/* ---------------------------------------------------------------- skills */

/** The YAML a SKILL.md opens with — the flat keys, and `>`/`|` blocks. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let [, key, value] = kv;
    if (/^[>|]-?$/.test(value) || value === "") {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(value.startsWith("|") ? "\n" : " ");
    }
    out[key] = value.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const skillId = (path) => createHash("sha1").update(path).digest("hex").slice(0, 12);

const dirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return [];
  }
};

/** What else is in a skill's folder: scripts, references, templates. */
function filesBeside(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of (() => { try { return readdirSync(d, { withFileTypes: true }); } catch { return []; } })()) {
      if (out.length >= FILES_SHOWN || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name !== "SKILL.md") out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out;
}

function readSkill(dir, { scope, where, editable, prefix = "" }) {
  const path = join(dir, "SKILL.md");
  let text, st;
  try {
    st = statSync(path);
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const fm = frontmatter(text);
  const base = fm.name || dir.split("/").pop();
  return {
    id: skillId(path),
    name: prefix ? `${prefix}:${base}` : base,
    description: fm.description ?? "",
    scope, where, editable, path, dir,
    files: filesBeside(dir),
    modifiedAt: Math.floor(st.mtimeMs),
  };
}

/** Every project you've opened Claude in, as ~/.claude.json remembers them. */
function knownProjects(home) {
  try {
    const cfg = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
    return Object.keys(cfg.projects ?? {}).slice(0, 300);
  } catch {
    return [];
  }
}

/**
 * Every skill on disk: yours, your projects', your plugins', and the ones
 * synced from claude.ai. A skill a plugin ships is read from the version
 * installed, not from every copy in the plugin cache.
 */
export function scanSkills({ home = homedir() } = {}) {
  const out = [];
  const userDir = join(home, ".claude", "skills");
  for (const name of dirs(userDir)) {
    if (name === "synced") continue;
    const s = readSkill(join(userDir, name), { scope: "user", where: null, editable: true });
    if (s) out.push(s);
  }
  for (const bucket of dirs(join(userDir, "synced"))) {
    for (const name of dirs(join(userDir, "synced", bucket))) {
      const s = readSkill(join(userDir, "synced", bucket, name), { scope: "synced", where: "claude.ai", editable: false });
      if (s) out.push(s);
    }
  }
  try {
    const installed = JSON.parse(readFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"));
    for (const [key, installs] of Object.entries(installed.plugins ?? installed)) {
      const plugin = key.split("@")[0];
      for (const inst of [].concat(installs)) {
        if (!inst?.installPath) continue;
        for (const name of dirs(join(inst.installPath, "skills"))) {
          const s = readSkill(join(inst.installPath, "skills", name), { scope: "plugin", where: plugin, editable: false, prefix: plugin });
          if (s) out.push(s);
        }
      }
    }
  } catch {
    // no plugins installed
  }
  for (const project of knownProjects(home)) {
    if (project === home) continue; // that's ~/.claude/skills again
    const dir = join(project, ".claude", "skills");
    if (!existsSync(dir)) continue;
    for (const name of dirs(dir)) {
      const s = readSkill(join(dir, name), { scope: "project", where: project, editable: true });
      if (s) out.push(s);
    }
  }
  // One entry per file, however many ways it was reached.
  const seen = new Set();
  return out.filter((s) => !seen.has(s.id) && seen.add(s.id)).sort((a, b) => a.name.localeCompare(b.name));
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

function skillTemplate(name, description) {
  const title = name.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return `---\nname: ${name}\ndescription: ${description.replace(/\n/g, " ")}\n---\n\n# ${title}\n\nWhat Claude should do when this skill is used.\n`;
}

/* ------------------------------------------------------------------ hall */

/**
 * The Hall the server runs. `open` and `home` are injectable so the tests can
 * drive it without a CLI or the real ~/.claude.
 */
export function createHall({
  broadcast,
  sessions = null,
  open = openSteward,
  home = homedir(),
  enabled = ENABLED,
  pollMs = POLL_MS,
  reveal = (path) => execFile("open", ["-R", path], () => {}),
}) {
  let steward = null;
  let servers = [];
  let skills = [];
  let checkedAt = null;
  let error = null;
  const busy = {}; // name -> "reconnecting" | "signing-in"
  const signIns = {}; // name -> { url, until, callback }
  let timer = null;

  const get = () => (steward ??= open({ cwd: home }));
  function drop() {
    try {
      steward?.close();
    } catch {
      // it's going anyway
    }
    steward = null;
  }

  function snapshot() {
    return {
      enabled,
      servers: servers.map((s) => ({ ...s, busy: busy[s.name] ?? null, signIn: signIns[s.name]?.url ?? null })),
      skills,
      checkedAt,
      error,
    };
  }
  const announce = () => broadcast({ type: "hall", hall: snapshot() });

  function rescanSkills() {
    skills = scanSkills({ home });
  }

  /** Ask the steward how every door is. `settle` waits out ones still opening. */
  async function look({ settle = false } = {}) {
    if (!enabled) return;
    try {
      let list = await get().status();
      for (let i = 0; settle && i < 15 && list.some((s) => s.status === "pending"); i++) {
        await sleep(2000);
        list = await get().status();
      }
      servers = list.map(shapeServer).sort((a, b) => a.name.localeCompare(b.name));
      error = null;
    } catch (err) {
      // A steward that has died is opened afresh on the next look.
      error = msg(err);
      drop();
    }
    checkedAt = Date.now();
    rescanSkills();
    announce();
  }

  const known = (name) => servers.some((s) => s.name === name);
  const statusOf = (name) => servers.find((s) => s.name === name)?.status ?? null;

  async function reconnect(name) {
    if (!known(name)) return { ok: false, reason: "no such server" };
    busy[name] = "reconnecting";
    announce();
    let reason = null;
    try {
      await get().reconnect(name);
    } catch (err) {
      reason = msg(err);
    }
    // And in the sessions Wonderland runs, so they notice too.
    const reached = sessions ? await sessions.reconnectMcp(name).catch(() => 0) : 0;
    delete busy[name];
    await look();
    const status = statusOf(name);
    return { ok: status === "connected", status, sessions: reached, reason: status === "connected" ? null : reason ?? servers.find((s) => s.name === name)?.error ?? null };
  }

  /** Watch for a sign-in to land, then pass it on to every session. */
  async function awaitSignIn(name) {
    while (signIns[name] && Date.now() < signIns[name].until) {
      await sleep(4000);
      const s = signIns[name];
      if (!s) return;
      // A claude.ai connector is signed into on claude.ai, so nothing calls
      // back here; keep trying the door. An OAuth server calls the steward
      // back, and the steward reconnects it by itself.
      if (!s.callback) await get().reconnect(name).catch(() => {});
      await look();
      if (statusOf(name) === "connected") {
        delete signIns[name];
        delete busy[name];
        await sessions?.reconnectMcp(name).catch(() => {});
        announce();
        return;
      }
    }
    delete signIns[name];
    delete busy[name];
    announce();
  }

  async function authenticate(name) {
    if (!known(name)) return { ok: false, reason: "no such server" };
    busy[name] = "signing-in";
    announce();
    let res;
    try {
      res = await get().authenticate(name);
    } catch (err) {
      delete busy[name];
      announce();
      return { ok: false, reason: msg(err) };
    }
    if (!res?.requiresUserAction || !res.authUrl) {
      // It had what it needed already.
      delete busy[name];
      return reconnect(name);
    }
    signIns[name] = { url: res.authUrl, until: Date.now() + SIGN_IN_MS, callback: Boolean(res.callbackExpected) };
    announce();
    awaitSignIn(name);
    return { ok: true, url: res.authUrl };
  }

  /* --- skills ----------------------------------------------------------- */

  function findSkill(id) {
    rescanSkills();
    return skills.find((s) => s.id === id) ?? null;
  }

  function readSkillFile(id) {
    const skill = findSkill(id);
    if (!skill) return null;
    return { skill, content: readFileSync(skill.path, "utf8") };
  }

  /**
   * Write a skill back. Only to a SKILL.md this scan found, only an editable
   * one, and not over a change made somewhere else since it was opened.
   */
  function saveSkill(id, { content, baseModifiedAt } = {}) {
    const skill = findSkill(id);
    if (!skill) return { ok: false, code: 404, reason: "no such skill" };
    if (!skill.editable) return { ok: false, code: 409, reason: `that skill comes from ${skill.where} — an edit here would be overwritten` };
    if (typeof content !== "string") return { ok: false, code: 400, reason: "content is required" };
    if (Buffer.byteLength(content) > SKILL_MAX_BYTES) return { ok: false, code: 400, reason: "that's too big for a skill" };
    if (baseModifiedAt && skill.modifiedAt !== baseModifiedAt) {
      return { ok: false, code: 409, reason: "it's changed on disk since you opened it — open it again to see the new version" };
    }
    // Written in place, not swapped in, so a SKILL.md that's a symlink into
    // a dotfiles repo stays one.
    writeFileSync(skill.path, content);
    rescanSkills();
    announce();
    return { ok: true, skill: skills.find((s) => s.id === id) };
  }

  /** A new skill of your own, in ~/.claude/skills. */
  function createSkill({ name, description } = {}) {
    name = String(name ?? "").trim().toLowerCase();
    if (!SLUG.test(name)) return { ok: false, code: 400, reason: "a name is lower-case letters, digits and dashes" };
    description = String(description ?? "").trim() || "What this skill is for, and when to use it.";
    const dir = join(home, ".claude", "skills", name);
    if (existsSync(dir)) return { ok: false, code: 409, reason: `there's already a skill called ${name}` };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), skillTemplate(name, description));
    rescanSkills();
    announce();
    return { ok: true, skill: skills.find((s) => s.dir === dir) };
  }

  function revealSkill(id) {
    const skill = findSkill(id);
    if (!skill) return false;
    reveal(skill.path);
    return true;
  }

  return {
    snapshot,
    look,
    reconnect,
    authenticate,
    readSkill: readSkillFile,
    saveSkill,
    createSkill,
    revealSkill,
    start() {
      rescanSkills();
      if (!enabled || timer) return;
      look({ settle: true });
      timer = setInterval(() => look(), pollMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
      drop();
    },
  };
}
