// Claude's replies are markdown; this sets them as such in the panels.
//
// It builds nodes rather than an HTML string, and never touches innerHTML:
// a session's words can quote anything it read, so a "<script>" in them has
// to stay the text it is. Links are kept only for http(s) and mailto.
//
// Covers what replies actually use — headings, paragraphs, bold, italics,
// strikethrough, inline and fenced code, lists (nested), quotes, rules,
// tables and links — not the whole of CommonMark.
//
// `h(tag, attrs, children)` makes a node; the default makes DOM elements, and
// the test passes its own so it can run in node.

const domH = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of children) n.append(c);
  return n;
};

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const safeHref = (url) => (/^(https?:|mailto:)/i.test(url) ? url : null);

/* ----------------------------------------------------------------- inline */

/** Spans in priority order: code first, so nothing inside it is read as markdown. */
const SPANS = [
  { re: /`([^`]+)`/, make: (m, h) => h("code", {}, [m[1]]) },
  {
    re: /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/,
    make: (m, h) => link(m[2], inline(m[1], h), h),
  },
  { re: /<((?:https?:\/\/|mailto:)[^>\s]+)>/, make: (m, h) => link(m[1], [m[1]], h) },
  { re: /\*\*(.+?)\*\*|__(.+?)__/, make: (m, h) => h("strong", {}, inline(m[1] ?? m[2], h)) },
  { re: /~~(.+?)~~/, make: (m, h) => h("del", {}, inline(m[1], h)) },
  { re: /\*(?!\s)(.+?)\*|(?<![\w])_(?!\s)(.+?)_(?![\w])/, make: (m, h) => h("em", {}, inline(m[1] ?? m[2], h)) },
  // bare addresses, so a pasted URL is still something you can click
  { re: /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/, make: (m, h) => link(m[0], [m[0]], h) },
];

function link(url, children, h) {
  const href = safeHref(url);
  return href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, children) : h("span", {}, children);
}

/** Inline markdown to nodes. Single newlines inside a paragraph are kept as breaks. */
function inline(text, h) {
  const out = [];
  let rest = text;
  while (rest) {
    let best = null;
    for (const s of SPANS) {
      const m = s.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { s, m };
    }
    if (!best) { pushText(out, rest, h); break; }
    if (best.m.index) pushText(out, rest.slice(0, best.m.index), h);
    out.push(best.s.make(best.m, h));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

function pushText(out, text, h) {
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (i) out.push(h("br"));
    if (line) out.push(line);
  });
}

/* ------------------------------------------------------------------ block */

const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST.test(line);
const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, "    ").length;
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function blocks(lines, h) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // the closing fence
      const attrs = fence[2] ? { "data-lang": fence[2] } : {};
      out.push(h("pre", attrs, [h("code", {}, [body.join("\n")])]));
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push(h(`h${heading[1].length}`, {}, inline(heading[2], h)));
      i++;
      continue;
    }

    if (RULE.test(line)) { out.push(h("hr")); i++; continue; }

    if (line.includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : null));
      const cell = (tag, text, k) => h(tag, align[k] ? { style: `text-align:${align[k]}` } : {}, inline(text, h));
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(h("tr", {}, cells(lines[i]).map((c, k) => cell("td", c, k))));
        i++;
      }
      out.push(h("div", { class: "md-table" }, [h("table", {}, [
        h("thead", {}, [h("tr", {}, head.map((c, k) => cell("th", c, k)))]),
        h("tbody", {}, rows),
      ])]));
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ""));
      out.push(h("blockquote", {}, blocks(body, h)));
      continue;
    }

    if (LIST.test(line)) {
      const [node, next] = list(lines, i, h);
      out.push(node);
      i = next;
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !(lines[i].includes("|") && TABLE_RULE.test(lines[i + 1] ?? ""))) {
      para.push(lines[i++].trim());
    }
    out.push(h("p", {}, inline(para.join("\n"), h)));
  }
  return out;
}

/** A list starting at line `i`, and the line after it. Deeper-indented items nest. */
function list(lines, i, h) {
  const first = LIST.exec(lines[i]);
  const indent = indentOf(lines[i]);
  const ordered = /\d/.test(first[2]);
  const items = [];
  while (i < lines.length) {
    const m = LIST.exec(lines[i]);
    if (!m || indentOf(lines[i]) !== indent || /\d/.test(m[2]) !== ordered) break;
    const body = [m[3]];
    const children = [];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        // a blank line ends the list unless it carries on below
        const next = lines[i + 1];
        if (next && (indentOf(next) > indent || (LIST.test(next) && indentOf(next) === indent))) { i++; continue; }
        break;
      }
      if (LIST.test(l) && indentOf(l) > indent) {
        const [sub, after] = list(lines, i, h);
        children.push(sub);
        i = after;
        continue;
      }
      if (LIST.test(l) || (indentOf(l) <= indent && startsBlock(l))) break;
      body.push(l.trim());
      i++;
    }
    items.push(h("li", {}, [...inline(body.join("\n"), h), ...children]));
  }
  const attrs = ordered && parseInt(first[2], 10) !== 1 ? { start: String(parseInt(first[2], 10)) } : {};
  return [h(ordered ? "ol" : "ul", attrs, items), i];
}

/** Markdown to a `div.md` of nodes. */
export function markdown(text, h = domH) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  return h("div", { class: "md" }, blocks(lines, h));
}
