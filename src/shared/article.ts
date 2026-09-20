import type { ArticleExtract } from "./types.ts";

const DROP = "script,style,noscript,nav,footer,aside,form,iframe,svg,canvas,[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary']";
const ROOT = "article,[itemprop='articleBody'],main,[role='main'],#content,.post-content,.article-body,.entry-content,.post-body";

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

export function extractReadable(html: string, fetchedUrl: string, maxChars: number, parse: (h: string) => Document = parseHtml): ArticleExtract {
  const doc = parse(html);
  const canonical = attr(doc, "link[rel='canonical']", "href") || attr(doc, "meta[property='og:url']", "content") || fetchedUrl;
  const url = abs(canonical, fetchedUrl) ?? fetchedUrl;
  const title =
    attr(doc, "meta[property='og:title']", "content") ||
    attr(doc, "meta[name='twitter:title']", "content") ||
    doc.querySelector("title")?.textContent?.trim() ||
    hostOf(url);
  const siteName = attr(doc, "meta[property='og:site_name']", "content") || undefined;
  for (const n of Array.from(doc.querySelectorAll(DROP))) n.remove();
  const root = (doc.querySelector(ROOT) ?? doc.body) as Element | null;
  const chunks: string[] = [];
  if (root) {
    for (const el of Array.from(root.querySelectorAll("h1,h2,h3,p,li"))) {
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t.length >= 40 || /^h[123]$/i.test(el.tagName)) chunks.push(t);
    }
  }
  let text = chunks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) text = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  const capped = capAtChars(text, maxChars);
  return { title: title.slice(0, 300), url, domain: hostOf(url), siteName, text: capped.text, truncated: capped.truncated, charCount: capped.text.length };
}

/**
 * Apply the article character cap. One implementation for both article kinds, so a native X Article
 * is truncated exactly the way a fetched page is: at a word boundary, marked with an ellipsis.
 */
export function capAtChars(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: trimTo(text, maxChars), truncated: true };
}

function attr(doc: Document, sel: string, name: string): string {
  return (doc.querySelector(sel)?.getAttribute(name) ?? "").trim();
}

function abs(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function trimTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.7 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}
