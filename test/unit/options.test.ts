import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { DEFAULT_SETTINGS } from "../../src/shared/settings.ts";
import type { Settings } from "../../src/shared/types.ts";
import { PRESET_BY_ID } from "../../src/shared/presets.ts";

const HTML_PATH = path.resolve(import.meta.dirname, "../../src/options/options.html");
const HTML_CONTENT = readFileSync(HTML_PATH, "utf8");

interface StorageRecord {
  settings?: Settings;
  [key: string]: unknown;
}

let storageData: StorageRecord = {};
let saveShouldFail = false;
let dom: JSDOM;
let optionsModule: typeof import("../../src/options/options.ts");

const mockChrome = {
  runtime: {
    getManifest: () => ({ version: "0.6.3" }),
    sendMessage: async () => ({ ok: true }),
  },
  storage: {
    local: {
      get: async (key: string | null) => {
        if (typeof key === "string") return { [key]: storageData[key] };
        return { ...storageData };
      },
      set: async (obj: Record<string, unknown>) => {
        if (saveShouldFail) throw new Error("Storage write error");
        Object.assign(storageData, obj);
      },
      remove: async (key: string) => {
        delete storageData[key];
      },
    },
  },
  permissions: {
    contains: async () => true,
    request: async () => true,
    remove: async () => true,
  },
};

before(async () => {
  dom = new JSDOM(HTML_CONTENT, { url: "chrome-extension://mock-id/options.html" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    Event: dom.window.Event,
    chrome: mockChrome,
  });
  optionsModule = await import("../../src/options/options.ts");
});

beforeEach(async () => {
  saveShouldFail = false;
  storageData = { settings: { ...DEFAULT_SETTINGS, selectedPreset: "default" } };
  dom.window.document.body.innerHTML = new JSDOM(HTML_CONTENT).window.document.body.innerHTML;
  await optionsModule.initOptions();
});

test("1. Signal v2 selected: summary is visible and Default editor is not active", async () => {
  const doc = dom.window.document;
  const sel = doc.querySelector<HTMLSelectElement>("#preset")!;
  sel.value = "signal_v2";
  sel.dispatchEvent(new dom.window.Event("change"));

  // Signal v2 summary identity and badge
  assert.equal(doc.querySelector("#presetSummaryName")?.textContent, "Signal v2");
  assert.equal(doc.querySelector("#presetSummaryBadge")?.textContent, "7 fixed dimensions");
  assert.ok((doc.querySelector("#presetSummaryDesc")?.textContent ?? "").includes("Topic + useful-signal classification"));

  // Check exact 7 Signal v2 dimensions from code definition
  const chips = Array.from(doc.querySelectorAll("#presetSummaryDims .preset-dim-chip")).map((c) => c.textContent?.trim());
  assert.deepEqual(chips, ["Topic", "Density", "Insight", "Evidence", "Actionable", "Promo", "Bait"]);

  // Default editor is collapsed and not presented as active
  const defaultEditor = doc.querySelector<HTMLElement>("#defaultDimEditor")!;
  assert.equal(defaultEditor.classList.contains("collapsed"), true, "Default editor is collapsed");

  const notice = doc.querySelector<HTMLElement>("#defaultDimNotice")!;
  assert.equal(notice.style.display, "block", "Default dimensions notice is visible");
  assert.match(notice.textContent ?? "", /Default dimensions are preserved and will be used again when you switch back to Default/);

  assert.equal(doc.querySelector("#dimensionsPresetBadge")?.textContent, "Inactive (Default only)");
});

test("2. Default selected: Default editor is visible and editable normally", async () => {
  const doc = dom.window.document;
  const sel = doc.querySelector<HTMLSelectElement>("#preset")!;

  // Switch to signal_v2 then back to default
  sel.value = "signal_v2";
  sel.dispatchEvent(new dom.window.Event("change"));
  sel.value = "default";
  sel.dispatchEvent(new dom.window.Event("change"));

  const defaultEditor = doc.querySelector<HTMLElement>("#defaultDimEditor")!;
  assert.equal(defaultEditor.classList.contains("collapsed"), false, "Default editor is not collapsed");

  const notice = doc.querySelector<HTMLElement>("#defaultDimNotice")!;
  assert.equal(notice.style.display, "none", "Default dimensions notice is hidden");

  assert.equal(doc.querySelector("#dimensionsPresetBadge")?.textContent, "Active for Default preset");
  assert.equal(doc.querySelectorAll(".dim").length, 6, "Default editor contains editable cards");
});

test("3. preset changed: UI indicates Unsaved changes and distinguishes selected vs saved", async () => {
  const doc = dom.window.document;
  const sel = doc.querySelector<HTMLSelectElement>("#preset")!;

  // Initially saved
  assert.equal(doc.querySelector("#saveStatus")?.textContent, "Saved");
  assert.equal(doc.querySelector("#selectedPresetState")?.textContent, "Default");
  assert.equal(doc.querySelector("#savedPresetState")?.textContent, "Default");

  // Change preset
  sel.value = "signal_v2";
  sel.dispatchEvent(new dom.window.Event("change"));

  assert.equal(doc.querySelector("#saveStatus")?.textContent, "Unsaved changes");
  assert.equal(doc.querySelector("#saveTopStatus")?.textContent, "Unsaved changes");
  assert.equal(doc.querySelector("#selectedPresetState")?.textContent, "Signal v2");
  assert.equal(doc.querySelector("#savedPresetState")?.textContent, "Default");
  assert.equal(doc.querySelector("#presetSummaryActiveLabel")?.textContent, "Selected (Unsaved)");
});

test("4. successful Save: state becomes Saved and persists to storage", async () => {
  const doc = dom.window.document;
  const sel = doc.querySelector<HTMLSelectElement>("#preset")!;
  sel.value = "signal_v2";
  sel.dispatchEvent(new dom.window.Event("change"));

  // Trigger Save
  const ok = await optionsModule.performSave();
  assert.equal(ok, true);

  assert.equal(doc.querySelector("#saveStatus")?.textContent, "Saved");
  assert.equal(doc.querySelector("#saveTopStatus")?.textContent, "Saved");
  assert.equal(doc.querySelector("#saveOut")?.textContent, "saved");
  assert.equal(doc.querySelector("#saveTopOut")?.textContent, "saved");
  assert.equal(doc.querySelector("#selectedPresetState")?.textContent, "Signal v2");
  assert.equal(doc.querySelector("#savedPresetState")?.textContent, "Signal v2");
  assert.equal(doc.querySelector("#presetSummaryActiveLabel")?.textContent, "Active (Saved)");

  assert.equal(storageData.settings?.selectedPreset, "signal_v2");
});

test("5. save failure: visible failure state on storage error or invalid inputs", async () => {
  const doc = dom.window.document;
  const sel = doc.querySelector<HTMLSelectElement>("#preset")!;
  sel.value = "signal_v2";
  sel.dispatchEvent(new dom.window.Event("change"));

  // Force storage error
  saveShouldFail = true;
  const ok = await optionsModule.performSave();
  assert.equal(ok, false);

  assert.equal(doc.querySelector("#saveStatus")?.textContent, "Save failed");
  assert.equal(doc.querySelector("#saveTopStatus")?.textContent, "Save failed");
  assert.match(doc.querySelector("#saveOut")?.textContent ?? "", /failed: Storage write error/);

  // Validation failure (e.g. empty dimension id or duplicate)
  saveShouldFail = false;
  const firstIdInput = doc.querySelector<HTMLInputElement>(".dim .d-id")!;
  firstIdInput.value = ""; // invalid
  const okValidation = await optionsModule.performSave();
  assert.equal(okValidation, false);
  assert.ok((doc.querySelector("#saveOut")?.textContent ?? "").startsWith("fix "));
  assert.notEqual(doc.querySelector("#saveStatus")?.textContent, "Saved");
});

test("6. existing preset persistence and disclosure control toggle work", async () => {
  const doc = dom.window.document;
  const sel = doc.querySelector<HTMLSelectElement>("#preset")!;
  sel.value = "signal_v2";
  sel.dispatchEvent(new dom.window.Event("change"));

  const defaultEditor = doc.querySelector<HTMLElement>("#defaultDimEditor")!;
  const toggleBtn = doc.querySelector<HTMLButtonElement>("#toggleDefaultDims")!;

  // Default editor is collapsed initially
  assert.equal(defaultEditor.classList.contains("collapsed"), true);
  assert.equal(toggleBtn.textContent?.trim(), "Show Default preset dimensions");

  // Click disclosure button to expand
  toggleBtn.click();
  assert.equal(defaultEditor.classList.contains("collapsed"), false);
  assert.equal(toggleBtn.textContent?.trim(), "Hide Default preset dimensions");

  // Click again to collapse
  toggleBtn.click();
  assert.equal(defaultEditor.classList.contains("collapsed"), true);
  assert.equal(toggleBtn.textContent?.trim(), "Show Default preset dimensions");

  // Save preset
  await optionsModule.performSave();
  assert.equal(storageData.settings?.selectedPreset, "signal_v2");
});

test("7. Show analysis HUD checkbox: unchecked by default, dirty on toggle, persists on save", async () => {
  const doc = dom.window.document;
  const hudCheck = doc.querySelector<HTMLInputElement>("#showAnalysisHud")!;
  assert.ok(hudCheck, "showAnalysisHud input exists");
  assert.equal(hudCheck.checked, false, "unchecked by default");
  assert.equal(doc.querySelector("#saveStatus")?.textContent, "Saved");

  // Toggle ON
  hudCheck.checked = true;
  hudCheck.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

  assert.equal(doc.querySelector("#saveStatus")?.textContent, "Unsaved changes");

  // Save
  const ok = await optionsModule.performSave();
  assert.equal(ok, true);
  assert.equal(doc.querySelector("#saveStatus")?.textContent, "Saved");
  assert.equal(storageData.settings?.showAnalysisHud, true);

  // Toggle back OFF
  hudCheck.checked = false;
  hudCheck.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(doc.querySelector("#saveStatus")?.textContent, "Unsaved changes");

  const okOff = await optionsModule.performSave();
  assert.equal(okOff, true);
  assert.equal(storageData.settings?.showAnalysisHud, false);
});
