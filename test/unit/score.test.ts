import { test } from "node:test";
import assert from "node:assert/strict";
import { isHighSignal, signalScore } from "../../src/shared/score.ts";
import { PRESET_BY_ID } from "../../src/shared/presets.ts";
import type { Answer, Dimension } from "../../src/shared/types.ts";

const dims: Dimension[] = PRESET_BY_ID.signal.dimensions;
const strong: Record<string, Answer> = {
  info_density: { type: "score", score: 3, confidence: 1, probabilities: {}, legend: {} },
  actionable: { type: "noul", noul: 0.95 },
  originality: { type: "noul", noul: 0.9 },
  evidence: { type: "noul", noul: 0.9 },
  promotion: { type: "noul", noul: 0.02 },
  engagement_bait: { type: "noul", noul: 0.03 },
};
const weak: Record<string, Answer> = {
  info_density: { type: "score", score: 0, confidence: 1, probabilities: {}, legend: {} },
  actionable: { type: "noul", noul: 0.1 },
  originality: { type: "noul", noul: 0.1 },
  evidence: { type: "noul", noul: 0.05 },
  promotion: { type: "noul", noul: 0.9 },
  engagement_bait: { type: "noul", noul: 0.95 },
};

test("signal score is bounded, deterministic and ordered", () => {
  const a = signalScore("signal", dims, strong);
  const b = signalScore("signal", dims, strong);
  assert.equal(a, b);
  assert.ok(a > 0.5, String(a));
  assert.ok(a <= 1);
  const low = signalScore("signal", dims, weak);
  assert.ok(low < 0.2, String(low));
  assert.ok(low >= 0);
  assert.ok(a > low);
});

test("scoring is stable when a dimension is missing", () => {
  const { promotion: _drop, ...partial } = strong;
  const s = signalScore("signal", dims, partial);
  assert.ok(Number.isFinite(s));
  assert.ok(s > 0.5);
});

test("ai_tech and article presets score on their own dimensions", () => {
  const ai = signalScore("ai_tech", PRESET_BY_ID.ai_tech.dimensions, {
    technical_depth: { type: "score", score: 3, confidence: 1, probabilities: {}, legend: {} },
    evidence_benchmark: { type: "noul", noul: 0.9 },
    genuinely_new: { type: "noul", noul: 0.9 },
    implementation_relevance: { type: "noul", noul: 0.9 },
  });
  assert.ok(ai > 0.7, String(ai));
  const article = signalScore("article", PRESET_BY_ID.article.dimensions, {
    info_density: { type: "score", score: 3, confidence: 1, probabilities: {}, legend: {} },
    evidence_quality: { type: "noul", noul: 0.9 },
    sourcing: { type: "noul", noul: 0.9 },
    originality: { type: "noul", noul: 0.9 },
    actionable_insight: { type: "noul", noul: 0.9 },
  });
  assert.ok(article > 0.8, String(article));
});

test("the high-signal cut is applied to the score", () => {
  assert.equal(isHighSignal(0.5), true);
  assert.equal(isHighSignal(0.49), false);
});

