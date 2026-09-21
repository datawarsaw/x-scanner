import { test } from "node:test";
import assert from "node:assert/strict";
import { activeDimensions, contextModeFor, PRESET_BY_ID, PRESETS } from "../../src/shared/presets.ts";
import { buildQuestions, DEFAULT_DIMENSIONS, questionsHash } from "../../src/shared/questions.ts";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/shared/settings.ts";
import { normalized, rawDetail, verdicts } from "../../src/content/labels.ts";
import { signalScore } from "../../src/shared/score.ts";
import type { Answer, Dimension, Verdict } from "../../src/shared/types.ts";

const V2 = PRESET_BY_ID.signal_v2.dimensions;
const V2_IDS = ["topic", "information_density", "original_insight", "evidence", "actionable", "promotion", "engagement_bait"];

/** The reference fixture: the values the E2E server also reports for Signal v2. */
const FIXTURE: Record<string, Answer> = {
  topic: { type: "choice", choice: "ai", confidence: 0.9, probabilities: { ai: 0.72, software_engineering: 0.18, tech_industry: 0.07, other: 0.03 } },
  information_density: { type: "score", score: 2.4, confidence: 0.9, probabilities: {}, legend: {} },
  original_insight: { type: "score", score: 1.8, confidence: 0.9, probabilities: {}, legend: {} },
  evidence: { type: "score", score: 2.1, confidence: 0.9, probabilities: {}, legend: {} },
  actionable: { type: "score", score: 1.5, confidence: 0.9, probabilities: {}, legend: {} },
  promotion: { type: "noul", noul: 0.1 },
  engagement_bait: { type: "noul", noul: 0.05 },
};

test("Signal v2 asks exactly the seven declared dimensions and nothing else", () => {
  assert.deepEqual(V2.map((d) => d.id), V2_IDS);
  assert.deepEqual(Object.keys(buildQuestions(V2)), V2_IDS);
  assert.deepEqual(V2.map((d) => d.type), ["choice", "score", "score", "score", "score", "noul", "noul"]);
  for (const gone of ["about_jev", "jevpilled", "secondhand", "padding", "filler", "info_density", "originality"]) {
    assert.equal(V2.some((d) => d.id === gone || d.label === gone), false, gone);
  }
});

test("Signal v2 identifies itself as experimental and is never auto-selected", () => {
  assert.equal(PRESET_BY_ID.signal_v2.label, "Signal v2");
  assert.equal(PRESET_BY_ID.signal_v2.description, "Topic + useful-signal classification. Experimental.");
  assert.equal(PRESET_BY_ID.signal_v2.contentType, "post");
  assert.equal(DEFAULT_SETTINGS.selectedPreset, "default");
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS }).selectedPreset, "default");
  assert.equal(normalizeSettings({ version: 7 }).selectedPreset, "default");
  assert.equal(normalizeSettings({ version: 7, selectedPreset: "signal_v2" }).selectedPreset, "signal_v2");
  assert.equal(normalizeSettings({ version: 7, selectedPreset: "nope" }).selectedPreset, "default");
});

test("Default and the legacy Signal preset keep their questions byte for byte", () => {
  assert.deepEqual(PRESET_BY_ID.default.dimensions, DEFAULT_DIMENSIONS);
  assert.deepEqual(Object.keys(buildQuestions(PRESET_BY_ID.default.dimensions)), [
    "info_density",
    "engagement_bait",
    "promotion",
    "secondhand",
    "padding",
    "about_jev",
  ]);
  assert.deepEqual(PRESET_BY_ID.signal.dimensions.map((d) => d.id), [
    "info_density",
    "actionable",
    "originality",
    "evidence",
    "promotion",
    "engagement_bait",
  ]);
  assert.equal(PRESET_BY_ID.signal.label, "Signal (legacy)", "relabelled so it stays unambiguous beside Signal v2");
});

test("every preset, Signal v2 included, has its own question hash", () => {
  const seen = new Map();
  for (const p of PRESETS) {
    const h = questionsHash(p.dimensions, "jev-1.13.0");
    assert.equal(seen.has(h), false, p.id + " collides with " + seen.get(h));
    seen.set(h, p.id);
  }
  assert.equal(seen.get(questionsHash(V2, "jev-1.13.0")), "signal_v2");
});

test("a score and a noul share the 0..100 range without sharing a meaning", () => {
  const scoreDim: Dimension = {
    id: "information_density",
    label: "information density",
    short: "density",
    type: "score",
    instructions: "x",
    levels: ["a", "b", "c", "d"],
    threshold: 2.5,
    direction: "above",
    enabled: true,
  };
  const noulDim: Dimension = {
    id: "promotion",
    label: "promo",
    type: "noul",
    instructions: "x",
    criteria: { true: "t", false: "f" },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  };
  const scoreAnswers = (v: number): Record<string, Answer> => ({
    information_density: { type: "score", score: v, confidence: 1, probabilities: {}, legend: {} },
  });
  const noulAnswers = (v: number): Record<string, Answer> => ({ promotion: { type: "noul", noul: v } });
  const one = (dims: Dimension[], answers: Record<string, Answer>): Verdict => verdicts(dims, answers)[0]!;

  assert.equal(normalized(one([scoreDim], scoreAnswers(0))), 0);
  assert.equal(normalized(one([scoreDim], scoreAnswers(1.5))), 50);
  assert.equal(normalized(one([scoreDim], scoreAnswers(2.4))), 80);
  assert.equal(normalized(one([scoreDim], scoreAnswers(3))), 100);
  assert.equal(normalized(one([noulDim], noulAnswers(0))), 0);
  assert.equal(normalized(one([noulDim], noulAnswers(0.12))), 12);
  assert.equal(normalized(one([noulDim], noulAnswers(1))), 100);

  // Out-of-range values clamp rather than overflowing the bar.
  assert.equal(normalized(one([scoreDim], scoreAnswers(99))), 100);
  assert.equal(normalized(one([scoreDim], scoreAnswers(-4))), 0);

  // Details keep the raw semantics under the shared range.
  assert.equal(rawDetail(one([scoreDim], scoreAnswers(2.4))), "Raw score: 2.4 / 3");
  assert.equal(rawDetail(one([noulDim], noulAnswers(0.12))), "Probability true: 12%");
});

test("the reference fixture reads exactly as the documented compact row", () => {
  const vs = verdicts(V2, FIXTURE);
  const compact = vs.map((v) => (v.type === "choice" ? v.choice!.label : v.short + " " + normalized(v)));
  assert.deepEqual(compact, ["AI", "density 80", "insight 60", "evidence 70", "actionable 50", "promo 10", "bait 5"]);
  // Nothing in the fixture is unusual enough to flag, so the row opens with the clean marker.
  assert.deepEqual(vs.filter((v) => v.show), []);
  assert.deepEqual(vs[0]!.choice!.candidates.map((c) => c.label + " " + Math.round(c.p * 100) + "%"), [
    "AI 72%",
    "Software Engineering 18%",
    "Tech Industry 7%",
    "Other 3%",
  ]);
});

test("Signal v2 exposes no aggregate score anywhere", () => {
  const ranking = signalScore("signal_v2", V2, FIXTURE);
  // Session ranking reads one named component; no weighted composite is defined for this preset.
  assert.ok(Math.abs(ranking - 2.4 / 3) < 1e-9, String(ranking));
  assert.equal(signalScore("signal_v2", V2, {}), 0);
});

test("Signal v2 context stays bounded to the parent, exactly like the legacy Signal preset", () => {
  const settings = { ...DEFAULT_SETTINGS, selectedPreset: "signal_v2" as const };
  assert.equal(contextModeFor(settings), "parent");
  assert.equal(contextModeFor({ ...settings, threadContextMode: "off" }), "off");
  assert.equal(contextModeFor({ ...settings, threadContextMode: "thread" }), "thread");
  assert.equal(activeDimensions(settings), PRESET_BY_ID.signal_v2.dimensions);
});

