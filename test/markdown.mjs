// markdown.js: what Claude's replies use comes out as structure, and nothing
// in a reply — HTML, a javascript: link — gets to be more than text.
import { markdown } from "../public/markdown.js";

const fail = (msg) => { console.error(`FAIL: markdown — ${msg}`); process.exit(1); };

// A plain tree instead of the DOM: { tag, attrs, children }, strings for text.
const h = (tag, attrs = {}, children = []) => ({ tag, attrs, children });
const all = (n, tag, out = []) => {
  if (typeof n === "string") return out;
  if (n.tag === tag) out.push(n);
  for (const c of n.children) all(c, tag, out);
  return out;
};
const text = (n) => (typeof n === "string" ? n : n.children.map(text).join(""));

// The kind of reply that prompted this: headings, bold, a link list.
const reply = markdown(`## What I'd actually do: take a taxi from the airport

Straight from the Terminal 3 rank, 30–40 minutes. Reckon on **¥13,000–18,000** including tolls.

A booked private transfer lands in much the same range —
worth considering.

## A middle path

- ride to **Tokyo Station** and judge it there
- missed it? take a taxi, about **¥7,000–9,000**
  - nested: check the *weekend* timetable

1. first
2. second

Sources: [JR East — Maihama](https://timetables.jreast.co.jp/en/timetable/list1414.html), [Haneda](https://www.haneda-tokyo-access.com/en/)`, h);

const h2 = all(reply, "h2");
if (h2.length !== 2 || text(h2[0]) !== "What I'd actually do: take a taxi from the airport") fail("headings weren't read as headings");
if (!all(reply, "strong").some((s) => text(s) === "¥13,000–18,000")) fail("bold wasn't read as bold");
if (all(reply, "p").length < 3) fail("paragraphs ran together");
if (!all(reply, "br").length) fail("a line break inside a paragraph was lost");
const uls = all(reply, "ul");
if (uls.length !== 2 || !all(uls[0], "ul").includes(uls[1])) fail("the nested list didn't nest");
if (!all(reply, "em").some((e) => text(e) === "weekend")) fail("italics weren't read");
if (all(reply, "ol")[0]?.children.length !== 2) fail("the numbered list wasn't read");
const links = all(reply, "a");
if (links.length !== 2 || links[0].attrs.href !== "https://timetables.jreast.co.jp/en/timetable/list1414.html") fail("links weren't read");
if (links.some((a) => a.attrs.rel !== "noopener noreferrer" || a.attrs.target !== "_blank")) fail("links open without noopener");

// Code: fenced and inline, and nothing inside either is read as markdown.
const code = markdown("Run `npm **test**` then:\n\n```sh\nls *.js | head\n# not a heading\n```", h);
if (text(all(code, "code")[0]) !== "npm **test**") fail("markdown inside inline code was read");
const pre = all(code, "pre")[0];
if (!pre || text(pre) !== "ls *.js | head\n# not a heading" || all(pre, "h1").length) fail("the fenced block wasn't kept as it was");

// Tables, quotes, rules.
const table = markdown("| Route | Cost |\n|---|--:|\n| Taxi | ¥15,000 |\n| Train | ¥1,200 |\n\n> a quote\n\n---", h);
if (all(table, "tr").length !== 3 || all(table, "th").length !== 2) fail("the table wasn't read");
if (all(table, "td")[1].attrs.style !== "text-align:right") fail("column alignment was lost");
if (!all(table, "blockquote").length || !all(table, "hr").length) fail("quote or rule wasn't read");

// Nothing gets to be HTML, and only safe links are links.
const hostile = markdown('<img src=x onerror="alert(1)"> [click](javascript:alert(1)) [ok](https://example.com)', h);
const tags = new Set();
(function walk(n) { if (typeof n !== "string") { tags.add(n.tag); n.children.forEach(walk); } })(hostile);
if (tags.has("img") || tags.has("script")) fail("HTML in a reply became an element");
if (!text(hostile).includes('<img src=x onerror="alert(1)">')) fail("HTML in a reply wasn't kept as text");
const hrefs = all(hostile, "a").map((a) => a.attrs.href);
if (hrefs.length !== 1 || hrefs[0] !== "https://example.com") fail(`a javascript: link survived: ${JSON.stringify(hrefs)}`);

// Plain text is untouched.
const plain = markdown("just words, 2 * 3 = 6", h);
if (text(plain) !== "just words, 2 * 3 = 6") fail(`plain text changed: ${text(plain)}`);

console.log("PASS: markdown — headings, lists, code, tables, links; HTML and javascript: stay text");
