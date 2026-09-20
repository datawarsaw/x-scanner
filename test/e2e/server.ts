// Serves the fixture timeline and a fake Jev endpoint. Answers are keyword driven so the
// test can assert which pills appear; token usage is deterministic so cost can be checked.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface SeenRequest {
  text: string;
  quoted_text?: string;
  parent_text?: string;
  is_reply: boolean;
  questionIds: string[];
  model: string;
  kind?: string;
  domain?: string;
}

export function fakeAnswers(state: { text: string; quoted_text?: string }, questionIds: string[]) {
  const t = state.text.toLowerCase();
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
  for (const id of questionIds) {
    const val = (v as Record<string, number>)[id] ?? 0.1;
    if (id === "info_density") answers[id] = { type: "score", score: val, confidence: 0.9, probabilities: {}, legend: {} };
    else if (id === "padding") answers[id] = { type: "score", score: val, confidence: 0.8, probabilities: {}, legend: {} };
    else answers[id] = { type: "noul", noul: val };
  }
  return answers;
}

export function tokensFor(state: unknown): number {
  return 640 + Math.ceil(JSON.stringify(state).length / 4);
}

export async function startServer(fixtureDir: string): Promise<{ port: number; requests: SeenRequest[]; close: () => void; totalTokens: () => number }> {
  const requests: SeenRequest[] = [];
  let totalTokens = 0;
  const server = http.createServer(async (req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
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
        state: { text: string; quoted_text?: string; parent_text?: string; is_reply: boolean; kind?: string; domain?: string };
        questions: Record<string, unknown>;
      };
      const ids = Object.keys(parsed.questions);
      requests.push({
        text: parsed.state.text,
        quoted_text: parsed.state.quoted_text,
        parent_text: parsed.state.parent_text,
        is_reply: parsed.state.is_reply,
        questionIds: ids,
        model: parsed.model,
        kind: parsed.state.kind,
        domain: parsed.state.domain,
      });
      const input_tokens = tokensFor(parsed.state);
      totalTokens += input_tokens;
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 60));
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ model: parsed.model, answers: fakeAnswers(parsed.state, ids), usage: { input_tokens, output_tokens: 85 } }));
      return;
    }
    if (req.method === "GET" && req.url === "/__requests") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(requests));
      return;
    }
    const pathname = (req.url ?? "/").split("?")[0]!;
    // A status permalink URL renders the thread fixture, so DOM thread-context extraction can be tested.
    // A handle-qualified status URL renders the conversation fixture whose root id matches the route.
    const file = /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(pathname)
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
  return { port, requests, close: () => server.close(), totalTokens: () => totalTokens };
}
