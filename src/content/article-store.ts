import type { AnalysisResult } from "../shared/types.ts";
import { LruCache } from "./cache.ts";

const ARTICLE_CACHE_KEY = "articleCache";

interface Persisted {
  questionsHash: string;
  entries: [string, AnalysisResult][];
}

export class ArticleStore {
  private cache: LruCache<AnalysisResult>;
  private saveTimer: number | null = null;
  private questionsHash: string;

  constructor(questionsHash: string, max: number) {
    this.questionsHash = questionsHash;
    this.cache = new LruCache<AnalysisResult>(max);
  }

  get size(): number {
    return this.cache.size;
  }

  setQuestionsHash(questionsHash: string): void {
    if (this.questionsHash === questionsHash) return;
    this.questionsHash = questionsHash;
    void this.load();
  }

  setMax(max: number): void {
    this.cache.max = max;
  }

  async load(): Promise<void> {
    try {
      const got = await chrome.storage.local.get(ARTICLE_CACHE_KEY);
      const p = got[ARTICLE_CACHE_KEY] as Persisted | undefined;
      if (p && p.questionsHash === this.questionsHash && Array.isArray(p.entries)) {
        this.cache = LruCache.from(p.entries, this.cache.max);
      }
    } catch {
      /* run in memory */
    }
  }

  get(url: string): AnalysisResult | undefined {
    return this.cache.get(url);
  }

  set(url: string, result: AnalysisResult): void {
    this.cache.set(url, result);
    this.scheduleSave();
  }

  clear(): void {
    this.cache.clear();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = (globalThis.setTimeout ?? setTimeout)(() => {
      this.saveTimer = null;
      const payload: Persisted = { questionsHash: this.questionsHash, entries: this.cache.entries() };
      try {
        chrome.storage?.local?.set({ [ARTICLE_CACHE_KEY]: payload })?.catch?.(() => {});
      } catch {
        /* storage unavailable */
      }
    }, 1000) as unknown as number;
  }
}

