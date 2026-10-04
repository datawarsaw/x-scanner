// v0.6.2 coverage: live preset and settings refresh without timeline page reload,
// HUD runtime identity (version, build SHA, active preset), and absence of duplicate billing.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright-core";
import { startServer, type AnswerOverrides, type SeenRequest } from "./server.ts";
import { chromePath } from "./chrome.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, "dist-e2e");
const FIXTURE = path.join(ROOT, "test/fixture");
const V2_IDS = ["topic", "information_density", "original_insight", "evidence", "actionable", "promotion", "engagement_bait"];
const LEGACY_IDS = ["info_density", "engagement_bait", "promotion", "secondhand", "padding", "about_jev"];
const DEFAULT_ONLY_IDS = ["info_density", "secondhand", "padding", "about_jev"];

const LIVE: AnswerOverrides = {
  scores: { information_density: 3, original_insight: 0, evidence: 0, actionable: 1 },
  nouls: { promotion: 0.04, engagement_bait: 0.56 },
};

interface SessionSettings {
  apiKey: string;
  baseUrl: string;
  scope: string;
  dwellMs: number;
  concurrency: number;
  selectedPreset?: string;
  version?: number;
}

async function launch(profileSuffix: string): Promise<{ ctx: BrowserContext; sw: Worker; extId: string }> {
  assert.ok(existsSync(path.join(DIST, "manifest.json")), "run npm run build:e2e first");
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
  return { ctx, sw, extId: new URL(sw.url()).host };
}

async function configure(sw: Worker, settings: SessionSettings): Promise<void> {
  await sw.evaluate(async (s: SessionSettings) => {
    await chrome.storage.local.set({ settings: { showAnalysisHud: true, ...s } });
  }, settings);
}

async function savePresetThroughOptions(ctx: BrowserContext, extId: string, presetId: string): Promise<void> {
  const page = await ctx.newPage();
  await page.goto("chrome-extension://" + extId + "/options.html");
  await page.waitForSelector(".dim");
  await page.selectOption("#preset", presetId);
  await page.click("#save");
  await page.waitForFunction(() => document.querySelector("#saveOut")?.textContent === "saved");
  await page.close();
}

async function exposePost(page: Page, id: string, handle: string, text: string): Promise<void> {
  await page.evaluate(({ id, handle, text }) => {
    const list = document.querySelector('[data-testid="primaryColumn"] section') ?? document.body;
    const cell = document.createElement("div");
    cell.setAttribute("data-testid", "cellInnerDiv");
    cell.innerHTML = `
      <article data-testid="tweet" role="article" tabindex="0">
        <div class="avatar"></div>
        <div class="col">
          <div data-testid="User-Name">
            <a href="/${handle}"><span>${handle}</span></a>
            <a href="/${handle}/status/${id}"><time datetime="2026-09-18T09:00:00Z">1h</time></a>
          </div>
          <div data-testid="tweetText"><span>${text}</span></div>
          <div role="group" aria-label="actions"><button>reply</button></div>
        </div>
      </article>
    `;
    list.appendChild(cell);
  }, { id, handle, text });
}

function bills(server: { requests: SeenRequest[] }, ids: string[], prefix: string): number {
  return server.requests.filter((r) => r.text.startsWith(prefix) && r.questionIds.join(",") === ids.join(",")).length;
}

test("live preset refresh: switching preset in Options updates open tab without reload", async (t) => {
  const server = await startServer(FIXTURE, LIVE);
  const { ctx, sw, extId } = await launch("v062-live");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "default" });

  // 1. Load timeline page with Default active
  const timeline = await ctx.newPage();
  const errors: string[] = [];
  timeline.on("pageerror", (e) => errors.push(String(e)));
  await timeline.goto(base + "/posts.html");

  // 2. Allow one Default analysis (post 8101: "Scheduler latency")
  await timeline.waitForFunction(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes("Scheduler latency"));
    return art?.querySelector(".xs-slot")?.getAttribute("data-state") === "done";
  }, { timeout: 15000 });

  const post1Bills = bills(server, LEGACY_IDS, "Scheduler latency");
  assert.equal(post1Bills, 1, "post 1 analyzed once under Default");

  // Verify HUD shows Default identity
  const hudDefault = await timeline.evaluate(() => ({
    title: document.querySelector(".xs-hud-title")?.textContent ?? "",
    ver: document.querySelector(".xs-hud-ver")?.textContent ?? "",
  }));
  assert.match(hudDefault.title, /Default/);
  assert.match(hudDefault.ver, /Default/);

  // 3. Open real Options page, select Signal v2, Save, close Options
  await savePresetThroughOptions(ctx, extId, "signal_v2");

  // 7. Do NOT reload timeline! Verify HUD immediately displays Signal v2
  await timeline.waitForFunction(() => {
    const title = document.querySelector(".xs-hud-title")?.textContent ?? "";
    const ver = document.querySelector(".xs-hud-ver")?.textContent ?? "";
    return title.includes("Signal v2") && ver.includes("Signal v2");
  }, { timeout: 5000 });

  const hudV2 = await timeline.evaluate(() => ({
    title: document.querySelector(".xs-hud-title")?.textContent ?? "",
    ver: document.querySelector(".xs-hud-ver")?.textContent ?? "",
  }));
  assert.match(hudV2.title, /Signal v2/);
  assert.match(hudV2.ver, /Signal v2/);

  // 8. Expose fresh post for Signal v2
  const V2_POST_TEXT = "Fresh Signal v2 post: Typesafe Jev latency dropped 50% across 10 clusters.";
  await exposePost(timeline, "9101", "carol", V2_POST_TEXT);

  // Wait for fresh post to finish analysis under Signal v2
  await timeline.waitForFunction((prefix) => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(prefix));
    const slot = art?.querySelector(".xs-slot");
    return slot?.getAttribute("data-state") === "done" && slot?.getAttribute("data-display") === "normalized";
  }, V2_POST_TEXT, { timeout: 15000 });

  // 9. Inspect actual fake Jev request
  const v2Req = server.requests.find((r) => r.text.startsWith("Fresh Signal v2 post"));
  assert.ok(v2Req, "fake Jev received request for fresh post");

  // 10. Assert Signal v2 ids
  assert.deepEqual(v2Req!.questionIds, V2_IDS, "request carries exactly Signal v2 questions");

  // 11. Assert Default-only ids absent
  for (const gone of DEFAULT_ONLY_IDS) {
    assert.equal(v2Req!.questionIds.includes(gone), false, gone + " is not in Signal v2 request");
  }

  // 12. Verify Signal v2 compact row
  const rowV2 = await timeline.evaluate((prefix) => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(prefix));
    const slot = art?.querySelector(".xs-slot") as HTMLElement | null;
    const chip = (e: Element) => (e.textContent || "").trim().split(/\s+/).slice(-2).join(" ");
    return {
      display: slot?.dataset.display ?? null,
      verdict: slot?.dataset.verdict ?? null,
      warn: slot?.dataset.warn ?? null,
      topic: slot?.querySelector(".xs-topic")?.textContent ?? null,
      chips: Array.from(slot?.querySelectorAll(".xs-dim, .xs-warn") ?? []).map(chip),
      text: slot?.textContent ?? "",
    };
  }, V2_POST_TEXT);
  assert.equal(rowV2.display, "normalized");
  assert.equal(rowV2.topic, "AI");
  assert.deepEqual(rowV2.chips, ["density 100", "insight 0", "evidence 0", "actionable 33", "bait 56"], "promo 4 is silenced, bait 56 stays neutral");
  assert.equal(rowV2.warn, null);

  // Switch back to Default through Options without reloading X
  await savePresetThroughOptions(ctx, extId, "default");

  // Verify HUD immediately returns to Default without page reload
  await timeline.waitForFunction(() => {
    const title = document.querySelector(".xs-hud-title")?.textContent ?? "";
    const ver = document.querySelector(".xs-hud-ver")?.textContent ?? "";
    return title.includes("Default") && ver.includes("Default");
  }, { timeout: 5000 });

  // Post 1 was cached under Default: its Default chips must be restored without re-billing
  await timeline.waitForFunction(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes("Scheduler latency"));
    const slot = art?.querySelector(".xs-slot");
    return slot?.getAttribute("data-state") === "done" && slot?.getAttribute("data-display") === "raw";
  }, { timeout: 5000 });

  // Expose another fresh post for Default
  const DEF_POST_TEXT = "Fresh Default post: RT if you agree and follow me for more founder lessons.";
  await exposePost(timeline, "9102", "dave", DEF_POST_TEXT);

  await timeline.waitForFunction((prefix) => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(prefix));
    const slot = art?.querySelector(".xs-slot");
    return slot?.getAttribute("data-state") === "done" && slot?.getAttribute("data-display") === "raw";
  }, DEF_POST_TEXT, { timeout: 15000 });

  const defReq = server.requests.find((r) => r.text.startsWith("Fresh Default post"));
  assert.ok(defReq, "fake Jev received request for fresh Default post");
  assert.deepEqual(defReq!.questionIds, LEGACY_IDS, "request carries Default questions");

  // Assert no duplicate observers or duplicate billing
  assert.equal(bills(server, LEGACY_IDS, "Scheduler latency"), 1, "post 1 was billed only once");
  assert.equal(bills(server, V2_IDS, "Fresh Signal v2 post"), 1, "post 2 was billed only once");
  assert.equal(bills(server, LEGACY_IDS, "Fresh Default post"), 1, "post 3 was billed only once");
  assert.deepEqual(errors, []);
});
