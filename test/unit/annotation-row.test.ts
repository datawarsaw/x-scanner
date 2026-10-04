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

test("the detail card still opens on click into overlay portal and keeps values the row suppressed", () => {
  render.installDetailHandler();
  const r = row(answers({ promo: 0.1, bait: 0.08 }));
  r.slot.click();
  const card = dom.window.document.querySelector(".xs-detail")!;
  assert.ok(card, "detail card opened from the compact row into overlay portal");
  assert.equal(r.slot.querySelector(".xs-detail"), null, "detail is in overlay root, not inside slot");
  const overlayRoot = dom.window.document.getElementById(render.OVERLAY_ROOT_ID);
  assert.ok(overlayRoot, "overlay root exists");
  assert.equal(card.parentElement, overlayRoot, "card parent is overlay root");
  const rows = Array.from(card.querySelectorAll(".xs-detail-row")).map((el) => ({
    k: el.querySelector(".xs-detail-k")?.textContent ?? "",
    v: el.querySelector(".xs-detail-v")?.textContent ?? "",
  }));
  assert.deepEqual(rows[4], { k: "promo", v: "10 / 100" }, "suppressed promo is still in the detail view");
  assert.deepEqual(rows[5], { k: "engagement bait", v: "8 / 100" }, "suppressed bait is still in the detail view");
  r.slot.click();
  assert.equal(dom.window.document.querySelector(".xs-detail"), null, "second click closes the card");
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

test("video post: slot sits before video player and detail opens into overlay portal", () => {
  const videoArticle = dom.window.document.createElement("article");
  videoArticle.innerHTML =
    '<div data-testid="User-Name"><a href="/c/status/8303"><time>1h</time></a></div>' +
    '<div data-testid="tweetText"><span>Watch demo video.</span></div>' +
    '<div data-testid="videoPlayer"><video></video></div>' +
    '<div role="group"><button>reply</button></div>';
  dom.window.document.body.appendChild(videoArticle);
  const vSlot = render.ensureSlot(videoArticle, "8303");
  assert.equal(vSlot.nextElementSibling?.matches('[data-testid="videoPlayer"]'), true, "before the video player");
  render.fillSlot(vSlot, [], RESULT, "normalized");
  vSlot.click();
  const card = dom.window.document.querySelector(".xs-detail");
  assert.ok(card, "detail opens in overlay root");
  assert.equal(vSlot.querySelector(".xs-detail"), null, "detail is not inside slot");
  assert.equal(videoArticle.querySelector(".xs-detail"), null, "detail is not inside tweet article");
  render.closeDetail();
});

test("positionDetail: clamps to viewport edges and flips above when space below is insufficient", () => {
  const dummySlot = dom.window.document.createElement("div");
  const dummyCard = dom.window.document.createElement("div");
  dummyCard.className = "xs-detail";
  dom.window.document.body.appendChild(dummySlot);
  dom.window.document.body.appendChild(dummyCard);
  try {
    // Mock getBoundingClientRect
    // Case 1: Normal placement below slot
    dummySlot.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 100, right: 200, width: 100, height: 30, x: 100, y: 100 } as DOMRect);
    dummyCard.getBoundingClientRect = () => ({ top: 0, bottom: 150, left: 0, right: 236, width: 236, height: 150, x: 0, y: 0 } as DOMRect);
    render.positionDetail(dummySlot, dummyCard);
    assert.equal(dummyCard.style.left, "100px");
    assert.equal(dummyCard.style.top, "136px"); // 130 + 6

    // Case 2: Right viewport edge clamp (vw in jsdom defaults to 1024, margin = 8, width = 236 -> max left = 1024 - 8 - 236 = 780)
    dummySlot.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 900, right: 1000, width: 100, height: 30, x: 900, y: 100 } as DOMRect);
    render.positionDetail(dummySlot, dummyCard);
    assert.equal(dummyCard.style.left, "780px");

    // Case 3: Left viewport edge clamp (left < 8 -> left = 8)
    dummySlot.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 2, right: 102, width: 100, height: 30, x: 2, y: 100 } as DOMRect);
    render.positionDetail(dummySlot, dummyCard);
    assert.equal(dummyCard.style.left, "8px");

    // Case 4: Insufficient space below (vh in jsdom is 768; spaceBelow = 768 - 750 - 14 = 4 < 150; slot.top = 720, spaceAbove = 706 >= 150)
    dummySlot.getBoundingClientRect = () => ({ top: 720, bottom: 750, left: 100, right: 200, width: 100, height: 30, x: 100, y: 720 } as DOMRect);
    render.positionDetail(dummySlot, dummyCard);
    assert.equal(dummyCard.style.top, "564px"); // 720 - 6 - 150 = 564
  } finally {
    dummySlot.remove();
    dummyCard.remove();
  }
});

test("detail panel closes on Escape key, click outside, and leaves no stale overlay or duplicate roots", () => {
  const r = row(answers({ promo: 0.1, bait: 0.08 }));
  r.slot.click();
  assert.ok(dom.window.document.querySelector(".xs-detail"), "detail open");
  
  // Press Escape
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(dom.window.document.querySelector(".xs-detail"), null, "Escape key closed detail");

  // Open again and click outside
  r.slot.click();
  assert.ok(dom.window.document.querySelector(".xs-detail"), "detail open again");
  dom.window.document.body.click();
  assert.equal(dom.window.document.querySelector(".xs-detail"), null, "click outside closed detail");

  // Open and close repeatedly: verify exactly 1 overlay root exists
  for (let i = 0; i < 5; i++) {
    r.slot.click();
    assert.ok(dom.window.document.querySelector(".xs-detail"));
    r.slot.click();
    assert.equal(dom.window.document.querySelector(".xs-detail"), null);
  }
  const roots = dom.window.document.querySelectorAll("#" + render.OVERLAY_ROOT_ID);
  assert.equal(roots.length, 1, "exactly one overlay root exists across repeated toggles");
});

test("B2 row presentation and classes remain untouched by portal detail", () => {
  const r = row(answers({ promo: 0.95 }));
  assert.equal(r.slot.classList.contains("xs-slot"), true);
  assert.equal(r.slot.dataset.display, "normalized");
  assert.equal(r.slot.dataset.verdict, "warn");
  assert.equal(r.slot.dataset.warn, "promotion");
  // Click to open detail
  r.slot.click();
  // B2 row itself must not change
  assert.equal(r.slot.classList.contains("xs-slot"), true);
  assert.equal(r.slot.dataset.display, "normalized");
  assert.equal(r.slot.dataset.verdict, "warn");
  render.closeDetail();
});
