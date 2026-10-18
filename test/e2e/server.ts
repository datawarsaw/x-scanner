// Serves the fixture timeline and a fake Jev endpoint. Answers are keyword driven so the
// test can assert which pills appear; token usage is deterministic so cost can be checked.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mediaFixture } from "./media.ts";

export interface SeenRequest {
  text: string;
  quoted_text?: string;
  parent_text?: string;
  is_reply: boolean;
  questionIds: string[];
  model: string;
  kind?: string;
  domain?: string;
  /** "external" or "x-native": which article path produced this request. */
  sourceType?: string;
  subtitle?: string;
  url?: string;
  truncated?: boolean;
  /** state.attached_image: the reference the image was hung off, when the request carried one. */
  attachedImage?: string;
  /** assets[ref].format, "png" or "jpg". */
  assetFormat?: string;
  /** Decoded size of the asset's base64, so a test can check what was actually sent. */
  assetBytes?: number;
  /** The base64 payload itself, so a test can decode and measure it. */
  assetBase64?: string;
  /** The opt-in header, present only on a request that carries an image. */
  imageHeader?: string;
}

/** Signal v2 asks these as scores; the fixture values are fixed so the display can be asserted. */
const SIGNAL_V2_SCORES: Record<string, number> = { information_density: 2.4, original_insight: 1.8, evidence: 2.1, actionable: 1.5 };

/** Candidate distribution the fake reports for a choice question: the documented Signal v2 example. */
const CHOICE_SHARES: Record<string, number> = { ai: 0.72, software_engineering: 0.18, tech_industry: 0.07, other: 0.03 };

/**
 * Per-id answers a test wants verbatim, e.g. the numbers a manual run really reported. Anything not
 * named here keeps the keyword driven behaviour below.
 */
export interface AnswerOverrides {
  scores?: Record<string, number>;
  nouls?: Record<string, number>;
  /** Answer an image-carrying request with a 500, to exercise the text-only fallback. */
  failVision?: boolean;
}

/** What a vision request costs: the documented image-token overhead on top of the text tokens. */
export const VISION_TOKEN_OVERHEAD = 1160;

export function fakeAnswers(
  state: { text: string; quoted_text?: string },
  questions: Record<string, { type?: string; criteria?: unknown }>,
  overrides: AnswerOverrides = {},
) {
  const t = state.text.toLowerCase();
  /** Text-driven low-signal fixture row: every Signal v2 score lands near the bottom of its rubric. */
  const lowSignal = /thinking out loud/.test(t);
  const v = { info_density: 1.0, engagement_bait: 0.08, promotion: 0.1, secondhand: 0.2, padding: 0.5, about_jev: 0.03 };
  if (/typesafe|jev 1\.|system one/.test(t)) v.about_jev = 0.96;
  if (/rt if|follow me|bookmark this|wrong answers only|轉發|追蹤/.test(t)) v.engagement_bait = 0.97;
  if (/gumroad|pre-order|grab it|price goes up/.test(t)) v.promotion = 0.95;
  if (state.quoted_text && t.length < 20) {
    v.secondhand = 0.9;
    v.padding = 1.7;
  }
  if (/reports|according to/.test(t)) v.secondhand = 0.88;
  if ((t.match(/\d/g) ?? []).length >= 6) v.info_density = 2.8;
  if (/honestly|you know|at the end of the day/.test(t)) v.padding = 1.8;
  const answers: Record<string, unknown> = {};
  // The answer shape follows the question's declared type, not its id: v0.6 asks one id as a score in
  // one preset and as a noul in another, and Signal v2 asks a categorical topic.
  for (const [id, q] of Object.entries(questions)) {
    const val = (v as Record<string, number>)[id] ?? 0.1;
    if (q?.type === "score") {
      answers[id] = { type: "score", score: overrides.scores?.[id] ?? (lowSignal ? 0.4 : SIGNAL_V2_SCORES[id] ?? val), confidence: 0.9, probabilities: {}, legend: {} };
    } else if (q?.type === "choice") {
      const optionIds = Object.keys((q.criteria as Record<string, string>) ?? {});
      const probabilities: Record<string, number> = {};
      for (const oid of optionIds) {
        const share = CHOICE_SHARES[oid];
        if (share !== undefined) probabilities[oid] = share;
      }
      // A choice dimension the fake does not know still gets a usable distribution.
      if (!Object.keys(probabilities).length) optionIds.slice(0, 4).forEach((oid, i) => (probabilities[oid] = [0.72, 0.18, 0.07, 0.03][i]!));
      answers[id] = { type: "choice", choice: optionIds[0] ?? "other", confidence: 0.9, probabilities };
    } else {
      answers[id] = { type: "noul", noul: overrides.nouls?.[id] ?? val };
    }
  }
  return answers;
}

export function tokensFor(state: unknown): number {
  return 640 + Math.ceil(JSON.stringify(state).length / 4);
}

export async function startServer(
  fixtureDir: string,
  overrides: AnswerOverrides = {},
): Promise<{
  port: number;
  requests: SeenRequest[];
  /** Every /media/ path asked for, so a test can prove nothing was fetched that should not have been. */
  mediaRequests: MediaRequest[];
  close: () => void;
  totalTokens: () => number;
}> {
  const requests: SeenRequest[] = [];
  const mediaRequests: MediaRequest[] = [];
  let totalTokens = 0;
  const server = http.createServer(async (req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type, TypeSafe-Danger-Zone-Images",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === "/v1/systemone") {
      if (req.headers.authorization !== "Bearer test-key") {
        res.writeHead(401, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "bad key" }));
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body) as {
        model: string;
        state: {
          text: string;
          quoted_text?: string;
          parent_text?: string;
          is_reply: boolean;
          kind?: string;
          domain?: string;
          url?: string;
          truncated?: boolean;
          source?: { type?: string };
          subtitle?: string;
          attached_image?: string;
        };
        questions: Record<string, { type?: string; criteria?: unknown }>;
        assets?: Record<string, { type?: string; format?: string; data_base64?: string }>;
      };
      const ids = Object.keys(parsed.questions);
      const ref = parsed.state.attached_image;
      const asset = ref ? parsed.assets?.[ref] : undefined;
      const rawHeader = req.headers["typesafe-danger-zone-images"];
      const imageHeader = typeof rawHeader === "string" ? rawHeader : undefined;
      requests.push({
        text: parsed.state.text,
        quoted_text: parsed.state.quoted_text,
        parent_text: parsed.state.parent_text,
        is_reply: parsed.state.is_reply,
        questionIds: ids,
        model: parsed.model,
        kind: parsed.state.kind,
        domain: parsed.state.domain,
        sourceType: parsed.state.source?.type,
        subtitle: parsed.state.subtitle,
        url: parsed.state.url,
        truncated: parsed.state.truncated,
        attachedImage: ref,
        assetFormat: asset?.format,
        assetBytes: asset?.data_base64 ? Buffer.from(asset.data_base64, "base64").byteLength : undefined,
        assetBase64: asset?.data_base64,
        imageHeader,
      });
      // An image-carrying request is the one the opt-in switch failed on: answer it as the real API
      // would, and the extension's fallback to text-only scoring is what the test then observes.
      if (overrides.failVision && imageHeader) {
        res.writeHead(500, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "vision unavailable" }));
        return;
      }
      const input_tokens = tokensFor(parsed.state) + (ref ? VISION_TOKEN_OVERHEAD : 0);
      totalTokens += input_tokens;
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 60));
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ model: parsed.model, answers: fakeAnswers(parsed.state, parsed.questions, overrides), usage: { input_tokens, output_tokens: 85 } }));
      return;
    }
    if (req.method === "GET" && req.url === "/__requests") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(requests));
      return;
    }
    const pathname = (req.url ?? "/").split("?")[0]!;
    // The photo CDN stand-in for the vision tests: generated on the fly, so no binary fixture is
    // committed. Checked before the file fallback so a media name never resolves as an HTML page.
    const mediaName = /^\/media\/(.+)$/.exec(pathname)?.[1];
    if (req.method === "GET" && mediaName) {
      const cookie = req.headers.cookie;
      const authorization = req.headers.authorization;
      const dest = req.headers["sec-fetch-dest"];
      const fetchMode = req.headers["sec-fetch-mode"];
      mediaRequests.push({
        path: pathname,
        dest: typeof dest === "string" ? dest : undefined,
        mode: typeof fetchMode === "string" ? fetchMode : undefined,
        cookie: typeof cookie === "string" ? cookie : undefined,
        authorization: typeof authorization === "string" ? authorization : undefined,
      });
      const fixture = mediaFixture(mediaName);
      if (!fixture) {
        res.writeHead(404, cors);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": fixture.type, "Content-Length": String(fixture.bytes.byteLength), ...cors });
      res.end(Buffer.from(fixture.bytes));
      return;
    }
    // A status permalink URL renders the thread fixture, so DOM thread-context extraction can be tested.
    // A handle-qualified status URL renders the conversation fixture whose root id matches the route.
    // The native X Article fixture answers the same route shape as a real long-form status page.
    const file =
      pathname === "/akshay_pachaar/status/2035341800739877091"
        ? "x-article.html"
        : /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(pathname)
          ? "status-page.html"
          : /^\/status\/\d+$/.test(pathname)
            ? "thread.html"
            : pathname.replace(/^\//, "") || "timeline.html";
    try {
      const data = await readFile(path.join(fixtureDir, file));
      const type = file.endsWith(".json") ? "application/json" : "text/html; charset=utf-8";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { port, requests, mediaRequests, close: () => server.close(), totalTokens: () => totalTokens };
}
/**
 * What the fake photo CDN saw. The browser fetches an <img> it was asked to render all by itself, so
 * the Sec-Fetch pair is what separates a page render (dest "image", mode "no-cors") from the
 * extension's own download for transmission (dest "empty", mode "cors"). Only the latter is
 * something x-scanner did.
 */
export interface MediaRequest {
  path: string;
  /** Sec-Fetch-Dest: "image" for a rendered <img>, "empty" for a fetch() call. */
  dest?: string;
  /** Sec-Fetch-Mode: "no-cors" for a rendered <img>, "cors" for the extension's fetch. */
  mode?: string;
  cookie?: string;
  authorization?: string;
}

/** What a vision request costs: the documented image-token overhead on top of the text tokens. */
