import type { AnalysisResult, Verdict } from "../shared/types.ts";
import { SEL } from "./selectors.ts";
import { formatValue, normalized, rawDetail } from "./labels.ts";

export const SLOT_CLASS = "xs-slot";
export type SlotState = "idle" | "queued" | "inflight" | "done" | "error" | "skipped" | "filtered";

/**
 * "raw" is the original per-preset formatting. "normalized" is the shared 0..100 view that Signal v2
 * opts into, where a score is scaled by its rubric maximum and a noul is already a probability.
 */
export type DisplayMode = "raw" | "normalized";

const data = new WeakMap<HTMLElement, { vs: Verdict[]; r: AnalysisResult; mode: DisplayMode }>();
let openDetail: HTMLElement | null = null;

/**
 * Put the verdict line right under the post's text (after X's own "Show more" link when there is
 * one), styled like X's metadata lines. A post without text gets it above the action bar. Idempotent.
 */
export function ensureSlot(article: Element, tweetId: string | null): HTMLElement {
  let slot = article.querySelector<HTMLElement>(`:scope .${SLOT_CLASS}`);
  if (!slot) {
    slot = document.createElement("div");
    slot.className = SLOT_CLASS;
    slot.dataset.state = "idle";
    const text = mainText(article);
    if (text?.parentElement) {
      const next = text.nextElementSibling;
      const anchor = next && next.matches(SEL.showMore) ? next : text;
      anchor.parentElement!.insertBefore(slot, anchor.nextSibling);
    } else {
      const bar = article.querySelector(SEL.actionBar);
      if (bar?.parentElement) bar.parentElement.insertBefore(slot, bar);
      else article.appendChild(slot);
    }
  }
  if (tweetId) slot.dataset.tweetId = tweetId;
  return slot;
}

/** The outer post's text block, skipping the one inside a quoted post. */
function mainText(article: Element): HTMLElement | null {
  for (const t of Array.from(article.querySelectorAll<HTMLElement>(SEL.tweetText))) {
    const q = t.closest(SEL.quoteContainer);
    if (q && article.contains(q) && q !== article) continue;
    return t;
  }
  return null;
}

export function getSlot(article: Element): HTMLElement | null {
  return article.querySelector<HTMLElement>(`:scope .${SLOT_CLASS}`);
}

export function markSlot(slot: HTMLElement, state: SlotState, title?: string): void {
  slot.dataset.state = state;
  if (title !== undefined) slot.title = title;
  if (state === "error" || state === "skipped") {
    slot.dataset.verdict = "note";
    slot.textContent = "";
    const note = document.createElement("span");
    note.className = "xs-note";
    note.textContent = state === "error" ? "analysis failed" : (title ?? "skipped");
    slot.appendChild(note);
    slot.classList.add("xs-in");
  }
}

export function clearSlot(slot: HTMLElement): void {
  slot.textContent = "";
  slot.dataset.state = "idle";
  delete slot.dataset.verdict;
  delete slot.dataset.display;
  slot.title = "";
  slot.style.removeProperty("--xs-flag");
  slot.classList.remove("xs-in");
  data.delete(slot);
}

/**
 * Fill the line: a verdict first (orange flags, or a green check), then every dimension's value in
 * X's secondary gray, flagged ones repeated in orange so the eye lands on them. Then fade in.
 */
export function fillSlot(slot: HTMLElement, vs: Verdict[], r: AnalysisResult, mode: DisplayMode = "raw"): void {
  if (mode === "normalized") {
    fillCompact(slot, vs, r);
    return;
  }
  slot.dataset.display = "raw";
  slot.textContent = "";
  slot.dataset.state = "done";
  slot.title = "";
  data.set(slot, { vs, r, mode });
  const hits = vs.filter((v) => v.show);
  const rest = vs.filter((v) => !v.show);
  slot.dataset.verdict = hits.length ? "flag" : "clean";
  const tint = hits.find((v) => v.color)?.color;
  if (tint) slot.style.setProperty("--xs-flag", tint);
  else slot.style.removeProperty("--xs-flag");
  const parts: HTMLElement[] = [];
  if (hits.length === 0) {
    const ok = document.createElement("span");
    ok.className = "xs-ok";
    ok.textContent = "✓ clean";
    parts.push(ok);
  }
  for (const v of hits) {
    const flag = document.createElement("span");
    flag.className = "xs-flag";
    flag.dataset.dim = v.id;
    if (v.color) flag.style.color = v.color;
    flag.textContent = `${hits.indexOf(v) === 0 ? "⚑ " : ""}${v.label} ${formatValue(v)}`;
    parts.push(flag);
  }
  for (const v of rest) {
    const dim = document.createElement("span");
    dim.className = "xs-dim";
    dim.dataset.dim = v.id;
    dim.textContent = `${v.label} ${formatValue(v)}`;
    parts.push(dim);
  }
  parts.forEach((el, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "xs-sep";
      sep.textContent = "·";
      slot.appendChild(sep);
    }
    slot.appendChild(el);
  });
  slot.classList.remove("xs-in");
  requestAnimationFrame(() => slot.classList.add("xs-in"));
}

/**
 * The Signal v2 row: what the post is about, then the four signal components, then the two filters,
 * kept in dimension order so the row reads the same way every time. Values carry no unit on purpose:
 * a rubric level and a probability share this range without meaning the same thing. The detail card
 * is where the raw semantics live. The flag marker still marks whatever crossed a threshold, which
 * in Signal v2 is normally only the two filters.
 */
function fillCompact(slot: HTMLElement, vs: Verdict[], r: AnalysisResult): void {
  slot.textContent = "";
  slot.dataset.state = "done";
  slot.title = "";
  slot.dataset.display = "normalized";
  data.set(slot, { vs, r, mode: "normalized" });
  const hits = vs.filter((v) => v.show);
  slot.dataset.verdict = hits.length ? "flag" : "clean";
  const tint = hits.find((v) => v.color)?.color;
  if (tint) slot.style.setProperty("--xs-flag", tint);
  else slot.style.removeProperty("--xs-flag");
  const parts: HTMLElement[] = [];
  if (hits.length === 0) parts.push(span("xs-ok", "✓ clean"));
  for (const v of vs) {
    if (v.type === "choice") {
      if (v.choice) parts.push(span("xs-topic", v.choice.label));
      continue;
    }
    const el = span(v.show ? "xs-flag" : "xs-dim", (v.show && v === hits[0] ? "⚑ " : "") + v.short + " " + normalized(v));
    el.dataset.dim = v.id;
    if (v.show && v.color) el.style.color = v.color;
    parts.push(el);
  }
  parts.forEach((el, i) => {
    if (i > 0) slot.appendChild(span("xs-sep", "·"));
    slot.appendChild(el);
  });
  slot.classList.remove("xs-in");
  requestAnimationFrame(() => slot.classList.add("xs-in"));
}

function span(cls: string, text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = cls;
  el.textContent = text;
  return el;
}

/** One document level listener: click a slot to toggle its detail card, click anywhere else to close. */
export function installDetailHandler(): void {
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".xs-detail")) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      const slot = target.closest<HTMLElement>(`.${SLOT_CLASS}`);
      if (!slot) {
        closeDetail();
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      const d = data.get(slot);
      if (!d) return;
      const already = slot.querySelector(".xs-detail");
      closeDetail();
      if (!already) openDetailFor(slot, d.vs, d.r, d.mode);
    },
    true,
  );
}

export function closeDetail(): void {
  openDetail?.remove();
  openDetail = null;
}

function openDetailFor(slot: HTMLElement, vs: Verdict[], r: AnalysisResult, mode: DisplayMode): void {
  const card = document.createElement("div");
  card.className = "xs-detail";
  card.dataset.display = mode;
  for (const v of vs) {
    if (v.type === "choice") {
      card.appendChild(choiceRow(v));
      continue;
    }
    const row = document.createElement("div");
    row.className = "xs-detail-row" + (v.show ? " xs-hit" : "");
    if (v.show && v.color) row.style.setProperty("--xs-flag", v.color);
    const k = document.createElement("span");
    k.className = "xs-detail-k";
    k.textContent = v.label;
    const bar = document.createElement("span");
    bar.className = "xs-detail-bar";
    const fill = document.createElement("i");
    // The bar is the same 0..100 mapping in both display modes, so the raw presets and Signal v2
    // cannot drift apart; only the number beside it and the raw line below it differ by mode.
    const width = normalized(v);
    fill.style.width = width + "%";
    bar.appendChild(fill);
    const val = document.createElement("span");
    val.className = "xs-detail-v";
    val.textContent = mode === "normalized" ? normalized(v) + " / 100" : formatValue(v);
    row.append(k, bar, val);
    card.appendChild(row);
    // One range, two meanings: the normalized number stays directly above its raw semantics.
    if (mode === "normalized") card.appendChild(span("xs-detail-raw", rawDetail(v)));
  }
  const foot = document.createElement("div");
  foot.className = "xs-detail-foot";
  foot.textContent = `${r.inputTokens} tok · $${r.costUsd.toFixed(6)} · ${r.latencyMs} ms · ${r.model}`;
  card.appendChild(foot);
  slot.appendChild(card);
  openDetail = card;
}

/** A categorical row: the chosen label, then the candidate distribution when Jev returned one. */
function choiceRow(v: Verdict): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "xs-detail-choice";
  const row = document.createElement("div");
  row.className = "xs-detail-choice-row";
  row.append(span("xs-detail-k", v.label), span("xs-detail-choice-v", v.choice?.label ?? ""));
  wrap.appendChild(row);
  for (const c of v.choice?.candidates ?? []) {
    wrap.appendChild(span("xs-detail-cand", c.label + " " + Math.round(c.p * 100) + "%"));
  }
  return wrap;
}

/** One manual article action. Nothing is fetched or billed until the reader clicks one of these. */
export interface ArticleAction {
  /** "x-native" is the long-form article X itself rendered on this page; "external" is a linked page. */
  kind: "external" | "x-native";
  /** Identity handed back on click: the URL for external, the native cache key for x-native. */
  key: string;
  /** Tooltip, and the data-url the tests and the page console read. */
  url: string;
}

const ARTICLE_LABEL: Record<ArticleAction["kind"], string> = {
  external: "Analyze article",
  "x-native": "Analyze X article",
};

/**
 * Render the manual article actions under one post. Idempotent: the row is rebuilt from the actions
 * the caller passes, and removed when there are none.
 */
export function ensureArticleAction(article: Element, actions: ArticleAction[], onAnalyze: (action: ArticleAction) => void): void {
  let row = article.querySelector<HTMLElement>(":scope .xs-article-row");
  if (!actions.length) {
    row?.remove();
    return;
  }
  if (!row) {
    row = document.createElement("div");
    row.className = "xs-article-row";
    const slot = getSlot(article);
    if (slot?.parentElement) slot.parentElement.insertBefore(row, slot.nextSibling);
    else article.appendChild(row);
  }
  row.textContent = "";
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = action.kind === "x-native" ? "xs-article-btn xs-article-native" : "xs-article-btn";
    btn.dataset.key = action.key;
    btn.dataset.url = action.url;
    if (action.kind === "x-native") btn.dataset.xsNative = "true";
    btn.textContent = ARTICLE_LABEL[action.kind];
    btn.title = action.url;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onAnalyze(action);
    });
    row.appendChild(btn);
  }
}

export function fillArticleResult(article: Element, summary: string, title?: string, label = "ARTICLE"): void {
  let card = article.querySelector<HTMLElement>(":scope .xs-article-card");
  if (!card) {
    card = document.createElement("div");
    card.className = "xs-article-card";
    const row = article.querySelector(":scope .xs-article-row");
    if (row?.parentElement) row.parentElement.insertBefore(card, row.nextSibling);
    else article.appendChild(card);
  }
  card.textContent = "";
  const k = document.createElement("div");
  k.className = "xs-article-k";
  k.textContent = label;
  const v = document.createElement("div");
  v.className = "xs-article-v";
  v.textContent = summary;
  card.append(k, v);
  if (title) card.title = title;
}
