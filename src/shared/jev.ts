import type { JevRequest, JevResponse } from "./types.ts";

export const JEV_PATH = "/v1/systemone";
export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-1.14.0";
/** USD per million input tokens for jev-1.14.0 and jev-1.13.0, from docs.typesafe.ai/models (2026-09-18). */
export const DEFAULT_PRICE_PER_MTOK = 0.042;

export function costUsd(inputTokens: number, pricePerMtok: number): number {
  return (inputTokens * pricePerMtok) / 1e6;
}

export class JevError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

export interface CallOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Total attempts including the first. 429 and 529 are retried, nothing else. */
  attempts?: number;
  /** Base delay for exponential backoff, ms. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /**
   * Extra request headers. The vision path uses this for the documented image opt-in header;
   * a text-only call passes nothing and sends exactly the headers it always sent.
   */
  extraHeaders?: Record<string, string>;
}

const RETRYABLE = new Set([429, 529]);

/** One request to POST /v1/systemone with the same retry rules as the official SDKs. */
export async function callJev(body: JevRequest, opts: CallOptions): Promise<{ response: JevResponse; latencyMs: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const attempts = opts.attempts ?? 3;
  const backoffMs = opts.backoffMs ?? 500;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const url = opts.baseUrl.replace(/\/$/, "") + JEV_PATH;

  let lastError: JevError | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const started = performance.now();
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json", ...opts.extraHeaders },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (e) {
      throw new JevError(`network error: ${(e as Error).message}`);
    }
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const json = (await res.json()) as JevResponse;
      if (!json || typeof json !== "object" || !json.answers || !json.usage) {
        throw new JevError("malformed response from Jev");
      }
      return { response: json, latencyMs };
    }

    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    lastError = new JevError(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
    if (!RETRYABLE.has(res.status) || attempt === attempts - 1) throw lastError;

    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt;
    await sleep(wait);
  }
  throw lastError ?? new JevError("unreachable");
}
