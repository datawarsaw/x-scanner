// The route-aware filter is the v0.5.3 fix for direct comments on an individual status page, where X
// renders no "Replying to" row. These are the decisions the content script makes, in isolation.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { routeHandle, routeStatusId, shouldAnalyzePost } from "../../src/content/route.ts";

test("a handle-qualified status route yields its status id", () => {
  assert.equal(routeStatusId("/dave/status/8302"), "8302");
  assert.equal(routeStatusId("/i/status/8302"), "8302");
  assert.equal(routeStatusId("/demo_user/status/2101503264147845514"), "2101503264147845514");
  assert.equal(routeStatusId("/dave/status/8302/photo/1"), "8302");
});

// The native X Article reader builds its canonical URL from this handle, so it has to agree with
// routeStatusId about which routes are individual status pages at all.
test("the same routes also yield the handle segment", () => {
  assert.equal(routeHandle("/dave/status/8302"), "dave");
  assert.equal(routeHandle("/i/status/8302"), "i", "the handle-less form X uses when it cannot name the author");
  assert.equal(routeHandle("/demo_user/status/2101503264147845514"), "demo_user");
  assert.equal(routeHandle("/dave/status/8302/photo/1"), "dave");
  for (const path of ["/", "/home", "/dave", "/search", "/settings", "/status/8302", "/dave/status"]) {
    assert.equal(routeHandle(path), null, path);
  }
});

test("timelines, profiles, search, lists and settings are not status routes", () => {
  for (const path of [
    "/",
    "/home",
    "/dave",
    "/dave/with_replies",
    "/dave/media",
    "/search",
    "/explore",
    "/i/lists/123",
    "/settings",
    "/dave/status",
    "/dave/status/abc",
    "/dave/statusx/8302",
    // X always renders a handle (or /i/) before /status/, so a bare path is not a conversation page.
    "/status/8302",
  ]) {
    assert.equal(routeStatusId(path), null, path);
  }
});

test("off a status page the markup classifier still decides", () => {
  assert.deepEqual(shouldAnalyzePost({ id: "8101", routeId: null, analyzeReplies: false, isReply: false }), { analyze: true });
  assert.deepEqual(shouldAnalyzePost({ id: "8102", routeId: null, analyzeReplies: false, isReply: true }), { analyze: false, reason: "reply" });
});

test("on a status page with replies off only the focal post is analyzed", () => {
  assert.deepEqual(shouldAnalyzePost({ id: "9001", routeId: "9001", analyzeReplies: false, isReply: false }), { analyze: true });
  // The confirmed live miss: a direct comment with no replying row is still not the focal post.
  assert.deepEqual(shouldAnalyzePost({ id: "9002", routeId: "9001", analyzeReplies: false, isReply: false }), { analyze: false, reason: "status-page-non-root" });
  assert.deepEqual(shouldAnalyzePost({ id: "9003", routeId: "9001", analyzeReplies: false, isReply: true }), { analyze: false, reason: "status-page-non-root" });
});

test("replies on analyzes everything again, on every surface", () => {
  for (const routeId of [null, "9001"]) {
    assert.deepEqual(shouldAnalyzePost({ id: "9002", routeId, analyzeReplies: true, isReply: true }), { analyze: true });
    assert.deepEqual(shouldAnalyzePost({ id: "9002", routeId, analyzeReplies: true, isReply: false }), { analyze: true });
  }
});

const dom = new JSDOM(`<!doctype html><html><body>
<article data-testid="tweet" id="focal">
  <div data-testid="User-Name"><a href="/alice"><span>Alice</span></a><a href="/alice/status/9001"><time>1h</time></a></div>
  <div data-testid="tweetText"><span>Shipped the queue rewrite.</span></div>
  <div role="link" tabindex="0">
    <div data-testid="User-Name"><a href="/paul/status/9400"><time>Sep 19</time></a></div>
    <div data-testid="tweetText"><span>Quoted wisdom here</span></div>
  </div>
  <div role="group"></div>
</article>
<article data-testid="tweet" id="comment">
  <div data-testid="User-Name"><a href="/bob"><span>Bob</span></a><a href="/bob/status/9002"><time>1h</time></a></div>
  <div data-testid="tweetText"><span>Direct comment with no replying row.</span></div>
  <div role="group"></div>
</article>
</body></html>`);

let extract: typeof import("../../src/content/extract.ts");

before(async () => {
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node });
  extract = await import("../../src/content/extract.ts");
});

test("a quoted post inside the focal article keeps the outer id, so the focal post is not filtered", () => {
  const article = dom.window.document.getElementById("focal")!;
  const t = extract.extractTweet(article)!;
  assert.equal(t.id, "9001", "the quote's id must not become the article's id");
  assert.equal(t.state.is_reply, false);
  assert.equal(t.state.quoted_text, "Quoted wisdom here");
  assert.deepEqual(shouldAnalyzePost({ id: t.id, routeId: routeStatusId("/alice/status/9001"), analyzeReplies: false, isReply: t.state.is_reply }), { analyze: true });
});

test("a direct comment is filtered by the route even though its markup reads as a post", () => {
  const article = dom.window.document.getElementById("comment")!;
  const t = extract.extractTweet(article)!;
  assert.equal(t.id, "9002");
  assert.equal(t.state.is_reply, false, "the classifier has nothing to go on here");
  assert.deepEqual(shouldAnalyzePost({ id: t.id, routeId: routeStatusId("/alice/status/9001"), analyzeReplies: false, isReply: t.state.is_reply }), { analyze: false, reason: "status-page-non-root" });
});
