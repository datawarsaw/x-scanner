import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Hud } from "../../src/content/hud.ts";
import { SessionStats } from "../../src/content/stats.ts";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/shared/settings.ts";

let dom: JSDOM;

const mockManifest = { version: "0.6.3" };

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://x.com/home",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    chrome: {
      runtime: {
        getManifest: () => mockManifest,
      },
    },
  });
  dom.window.localStorage.clear();
});

test("1. default settings resolve Show analysis HUD = OFF", () => {
  assert.equal(DEFAULT_SETTINGS.showAnalysisHud, false);
  const s = normalizeSettings({});
  assert.equal(s.showAnalysisHud, false);
});

test("2. missing legacy field resolves to OFF", () => {
  const legacyV6 = normalizeSettings({ version: 6, apiKey: "key", model: "jev-1" });
  assert.equal(legacyV6.showAnalysisHud, false);

  const partial = normalizeSettings({ apiKey: "key" });
  assert.equal(partial.showAnalysisHud, false);

  const nonBoolean = normalizeSettings({ showAnalysisHud: "true" });
  assert.equal(nonBoolean.showAnalysisHud, false);
});

test("3. HUD OFF -> no HUD root / no visible HUD UI", () => {
  const settings = normalizeSettings({ showAnalysisHud: false });
  const hud = new Hud(() => {});

  if (settings.showAnalysisHud) {
    hud.mount();
  }

  assert.equal(document.querySelector(".xs-hud"), null, "no .xs-hud element in DOM");
  assert.equal(document.querySelector(".xs-collapsed"), null, "no collapsed bar in DOM");
  assert.equal(hud.root.isConnected, false, "HUD root is detached");
});

test("4. HUD ON -> HUD appears", () => {
  const settings = normalizeSettings({ showAnalysisHud: true });
  const hud = new Hud(() => {});

  if (settings.showAnalysisHud) {
    hud.mount();
  }

  const el = document.querySelector(".xs-hud");
  assert.ok(el, "HUD element is mounted in DOM");
  assert.equal(hud.root.isConnected, true, "HUD root is connected");
  assert.ok(document.querySelector(".xs-hud-title"), "title bar is present");
  assert.ok(document.querySelector(".xs-hud-body"), "body is present");
});

test("5. ON -> OFF live -> HUD disappears without reload", () => {
  const hud = new Hud(() => {});
  hud.mount();
  assert.ok(document.querySelector(".xs-hud"), "HUD mounted initially");

  // User changes setting to OFF live:
  hud.unmount();

  assert.equal(document.querySelector(".xs-hud"), null, "HUD root removed from DOM");
  assert.equal(hud.root.isConnected, false, "HUD is completely disconnected");
});

test("6. OFF -> ON live -> HUD appears with current session state", () => {
  const stats = new SessionStats();
  const hud = new Hud(() => {});
  stats.subscribe((s) => hud.update(s));

  // Activity occurs while HUD is OFF
  stats.recordAnalysis({
    costUsd: 0.0042,
    inputTokens: 100,
    latencyMs: 145,
    judgments: 7,
    flagged: true,
    hits: ["density"],
    score: 85,
    id: "post_1",
    kind: "post",
  });
  stats.recordAnalysis({
    costUsd: 0.0038,
    inputTokens: 90,
    latencyMs: 110,
    judgments: 7,
    flagged: false,
    hits: [],
    score: 40,
    id: "post_2",
    kind: "post",
  });

  // HUD was not in DOM during analysis
  assert.equal(document.querySelector(".xs-hud"), null);

  // User enables HUD live:
  hud.mount();
  hud.update(stats.snapshot());

  assert.ok(document.querySelector(".xs-hud"), "HUD is now in DOM");
  const values = Array.from(document.querySelectorAll(".xs-hud-v")).map((e) => e.textContent?.trim());
  assert.equal(values[0], "2", "analyzed count reflects 2 posts analyzed while HUD was OFF");
  assert.equal(values[1], "$0.0080", "cost reflects total spent while HUD was OFF");
  assert.equal(values[2], "110 ms", "last latency reflects most recent call");
});

test("7. hiding HUD does not reset session counters/state", () => {
  const stats = new SessionStats();
  const hud = new Hud(() => {});
  stats.subscribe((s) => hud.update(s));

  // HUD starts ON
  hud.mount();
  stats.recordAnalysis({
    costUsd: 0.005,
    inputTokens: 120,
    latencyMs: 130,
    judgments: 6,
    flagged: false,
    hits: [],
    score: 50,
    id: "p1",
    kind: "post",
  });

  assert.equal(stats.snapshot().analyzed, 1);
  assert.equal(stats.snapshot().costUsd, 0.005);

  // Turn HUD OFF
  hud.unmount();
  assert.equal(document.querySelector(".xs-hud"), null);

  // Session counters must continue operating without reset
  stats.recordAnalysis({
    costUsd: 0.003,
    inputTokens: 80,
    latencyMs: 95,
    judgments: 6,
    flagged: true,
    hits: ["promo"],
    score: 80,
    id: "p2",
    kind: "post",
  });

  const snapWhileHidden = stats.snapshot();
  assert.equal(snapWhileHidden.analyzed, 2, "counter incremented while hidden");
  assert.equal(snapWhileHidden.costUsd, 0.008, "cost accumulated while hidden");
  assert.equal(snapWhileHidden.flagged, 1, "flag count tracked while hidden");

  // Re-enable HUD
  hud.mount();
  hud.update(stats.snapshot());

  assert.ok(document.querySelector(".xs-hud"));
  const values = Array.from(document.querySelectorAll(".xs-hud-v")).map((e) => e.textContent?.trim());
  assert.equal(values[0], "2");
  assert.equal(values[1], "$0.0080");
});

test("8. collapsed HUD behavior still works while HUD enabled", () => {
  const hud = new Hud(() => {});
  hud.mount();

  const title = document.querySelector<HTMLElement>(".xs-hud-title")!;
  assert.ok(title, "title element exists");
  assert.equal(hud.root.classList.contains("xs-collapsed"), false, "starts expanded");

  // Click title to collapse
  title.click();
  assert.equal(hud.root.classList.contains("xs-collapsed"), true, "now collapsed");
  assert.equal(dom.window.localStorage.getItem("xs-hud-collapsed"), "1");

  // When HUD is turned OFF:
  hud.unmount();
  assert.equal(document.querySelector(".xs-hud"), null, "nothing visible when OFF");
  assert.equal(document.querySelector(".xs-collapsed"), null, "no collapsed bar when OFF");

  // When HUD is turned back ON:
  hud.mount();
  assert.ok(document.querySelector(".xs-hud"));
  assert.equal(hud.root.classList.contains("xs-collapsed"), true, "restores collapsed state when ON");

  // Click again to uncollapse
  title.click();
  assert.equal(hud.root.classList.contains("xs-collapsed"), false, "expands again");
  assert.equal(dom.window.localStorage.getItem("xs-hud-collapsed"), "0");
});

test("9. preset switching remains independent of HUD visibility", () => {
  const hud = new Hud(() => {});

  // Switching preset while HUD is OFF
  hud.setPreset("Signal v2");
  assert.equal(document.querySelector(".xs-hud"), null, "HUD remains off");

  // Turning HUD ON reflects the preset
  hud.mount();
  const presetEl = document.querySelector(".xs-hud-preset");
  assert.equal(presetEl?.textContent?.trim(), "· Signal v2");

  // Switching preset while HUD is ON
  hud.setPreset("Default");
  assert.equal(presetEl?.textContent?.trim(), "· Default");

  // Turning HUD OFF again
  hud.unmount();
  assert.equal(document.querySelector(".xs-hud"), null);

  // Switching preset while OFF again
  hud.setPreset("AI Tech");
  hud.mount();
  assert.equal(document.querySelector(".xs-hud-preset")?.textContent?.trim(), "· AI Tech");
});
