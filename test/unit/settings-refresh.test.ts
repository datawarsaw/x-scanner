// v0.6.3 coverage: deterministic live settings refresh for Firefox/Zen.
//
// Chromium delivers storage.onChanged to an already-open X tab, but Firefox/Zen does not do so
// reliably for Options-page writes, so Save now also sends an explicit invalidation that the
// background relays to live X tabs over a long-lived port (no new permissions). Storage stays the
// source of truth: every signal re-reads it, and the snapshot key dedupes duplicate signals for
// the same Save. These tests pin that contract without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  notifySettingsChanged,
  SETTINGS_CHANGED,
  SETTINGS_PORT,
  settingsSnapshotKey,
} from "../../src/shared/settings.ts";

test("invalidation channel constants are stable and non-empty", () => {
  assert.equal(SETTINGS_PORT, "x-scanner-settings");
  assert.equal(SETTINGS_CHANGED, "settingsChanged");
});

test("snapshot key is stable for identical settings and moves with the preset", () => {
  const a = normalizeSettings({ selectedPreset: "signal_v2" });
  const b = normalizeSettings({ selectedPreset: "signal_v2" });
  const c = normalizeSettings({ selectedPreset: "default" });
  assert.equal(settingsSnapshotKey(a), settingsSnapshotKey(b));
  assert.notEqual(settingsSnapshotKey(a), settingsSnapshotKey(c));
  assert.notEqual(settingsSnapshotKey(DEFAULT_SETTINGS), settingsSnapshotKey(a));
});

test("snapshot key moves with any applied field, not just the preset", () => {
  const base = normalizeSettings({ selectedPreset: "default" });
  const changed = normalizeSettings({ selectedPreset: "default", analyzeReplies: true });
  assert.notEqual(settingsSnapshotKey(base), settingsSnapshotKey(changed));
});

test("duplicate signals for one Save collapse: same snapshot key means skip", () => {
  // Mirrors the content-script refresh: storage event plus port invalidation for the same Save
  // must not re-render twice.
  let last = "";
  let applied = 0;
  const refresh = (key: string): void => {
    if (key === last) return;
    last = key;
    applied += 1;
  };
  const key = settingsSnapshotKey(normalizeSettings({ selectedPreset: "signal_v2" }));
  refresh(key);
  refresh(key);
  assert.equal(applied, 1);
  refresh(settingsSnapshotKey(normalizeSettings({ selectedPreset: "default" })));
  assert.equal(applied, 2);
});

test("notifySettingsChanged never throws without a listening background", () => {
  assert.doesNotThrow(() => notifySettingsChanged());
});
