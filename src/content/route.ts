/**
 * Route-aware post filtering. One place decides whether a mounted tweet article is a normal post for
 * scoring, because on an individual status page that answer comes from the URL rather than from the
 * article's own markup.
 *
 * X does not always render a Reply-to row for direct comments under a focal post, so a text-based
 * reply classifier alone misses them on /<handle>/status/<id> pages. On that one surface the route's
 * own status id is the reliable signal, and the policy is deliberately focal-post-only: with replies
 * off we analyze the post whose id is in the URL and skip the other top-level articles on the
 * conversation page, which is what main-posts-only means to the reader.
 */

/**
 * Status id of an individual status route, for example 8302 for /dave/status/8302. Null on every
 * other X surface (home, profiles, search, lists, settings) so those keep the markup-based rules.
 */
export function routeStatusId(pathname: string): string | null {
  const m = /^\/[^/]+\/status\/(\d+)(?:\/|$)/.exec(pathname);
  return m?.[1] ?? null;
}

export interface PostFilterInput {
  /** The article's own status id, from the shared tweet-id extraction. */
  id: string;
  /** Status id of the current route, or null off an individual status page. */
  routeId: string | null;
  /** The Analyze replies/comments setting. On, every filter decision becomes analyze. */
  analyzeReplies: boolean;
  /** The existing markup classifier, which trusts the Replying-to row. */
  isReply: boolean;
}

export type PostFilterReason = "reply" | "status-page-non-root";

export type PostFilter = { analyze: true } | { analyze: false; reason: PostFilterReason };

export function shouldAnalyzePost(input: PostFilterInput): PostFilter {
  if (input.analyzeReplies) return { analyze: true };
  if (input.routeId !== null) {
    return input.id === input.routeId ? { analyze: true } : { analyze: false, reason: "status-page-non-root" };
  }
  return input.isReply ? { analyze: false, reason: "reply" } : { analyze: true };
}
