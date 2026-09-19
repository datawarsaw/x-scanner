import type { TweetState } from "../shared/types.ts";
import { PROMOTED_LABELS, REPLYING_TO, SEL } from "./selectors.ts";
import { uniqueArticleUrls } from "../shared/links.ts";
import type { ExtractedContext } from "../shared/context.ts";

export interface ExtractedTweet {
  id: string;
  state: TweetState;
  promoted: boolean;
}

/** Pull id, text, quoted text and reply flag out of one article. Null when no id can be found. */
export function extractTweet(article: Element): ExtractedTweet | null {
  const id = tweetId(article);
  if (!id) return null;
  const texts = Array.from(article.querySelectorAll(SEL.tweetText));
  const main = texts.find((t) => !insideQuote(t, article));
  const quoted = texts.find((t) => insideQuote(t, article));
  const state: TweetState = { text: main ? readText(main) : "", is_reply: isReply(article) };
  if (quoted) {
    const q = readText(quoted);
    if (q) state.quoted_text = q;
  }
  return { id, state, promoted: isPromoted(article) };
}

export function tweetId(article: Element): string | null {
  const links = Array.from(article.querySelectorAll<HTMLAnchorElement>(SEL.statusLink)).filter((a) => !insideQuote(a, article));
  const withTime = links.find((a) => a.querySelector("time"));
  const pick = withTime ?? links[0];
  if (!pick) return null;
  const m = /\/status\/(\d+)/.exec(pick.getAttribute("href") ?? "");
  return m?.[1] ?? null;
}

function insideQuote(el: Element, article: Element): boolean {
  let p = el.parentElement;
  while (p && p !== article) {
    if (p.matches(SEL.quoteContainer)) return true;
    p = p.parentElement;
  }
  return false;
}

/** Text as a reader sees it: text nodes plus emoji image alt text, line breaks kept. */
export function readText(root: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName;
    if (tag === "IMG") {
      out += el.getAttribute("alt") ?? "";
      return;
    }
    if (tag === "BR") {
      out += "\n";
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(root);
  return out.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isPromoted(article: Element): boolean {
  if (article.closest(SEL.placementTracking)) return true;
  for (const span of Array.from(article.querySelectorAll("span"))) {
    if (span.closest(SEL.tweetText)) continue;
    if (span.children.length === 0 && PROMOTED_LABELS.has((span.textContent ?? "").trim())) return true;
  }
  return false;
}

export function isReply(article: Element): boolean {
  const body = article.querySelector(SEL.tweetText);
  for (const div of Array.from(article.querySelectorAll("div"))) {
    if (body && (div === body || div.contains(body) || body.contains(div))) continue;
    if (insideQuote(div, article)) continue;
    const t = (div.textContent ?? "").trim();
    if (t.length > 80) continue;
    if (REPLYING_TO.some((p) => t.startsWith(p)) && div.querySelector('a[href^="/"]')) return true;
  }
  return false;
}

/** Handle of the logged in account, from the left nav profile link. Null when not found. */
export function loggedInHandle(doc: Document = document): string | null {
  const a = doc.querySelector<HTMLAnchorElement>(SEL.profileLink);
  const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(a?.getAttribute("href") ?? "");
  return m?.[1] ?? null;
}

/** Outbound article hrefs from the main post, skipping quoted-post links. */
export function articleHrefs(article: Element, base?: string): string[] {
  const hrefs: string[] = [];
  for (const a of Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (insideQuote(a, article)) continue;
    const href = a.getAttribute("href");
    if (href) hrefs.push(href);
  }
  return uniqueArticleUrls(hrefs, base);
}

/**
 * Parent/thread text from nearby articles. Only used on /status/ pages so a home-timeline
 * neighbor is not treated as a parent.
 */
export function extractThreadContext(article: Element, doc: Document = document): ExtractedContext {
  const path = doc.defaultView?.location.pathname ?? "";
  if (!/\/status\/\d+/.test(path)) return {};
  const articles = Array.from(doc.querySelectorAll(SEL.article)).filter((a) => a === article || !article.contains(a));
  const idx = articles.indexOf(article as HTMLElement);
  if (idx <= 0) return {};
  const parent = extractTweet(articles[idx - 1]!);
  const extra: ExtractedContext = {};
  if (parent?.state.text) extra.parent_text = parent.state.text;
  const thread: string[] = [];
  for (let i = Math.max(0, idx - 3); i < idx - 1; i++) {
    const t = extractTweet(articles[i]!);
    if (t?.state.text) thread.push(t.state.text);
  }
  if (thread.length) extra.thread = thread;
  return extra;
}
