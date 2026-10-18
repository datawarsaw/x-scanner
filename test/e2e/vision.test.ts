// Jev 1.14 Vision beta coverage: what changes when the switch is on, and proof that nothing changes
// when it is off. Every TypeSafe answer here comes from the fake endpoint in server.ts, so the suite
// bills nothing; the photos come from the generated fixtures in media.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright-core";
import { startServer, type AnswerOverrides, type SeenRequest } from "./server.ts";
import type { MediaRequest } from "./server.ts";
import { chromePath } from "./chrome.ts";
import { png } from "./media.ts";
import { jpegSize, pngInfo, targetSize, VISION_MODEL } from "../../src/shared/vision.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, "dist-e2e");
const FIXTURE = path.join(ROOT, "test/fixture");
/** The seven Signal v2 questions, in the order the preset asks them. The beta does not touch this. */
const V2_IDS = ["topic", "information_density", "original_insight", "evidence", "actionable", "promotion", "engagement_bait"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The compact row a live Signal v2 run produces: promo 4 is silenced, bait 56 stays neutral. */
const LIVE: AnswerOverrides = {
  scores: { information_density: 3, original_insight: 0, evidence: 0, actionable: 1 },
  nouls: { promotion: 0.04, engagement_bait: 0.56 },
};
const LIVE_CHIPS = ["density 100", "insight 0", "evidence 0", "actionable 33", "bait 56"];

interface SessionSettings {
  apiKey: string;
  baseUrl: string;
  scope: string;
  dwellMs: number;
  concurrency: number;
  selectedPreset?: string;
  visionBetaEnabled?: boolean;
  model?: string;
  version?: number;
}

async function launch(profileSuffix: string): Promise<{ ctx: BrowserContext; sw: Worker }> {
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
  return { ctx, sw };
}

async function configure(sw: Worker, settings: SessionSettings): Promise<void> {
  await sw.evaluate(async (s: SessionSettings) => {
    await chrome.storage.local.set({ settings: { showAnalysisHud: true, ...s } });
  }, settings);
}

/** A post with the markup X uses for an attached photo, so the real extraction path is exercised. */
async function exposePost(
  page: Page,
  opts: { id: string; handle: string; text: string; photo?: string; quotedPhoto?: string },
): Promise<void> {
  await page.evaluate(
    ({ id, handle, text, photo, quotedPhoto }) => {
      const list = document.querySelector('[data-testid="primaryColumn"] section') ?? document.body;
      const photoBox = (src: string) => '<div data-testid="tweetPhoto"><img src="' + src + '" alt="post photo" /></div>';
      const cell = document.createElement("div");
      cell.setAttribute("data-testid", "cellInnerDiv");
      cell.innerHTML =
        '<article data-testid="tweet" role="article" tabindex="0">' +
        '<div class="avatar"></div>' +
        '<div class="col">' +
        '<div data-testid="User-Name"><a href="/' + handle + '"><span>' + handle + '</span></a>' +
        '<a href="/' + handle + '/status/' + id + '"><time datetime="2026-10-18T09:00:00Z">1h</time></a></div>' +
        '<div data-testid="tweetText"><span>' + text + '</span></div>' +
        (photo ? photoBox(photo) : "") +
        (quotedPhoto
          ? '<div role="link" tabindex="0"><div data-testid="User-Name"><a href="/quoted/status/9001"><time>2h</time></a></div>' +
            '<div data-testid="tweetText"><span>Quoted post</span></div>' + photoBox(quotedPhoto) + "</div>"
          : "") +
        '<div role="group" aria-label="actions"><button>reply</button></div>' +
        "</div>" +
        "</article>";
      list.appendChild(cell);
      cell.scrollIntoView({ block: "center" });
    },
    { id: opts.id, handle: opts.handle, text: opts.text, photo: opts.photo ?? null, quotedPhoto: opts.quotedPhoto ?? null },
  );
}

/** Waits until one named post has a finished Signal v2 row, then reads the row and its request. */
async function awaitDone(page: Page, prefix: string): Promise<void> {
  await page.waitForFunction(
    (p) => {
      const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
      const slot = art?.querySelector(".xs-slot");
      return slot?.getAttribute("data-state") === "done" && slot?.getAttribute("data-display") === "normalized";
    },
    prefix,
    { timeout: 25000 },
  );
}

async function readRow(page: Page, prefix: string): Promise<{ chips: string[]; vision: string | null; topic: string | null; warn: string | null }> {
  return await page.evaluate((p) => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
    const slot = art?.querySelector(".xs-slot") as HTMLElement | null;
    const chip = (e: Element) => (e.textContent || "").trim().split(/\s+/).slice(-2).join(" ");
    return {
      chips: Array.from(slot?.querySelectorAll(".xs-dim, .xs-warn") ?? []).map(chip),
      vision: slot?.querySelector(".xs-vision")?.textContent ?? null,
      topic: slot?.querySelector(".xs-topic")?.textContent ?? null,
      warn: slot?.dataset.warn ?? null,
    };
  }, prefix);
}

/** Opens the detail card of one post and reads the mode line and the foot together. */
async function readDetail(page: Page, prefix: string): Promise<{ mode: string | null; foot: string; rows: number }> {
  await page.evaluate((p) => {
    const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
    (art?.querySelector(".xs-slot") as HTMLElement | null)?.click();
  }, prefix);
  await page.waitForSelector(".xs-detail");
  const out = await page.evaluate(() => ({
    mode: document.querySelector(".xs-detail-mode")?.textContent ?? null,
    foot: document.querySelector(".xs-detail-foot")?.textContent ?? "",
    rows: document.querySelectorAll(".xs-detail-row").length,
  }));
  // Closed by a click on empty page chrome, the way a reader closes it, so the card's own bookkeeping
  // stays consistent for the next click instead of being torn out from under it.
  await page.mouse.click(5, 400);
  await page.waitForFunction(() => !document.querySelector(".xs-detail"), null, { timeout: 5000 });
  return out;
}

/** Requests for one post under the Signal v2 schema: the billable-answer count. */
function bills(server: { requests: SeenRequest[] }, prefix: string): number {
  return server.requests.filter((r) => r.text.startsWith(prefix) && r.questionIds.join(",") === V2_IDS.join(",")).length;
}

function find(server: { requests: SeenRequest[] }, prefix: string): SeenRequest | undefined {
  return server.requests.find((r) => r.text.startsWith(prefix));
}

async function openTimeline(ctx: BrowserContext, base: string): Promise<{ page: Page; errors: string[] }> {
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/posts.html");
  await page.waitForFunction(() => document.querySelectorAll('.xs-slot[data-state="done"]').length >= 1, null, { timeout: 20000 });
  return { page, errors };
}

/** Polls until a counter stops changing, and returns the settled value. */
async function settle(read: () => number | Promise<number>, tries = 25, gapMs = 200): Promise<number> {
  let last = await read();
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, gapMs));
    const now = await read();
    if (now === last) return now;
    last = now;
  }
  return last;
}

test("vision beta off: the photo is never fetched, never sent, and the row reads exactly as before", async (t) => {
  const server = await startServer(FIXTURE, LIVE);
  const { ctx, sw } = await launch("vision-off");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  // The default install: Signal v2 chosen, the beta untouched. Nothing below may depend on the photo.
  await configure(sw, { apiKey: "test-key", baseUrl: base, scope: "all", dwellMs: 0, concurrency: 6, selectedPreset: "signal_v2" });
  await ctx.addCookies([{ name: "xs_privacy_probe", value: "must-not-travel", url: base }]);
  const { page, errors } = await openTimeline(ctx, base);

  const TEXT = "Vision off probe: 41% latency drop across 12 clusters, chart attached.";
  await exposePost(page, { id: "7001", handle: "erin", text: TEXT, photo: base + "/media/ok.png" });
  await awaitDone(page, TEXT);

  const req = find(server, TEXT);
  assert.ok(req, "the post was analyzed");
  assert.equal(req!.model, "jev-1.14.0", "the default text model answers, not the vision one");
  assert.deepEqual(req!.questionIds, V2_IDS, "the seven Signal v2 questions are unchanged");
  assert.equal(req!.attachedImage, undefined, "no image reference");
  assert.equal(req!.assetBase64, undefined, "no asset");
  assert.equal(req!.imageHeader, undefined, "the image opt-in header is absent");

  assert.deepEqual(downloaded(server), [], "the extension never fetched the photo");

  const row = await readRow(page, TEXT);
  assert.equal(row.vision, null, "no vision marker");
  assert.equal(row.topic, "AI");
  assert.deepEqual(row.chips, LIVE_CHIPS, "the compact row is byte-for-byte the pre-beta row");
  assert.equal(row.warn, null);

  const detail = await readDetail(page, TEXT);
  assert.equal(detail.mode, null, "a text-only result adds no mode line");
  assert.match(detail.foot, /^\d+ tok · \$0\.\d{6} · \d+ ms · jev-1\.14\.0$/);
  assert.equal(bills(server, TEXT), 1);
  assert.deepEqual(errors, []);
});

test("vision beta on with a different preset: the photo stays behind", async (t) => {
  const server = await startServer(FIXTURE, LIVE);
  const { ctx, sw } = await launch("vision-off-preset");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  // The beta was validated against Signal v2 only, so any other preset keeps the text-only path
  // even with the switch on.
  await configure(sw, {
    apiKey: "test-key",
    baseUrl: base,
    scope: "all",
    dwellMs: 0,
    concurrency: 6,
    selectedPreset: "default",
    visionBetaEnabled: true,
  });
  const { page, errors } = await openTimeline(ctx, base);

  const TEXT = "Default preset probe with a photo attached, 12 clusters and 41% off.";
  await exposePost(page, { id: "7002", handle: "frank", text: TEXT, photo: base + "/media/ok.png" });
  await page.waitForFunction(
    (p) => {
      const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
      return art?.querySelector(".xs-slot")?.getAttribute("data-state") === "done";
    },
    TEXT,
    { timeout: 25000 },
  );

  const req = find(server, TEXT);
  assert.ok(req, "the post was analyzed under Default");
  assert.equal(req!.model, "jev-1.14.0");
  assert.equal(req!.attachedImage, undefined);
  assert.equal(req!.imageHeader, undefined);
  assert.deepEqual(downloaded(server), [], "a non-Signal-v2 preset never downloads the photo");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".xs-vision").length), 0);
  // Default asks its own questions, so count every request for this post rather than the Signal v2 slice.
  assert.equal(
    server.requests.filter((r) => r.text.startsWith(TEXT)).length,
    1,
    "exactly one billable request",
  );
  assert.deepEqual(errors, []);
});

test("vision beta on: one image-aware request, marked in the UI, and the fallbacks all land on text", async (t) => {
  const server = await startServer(FIXTURE, LIVE);
  const { ctx, sw } = await launch("vision-on");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  await configure(sw, {
    apiKey: "test-key",
    baseUrl: base,
    scope: "all",
    dwellMs: 0,
    concurrency: 6,
    selectedPreset: "signal_v2",
    visionBetaEnabled: true,
  });
  await ctx.addCookies([{ name: "xs_privacy_probe", value: "must-not-travel", url: base }]);
  const { page, errors } = await openTimeline(ctx, base);

  // 1. A photo already inside the limits goes as it is: same bytes, same format, no re-encode.
  const OK = "Vision ok probe: 41% latency drop across 12 clusters, chart attached.";
  await exposePost(page, { id: "7101", handle: "gina", text: OK, photo: base + "/media/ok.png" });
  await awaitDone(page, OK);

  const okReq = find(server, OK);
  assert.ok(okReq, "the photo post reached the endpoint");
  assert.equal(okReq!.model, VISION_MODEL, "the vision model answers");
  assert.deepEqual(okReq!.questionIds, V2_IDS, "the same seven questions, so semantics are preserved");
  assert.match(okReq!.attachedImage ?? "", UUID_RE, "a fresh UUID reference per request");
  assert.equal(okReq!.imageHeader, "true", "the documented image opt-in header is set");
  assert.equal(okReq!.assetFormat, "png", "a photo inside the limits is not re-encoded");
  const okBytes = Buffer.from(okReq!.assetBase64!, "base64");
  assert.equal(okBytes.byteLength, png(640, 480).byteLength, "the bytes sent are the bytes downloaded");
  assert.deepEqual(pngInfo(okBytes), { width: 640, height: 480, animated: false });
  assert.ok(!/[^A-Za-z0-9+/=]/.test(okReq!.assetBase64!), "standard base64 alphabet with padding only");

  // The extension fetched the photo once, and the request carried neither the reader's cookie nor
  // the API key: the download is public, and the key only ever goes to the API host.
  const dl = downloaded(server);
  assert.deepEqual(dl.map((m) => m.path), ["/media/ok.png"]);
  assert.equal(dl[0]!.cookie, undefined, "credentials are never sent to the media host");
  assert.equal(dl[0]!.authorization, undefined, "the API key never reaches the media host");

  const okRow = await readRow(page, OK);
  assert.equal(okRow.vision, "vision", "the row says which mode produced it");
  assert.equal(okRow.topic, "AI");
  assert.deepEqual(okRow.chips, LIVE_CHIPS, "the seven answers render exactly as they always did");
  const okDetail = await readDetail(page, OK);
  assert.equal(okDetail.mode, "analysis mode: vision · post image attached");
  assert.match(okDetail.foot, /^\d+ tok · \$0\.\d{6} · \d+ ms · jev-1\.14\.0$/);
  const okTokens = Number(/^(\d+) tok/.exec(okDetail.foot)![1]);
  assert.ok(okTokens > 1160, "the image is billed as tokens on top of the text");
  assert.equal(bills(server, OK), 1, "one billable answer for the image-aware request");

  // 2. A post with no photo is analyzed on its text alone, and says so.
  const NONE = "Vision no-photo probe: 12 clusters, 41% latency drop, nothing attached.";
  await exposePost(page, { id: "7102", handle: "hank", text: NONE });
  await awaitDone(page, NONE);
  const noneReq = find(server, NONE);
  assert.equal(noneReq!.model, "jev-1.14.0", "no photo means the default text model");
  assert.equal(noneReq!.attachedImage, undefined);
  assert.equal(noneReq!.imageHeader, undefined);
  const noneRow = await readRow(page, NONE);
  assert.equal(noneRow.vision, null, "a text-only result carries no vision marker");
  assert.deepEqual(noneRow.chips, LIVE_CHIPS);
  assert.equal((await readDetail(page, NONE)).mode, null);

  // 3. An oversized photo is scaled down proportionally in the browser and re-encoded as JPEG.
  const BIG = "Vision oversized probe: 12 clusters, 41% latency drop, huge chart.";
  await exposePost(page, { id: "7103", handle: "iris", text: BIG, photo: base + "/media/big.png" });
  await awaitDone(page, BIG);
  const bigReq = find(server, BIG);
  assert.equal(bigReq!.model, VISION_MODEL);
  assert.equal(bigReq!.assetFormat, "jpg", "a resized photo is re-encoded, so it arrives as JPEG");
  const bigDims = jpegSize(Buffer.from(bigReq!.assetBase64!, "base64"));
  assert.deepEqual(bigDims, targetSize(2000, 1500), "sent at the proportional size the limits allow");
  assert.equal(bigDims.width, 1568);
  assert.equal(bigDims.height, 1176);
  assert.ok(Math.abs(bigDims.width / bigDims.height - 2000 / 1500) < 0.01, "the aspect ratio survived");
  assert.equal((await readRow(page, BIG)).vision, "vision");

  // 4. A format Jev does not accept is re-encoded into one that it does, not refused outright.
  const GIF = "Vision gif probe: 12 clusters, 41% latency drop, animated chart.";
  await exposePost(page, { id: "7104", handle: "jake", text: GIF, photo: base + "/media/photo.gif" });
  await awaitDone(page, GIF);
  const gifReq = find(server, GIF);
  assert.equal(gifReq!.model, VISION_MODEL, "an unsupported still format is converted, not dropped");
  assert.equal(gifReq!.assetFormat, "jpg");
  assert.deepEqual(jpegSize(Buffer.from(gifReq!.assetBase64!, "base64")), targetSize(320, 200));
  assert.equal((await readRow(page, GIF)).vision, "vision");

  // 5. A photo that cannot be fetched falls back to text-only scoring for that post.
  const GONE = "Vision missing-media probe: 12 clusters, 41% latency drop, broken chart.";
  await exposePost(page, { id: "7105", handle: "kara", text: GONE, photo: base + "/media/missing.jpg" });
  await awaitDone(page, GONE);
  const goneReq = find(server, GONE);
  assert.equal(goneReq!.model, "jev-1.14.0", "a failed download is scored on text alone with default model");
  assert.equal(goneReq!.attachedImage, undefined);
  assert.equal(goneReq!.imageHeader, undefined);
  assert.equal((await readRow(page, GONE)).vision, null, "the row does not claim an image it never saw");
  assert.equal(bills(server, GONE), 1, "the fallback is one answer, not two");

  // 6. An image inside a quoted post is never sent: it belongs to someone else's content.
  const QUOTE = "Vision quoted-image probe: 12 clusters, 41% latency drop.";
  await exposePost(page, { id: "7106", handle: "leo", text: QUOTE, quotedPhoto: base + "/media/ok.png" });
  await awaitDone(page, QUOTE);
  const quoteReq = find(server, QUOTE);
  assert.equal(quoteReq!.model, "jev-1.14.0");
  assert.equal(quoteReq!.attachedImage, undefined);
  assert.equal(
    downloaded(server).filter((m) => m.path === "/media/ok.png").length,
    1,
    "the quoted post's photo was not downloaded a second time",
  );

  // Exactly one request per post, and only the photo posts went through the vision path.
  for (const prefix of [OK, NONE, BIG, GIF, GONE, QUOTE]) assert.equal(bills(server, prefix), 1, prefix + " billed once");
  assert.deepEqual(
    server.requests.filter((r) => r.imageHeader).map((r) => r.text.slice(0, 24)).sort(),
    [OK, BIG, GIF].map((s) => s.slice(0, 24)).sort(),
    "only the three posts that actually had a sendable photo carried the image",
  );
  assert.deepEqual(errors, []);
});

test("a failing vision call falls back to text and bills exactly one answer", async (t) => {
  const server = await startServer(FIXTURE, { ...LIVE, failVision: true });
  const { ctx, sw } = await launch("vision-fail");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  await configure(sw, {
    apiKey: "test-key",
    baseUrl: base,
    scope: "all",
    dwellMs: 0,
    concurrency: 6,
    selectedPreset: "signal_v2",
    visionBetaEnabled: true,
  });
  const { page, errors } = await openTimeline(ctx, base);

  /** Lifetime counters include the fixture posts, so the interesting number is the change. */
  const analyzed = () =>
    sw.evaluate(async () => {
      const got = await chrome.storage.local.get("stats");
      return ((got.stats ?? { analyzed: 0 }) as { analyzed: number }).analyzed;
    });
  // The fixture posts are still finishing when the page reports its first done row, and the counter
  // is written asynchronously, so wait for both the endpoint and the counter to stop moving. Only
  // then is a delta attributable to the post this test exposes.
  await settle(() => server.requests.length);
  const analyzedBefore = await settle(analyzed);

  const TEXT = "Vision failure probe: 12 clusters, 41% latency drop, chart attached.";
  await exposePost(page, { id: "7201", handle: "mia", text: TEXT, photo: base + "/media/ok.png" });
  await awaitDone(page, TEXT);

  const mine = server.requests.filter((r) => r.text.startsWith(TEXT));
  assert.equal(mine.length, 2, "the failed image request and the text-only retry");
  assert.equal(mine[0]!.imageHeader, "true", "the vision attempt went out first");
  assert.equal(mine[1]!.imageHeader, undefined, "the fallback carries no image");
  assert.equal(mine[1]!.model, "jev-1.14.0");

  const row = await readRow(page, TEXT);
  assert.equal(row.vision, null, "the row reports the analysis that actually produced the answers");
  assert.equal(row.topic, "AI");
  assert.deepEqual(row.chips, LIVE_CHIPS, "the reader still gets all seven answers");
  const detail = await readDetail(page, TEXT);
  assert.equal(detail.mode, null);
  assert.match(detail.foot, /jev-1\.14\.0$/, "the foot names the model that answered");
  assert.equal(detail.rows, 6, "six numeric rows plus the topic row, as always");

  // The failed attempt returned no usage, so it is not counted as spend: one billable answer.
  assert.equal(bills(server, TEXT), 2, "both attempts went out");
  assert.equal(server.requests.filter((r) => r.text.startsWith(TEXT) && r.imageHeader).length, 1, "only one vision attempt");
  // bumpStats runs before the reply is returned, and the failed attempt answered no usage at all,
  // so the post counts exactly once rather than once per attempt. The counter is written
  // asynchronously, so wait for the count to stop moving before reading it.
  await settle(() => server.requests.length);
  assert.equal((await settle(analyzed)) - analyzedBefore, 1, "counted once, not once per attempt");
  assert.deepEqual(errors, []);
});

test("cache separation: text and vision answers are stored apart and neither is re-billed", async (t) => {
  const server = await startServer(FIXTURE, LIVE);
  const { ctx, sw } = await launch("vision-cache");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  const settings: SessionSettings = {
    apiKey: "test-key",
    baseUrl: base,
    scope: "all",
    dwellMs: 0,
    concurrency: 6,
    selectedPreset: "signal_v2",
    visionBetaEnabled: true,
  };
  await configure(sw, settings);
  const { page, errors } = await openTimeline(ctx, base);

  const TEXT = "Vision cache probe: 12 clusters, 41% latency drop, chart attached.";
  await exposePost(page, { id: "7301", handle: "noor", text: TEXT, photo: base + "/media/ok.png" });
  await awaitDone(page, TEXT);
  assert.equal((await readRow(page, TEXT)).vision, "vision", "starts as an image-aware result");
  assert.equal(bills(server, TEXT), 1);
  // The result cache is debounced by a second, so let it land before the mode changes.
  await page.waitForTimeout(1600);

  // Turning the beta off reads a different key, so the same post is asked again on text alone.
  await configure(sw, { ...settings, visionBetaEnabled: false });
  await page.waitForFunction(
    (p) => {
      const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
      return art?.querySelector(".xs-vision") === null && art?.querySelector(".xs-slot")?.getAttribute("data-state") === "done";
    },
    TEXT,
    { timeout: 20000 },
  );
  const offRow = await readRow(page, TEXT);
  assert.equal(offRow.vision, null, "the marker is gone, so the row no longer claims an image");
  assert.deepEqual(offRow.chips, LIVE_CHIPS);
  assert.equal(bills(server, TEXT), 2, "the text-only mode asked its own question");
  const textOnly = server.requests.filter((r) => r.text.startsWith(TEXT));
  assert.equal(textOnly.filter((r) => r.imageHeader).length, 1, "one vision request");
  assert.equal(textOnly.filter((r) => !r.imageHeader).length, 1, "one text request");
  assert.deepEqual(
    textOnly.map((r) => r.model),
    [VISION_MODEL, "jev-1.14.0"],
    "each mode was answered under jev-1.14.0 with isolated cache namespaces",
  );
  await page.waitForTimeout(1600);

  // Turning the beta back on serves the stored vision answer instead of billing a third time.
  await configure(sw, settings);
  await page.waitForFunction(
    (p) => {
      const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
      return (art?.querySelector(".xs-vision")?.textContent ?? "") === "vision";
    },
    TEXT,
    { timeout: 20000 },
  );
  assert.equal(bills(server, TEXT), 2, "switching back reused the stored vision answer");
  assert.equal(server.requests.filter((r) => r.text.startsWith(TEXT)).length, 2, "no duplicate billable request");
  assert.equal((await readDetail(page, TEXT)).mode, "analysis mode: vision · post image attached");
  assert.deepEqual(downloaded(server).map((m) => m.path), ["/media/ok.png"], "the photo was downloaded once");
  assert.deepEqual(errors, []);
});

/**
 * The downloads x-scanner itself made. Rendering the fixture's <img> fetches the same path through
 * the browser's own image pipeline, which is not the extension transmitting anything, so it is
 * filtered out by the Sec-Fetch pair the server records.
 */
function downloaded(server: { mediaRequests: MediaRequest[] }): MediaRequest[] {
  return server.mediaRequests.filter((m) => m.mode === "cors" && m.dest === "empty");
}

/** Polls until a counter stops changing, and returns the settled value. */

test("explicit jev-1.13.0 override: text routing, fallbacks, and cache isolation", async (t) => {
  const server = await startServer(FIXTURE, LIVE);
  const { ctx, sw } = await launch("vision-override-113");
  t.after(async () => {
    await ctx.close();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.port;
  const settings: SessionSettings = {
    apiKey: "test-key",
    baseUrl: base,
    scope: "all",
    dwellMs: 0,
    concurrency: 6,
    selectedPreset: "signal_v2",
    visionBetaEnabled: true,
    model: "jev-1.13.0",
    version: 8,
  };
  await configure(sw, settings);
  const { page, errors } = await openTimeline(ctx, base);

  // 1. Text-only post routes to explicitly configured model jev-1.13.0
  const TEXT_POST = "Explicit 1.13 text probe: 12 clusters, 41% latency drop.";
  await exposePost(page, { id: "9101", handle: "alice", text: TEXT_POST });
  await awaitDone(page, TEXT_POST);
  const textReq = find(server, TEXT_POST);
  assert.ok(textReq, "text post was analyzed");
  assert.equal(textReq!.model, "jev-1.13.0", "configured model is used for text-only scoring");
  assert.equal(textReq!.attachedImage, undefined);
  assert.equal(textReq!.imageHeader, undefined);
  const textRow = await readRow(page, TEXT_POST);
  assert.equal(textRow.vision, null, "text-only result carries no vision badge");

  // 2. Vision post routes to VISION_MODEL (jev-1.14.0) with attached image
  const VIS_POST = "Explicit 1.13 vision probe: 12 clusters, 41% latency drop, chart.";
  await exposePost(page, { id: "9102", handle: "bob", text: VIS_POST, photo: base + "/media/ok.png" });
  await awaitDone(page, VIS_POST);
  const visReq = find(server, VIS_POST);
  assert.ok(visReq, "vision post reached endpoint");
  assert.equal(visReq!.model, "jev-1.14.0", "vision request uses VISION_MODEL regardless of text model override");
  assert.equal(visReq!.imageHeader, "true");
  assert.match(visReq!.attachedImage ?? "", UUID_RE);
  const visRow = await readRow(page, VIS_POST);
  assert.equal(visRow.vision, "vision", "vision result carries vision badge");

  // 3. Media acquisition failure falls back to configured model jev-1.13.0
  const MEDIA_FAIL_POST = "Explicit 1.13 media fail probe: 12 clusters, 41% latency drop.";
  await exposePost(page, { id: "9103", handle: "carol", text: MEDIA_FAIL_POST, photo: base + "/media/missing.jpg" });
  await awaitDone(page, MEDIA_FAIL_POST);
  const mediaFailReq = find(server, MEDIA_FAIL_POST);
  assert.ok(mediaFailReq, "media fail post reached endpoint");
  assert.equal(mediaFailReq!.model, "jev-1.13.0", "media failure fallback uses configured text model");
  assert.equal(mediaFailReq!.attachedImage, undefined);
  assert.equal(mediaFailReq!.imageHeader, undefined);
  assert.equal((await readRow(page, MEDIA_FAIL_POST)).vision, null);

  // 4. Cache isolation across model switch: switching model to jev-1.14.0 re-analyzes under 1.14.0
  await page.waitForTimeout(1600);
  await configure(sw, { ...settings, model: "jev-1.14.0" });
  // Wait for the text post to re-analyze under jev-1.14.0
  await page.waitForFunction(
    (p) => {
      const art = Array.from(document.querySelectorAll("article")).find((a) => (a.textContent || "").includes(p));
      const slot = art?.querySelector(".xs-slot");
      return slot?.getAttribute("data-state") === "done";
    },
    TEXT_POST,
    { timeout: 20000 },
  );
  // Give it a moment to land in requests
  await page.waitForTimeout(500);
  const allTextReqs = server.requests.filter((r) => r.text.startsWith(TEXT_POST));
  assert.equal(allTextReqs.length, 2, "model change caused re-analysis under new model");
  assert.equal(allTextReqs[0]!.model, "jev-1.13.0");
  assert.equal(allTextReqs[1]!.model, "jev-1.14.0");

  // Switching model back to jev-1.13.0 reuses cached answer without re-billing
  await page.waitForTimeout(1600);
  await configure(sw, settings);
  await page.waitForTimeout(1000);
  const textReqsAfterSwitchBack = server.requests.filter((r) => r.text.startsWith(TEXT_POST));
  assert.equal(textReqsAfterSwitchBack.length, 2, "switching back reused cached jev-1.13.0 result");

  assert.deepEqual(errors, []);
});
