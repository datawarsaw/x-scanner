// Captures 1280x800 listing screenshots on the fixture pages with the fake Jev server.
// Usage: npm run screenshots  (builds dist-e2e first). Output: store/screenshot-{1..5}.png:
// 1 Signal v2 timeline, 2 Signal v2 detail card, 3 settings with Signal v2 selected,
// 4 session intelligence, 5 native X Article analysis.
// Fixture-based: no real user's posts ever appear.
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { startServer } from "../test/e2e/server.ts";
import { chromePath } from "../test/e2e/chrome.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist-e2e");
const OUT = path.join(ROOT, "store");
const PROFILE = path.join(ROOT, "test/e2e/.profile-store");

const server = await startServer(path.join(ROOT, "test/fixture"));
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });
mkdirSync(OUT, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: chromePath(),
  ignoreDefaultArgs: ["--disable-extensions"],
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--no-first-run", "--hide-scrollbars"],
});
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  const base = `http://127.0.0.1:${server.port}`;
  await sw.evaluate(async (baseUrl: string) => {
    await chrome.storage.local.set({
      settings: {
        apiKey: "test-key",
        baseUrl,
        scope: "all",
        dwellMs: 0,
        concurrency: 6,
        selectedPreset: "signal_v2",
        version: 7,
      },
    });
  }, base);

  const page = await ctx.newPage();
  await page.goto(`${base}/timeline.html?repeat=1`);
  await page.waitForFunction(
    () => document.querySelectorAll('.xs-slot[data-state="done"][data-display="normalized"]').length >= 1,
    null,
    { timeout: 20000 },
  );
  // Scroll like a reader so the panel has numbers, then park where flags are visible.
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(250);
  }
  const target = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => a.textContent?.includes("Notion system"));
    return art ? art.getBoundingClientRect().top + window.scrollY - 90 : 0;
  });
  await page.evaluate((y: number) => window.scrollTo({ top: y }), target);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "screenshot-1.png") });

  await page.click('.xs-slot[data-state="done"]');
  await page.waitForSelector(".xs-detail");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "screenshot-2.png") });

  const extId = new URL(sw.url()).host;
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html`);
  await options.waitForSelector("#preset");
  await options.evaluate(() => document.querySelector("#presetSummary")?.scrollIntoView({ block: "center" }));
  await options.waitForTimeout(300);
  await options.screenshot({ path: path.join(OUT, "screenshot-3.png") });

  await page.locator(".xs-hud-gear", { hasText: "session" }).click();
  await page.waitForSelector(".xs-session");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "screenshot-4.png") });

  const article = await ctx.newPage();
  await article.goto(`${base}/akshay_pachaar/status/2035341800739877091`);
  await article.waitForFunction(() => document.querySelectorAll('.xs-slot[data-state="done"]').length >= 1, null, {
    timeout: 20000,
  });
  await article.waitForTimeout(1200);
  await article.click('.xs-article-btn[data-xs-native="true"]');
  await article.waitForFunction(
    () => /tok/.test(document.querySelector(".xs-article-card")?.textContent ?? ""),
    null,
    { timeout: 20000 },
  );
  await article.waitForTimeout(300);
  await article.screenshot({ path: path.join(OUT, "screenshot-5.png") });
  console.log(`wrote 5 screenshots to ${OUT}`);
} finally {
  await ctx.close();
  server.close();
}
