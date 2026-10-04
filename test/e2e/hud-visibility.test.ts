// E2E coverage for Show analysis HUD setting.
// Verifies default OFF state (no HUD element, annotations visible),
// live appearance on enabling HUD via Options without reload,
// live disappearance on disabling HUD, and preservation of session counters.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { chromium, type BrowserContext, type Worker } from "playwright-core";
import { startServer } from "./server.ts";
import { chromePath } from "./chrome.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, "dist-e2e");
const FIXTURE = path.join(ROOT, "test/fixture");

interface SessionSettings {
  apiKey: string;
  baseUrl: string;
  scope?: string;
  dwellMs?: number;
  concurrency?: number;
  selectedPreset?: string;
  showAnalysisHud?: boolean;
}

async function launch(profileSuffix: string) {
  assert.ok(existsSync(path.join(DIST, "manifest.json")), "run `npm run build:e2e` first");
  const profile = path.join(ROOT, "test/e2e/.profile-" + profileSuffix);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(),
    ignoreDefaultArgs: ["--disable-extensions"],
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1100, height: 900 },
    args: ["--disable-extensions-except=" + DIST, "--load-extension=" + DIST, "--no-first-run", "--hide-scrollbars"],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  return { ctx, sw: sw as Worker, extId: new URL(sw.url()).host };
}

async function configure(sw: Worker, settings: SessionSettings): Promise<void> {
  await sw.evaluate(async (s: SessionSettings) => {
    await chrome.storage.local.set({ settings: s });
  }, settings);
}

async function setHudThroughOptions(ctx: BrowserContext, extId: string, show: boolean): Promise<void> {
  const page = await ctx.newPage();
  await page.goto("chrome-extension://" + extId + "/options.html");
  await page.waitForSelector("#showAnalysisHud");
  const isChecked = await page.isChecked("#showAnalysisHud");
  if (isChecked !== show) {
    await page.click("#showAnalysisHud");
  }
  await page.click("#save");
  await page.waitForFunction(() => document.querySelector("#saveOut")?.textContent === "saved");
  await page.close();
}

test("HUD visibility: OFF by default, live toggle ON/OFF preserves session and annotations", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw, extId } = await launch("hud-visibility");
  t.after(async () => {
    await ctx.close();
    server.close();
  });

  // 1. Configure settings without showAnalysisHud (tests default OFF resolution)
  await configure(sw, {
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${server.port}`,
    scope: "all",
    dwellMs: 0,
    concurrency: 6,
    selectedPreset: "signal_v2",
  });

  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${server.port}/annotation.html`);

  // 2. Wait for Signal v2 annotations to render
  await page.waitForFunction(
    () => document.querySelectorAll('.xs-slot[data-state="done"][data-display="normalized"]').length >= 2,
    null,
    { timeout: 20000 },
  );

  // 3. Verify NO HUD element on page by default (neither expanded nor collapsed)
  const hudPresentInitial = await page.evaluate(() => {
    return {
      hud: document.querySelector(".xs-hud") !== null,
      collapsed: document.querySelector(".xs-collapsed") !== null,
    };
  });
  assert.equal(hudPresentInitial.hud, false, "HUD is not in DOM by default");
  assert.equal(hudPresentInitial.collapsed, false, "no collapsed HUD bar in DOM by default");

  // 4. Verify annotations are present and visible
  const initialAnnotationCount = await page.locator('.xs-slot[data-state="done"]').count();
  assert.ok(initialAnnotationCount >= 2, "annotations are visible with HUD OFF");

  // 5. Enable HUD in Settings and Save
  await setHudThroughOptions(ctx, extId, true);

  // 6. Verify HUD appears immediately on open tab WITHOUT reload
  await page.waitForSelector(".xs-hud", { timeout: 10000 });
  const hudLive = await page.evaluate(() => {
    const root = document.querySelector(".xs-hud");
    const title = document.querySelector(".xs-hud-title")?.textContent ?? "";
    const vals = Array.from(document.querySelectorAll(".xs-hud-v")).map((e) => (e.textContent || "").trim());
    return {
      connected: root !== null && root.isConnected,
      title,
      analyzed: Number(vals[0] ?? 0),
    };
  });
  assert.equal(hudLive.connected, true, "HUD is connected and visible");
  assert.match(hudLive.title, /Signal v2/);
  assert.ok(hudLive.analyzed >= 2, `HUD displays session state: ${hudLive.analyzed} analyzed`);

  // Annotations still present
  assert.ok((await page.locator('.xs-slot[data-state="done"]').count()) >= 2, "annotations remain when HUD is ON");

  // 7. Disable HUD in Settings and Save
  await setHudThroughOptions(ctx, extId, false);

  // 8. Verify every HUD element disappears completely immediately without reload
  await page.waitForFunction(() => document.querySelector(".xs-hud") === null, null, { timeout: 10000 });
  const hudAfterOff = await page.evaluate(() => {
    return {
      hud: document.querySelector(".xs-hud"),
      collapsed: document.querySelector(".xs-collapsed"),
    };
  });
  assert.equal(hudAfterOff.hud, null, "HUD root completely removed");
  assert.equal(hudAfterOff.collapsed, null, "no collapsed element remains");

  // 9. Verify annotations remain visible
  assert.ok((await page.locator('.xs-slot[data-state="done"]').count()) >= 2, "annotations remain when HUD is disabled");

  // 10. Re-enable HUD and verify session state is preserved (not reset)
  await setHudThroughOptions(ctx, extId, true);
  await page.waitForSelector(".xs-hud", { timeout: 10000 });

  const hudRestored = await page.evaluate(() => {
    const vals = Array.from(document.querySelectorAll(".xs-hud-v")).map((e) => (e.textContent || "").trim());
    return {
      analyzed: Number(vals[0] ?? 0),
    };
  });
  assert.ok(hudRestored.analyzed >= hudLive.analyzed, "session counters preserved after re-enabling HUD");
});
