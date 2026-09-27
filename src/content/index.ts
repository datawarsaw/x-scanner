// Content script entry. Wires the watcher, scheduler, cache, HUD and renderer together.
import type { AnalysisResult, AnalyzeReply, ArticleState, Settings, TweetState, Verdict } from "../shared/types.ts";
import { loadSettings, onSettingsChange } from "../shared/settings.ts";
import { questionsHash } from "../shared/questions.ts";
import { extractTweet, isReply, loggedInHandle, tweetId, articleHrefs, extractThreadContext } from "./extract.ts";
import { routeStatusId, shouldAnalyzePost } from "./route.ts";
import { TweetWatcher } from "./observe.ts";
import { Scheduler } from "./queue.ts";
import { ResultStore } from "./store.ts";
import { SessionStats, type Observation, type TopicObservation } from "./stats.ts";
import { Hud } from "./hud.ts";
import { ensureSlot, fillSlot, getSlot, installDetailHandler, markSlot, clearSlot, closeDetail, ensureArticleAction, fillArticleResult, type ArticleAction, type DisplayMode } from "./render.ts";
import { scoreRatio, verdicts } from "./labels.ts";
import { ArticleStore } from "./article-store.ts";
import { renderSessionPanel } from "./session-panel.ts";
import { activeDimensions, activeQuestions, contextModeFor, PRESET_BY_ID } from "../shared/presets.ts";
import { buildJevState, contextHash, postCacheKey } from "../shared/context.ts";
import { extractReadable, hostOf } from "../shared/article.ts";
import { isHighSignal, signalScore } from "../shared/score.ts";
import type { FetchArticleReply } from "../shared/types.ts";
import { extractNativeArticle, type NativeArticleExtract } from "./x-article.ts";

const SETTINGS_LINK = `<a class="xs-link">settings</a>`;

class App {
  private hud: Hud;
  private watcher: TweetWatcher | null = null;
  private scheduler: Scheduler;
  private store: ResultStore;
  private articles: ArticleStore;
  private stats = new SessionStats();
  private slots = new Map<string, HTMLElement>();
  private nativeCaught = new WeakMap<HTMLElement, NativeArticleExtract>();
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
    // The guard reads the active schema, exactly like the request the analysis path will send. A
    // preset with its own dimensions is enabled even when every editable legacy dimension is off.
    if (Object.keys(activeQuestions(this.settings)).length === 0) {
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
    for (const slot of this.slots.values()) {
      clearSlot(slot);
    }
    this.slots.clear();
  }

  /**
   * Live settings refresh: recompute active preset/schema, update cache namespaces,
   * refresh HUD identity, and update rendered slot presentation without page reload.
   */
  updateSettings(next: Settings): void {
    if (this.stopped) return;

    const prevSettings = this.settings;
    const prevQhash = this.qhash;

    this.settings = next;
    this.qhash = questionsHash(activeDimensions(next), next.model);

    // 1. Update cache namespaces and capacities
    this.store.setQuestionsHash(this.qhash);
    this.store.setMax(next.cacheMax);
    this.articles.setQuestionsHash(questionsHash(PRESET_BY_ID.article.dimensions, next.model));
    this.articles.setMax(next.articleCacheMax);

    // 2. Scheduler concurrency
    if (next.concurrency !== prevSettings.concurrency) {
      this.scheduler.setConcurrency(next.concurrency);
    }

    // 3. Watcher options
    this.watcher?.updateOptions(next.dwellMs, next.lookaheadPx);

    // 4. HUD identity
    const presetLabel = PRESET_BY_ID[next.selectedPreset]?.label ?? "Default";
    this.hud.setPreset(presetLabel);

    // 5. Active dimensions and API key guards
    if (!next.apiKey) {
      this.hud.message(`Add your TypeSafe API key in ${SETTINGS_LINK}`);
      return;
    }
    if (Object.keys(activeQuestions(next)).length === 0) {
      this.hud.message(`No dimensions enabled · ${SETTINGS_LINK}`);
      return;
    }
    this.hud.message(null);

    // 6. Existing DOM / rendered posts
    closeDetail();
    if (prevQhash !== this.qhash) {
      const renderedSlots = Array.from(document.querySelectorAll<HTMLElement>(".xs-slot"));
      for (const slot of renderedSlots) {
        const id = slot.dataset.tweetId;
        if (!id) continue;
        this.slots.set(id, slot);
        const article = slot.closest("article") as HTMLElement | null;
        if (!article) continue;
        const key = article ? this.cacheKey(article, id) : id;
        const cached = this.store.get(key);
        if (cached) {
          this.render(slot, cached);
        } else {
          clearSlot(slot);
          if (this.watcher && !this.pausedReason()) {
            this.watcher.recheck(article);
          }
        }
      }
    } else if (prevSettings.analyzeReplies !== next.analyzeReplies) {
      for (const [id, slot] of this.slots.entries()) {
        if (!slot.isConnected) continue;
        const article = slot.closest("article") as HTMLElement | null;
        if (!article) continue;
        const filtered = !this.filterInto(slot, id, isReply(article));
        if (!filtered && slot.dataset.state === "filtered") {
          clearSlot(slot);
          if (this.watcher && !this.pausedReason()) {
            this.watcher.recheck(article);
          }
        }
      }
    }

    // 7. Route and scope evaluation
    this.evaluateRoute();
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
    if (!this.filterInto(slot, id, isReply(article))) return;
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
    // Attach before the post filters, so a native X Article keeps its manual action even when the
    // post itself is filtered, promoted, or has no text of its own to judge.
    this.attachArticles(article);
    if (!this.filterInto(slot, t.id, t.state.is_reply)) return;
    if (t.promoted) {
      markSlot(slot, "skipped", "promoted, not analyzed");
      return;
    }
    if (!t.state.text) {
      markSlot(slot, "skipped", "no text to analyze");
      return;
    }
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
      observations: this.displayMode() === "normalized" ? observationsOf(vs) : undefined,
      topic: this.displayMode() === "normalized" ? topicOf(vs) : undefined,
    });
    const s = this.slots.get(id);
    if (s && s.isConnected && s.dataset.tweetId === id) this.render(s, result);
  }

  /** Signal v2 opts into the shared 0..100 row. Every other preset keeps its original formatting. */
  private displayMode(): DisplayMode {
    return this.settings.selectedPreset === "signal_v2" ? "normalized" : "raw";
  }

  private render(slot: HTMLElement, r: AnalysisResult): void {
    fillSlot(slot, verdicts(activeDimensions(this.settings), r.answers), r, this.displayMode());
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
   *
   * On an individual status page the route decides instead, so the filter takes the article's own id.
   * Returns true when the article is a post for normal judging, and writes the diagnostics either
   * way: data-xs-reply always, data-xs-filter-reason only on a filtered article.
   */
  private filterInto(slot: HTMLElement, id: string, reply: boolean): boolean {
    slot.dataset.xsReply = String(reply);
    const decision = shouldAnalyzePost({
      id,
      routeId: routeStatusId(location.pathname),
      analyzeReplies: this.settings.analyzeReplies,
      isReply: reply,
    });
    if (decision.analyze) {
      delete slot.dataset.xsFilterReason;
      return true;
    }
    slot.dataset.xsFilterReason = decision.reason;
    markSlot(slot, "filtered");
    return false;
  }

  private attachArticles(article: HTMLElement): void {
    if (!this.settings.articleAnalysisEnabled) return;
    const actions: ArticleAction[] = [];
    const native = this.nativeArticle(article);
    if (native) actions.push({ kind: "x-native", key: native.cacheKey, url: native.url });
    for (const url of articleHrefs(article, location.href).slice(0, 2)) {
      actions.push({ kind: "external", key: url, url });
    }
    ensureArticleAction(article, actions, (action) => void this.runArticle(article, action));
  }

  /**
   * The native X Article on this post, or null. A positive is memoized per element so repeated
   * mounts cost nothing; a negative is re-checked, because X hydrates a post after mounting it.
   * Either way the slot carries the answer, which is what the page console reads.
   */
  private nativeArticle(article: HTMLElement): NativeArticleExtract | null {
    const known = this.nativeCaught.get(article);
    if (known) return known;
    const found = extractNativeArticle(article, location.href, this.settings.maxArticleChars);
    if (found) this.nativeCaught.set(article, found);
    const slot = getSlot(article);
    if (slot) {
      if (found) {
        slot.dataset.xsNativeArticle = "true";
        slot.dataset.xsNativeArticleEvidence = found.evidence;
      } else {
        delete slot.dataset.xsNativeArticle;
        delete slot.dataset.xsNativeArticleEvidence;
      }
    }
    return found;
  }

  private async runArticle(article: HTMLElement, action: ArticleAction): Promise<void> {
    if (action.kind === "x-native") {
      await this.analyzeNativeArticle(article);
      return;
    }
    await this.analyzeExternalArticle(article, action.key);
  }

  private async analyzeExternalArticle(article: HTMLElement, url: string): Promise<void> {
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
    const result = await this.submitArticle(article, extracted.url, {
      kind: "article",
      source: { type: "external", url: extracted.url },
      title: extracted.title,
      url: extracted.url,
      domain: extracted.domain,
      text: extracted.text,
      truncated: extracted.truncated,
    });
    // The address the reader actually followed stays mapped to the same result, so a re-click is free.
    if (result && extracted.url !== url) this.articles.set(url, result);
  }

  /** A native X Article is read from this page's DOM: no fetch, no host permission, no X API. */
  private async analyzeNativeArticle(article: HTMLElement): Promise<void> {
    const native = this.nativeArticle(article);
    if (!native) {
      fillArticleResult(article, "no article text");
      return;
    }
    const cached = this.articles.get(native.cacheKey);
    if (cached) {
      this.showArticle(article, cached);
      this.stats.recordArticleCacheHit();
      return;
    }
    fillArticleResult(article, "reading article…");
    await this.submitArticle(article, native.cacheKey, {
      kind: "article",
      source: { type: "x-native", statusId: native.statusId, url: native.url },
      title: native.title,
      subtitle: native.subtitle,
      url: native.url,
      domain: hostOf(native.url),
      text: native.text,
      truncated: native.truncated,
    });
  }

  /** The one place an article is billed, cached, counted and rendered, for both article kinds. */
  private async submitArticle(article: HTMLElement, cacheKey: string, state: ArticleState): Promise<AnalysisResult | null> {
    const reply = (await chrome.runtime.sendMessage({
      type: "analyzeArticle",
      article: state,
    })) as AnalyzeReply;
    if (!reply?.ok) {
      fillArticleResult(article, reply?.error ?? "analysis failed");
      return null;
    }
    const dims = PRESET_BY_ID.article.dimensions;
    const vs = verdicts(dims, reply.answers);
    const score = signalScore("article", dims, reply.answers);
    const result: AnalysisResult = {
      tweetId: cacheKey,
      model: reply.model,
      answers: reply.answers,
      inputTokens: reply.usage.input_tokens,
      outputTokens: reply.usage.output_tokens,
      costUsd: reply.costUsd,
      latencyMs: reply.latencyMs,
      at: Date.now(),
      questionsHash: questionsHash(dims, this.settings.model),
      kind: "article",
      source: state.source,
      url: state.url,
      title: state.title,
      truncated: state.truncated,
      signalScore: score,
    };
    this.articles.set(cacheKey, result);
    this.stats.recordAnalysis({
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      latencyMs: result.latencyMs,
      judgments: Object.keys(reply.answers).length,
      flagged: vs.some((v) => v.show),
      hits: vs.filter((v) => v.show).map((v) => v.id),
      score,
      id: cacheKey,
      kind: "article",
      title: state.title,
    });
    this.showArticle(article, result);
    return result;
  }

  private showArticle(article: HTMLElement, r: AnalysisResult): void {
    const vs = verdicts(PRESET_BY_ID.article.dimensions, r.answers);
    const hits = vs.filter((v) => v.show).map((v) => v.label);
    const head = hits.length ? hits.slice(0, 3).join(" · ") : "clean";
    const trunc = r.truncated ? " · truncated" : "";
    // A native X Article and a linked one can sit under the same post, so the card names its source.
    const label = r.source?.type === "x-native" ? "X ARTICLE" : "ARTICLE";
    fillArticleResult(article, `${head} · ${r.inputTokens} tok · $${r.costUsd.toFixed(6)}${trunc}`, r.title, label);
  }

  private toggleSession(): void {
    const existing = document.querySelector(".xs-session");
    if (existing) {
      existing.remove();
      return;
    }
    const panel = renderSessionPanel(this.stats.snapshot(), PRESET_BY_ID[this.settings.selectedPreset]?.label ?? "Default", this.settings.selectedPreset);
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

/** The non-categorical components as 0..1 means, for the Signal v2 session averages. */
function observationsOf(vs: Verdict[]): Observation[] {
  return vs.filter((v) => v.type !== "choice").map((v) => ({ id: v.id, label: v.label, value: scoreRatio(v) }));
}

/** The selected topic, when the preset asks a categorical question. */
function topicOf(vs: Verdict[]): TopicObservation | undefined {
  const topic = vs.find((v) => v.type === "choice");
  return topic?.choice ? { id: topic.choice.id, label: topic.choice.label } : undefined;
}
function openOptions(): void {
  chrome.runtime.sendMessage({ type: "openOptions" }).catch(() => {});
}

let app: App | null = null;

function apply(settings: Settings): void {
  if (!app) {
    if (!settings.enabled) return;
    app = new App(settings);
    void app.start();
    return;
  }
  if (!settings.enabled) {
    app.destroy();
    app = null;
    return;
  }
  app.updateSettings(settings);
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
