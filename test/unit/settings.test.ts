import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/shared/settings.ts";

test("fills defaults for a missing or partial object", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  const s = normalizeSettings({ apiKey: "  k  ", accountHandle: "@Someone", scope: "weird", concurrency: 99, dwellMs: -5 });
  assert.equal(s.apiKey, "k");
  assert.equal(s.accountHandle, "Someone");
  assert.equal(s.scope, "all");
  assert.equal(s.concurrency, 32);
  assert.equal(s.dwellMs, 0);
  assert.equal(s.lookaheadPx, 800);
  assert.equal(s.version, 7);
  assert.equal(s.dimensions.length, 6);
});

test("v0.5 fields default to Default preset, articles on, quoted-only context", () => {
  const s = normalizeSettings(undefined);
  assert.equal(s.selectedPreset, "default");
  assert.equal(s.articleAnalysisEnabled, true);
  assert.equal(s.threadContextMode, "quoted");
  assert.equal(s.maxArticleChars, 8000);
  assert.equal(s.articleCacheMax, 200);
  assert.equal(s.analyzeReplies, false);
});

test("replies are skipped by default and only turn on when explicitly set", () => {
  assert.equal(DEFAULT_SETTINGS.analyzeReplies, false);
  assert.equal(normalizeSettings(undefined).analyzeReplies, false);
  assert.equal(normalizeSettings({}).analyzeReplies, false);
  assert.equal(normalizeSettings({ analyzeReplies: true }).analyzeReplies, true);
  assert.equal(normalizeSettings({ analyzeReplies: false }).analyzeReplies, false);
  assert.equal(normalizeSettings({ analyzeReplies: "yes" }).analyzeReplies, false);
});

test("a pre-v7 install gains the reply default and keeps everything else", () => {
  const s = normalizeSettings({
    version: 6,
    apiKey: "keep-me",
    selectedPreset: "ai_tech",
    articleAnalysisEnabled: false,
    threadContextMode: "thread",
    dimensions: [{ id: "mine", label: "mine", type: "noul", instructions: "?", threshold: 0.5 }],
  });
  assert.equal(s.analyzeReplies, false);
  assert.equal(s.apiKey, "keep-me");
  assert.equal(s.selectedPreset, "ai_tech");
  assert.equal(s.articleAnalysisEnabled, false);
  assert.equal(s.threadContextMode, "thread");
  assert.deepEqual(s.dimensions.map((d) => d.id), ["mine"]);
});

test("an existing v5 install keeps its settings and gains Default preset", () => {
  const s = normalizeSettings({
    version: 5,
    apiKey: "keep-me",
    model: "jev-1.13.0",
    dimensions: [{ id: "mine", label: "mine", type: "noul", instructions: "?", threshold: 0.5 }],
  });
  assert.equal(s.apiKey, "keep-me");
  assert.equal(s.selectedPreset, "default");
  assert.deepEqual(
    s.dimensions.map((d) => d.id),
    ["mine"],
  );
});

test("unknown preset, context and out-of-range numbers fall back safely", () => {
  const s = normalizeSettings({
    selectedPreset: "made_up",
    threadContextMode: "everything",
    maxArticleChars: 999999,
    articleCacheMax: -5,
    articleAnalysisEnabled: "yes",
  });
  assert.equal(s.selectedPreset, "default");
  assert.equal(s.threadContextMode, "quoted");
  assert.equal(s.maxArticleChars, 40000);
  assert.equal(s.articleCacheMax, 20);
  assert.equal(s.articleAnalysisEnabled, true);
});

test("recognized presets and context modes round-trip", () => {
  assert.equal(normalizeSettings({ selectedPreset: "ai_tech" }).selectedPreset, "ai_tech");
  assert.equal(normalizeSettings({ selectedPreset: "article" }).selectedPreset, "article");
  assert.equal(normalizeSettings({ threadContextMode: "thread" }).threadContextMode, "thread");
  assert.equal(normalizeSettings({ threadContextMode: "off" }).threadContextMode, "off");
  assert.equal(normalizeSettings({ articleAnalysisEnabled: false }).articleAnalysisEnabled, false);
});

test("keeps custom dimensions and normalizes their shape", () => {
  const s = normalizeSettings({
    version: 4,
    dimensions: [{ id: "x", label: "x", type: "noul", instructions: "?", threshold: "0.7" }],
  });
  assert.equal(s.dimensions.length, 1);
  assert.equal(s.dimensions[0]!.threshold, 0.7);
  assert.deepEqual(s.dimensions[0]!.criteria, { true: "", false: "" });
  assert.equal(s.dimensions[0]!.enabled, true);
});

test("migrates renamed default labels but leaves custom labels alone", () => {
  const s = normalizeSettings({
    dimensions: [
      { id: "info_density", label: "dense", type: "score", instructions: "?", levels: ["a", "b"], threshold: 1 },
      { id: "padding", label: "my own word", type: "score", instructions: "?", levels: ["a", "b"], threshold: 1 },
    ],
  });
  assert.equal(s.dimensions[0]!.label, "fact-dense");
  assert.equal(s.dimensions[1]!.label, "my own word");
});

test("moves a v1 install's saved 200 ms dwell to the new default, keeps a deliberate value", () => {
  assert.equal(normalizeSettings({ dwellMs: 200 }).dwellMs, 0);
  assert.equal(normalizeSettings({ dwellMs: 350 }).dwellMs, 350);
  assert.equal(normalizeSettings({ dwellMs: 200, version: 2 }).dwellMs, 200);
});

test("moves a pre-v3 install's saved home scope to all, keeps a deliberate v3 choice", () => {
  assert.equal(normalizeSettings({ scope: "home" }).scope, "all");
  assert.equal(normalizeSettings({ scope: "home", version: 2 }).scope, "all");
  assert.equal(normalizeSettings({ scope: "home", version: 3 }).scope, "home");
});

test("appends dimensions added after the stored version, but not ones the user removed since", () => {
  const five = { id: "x", label: "x", type: "noul", instructions: "?", threshold: 0.5 };
  const old = normalizeSettings({ dimensions: [five], version: 3 });
  assert.deepEqual(
    old.dimensions.map((d) => d.id),
    ["x", "about_jev"],
  );
  const current = normalizeSettings({ dimensions: [five], version: 5 });
  assert.deepEqual(
    current.dimensions.map((d) => d.id),
    ["x"],
  );
});

test("renames jev to jevpilled and gives a pre-v5 about_jev its red, keeping a chosen color", () => {
  const base = { id: "about_jev", type: "noul", instructions: "?", threshold: 0.75 };
  const migrated = normalizeSettings({ version: 4, dimensions: [{ ...base, label: "jev" }] });
  assert.equal(migrated.dimensions[0]!.label, "jevpilled");
  assert.equal(migrated.dimensions[0]!.color, "#f4212e");
  const chosen = normalizeSettings({ version: 4, dimensions: [{ ...base, label: "jev", color: "#00AA00" }] });
  assert.equal(chosen.dimensions[0]!.color, "#00aa00");
  const bad = normalizeSettings({ version: 5, dimensions: [{ ...base, label: "x", color: "red" }] });
  assert.equal(bad.dimensions[0]!.color, undefined);
});
