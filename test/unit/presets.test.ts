import { test } from "node:test";
import assert from "node:assert/strict";
import { activeDimensions, activeQuestions, contextModeFor, isPresetId, PRESET_BY_ID, PRESETS } from "../../src/shared/presets.ts";
import { buildQuestions, DEFAULT_DIMENSIONS, questionsHash } from "../../src/shared/questions.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/settings.ts";
import type { Dimension, Settings } from "../../src/shared/types.ts";

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

test("the enablement guard resolves the active preset instead of the editable legacy dimensions", () => {
  // A reader who runs a preset has no reason to keep the Default dimensions enabled. The guard used to
  // read exactly this array, so it reported "no dimensions enabled" while seven were being asked.
  const legacyOff = DEFAULT_SETTINGS.dimensions.map((d) => ({ ...d, enabled: false }));
  const v2: Settings = { ...DEFAULT_SETTINGS, selectedPreset: "signal_v2", dimensions: legacyOff };
  assert.equal(Object.keys(buildQuestions(v2.dimensions)).length, 0, "the legacy set on its own is empty");
  assert.deepEqual(Object.keys(activeQuestions(v2)), [
    "topic",
    "information_density",
    "original_insight",
    "evidence",
    "actionable",
    "promotion",
    "engagement_bait",
  ]);

  // Every preset resolves through the same function, and none of them consults the editable set.
  assert.equal(Object.keys(activeQuestions({ ...v2, selectedPreset: "signal" })).length, 6);
  assert.equal(Object.keys(activeQuestions({ ...v2, selectedPreset: "ai_tech" })).length, 6);
  assert.equal(Object.keys(activeQuestions({ ...v2, selectedPreset: "article" })).length, 8);

  // Default is unchanged: it still asks its own editable dimensions, disabled ones included.
  assert.equal(Object.keys(activeQuestions({ ...DEFAULT_SETTINGS, dimensions: legacyOff })).length, 0);
  assert.deepEqual(Object.keys(activeQuestions(DEFAULT_SETTINGS)), Object.keys(buildQuestions(DEFAULT_DIMENSIONS)));

  // A dimension the reader added for Default is not consulted while a preset is active.
  const custom: Dimension[] = [
    ...DEFAULT_SETTINGS.dimensions,
    { ...DEFAULT_SETTINGS.dimensions[0]!, id: "custom_one", label: "custom" },
  ];
  assert.equal("custom_one" in activeQuestions({ ...DEFAULT_SETTINGS, dimensions: custom }), true);
  assert.equal("custom_one" in activeQuestions({ ...DEFAULT_SETTINGS, selectedPreset: "signal_v2", dimensions: custom }), false);

  // The guard and the request share one source, so they cannot disagree about what is active.
  const active: Settings = { ...DEFAULT_SETTINGS, selectedPreset: "signal_v2" };
  assert.deepEqual(activeQuestions(active), buildQuestions(activeDimensions(active)));
});

