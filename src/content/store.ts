import type { AnalysisResult } from "../shared/types.ts";
import { LruCache } from "./cache.ts";

const CACHE_KEY = "cache";

interface Persisted {
  /** 2 keeps every schema's entries side by side. Absent or 1 held a single schema; read migrates it. */
  version?: number;
  questionsHash: string;
  entries: [string, AnalysisResult][];
}

/**
 * Results keyed by question schema and tweet id, persisted to extension storage so scrolling back,
 * reloading, or reopening X never re-bills a post. Every schema keeps its own entries, so switching
 * preset asks its own questions and reads only its own answers, and switching back is free.
 */
export class ResultStore {
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

  /** Schema-qualified: no preset can ever read another preset's answer for the same post. */
  private key(id: string): string {
    return this.questionsHash + "|" + id;
  }

  async load(): Promise<void> {
    try {
      const got = await chrome.storage.local.get(CACHE_KEY);
      const p = got[CACHE_KEY] as Persisted | undefined;
      if (!p || !Array.isArray(p.entries)) return;
      if (p.version === 2) {
        this.cache = LruCache.from(p.entries, this.cache.max);
        return;
      }
      // A v0.5 payload held one schema, and its own hash says which: qualify its entries with it so
      // results cached before the upgrade still serve, without claiming any other schema's answers.
      const migrated = p.entries.map(([id, r]) => [p.questionsHash + "|" + id, r] as [string, AnalysisResult]);
      this.cache = LruCache.from(migrated, this.cache.max);
    } catch {
      /* storage unavailable, run in memory */
    }
  }

  has(id: string): boolean {
    return this.cache.has(this.key(id));
  }

  get(id: string): AnalysisResult | undefined {
    return this.cache.get(this.key(id));
  }

  set(id: string, result: AnalysisResult): void {
    this.cache.set(this.key(id), result);
    this.scheduleSave();
  }

  clear(): void {
    this.cache.clear();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      const payload: Persisted = { version: 2, questionsHash: this.questionsHash, entries: this.cache.entries() };
      chrome.storage.local.set({ [CACHE_KEY]: payload }).catch(() => {});
    }, 1000);
  }
}
