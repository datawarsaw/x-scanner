// Synthetic images for the vision e2e tests, generated rather than stored, so the fixtures need no
// binary files in the repo. png() writes a real, decodable PNG with correct CRCs: src/shared/vision.ts
// does not verify them, but createImageBitmap does, and the re-encode path depends on it decoding.
// gif() writes a real GIF89a, which is the unsupported format that path has to turn into a JPEG.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 255]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 8-bit RGB PNG, one flat colour per row so it compresses fast and still decodes to a real image. */
export function png(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // ihdr[10..12] stay 0: deflate, no filter, no interlace.
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 0; // filter type: none
    const r = (y * 5) & 255;
    const g = (y * 11) & 255;
    const b = 255 - ((y * 3) & 255);
    for (let x = 0; x < width; x++) {
      const p = o + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Two-colour GIF89a of one flat colour. Every literal is preceded by a clear code, which keeps the
 * decoder's string table empty and the code width at its minimum: uncompressed, but unambiguous.
 */
export function gif(width: number, height: number): Uint8Array {
  const minCodeSize = 2;
  const codeSize = minCodeSize + 1;
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const packed: number[] = [];
  let acc = 0;
  let bits = 0;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      packed.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  for (let i = 0; i < width * height; i++) {
    emit(0);
    emit(clear);
  }
  emit(end);
  if (bits > 0) packed.push(acc & 255);

  const blocks: number[] = [];
  for (let i = 0; i < packed.length; i += 255) {
    const slice = packed.slice(i, i + 255);
    blocks.push(slice.length, ...slice);
  }
  blocks.push(0); // block terminator

  const le16 = (n: number) => [n & 255, (n >> 8) & 255];
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
    ...le16(width),
    ...le16(height),
    0xf0, // global colour table present, 2 entries
    0x00, // background colour index
    0x00, // no aspect ratio info
    0x20, 0x40, 0x60, // colour 0
    0x80, 0xa0, 0xc0, // colour 1
    0x2c, // image descriptor
    ...le16(0),
    ...le16(0),
    ...le16(width),
    ...le16(height),
    0x00, // no local colour table, not interlaced
    minCodeSize,
    ...blocks,
    0x3b, // trailer
  ]);
}

export interface MediaFixture {
  bytes: Uint8Array;
  type: string;
}

const cache = new Map<string, MediaFixture | null>();

/**
 * The media the fixture timeline links to, built on first use. Names are chosen so a test reads as
 * the case it covers: a photo inside the limits, one over them, one in a format Jev does not accept,
 * and one that is simply not there.
 */
export function mediaFixture(name: string): MediaFixture | null {
  if (cache.has(name)) return cache.get(name)!;
  let fixture: MediaFixture | null = null;
  if (name === "ok.png") fixture = { bytes: png(640, 480), type: "image/png" };
  else if (name === "big.png") fixture = { bytes: png(2000, 1500), type: "image/png" };
  else if (name === "photo.gif") fixture = { bytes: gif(320, 200), type: "image/gif" };
  cache.set(name, fixture);
  return fixture;
}
