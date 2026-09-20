// v0.5.3 coverage: on an individual /<handle>/status/<id> page with Analyze replies/comments off, only
// the focal post is judged. X renders no "Replying to" row for direct comments, which is the live miss
// this fixture reproduces: the root article carries the route's id, the two comments carry other ids.
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
const ROUTE = "/demo_user/status/9001";

interface SessionSettings {
  apiKey: string;
  baseUrl: string;
  scope: string;
  dwellMs: number;
  concurrency: number;
  selectedPreset?: string;
  analyzeReplies?: boolean;
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
  reply: string | null;
  reason: string | null;
  state: string | null;
  display: string | null;
  chips: number;
  articleBtn: boolean;
}

test("status page: replies off judges the focal post only, and the filter is reversible", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("v053-status");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  // analyzeReplies is left unset on purpose: off, the default, is what is under test.
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "default" });

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + ROUTE);
  await page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-state="done"]').length >= 1, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const read = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map((a) => {
        const slot = a.querySelector(".xs-slot") as HTMLElement | null;
        return {
          id: slot?.dataset.tweetId ?? null,
          reply: slot?.dataset.xsReply ?? null,
          reason: slot?.dataset.xsFilterReason ?? null,
          state: slot?.dataset.state ?? null,
          display: slot ? getComputedStyle(slot).display : null,
          chips: slot ? slot.querySelectorAll(".xs-dim, .xs-flag").length : 0,
          articleBtn: Boolean(a.querySelector(".xs-article-btn")),
        };
      }),
    ) as Promise<SlotView[]>;

  const posts = () => server.requests.filter((r) => r.kind !== "article");

  const off = await read();
  assert.equal(off.length, 3, "the conversation fixture mounts three top-level articles");
  const [root, bob, carol] = off as [SlotView, SlotView, SlotView];
  // The route's status id is the focal id; the comments carry other ids and no replying row at all.
  assert.equal(root.id, "9001");
  assert.equal(bob.id, "9002");
  assert.equal(carol.id, "9003");
  assert.equal(root.state, "done");
  assert.equal(bob.reply, "false", "X renders no replying row for a direct comment");
  assert.equal(carol.reply, "false");
  assert.equal(bob.reason, "status-page-non-root");
  assert.equal(carol.reason, "status-page-non-root");
  assert.equal(root.reason, null, "the focal post is never filtered");

  // Only the focal post reached Jev. The comments produced no request, so no tokens and no cost.
  const billed = posts();
  assert.equal(billed.length, 1, JSON.stringify(billed.map((r) => r.text)));
  assert.match(billed[0]!.text, /^Shipped the queue rewrite/);
  assert.equal(billed[0]!.is_reply, false);
  // A quote inside the focal article is not a top-level article and changes nothing here.
  assert.equal(billed[0]!.quoted_text, "Quoted wisdom here, which is not a reply and must still be analyzed.");
  assert.equal(server.requests.some((r) => /Direct comment with no replying row/.test(r.text)), false, "a direct comment is not billed");
  assert.equal(server.requests.some((r) => /Second direct comment/.test(r.text)), false);

  // The counters describe the focal post only.
  const hud = await page.evaluate(() => Array.from(document.querySelectorAll(".xs-hud-body .xs-hud-v")).map((e) => (e.textContent || "").trim()));
  assert.equal(hud[0], "1", "one analyzed post");
  assert.equal(hud[1], "$" + ((server.totalTokens() * 0.042) / 1e6).toFixed(4));

  // No chip on the comments, and no layout space either.
  assert.deepEqual([bob.state, carol.state], ["filtered", "filtered"]);
  assert.deepEqual([bob.chips, carol.chips], [0, 0]);
  assert.deepEqual([bob.display, carol.display], ["none", "none"]);

  // Replies on restores v0.5.2 behavior, thread context included.
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "signal", analyzeReplies: true });
  await page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-state="done"]').length >= 3, null, { timeout: 20000 });
  const on = await read();
  assert.deepEqual(on.map((a) => a.state), ["done", "done", "done"]);
  assert.deepEqual(on.map((a) => a.reason), [null, null, null], "no filter reason once replies are analyzed");
  const comment = posts().find((r) => r.text.startsWith("Direct comment with no replying row"));
  assert.ok(comment, "enabling replies analyzes the direct comments");
  assert.equal(comment!.is_reply, false);
  assert.match(comment!.parent_text ?? "", /Shipped the queue rewrite/, "thread context still attaches the parent");

  // Turning it back off hides the now cached comment results and bills nothing more.
  // Wait out the debounced cache write first, so the results really are in storage before the app is
  // rebuilt with replies off.
  await page.waitForTimeout(1600);
  const billedBefore = server.requests.length;
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "signal", analyzeReplies: false });
  await page.waitForFunction(() => {
    const slots = Array.from(document.querySelectorAll('article[data-testid="tweet"] .xs-slot')) as HTMLElement[];
    return slots.length >= 3 && slots.slice(1).every((s) => s.dataset.state === "filtered");
  }, null, { timeout: 20000 });
  const offAgain = await read();
  assert.deepEqual(offAgain.map((a) => a.state), ["done", "filtered", "filtered"]);
  assert.equal(offAgain[1]!.reason, "status-page-non-root");
  assert.ok(offAgain[1]!.chips > 0, "the cached comment chip is still in the DOM");
  assert.deepEqual([offAgain[1]!.display, offAgain[2]!.display], ["none", "none"], "and it stays hidden");
  await page.waitForTimeout(1200);
  assert.equal(server.requests.length, billedBefore, "a hidden cached comment is never billed again");

  // The manual article action on a filtered comment is untouched by the post filter.
  assert.equal(offAgain[1]!.articleBtn, true);
  // The comment's own profile link is a candidate too, so click the outbound article button by url.
  await page.locator('article:has-text("Direct comment with no replying row")').locator('.xs-article-btn[data-url$="article.html"]').click();
  await page.waitForFunction(() => /tok/.test(document.querySelector(".xs-article-card")?.textContent ?? ""), null, { timeout: 20000 });
  const article = server.requests.find((r) => r.kind === "article");
  assert.ok(article, "a filtered comment still offers article analysis");
  assert.match(article!.text, /Throughput rose 41%/);

  assert.deepEqual(errors, []);
});
