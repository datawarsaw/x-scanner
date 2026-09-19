import { test } from "node:test";
import assert from "node:assert/strict";
import { isArticleCandidate, normalizeHref, originPattern, uniqueArticleUrls } from "../../src/shared/links.ts";

test("normalizes hrefs and drops non-http schemes", () => {
  assert.equal(normalizeHref("https://example.com/post#frag"), "https://example.com/post");
  assert.equal(normalizeHref("/relative", "https://example.com/a/b"), "https://example.com/relative");
  assert.equal(normalizeHref("javascript:alert(1)"), null);
  assert.equal(normalizeHref("mailto:a@b.c"), null);
  assert.equal(normalizeHref("data:text/html,x"), null);
  assert.equal(normalizeHref(""), null);
});

test("rejects internal, media and video links and keeps articles", () => {
  assert.equal(isArticleCandidate("https://x.com/someone/status/123"), false);
  assert.equal(isArticleCandidate("https://twitter.com/i/web/status/1"), false);
  assert.equal(isArticleCandidate("https://pic.x.com/abc"), false);
  assert.equal(isArticleCandidate("https://pbs.twimg.com/media/x.jpg"), false);
  assert.equal(isArticleCandidate("https://youtube.com/watch?v=abc"), false);
  assert.equal(isArticleCandidate("https://example.com/photo.png"), false);
  assert.equal(isArticleCandidate("https://example.com/article"), true);
  assert.equal(isArticleCandidate("http://127.0.0.1:8080/article.html"), true);
});

test("keeps t.co so the background can resolve the redirect", () => {
  assert.equal(isArticleCandidate("https://t.co/abc123"), true);
});

test("deduplicates candidates and preserves document order", () => {
  const urls = uniqueArticleUrls(
    [
      "https://example.com/a",
      "https://x.com/status/1",
      "https://example.com/a/",
      "https://example.com/b",
      "https://example.com/a#x",
    ],
    "https://x.com",
  );
  assert.deepEqual(urls, ["https://example.com/a", "https://example.com/b"]);
});

test("origin pattern is a valid match pattern", () => {
  assert.equal(originPattern("https://example.com/deep/path?q=1"), "https://example.com/*");
  assert.equal(originPattern("http://127.0.0.1:8080/a"), "http://127.0.0.1:8080/*");
});

