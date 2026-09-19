import { test } from "node:test";
import assert from "node:assert/strict";
import { activeDimensions, contextModeFor, isPresetId, PRESET_BY_ID, PRESETS } from "../../src/shared/presets.ts";
import { buildQuestions, DEFAULT_DIMENSIONS, questionsHash } from "../../src/shared/questions.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/settings.ts";
import type { Settings } from "../../src/shared/types.ts";

test("Default preset keeps the v0.1 dimensions byte for byte", () => {
  assert.deepEqual(PRESET_BY_ID.default.dimensions, DEFAULT_DIMENSIONS);
  const settings: Settings = { ...DEFAULT_SETTINGS };
  assert.equal(settings.selectedPreset, "default");
  assert.equal(activeDimensions(settings), settings.dimensions);
  assert.deepEqual(Object.keys(buildQuestions(activeDimensions(settings))), [
    "info_density",
    "engagement_bait",
    "promotion",
    "secondhand",
    "padding",
    "about_jev",
  ]);
});

test("every preset has a distinct question hash so caches never collide", () => {
  const seen = new Map<string, string>();
  for (const p of PRESETS) {
    const h = questionsHash(p.dimensions, "jev-1.13.0");
    assert.equal(seen.has(h), false, `${p.id} collides with ${seen.get(h)}`);
    seen.set(h, p.id);
  }
});

test("switching preset changes what is sent to Jev", () => {
  const base: Settings = { ...DEFAULT_SETTINGS };
  const signal = activeDimensions({ ...base, selectedPreset: "signal" });
  assert.notDeepEqual(
    Object.keys(buildQuestions(signal)),
    Object.keys(buildQuestions(base.dimensions)),
  );
  assert.ok(Object.keys(buildQuestions(signal)).includes("actionable"));
  assert.ok(Object.keys(buildQuestions(PRESET_BY_ID.ai_tech.dimensions)).includes("technical_depth"));
  assert.ok(Object.keys(buildQuestions(PRESET_BY_ID.article.dimensions)).includes("evidence_quality"));
});

test("non-default presets are read-only and independent of user dimensions", () => {
  const mutated = DEFAULT_SETTINGS.dimensions.map((d) => ({ ...d, threshold: d.threshold + 99 }));
  const dims = activeDimensions({ ...DEFAULT_SETTINGS, selectedPreset: "ai_tech", dimensions: mutated });
  assert.equal(dims, PRESET_BY_ID.ai_tech.dimensions);
  assert.notEqual(dims[0]!.threshold, mutated[0]!.threshold);
});

test("context mode defaults to quoted and presets only widen it", () => {
  const base: Settings = { ...DEFAULT_SETTINGS };
  assert.equal(contextModeFor(base), "quoted");
  assert.equal(contextModeFor({ ...base, selectedPreset: "signal" }), "parent");
  assert.equal(contextModeFor({ ...base, selectedPreset: "ai_tech" }), "thread");
  assert.equal(contextModeFor({ ...base, selectedPreset: "ai_tech", threadContextMode: "off" }), "off");
});

test("preset ids are validated", () => {
  assert.equal(isPresetId("default"), true);
  assert.equal(isPresetId("signal"), true);
  assert.equal(isPresetId("nope"), false);
  assert.equal(isPresetId(undefined), false);
});

