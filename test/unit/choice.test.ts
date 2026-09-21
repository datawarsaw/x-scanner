import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuestions, maxValue, questionsHash, validateDimension } from "../../src/shared/questions.ts";
import { verdicts } from "../../src/content/labels.ts";
import { activeDimensions, SIGNAL_V2_TOPICS } from "../../src/shared/presets.ts";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/shared/settings.ts";
import type { Answer, Dimension } from "../../src/shared/types.ts";

const CHOICE: Dimension = {
  id: "topic",
  label: "topic",
  type: "choice",
  instructions: "What is the primary subject of this post?",
  options: [
    { id: "ai", label: "AI", description: "Models, LLMs, agents and machine learning." },
    { id: "data_bi", label: "Data / BI", description: "Analytics, BI, dashboards and SQL." },
  ],
  threshold: 0,
  direction: "above",
  enabled: true,
};

test("a choice dimension builds a typed choice question from its options", () => {
  const q = buildQuestions([CHOICE]);
  assert.deepEqual(Object.keys(q), ["topic"]);
  assert.equal(q.topic!.type, "choice");
  assert.equal(q.topic!.instructions, "What is the primary subject of this post?");
  assert.deepEqual(q.topic!.criteria, {
    ai: "Models, LLMs, agents and machine learning.",
    data_bi: "Analytics, BI, dashboards and SQL.",
  });
});

test("an enabled choice is asked, a disabled one is not", () => {
  assert.deepEqual(Object.keys(buildQuestions([{ ...CHOICE, enabled: false }])), []);
});

test("option ids, labels and descriptions survive the settings round trip", () => {
  const stored = normalizeSettings({ ...DEFAULT_SETTINGS, dimensions: [CHOICE] });
  const d = stored.dimensions[0]!;
  assert.equal(d.type, "choice");
  assert.deepEqual(d.options, CHOICE.options);
  assert.equal(d.short, undefined);
});

test("a choice answer is parsed against the declared options, keeping the label and its distribution", () => {
  const answer: Answer = { type: "choice", choice: "data_bi", confidence: 0.8, probabilities: { ai: 0.18, data_bi: 0.72 } };
  const vs = verdicts([CHOICE], { topic: answer });
  assert.equal(vs.length, 1);
  const v = vs[0]!;
  assert.equal(v.id, "topic");
  assert.equal(v.type, "choice");
  assert.equal(v.choice!.id, "data_bi");
  assert.equal(v.choice!.label, "Data / BI");
  // Highest probability first, and only ids the dimension actually declares.
  assert.deepEqual(v.choice!.candidates, [
    { id: "data_bi", label: "Data / BI", p: 0.72 },
    { id: "ai", label: "AI", p: 0.18 },
  ]);
  // A topic is descriptive, so it never flags and never contributes a value to a range.
  assert.equal(v.show, false);
  assert.equal(v.value, 0);
});

test("a choice without a distribution still renders its label", () => {
  const answer: Answer = { type: "choice", choice: "ai", confidence: 0.5, probabilities: {} };
  const v = verdicts([CHOICE], { topic: answer })[0]!;
  assert.equal(v.choice!.label, "AI");
  assert.deepEqual(v.choice!.candidates, []);
});

test("an undeclared choice keeps its own value instead of crashing or inventing a label", () => {
  const answer: Answer = { type: "choice", choice: "quantum_basket_weaving", confidence: 0.4, probabilities: { quantum_basket_weaving: 0.6 } };
  const v = verdicts([CHOICE], { topic: answer })[0]!;
  assert.equal(v.choice!.id, "quantum_basket_weaving");
  assert.equal(v.choice!.label, "quantum_basket_weaving");
  assert.deepEqual(v.choice!.candidates, []);
});

test("a malformed answer for a choice dimension is skipped rather than rendered as a number", () => {
  const wrongType: Answer = { type: "noul", noul: 0.9 };
  assert.deepEqual(verdicts([CHOICE], { topic: wrongType }), []);
  assert.deepEqual(verdicts([CHOICE], {}), []);
  const noChoice: Answer = { type: "choice", choice: "", confidence: 1, probabilities: {} };
  assert.equal(verdicts([CHOICE], { topic: noChoice })[0]!.choice!.label, "");
});

test("a choice contributes to the question hash, so no other schema can reuse its answers", () => {
  const base = questionsHash([CHOICE], "jev-1.13.0");
  const relabelled: Dimension = {
    ...CHOICE,
    options: [{ ...CHOICE.options![0]!, label: "Artificial Intelligence" }, CHOICE.options![1]!],
  };
  assert.equal(questionsHash([relabelled], "jev-1.13.0"), base, "a human label is display policy");

  const reworded: Dimension = {
    ...CHOICE,
    options: [{ ...CHOICE.options![0]!, description: "Models, LLMs, agents and machine learning, verbosely." }, CHOICE.options![1]!],
  };
  assert.notEqual(questionsHash([reworded], "jev-1.13.0"), base, "a criterion is part of the schema");

  const reordered: Dimension = { ...CHOICE, options: [CHOICE.options![1]!, CHOICE.options![0]!] };
  assert.notEqual(questionsHash([reordered], "jev-1.13.0"), base, "the option order is part of the schema");

  const renamed: Dimension = { ...CHOICE, options: [{ ...CHOICE.options![0]!, id: "ml" }, CHOICE.options![1]!] };
  assert.notEqual(questionsHash([renamed], "jev-1.13.0"), base, "an option id is part of the schema");
});

test("validation rejects an empty option list, a duplicate id and an unusable option", () => {
  assert.deepEqual(validateDimension(CHOICE), []);
  assert.deepEqual(validateDimension({ ...CHOICE, options: [] }), ["choice needs at least 2 options"]);
  assert.deepEqual(validateDimension({ ...CHOICE, options: [CHOICE.options![0]!, { ...CHOICE.options![0]!, label: "AI again" }] }), [
    'duplicate option id "ai"',
  ]);
  const unusable: Dimension = { ...CHOICE, options: [{ id: "Not An Id", label: " ", description: "" }, CHOICE.options![1]!] };
  assert.deepEqual(validateDimension(unusable), ['option id "Not An Id" must be snake_case', 'option "Not An Id" has no label']);
});

test("the Signal v2 topic is the declared taxonomy, in order, and takes no numeric part", () => {
  assert.deepEqual(
    SIGNAL_V2_TOPICS.map((o) => o.id),
    [
      "ai",
      "data_bi",
      "software_engineering",
      "business_strategy",
      "tech_industry",
      "productivity_tools",
      "science",
      "politics_society",
      "personal_lifestyle",
      "other",
    ],
  );
  assert.deepEqual(
    SIGNAL_V2_TOPICS.map((o) => o.label),
    ["AI", "Data / BI", "Software Engineering", "Business / Strategy", "Tech Industry", "Productivity / Tools", "Science", "Politics / Society", "Personal / Lifestyle", "Other"],
  );
  for (const o of SIGNAL_V2_TOPICS) assert.ok(o.description.length > 10, o.id);
  assert.deepEqual(validateDimension({ ...CHOICE, options: SIGNAL_V2_TOPICS }), []);

  const topic = activeDimensions({ ...DEFAULT_SETTINGS, selectedPreset: "signal_v2" }).find((d) => d.id === "topic")!;
  assert.equal(topic.type, "choice");
  assert.equal(maxValue(topic), 1, "a category has no ordered magnitude");
});
