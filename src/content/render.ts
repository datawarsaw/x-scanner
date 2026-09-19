import type { AnalysisResult, Verdict } from "../shared/types.ts";
import { SEL } from "./selectors.ts";
import { formatValue } from "./labels.ts";

export const SLOT_CLASS = "xs-slot";
export type SlotState = "idle" | "queued" | "inflight" | "done" | "error" | "skipped" | "filtered";

const data = new WeakMap<HTMLElement, { vs: Verdict[]; r: AnalysisResult }>();
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

/**
 * Fill the line: a verdict first (orange flags, or a green check), then every dimension's value in
 * X's secondary gray, flagged ones repeated in orange so the eye lands on them. Then fade in.
 */
export function fillSlot(slot: HTMLElement, vs: Verdict[], r: AnalysisResult): void {
  slot.textContent = "";
  slot.dataset.state = "done";
  slot.title = "";
  data.set(slot, { vs, r });
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
      if (!already) openDetailFor(slot, d.vs, d.r);
    },
    true,
  );
}

function closeDetail(): void {
  openDetail?.remove();
  openDetail = null;
}

function openDetailFor(slot: HTMLElement, vs: Verdict[], r: AnalysisResult): void {
  const card = document.createElement("div");
  card.className = "xs-detail";
  for (const v of vs) {
    const row = document.createElement("div");
    row.className = "xs-detail-row" + (v.show ? " xs-hit" : "");
    if (v.show && v.color) row.style.setProperty("--xs-flag", v.color);
    const k = document.createElement("span");
    k.className = "xs-detail-k";
    k.textContent = v.label;
    const bar = document.createElement("span");
    bar.className = "xs-detail-bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.round((Math.max(0, Math.min(v.max, v.value)) / v.max) * 100)}%`;
    bar.appendChild(fill);
    const val = document.createElement("span");
    val.className = "xs-detail-v";
    val.textContent = formatValue(v);
    row.append(k, bar, val);
    card.appendChild(row);
  }
  const foot = document.createElement("div");
  foot.className = "xs-detail-foot";
  foot.textContent = `${r.inputTokens} tok · $${r.costUsd.toFixed(6)} · ${r.latencyMs} ms · ${r.model}`;
  card.appendChild(foot);
  slot.appendChild(card);
  openDetail = card;
}

export function ensureArticleAction(article: Element, urls: string[], onAnalyze: (url: string) => void): void {
  let row = article.querySelector<HTMLElement>(":scope .xs-article-row");
  if (!urls.length) {
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
  for (const url of urls.slice(0, 2)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "xs-article-btn";
    btn.dataset.url = url;
    btn.textContent = "Analyze article";
    btn.title = url;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onAnalyze(url);
    });
    row.appendChild(btn);
  }
}

export function fillArticleResult(article: Element, summary: string, title?: string): void {
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
  k.textContent = "ARTICLE";
  const v = document.createElement("div");
  v.className = "xs-article-v";
  v.textContent = summary;
  card.append(k, v);
  if (title) card.title = title;
}
