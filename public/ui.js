// Small helpers shared by the panels and the world.

/**
 * The suit a session wears, by status: on its card's corners, and on the
 * soldier at Court. Anything not listed has stopped, and shows ♠.
 */
export const SUITS = { "needs-you": "♥", working: "♦", idle: "♣" };

export const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
};

export function toast(text) {
  const t = el("div", { className: "toast", textContent: text });
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

export async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) toast(data.error ?? "Something went wrong.");
  return { ok: res.ok, data };
}

/** "4m", "3h", "2d" — for labels that have to stay narrow. */
export function ago(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
