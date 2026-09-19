// Content script entry. Wires the watcher, scheduler, cache, HUD and renderer together.
import type { AnalysisResult, AnalyzeReply, Settings, TweetState } from "../shared/types.ts";
import { loadSettings, onSettingsChange } from "../shared/settings.ts";
import { buildQuestions, questionsHash } from "../shared/questions.ts";
import { extractTweet, isReply, loggedInHandle, tweetId, articleHrefs, extractThreadContext } from "./extract.ts";
import { TweetWatcher } from "./observe.ts";
import { Scheduler } from "./queue.ts";
import { ResultStore } from "./store.ts";
import { SessionStats } from "./stats.ts";
import { Hud } from "./hud.ts";
import { ensureSlot, fillSlot, getSlot, installDetailHandler, markSlot, ensureArticleAction, fillArticleResult } from "./render.ts";
import { verdicts } from "./labels.ts";
import { ArticleStore } from "./article-store.ts";
import { renderSessionPanel } from "./session-panel.ts";
import { activeDimensions, contextModeFor, PRESET_BY_ID } from "../shared/presets.ts";
import { buildJevState, contextHash, postCacheKey } from "../shared/context.ts";
import { extractReadable } from "../shared/article.ts";
import { isHighSignal, signalScore } from "../shared/score.ts";
import type { FetchArticleReply } from "../shared/types.ts";

const SETTINGS_LINK = `<a class="xs-link">settings</a>`;

class App {
  private hud: Hud;
  private watcher: TweetWatcher | null = null;
  private scheduler: Scheduler;
  private store: ResultStore;
  private articles: ArticleStore;
  private stats = new SessionStats();
  private slots = new Map<string, HTMLElement>();
  private routeTimer: number | null = null;
  private tickTimer: number | null = null;
  private active = false;
  private stopped = false;
  private qhash: string;
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
    this.qhash = questionsHash(activeDimensions(settings), settings.model);
    this.scheduler = new Scheduler(settings.concurrency);
    this.store = new ResultStore(this.qhash, settings.cacheMax);
    this.articles = new ArticleStore(questionsHash(PRESET_BY_ID.article.dimensions, settings.model), settings.articleCacheMax);
    this.hud = new Hud(
      () => openOptions(),
      () => this.toggleSession(),
    );
    this.hud.setPreset(PRESET_BY_ID[settings.selectedPreset]?.label ?? "Default");
    this.hud.root.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("xs-link")) openOptions();
    });
  }

  async start(): Promise<void> {
    this.hud.mount();
    this.stats.subscribe((s) => this.hud.update(s));
    if (!this.settings.apiKey) {
      this.hud.message(`Add your TypeSafe API key in ${SETTINGS_LINK}`);
      return;
    }
    if (Object.keys(buildQuestions(this.settings.dimensions)).length === 0) {
      this.hud.message(`No dimensions enabled · ${SETTINGS_LINK}`);
      return;
    }
    await this.store.load();
    await this.articles.load();
    this.scheduler.onChange(() => this.stats.setQueue(this.scheduler.pending, this.scheduler.inflight));
    this.tickTimer = window.setInterval(() => this.stats.tick(), 500);
    this.routeTimer = window.setInterval(() => this.evaluateRoute(), 500);
    this.evaluateRoute();
  }

  destroy(): void {
    this.stopped = true;
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    if (this.routeTimer !== null) clearInterval(this.routeTimer);
    this.watcher?.stop();
    this.scheduler.clear();
    this.hud.destroy();
    document.querySelector(".xs-session")?.remove();
  }

  /** X is a single page app: the path and the account can change without a reload. */
  private evaluateRoute(): void {
    if (this.stopped) return;
    const reason = this.pausedReason();
    if (reason) {
      if (this.active) {
        this.watcher?.stop();
        this.scheduler.clear();
        this.active = false;
      }
      this.hud.message(reason);
      return;
    }
    if (!this.active) {
      this.hud.message(null);
      this.watcher = new TweetWatcher({
        dwellMs: this.settings.dwellMs,
        lookaheadPx: this.settings.lookaheadPx,
        onMount: (a) => this.onMount(a),
        onDwell: (a) => this.onDwell(a),
        onLeave: (a) => this.onLeave(a),
      });
      this.watcher.start(document.body);
      this.active = true;
    }
  }

  private pausedReason(): string | null {
    const s = this.settings;
    if (s.scope === "home" && location.pathname !== "/home") return "paused · home timeline only";
    if (s.accountHandle) {
      const h = loggedInHandle();
      if (!h) return "paused · can't read the logged in account";
      if (h.toLowerCase() !== s.accountHandle.toLowerCase()) return `paused · logged in as @${h}`;
    }
    return null;
  }

  private onMount(article: HTMLElement): void {
    const id = tweetId(article);
    const slot = ensureSlot(article, id);
    if (!id) return;
    this.slots.set(id, slot);
    this.attachArticles(article);
    if (this.filteredReply(article)) {
      slot.dataset.xsReply = "true";
      markSlot(slot, "filtered");
      return;
    }
    const cached = this.store.get(this.cacheKey(article, id));
    if (cached) {
      this.render(slot, cached);
      this.stats.recordCacheHit();
    }
  }

  private onDwell(article: HTMLElement): void {
    const t = extractTweet(article);
    if (!t) return;
    const slot = ensureSlot(article, t.id);
    this.slots.set(t.id, slot);
    // Diagnostic for the reply filter: what the classifier decided about this post.
    slot.dataset.xsReply = String(t.state.is_reply);
    if (!this.settings.analyzeReplies && t.state.is_reply) {
      markSlot(slot, "filtered");
      return;
    }
    if (t.promoted) {
      markSlot(slot, "skipped", "promoted, not analyzed");
      return;
    }
    if (!t.state.text) {
      markSlot(slot, "skipped", "no text to analyze");
      return;
    }
    this.attachArticles(article);
    const key = this.cacheKey(article, t.id);
    const cached = this.store.get(key);
    if (cached) {
      if (slot.dataset.state !== "done") {
        this.render(slot, cached);
        this.stats.recordCacheHit();
      }
      return;
    }
    if (this.scheduler.has(t.id)) return;
    markSlot(slot, "queued");
    this.scheduler.enqueue(t.id, () => this.analyze(t.id, t.state));
  }

  private onLeave(article: HTMLElement): void {
    const slot = getSlot(article);
    const id = slot?.dataset.tweetId;
    if (slot && id && this.scheduler.cancel(id)) markSlot(slot, "idle");
  }

  private async analyze(id: string, state: TweetState): Promise<void> {
    const slot = this.slots.get(id);
    if (slot) markSlot(slot, "inflight");
    const article = slot?.closest("article") as HTMLElement | null;
    const extra = article ? extractThreadContext(article) : {};
    const payload = buildJevState(state, extra, contextModeFor(this.settings));
    const ctx = contextHash(payload);
    const key = postCacheKey(id, ctx);
    let reply: AnalyzeReply | undefined;
    try {
      reply = (await chrome.runtime.sendMessage({ type: "analyze", state: payload })) as AnalyzeReply;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      reply = { ok: false, error: /context invalidated/i.test(msg) ? "extension reloaded, refresh the page" : msg };
    }
    if (!reply || !reply.ok) {
      const msg = reply?.error ?? "no reply from service worker";
      this.stats.recordError(msg);
      const s = this.slots.get(id);
      if (s) markSlot(s, "error", msg);
      if (reply?.status === 401) this.fatal(`Jev rejected the API key · ${SETTINGS_LINK}`);
      return;
    }
    const dims = activeDimensions(this.settings);
    const vs = verdicts(dims, reply.answers);
    const score = signalScore(this.settings.selectedPreset, dims, reply.answers);
    const result: AnalysisResult = {
      tweetId: id,
      model: reply.model,
      answers: reply.answers,
      inputTokens: reply.usage.input_tokens,
      outputTokens: reply.usage.output_tokens,
      costUsd: reply.costUsd,
      latencyMs: reply.latencyMs,
      at: Date.now(),
      questionsHash: this.qhash,
      kind: "post",
      contextHash: ctx || undefined,
      signalScore: score,
    };
    this.store.set(key, result);
    this.stats.recordAnalysis({
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      latencyMs: result.latencyMs,
      judgments: Object.keys(reply.answers).length,
      flagged: vs.some((v) => v.show),
      hits: vs.filter((v) => v.show).map((v) => v.id),
      score,
      id,
      kind: "post",
    });
    const s = this.slots.get(id);
    if (s && s.isConnected && s.dataset.tweetId === id) this.render(s, result);
  }

  private render(slot: HTMLElement, r: AnalysisResult): void {
    fillSlot(slot, verdicts(activeDimensions(this.settings), r.answers), r);
  }

  private cacheKey(article: HTMLElement, id: string): string {
    const t = extractTweet(article);
    if (!t) return id;
    const payload = buildJevState(t.state, extractThreadContext(article), contextModeFor(this.settings));
    return postCacheKey(id, contextHash(payload));
  }

  /**
   * Replies and comments are left alone unless the reader turns them on: no request, no chip, no cost.
   * Quoted posts are not replies, and an author's own thread is out of scope for this filter.
   */
  private filteredReply(article: Element): boolean {
    if (this.settings.analyzeReplies) return false;
    return isReply(article);
  }

  private attachArticles(article: HTMLElement): void {
    if (!this.settings.articleAnalysisEnabled) return;
    const urls = articleHrefs(article, location.href);
    ensureArticleAction(article, urls, (url) => void this.analyzeArticle(article, url));
  }

  private async analyzeArticle(article: HTMLElement, url: string): Promise<void> {
    const cached = this.articles.get(url);
    if (cached) {
      this.showArticle(article, cached);
      this.stats.recordArticleCacheHit();
      return;
    }
    fillArticleResult(article, "fetching…");
    const fetched = (await chrome.runtime.sendMessage({ type: "fetchArticle", url })) as FetchArticleReply;
    if (!fetched?.ok) {
      fillArticleResult(article, fetched?.needsGrant ? "article access needed · grant it in settings" : (fetched?.error ?? "fetch failed"));
      return;
    }
    const extracted = extractReadable(fetched.html, fetched.finalUrl, this.settings.maxArticleChars);
    if (!extracted.text) {
      fillArticleResult(article, "no readable text");
      return;
    }
    const reply = (await chrome.runtime.sendMessage({
      type: "analyzeArticle",
      article: { kind: "article", title: extracted.title, url: extracted.url, domain: extracted.domain, text: extracted.text, truncated: extracted.truncated },
    })) as AnalyzeReply;
    if (!reply?.ok) {
      fillArticleResult(article, reply?.error ?? "analysis failed");
      return;
    }
    const dims = PRESET_BY_ID.article.dimensions;
    const vs = verdicts(dims, reply.answers);
    const score = signalScore("article", dims, reply.answers);
    const result: AnalysisResult = {
      tweetId: extracted.url,
      model: reply.model,
      answers: reply.answers,
      inputTokens: reply.usage.input_tokens,
      outputTokens: reply.usage.output_tokens,
      costUsd: reply.costUsd,
      latencyMs: reply.latencyMs,
      at: Date.now(),
      questionsHash: questionsHash(dims, this.settings.model),
      kind: "article",
      url: extracted.url,
      title: extracted.title,
      truncated: extracted.truncated,
      signalScore: score,
    };
    this.articles.set(extracted.url, result);
    if (extracted.url !== url) this.articles.set(url, result);
    this.stats.recordAnalysis({
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      latencyMs: result.latencyMs,
      judgments: Object.keys(reply.answers).length,
      flagged: vs.some((v) => v.show),
      hits: vs.filter((v) => v.show).map((v) => v.id),
      score,
      id: extracted.url,
      kind: "article",
      title: extracted.title,
    });
    this.showArticle(article, result);
  }

  private showArticle(article: HTMLElement, r: AnalysisResult): void {
    const vs = verdicts(PRESET_BY_ID.article.dimensions, r.answers);
    const hits = vs.filter((v) => v.show).map((v) => v.label);
    const head = hits.length ? hits.slice(0, 3).join(" · ") : "clean";
    const trunc = r.truncated ? " · truncated" : "";
    fillArticleResult(article, `${head} · ${r.inputTokens} tok · $${r.costUsd.toFixed(6)}${trunc}`, r.title);
  }

  private toggleSession(): void {
    const existing = document.querySelector(".xs-session");
    if (existing) {
      existing.remove();
      return;
    }
    const panel = renderSessionPanel(this.stats.snapshot(), PRESET_BY_ID[this.settings.selectedPreset]?.label ?? "Default");
    this.hud.root.appendChild(panel);
  }

  private fatal(html: string): void {
    this.watcher?.stop();
    this.scheduler.clear();
    this.active = false;
    this.stopped = true;
    if (this.routeTimer !== null) clearInterval(this.routeTimer);
    this.hud.message(html);
  }
}

function openOptions(): void {
  chrome.runtime.sendMessage({ type: "openOptions" }).catch(() => {});
}

let app: App | null = null;

function apply(settings: Settings): void {
  app?.destroy();
  app = null;
  if (!settings.enabled) return;
  app = new App(settings);
  void app.start();
}

async function boot(): Promise<void> {
  const flag = "xScanner";
  if (document.documentElement.dataset[flag]) return;
  document.documentElement.dataset[flag] = "1";
  installDetailHandler();
  apply(await loadSettings());
  onSettingsChange(apply);
}

void boot();
