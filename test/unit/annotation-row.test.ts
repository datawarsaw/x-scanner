import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PRESET_BY_ID } from "../../src/shared/presets.ts";
import { verdicts } from "../../src/content/labels.ts";
import type { AnalysisResult, Answer } from "../../src/shared/types.ts";

const V2 = PRESET_BY_ID.signal_v2.dimensions;

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });

let render: typeof import("../../src/content/render.ts");

before(async () => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  });
  render = await import("../../src/content/render.ts");
});

/** Signal v2 answers with the two filters free to move; scores default to the documented fixture. */
function answers(over: { promo?: number; bait?: number } = {}): Record<string, Answer> {
  return {
    topic: { type: "choice", choice: "ai", confidence: 0.9, probabilities: { ai: 0.72 } },
    information_density: { type: "score", score: 2.4, confidence: 0.9, probabilities: {}, legend: {} },
    original_insight: { type: "score", score: 1.8, confidence: 0.9, probabilities: {}, legend: {} },
    evidence: { type: "score", score: 2.1, confidence: 0.9, probabilities: {}, legend: {} },
    actionable: { type: "score", score: 1.5, confidence: 0.9, probabilities: {}, legend: {} },
    promotion: { type: "noul", noul: over.promo ?? 0.1 },
    engagement_bait: { type: "noul", noul: over.bait ?? 0.08 },
  };
}

const RESULT: AnalysisResult = {
  tweetId: "1",
  model: "jev-test",
  answers: {},
  inputTokens: 640,
  outputTokens: 85,
  costUsd: 0,
  latencyMs: 100,
  at: 0,
  questionsHash: "x",
};

/** One filled compact row plus the semantic state the B2 rules are asserted against. */
function row(a: Record<string, Answer>) {
  const slot = document.createElement("div");
  slot.className = render.SLOT_CLASS;
  document.body.appendChild(slot);
  render.fillSlot(slot, verdicts(V2, a), RESULT, "normalized");
  const chips = Array.from(slot.querySelectorAll<HTMLElement>(".xs-topic, .xs-dim, .xs-warn")).map((el) => ({
    cls: el.className,
    dim: el.dataset.dim ?? "",
    text: el.textContent ?? "",
  }));
  const out = {
    slot,
    chips,
    verdict: slot.dataset.verdict,
    warn: slot.dataset.warn,
    hasOk: Boolean(slot.querySelector(".xs-ok")),
    hasFlag: Boolean(slot.querySelector(".xs-flag")),
    flagVar: slot.style.getPropertyValue("--xs-flag"),
  };
  return out;
}

test("a neutral B2 row leads with the topic, keeps every signal metric, and carries no success state", () => {
  const r = row(answers());
  assert.deepEqual(r.chips, [
    { cls: "xs-topic", dim: "", text: "AI" },
    { cls: "xs-dim", dim: "information_density", text: "density 80" },
    { cls: "xs-dim", dim: "original_insight", text: "insight 60" },
    { cls: "xs-dim", dim: "evidence", text: "evidence 70" },
    { cls: "xs-dim", dim: "actionable", text: "actionable 50" },
  ]);
  assert.equal(r.verdict, "neutral");
  assert.equal(r.warn, undefined);
  assert.equal(r.hasOk, false, "no green clean marker");
  assert.equal(r.hasFlag, false, "no orange flag marker");
  assert.equal(r.flagVar, "", "no inline flag tint");
});

test("promo and bait below 40 are both omitted from the compact row", () => {
  const r = row(answers({ promo: 0.39, bait: 0.33 }));
  assert.deepEqual(r.chips.map((c) => c.dim), ["", "information_density", "original_insight", "evidence", "actionable"]);
  assert.equal(r.warn, undefined);
  assert.equal(r.verdict, "neutral");
});

test("promo 40-69 stays visible and neutral, with no amber anywhere", () => {
  const r = row(answers({ promo: 0.45, bait: 0.2 }));
  const promo = r.chips.find((c) => c.dim === "promotion")!;
  assert.equal(promo.cls, "xs-dim", "mid-range promo renders like any quiet metric");
  assert.equal(promo.text, "promo 45");
  assert.equal(r.chips.some((c) => c.dim === "engagement_bait"), false, "bait 20 stays suppressed");
  assert.equal(r.warn, undefined);
  assert.equal(r.verdict, "neutral");
});

test("bait 40-69 stays visible and neutral, with no amber anywhere", () => {
  const r = row(answers({ promo: 0.15, bait: 0.56 }));
  const bait = r.chips.find((c) => c.dim === "engagement_bait")!;
  assert.equal(bait.cls, "xs-dim");
  assert.equal(bait.text, "bait 56");
  assert.equal(r.chips.some((c) => c.dim === "promotion"), false, "promo 15 stays suppressed");
  assert.equal(r.warn, undefined);
});

test("promo at 70 escalates: amber state, promo emphasized, quiet bait omitted", () => {
  const r = row(answers({ promo: 0.7, bait: 0.3 }));
  const promo = r.chips.find((c) => c.dim === "promotion")!;
  assert.equal(promo.cls, "xs-warn", "only the elevated filter value is emphasized");
  assert.equal(promo.text, "promo 70");
  assert.equal(r.warn, "promotion");
  assert.equal(r.verdict, "warn");
  assert.equal(r.chips.some((c) => c.cls === "xs-warn" && c.dim !== "promotion"), false);
});

test("bait at 70 escalates: amber state, bait emphasized, quiet promo omitted", () => {
  const r = row(answers({ promo: 0.35, bait: 0.97 }));
  const bait = r.chips.find((c) => c.dim === "engagement_bait")!;
  assert.equal(bait.cls, "xs-warn");
  assert.equal(bait.text, "bait 97");
  assert.equal(r.warn, "engagement_bait");
  assert.equal(r.verdict, "warn");
  assert.equal(r.chips.some((c) => c.dim === "promotion"), false);
});

test("both filters at 70 escalate together and both values are emphasized", () => {
  const r = row(answers({ promo: 0.8, bait: 0.9 }));
  assert.deepEqual(
    r.chips.filter((c) => c.cls === "xs-warn").map((c) => c.text),
    ["promo 80", "bait 90"],
  );
  assert.equal(r.warn, "promotion engagement_bait");
  assert.equal(r.verdict, "warn");
});

test("threshold edges: 39 hides, 40 shows, 69 stays neutral, 70 escalates", () => {
  const hidden = row(answers({ promo: 0.39 }));
  assert.equal(hidden.chips.some((c) => c.dim === "promotion"), false);
  const visible = row(answers({ promo: 0.4 }));
  assert.equal(visible.chips.find((c) => c.dim === "promotion")!.cls, "xs-dim");
  const mid = row(answers({ promo: 0.69 }));
  assert.equal(mid.chips.find((c) => c.dim === "promotion")!.cls, "xs-dim");
  assert.equal(mid.warn, undefined);
  const edge = row(answers({ promo: 0.7 }));
  assert.equal(edge.chips.find((c) => c.dim === "promotion")!.cls, "xs-warn");
  assert.equal(edge.warn, "promotion");
});

test("a high-signal post gets no green, orange, or aggregate treatment of any kind", () => {
  const high = answers({ promo: 0.02, bait: 0.01 });
  high.information_density = { type: "score", score: 3, confidence: 0.9, probabilities: {}, legend: {} };
  high.original_insight = { type: "score", score: 3, confidence: 0.9, probabilities: {}, legend: {} };
  const r = row(high);
  assert.equal(r.hasOk, false);
  assert.equal(r.hasFlag, false);
  assert.equal(r.flagVar, "");
  assert.deepEqual(
    r.chips.filter((c) => c.cls !== "xs-topic").map((c) => c.cls),
    ["xs-dim", "xs-dim", "xs-dim", "xs-dim"],
    "every metric stays neutral even at 100/100",
  );
});

test("the detail card still opens on click and keeps values the row suppressed", () => {
  render.installDetailHandler();
  const r = row(answers({ promo: 0.1, bait: 0.08 }));
  r.slot.click();
  const card = r.slot.querySelector(".xs-detail")!;
  assert.ok(card, "detail card opened from the compact row");
  const rows = Array.from(card.querySelectorAll(".xs-detail-row")).map((el) => ({
    k: el.querySelector(".xs-detail-k")?.textContent ?? "",
    v: el.querySelector(".xs-detail-v")?.textContent ?? "",
  }));
  assert.deepEqual(rows[4], { k: "promo", v: "10 / 100" }, "suppressed promo is still in the detail view");
  assert.deepEqual(rows[5], { k: "engagement bait", v: "8 / 100" }, "suppressed bait is still in the detail view");
  r.slot.click();
  assert.equal(r.slot.querySelector(".xs-detail"), null, "second click closes the card");
});

test("complex placement: the slot sits after the outer text, before quote and media cards, never inside them", () => {
  const quoteArticle = dom.window.document.createElement("article");
  quoteArticle.innerHTML =
    '<div data-testid="User-Name"><a href="/a/status/8301"><time>1h</time></a></div>' +
    '<div data-testid="tweetText"><span>Worth reading.</span></div>' +
    '<div role="link" tabindex="0"><div data-testid="tweetText"><span>Quoted wisdom here</span></div></div>' +
    '<div role="group"><button>reply</button></div>';
  dom.window.document.body.appendChild(quoteArticle);
  const qSlot = render.ensureSlot(quoteArticle, "8301");
  assert.equal(qSlot.closest('div[role="link"]'), null, "the annotation is never inside the quote card");
  assert.equal(qSlot.previousElementSibling?.matches('[data-testid="tweetText"]'), true, "directly under the outer text");
  assert.equal(qSlot.nextElementSibling?.matches('div[role="link"]'), true, "before the quote card");

  const mediaArticle = dom.window.document.createElement("article");
  mediaArticle.innerHTML =
    '<div data-testid="User-Name"><a href="/b/status/8302"><time>1h</time></a></div>' +
    '<div data-testid="tweetText"><span>Latency by region, March internal run.</span></div>' +
    '<div data-testid="tweetPhoto"><img alt="chart" src="chart.png"></div>' +
    '<div role="group"><button>reply</button></div>';
  dom.window.document.body.appendChild(mediaArticle);
  const mSlot = render.ensureSlot(mediaArticle, "8302");
  assert.equal(mSlot.previousElementSibling?.matches('[data-testid="tweetText"]'), true);
  assert.equal(mSlot.nextElementSibling?.matches('[data-testid="tweetPhoto"]'), true, "before the media card");
});
