/**
 * Fetching and preparing the one photo a vision analysis sends.
 *
 * Runs in the content script, on the page that already rendered the image, so it needs no extra
 * host permission and no new manifest entry. Every failure path returns null: the caller then asks
 * for a text-only analysis, which is the same call it would have made with the beta switched off.
 * Nothing here throws.
 */
import type { VisionImage } from "../shared/types.ts";
import { canonicalMediaUrl, MAX_IMAGE_BYTES, targetSize, validateImageBytes } from "../shared/vision.ts";

/** Re-encode quality when an image has to be resized. JPEG at 0.88 keeps text in a screenshot readable. */
const JPEG_QUALITY = 0.88;

/**
 * Download the photo at "raw", make it fit the image contract, and return it base64-encoded. Null
 * when the URL is not an allowed photo, the download fails, the bytes are not a usable still image,
 * or no proportional size fits the accepted band.
 */
export async function acquireVisionImage(raw: string): Promise<VisionImage | null> {
  const url = canonicalMediaUrl(raw);
  if (!url) return null;
  let bytes: Uint8Array;
  try {
    // Same-origin-ish CDN fetch from the page that already showed this image: CORS is allowed on
    // pbs.twimg.com, and credentials are never sent, so nothing private leaves the browser.
    const res = await fetch(url, { mode: "cors", credentials: "omit", redirect: "follow" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
    bytes = new Uint8Array(buf);
  } catch {
    return null;
  }

  // A photo already inside the limits goes as it is: re-encoding it would cost quality for nothing.
  const direct = await encode(bytes, url);
  if (direct) return direct;

  const reencoded = await reencode(bytes);
  if (!reencoded) return null;
  return encode(reencoded, url);
}

/** Validate and base64-encode bytes that are believed to be a sendable image, or null. */
async function encode(bytes: Uint8Array, url: string): Promise<VisionImage | null> {
  let info;
  try {
    info = validateImageBytes(bytes, "post image");
  } catch {
    return null;
  }
  const encoded = await toBase64(bytes);
  if (!encoded) return null;
  return { data_base64: encoded, format: info.format, mediaUrl: url };
}

/**
 * Decode, scale to a size the contract accepts, and re-encode as baseline JPEG. This is also how an
 * unsupported format (WebP, GIF, an animated PNG) becomes something sendable, and how rotation is
 * applied: createImageBitmap yields upright pixels and the re-encoded file carries no metadata.
 */
async function reencode(bytes: Uint8Array): Promise<Uint8Array | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart]));
  } catch {
    return null;
  }
  try {
    const size = targetSize(bitmap.width, bitmap.height);
    if (!size) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size === 0 || blob.size > MAX_IMAGE_BYTES) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/**
 * Standard-alphabet base64 with = padding and no whitespace, which is what the API requires. A Blob
 * plus FileReader produces exactly that in every supported browser without pulling in a codec.
 */
async function toBase64(bytes: Uint8Array): Promise<string | null> {
  try {
    const blob = new Blob([bytes as unknown as BlobPart]);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(blob);
    });
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const encoded = dataUrl.slice(comma + 1);
    return encoded && !/[^A-Za-z0-9+/=]/.test(encoded) ? encoded : null;
  } catch {
    return null;
  }
}
