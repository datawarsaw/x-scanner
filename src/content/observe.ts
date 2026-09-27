import { SEL } from "./selectors.ts";

export interface WatcherOptions {
  dwellMs: number;
  /** Extend the viewport downward by this many px so posts are analyzed before they appear. */
  lookaheadPx?: number;
  /** Optional stricter "in view" rule: smallest visible fraction, or visible height in px. Default: any pixel. */
  minRatio?: number;
  minVisiblePx?: number;
  onMount(article: HTMLElement): void;
  onDwell(article: HTMLElement): void;
  onLeave(article: HTMLElement): void;
}

/**
 * Finds every tweet article X mounts (the timeline is virtualized, nodes come and go),
 * and reports the ones that stay in the viewport for at least dwellMs.
 */
export class TweetWatcher {
  private mo: MutationObserver;
  private io: IntersectionObserver;
  private timers = new Map<Element, number>();
  private seen = new WeakSet<Element>();
  private minRatio: number;
  private minVisiblePx: number;
  private opts: WatcherOptions;

  constructor(opts: WatcherOptions) {
    this.opts = opts;
    this.minRatio = opts.minRatio ?? 0;
    this.minVisiblePx = opts.minVisiblePx ?? 0;
    this.mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) this.scan(n);
        for (const n of Array.from(r.removedNodes)) this.unscan(n);
      }
    });
    this.io = new IntersectionObserver((entries) => this.onIntersect(entries), {
      threshold: [0, 0.25, 0.5, 0.75, 1],
      rootMargin: `0px 0px ${Math.max(0, opts.lookaheadPx ?? 0)}px 0px`,
    });
  }

  start(root: Node = document.body): void {
    this.scan(root);
    this.mo.observe(root, { childList: true, subtree: true });
  }

  stop(): void {
    this.mo.disconnect();
    this.io.disconnect();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  updateOptions(dwellMs: number, lookaheadPx?: number): void {
    this.opts.dwellMs = dwellMs;
    if (lookaheadPx !== undefined && this.opts.lookaheadPx !== lookaheadPx) {
      this.opts.lookaheadPx = lookaheadPx;
      this.io.disconnect();
      this.io = new IntersectionObserver((entries) => this.onIntersect(entries), {
        threshold: [0, 0.25, 0.5, 0.75, 1],
        rootMargin: `0px 0px ${Math.max(0, lookaheadPx)}px 0px`,
      });
      for (const a of Array.from(document.querySelectorAll<HTMLElement>(SEL.article))) {
        this.io.observe(a);
      }
    }
  }

  recheck(article: HTMLElement): void {
    if (!article.isConnected) return;
    this.clearTimer(article);
    const rect = article.getBoundingClientRect();
    const lookahead = Math.max(0, this.opts.lookaheadPx ?? 0);
    const inView = rect.bottom >= 0 && rect.top <= (window.innerHeight || 900) + lookahead;
    if (inView) {
      if (this.opts.dwellMs <= 0) {
        this.opts.onDwell(article);
      } else {
        const t = window.setTimeout(() => {
          this.timers.delete(article);
          if (article.isConnected) this.opts.onDwell(article);
        }, this.opts.dwellMs);
        this.timers.set(article, t);
      }
    }
  }

  private scan(node: Node): void {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.matches(SEL.article)) this.track(el as HTMLElement);
    for (const a of Array.from(el.querySelectorAll<HTMLElement>(SEL.article))) this.track(a);
  }

  private unscan(node: Node): void {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const list = el.matches(SEL.article) ? [el as HTMLElement] : Array.from(el.querySelectorAll<HTMLElement>(SEL.article));
    for (const a of list) {
      this.clearTimer(a);
      this.io.unobserve(a);
      this.opts.onLeave(a);
    }
  }

  private track(article: HTMLElement): void {
    if (this.seen.has(article)) return;
    this.seen.add(article);
    this.opts.onMount(article);
    this.io.observe(article);
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const e of entries) {
      const el = e.target as HTMLElement;
      const visible = e.isIntersecting && (e.intersectionRatio >= this.minRatio || e.intersectionRect.height >= this.minVisiblePx);
      if (visible) {
        if (this.timers.has(el)) continue;
        if (this.opts.dwellMs <= 0) {
          this.opts.onDwell(el);
          continue;
        }
        const t = window.setTimeout(() => {
          this.timers.delete(el);
          if (el.isConnected) this.opts.onDwell(el);
        }, this.opts.dwellMs);
        this.timers.set(el, t);
      } else {
        const had = this.clearTimer(el);
        this.opts.onLeave(el);
        void had;
      }
    }
  }

  private clearTimer(el: Element): boolean {
    const t = this.timers.get(el);
    if (t === undefined) return false;
    clearTimeout(t);
    this.timers.delete(el);
    return true;
  }
}
