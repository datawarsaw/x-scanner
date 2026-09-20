export type QuestionType = "score" | "noul";

/** One analysis dimension. Becomes one typed Jev question and, when it crosses its threshold, one pill. */
export interface Dimension {
  /** Stable key, also the question id sent to Jev (ids are never seen by the model). */
  id: string;
  /** Pill text. */
  label: string;
  type: QuestionType;
  instructions: string;
  /** Score only: ordered level descriptions, lowest first. 2 to 10 entries. */
  levels?: string[];
  /** Noul only: what a yes and a no mean. */
  criteria?: { true: string; false: string };
  /** Noul: 0..1 probability. Score: 0..levels.length-1, may be fractional. */
  threshold: number;
  /** Show the pill when the value is above (>=) or below (<=) the threshold. */
  direction: "above" | "below";
  enabled: boolean;
  /** Flag color as #rrggbb. Unset means the default orange. */
  color?: string;
}

export interface Settings {
  enabled: boolean;
  apiKey: string;
  model: string;
  baseUrl: string;
  /** USD per million input tokens. Output tokens are free on Jev. */
  pricePerMtok: number;
  /** "all": every timeline, profile, search, thread (default). "home": only x.com/home. */
  scope: "home" | "all";
  /** If set, only run when the logged in account matches this handle (without @). */
  accountHandle: string;
  /**
   * When false (default), posts detected as replies/comments are not analyzed at all: no request, no
   * chip, no cost, no counter. Quoted posts are not replies, so they are unaffected. Author threads
   * are out of scope for this filter.
   */
  analyzeReplies: boolean;
  /** How long a post must stay in view before it is sent. 0 sends as soon as it appears. */
  dwellMs: number;
  /** Also analyze posts this many px below the viewport, so verdicts are ready before you reach them. */
  lookaheadPx: number;
  concurrency: number;
  cacheMax: number;
  dimensions: Dimension[];
  /** Built-in analysis profile. Default uses `dimensions` (the v0.1 questions, user-editable). */
  selectedPreset: PresetId;
  /** When false, the Analyze article action is hidden. */
  articleAnalysisEnabled: boolean;
  /** How much extra DOM thread context to attach. Default is quoted-only (v0.1). */
  threadContextMode: ThreadContextMode;
  /** Hard cap on article body characters sent to Jev. */
  maxArticleChars: number;
  articleCacheMax: number;
  /** Bumped when a default changes in a way stored settings should follow. */
  version: number;
}

export type PresetId = "default" | "signal" | "ai_tech" | "article";
export type ThreadContextMode = "off" | "quoted" | "parent" | "thread";

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  /** Built-in questions. Ignored for Default, which uses Settings.dimensions. */
  dimensions: Dimension[];
  contentType: "post" | "article";
  context: ThreadContextMode;
  version: number;
}

/** What we send to Jev as `state`. No author identity, on purpose. */
export interface TweetState {
  text: string;
  quoted_text?: string;
  is_reply: boolean;
}

/** Versioned analysis payload. Default post analysis still sends TweetState fields only. */
export interface AnalysisState extends TweetState {
  parent_text?: string;
  thread?: string[];
}

/** Where an analyzed article's text came from. Never inferred later: it is carried explicitly. */
export type ArticleSource =
  /** A page fetched from the publisher after the reader pressed Analyze article. */
  | { type: "external"; url: string }
  /** Long-form content X rendered itself on the post's own page, read from the DOM.
   *  No fetch, no host permission, no X API. */
  | { type: "x-native"; statusId: string; url: string };

export interface ArticleState {
  kind: "article";
  /** Explicit provenance, so the two article kinds can never be confused downstream. */
  source: ArticleSource;
  title: string;
  /** Lead or standfirst line, when the source renders one. */
  subtitle?: string;
  url: string;
  domain: string;
  text: string;
  truncated: boolean;
}

export interface ArticleExtract {
  title: string;
  url: string;
  domain: string;
  siteName?: string;
  text: string;
  truncated: boolean;
  charCount: number;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export type Answer = NoulAnswer | ScoreAnswer | ChoiceAnswer;

export interface JevQuestion {
  type: QuestionType;
  instructions: string;
  criteria?: string[] | { true: string; false: string };
}

export interface JevRequest {
  model: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
}

export interface JevResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

/** One completed analysis, as cached and as rendered. */
export interface AnalysisResult {
  tweetId: string;
  model: string;
  answers: Record<string, Answer>;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  at: number;
  questionsHash: string;
  kind?: "post" | "article";
  /** For articles: which of the two sources this result came from. Kept in the cache with it. */
  source?: ArticleSource;
  url?: string;
  title?: string;
  truncated?: boolean;
  contextHash?: string;
  signalScore?: number;
}

export interface Verdict {
  id: string;
  label: string;
  type: QuestionType;
  value: number;
  max: number;
  threshold: number;
  direction: "above" | "below";
  show: boolean;
  color?: string;
}

/** Messages between the content script and the service worker. */
export type Message =
  | { type: "analyze"; state: TweetState | AnalysisState }
  | { type: "analyzeArticle"; article: ArticleState }
  | { type: "fetchArticle"; url: string }
  | { type: "testConnection" }
  | { type: "openOptions" };

export type FetchArticleReply =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; error: string; status?: number; needsGrant?: boolean };

export type AnalyzeArticleMessage = { type: "analyzeArticle"; article: ArticleState };
export type FetchArticleMessage = { type: "fetchArticle"; url: string };

export type AnalyzeReply =
  | { ok: true; model: string; answers: Record<string, Answer>; usage: JevResponse["usage"]; latencyMs: number; costUsd: number }
  | { ok: false; error: string; status?: number };

export interface LifetimeStats {
  analyzed: number;
  inputTokens: number;
  costUsd: number;
}
