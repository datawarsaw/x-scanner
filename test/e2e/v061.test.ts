// v0.6.1 coverage: the active-preset enablement guard, the real Options -> Save -> runtime path, and
// the 0..100 compact row for the values a live Signal v2 run reported.
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
/** The fixture post every cache assertion is about. */
const POST = "Scheduler latency";
const V2_IDS = ["topic", "information_density", "original_insight", "evidence", "actionable", "promotion", "engagement_bait"];
/** The six editable Default dimensions, in the order Default asks them. */
const LEGACY_IDS = ["info_density", "engagement_bait", "promotion", "secondhand", "padding", "about_jev"];
/** The ids only Default asks, so a Signal v2 request must carry none of them. */
const DEFAULT_ONLY_IDS = ["info_density", "secondhand", "padding", "about_jev"];

/** Exactly what a manual Signal v2 run reported: density 3/3, insight 0/3, evidence 0/3, actionable 1/3, promo 4%, bait 56%. */
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
  dimensions?: { id: string; label: string; type: string; enabled: boolean }[];
}

/** Every Default dimension the reader could have switched off while running a preset. */
function legacyOff(): NonNullable<SessionSettings["dimensions"]> {
  return [
    { id: "info_density", label: "fact-dense", type: "score" },
    { id: "engagement_bait", label: "engagement bait", type: "noul" },
    { id: "promotion", label: "promo", type: "noul" },
    { id: "secondhand", label: "secondhand", type: "noul" },
    { id: "padding", label: "filler", type: "score" },
    { id: "about_jev", label: "jevpilled", type: "noul" },
  ].map((d) => ({ ...d, enabled: false }));
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
  // The temporary extension identity is stable for the run, so Settings can be opened by URL.
  return { ctx, sw, extId: new URL(sw.url()).host };
}

/** Seeds persisted settings, which is what a returning reader already has. */
async function configure(sw: Worker, settings: SessionSettings): Promise<void> {
  await sw.evaluate(async (s: SessionSettings) => {
    await chrome.storage.local.set({ settings: { showAnalysisHud: true, ...s } });
  }, settings);
}

/** The real user flow: open Settings, pick the preset, press Save. The preset is never written directly. */
async function savePresetThroughOptions(ctx: BrowserContext, extId: string, presetId: string): Promise<void> {
  const page = await ctx.newPage();
  await page.goto("chrome-extension://" + extId + "/options.html");
  await page.waitForSelector(".dim");
  await page.selectOption("#preset", presetId);
  await page.click("#save");
  await page.waitForFunction(() => document.querySelector("#saveOut")?.textContent === "saved");
  await page.close();
}

/** A fresh page, so the content script that loads is the one this artifact ships. */
async function openTimeline(ctx: BrowserContext, base: string, display: "raw" | "normalized"): Promise<{ page: Page; errors: string[] }> {
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/posts.html");
  await page.waitForFunction(
    (d) => document.querySelectorAll('.xs-slot[data-display="' + d + '"][data-state="done"]').length >= 1,
    display,
    { timeout: 20000 },
  );
  return { page, errors };
}

/** Requests for one post under one exact question schema. */
function bills(server: { requests: SeenRequest[] }, ids: string[], text: string): number {
  return server.requests.filter((r) => r.text.startsWith(text) && r.questionIds.join(",") === ids.join(",")).length;
}

test("options -> save -> runtime: the preset the reader saved decides what the next timeline run asks", async (t) => {
  const server = await startServer(FIXTURE, LIVE);
  const { ctx, sw, extId } = await launch("v061-options");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  // Normal persisted settings: the reader has a key and has never touched the preset selector.
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6 });

  const options = await ctx.newPage();
  await options.goto("chrome-extension://" + extId + "/options.html");
  await options.waitForSelector(".dim");
  assert.equal(await options.inputValue("#preset"), "default", "the run starts on the normal default");
  await options.selectOption("#preset", "signal_v2");
  await options.click("#save");
  await options.waitForFunction(() => document.querySelector("#saveOut")?.textContent === "saved");
  await options.close();

  // Reopen Settings: the selection the reader saved is the one that comes back.
  const reopened = await ctx.newPage();
  await reopened.goto("chrome-extension://" + extId + "/options.html");
  await reopened.waitForSelector(".dim");
  assert.equal(await reopened.inputValue("#preset"), "signal_v2", "Save persisted the preset");
  assert.match((await reopened.textContent("#presetNote")) ?? "", /Topic \+ useful-signal classification/);
  await reopened.close();
  const stored = await sw.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { selectedPreset?: string }));
  assert.equal(stored.selectedPreset, "signal_v2");

  // A fresh timeline page then asks the questions of the saved preset, and only those.
  const { page, errors } = await openTimeline(ctx, base, "normalized");
  await page.waitForFunction((p) => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
    return art?.querySelector(".xs-slot")?.getAttribute("data-state") === "done";
  }, POST);
  const asked = server.requests.find((r) => r.text.startsWith(POST));
  assert.ok(asked, "the post was analyzed");
  assert.deepEqual(asked!.questionIds, V2_IDS, "the request carries exactly the Signal v2 schema");
  for (const id of DEFAULT_ONLY_IDS) assert.equal(asked!.questionIds.includes(id), false, id + " is not asked");

  const row = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes("Scheduler latency")) as HTMLElement | undefined;
    const slot = art?.querySelector(".xs-slot") as HTMLElement | null;
    const chip = (e: Element) => (e.textContent || "").trim().split(/\s+/).slice(-2).join(" ");
    return {
      display: slot?.dataset.display ?? null,
      verdict: slot?.dataset.verdict ?? null,
      warn: slot?.dataset.warn ?? null,
      topic: slot?.querySelector(".xs-topic")?.textContent ?? null,
      chips: Array.from(slot?.querySelectorAll(".xs-dim, .xs-warn") ?? []).map(chip),
      chipClasses: Array.from(slot?.querySelectorAll(".xs-dim, .xs-warn") ?? []).map((e) => (e as HTMLElement).dataset.dim + "=" + e.className),
      text: slot?.textContent ?? "",
    };
  });
  assert.equal(row.display, "normalized");
  assert.equal(row.topic, "AI");
  // The compact row prints the shared 0..100 range, never the rubric level it was derived from.
  assert.deepEqual(row.chips, ["density 100", "insight 0", "evidence 0", "actionable 33", "bait 56"]);
  // Promo 4 is below the silence threshold, so it disappears; bait 56 is mid-range and stays a
  // quiet neutral metric, exactly like the signal dimensions.
  assert.equal(row.warn, null, "no filter reached the escalation threshold");
  assert.equal(row.verdict, "neutral");
  assert.deepEqual(row.chipClasses, [
    "information_density=xs-dim",
    "original_insight=xs-dim",
    "evidence=xs-dim",
    "actionable=xs-dim",
    "engagement_bait=xs-dim",
  ], "mid-range bait is never amber");
  for (const gone of ["fact-dense", "secondhand", "filler", "jevpilled", "3/3", "1.0"]) assert.equal(row.text.includes(gone), false, gone);

  // The detail card keeps the raw semantics under the shared range.
  await page.evaluate(() => {
    (document.querySelector('.xs-slot[data-tweet-id="8101"]') as HTMLElement | null)?.click();
  });
  await page.waitForSelector(".xs-detail");
  const detail = await page.evaluate(() => {
    const card = document.querySelector(".xs-detail") as HTMLElement | null;
    return {
      display: card?.dataset.display ?? null,
      choice: {
        k: card?.querySelector(".xs-detail-choice-row .xs-detail-k")?.textContent ?? "",
        v: card?.querySelector(".xs-detail-choice-v")?.textContent ?? "",
      },
      rows: Array.from(card?.querySelectorAll(".xs-detail-row") ?? []).map((r) => ({
        k: r.querySelector(".xs-detail-k")?.textContent ?? "",
        v: r.querySelector(".xs-detail-v")?.textContent ?? "",
        hit: r.classList.contains("xs-hit"),
      })),
      raw: Array.from(card?.querySelectorAll(".xs-detail-raw") ?? []).map((e) => e.textContent ?? ""),
    };
  });
  assert.equal(detail.display, "normalized");
  assert.deepEqual(detail.choice, { k: "topic", v: "AI" });
  assert.deepEqual(detail.rows[0], { k: "information density", v: "100 / 100", hit: true });
  assert.equal(detail.raw[0], "Raw score: 3.0 / 3");
  assert.deepEqual(detail.rows[4], { k: "promo", v: "4 / 100", hit: false });
  assert.equal(detail.raw[4], "Probability true: 4%");
  assert.deepEqual(detail.rows[5], { k: "engagement bait", v: "56 / 100", hit: false });
  assert.equal(detail.raw[5], "Probability true: 56%");
  // Only the two filters are probabilities, and the score keeps its rubric reading.
  assert.equal(detail.raw.filter((s) => s.startsWith("Probability")).length, 2);
  assert.match(detail.raw[0] ?? "", /^Raw score/);
  assert.deepEqual(errors, []);
});

test("cache: each schema keeps its own answer for the same post across a real Settings switch", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw, extId } = await launch("v061-cache");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6 });

  const first = await openTimeline(ctx, base, "raw");
  assert.equal(bills(server, LEGACY_IDS, POST), 1, "Default bills the post once");
  // The cache write is debounced by a second, so let it land before the preset changes.
  await first.page.waitForTimeout(1600);
  await first.page.close();

  // Default -> Signal v2, selected and saved in the real Settings page.
  await savePresetThroughOptions(ctx, extId, "signal_v2");
  const second = await openTimeline(ctx, base, "normalized");
  assert.equal(bills(server, V2_IDS, POST), 1, "Signal v2 asks its own questions for the same post");
  assert.equal(bills(server, LEGACY_IDS, POST), 1, "Default's answer is neither reused nor bought again");
  await second.page.waitForTimeout(1600);
  await second.page.close();

  // Away, then back: each schema serves its own result and nothing is charged twice.
  await savePresetThroughOptions(ctx, extId, "default");
  const third = await openTimeline(ctx, base, "raw");
  assert.equal(bills(server, LEGACY_IDS, POST), 1, "returning to Default reuses Default's own result");
  assert.equal(bills(server, V2_IDS, POST), 1);
  await third.page.waitForTimeout(1200);
  await third.page.close();

  await savePresetThroughOptions(ctx, extId, "signal_v2");
  const fourth = await openTimeline(ctx, base, "normalized");
  assert.equal(bills(server, V2_IDS, POST), 1, "returning to Signal v2 reuses Signal v2's own result");
  assert.equal(bills(server, LEGACY_IDS, POST), 1, "and never charges the other schema");
  assert.deepEqual(fourth.errors, []);
});

test("guard: a preset with its own dimensions still runs when every editable dimension is off", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("v061-guard");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  // A reader on Signal v2 has no reason to keep the Default dimensions enabled. The guard used to read
  // exactly this array and refuse to analyze while seven dimensions were in fact selected.
  await configure(sw, {
    apiKey: "test-key",
    baseUrl: base,
    scope: "all",
    dwellMs: 0,
    concurrency: 6,
    selectedPreset: "signal_v2",
    version: 7,
    dimensions: legacyOff(),
  });

  const { page, errors } = await openTimeline(ctx, base, "normalized");
  // openTimeline returns as soon as any slot is done, and the fake server's randomized per-request
  // delay means that first slot can belong to a different post. Wait for this post's own slot so the
  // compact row is read after it, and only it, has rendered.
  await page.waitForFunction(
    (p) => {
      const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
      return art?.querySelector(".xs-slot")?.getAttribute("data-state") === "done";
    },
    POST,
    { timeout: 20000 },
  );
  const asked = server.requests.find((r) => r.text.startsWith(POST));
  assert.ok(asked, "the run was not blocked by the editable legacy dimensions");
  assert.deepEqual(asked!.questionIds, V2_IDS);
  // Scope the compact-row read to this post's slot instead of counting chips across the document.
  const hud = await page.evaluate((p) => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
    const slot = art?.querySelector(".xs-slot") as HTMLElement | null;
    const items = Array.from(slot?.querySelectorAll(".xs-dim, .xs-warn, .xs-topic") ?? []);
    const ids = (cls: string) => items.filter((e) => e.classList.contains(cls)).map((e) => (e as HTMLElement).dataset.dim);
    return {
      message: document.querySelector(".xs-hud-msg")?.textContent ?? "",
      title: document.querySelector(".xs-hud-title")?.textContent ?? "",
      state: slot?.dataset.state ?? null,
      topic: slot?.querySelector(".xs-topic")?.textContent ?? null,
      dims: ids("xs-dim"),
      warns: ids("xs-warn"),
      items: items.length,
    };
  }, POST);
  assert.equal(/No dimensions enabled/.test(hud.message), false, hud.message);
  assert.match(hud.title, /Signal v2/);
  // Deterministic compact result for this post: a topic plus the four signal components. Both filters
  // fall below FILTER_SILENCE, so neither reaches the row; nothing escalates.
  assert.equal(hud.state, "done");
  assert.equal(hud.topic, "AI");
  assert.deepEqual(hud.dims, ["information_density", "original_insight", "evidence", "actionable"]);
  assert.deepEqual(hud.warns, []);
  assert.equal(hud.items, 5);
  assert.deepEqual(errors, []);
});
