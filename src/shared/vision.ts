/**
 * Jev Vision beta: everything the image contract needs that can run in node, in the content script
 * and in the service worker alike. Browser-only work (fetching and re-encoding a photo) lives in
 * src/content/vision-media.ts.
 *
 * Limits and the wire shape are transcribed from the live TypeSafe image docs retrieved into
 * scratch/jev-vision-offline/out/docs/images.md and exercised against the real API in
 * scratch/jev-vision-real-media/. Both are evidence for this file, not dependencies of it.
 */
import { fnv1a } from "./hash.ts";
import { IS_E2E } from "./build.ts";

/** The vision-capable model. Both text-only analysis and Vision beta default to jev-1.14.0. */
export const VISION_MODEL = "jev-1.14.0";
/**
 * Version of the vision request contract: model, placement of the image, and the question set it is
 * asked against. Part of the cache identity, so raising it invalidates every stored vision result.
 */
export const VISION_CONFIG_VERSION = 1;
/** Required on every request that carries an image; without it the API answers 400. */
export const IMAGE_HEADER = "TypeSafe-Danger-Zone-Images";

/** Shortest and longest accepted side, in pixels. Both ends are inclusive. */
export const MIN_EDGE = 280;
export const MAX_EDGE = 1568;
/** Smallest and largest accepted area, the 280x280 and 1568x1568 squares. Inclusive. */
export const MIN_PIXELS = 78_400;
export const MAX_PIXELS = 2_458_624;
/** Per-file ceiling, counted after base64 decoding. */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export interface ImageInfo {
  format: "png" | "jpg";
  width: number;
  height: number;
  bytes: number;
}

export interface Size {
  width: number;
  height: number;
}

function u32(buf: Uint8Array, offset: number): number {
  return ((buf[offset]! << 24) | (buf[offset + 1]! << 16) | (buf[offset + 2]! << 8) | buf[offset + 3]!) >>> 0;
}

/** PNG header walk: dimensions plus whether the file is an animated PNG, which the API rejects. */
export function pngInfo(buf: Uint8Array): { width: number; height: number; animated: boolean } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 24) throw new Error("png too small");
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) throw new Error("not a png");
  }
  let width = 0;
  let height = 0;
  let animated = false;
  let saw = false;
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const len = u32(buf, offset);
    const type = String.fromCharCode(buf[offset + 4]!, buf[offset + 5]!, buf[offset + 6]!, buf[offset + 7]!);
    if (type === "IHDR") {
      width = u32(buf, offset + 8);
      height = u32(buf, offset + 12);
      saw = true;
    } else if (type === "acTL") {
      animated = true;
    }
    if (type === "IEND") break;
    offset += 12 + len;
  }
  if (!saw) throw new Error("png missing IHDR");
  return { width, height, animated };
}

/** JPEG frame header walk: the dimensions of the first start-of-frame segment. */
export function jpegSize(buf: Uint8Array): { width: number; height: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a jpeg");
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) throw new Error("jpeg marker expected");
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;
    const marker = buf[i]!;
    i++;
    if (marker === 0xd9) break;
    if (marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 1 >= buf.length) throw new Error("truncated jpeg segment");
    const len = (buf[i]! << 8) | buf[i + 1]!;
    if (len < 2 || i + len > buf.length) throw new Error("truncated jpeg segment");
    const sof = marker === 0xc0 || marker === 0xc1 || marker === 0xc2;
    if (sof) {
      if (i + 6 >= buf.length) throw new Error("truncated jpeg frame");
      const height = (buf[i + 3]! << 8) | buf[i + 4]!;
      const width = (buf[i + 5]! << 8) | buf[i + 6]!;
      return { width, height };
    }
    i += len;
  }
  throw new Error("jpeg has no frame header");
}

function checkGeometry(name: string, width: number, height: number): void {
  if (width < MIN_EDGE || height < MIN_EDGE || width > MAX_EDGE || height > MAX_EDGE) {
    throw new Error(name + ": edge " + width + "x" + height + " outside " + MIN_EDGE + ".." + MAX_EDGE);
  }
  const pixels = width * height;
  if (pixels < MIN_PIXELS || pixels > MAX_PIXELS) {
    throw new Error(name + ": pixel count " + pixels + " outside " + MIN_PIXELS + ".." + MAX_PIXELS);
  }
}

/**
 * Reject exactly what the documented image contract rejects, without resizing. Throws with a reason
 * naming the file, so the caller can log why an image was dropped instead of sent.
 */
export function validateImageBytes(buf: Uint8Array, name: string): ImageInfo {
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error(name + ": file exceeds 16 MiB");
  const png = buf[0] === 137 && buf[1] === 80;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!png && !jpeg) throw new Error(name + ": only PNG or JPEG is accepted");
  if (png) {
    const info = pngInfo(buf);
    if (info.animated) throw new Error(name + ": animated PNG is rejected");
    checkGeometry(name, info.width, info.height);
    return { format: "png", width: info.width, height: info.height, bytes: buf.byteLength };
  }
  const info = jpegSize(buf);
  checkGeometry(name, info.width, info.height);
  return { format: "jpg", width: info.width, height: info.height, bytes: buf.byteLength };
}

/**
 * The size to re-encode an oversized or undersized image at: proportional, never cropped, so the
 * reader still sees the whole photo. Null when no size in the accepted band keeps the aspect ratio,
 * which happens for extreme panoramas (scaling the short side up past 280 pushes the long side past
 * 1568). A null means "send no image", and the post is scored on its text alone.
 */
export function targetSize(width: number, height: number): Size | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  let w = width;
  let h = height;
  const longest = Math.max(w, h);
  if (longest > MAX_EDGE) {
    const k = MAX_EDGE / longest;
    w *= k;
    h *= k;
  }
  const shortest = Math.min(w, h);
  if (shortest < MIN_EDGE) {
    const k = MIN_EDGE / shortest;
    w *= k;
    h *= k;
  }
  if (Math.max(w, h) > MAX_EDGE) return null;
  const pixels = w * h;
  if (pixels > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / pixels);
    w *= k;
    h *= k;
    if (Math.min(w, h) < MIN_EDGE) return null;
  } else if (pixels < MIN_PIXELS) {
    const k = Math.sqrt(MIN_PIXELS / pixels);
    w *= k;
    h *= k;
    if (Math.max(w, h) > MAX_EDGE) return null;
  }
  const out: Size = { width: Math.round(w), height: Math.round(h) };
  // Rounding is the last chance to leave the band; a rejected size falls back to text, not to a 413.
  if (out.width < MIN_EDGE || out.height < MIN_EDGE || out.width > MAX_EDGE || out.height > MAX_EDGE) return null;
  const area = out.width * out.height;
  if (area < MIN_PIXELS || area > MAX_PIXELS) return null;
  return out;
}

/**
 * Which images may be fetched at all. Only X's own photo CDN, and only its /media/ path: a post can
 * also render profile avatars, emoji sprites and card thumbnails, and none of those is the post's
 * photo. The e2e build widens this to the local fixture server so the same code path is testable.
 */
export function isAllowedMediaUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (IS_E2E && u.protocol === "http:" && u.hostname === "127.0.0.1") return true;
  return u.protocol === "https:" && u.hostname === "pbs.twimg.com" && u.pathname.startsWith("/media/");
}

/**
 * The identity of a photo, and the URL actually fetched. X serves a downscaled 1200px copy unless
 * asked for the original, so the canonical form pins ?name=orig; every other query parameter (a
 * format hint, a cache buster) names the same file and must not create a second cache entry.
 */
export function canonicalMediaUrl(raw: string): string | null {
  if (!isAllowedMediaUrl(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (IS_E2E && u.protocol === "http:") return u.origin + u.pathname;
  return u.origin + u.pathname + "?name=orig";
}

/**
 * Cache namespace for a vision result. A post analyzed with its photo and the same post analyzed on
 * text alone are different answers to different inputs, so they get different keys and neither can
 * be served for the other. Model and contract version are inside the hash: bumping either retires
 * every stored vision result without touching the text-only ones.
 */
export function visionCacheSuffix(canonicalUrl: string): string {
  return "#v" + VISION_CONFIG_VERSION + ":" + fnv1a(VISION_MODEL + "|" + canonicalUrl);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh reference per image per request: the pattern the docs call the safest choice. */
export function newVisionReference(): string {
  return crypto.randomUUID();
}

/**
 * References are matched as plain text anywhere in the request, so a reference that also occurs in
 * the post text would splice the image into that sentence. A UUID makes that practically impossible;
 * this check makes it impossible, and turns a collision into a text-only analysis.
 */
export function assertReferenceSafe(ref: string, text: string, questions: unknown): void {
  if (!UUID_RE.test(ref)) throw new Error("image reference must be a UUID");
  const haystack = text + "\n" + JSON.stringify(questions);
  if (haystack.includes(ref)) throw new Error("image reference collides with request text");
}
