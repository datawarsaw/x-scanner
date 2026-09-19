import type { AnalysisState, ThreadContextMode, TweetState } from "./types.ts";
import { fnv1a } from "./hash.ts";

export interface ExtractedContext {
  parent_text?: string;
  thread?: string[];
}

/** Default / quoted: same payload as v0.1. Extra fields only when the preset asks for them. */
export function buildJevState(post: TweetState, extra: ExtractedContext, mode: ThreadContextMode): TweetState | AnalysisState {
  const base: TweetState = { text: post.text, is_reply: post.is_reply };
  if (post.quoted_text) base.quoted_text = post.quoted_text;
  if (mode === "off" || mode === "quoted") return base;
  const state: AnalysisState = { ...base };
  if (mode === "parent" || mode === "thread") {
    if (extra.parent_text) state.parent_text = extra.parent_text;
  }
  if (mode === "thread" && extra.thread && extra.thread.length) {
    state.thread = extra.thread.slice(0, 2);
  }
  return state;
}

export function contextHash(state: TweetState | AnalysisState): string {
  const extra = state as AnalysisState;
  if (!extra.parent_text && !extra.thread?.length) return "";
  return fnv1a(JSON.stringify({ p: extra.parent_text ?? "", t: extra.thread ?? [] }));
}

export function postCacheKey(tweetId: string, ctx: string): string {
  return ctx ? `${tweetId}#${ctx}` : tweetId;
}

