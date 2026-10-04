// B2 annotation coverage: the Signal v2 compact row as subtle left-rail marginalia. The deterministic
// annotation fixture shows every rail state (neutral, low signal, promo, bait, dual, media, quote)
// so presentation rules are asserted against real DOM placement and real computed styles.
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
  articleAnalysisEnabled?: boolean;
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

/** One compact row's semantic and computed presentation state. */
function readRow(id: string) {
  const slot = document.querySelector('.xs-slot[data-tweet-id="' + id + '"]') as HTMLElement | null;
  const style = slot ? getComputedStyle(slot) : null;
  const chip = (e: Element) => (e.textContent || "").trim();
  return {
    display: slot?.dataset.display ?? null,
    verdict: slot?.dataset.verdict ?? null,
    warn: slot?.dataset.warn ?? null,
    topic: slot?.querySelector(".xs-topic")?.textContent ?? null,
    chips: Array.from(slot?.querySelectorAll(".xs-dim, .xs-warn") ?? []).map((e) => ({
      dim: (e as HTMLElement).dataset.dim ?? "",
      cls: e.className,
      text: chip(e),
      color: getComputedStyle(e as HTMLElement).color,
    })),
    hasOk: Boolean(slot?.querySelector(".xs-ok")),
    rail: style?.borderLeftColor ?? null,
    railWidth: style?.borderLeftWidth ?? null,
    background: style?.backgroundColor ?? null,
    text: slot?.textContent ?? "",
  };
}

test("B2 rail: neutral marginalia, filter silence, amber escalation, placement, detail click", async (t) => {
  const server = await startServer(FIXTURE);
  const { ctx, sw } = await launch("annotation-b2");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  // Article actions stay off: this run asserts the annotation rail itself, not the analyze row.
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "signal_v2", articleAnalysisEnabled: false });

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/annotation.html");
  await page.waitForFunction(
    () => document.querySelectorAll('.xs-slot[data-state="done"][data-display="normalized"]').length >= 8,
    null,
    { timeout: 20000 },
  );
  // The rail color transitions in over 150ms when the state attribute lands; let it settle before
  // computed styles are asserted.
  await page.waitForTimeout(350);

  // 1. Neutral high-signal post: quiet rail, four metrics, no filters, no success state.
  const neutral = await page.evaluate(readRow, "8201");
  assert.equal(neutral.display, "normalized");
  assert.equal(neutral.verdict, "neutral");
  assert.equal(neutral.warn, null);
  assert.equal(neutral.topic, "AI");
  assert.deepEqual(neutral.chips.map((c: { text: string }) => c.text), ["density 80", "insight 60", "evidence 70", "actionable 50"]);
  assert.equal(neutral.hasOk, false, "no green clean marker remains");
  assert.equal(neutral.rail, "rgba(255, 255, 255, 0.16)", "neutral rail");
  // Chromium snaps computed border widths to whole device pixels, so a 1.5px rail reads as
  // 1px at DPR 1; assert the hairline, not the exact device value.
  assert.ok(["1px", "1.5px"].includes(neutral.railWidth ?? ""), "rail width stays hairline: " + neutral.railWidth);
  assert.equal(neutral.background, "rgba(0, 0, 0, 0)", "transparent: no card geometry");

  // 2. Low signal: the same B2 structure, quiet numbers, no negative state.
  const low = await page.evaluate(readRow, "8202");
  assert.deepEqual(low.chips.map((c: { text: string }) => c.text), ["density 13", "insight 13", "evidence 13", "actionable 13"]);
  assert.equal(low.verdict, "neutral");
  assert.equal(low.warn, null);
  assert.equal(low.rail, "rgba(255, 255, 255, 0.16)", "low signal is information, not a warning");

  // 3. Promo escalation: amber rail, promo value amber, quiet bait omitted.
  const promo = await page.evaluate(readRow, "8203");
  assert.equal(promo.verdict, "warn");
  assert.equal(promo.warn, "promotion");
  assert.equal(promo.rail, "rgba(245, 158, 11, 0.85)", "escalated rail");
  const promoChip = promo.chips.find((c: { dim: string }) => c.dim === "promotion")!;
  assert.equal(promoChip.cls, "xs-warn", "only the elevated value is emphasized");
  assert.equal(promoChip.text, "promo 95");
  assert.equal(promoChip.color, "rgb(251, 191, 36)", "amber-400 value text");
  assert.equal(promo.chips.some((c: { dim: string }) => c.dim === "engagement_bait"), false, "bait 8 is suppressed");

  // 4. Bait escalation: amber rail, bait value amber, quiet promo omitted.
  const bait = await page.evaluate(readRow, "8204");
  assert.equal(bait.warn, "engagement_bait");
  assert.equal(bait.rail, "rgba(245, 158, 11, 0.85)");
  const baitChip = bait.chips.find((c: { dim: string }) => c.dim === "engagement_bait")!;
  assert.equal(baitChip.cls, "xs-warn");
  assert.equal(baitChip.text, "bait 97");
  assert.equal(bait.chips.some((c: { dim: string }) => c.dim === "promotion"), false, "promo 10 is suppressed");

  // 5. Dual escalation: both filters emphasized, still the same compact structure.
  const dual = await page.evaluate(readRow, "8205");
  assert.equal(dual.warn, "promotion engagement_bait");
  assert.deepEqual(
    dual.chips.filter((c: { cls: string }) => c.cls === "xs-warn").map((c: { text: string }) => c.text),
    ["promo 95", "bait 97"],
  );

  // 6. Media post: the row sits between the text and the media card.
  const media = await page.evaluate(() => {
    const slot = document.querySelector('.xs-slot[data-tweet-id="8206"]');
    return {
      prev: slot?.previousElementSibling?.getAttribute("data-testid") ?? null,
      next: slot?.nextElementSibling?.getAttribute("data-testid") ?? null,
    };
  });
  assert.deepEqual(media, { prev: "tweetText", next: "tweetPhoto" }, "no collision with the media card");

  // 7. Quote post: the row annotates the outer post, never the quoted one.
  const quote = await page.evaluate(() => {
    const slot = document.querySelector('.xs-slot[data-tweet-id="8207"]');
    return {
      prev: slot?.previousElementSibling?.getAttribute("data-testid") ?? null,
      nextIsQuote: Boolean(slot?.nextElementSibling?.matches('div[role="link"]')),
      insideQuote: Boolean(slot?.closest('div[role="link"]')),
      quoteHasSlot: Boolean(slot?.parentElement?.querySelector('div[role="link"] .xs-slot')),
    };
  });
  assert.equal(quote.insideQuote, false, "never rendered inside the quote card");
  assert.equal(quote.quoteHasSlot, false);
  assert.equal(quote.prev, "tweetText");
  assert.equal(quote.nextIsQuote, true, "directly before the quote card");

  // 8. Video post: the row sits between the text and the video player container.
  const video = await page.evaluate(() => {
    const slot = document.querySelector('.xs-slot[data-tweet-id="8208"]');
    return {
      prev: slot?.previousElementSibling?.getAttribute("data-testid") ?? null,
      next: slot?.nextElementSibling?.getAttribute("data-testid") ?? null,
    };
  });
  assert.deepEqual(video, { prev: "tweetText", next: "videoPlayer" }, "no collision with the video player");

  // 9. The detail view stays clickable, renders in portal overlay root, and keeps suppressed values.
  await page.evaluate(() => {
    (document.querySelector('.xs-slot[data-tweet-id="8201"]') as HTMLElement | null)?.click();
  });
  await page.waitForSelector(".xs-detail");
  const textDetail = await page.evaluate(() => {
    const card = document.querySelector(".xs-detail");
    const root = document.getElementById("xs-overlay-root");
    return {
      isParentOverlayRoot: card?.parentElement === root,
      rows: Array.from(card?.querySelectorAll(".xs-detail-row") ?? []).map((r) => ({
        k: r.querySelector(".xs-detail-k")?.textContent ?? "",
        v: r.querySelector(".xs-detail-v")?.textContent ?? "",
      })),
    };
  });
  assert.equal(textDetail.isParentOverlayRoot, true, "detail panel rendered into #xs-overlay-root portal");
  assert.deepEqual(textDetail.rows[4], { k: "promo", v: "10 / 100" }, "suppressed promo remains in the detail view");
  assert.deepEqual(textDetail.rows[5], { k: "engagement bait", v: "8 / 100" }, "suppressed bait remains in the detail view");

  // Close by clicking slot 8201 again
  await page.evaluate(() => {
    (document.querySelector('.xs-slot[data-tweet-id="8201"]') as HTMLElement | null)?.click();
  });
  await page.waitForFunction(() => !document.querySelector(".xs-detail"));

  // 10. Video post detail layering: detail renders strictly ON TOP of the video layer, not underneath.
  await page.evaluate(() => {
    (document.querySelector('.xs-slot[data-tweet-id="8208"]') as HTMLElement | null)?.click();
  });
  await page.waitForSelector(".xs-detail");
  const videoLayerCheck = await page.evaluate(() => {
    const card = document.querySelector(".xs-detail") as HTMLElement | null;
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    const elAtPoint = document.elementFromPoint(rect.left + 20, rect.top + 20);
    return {
      isDetailOnTop: elAtPoint === card || card.contains(elAtPoint),
      elementTag: elAtPoint?.tagName,
      elementClass: elAtPoint?.className,
      elementId: elAtPoint?.id,
    };
  });
  assert.equal(videoLayerCheck?.isDetailOnTop, true, "detail panel is geometrically on top of native X video player");

  // 11. Photo post detail layering: detail renders above tweetPhoto
  await page.evaluate(() => {
    (document.querySelector('.xs-slot[data-tweet-id="8206"]') as HTMLElement | null)?.click();
  });
  await page.waitForSelector(".xs-detail");
  const photoLayerCheck = await page.evaluate(() => {
    const card = document.querySelector(".xs-detail") as HTMLElement | null;
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    const elAtPoint = document.elementFromPoint(rect.left + 20, rect.top + 20);
    return {
      isDetailOnTop: elAtPoint === card || card.contains(elAtPoint),
    };
  });
  assert.equal(photoLayerCheck?.isDetailOnTop, true, "detail panel is on top of tweetPhoto");

  // 12. Quote post detail layering: detail renders above quote card
  await page.evaluate(() => {
    (document.querySelector('.xs-slot[data-tweet-id="8207"]') as HTMLElement | null)?.click();
  });
  await page.waitForSelector(".xs-detail");
  const quoteLayerCheck = await page.evaluate(() => {
    const card = document.querySelector(".xs-detail") as HTMLElement | null;
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    const elAtPoint = document.elementFromPoint(rect.left + 20, rect.top + 20);
    return {
      isDetailOnTop: elAtPoint === card || card.contains(elAtPoint),
    };
  });
  assert.equal(quoteLayerCheck?.isDetailOnTop, true, "detail panel is on top of quote card");

  // 13. Escape key closes detail
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".xs-detail"));

  // 14. Scrolling closes detail panel deterministically (no detached floating overlay)
  await page.evaluate(() => {
    (document.querySelector('.xs-slot[data-tweet-id="8201"]') as HTMLElement | null)?.click();
  });
  await page.waitForSelector(".xs-detail");
  await page.evaluate(() => window.scrollBy(0, 50));
  await page.waitForFunction(() => !document.querySelector(".xs-detail"));

  // 15. Repeated toggles produce no duplicate overlay roots and clean up completely
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => (document.querySelector('.xs-slot[data-tweet-id="8201"]') as HTMLElement | null)?.click());
    await page.waitForSelector(".xs-detail");
    await page.evaluate(() => (document.querySelector('.xs-slot[data-tweet-id="8201"]') as HTMLElement | null)?.click());
    await page.waitForFunction(() => !document.querySelector(".xs-detail"));
  }
  const rootCount = await page.evaluate(() => document.querySelectorAll("#xs-overlay-root").length);
  assert.equal(rootCount, 1, "exactly one overlay root exists across repeated toggles");

  assert.deepEqual(errors, []);
});
