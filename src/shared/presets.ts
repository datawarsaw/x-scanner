import type { ChoiceOption, Dimension, JevQuestion, Preset, PresetId, Settings, ThreadContextMode } from "./types.ts";
import { buildQuestions, DEFAULT_DIMENSIONS } from "./questions.ts";

function fromDefault(id: string): Dimension {
  const d = DEFAULT_DIMENSIONS.find((x) => x.id === id);
  if (!d) throw new Error(`missing default dimension ${id}`);
  return {
    ...d,
    levels: d.levels ? [...d.levels] : undefined,
    criteria: d.criteria ? { ...d.criteria } : undefined,
  };
}

/** v0.5 initial defaults for new presets. Conservative; not calibrated on a labeled set. */
const SIGNAL_DIMENSIONS: Dimension[] = [
  fromDefault("info_density"),
  {
    id: "actionable",
    label: "actionable",
    type: "noul",
    instructions: "Does `text` leave the reader with a specific action, method, or decision they could apply?",
    criteria: {
      true: "The reader could do something concrete after reading: a step, a tool, a threshold, a decision rule, or a method",
      false: "No usable next step; the post is mood, status, or a claim without something to apply",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "originality",
    label: "original",
    type: "noul",
    instructions: "Does the author add their own argument, evidence, or observation rather than restating someone else?",
    criteria: {
      true: "The author contributes a distinct claim, reasoning, or first-hand detail",
      false: "The post mainly relays, quotes, or agrees with someone else's view",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "evidence",
    label: "evidence",
    type: "noul",
    instructions: "Does `text` cite numbers, sources, methods, or other checkable support for its point?",
    criteria: {
      true: "Includes at least one number, named source, method, or other detail that could be checked",
      false: "Assertions without support",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  fromDefault("promotion"),
  fromDefault("engagement_bait"),
];

/**
 * Signal v2 topic taxonomy. The ids are what Jev sees and returns; the labels are what the reader
 * sees. Topic is descriptive and is never part of a quality judgment.
 */
export const SIGNAL_V2_TOPICS: ChoiceOption[] = [
  { id: "ai", label: "AI", description: "Models, LLMs, agents, machine learning, inference, training, AI research, and AI products where AI itself is the substantive topic." },
  { id: "data_bi", label: "Data / BI", description: "Analytics, business intelligence, Power BI, dashboards, SQL, metrics, reporting, data engineering and analytical workflows." },
  { id: "software_engineering", label: "Software Engineering", description: "Programming, architecture, frameworks, libraries, developer tooling, infrastructure, APIs, testing, deployment and implementation." },
  { id: "business_strategy", label: "Business / Strategy", description: "Management, company strategy, operations, markets, business models, commercial strategy and organizational decisions." },
  { id: "tech_industry", label: "Tech Industry", description: "Technology companies, launches, ecosystems, acquisitions, industry developments and product news where the focus is the industry rather than implementation." },
  { id: "productivity_tools", label: "Productivity / Tools", description: "Workflows, apps, work methods, general tools, personal productivity and knowledge-work practices." },
  { id: "science", label: "Science", description: "Scientific research and findings not primarily belonging to AI/software." },
  { id: "politics_society", label: "Politics / Society", description: "Government, public policy, elections, institutions and social issues." },
  { id: "personal_lifestyle", label: "Personal / Lifestyle", description: "Personal updates, lifestyle, entertainment and everyday-life content." },
  { id: "other", label: "Other", description: "None of the above is a good primary classification." },
];

/**
 * v0.6.0 Signal v2: what a post is about, how much useful signal it carries, and whether it is
 * pushing something or fishing for engagement. Topic is categorical and the four signal components
 * are separate ordered rubrics; there is deliberately no aggregate score. Thresholds follow the
 * convention the other presets already use (2.5 of 3 for a score, 0.75 for a noul), so a merely
 * good post does not turn orange and normally only the two filters do.
 */
const SIGNAL_V2_DIMENSIONS: Dimension[] = [
  {
    id: "topic",
    label: "topic",
    type: "choice",
    instructions:
      "What is the primary subject of this post? Choose the category that best represents the main substantive topic, not a passing mention.",
    options: SIGNAL_V2_TOPICS,
    threshold: 0,
    direction: "above",
    enabled: true,
  },
  {
    id: "information_density",
    label: "information density",
    short: "density",
    type: "score",
    instructions: "How much specific, useful and checkable information does this text contain relative to its length?",
    levels: [
      "Almost no substantive information; mainly reaction, mood, slogan, generic statement or unsupported assertion",
      "Contains one useful concrete detail, example, number, fact or instruction, but most of the post remains general",
      "Contains several substantive details, concrete claims, examples, numbers, sources or useful steps",
      "High information density; most of the text contributes specific, useful or checkable information",
    ],
    threshold: 2.5,
    direction: "above",
    enabled: true,
  },
  {
    id: "original_insight",
    label: "original insight",
    short: "insight",
    type: "score",
    instructions: "How much original interpretation, reasoning, synthesis or non-obvious insight does the author add?",
    levels: [
      "No meaningful original insight; repetition, simple reaction or obvious restatement",
      "A small amount of interpretation or personal framing, but little new reasoning",
      "Adds a meaningful argument, interpretation, connection or useful synthesis",
      "Provides a strong non-obvious insight, original reasoning or genuinely useful synthesis",
    ],
    threshold: 2.5,
    direction: "above",
    enabled: true,
  },
  {
    id: "evidence",
    label: "evidence",
    type: "score",
    instructions:
      "How well are the post's substantive claims grounded in evidence available in the text or clearly referenced by it?",
    levels: [
      "Substantive claims are asserted without evidence, examples, sources, demonstrations or verifiable support",
      "Some support is present, but it is vague, weak or incomplete",
      "Claims are supported by useful examples, data, citations, links, benchmarks, demonstrations or other concrete evidence",
      "Strong grounding; important claims are backed by concrete evidence, primary sources, reproducible examples, measurements or clear demonstrations",
    ],
    threshold: 2.5,
    direction: "above",
    enabled: true,
  },
  {
    id: "actionable",
    label: "actionable",
    type: "score",
    instructions:
      "How directly can a reader use this information to make a decision, learn something practical, try something or change what they do?",
    levels: [
      "No practical takeaway or usable implication",
      "Some potential relevance, but the reader must infer most of the practical value",
      "Contains a clear useful takeaway, method, example, recommendation or decision-relevant implication",
      "Immediately useful; provides concrete steps, technique, decision guidance or knowledge that can directly change what the reader does",
    ],
    threshold: 2.5,
    direction: "above",
    enabled: true,
  },
  {
    id: "promotion",
    label: "promo",
    short: "promo",
    type: "noul",
    instructions:
      "Is the post substantially pushing a product, service, course, newsletter, paid community, subscription or other commercial offer?",
    criteria: {
      true: "The post works to move the reader toward something the author or a sponsor offers: buy, subscribe, join, book a call, or pre-order. Intent matters: a product mention or a useful link on its own is not a pitch",
      false: "No offer is being pushed; product mentions and links are incidental to the point of the post",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  { ...fromDefault("engagement_bait"), short: "bait" },
];

const AI_TECH_DIMENSIONS: Dimension[] = [
  {
    id: "technical_depth",
    label: "technical",
    type: "score",
    instructions: "How much technical substance does `text` have about software, models, systems, or research?",
    levels: [
      "No technical content; vibe, announcement, or personality",
      "Names a tool, model, or topic but with no mechanism, numbers, or method",
      "Describes a method, architecture, result, or tradeoff with some specifics",
      "Dense with mechanisms, numbers, constraints, or implementation detail",
    ],
    threshold: 2.5,
    direction: "above",
    enabled: true,
  },
  {
    id: "evidence_benchmark",
    label: "benchmarked",
    type: "noul",
    instructions: "Does `text` support its technical claim with a measurement, comparison, ablation, or other result?",
    criteria: {
      true: "Cites a number, comparison, eval, reproduction, or other demonstrated result",
      false: "No measurement or comparison; the claim is asserted",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "genuinely_new",
    label: "new",
    type: "noul",
    instructions: "Does `text` report something the author presents as newly observed, shipped, or demonstrated?",
    criteria: {
      true: "A new result, release, finding, or first-hand observation, not a restatement of common knowledge",
      false: "Restates a known take, recites docs, or has no new information",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "speculation",
    label: "speculative",
    type: "noul",
    instructions: "Is the main claim speculative rather than a demonstrated result?",
    criteria: {
      true: "Prediction, rumor, vibe, or untested hypothesis presented as if it were established",
      false: "Describes something that was built, measured, or otherwise shown",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "implementation_relevance",
    label: "implementable",
    type: "noul",
    instructions: "Could a practitioner use `text` to change how they build or run a system?",
    criteria: {
      true: "Contains a method, constraint, API, config, or tradeoff a builder could act on",
      false: "Commentary with nothing a practitioner could apply",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "hype",
    label: "hype",
    type: "noul",
    instructions: "Does `text` sell the work with superlatives, destiny language, or marketing intensity rather than describing it?",
    criteria: {
      true: "Relies on hype: 'game changer', 'unbelievable', 'the future', or similar intensity without matching evidence",
      false: "Tone matches the evidence; no marketing swell",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
];

const ARTICLE_DIMENSIONS: Dimension[] = [
  fromDefault("info_density"),
  {
    id: "evidence_quality",
    label: "evidence-rich",
    type: "noul",
    instructions: "Does the article body support its claims with data, methods, or primary sources?",
    criteria: {
      true: "Claims are backed by numbers, studies, documents, or first-hand reporting",
      false: "Mostly assertion, anecdote, or unsourced narrative",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "sourcing",
    label: "sourced",
    type: "noul",
    instructions: "Does the article name sources a reader could follow (people, papers, datasets, documents)?",
    criteria: {
      true: "Named sources, links, or citations a reader could check",
      false: "Unattributed claims or vague 'experts say'",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "originality",
    label: "original",
    type: "noul",
    instructions: "Does the article add reporting, analysis, or evidence beyond summarizing other coverage?",
    criteria: {
      true: "Original reporting, analysis, or a distinct argument",
      false: "Aggregation or rewrite of existing coverage",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "technical_depth",
    label: "technical",
    type: "score",
    instructions: "How much technical or domain substance does the article body have?",
    levels: [
      "No technical or domain mechanism; purely narrative or opinion",
      "Names topics but stays at a high level",
      "Explains mechanisms, methods, or tradeoffs with some specifics",
      "Dense with methods, numbers, or implementable detail",
    ],
    threshold: 2.5,
    direction: "above",
    enabled: true,
  },
  {
    id: "promotional_intent",
    label: "promo",
    type: "noul",
    instructions: "Is the article primarily selling a product, service, or the author's offering?",
    criteria: {
      true: "The through-line is a pitch: buy, sign up, book a call, join a community",
      false: "Not a sales page; any product mention is incidental",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "speculative",
    label: "speculative",
    type: "noul",
    instructions: "Is the article's main claim speculative rather than evidenced?",
    criteria: {
      true: "Forecast or vibe presented as fact without matching evidence",
      false: "Claims are tied to evidence or clearly labeled as opinion",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "actionable_insight",
    label: "actionable",
    type: "noul",
    instructions: "Does the reader leave with a specific action, method, or decision they could apply?",
    criteria: {
      true: "A concrete takeaway: a step, a rule, a tool, or a decision criterion",
      false: "No usable next step",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
];

export const PRESETS: Preset[] = [
  {
    id: "default",
    label: "Default",
    description: "The original six dimensions. Same questions and thresholds as v0.1.",
    dimensions: DEFAULT_DIMENSIONS,
    contentType: "post",
    context: "quoted",
    version: 1,
  },
  {
    id: "signal",
    label: "Signal (legacy)",
    description: "Useful vs noisy posts: density, action, originality, evidence, promo, bait.",
    dimensions: SIGNAL_DIMENSIONS,
    contentType: "post",
    context: "parent",
    version: 1,
  },
  {
    id: "signal_v2",
    label: "Signal v2",
    description: "Topic + useful-signal classification. Experimental.",
    dimensions: SIGNAL_V2_DIMENSIONS,
    contentType: "post",
    context: "parent",
    version: 1,
  },
  {
    id: "ai_tech",
    label: "AI / Tech",
    description: "Technical AI and software posts: depth, evidence, novelty, speculation, implementation, hype.",
    dimensions: AI_TECH_DIMENSIONS,
    contentType: "post",
    context: "thread",
    version: 1,
  },
  {
    id: "article",
    label: "Article",
    description: "Long-form linked pages. Used when you click Analyze article.",
    dimensions: ARTICLE_DIMENSIONS,
    contentType: "article",
    context: "quoted",
    version: 1,
  },
];

export const PRESET_BY_ID: Record<PresetId, Preset> = Object.fromEntries(PRESETS.map((p) => [p.id, p])) as Record<PresetId, Preset>;

export function isPresetId(v: unknown): v is PresetId {
  return v === "default" || v === "signal" || v === "signal_v2" || v === "ai_tech" || v === "article";
}

/** Dimensions actually sent to Jev for the current HUD preset. */
export function activeDimensions(settings: Settings): Dimension[] {
  if (settings.selectedPreset === "default") return settings.dimensions;
  return PRESET_BY_ID[settings.selectedPreset]?.dimensions ?? settings.dimensions;
}

/**
 * The questions the running configuration actually asks: empty exactly when the active schema has
 * nothing enabled. Read this, never `buildQuestions(settings.dimensions)`: the editable legacy
 * dimensions sit behind a preset and are not what the reader selected.
 */
export function activeQuestions(settings: Settings): Record<string, JevQuestion> {
  return buildQuestions(activeDimensions(settings));
}

export function contextModeFor(settings: Settings): ThreadContextMode {
  if (settings.threadContextMode !== "quoted") return settings.threadContextMode;
  return PRESET_BY_ID[settings.selectedPreset]?.context ?? "quoted";
}
