/**
 * Native X Article detection and extraction.
 *
 * An X Article is long-form content X renders itself inside the post's own page, next to the post's
 * author chrome. Reading it needs nothing new: no fetch, no host permission, no X API. Everything
 * here runs on the DOM the x.com content script already has.
 *
 * X's reader markup is neither documented nor stable, so detection is layered and deliberately
 * conservative: a miss is preferable to a wrong answer, and every layer is semantic - the route's
 * status id, heading roles, prose blocks, X's own data-testid names, DOM hierarchy - never a
 * generated class name and never a position on screen. The layers:
 *
 *   E1 container  a descendant whose data-testid names an article or long-form container and that
 *                 holds at least two long prose blocks. Catches a reader that keeps its own wrapper.
 *   E2 heading    an article heading plus at least two long prose blocks. Catches the semantic
 *                 article shape: title, lead, paragraphs.
 *   E3 long form  no short post text at all, and at least four long prose blocks. Catches an
 *                 untitled long form that X rendered straight into the post's own text container.
 *
 * Any one layer is enough. An ordinary post fails all three: it keeps its short post text (so E3
 * fails) and carries no article heading (so E2 fails), and its image or link card is chrome rather
 * than prose, so it contributes no blocks to either.
 *
 * Detection is scoped to a single post and only fires for the post whose own status id is the id in
 * the route, which is where X renders an article. A timeline neighbour, a quoted post inside the
 * article, or a reply beneath it can therefore never be mistaken for the article itself.
 */
import { SEL } from "./selectors.ts";
import { insideQuote, readText, statusHref, tweetId } from "./extract.ts";
import { routeHandle, routeStatusId } from "./route.ts";
import { capAtChars } from "../shared/article.ts";
import { fnv1a } from "../shared/hash.ts";

/** Word-match against data-testid values, so camelCase names read as words. */
const ARTICLE_WORDS = new Set(["article", "longform"]);

/** The paragraph-ish elements an article body is built from. */
const BLOCK_SEL = "p, li, blockquote, figcaption, h1, h2, h3, h4, h5, h6, [role='heading'], div, section";

/**
 * X's own chrome around a post. None of it is article prose, so none of it is read. The post's own
 * text is handled separately, because for one shape of long form X puts the body in that container.
 */
const CHROME_SEL = [
  SEL.quoteContainer,
  SEL.showMore,
  SEL.actionBar,
  '[data-testid="User-Name"]',
  '[data-testid="tweetPhoto"]',
  '[data-testid="card.wrapper"]',
  '[data-testid="socialContext"]',
  '[data-testid="placementTracking"]',
  '[contenteditable="true"]',
  "button",
  "nav",
  "aside",
  "footer",
  "form",
  "textarea",
  "select",
].join(",");

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/** A "long" prose block. Short lines are lead-ins, captions and controls, and never make evidence. */
const LONG_BLOCK_CHARS = 120;
/** E3 wants a whole article's worth of text before it will call an untitled long form an article. */
const LONGFORM_BLOCKS = 4;
const LONGFORM_CHARS = 900;
/** A heading has to say something before it counts as an article title. */
const HEADING_MIN_CHARS = 12;
/** A lead or standfirst is one line. Past this it is an ordinary body paragraph and stays in the body. */
const LEAD_MAX_CHARS = 240;
const TITLE_MAX_CHARS = 300;

export interface NativeArticleExtract {
  /** The post's own status id. */
  statusId: string;
  /** Canonical x.com URL of the post that carries the article. */
  url: string;
  title: string;
  subtitle?: string;
  /** Article body prose, paragraphs in document order. The post's own text stays out of it. */
  text: string;
  truncated: boolean;
  charCount: number;
  /** Which evidence layer fired and what matched. Diagnostic only, shown nowhere. */
  evidence: string;
  /**
   * Cache identity: the status id plus a hash of the article content. The Article preset and the
   * model are already part of the article cache's own identity, so an unchanged article is never
   * billed twice while edited content is analyzed afresh.
   */
  cacheKey: string;
}

interface Block {
  kind: "heading" | "para";
  text: string;
}

/**
 * Read a native X Article out of the post's rendered DOM, or null when this post is not one.
 * pageUrl is the page the post is mounted on; the route's status id has to match the post's own.
 */
export function extractNativeArticle(article: Element, pageUrl: string, maxChars: number): NativeArticleExtract | null {
  const statusId = tweetId(article);
  if (!statusId) return null;
  const path = pagePath(pageUrl);
  // X renders an article on the post's own page. Everywhere else there is nothing here to read.
  if (routeStatusId(path) !== statusId) return null;

  const withoutPostText = collect(article, true);
  const withPostText = collect(article, false);
  // When the article prose sits outside the post's own text container, that container is the post
  // the post preset judges and it stays out of the article. Otherwise the body is that container.
  const blocks = longBlocks(withoutPostText).length >= 2 ? withoutPostText : withPostText;
  if (!blocks.length) return null;
  const evidence = evidenceFor(article, blocks);
  if (!evidence) return null;

  const titleBlock = blocks.find((b) => b.kind === "heading") ?? blocks[0]!;
  const rest = blocks.filter((b) => b !== titleBlock);
  const first = rest[0];
  const lead = titleBlock.kind === "heading" && first && first.text.length <= LEAD_MAX_CHARS ? first : undefined;
  const body = (lead ? rest.slice(1) : rest).map((b) => b.text).join("\n\n");
  const capped = capAtChars(body, maxChars);

  return {
    statusId,
    url: canonicalStatusUrl(article, path, statusId),
    title: titleBlock.kind === "heading" ? capAtChars(titleBlock.text, TITLE_MAX_CHARS).text : titleFrom(titleBlock.text),
    subtitle: lead?.text,
    text: capped.text,
    truncated: capped.truncated,
    charCount: capped.text.length,
    evidence,
    cacheKey: `x-native:${statusId}:${fnv1a(`${titleBlock.text}\n${body}`)}`,
  };
}

/**
 * Title for an article that rendered no heading: its opening sentence, so the title reads as a title
 * rather than as a truncated paragraph. The whole opening block is used when it is one sentence.
 */
function titleFrom(text: string): string {
  const sentence = /^(.{20,}?[.!?])\s/.exec(text);
  return capAtChars(sentence?.[1] ?? text, TITLE_MAX_CHARS).text;
}

/**
 * Which layer claims this is an article, named for the diagnostics, or null when none does.
 */
function evidenceFor(article: Element, blocks: Block[]): string | null {
  const container = findArticleContainer(article);
  if (container) return `container:${container}`;
  const heading = blocks.find((b) => b.kind === "heading" && b.text.length >= HEADING_MIN_CHARS);
  if (heading && longBlocks(blocks).length >= 2) return "heading+body";
  if (!hasPostText(article) && longBlocks(blocks).length >= LONGFORM_BLOCKS && charCount(blocks) >= LONGFORM_CHARS) return "longform";
  return null;
}

/** The data-testid of an article container inside this post, when X rendered one. */
function findArticleContainer(article: Element): string | null {
  for (const el of Array.from(article.querySelectorAll("[data-testid]"))) {
    const id = el.getAttribute("data-testid") ?? "";
    if (!testidWords(id).some((w) => ARTICLE_WORDS.has(w))) continue;
    if (el.closest(CHROME_SEL)) continue;
    if (longBlocks(collect(el, false)).length >= 2) return id;
  }
  return null;
}

/** Article prose blocks in document order. X's chrome and quoted posts never contribute. */
function collect(root: Element, excludePostText: boolean): Block[] {
  const exclude = excludePostText ? `${CHROME_SEL},${SEL.tweetText}` : CHROME_SEL;
  const candidates = Array.from(root.querySelectorAll(BLOCK_SEL)).filter((el) => !el.closest(exclude));
  const containers = containersOf(candidates);
  const blocks: Block[] = [];
  for (const el of candidates) {
    // A wrapper that holds real blocks contributes only its own direct text, so nothing is read twice.
    const raw = containers.has(el) ? directText(el) : readText(el);
    const heading = isHeading(el);
    for (const piece of splitParagraphs(raw, heading)) {
      blocks.push({ kind: heading ? "heading" : "para", text: piece });
    }
  }
  return blocks;
}

/** Candidate blocks that contain another candidate block, so they are wrappers rather than prose. */
function containersOf(list: Element[]): Set<Element> {
  const candidates = new Set(list);
  const containers = new Set<Element>();
  for (const el of list) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (candidates.has(p)) containers.add(p);
    }
  }
  return containers;
}

/** Text of a wrapper element's own children, skipping any child that is itself a block. */
function directText(el: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const child = node as Element;
    if (child !== el && child.matches(BLOCK_SEL)) return;
    if (child.tagName === "IMG") {
      out += child.getAttribute("alt") ?? "";
      return;
    }
    if (child.tagName === "BR") {
      out += "\n";
      return;
    }
    for (const grandchild of Array.from(child.childNodes)) walk(grandchild);
  };
  for (const child of Array.from(el.childNodes)) walk(child);
  return out.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** One block per heading; a paragraph element may carry several paragraphs separated by blank lines. */
function splitParagraphs(raw: string, heading: boolean): string[] {
  const pieces = heading ? [raw] : raw.split(/\n{2,}/);
  return pieces.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function isHeading(el: Element): boolean {
  return HEADING_TAGS.has(el.tagName) || el.getAttribute("role") === "heading";
}

function longBlocks(blocks: Block[]): Block[] {
  return blocks.filter((b) => b.kind === "para" && b.text.length >= LONG_BLOCK_CHARS);
}

function charCount(blocks: Block[]): number {
  return blocks.reduce((n, b) => n + b.text.length, 0);
}

/** True when the post carries its own text, which is what the post preset judges. */
function hasPostText(article: Element): boolean {
  for (const el of Array.from(article.querySelectorAll(SEL.tweetText))) {
    if (insideQuote(el, article)) continue;
    if (readText(el).trim()) return true;
  }
  return false;
}

/** data-testid values split into words, so twitterArticleReadView reads as twitter article read view. */
function testidWords(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/** Canonical x.com URL of the post, built from the permalink's own handle and the route's id. */
function canonicalStatusUrl(article: Element, path: string, statusId: string): string {
  const handle = handleFrom(statusHref(article), path) ?? routeHandle(path) ?? "i";
  return `https://x.com/${handle}/status/${statusId}`;
}

function handleFrom(href: string | null, pageUrl: string): string | null {
  if (!href) return null;
  const m = /^\/([A-Za-z0-9_]{1,15})\/status\/\d+/.exec(pathOf(href, pageUrl));
  return m?.[1] ?? null;
}

function pagePath(pageUrl: string): string {
  return pathOf(pageUrl, "https://x.com/");
}

function pathOf(href: string, base: string): string {
  try {
    return new URL(href, base).pathname;
  } catch {
    return href.startsWith("/") ? href : "";
  }
}

