import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJevState, contextHash, postCacheKey } from "../../src/shared/context.ts";
import type { TweetState } from "../../src/shared/types.ts";

const post: TweetState = { text: "hello world", is_reply: true, quoted_text: "quoted" };

test("quoted and off modes send the v0.1 payload shape", () => {
  for (const mode of ["off", "quoted"] as const) {
    const state = buildJevState(post, { parent_text: "parent", thread: ["a", "b"] }, mode);
    assert.deepEqual(Object.keys(state).sort(), ["is_reply", "quoted_text", "text"]);
    assert.deepEqual(state, { text: "hello world", quoted_text: "quoted", is_reply: true });
  }
});

test("omits quoted_text when there is no quote, exactly like v0.1", () => {
  const state = buildJevState({ text: "solo", is_reply: false }, {}, "quoted");
  assert.equal("quoted_text" in state, false);
});

test("parent mode adds only parent_text and caps thread context", () => {
  const parent = buildJevState(post, { parent_text: "parent", thread: ["a", "b", "c"] }, "parent");
  assert.equal((parent as { parent_text?: string }).parent_text, "parent");
  assert.equal("thread" in parent, false);
  const thread = buildJevState(post, { parent_text: "parent", thread: ["a", "b", "c"] }, "thread");
  assert.deepEqual((thread as { thread?: string[] }).thread, ["a", "b"]);
});

test("context hash is empty for single-post payloads and stable otherwise", () => {
  const single = buildJevState(post, {}, "quoted");
  assert.equal(contextHash(single), "");
  const withParent = buildJevState(post, { parent_text: "parent" }, "parent");
  assert.equal(contextHash(withParent), contextHash(buildJevState(post, { parent_text: "parent" }, "parent")));
  assert.notEqual(contextHash(withParent), contextHash(buildJevState(post, { parent_text: "other" }, "parent")));
});

test("cache keys never collide between context variants", () => {
  const single = postCacheKey("123", contextHash(buildJevState(post, {}, "quoted")));
  const parent = postCacheKey("123", contextHash(buildJevState(post, { parent_text: "p" }, "parent")));
  assert.equal(single, "123");
  assert.notEqual(single, parent);
  assert.ok(parent.startsWith("123#"));
});

