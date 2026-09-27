import { test } from "node:test";
import assert from "node:assert/strict";
import { ResultStore } from "../../src/content/store.ts";
import type { AnalysisResult } from "../../src/shared/types.ts";

function fakeResult(id: string, qhash: string, score: number): AnalysisResult {
  return {
    tweetId: id,
    model: "jev-1.13.0",
    answers: {},
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.0001,
    latencyMs: 50,
    at: Date.now(),
    questionsHash: qhash,
    kind: "post",
    signalScore: score,
  };
}

test("ResultStore keeps entries schema-qualified across live questionHash switches", () => {
  const store = new ResultStore("schema_default", 100);
  const resDefault = fakeResult("post_1", "schema_default", 50);
  const resSignalV2 = fakeResult("post_1", "schema_signal_v2", 85);

  store.set("post_1", resDefault);
  assert.equal(store.has("post_1"), true);
  assert.equal(store.get("post_1")?.signalScore, 50);

  // Switch to Signal v2 namespace
  store.setQuestionsHash("schema_signal_v2");
  assert.equal(store.has("post_1"), false, "post_1 is not yet in Signal v2 cache");
  assert.equal(store.get("post_1"), undefined);

  // Store Signal v2 result
  store.set("post_1", resSignalV2);
  assert.equal(store.has("post_1"), true);
  assert.equal(store.get("post_1")?.signalScore, 85);

  // Switch back to Default
  store.setQuestionsHash("schema_default");
  assert.equal(store.has("post_1"), true, "Default cached entry is preserved");
  assert.equal(store.get("post_1")?.signalScore, 50);

  // Switch back to Signal v2
  store.setQuestionsHash("schema_signal_v2");
  assert.equal(store.has("post_1"), true, "Signal v2 cached entry is preserved");
  assert.equal(store.get("post_1")?.signalScore, 85);
});
