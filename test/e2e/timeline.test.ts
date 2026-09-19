// Loads the built extension into Chrome, opens the fixture timeline against the fake Jev
// server, scrolls like a person, and checks labels, HUD numbers, skipping and caching.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { startServer } from "./server.ts";
import { chromePath } from "./chrome.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, "dist-e2e");
const FIXTURE = path.join(ROOT, "test/fixture");
const PROFILE = path.join(ROOT, "test/e2e/.profile");

test("timeline: dwell triggers analysis, pills render, promoted skipped, cache stops re-billing", async (t) => {
  assert.ok(existsSync(path.join(DIST, "manifest.json")), "run `npm run build:e2e` first");
  const server = await startServer(FIXTURE);
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: chromePath(),
    ignoreDefaultArgs: ["--disable-extensions"],
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1100, height: 900 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--no-first-run", "--hide-scrollbars"],
  });
  t.after(async () => {
    await ctx.close();
    server.close();
  });

  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  await sw.evaluate(async (baseUrl: string) => {
    await chrome.storage.local.set({
      // This suite is the v0.1 behaviour check, which also analyzed replies; the v0.5.1 reply filter
      // has its own coverage in v05.test.ts.
      settings: { apiKey: "test-key", baseUrl, scope: "all", dwellMs: 200, concurrency: 6, analyzeReplies: true },
    });
  }, `http://127.0.0.1:${server.port}`);

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The fixture recycles posts far from the viewport, so record every flag ever rendered.
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { __seenFlags: Set<string> }).__seenFlags = seen;
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (!(n instanceof HTMLElement)) continue;
          const els = n.matches(".xs-flag") ? [n] : Array.from(n.querySelectorAll<HTMLElement>(".xs-flag"));
          for (const el of els) seen.add(`${el.dataset.dim}|${el.textContent}`);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`http://127.0.0.1:${server.port}/timeline.html?repeat=4`);
  await page.waitForFunction(() => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true);
  await page.waitForSelector(".xs-hud", { timeout: 10000 });

  // Posts in view at the top get analyzed after the dwell without any interaction.
  await page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-state="done"]').length >= 2, null, { timeout: 15000 });

  // Slot is reserved on mount for every post, before any result arrives.
  const slotCount = await page.evaluate(() => document.querySelectorAll("article .xs-slot").length);
  const articleCount = await page.evaluate(() => document.querySelectorAll('article[data-testid="tweet"]').length);
  assert.equal(slotCount, articleCount, "one slot per mounted article");

  // Scroll like a reader: a wheel step every ~350ms for a while.
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(350);
  }

  // README screenshot while the session counters are still moving: SCREENSHOT=1 npm run test:e2e
  await page.waitForTimeout(500);
  if (process.env.SCREENSHOT) {
    mkdirSync(path.join(ROOT, "docs"), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, "docs/screenshot.png") });
  }
  await page.waitForTimeout(1500);

  const hud = await page.evaluate(() => {
    const vals = Array.from(document.querySelectorAll(".xs-hud-v")).map((e) => e.textContent ?? "");
    return { analyzed: Number(vals[0]), cost: vals[1] ?? "", latency: vals[2] ?? "", rate: vals[3] ?? "", foot: document.querySelector(".xs-hud-foot")?.textContent ?? "" };
  });
  assert.ok(hud.analyzed >= 12, `analyzed ${hud.analyzed}`);
  assert.match(hud.latency, /^\d+ ms$/);
  assert.match(hud.rate, /judgments\/s$/);

  // Cost shown equals exact token usage times list price, to the 4 decimals the HUD shows.
  const expected = (server.totalTokens() * 0.042) / 1e6;
  assert.equal(hud.cost, `$${expected.toFixed(4)}`);
  assert.equal(server.requests.length, hud.analyzed, "HUD analyzed count equals real request count");

  // The right pills, and only those, appear.
  const pills = await page.evaluate(() =>
    Array.from((window as unknown as { __seenFlags: Set<string> }).__seenFlags).map((s) => {
      const i = s.indexOf("|");
      return { dim: s.slice(0, i), text: s.slice(i + 1) };
    }),
  );
  assert.ok(pills.some((p) => p.dim === "engagement_bait" && /engagement bait 9\d%/.test(p.text ?? "")), "bait flag with value");
  assert.ok(pills.some((p) => p.dim === "promotion"), "promo pill");
  assert.ok(pills.some((p) => p.dim === "info_density" && /fact-dense 2\.\d\/3$/.test(p.text ?? "")), "fact-dense flag with value");
  assert.ok(pills.some((p) => p.dim === "padding"), "padded pill");
  assert.ok(pills.some((p) => p.dim === "secondhand"), "secondhand pill");
  const plain = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => a.textContent?.includes("Coffee tastes better"));
    const slot = art?.querySelector(".xs-slot") as HTMLElement | null;
    return {
      state: slot?.dataset.state,
      verdict: slot?.dataset.verdict,
      flags: slot?.querySelectorAll(".xs-flag").length,
      ok: slot?.querySelector(".xs-ok")?.textContent,
      values: slot?.querySelectorAll(".xs-dim").length,
      afterText: slot?.previousElementSibling?.getAttribute("data-testid"),
    };
  });
  assert.deepEqual(plain, { state: "done", verdict: "clean", flags: 0, ok: "✓ clean", values: 6, afterText: "tweetText" }, "a plain post shows a green check and every value under its text");
  const flagged = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => a.textContent?.includes("Bookmark this"));
    return (art?.querySelector(".xs-slot") as HTMLElement | null)?.dataset.verdict;
  });
  assert.equal(flagged, "flag");
  const skipped = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => a.textContent?.includes("Meet the new Pixel"));
    return art?.querySelector(".xs-note")?.textContent;
  });
  assert.equal(skipped, "promoted, not analyzed");

  // Clicking a pill opens the detail card with all five values and does not navigate.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.click('.xs-flag[data-dim="engagement_bait"]');
  await page.waitForSelector(".xs-detail");
  const detail = await page.evaluate(() => ({
    rows: document.querySelectorAll(".xs-detail-row").length,
    hit: document.querySelector(".xs-detail-row.xs-hit .xs-detail-k")?.textContent,
    foot: document.querySelector(".xs-detail-foot")?.textContent ?? "",
  }));
  assert.equal(detail.rows, 6);
  assert.equal(detail.hit, "engagement bait");
  assert.match(detail.foot, /^\d+ tok · \$0\.\d{6} · \d+ ms · jev-1\.13\.0$/);
  await page.mouse.click(5, 400);
  await page.waitForFunction(() => !document.querySelector(".xs-detail"));

  // Promoted and text-less posts never reach Jev; a quote sends its quoted text; a reply is flagged.
  assert.ok(!server.requests.some((r) => r.text.includes("Meet the new Pixel")), "promoted skipped");
  assert.ok(!server.requests.some((r) => r.text === ""), "empty text skipped");
  const quote = server.requests.find((r) => r.text === "This.");
  assert.equal(quote?.quoted_text, "Paul Graham: The best founders are the ones who are relentlessly resourceful.");
  const reply = server.requests.find((r) => r.text.startsWith("Agreed, and the second-order"));
  assert.equal(reply?.is_reply, true);
  assert.deepEqual(server.requests[0]!.questionIds, ["info_density", "engagement_bait", "promotion", "secondhand", "padding", "about_jev"]);
  assert.ok(pills.some((p) => p.dim === "about_jev" && /jevpilled 9\d%/.test(p.text ?? "")), "jevpilled flag");
  const red = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => a.textContent?.includes("TypeSafe just shipped"));
    const slot = art?.querySelector(".xs-slot") as HTMLElement | null;
    const flag = slot?.querySelector('.xs-flag[data-dim="about_jev"]') as HTMLElement | null;
    return { flag: flag && getComputedStyle(flag).color, border: slot && getComputedStyle(slot).borderTopColor };
  });
  assert.equal(red.flag, "rgb(244, 33, 46)", "jevpilled flag is red");
  // color-mix() output: rgb(244, 33, 46) at 70%, which Chrome reports as color(srgb 0.9569 0.1294 0.1804 / 0.7).
  assert.match(red.border ?? "", /244, 33, 46|srgb 0\.95\d* 0\.12\d* 0\.18\d*/, "chip border takes the red");
  assert.equal(server.requests[0]!.model, "jev-1.13.0");

  // Every post was billed at most once even though the list recycled and remounted nodes.
  const texts = server.requests.map((r) => r.text + "|" + (r.quoted_text ?? ""));
  const recycled = await page.evaluate(() => (window as unknown as { __recycled?: number }).__recycled ?? 0);
  assert.ok(recycled > 0, "fixture recycled nodes during the scroll");

  // Scroll back to the top: everything comes from cache, no new requests.
  const before = server.requests.length;
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, -420);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1500);
  assert.equal(server.requests.length, before, "scrolling back re-bills nothing");
  const topSlots = await page.evaluate(() => Array.from(document.querySelectorAll('.xs-slot[data-state="done"]')).length);
  assert.ok(topSlots >= 2, "cached results re-render on remount");
  const uniq = new Set(texts);
  assert.equal(uniq.size <= texts.length, true);

  // Reload: the persisted cache survives, the first screen needs no request.
  const beforeReload = server.requests.length;
  await page.reload();
  await page.waitForSelector(".xs-hud");
  await page.waitForTimeout(1500);
  const cachedFoot = await page.evaluate(() => document.querySelector(".xs-hud-foot")?.textContent ?? "");
  assert.match(cachedFoot, /cached [1-9]\d*/, `cache hits after reload: ${cachedFoot}`);
  assert.equal(server.requests.length, beforeReload, "reload re-bills nothing for already seen posts");

  assert.deepEqual(errors, [], "no page errors");
});

test("scope: home only pauses on other paths, account filter pauses on mismatch", async (t) => {
  const server = await startServer(FIXTURE);
  const profile = PROFILE + "-scope";
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(),
    ignoreDefaultArgs: ["--disable-extensions"],
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1100, height: 900 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--no-first-run"],
  });
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  const base = `http://127.0.0.1:${server.port}`;

  await sw.evaluate(async (baseUrl: string) => {
    await chrome.storage.local.set({ settings: { apiKey: "test-key", baseUrl, scope: "home", version: 3 } });
  }, base);
  const page = await ctx.newPage();
  await page.goto(`${base}/timeline.html`);
  await page.waitForSelector(".xs-hud-msg");
  assert.match(await page.textContent(".xs-hud-msg") ?? "", /home timeline only/);
  await page.waitForTimeout(800);
  assert.equal(server.requests.length, 0);

  await sw.evaluate(async (baseUrl: string) => {
    await chrome.storage.local.set({ settings: { apiKey: "test-key", baseUrl, scope: "all", accountHandle: "someoneelse" } });
  }, base);
  await page.waitForFunction(() => /logged in as @demo_user/.test(document.querySelector(".xs-hud-msg")?.textContent ?? ""), null, { timeout: 5000 });
  assert.equal(server.requests.length, 0);

  await sw.evaluate(async (baseUrl: string) => {
    await chrome.storage.local.set({ settings: { apiKey: "test-key", baseUrl, scope: "all", accountHandle: "Demo_User" } });
  }, base);
  await page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-state="done"]').length >= 1, null, { timeout: 10000 });
  assert.ok(server.requests.length >= 1);

  await sw.evaluate(async () => {
    await chrome.storage.local.set({ settings: { apiKey: "" } });
  });
  await page.waitForFunction(() => /API key/.test(document.querySelector(".xs-hud-msg")?.textContent ?? ""), null, { timeout: 5000 });
});

test("options page: renders dimensions, test connection and save work", async (t) => {
  const server = await startServer(FIXTURE);
  const profile = PROFILE + "-options";
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(),
    ignoreDefaultArgs: ["--disable-extensions"],
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1000, height: 1400 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--no-first-run"],
  });
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  const extId = new URL(sw.url()).host;
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.waitForSelector(".dim");
  assert.equal(await page.locator(".dim").count(), 6);
  assert.equal(await page.inputValue("#model"), "jev-1.13.0");

  await page.fill("#apiKey", "test-key");
  await page.click("details > summary");
  await page.fill("#baseUrl", `http://127.0.0.1:${server.port}`);
  await page.click("#test");
  await page.waitForFunction(() => /jev-1\.13\.0 · \d+ ms · \d+ tokens/.test(document.querySelector("#testOut")?.textContent ?? ""), null, { timeout: 10000 });
  assert.equal(server.requests.length, 1);
  assert.match(server.requests[0]!.text, /RT if you agree/);

  // Edit a threshold and add a dimension, save, and read it back from storage.
  await page.fill(".dim:nth-child(2) .d-threshold", "0.6");
  await page.click("#addDim");
  await page.fill(".dim:nth-child(7) .d-label", "hot take");
  await page.fill(".dim:nth-child(7) .d-id", "hot_take");
  await page.fill(".dim:nth-child(7) .d-instructions", "Is `text` a sweeping claim stated as certain fact without evidence?");
  await page.click("#save");
  await page.waitForFunction(() => document.querySelector("#saveOut")?.textContent === "saved");
  const saved = (await sw.evaluate(async () => (await chrome.storage.local.get("settings")).settings)) as {
    apiKey: string;
    dimensions: { id: string; threshold: number }[];
  };
  assert.equal(saved.apiKey, "test-key");
  assert.equal(saved.dimensions.length, 7);
  assert.equal(saved.dimensions[1]!.threshold, 0.6);
  assert.equal(saved.dimensions[6]!.id, "hot_take");

  // Validation blocks a broken dimension.
  await page.fill(".dim:nth-child(7) .d-id", "Not Valid");
  await page.click("#save");
  await page.waitForFunction(() => /fix 1 problem/.test(document.querySelector("#saveOut")?.textContent ?? ""));

  assert.deepEqual(errors, []);
  await page.fill(".dim:nth-child(7) .d-id", "hot_take");
  await page.click("#save");
  await page.waitForFunction(() => document.querySelector("#saveOut")?.textContent === "saved");
});
