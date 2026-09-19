import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { extractReadable } from "../../src/shared/article.ts";

const FIXTURE = readFileSync(path.join(import.meta.dirname, "../fixture/article.html"), "utf8");

function parse(html: string): Document {
  return new JSDOM(html).window.document;
}

test("prefers canonical url, og title and the article body", () => {
  const a = extractReadable(FIXTURE, "https://example.com/original?a=1", 8000, parse);
  assert.equal(a.url, "https://example.com/canonical-path");
  assert.equal(a.title, "A Dense Article About Systems");
  assert.equal(a.siteName, "Example Journal");
  assert.equal(a.domain, "example.com");
  assert.equal(a.truncated, false);
  assert.match(a.text, /Throughput rose 41%/);
  assert.match(a.text, /99th percentile/);
});

test("drops navigation, chrome and scripts", () => {
  const a = extractReadable(FIXTURE, "https://example.com/x", 8000, parse);
  assert.doesNotMatch(a.text, /Copyright 2026/);
  assert.doesNotMatch(a.text, /Subscribe to our newsletter/);
  assert.doesNotMatch(a.text, /window\.__analytics/);
  assert.doesNotMatch(a.text, /display: none/);
});

test("falls back to og:url, then to the fetched url", () => {
  const html = `<html><head><meta property="og:url" content="https://example.com/og" />
    <meta property="og:title" content="T" /></head><body><article><p>${"x".repeat(80)}</p></article></body></html>`;
  assert.equal(extractReadable(html, "https://example.com/fetched", 8000, parse).url, "https://example.com/og");
  const bare = `<html><head><title>T</title></head><body><article><p>${"y".repeat(80)}</p></article></body></html>`;
  assert.equal(extractReadable(bare, "https://example.com/fetched", 8000, parse).url, "https://example.com/fetched");
});

test("truncates deterministically at a word boundary and flags it", () => {
  const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
  const html = `<html><head><title>T</title></head><body><article><p>${words.join(" ")}</p></article></body></html>`;
  const a = extractReadable(html, "https://example.com/t", 300, parse);
  assert.equal(a.truncated, true);
  assert.ok(a.charCount <= 301, String(a.charCount));
  assert.ok(a.text.endsWith("…"));
  assert.equal(extractReadable(html, "https://example.com/t", 300, parse).text, a.text);
});

test("falls back to body text when there is no article container", () => {
  const html = "<html><head><title>T</title></head><body><div>Some readable prose that is long enough to matter.</div></body></html>";
  const a = extractReadable(html, "https://example.com/f", 8000, parse);
  assert.match(a.text, /Some readable prose/);
});

