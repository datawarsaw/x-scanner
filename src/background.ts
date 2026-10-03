// Service worker. The only place that holds the API key and talks to Jev.
// The content script sends tweet state; this returns typed answers plus exact token usage.
import type { AnalyzeReply, ArticleState, FetchArticleReply, LifetimeStats, Message, TweetState } from "./shared/types.ts";
import { loadSettings, onSettingsChange, SETTINGS_CHANGED, SETTINGS_PORT, STATS_KEY } from "./shared/settings.ts";
import { buildQuestions } from "./shared/questions.ts";
import { callJev, costUsd, JevError } from "./shared/jev.ts";
import { PRESET_BY_ID, activeQuestions } from "./shared/presets.ts";

const SAMPLE: TweetState = {
  text: "Most people will never understand this about building a startup.\n\nIt is not about the idea. It is about the founder.\n\nRT if you agree and follow me for more founder lessons.",
  is_reply: false,
};

let settingsPromise = loadSettings();
/**
 * Live X tabs holding a settings port. Ports need no extra manifest permissions (unlike
 * tabs.query/tabs.sendMessage fan-out), work in both the Chromium service worker and the
 * Firefox event-page background, and die with the tab so no stale-tab bookkeeping is needed.
 */
const settingsPorts = new Set<chrome.runtime.Port>();

/** Relay an invalidation signal to every live X tab; each tab re-reads storage itself. */
function broadcastSettingsChanged(): void {
  for (const port of Array.from(settingsPorts)) {
    try {
      port.postMessage({ type: SETTINGS_CHANGED });
    } catch {
      try {
        port.disconnect();
      } catch {
        /* already gone */
      }
      settingsPorts.delete(port);
    }
  }
}

try {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== SETTINGS_PORT) return;
    settingsPorts.add(port);
    port.onDisconnect.addListener(() => {
      settingsPorts.delete(port);
    });
  });
} catch {
  /* chrome.runtime unavailable under node/tests; analyze path is unaffected */
}

onSettingsChange((s) => {
  settingsPromise = Promise.resolve(s);
  broadcastSettingsChanged();
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse: (r: unknown) => void) => {
  handle(msg).then(sendResponse, (e: unknown) => sendResponse({ ok: false, error: String((e as Error)?.message ?? e) }));
  return true;
});

async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case "openOptions":
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case "settingsChanged":
      // Explicit Save signal from Options. Re-read storage (source of truth) in case this
      // background missed the storage event too, then relay the invalidation to live X tabs.
      settingsPromise = loadSettings();
      broadcastSettingsChanged();
      return { ok: true };
    case "testConnection":
      return analyze(SAMPLE);
    case "analyze":
      return analyze(msg.state);
    case "analyzeArticle":
      return analyzeArticle(msg.article);
    case "fetchArticle":
      return fetchArticle(msg.url);
    default:
      return { ok: false, error: "unknown message" };
  }
}

async function analyze(state: TweetState): Promise<AnalyzeReply> {
  const s = await settingsPromise;
  if (!s.apiKey) return { ok: false, error: "no API key", status: 401 };
  const questions = activeQuestions(s);
  if (Object.keys(questions).length === 0) return { ok: false, error: "no enabled dimensions" };
  try {
    const { response, latencyMs } = await callJev({ model: s.model, state, questions }, { baseUrl: s.baseUrl, apiKey: s.apiKey });
    const cost = costUsd(response.usage.input_tokens, s.pricePerMtok);
    bumpStats(response.usage.input_tokens, cost);
    return { ok: true, model: response.model, answers: response.answers, usage: response.usage, latencyMs, costUsd: cost };
  } catch (e) {
    const err = e as JevError;
    return { ok: false, error: err.message, status: err.status };
  }
}

async function analyzeArticle(article: ArticleState): Promise<AnalyzeReply> {
  const s = await settingsPromise;
  if (!s.apiKey) return { ok: false, error: "no API key", status: 401 };
  const questions = buildQuestions(PRESET_BY_ID.article.dimensions);
  if (Object.keys(questions).length === 0) return { ok: false, error: "no enabled dimensions" };
  try {
    const { response, latencyMs } = await callJev({ model: s.model, state: article, questions }, { baseUrl: s.baseUrl, apiKey: s.apiKey });
    const cost = costUsd(response.usage.input_tokens, s.pricePerMtok);
    bumpStats(response.usage.input_tokens, cost);
    return { ok: true, model: response.model, answers: response.answers, usage: response.usage, latencyMs, costUsd: cost };
  } catch (e) {
    const err = e as JevError;
    return { ok: false, error: err.message, status: err.status };
  }
}

const MAX_ARTICLE_BYTES = 1_500_000;

async function fetchArticle(url: string): Promise<FetchArticleReply> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "invalid url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: "unsupported url" };
  const origin = `${parsed.origin}/*`;
  if (!(await hasHostAccess(origin))) {
    const granted = await requestHostAccess(origin);
    if (!granted) return { ok: false, error: "article access not granted", needsGrant: true };
  }
  try {
    const res = await fetch(parsed.toString(), { method: "GET", redirect: "follow", credentials: "omit" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype && !/html|xml|text/i.test(ctype)) return { ok: false, error: `not HTML (${ctype})` };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_ARTICLE_BYTES) return { ok: false, error: "article too large" };
    const html = new TextDecoder("utf-8").decode(buf);
    return { ok: true, html, finalUrl: res.url || parsed.toString() };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** Optional host permissions keep article access off until the user asks for it. */
async function hasHostAccess(origin: string): Promise<boolean> {
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.contains({ origins: ["https://*/*", "http://*/*"] });
  } catch {
    return true;
  }
}

async function requestHostAccess(origin: string): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

// Lifetime totals live in storage, written by this single writer, serialized to avoid lost updates.
let statsChain: Promise<void> = Promise.resolve();
function bumpStats(inputTokens: number, cost: number): void {
  statsChain = statsChain
    .then(async () => {
      const got = await chrome.storage.local.get(STATS_KEY);
      const cur = (got[STATS_KEY] ?? { analyzed: 0, inputTokens: 0, costUsd: 0 }) as LifetimeStats;
      const next: LifetimeStats = {
        analyzed: cur.analyzed + 1,
        inputTokens: cur.inputTokens + inputTokens,
        costUsd: cur.costUsd + cost,
      };
      await chrome.storage.local.set({ [STATS_KEY]: next });
    })
    .catch(() => {});
}
