const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "pic.x.com", "pic.twitter.com"]);
const MEDIA_HOSTS = new Set(["pbs.twimg.com", "video.twimg.com", "abs.twimg.com", "ton.twimg.com"]);
const VIDEO_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com", "vimeo.com", "www.vimeo.com", "tiktok.com", "www.tiktok.com", "instagram.com", "www.instagram.com"]);
const MEDIA_EXT = /\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mov|m4v|mp3|wav)(?:\?|$)/i;

export function normalizeHref(href: string, base?: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("javascript:") || raw.startsWith("mailto:") || raw.startsWith("data:")) return null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function isArticleCandidate(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (X_HOSTS.has(host) || MEDIA_HOSTS.has(host) || VIDEO_HOSTS.has(host)) return false;
  if (u.pathname.includes("/status/")) return false;
  if (MEDIA_EXT.test(u.pathname)) return false;
  return true;
}

/** Unique outbound article URLs in document order. t.co is kept so the background can resolve it. */
export function uniqueArticleUrls(hrefs: string[], base?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    const abs = normalizeHref(href, base);
    if (!abs || !isArticleCandidate(abs)) continue;
    const key = abs.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs);
  }
  return out;
}

export function originPattern(url: string): string {
  const u = new URL(url);
  return `${u.origin}/*`;
}

