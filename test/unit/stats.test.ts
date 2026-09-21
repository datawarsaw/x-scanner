import { test } from "node:test";
import assert from "node:assert/strict";
import { RateWindow, SessionStats } from "../../src/content/stats.ts";

test("rate window averages events over the window and forgets old ones", () => {
  const w = new RateWindow(5000);
  w.add(5, 0);
  w.add(5, 1000);
  assert.equal(w.perSecond(1000), 2);
  assert.equal(w.perSecond(4999), 2);
  assert.equal(w.perSecond(5001), 1);
  assert.equal(w.perSecond(9000), 0);
});

test("session stats accumulate and notify", () => {
  let now = 0;
  const s = new SessionStats(() => now);
  const seen: number[] = [];
  s.subscribe((snap) => seen.push(snap.analyzed));
  s.recordResult({ costUsd: 0.00003, inputTokens: 800, latencyMs: 120 }, 5);
  now = 1000;
  s.recordResult({ costUsd: 0.00003, inputTokens: 810, latencyMs: 90 }, 5);
  s.recordCacheHit();
  s.setQueue(3, 6);
  s.recordError("HTTP 529");
  const snap = s.snapshot();
  assert.equal(snap.analyzed, 2);
  assert.equal(snap.inputTokens, 1610);
  assert.equal(snap.lastLatencyMs, 90);
  assert.equal(snap.judgmentsPerSec, 2);
  assert.equal(snap.pending, 3);
  assert.equal(snap.inflight, 6);
  assert.equal(snap.cacheHits, 1);
  assert.equal(snap.errors, 1);
  assert.equal(snap.lastError, "HTTP 529");
  assert.ok(Math.abs(snap.costUsd - 0.00006) < 1e-12);
  assert.deepEqual(seen.slice(0, 3), [0, 1, 2]);
});

test("Signal v2 observations average per component while topics tally separately", () => {
  const s = new SessionStats(() => 0);
  const base = { costUsd: 0.00003, inputTokens: 800, latencyMs: 100, judgments: 7, flagged: false, hits: [], score: 0.8, kind: "post" as const };
  const density = (value: number) => ({ id: "information_density", label: "information density", value });
  s.recordAnalysis({ ...base, id: "1", topic: { id: "ai", label: "AI" }, observations: [density(0.8), { id: "promotion", label: "promo", value: 0.1 }] });
  s.recordAnalysis({ ...base, id: "2", topic: { id: "ai", label: "AI" }, observations: [density(0.5), { id: "promotion", label: "promo", value: 0 }] });
  s.recordAnalysis({ ...base, id: "3", topic: { id: "data_bi", label: "Data / BI" }, observations: [density(0.2)] });
  // A cache hit adds no observation: the averages describe billed results, exactly like dimHits.
  s.recordCacheHit();
  const snap = s.snapshot();
  assert.deepEqual(snap.topics, [
    { id: "ai", label: "AI", n: 2 },
    { id: "data_bi", label: "Data / BI", n: 1 },
  ]);
  assert.deepEqual(snap.averages, [
    { id: "information_density", label: "information density", mean: 50 },
    { id: "promotion", label: "promo", mean: 5 },
  ]);
});

test("a result with no Signal v2 observations leaves both aggregates empty", () => {
  const s = new SessionStats(() => 0);
  s.recordAnalysis({ costUsd: 0, inputTokens: 1, latencyMs: 1, judgments: 1, flagged: false, hits: ["padding"], score: 0.1, id: "1", kind: "post" });
  const snap = s.snapshot();
  assert.deepEqual(snap.topics, []);
  assert.deepEqual(snap.averages, []);
  assert.equal(snap.analyzed, 1);
});
