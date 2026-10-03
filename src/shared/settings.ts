import type { ChoiceOption, Dimension, LifetimeStats, Settings } from "./types.ts";
import { ADDED_IN_VERSION, DEFAULT_DIMENSIONS } from "./questions.ts";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_PRICE_PER_MTOK } from "./jev.ts";
import { isPresetId } from "./presets.ts";

export const SETTINGS_KEY = "settings";
export const STATS_KEY = "stats";
/**
 * Live-refresh invalidation channel (v0.6.3).
 *
 * Chromium delivers storage.onChanged to an already-open X tab, but Firefox/Zen does not do so
 * reliably for writes made by the Options page. The deterministic path is therefore an explicit
 * refresh signal: Options Save persists to storage, the background relays an invalidation, and
 * the X content script re-reads storage (the single source of truth) and applies it.
 * storage.onChanged stays registered as a fallback; both paths funnel through one deduped refresh.
 */
export const SETTINGS_PORT = "x-scanner-settings";
export const SETTINGS_CHANGED = "settingsChanged" as const;
/** v1: dwell 200 ms. v2: dwell 0, 800 px look-ahead. v3: scope all of X. v4: about_jev. v5: jevpilled, flag colors. */
/** v6: presets, article analysis, thread context, session fields. */
/** v7: replies and comments are skipped unless the reader opts in. */
export const SETTINGS_VERSION = 7;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  apiKey: "",
  model: DEFAULT_MODEL,
  baseUrl: DEFAULT_BASE_URL,
  pricePerMtok: DEFAULT_PRICE_PER_MTOK,
  scope: "all",
  accountHandle: "",
  analyzeReplies: false,
  dwellMs: 0,
  lookaheadPx: 800,
  concurrency: 6,
  cacheMax: 5000,
  dimensions: DEFAULT_DIMENSIONS,
  selectedPreset: "default",
  articleAnalysisEnabled: true,
  threadContextMode: "quoted",
  maxArticleChars: 8000,
  articleCacheMax: 200,
  version: SETTINGS_VERSION,
};

/** Fill in anything missing from an older or partial settings object. Never throws. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  const version = Number.isFinite(r.version) ? Number(r.version) : 1;
  // v1 installs saved the old 200 ms default into storage; carry them to the new default.
  const dwellRaw = version < 2 && Number(r.dwellMs) === 200 ? 0 : r.dwellMs;
  // v1 and v2 saved the old "home" default; follow the new default.
  const scopeRaw = version < 3 && r.scope === "home" ? "all" : r.scope;
  const dims = Array.isArray(r.dimensions) && r.dimensions.length ? r.dimensions.map(normalizeDimension).map((d) => migrateLabel(d, version)) : [...DEFAULT_DIMENSIONS];
  // Defaults added after this install's version are appended; ones the user deleted later stay deleted.
  for (const [v, ids] of Object.entries(ADDED_IN_VERSION)) {
    if (version >= Number(v)) continue;
    for (const id of ids) {
      const def = DEFAULT_DIMENSIONS.find((d) => d.id === id);
      if (def && !dims.some((d) => d.id === id)) dims.push(def);
    }
  }
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_SETTINGS.enabled,
    apiKey: typeof r.apiKey === "string" ? r.apiKey.trim() : "",
    model: typeof r.model === "string" && r.model.trim() ? r.model.trim() : DEFAULT_MODEL,
    baseUrl: typeof r.baseUrl === "string" && r.baseUrl.trim() ? r.baseUrl.trim() : DEFAULT_BASE_URL,
    pricePerMtok: finiteOr(r.pricePerMtok, DEFAULT_PRICE_PER_MTOK),
    scope: scopeRaw === "home" ? "home" : "all",
    accountHandle: typeof r.accountHandle === "string" ? r.accountHandle.replace(/^@/, "").trim() : "",
    analyzeReplies: typeof r.analyzeReplies === "boolean" ? r.analyzeReplies : false,
    dwellMs: clamp(Number(dwellRaw), 0, 5000, DEFAULT_SETTINGS.dwellMs),
    lookaheadPx: clamp(Number(r.lookaheadPx), 0, 5000, DEFAULT_SETTINGS.lookaheadPx),
    concurrency: clamp(Number(r.concurrency), 1, 32, DEFAULT_SETTINGS.concurrency),
    cacheMax: clamp(Number(r.cacheMax), 100, 100000, DEFAULT_SETTINGS.cacheMax),
    dimensions: dims,
    // Whitelisted by the preset table, so a new preset is accepted without editing this line.
    selectedPreset: isPresetId(r.selectedPreset) ? r.selectedPreset : "default",
    articleAnalysisEnabled: typeof r.articleAnalysisEnabled === "boolean" ? r.articleAnalysisEnabled : true,
    threadContextMode: r.threadContextMode === "off" || r.threadContextMode === "parent" || r.threadContextMode === "thread" ? r.threadContextMode : "quoted",
    maxArticleChars: clamp(Number(r.maxArticleChars), 1000, 40000, DEFAULT_SETTINGS.maxArticleChars),
    articleCacheMax: clamp(Number(r.articleCacheMax), 20, 2000, DEFAULT_SETTINGS.articleCacheMax),
    version: SETTINGS_VERSION,
  };
}

/** Default labels that were renamed after release; stored settings still carrying the old one move along. */
const RENAMED_LABELS: Record<string, [string, string]> = {
  info_density: ["dense", "fact-dense"],
  padding: ["padded", "filler"],
  about_jev: ["jev", "jevpilled"],
};

function migrateLabel(d: Dimension, version: number): Dimension {
  const r = RENAMED_LABELS[d.id];
  let out = r && d.label === r[0] ? { ...d, label: r[1] } : d;
  // v5 introduced flag colors; give a pre-v5 about_jev its default red unless one was set.
  if (version < 5 && out.id === "about_jev" && !out.color) out = { ...out, color: DEFAULT_DIMENSIONS.find((x) => x.id === "about_jev")?.color };
  return out;
}

function normalizeDimension(d: Partial<Dimension>): Dimension {
  const type = d.type === "noul" ? "noul" : d.type === "choice" ? "choice" : "score";
  return {
    id: String(d.id ?? "").trim(),
    label: String(d.label ?? "").trim(),
    type,
    instructions: String(d.instructions ?? ""),
    levels: type === "score" ? (Array.isArray(d.levels) ? d.levels.map(String) : []) : undefined,
    criteria: type === "noul" ? { true: String(d.criteria?.true ?? ""), false: String(d.criteria?.false ?? "") } : undefined,
    // A stored choice dimension keeps its options rather than being flattened into a score.
    options: type === "choice" ? normalizeOptions(d.options) : undefined,
    short: typeof d.short === "string" && d.short.trim() ? d.short.trim() : undefined,
    threshold: finiteOr(d.threshold, type === "noul" ? 0.75 : type === "choice" ? 0 : 1),
    direction: d.direction === "below" ? "below" : "above",
    enabled: d.enabled !== false,
    color: typeof d.color === "string" && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color.toLowerCase() : undefined,
  };
}

function normalizeOptions(raw: unknown): ChoiceOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => {
    const r = (o && typeof o === "object" ? o : {}) as Partial<ChoiceOption>;
    return { id: String(r.id ?? "").trim(), label: String(r.label ?? "").trim(), description: String(r.description ?? "").trim() };
  });
}

function finiteOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return v !== "" && v !== null && Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(got[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

/** Stable identity of the last applied settings, so a duplicate refresh signal is a cheap no-op. */
export function settingsSnapshotKey(s: Settings): string {
  return JSON.stringify(s);
}

/**
 * Fire-and-forget invalidation after Save. Storage stays the source of truth; this message only
 * tells the background to relay "re-read storage" to live X tabs. Never throws and never blocks
 * the "saved" feedback on a missing listener (tests, reload races, invalidated contexts).
 */
export function notifySettingsChanged(): void {
  try {
    const r = chrome.runtime.sendMessage({ type: SETTINGS_CHANGED });
    (r as unknown as Promise<unknown> | undefined)?.catch?.(() => {});
  } catch {
    /* no listening background; storage write above already persisted the settings */
  }
}

export function onSettingsChange(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[SETTINGS_KEY]) cb(normalizeSettings(changes[SETTINGS_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function loadStats(): Promise<LifetimeStats> {
  const got = await chrome.storage.local.get(STATS_KEY);
  const s = (got[STATS_KEY] ?? {}) as Partial<LifetimeStats>;
  return { analyzed: s.analyzed ?? 0, inputTokens: s.inputTokens ?? 0, costUsd: s.costUsd ?? 0 };
}
