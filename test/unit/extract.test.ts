import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!doctype html><html><body>
<nav><a data-testid="AppTabBar_Profile_Link" href="/demo_user"></a></nav>
<article data-testid="tweet" id="plain">
  <div><div data-testid="User-Name"><a href="/alice"><span>Alice</span></a><a href="/alice/status/1001"><time datetime="2026-09-18T00:00:00Z">2h</time></a></div></div>
  <div data-testid="tweetText"><span>Shipping today </span><img alt="🚀" src="x.png"><span> see </span><a href="https://t.co/abc">example.com/post</a><span>\nsecond line</span></div>
  <div role="group"><button>reply</button></div>
</article>
<article data-testid="tweet" id="quote">
  <div data-testid="User-Name"><a href="/bob/status/2002"><time>1h</time></a></div>
  <div data-testid="tweetText"><span>This.</span></div>
  <div role="link" tabindex="0">
    <div data-testid="User-Name"><a href="/carol/status/3003"><time>3h</time></a></div>
    <div data-testid="tweetText"><span>Quoted wisdom here</span></div>
  </div>
  <div role="group"></div>
</article>
<article data-testid="tweet" id="promoted">
  <div><span>Dave</span><span>Ad</span><a href="/dave/status/4004"><time>now</time></a></div>
  <div data-testid="tweetText"><span>Buy the thing</span></div>
  <div role="group"></div>
</article>
<article data-testid="tweet" id="reply">
  <div><a href="/erin/status/5005"><time>4h</time></a></div>
  <div><span>Replying to </span><a href="/alice">@alice</a></div>
  <div data-testid="tweetText"><span>Agreed.</span></div>
  <div role="group"></div>
</article>
<article data-testid="tweet" id="noid">
  <div data-testid="tweetText"><span>No permalink yet</span></div>
</article>
<article data-testid="tweet" id="quoteinner">
  <div data-testid="User-Name"><a href="/frank/status/6006"><time>5h</time></a></div>
  <div data-testid="tweetText"><span>Worth reading.</span></div>
  <div role="link" tabindex="0">
    <div data-testid="User-Name"><a href="/gina/status/7007"><time>6h</time></a></div>
    <div><span>Replying to </span><a href="/someone">@someone</a></div>
    <div data-testid="tweetText"><span>Their reply, quoted by me.</span></div>
  </div>
  <div role="group"></div>
</article>
</body></html>`);

let extract: typeof import("../../src/content/extract.ts");

before(async () => {
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node });
  extract = await import("../../src/content/extract.ts");
});

test("reads id, text with emoji and links, and line breaks", () => {
  const t = extract.extractTweet(dom.window.document.getElementById("plain")!)!;
  assert.equal(t.id, "1001");
  assert.equal(t.state.text, "Shipping today 🚀 see example.com/post\nsecond line");
  assert.equal(t.state.is_reply, false);
  assert.equal(t.state.quoted_text, undefined);
  assert.equal(t.promoted, false);
});

test("separates the quoted post from the main text and picks the outer id", () => {
  const t = extract.extractTweet(dom.window.document.getElementById("quote")!)!;
  assert.equal(t.id, "2002");
  assert.equal(t.state.text, "This.");
  assert.equal(t.state.quoted_text, "Quoted wisdom here");
});

test("flags promoted posts", () => {
  const t = extract.extractTweet(dom.window.document.getElementById("promoted")!)!;
  assert.equal(t.promoted, true);
  assert.equal(t.id, "4004");
});

test("flags replies", () => {
  const t = extract.extractTweet(dom.window.document.getElementById("reply")!)!;
  assert.equal(t.state.is_reply, true);
});

test("returns null without a permalink", () => {
  assert.equal(extract.extractTweet(dom.window.document.getElementById("noid")!), null);
});

test("reads the logged in handle from the nav", () => {
  assert.equal(extract.loggedInHandle(dom.window.document), "demo_user");
});

// The reply filter depends on these classifications, so pin them down explicitly.
test("a root post is not a reply", () => {
  assert.equal(extract.isReply(dom.window.document.getElementById("plain")!), false);
  assert.equal(extract.isReply(dom.window.document.getElementById("promoted")!), false);
  assert.equal(extract.isReply(dom.window.document.getElementById("noid")!), false);
});

test("a post that quotes a reply is not itself a reply", () => {
  const article = dom.window.document.getElementById("quoteinner")!;
  assert.equal(extract.isReply(article), false);
  assert.equal(extract.extractTweet(article)!.state.is_reply, false);
});

test("a reply marker inside the post itself is detected", () => {
  assert.equal(extract.isReply(dom.window.document.getElementById("reply")!), true);
  assert.equal(extract.isReply(dom.window.document.getElementById("quote")!), false);
});
