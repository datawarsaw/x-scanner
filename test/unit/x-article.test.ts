// Native X Article detection and extraction. The fixture carries every evidence layer plus each way
// an ordinary post could be mistaken for an article: a large image, a long link card, a long post
// with no heading, a short label, and long prose that only exists inside a quoted post.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

/** Long prose blocks: past the length at which a line counts as article body rather than a label. */
const P1 =
  "The scheduler rewrite started as a boring question about how much of our p99 tail came from the per-request lock rather than from the storage layer behind it, and answering it took six weeks.";
const P2 =
  "Throughput rose 41% once the lock became a sharded queue, but only after we stopped letting the queue grow without a bound, because keeping it shallow and shedding load into a retry budget mattered more.";
const P3 =
  "Two regressions followed the rollout and both were our own fault: a stale shard counter made the autoscaler over-provision for 40 minutes, and a missing deadline on the drain path caused a p99 spike.";
const P4 =
  "The honest summary is that the queue was never the bottleneck, it was simply the only place we looked, and a latency budget per request path enforced in review did more than any code we shipped.";
const P5 =
  "None of this needed a new queue implementation: the sharding we already had was fine, and the win came from two weeks of measuring request paths instead of arguing about which database to adopt next.";
/** An opening block with two sentences, for the title fallback when nothing rendered a heading. */
const T1 =
  "The scheduler rewrite started as a boring question. How much of our p99 tail came from the per-request lock rather than from the storage layer behind it took six weeks and twelve clusters to answer.";
/** Prose that must never be read as article text: it belongs to a quoted post or to a link card. */
const Q1 =
  "Quoted long paragraph that belongs to the post being quoted and must never reach the article body of the post quoting it, however long it is.";
const Q2 =
  "Second quoted long paragraph, also belonging to the quoted post, used to prove that a quote alone can never manufacture an article body.";

const WORDS: Record<string, string> = { P1, P2, P3, P4, P5, T1, Q1, Q2 };
const FIXTURE = readFileSync(path.join(import.meta.dirname, "../fixture/x-article-cases.html"), "utf8").replace(
  /\[\[([PQT]\d)\]\]/g,
  (_m, key: string) => WORDS[key] ?? "",
);
const dom = new JSDOM(FIXTURE);

let x: typeof import("../../src/content/x-article.ts");

before(async () => {
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node });
  x = await import("../../src/content/x-article.ts");
});

/** Read one fixture post as if its own status route were the page. */
function read(id: string, route: string, maxChars = 8000) {
  return x.extractNativeArticle(dom.window.document.getElementById(id)!, `https://x.com${route}`, maxChars);
}

test("reads a native article: canonical url, title, lead and body paragraphs in order", () => {
  const a = read("native", "/alice/status/9001");
  assert.ok(a, "a native article was detected");
  assert.equal(a.statusId, "9001");
  assert.equal(a.url, "https://x.com/alice/status/9001");
  assert.equal(a.title, "Why the scheduler rewrite paid off");
  assert.equal(a.subtitle, "A field report from twelve production clusters, and what it cost us to find out.");
  assert.equal(a.text, `${P1}\n\n${P2}`);
  assert.equal(a.truncated, false);
  assert.equal(a.charCount, a.text.length);
  assert.equal(a.evidence, "heading+body");
  assert.match(a.cacheKey, /^x-native:9001:[0-9a-f]{8}$/);
});

test("the post's own text, its quote, its image and its chrome stay out of the article body", () => {
  const a = read("native", "/alice/status/9001")!;
  assert.doesNotMatch(a.text, /Short post lead/);
  assert.doesNotMatch(a.text, /A field report from twelve/);
  assert.doesNotMatch(a.text, /Quoted wisdom/);
  assert.doesNotMatch(a.text, /Quoted long paragraph/);
  assert.doesNotMatch(a.text, /latency dashboard/);
  assert.doesNotMatch(a.text, /reply|repost|like/);
});

test("an ordinary post with a large image and a long link card is not a native article", () => {
  assert.equal(read("card", "/bob/status/9002"), null);
});

test("an ordinary long post is a post, not an article, even at article length", () => {
  assert.equal(read("longpost", "/carol/status/9003"), null);
});

test("a short label is not an article heading", () => {
  assert.equal(read("shortlabel", "/frank/status/9007"), null);
});

test("long prose inside a quoted post cannot make the quoting post an article", () => {
  assert.equal(read("quoteprobe", "/gina/status/9008"), null);
});

test("X's own article container name detects a reader that has no heading", () => {
  const a = read("container", "/dave/status/9005");
  assert.ok(a);
  assert.equal(a.evidence, "container:twitterArticleReadView");
  assert.equal(a.title, "The scheduler rewrite started as a boring question.", "the opening sentence becomes the title");
  assert.equal(a.text, `${P1}\n\n${P2}`, "the opening block is the title, the rest is the body");
});

test("an untitled long form with no post text is detected by its length alone", () => {
  const a = read("untitled", "/erin/status/9006");
  assert.ok(a);
  assert.equal(a.evidence, "longform");
  assert.equal(a.text, `${P2}\n\n${P3}\n\n${P4}\n\n${P5}`);
});

test("whitespace is collapsed deterministically", () => {
  const a = read("aria", "/dave/status/9004");
  assert.ok(a);
  assert.equal(a.title, "A field guide to sharded queues");
  assert.equal(
    a.subtitle,
    "Leading whitespace and a hard wrap that must collapse to single spaces, plus enough extra words here to push this paragraph comfortably past the length a short lead-in line would have.",
  );
  assert.equal(a.text, P3);
  assert.equal(a.subtitle?.includes("  "), false);
});

test("truncation reuses the article character cap and its ellipsis", () => {
  const a = read("native", "/alice/status/9001", 120);
  assert.ok(a);
  assert.equal(a.truncated, true);
  assert.ok(a.charCount <= 121, String(a.charCount));
  assert.ok(a.text.endsWith("\u2026"));
  assert.equal(read("native", "/alice/status/9001", 120)!.text, a.text, "the cap is deterministic");
});

test("only the post whose own status id is the route's status id is an article", () => {
  const native = dom.window.document.getElementById("native")!;
  assert.equal(x.extractNativeArticle(native, "https://x.com/home", 8000), null);
  assert.equal(x.extractNativeArticle(native, "https://x.com/alice", 8000), null);
  assert.equal(x.extractNativeArticle(native, "https://x.com/dave/status/9412", 8000), null, "another post's route");
  assert.ok(x.extractNativeArticle(native, "/alice/status/9001", 8000), "a relative page url still resolves");
});

test("a post with no permalink is never a native article", () => {
  const bare = dom.window.document.createElement("article");
  bare.setAttribute("data-testid", "tweet");
  bare.innerHTML = `<h1>A title with no permalink at all</h1><p>${P1}</p><p>${P2}</p>`;
  assert.equal(x.extractNativeArticle(bare, "https://x.com/alice/status/9001", 8000), null);
});

test("the same article reads identically twice and its cache key follows its content", () => {
  const a = read("native", "/alice/status/9001")!;
  assert.deepEqual(read("native", "/alice/status/9001"), a);

  const same = dom.window.document.getElementById("native")!.cloneNode(true) as Element;
  assert.equal(x.extractNativeArticle(same, "https://x.com/alice/status/9001", 8000)!.cacheKey, a.cacheKey);

  const edited = dom.window.document.getElementById("native")!.cloneNode(true) as Element;
  edited.querySelectorAll("p")[1]!.textContent =
    "A completely different second body paragraph, long enough to count as body text, changed after the first read so the cache must not serve the old result to anyone.";
  const after = x.extractNativeArticle(edited, "https://x.com/alice/status/9001", 8000);
  assert.ok(after);
  assert.notEqual(after.cacheKey, a.cacheKey, "edited content is a different cache entry");
  assert.equal(after.statusId, a.statusId, "but the same post");
});
