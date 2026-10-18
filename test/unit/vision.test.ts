import { PRESET_BY_ID } from "../../src/shared/presets.ts";
import { questionsHash } from "../../src/shared/questions.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertReferenceSafe,
  canonicalMediaUrl,
  isAllowedMediaUrl,
  jpegSize,
  MAX_EDGE,
  MAX_PIXELS,
  MIN_EDGE,
  MIN_PIXELS,
  newVisionReference,
  pngInfo,
  targetSize,
  validateImageBytes,
  VISION_CONFIG_VERSION,
  VISION_MODEL,
  visionCacheSuffix,
} from "../../src/shared/vision.ts";
import { normalizeSettings } from "../../src/shared/settings.ts";

/** A PNG header walk only needs the chunk structure: pngInfo does not verify CRCs. */
function png(width: number, height: number, animated = false): Uint8Array {
  const chunks: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  const push = (type: string, data: number[]) => {
    const len = data.length;
    chunks.push((len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255);
    for (const c of type) chunks.push(c.charCodeAt(0));
    chunks.push(...data, 0, 0, 0, 0);
  };
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  if (animated) push("acTL", [...be(2), ...be(0)]);
  push("IHDR", [...be(width), ...be(height), 8, 2, 0, 0, 0]);
  push("IDAT", [0]);
  push("IEND", []);
  return new Uint8Array(chunks);
}

/** Minimal baseline JPEG: SOI, one SOF0 naming the dimensions, EOI. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
}

test("reads dimensions out of a PNG and flags an animated one", () => {
  assert.deepEqual(pngInfo(png(640, 480)), { width: 640, height: 480, animated: false });
  assert.equal(pngInfo(png(640, 480, true)).animated, true);
  assert.throws(() => pngInfo(new Uint8Array([1, 2, 3, 4])), /too small|not a png/);
});

test("reads dimensions out of a JPEG frame header", () => {
  assert.deepEqual(jpegSize(jpeg(1200, 800)), { width: 1200, height: 800 });
  assert.throws(() => jpegSize(new Uint8Array([0x89, 0x50])), /not a jpeg/);
});

test("accepts a photo inside the limits and rejects everything else with a reason", () => {
  assert.deepEqual(validateImageBytes(png(640, 480), "post image"), {
    format: "png",
    width: 640,
    height: 480,
    bytes: png(640, 480).byteLength,
  });
  assert.equal(validateImageBytes(jpeg(640, 480), "post image").format, "jpg");
  assert.throws(() => validateImageBytes(png(640, 480, true), "post image"), /animated PNG/);
  assert.throws(() => validateImageBytes(png(2000, 1500), "post image"), /edge 2000x1500/);
  assert.throws(() => validateImageBytes(png(100, 100), "post image"), /edge 100x100/);
  // A WebP file: RIFF magic, neither PNG nor JPEG.
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.throws(() => validateImageBytes(webp, "post image"), /only PNG or JPEG/);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  assert.throws(() => validateImageBytes(gif, "post image"), /only PNG or JPEG/);
});

test("scales an oversized photo down proportionally", () => {
  const s = targetSize(2000, 1500);
  assert.ok(s);
  assert.equal(s.width, 1568);
  assert.equal(s.height, 1176);
  assert.ok(Math.abs(s.width / s.height - 2000 / 1500) < 0.01, "aspect ratio preserved");
});

test("scales an undersized photo up proportionally", () => {
  const s = targetSize(200, 150);
  assert.ok(s);
  assert.equal(s.height, MIN_EDGE);
  assert.equal(s.width, 373);
  assert.ok(s.width * s.height >= MIN_PIXELS);
});

test("leaves a photo already inside the band alone", () => {
  assert.deepEqual(targetSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(targetSize(MAX_EDGE, MAX_EDGE), { width: MAX_EDGE, height: MAX_EDGE });
});

test("pulls a photo over the pixel ceiling back under it without cropping", () => {
  const s = targetSize(1568, 1568);
  assert.ok(s);
  assert.ok(s.width * s.height <= MAX_PIXELS);
  assert.ok(Math.min(s.width, s.height) >= MIN_EDGE);
});

test("returns null when no proportional size fits, so the post is scored on text alone", () => {
  // Extreme panorama: lifting the short side to 280 pushes the long side past 1568.
  assert.equal(targetSize(6000, 300), null);
  assert.equal(targetSize(300, 6000), null);
  assert.equal(targetSize(0, 500), null);
  assert.equal(targetSize(500, -1), null);
  assert.equal(targetSize(Number.NaN, 500), null);
  // Every result that is returned is inside the accepted band.
  for (const [w, h] of [[2000, 1500], [100, 90], [1568, 400], [900, 1600], [3000, 3000]] as const) {
    const s = targetSize(w, h);
    if (!s) continue;
    assert.ok(s.width >= MIN_EDGE && s.width <= MAX_EDGE, w + "x" + h + " width in band");
    assert.ok(s.height >= MIN_EDGE && s.height <= MAX_EDGE, w + "x" + h + " height in band");
    assert.ok(s.width * s.height >= MIN_PIXELS && s.width * s.height <= MAX_PIXELS, w + "x" + h + " area in band");
  }
});

test("only X's own photo CDN is fetchable", () => {
  assert.equal(isAllowedMediaUrl("https://pbs.twimg.com/media/Gabc.jpg"), true);
  assert.equal(isAllowedMediaUrl("https://pbs.twimg.com/media/Gabc?format=jpg&name=small"), true);
  assert.equal(isAllowedMediaUrl("https://pbs.twimg.com/profile_images/1/x.jpg"), false, "avatars are not post photos");
  assert.equal(isAllowedMediaUrl("https://pbs.twimg.com/emoji/2.svg"), false);
  assert.equal(isAllowedMediaUrl("http://pbs.twimg.com/media/Gabc.jpg"), false, "plain http is refused");
  assert.equal(isAllowedMediaUrl("https://evil.example/media/Gabc.jpg"), false);
  assert.equal(isAllowedMediaUrl("https://pbs.twimg.com.evil.example/media/x.jpg"), false);
  assert.equal(isAllowedMediaUrl("/media/relative.jpg"), false);
  assert.equal(isAllowedMediaUrl("not a url"), false);
  assert.equal(isAllowedMediaUrl(""), false);
});

test("the canonical URL pins the original and ignores cosmetic query parameters", () => {
  assert.equal(canonicalMediaUrl("https://pbs.twimg.com/media/Gabc.jpg"), "https://pbs.twimg.com/media/Gabc.jpg?name=orig");
  assert.equal(
    canonicalMediaUrl("https://pbs.twimg.com/media/Gabc.jpg?format=jpg&name=small"),
    "https://pbs.twimg.com/media/Gabc.jpg?name=orig",
  );
  assert.equal(
    canonicalMediaUrl("https://pbs.twimg.com/media/Gabc.jpg?name=orig"),
    "https://pbs.twimg.com/media/Gabc.jpg?name=orig",
    "already canonical, so it does not become a second cache identity",
  );
  assert.equal(canonicalMediaUrl("https://pbs.twimg.com/profile_images/1/x.jpg"), null);
});

test("vision cache identity is stable and separate from the text-only one", () => {
  const url = "https://pbs.twimg.com/media/Gabc.jpg?name=orig";
  assert.equal(visionCacheSuffix(url), visionCacheSuffix(url), "same photo, same key");
  assert.notEqual(visionCacheSuffix(url), visionCacheSuffix("https://pbs.twimg.com/media/Gxyz.jpg?name=orig"));
  const suffix = visionCacheSuffix(url);
  assert.equal(suffix.startsWith("#v" + VISION_CONFIG_VERSION + ":"), true, "names the contract version");
  assert.match(suffix, /^#v\d+:[0-9a-f]{8}$/);
  // The model is inside the hash, so a model change retires stored vision results.
  assert.notEqual(VISION_MODEL, "jev-1.13.0");
  assert.equal(VISION_MODEL, "jev-1.14.0");
});

test("a reference must be a fresh UUID that occurs nowhere in the request", () => {
  const ref = newVisionReference();
  assert.match(ref, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(newVisionReference(), newVisionReference(), "a new reference per request");
  assert.doesNotThrow(() => assertReferenceSafe(ref, "a post about images", { topic: { type: "choice" } }));
  assert.throws(() => assertReferenceSafe("photo-1", "a post about images", {}), /must be a UUID/);
  assert.throws(() => assertReferenceSafe(ref, "look at " + ref + " here", {}), /collides/);
  assert.throws(() => assertReferenceSafe(ref, "clean text", { q: { criteria: { ref } } }), /collides/);
});

test("the vision beta is off by default and survives a partial or legacy settings object", () => {
  assert.equal(normalizeSettings(undefined).visionBetaEnabled, false);
  assert.equal(normalizeSettings({}).visionBetaEnabled, false);
  assert.equal(normalizeSettings({ version: 7, apiKey: "keep-me" }).visionBetaEnabled, false);
  assert.equal(normalizeSettings({ visionBetaEnabled: true }).visionBetaEnabled, true);
  assert.equal(normalizeSettings({ visionBetaEnabled: "yes" }).visionBetaEnabled, false, "only a real boolean turns it on");
  const upgraded = normalizeSettings({ version: 7, apiKey: "keep-me", selectedPreset: "signal_v2" });
  assert.equal(upgraded.apiKey, "keep-me", "an existing install keeps its key when the beta is added");
  assert.equal(upgraded.selectedPreset, "signal_v2");
  assert.equal(upgraded.version, 8);
});


test("cache identity isolates results across models and analysis modes", () => {
  const dims = PRESET_BY_ID.signal_v2.dimensions;
  const h14 = questionsHash(dims, "jev-1.14.0");
  const h13 = questionsHash(dims, "jev-1.13.0");
  assert.notEqual(h14, h13, "questionsHash must differ between jev-1.14.0 and jev-1.13.0");

  const url = "https://pbs.twimg.com/media/Gabc.jpg?name=orig";
  const suffix = visionCacheSuffix(url);
  const vKey14 = h14 + "|12345" + suffix;
  const vKey13 = h13 + "|12345" + suffix;
  assert.notEqual(vKey14, vKey13, "vision results for different models are keyed separately");
  assert.notEqual(h14 + "|12345", vKey14, "text and vision keys never collide");
});
