/** Events in a sliding window, for the judgments per second readout. */
export class RateWindow {
  private events: { at: number; n: number }[] = [];
  private windowMs: number;

  constructor(windowMs = 5000) {
    this.windowMs = windowMs;
  }

  add(n: number, at: number): void {
    this.events.push({ at, n });
    this.prune(at);
  }

  perSecond(now: number): number {
    this.prune(now);
    let sum = 0;
    for (const e of this.events) sum += e.n;
    return sum / (this.windowMs / 1000);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.events.length && this.events[0]!.at < cutoff) this.events.shift();
  }
}

/** One normalized component of a billed result, for the Signal v2 session averages. */
export interface Observation {
  id: string;
  label: string;
  /** 0..1, already normalized against the dimension's own rubric. */
  value: number;
}

/** A categorical answer from a billed result, for the Signal v2 topic distribution. */
export interface TopicObservation {
  id: string;
  label: string;
}

export interface SessionSnapshot {
  analyzed: number;
  costUsd: number;
  inputTokens: number;
  lastLatencyMs: number | null;
  judgmentsPerSec: number;
  pending: number;
  inflight: number;
  cacheHits: number;
  errors: number;
  lastError: string | null;
  flagged: number;
  articles: number;
  articleCacheHits: number;
  latencies: number[];
  dimHits: Record<string, number>;
  topPosts: { id: string; score: number; kind: "post" | "article"; title?: string }[];
  /** Signal v2 only: how many billed results landed in each topic, highest first. */
  topics: { id: string; label: string; n: number }[];
  /** Signal v2 only: the 0..100 mean of each component in dimension order. Never combined. */
  averages: { id: string; label: string; mean: number }[];
}

/** Counters for this page load. Lifetime totals live in the service worker. */
export class SessionStats {
  private analyzed = 0;
  private costUsd = 0;
  private inputTokens = 0;
  private lastLatencyMs: number | null = null;
  private pending = 0;
  private inflight = 0;
  private cacheHits = 0;
  private errors = 0;
  private lastError: string | null = null;
  private flagged = 0;
  private articles = 0;
  private articleCacheHits = 0;
  private latencies: number[] = [];
  private dimHits: Record<string, number> = {};
  private topPosts: { id: string; score: number; kind: "post" | "article"; title?: string }[] = [];
  private topicCounts = new Map<string, { label: string; n: number }>();
  private sums = new Map<string, { label: string; sum: number; n: number }>();
  private rate = new RateWindow(5000);
  private listeners = new Set<(s: SessionSnapshot) => void>();
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  recordResult(r: { costUsd: number; inputTokens: number; latencyMs: number }, judgments: number): void {
    this.analyzed += 1;
    this.costUsd += r.costUsd;
    this.inputTokens += r.inputTokens;
    this.lastLatencyMs = r.latencyMs;
    this.latencies.push(r.latencyMs);
    this.rate.add(judgments, this.now());
    this.emit();
  }

  recordAnalysis(opts: {
    costUsd: number;
    inputTokens: number;
    latencyMs: number;
    judgments: number;
    flagged: boolean;
    hits: string[];
    score: number;
    id: string;
    kind: "post" | "article";
    title?: string;
    /** Signal v2 passes its components here so the session can average them without a new call. */
    observations?: Observation[];
    topic?: TopicObservation;
  }): void {
    this.recordResult(opts, opts.judgments);
    if (opts.kind === "article") this.articles += 1;
    if (opts.flagged) this.flagged += 1;
    for (const id of opts.hits) this.dimHits[id] = (this.dimHits[id] ?? 0) + 1;
    // Averages come from billed results only, exactly like dimHits: a cache hit already counted once.
    for (const o of opts.observations ?? []) {
      const cur = this.sums.get(o.id) ?? { label: o.label, sum: 0, n: 0 };
      this.sums.set(o.id, { label: o.label, sum: cur.sum + o.value, n: cur.n + 1 });
    }
    if (opts.topic) {
      const cur = this.topicCounts.get(opts.topic.id) ?? { label: opts.topic.label, n: 0 };
      this.topicCounts.set(opts.topic.id, { label: opts.topic.label, n: cur.n + 1 });
    }
    this.topPosts.push({ id: opts.id, score: opts.score, kind: opts.kind, title: opts.title });
    this.topPosts.sort((a, b) => b.score - a.score);
    if (this.topPosts.length > 8) this.topPosts.length = 8;
  }

  recordArticleCacheHit(): void {
    this.articleCacheHits += 1;
    this.cacheHits += 1;
    this.emit();
  }

  recordCacheHit(): void {
    this.cacheHits += 1;
    this.emit();
  }

  recordError(message: string): void {
    this.errors += 1;
    this.lastError = message;
    this.emit();
  }

  setQueue(pending: number, inflight: number): void {
    this.pending = pending;
    this.inflight = inflight;
    this.emit();
  }

  snapshot(): SessionSnapshot {
    return {
      analyzed: this.analyzed,
      costUsd: this.costUsd,
      inputTokens: this.inputTokens,
      lastLatencyMs: this.lastLatencyMs,
      judgmentsPerSec: this.rate.perSecond(this.now()),
      pending: this.pending,
      inflight: this.inflight,
      cacheHits: this.cacheHits,
      errors: this.errors,
      lastError: this.lastError,
      flagged: this.flagged,
      articles: this.articles,
      articleCacheHits: this.articleCacheHits,
      latencies: this.latencies.slice(),
      dimHits: { ...this.dimHits },
      topPosts: this.topPosts.slice(),
      topics: Array.from(this.topicCounts, ([id, v]) => ({ id, label: v.label, n: v.n })).sort((a, b) => b.n - a.n),
      averages: Array.from(this.sums, ([id, v]) => ({ id, label: v.label, mean: v.n ? Math.round((v.sum / v.n) * 100) : 0 })),
    };
  }

  subscribe(cb: (s: SessionSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.snapshot());
    return () => this.listeners.delete(cb);
  }

  /** Re-emit so time based fields (rate) decay while nothing else happens. */
  tick(): void {
    this.emit();
  }

  private emit(): void {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }
}
