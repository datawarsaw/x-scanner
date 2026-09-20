// v0.5.4 coverage: a native X Article that X rendered inside a post page. Detection is layered DOM
// evidence, the action is manual only, and the Article preset, the article cache and the article
// counters are the existing v0.5 ones. The comments under the article stay filtered with replies off.
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
const ROUTE = "/akshay_pachaar/status/2035341800739877091";
const TITLE = "Why the scheduler rewrite paid off";
const SUBTITLE = "A field report from twelve production clusters, and what it cost us to find out.";
const NATIVE_BTN = '.xs-article-btn[data-xs-native="true"]';
const EXTERNAL_BTN = '.xs-article-btn[data-url$="article.html"]:not([data-xs-native])';
/** The article body paragraphs, in the order X renders them. */
const BODY = [
  "The scheduler rewrite started as a boring question",
  "Throughput rose 41% once the lock became a sharded queue",
  "Two regressions followed the rollout",
  "The honest summary is that the queue was never the bottleneck",
];
const ARTICLE_QUESTIONS = [
  "info_density",
  "evidence_quality",
  "sourcing",
  "originality",
  "technical_depth",
  "promotional_intent",
  "speculative",
  "actionable_insight",
];

interface SessionSettings {
  apiKey: string;
  baseUrl: string;
  scope: string;
  dwellMs: number;
  concurrency: number;
  selectedPreset?: string;
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

interface SlotView {
  id: string | null;
  state: string | null;
  reason: string | null;
  native: string | null;
  evidence: string | null;
  nativeBtn: string | null;
  display: string | null;
}

test("native X article: manual only, article preset, billed once, then served from cache", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("v054-native");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "default", articleAnalysisEnabled: true });

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + ROUTE);
  await page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-state="done"]').length >= 1, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const read = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map((a) => {
        const slot = a.querySelector(".xs-slot") as HTMLElement | null;
        return {
          id: slot?.dataset.tweetId ?? null,
          state: slot?.dataset.state ?? null,
          reason: slot?.dataset.xsFilterReason ?? null,
          native: slot?.dataset.xsNativeArticle ?? null,
          evidence: slot?.dataset.xsNativeArticleEvidence ?? null,
          nativeBtn: (a.querySelector('.xs-article-btn[data-xs-native="true"]') as HTMLElement | null)?.textContent ?? null,
          display: slot ? getComputedStyle(slot).display : null,
        };
      }),
    ) as Promise<SlotView[]>;

  const posts = () => server.requests.filter((r) => r.kind !== "article");
  const articles = () => server.requests.filter((r) => r.kind === "article");
  const nativeBills = () => articles().filter((r) => r.sourceType === "x-native").length;

  // Detection (1, 2, 11): the article is offered on the focal post, nowhere else, and the comments
  // stay filtered because replies are off.
  const initial = await read();
  assert.equal(initial.length, 3, "the article fixture mounts three top-level articles");
  assert.equal(initial[0]!.native, "true", "the focal post carries the diagnostic attribute");
  assert.equal(initial[0]!.evidence, "heading+body", "and records which evidence layer matched");
  assert.equal(initial[0]!.nativeBtn, "Analyze X article");
  assert.deepEqual(
    [initial[1]!.native, initial[2]!.native],
    [null, null],
    "a comment with a large image and a long link card is not mistaken for an article",
  );
  assert.deepEqual([initial[1]!.nativeBtn, initial[2]!.nativeBtn], [null, null]);
  assert.deepEqual([initial[1]!.state, initial[2]!.state], ["filtered", "filtered"]);
  assert.deepEqual([initial[1]!.reason, initial[2]!.reason], ["status-page-non-root", "status-page-non-root"]);
  assert.deepEqual([initial[1]!.display, initial[2]!.display], ["none", "none"]);

  // 10: the focal post is judged independently, on its own short lead, under the selected post preset.
  assert.equal(posts().length, 1, JSON.stringify(posts().map((r) => r.text.slice(0, 30))));
  assert.match(posts()[0]!.text, /^New write-up: how the scheduler rewrite moved our p99 tail/);
  assert.equal(posts()[0]!.questionIds.includes("evidence_quality"), false, "the post preset, not the article preset");

  // No Jev request before the reader asks for one.
  assert.deepEqual(articles(), []);
  assert.equal(await page.textContent(".xs-article-card").catch(() => null), null, "no article card yet");

  // 6, 7, 8: one click, one request, Article preset, native provenance, counted as an article.
  await page.click(NATIVE_BTN);
  await page.waitForFunction(() => /tok/.test(document.querySelector(".xs-article-card")?.textContent ?? ""), null, { timeout: 20000 });
  assert.equal(articles().length, 1, "exactly one Jev article request");
  const a = articles()[0]!;
  assert.equal(a.sourceType, "x-native");
  assert.equal(a.kind, "article");
  assert.deepEqual(a.questionIds, ARTICLE_QUESTIONS, "the Article preset's own questions");
  assert.equal(a.url, "https://x.com/akshay_pachaar/status/2035341800739877091", "the canonical X url");
  assert.equal(a.domain, "x.com");
  assert.equal(a.subtitle, SUBTITLE, "the lead is extracted as its own field");
  assert.match(a.text, /^The scheduler rewrite started as a boring question/);

  // 3, 4, 5: paragraphs in order, and nothing that belongs to the post, the title, or the comments.
  assert.equal(
    BODY.every((line) => a.text.includes(line)),
    true,
    `every body paragraph was extracted: ${a.text.slice(0, 80)}`,
  );
  const at = BODY.map((line) => a.text.indexOf(line));
  assert.deepEqual([...at].sort((x, y) => x - y), at, "paragraphs keep document order");
  assert.doesNotMatch(a.text, /New write-up/, "the post's own lead stays the post's");
  assert.doesNotMatch(a.text, new RegExp(TITLE), "the title is sent as the title");
  assert.doesNotMatch(a.text, /A field report from twelve/, "the lead is sent as the subtitle");
  assert.doesNotMatch(a.text, /Direct comment with no replying row/);
  assert.doesNotMatch(a.text, /Second direct comment/);
  assert.doesNotMatch(a.text, /card description deliberately long/, "a link card is chrome");
  assert.equal(a.truncated, false, "and well inside the character cap");

  const card = (await page.textContent(".xs-article-card")) ?? "";
  assert.match(card, /X ARTICLE/, "the card names the native source");
  assert.match(card, /tok/);

  // The session counts it as an analyzed article, not as one more post.
  await page.locator(".xs-hud-gear", { hasText: "session" }).click();
  await page.waitForSelector(".xs-session");
  const grid = await page.evaluate(() => Array.from(document.querySelectorAll(".xs-session-grid > div")).map((d) => (d.textContent || "").trim()));
  assert.deepEqual(grid[0], "2analyzed", "the post and the article");
  assert.deepEqual(grid[5], "1articles", "one analyzed article");
  assert.equal(grid[2], "$" + ((server.totalTokens() * 0.042) / 1e6).toFixed(4) + "spent", "the cost figure covers exactly these two calls");

  // 9: a second click comes from the article cache and bills nothing.
  await page.click(NATIVE_BTN);
  await page.waitForTimeout(1500);
  assert.equal(nativeBills(), 1, "a repeat native analysis is cached");
  assert.equal(articles().length, 1);

  // 12: the existing external article path still works on the same post, and stays a separate entry.
  await page.click(EXTERNAL_BTN);
  await page.waitForFunction(
    () => {
      const c = document.querySelector(".xs-article-card");
      return !!c && /tok/.test(c.textContent ?? "") && !/X ARTICLE/.test(c.textContent ?? "");
    },
    null,
    { timeout: 20000 },
  );
  const external = articles().find((r) => r.sourceType === "external");
  assert.ok(external, "a linked article still reaches Jev");
  assert.equal(external!.domain, "example.com");
  assert.equal(external!.url, "https://example.com/canonical-path");
  assert.match(external!.text, /Throughput rose 41%/);
  assert.deepEqual(external!.questionIds, ARTICLE_QUESTIONS);
  assert.equal(nativeBills(), 1, "the native entry was not disturbed");

  // Comments are still unbilled and unscored, and the reply filter is not weakened.
  assert.equal(server.requests.some((r) => /Direct comment with no replying row/.test(r.text)), false);
  assert.equal(server.requests.some((r) => /Second direct comment/.test(r.text)), false);

  // The cache survives a reload: the article is re-detected and re-opened without a new request.
  await page.waitForTimeout(1600);
  const beforeReload = nativeBills();
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-state="done"]').length >= 1, null, { timeout: 20000 });
  const reloaded = await read();
  assert.equal(reloaded[0]!.native, "true", "the article is detected again after a reload");
  assert.deepEqual([reloaded[1]!.state, reloaded[2]!.state], ["filtered", "filtered"]);
  await page.click(NATIVE_BTN);
  await page.waitForFunction(() => /X ARTICLE/.test(document.querySelector(".xs-article-card")?.textContent ?? ""), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  assert.equal(nativeBills(), beforeReload, "the persisted article cache serves the reload");
  assert.deepEqual(errors, []);
});

