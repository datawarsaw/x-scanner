// v0.6.0 coverage: the Signal v2 preset, its shared 0..100 display, its cache identity, its session
// intelligence, and the browser resolver that this suite depends on.
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

const V2_IDS = ["topic", "information_density", "original_insight", "evidence", "actionable", "promotion", "engagement_bait"];
const DEFAULT_IDS = ["info_density", "engagement_bait", "promotion", "secondhand", "padding", "about_jev"];

interface SessionSettings {
  apiKey: string;
  baseUrl: string;
  scope: string;
  dwellMs: number;
  concurrency: number;
  selectedPreset?: string;
  version?: number;
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
  return { ctx, sw: sw as never };
}

async function configure(
  sw: { evaluate: (fn: (arg: SessionSettings) => unknown, arg: SessionSettings) => Promise<unknown> },
  settings: SessionSettings,
): Promise<void> {
  await sw.evaluate(async (s: SessionSettings) => {
    await chrome.storage.local.set({ settings: s });
  }, settings);
}

/** Number of requests for one post under one exact question schema. */
function bills(server: { requests: { text: string; questionIds: string[] }[] }, ids: string[], text: string): number {
  return server.requests.filter((r) => r.text.startsWith(text) && r.questionIds.join(",") === ids.join(",")).length;
}

test("the browser resolver finds Chromium with CHROME_PATH unset", () => {
  const inherited = process.env.CHROME_PATH;
  delete process.env.CHROME_PATH;
  try {
    const found = chromePath();
    assert.ok(existsSync(found), found);
    assert.match(path.basename(found), /^chrome(\.exe)?$/, found);
  } finally {
    if (inherited !== undefined) process.env.CHROME_PATH = inherited;
  }
});

test("signal v2: topic leads the row, values share one range, and details keep the raw semantics", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("v06-display");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "signal_v2" });

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/posts.html");
  await page.waitForFunction(
    () => document.querySelectorAll('.xs-slot[data-state="done"][data-display="normalized"]').length >= 1,
    null,
    { timeout: 20000 },
  );

  const asked = server.requests.find((r) => r.text.startsWith("Scheduler latency"));
  assert.ok(asked, "the post was analyzed");
  assert.deepEqual(asked!.questionIds, V2_IDS, "Signal v2 asks its own seven questions");

  const row = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes("Scheduler latency dropped"));
    const slot = art?.querySelector(".xs-slot") as HTMLElement | null;
    const els = Array.from(slot?.querySelectorAll(".xs-dim, .xs-flag") ?? []).map((e) => (e.textContent || "").trim());
    return {
      display: slot?.dataset.display,
      topic: slot?.querySelector(".xs-topic")?.textContent ?? null,
      clean: Boolean(slot?.querySelector(".xs-ok")),
      values: els,
    };
  });
  assert.equal(row.display, "normalized");
  assert.equal(row.topic, "AI", "the topic anchors the row");
  assert.equal(row.clean, true, "nothing in the fixture crosses a threshold");
  assert.deepEqual(row.values, ["density 80", "insight 60", "evidence 70", "actionable 50", "promo 10", "bait 8"]);

  await page.evaluate(() => {
    (document.querySelector('.xs-slot[data-tweet-id="8101"]') as HTMLElement | null)?.click();
  });
  await page.waitForSelector(".xs-detail");
  const detail = await page.evaluate(() => {
    const card = document.querySelector(".xs-detail") as HTMLElement | null;
    return {
      display: card?.dataset.display,
      rows: Array.from(card?.querySelectorAll(".xs-detail-row") ?? []).map((r) => ({
        k: r.querySelector(".xs-detail-k")?.textContent ?? "",
        v: r.querySelector(".xs-detail-v")?.textContent ?? "",
      })),
      raw: Array.from(card?.querySelectorAll(".xs-detail-raw") ?? []).map((e) => e.textContent ?? ""),
      choice: {
        k: card?.querySelector(".xs-detail-choice-row .xs-detail-k")?.textContent ?? "",
        v: card?.querySelector(".xs-detail-choice-v")?.textContent ?? "",
      },
      cands: Array.from(card?.querySelectorAll(".xs-detail-cand") ?? []).map((e) => e.textContent ?? ""),
      text: card?.textContent ?? "",
    };
  });
  assert.equal(detail.display, "normalized");
  assert.deepEqual(detail.choice, { k: "topic", v: "AI" });
  assert.deepEqual(detail.cands, ["AI 72%", "Software Engineering 18%", "Tech Industry 7%", "Other 3%"]);
  assert.deepEqual(detail.rows[0], { k: "information density", v: "80 / 100" });
  assert.equal(detail.raw[0], "Raw score: 2.4 / 3");
  assert.deepEqual(detail.rows[4], { k: "promo", v: "10 / 100" });
  assert.equal(detail.raw[4], "Probability true: 10%");
  assert.equal(detail.rows.length, 6, "the categorical row is not given a numeric range");
  assert.ok(!/Signal Score/i.test(detail.text), "no aggregate score is shown");
  assert.deepEqual(errors, []);
});

test("signal v2 cache identity: each preset keeps its own answers and only asks once", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("v06-cache");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  const POST = "Scheduler latency";
  const settings: SessionSettings = { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "default" };
  await configure(sw, settings);

  const page = await ctx.newPage();
  await page.goto(base + "/posts.html");
  await page.waitForFunction(
    (ids) => Array.from(document.querySelectorAll(".xs-slot")).some((s) => s.getAttribute("data-display") === "raw" && s.getAttribute("data-state") === "done"),
    null,
    { timeout: 20000 },
  );
  const normalizedSeen = () => page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-display="normalized"][data-state="done"]').length >= 1, null, { timeout: 20000 });
  const rawSeen = () => page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-display="raw"][data-state="done"]').length >= 1, null, { timeout: 20000 });

  assert.equal(bills(server, DEFAULT_IDS, POST), 1, "Default bills the post once");
  // The cache write is debounced by a second, so let it land before the preset changes.
  await page.waitForTimeout(1600);

  // Default -> Signal v2 is a different schema, so the post is asked again.
  await configure(sw, { ...settings, selectedPreset: "signal_v2" });
  await normalizedSeen();
  assert.equal(bills(server, V2_IDS, POST), 1, "Signal v2 asks its own questions for the same post");
  await page.waitForTimeout(1600);

  // Switching away keeps Signal v2's answer, and Default's own answer was never thrown away either.
  await configure(sw, { ...settings, selectedPreset: "default" });
  await rawSeen();
  await page.waitForTimeout(1200);
  assert.equal(bills(server, DEFAULT_IDS, POST), 1, "Default's own result was retained, not re-billed");
  assert.equal(bills(server, V2_IDS, POST), 1);

  // And Signal v2 still has its own answer waiting when we come back.
  await configure(sw, { ...settings, selectedPreset: "signal_v2" });
  await normalizedSeen();
  await page.waitForTimeout(1200);
  assert.equal(bills(server, V2_IDS, POST), 1, "switching back reuses Signal v2's own result");
  assert.equal(bills(server, DEFAULT_IDS, POST), 1, "and never charges the other preset's schema");
});

test("signal v2 session panel reports topics and averages without another call", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("v06-session");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "signal_v2" });

  const page = await ctx.newPage();
  await page.goto(base + "/posts.html");
  await page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-state="done"]').length >= 2, null, { timeout: 20000 });

  const before = server.requests.length;
  await page.locator(".xs-hud-gear", { hasText: "session" }).click();
  await page.waitForSelector(".xs-session");
  const session = (await page.textContent(".xs-session")) ?? "";
  assert.match(session, /Signal v2/, "the panel names the preset");
  assert.match(session, /topics/);
  assert.match(session, /AI 100%/, "the fixture topic distribution");
  assert.match(session, /averages/);
  assert.match(session, /information density 80/);
  assert.match(session, /promo 10/);
  assert.match(session, /top posts \(by density\)/, "ranking names its one component instead of a composite");
  assert.match(session, /no overall signal score/i, "the panel states that no aggregate exists");
  await page.waitForTimeout(1200);
  assert.equal(server.requests.length, before, "opening the panel made no Jev call");
});
