// Open a session in a real terminal tab.
//
// Wonderland runs as you, on your machine, so it can drive iTerm2 (or
// Terminal.app) over AppleScript. This is the escape hatch: some things want
// the full TUI — /resume pickers, plugin management, anything Wonderland
// doesn't surface.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const run = promisify(execFile);

const ITERM = "/Applications/iTerm.app";

/** Quote a string for use inside a POSIX shell single-quoted argument. */
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Escape a string for embedding in an AppleScript double-quoted literal. */
function asq(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function itermScript(command) {
  const c = asq(command);
  return `
tell application "iTerm"
  activate
  if (count of windows) = 0 then
    create window with default profile
    tell current session of current window to write text "${c}"
  else
    tell current window
      create tab with default profile
      tell current session to write text "${c}"
    end tell
  end if
end tell`;
}

function terminalAppScript(command) {
  return `
tell application "Terminal"
  activate
  do script "${asq(command)}"
end tell`;
}

/**
 * Statuses that mean no process holds this session's transcript. Shared with
 * the client so the stop button and the fork decision can't disagree — they
 * did, over `interrupted`.
 */
export const DEAD_STATUSES = ["stopped", "gone", "failed", "interrupted"];

/** Is a process still attached to this session's transcript? */
export function isSessionLive(todo, { ownedIsLive }) {
  if (todo.kind === "owned") return Boolean(ownedIsLive);
  return !DEAD_STATUSES.includes(todo.status);
}

/**
 * Build the shell line for a session, and say whether it forks.
 *
 * Resuming a session that still has a process on it would put two of them on
 * one transcript — the docs are explicit that their messages interleave. That
 * hazard is not specific to owned sessions: an external card is usually a
 * terminal tab that is very much alive, so liveness decides, not kind.
 */
function commandFor(todo, { live }) {
  if (!todo.sessionId) return null;
  const cd = `cd ${shq(todo.cwd ?? ".")}`;
  const resume = live
    ? `claude --resume ${shq(todo.sessionId)} --fork-session`
    : `claude --resume ${shq(todo.sessionId)}`;
  return { command: `${cd} && ${resume}`, forked: live };
}

export async function openInTerminal(todo, { ownedIsLive }) {
  const built = commandFor(todo, { live: isSessionLive(todo, { ownedIsLive }) });
  if (!built) return { ok: false, reason: "that session has no id to resume" };

  const useIterm = existsSync(ITERM);
  const script = useIterm ? itermScript(built.command) : terminalAppScript(built.command);

  try {
    await run("osascript", ["-e", script], { timeout: 15_000 });
    return { ok: true, forked: built.forked, app: useIterm ? "iTerm" : "Terminal" };
  } catch (err) {
    // Most often this is macOS Automation permission not yet granted.
    return { ok: false, reason: String(err?.stderr || err?.message || err).trim().slice(0, 300) };
  }
}

/** The bare command a person can paste, with the same fork decision. */
export function resumeCommandFor(todo, { ownedIsLive }) {
  if (!todo.sessionId) return null;
  const live = isSessionLive(todo, { ownedIsLive });
  return `claude --resume ${todo.sessionId}${live ? " --fork-session" : ""}`;
}
