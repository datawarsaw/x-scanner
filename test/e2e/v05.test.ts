// v0.2–v0.5 coverage: presets, article analysis, thread context and the session panel.
// Loads the built extension into Chrome against the fixture pages and the fake Jev server.
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

interface SessionSettings {
  apiKey: string;
  baseUrl: string;
  scope: string;
  dwellMs: number;
  concurrency: number;
  selectedPreset?: string;
  threadContextMode?: string;
  articleAnalysisEnabled?: boolean;
  version?: number;
}

async function launch(profileSuffix: string) {
  assert.ok(existsSync(path.join(DIST, "manifest.json")), "run `npm run build:e2e` first");
  const profile = path.join(ROOT, `test/e2e/.profile-${profileSuffix}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(),
    ignoreDefaultArgs: ["--disable-extensions"],
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1100, height: 900 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--no-first-run", "--hide-scrollbars"],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  return { ctx, sw: sw as never };
}

async function configure(sw: { evaluate: (fn: (arg: SessionSettings) => unknown, arg: SessionSettings) => Promise<unknown> }, settings: SessionSettings): Promise<void> {
  await sw.evaluate(async (s: SessionSettings) => {
    await chrome.storage.local.set({ settings: s });
  }, settings);
}

test("presets: Default keeps the v0.1 questions, switching to Signal changes them and the session panel counts", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("v05-presets");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 200, concurrency: 6, selectedPreset: "default" });

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/posts.html`);
  await page.waitForSelector('.xs-slot[data-state="done"]', { timeout: 15000 });

  assert.deepEqual(server.requests[0]!.questionIds, ["info_density", "engagement_bait", "promotion", "secondhand", "padding", "about_jev"]);
  const defaultPills = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.xs-slot[data-state="done"] .xs-dim, .xs-slot[data-state="done"] .xs-flag')).map((e) => (e as HTMLElement).dataset.dim),
  );
  assert.ok(defaultPills.includes("about_jev") || defaultPills.includes("padding"), String(defaultPills));

  // Switch preset: the cache identity changes, so posts are re-asked with the new dimensions.
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 200, concurrency: 6, selectedPreset: "signal", version: 6 });
  await page.waitForFunction(() => /· Signal/.test(document.querySelector(".xs-hud-title")?.textContent ?? ""), null, { timeout: 10000 });
  await page.waitForFunction(
    (n) => Array.from(document.querySelectorAll('.xs-slot[data-state="done"]')).length >= n,
    1,
    { timeout: 15000 },
  );
  await page.waitForTimeout(1200);
  const signal = server.requests.find((r) => r.questionIds.includes("actionable"));
  assert.ok(signal, "signal preset questions were sent");
  assert.equal(signal!.questionIds.includes("about_jev"), false);
  assert.deepEqual(signal!.questionIds, ["info_density", "actionable", "originality", "evidence", "promotion", "engagement_bait"]);

  // Session panel aggregates locally from results already in hand.
  await page.locator(".xs-hud-gear", { hasText: "session" }).click();
  await page.waitForSelector(".xs-session");
  const session = (await page.textContent(".xs-session")) ?? "";
  assert.match(session, /analyzed/);
  assert.match(session, /Signal/);
  const analyzed = Number(session.match(/(\d+)\s*analyzed/)?.[1] ?? "0");
  assert.ok(analyzed >= 1, session);
  assert.deepEqual(errors, []);
});

test("article: user-triggered analysis fetches, bills once and then serves the cache", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("v05-article");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, articleAnalysisEnabled: true });

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/article-post.html`);
  await page.waitForSelector('.xs-slot[data-state="done"]', { timeout: 15000 });

  const before = server.requests.length;
  // The fixture page also renders internal profile links; only the outbound article is a candidate.
  const articleBtn = '.xs-article-btn[data-url$="article.html"]';
  await page.waitForSelector(articleBtn);
  await page.click(articleBtn);
  await page.waitForSelector(".xs-article-card", { timeout: 15000 });
  await page.waitForFunction(() => /tok/.test(document.querySelector(".xs-article-card")?.textContent ?? ""), null, { timeout: 15000 });

  const article = server.requests.find((r) => r.kind === "article");
  assert.ok(article, "an article-shaped request reached Jev");
  // The canonical URL in the fixture HTML wins over the fetched address, which is the point of caching by canonical.
  assert.equal(article!.domain, "example.com");
  assert.match(article!.text, /Throughput rose 41%/);
  assert.deepEqual(article!.questionIds, [
    "info_density",
    "evidence_quality",
    "sourcing",
    "originality",
    "technical_depth",
    "promotional_intent",
    "speculative",
    "actionable_insight",
  ]);
  const card = (await page.textContent(".xs-article-card")) ?? "";
  assert.match(card, /ARTICLE/);
  assert.match(card, /\$0\.\d{6}/);

  // Clicking again comes from the article cache: no second bill.
  const billed = server.requests.filter((r) => r.kind === "article").length;
  await page.click(articleBtn);
  await page.waitForTimeout(1500);
  assert.equal(server.requests.filter((r) => r.kind === "article").length, billed, "repeat analysis is cached");
  assert.ok(server.requests.length > before);
  assert.deepEqual(errors, []);
});

test("thread context: a reply on a status page adds the parent text only when the preset asks for it", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("v05-thread");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "signal" });

  const page = await ctx.newPage();
  await page.goto(`${base}/status/8302`);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.xs-slot[data-state="done"]')).length >= 2, null, { timeout: 20000 });

  const reply = server.requests.find((r) => r.text.startsWith("Agreed, and the storage"));
  assert.ok(reply, "reply was analyzed");
  assert.equal(reply!.is_reply, true);
  assert.match(reply!.parent_text ?? "", /sharded queue/);

  const parent = server.requests.find((r) => r.text.startsWith("We replaced the per-request lock"));
  assert.ok(parent, "parent post was analyzed");
  assert.equal(parent!.parent_text, undefined);
});
