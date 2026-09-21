import type { Dimension, JevQuestion } from "./types.ts";
import { fnv1a } from "./hash.ts";

/**
 * The five default dimensions. All of them judge the text's behavior, never the author.
 * Prompts are English on purpose: Jev's docs say English is its primary language and
 * CJK is handled but not equally well. The tweet itself goes in as written.
 */
export const DEFAULT_DIMENSIONS: Dimension[] = [
  {
    id: "info_density",
    label: "fact-dense",
    type: "score",
    instructions: "How much specific, verifiable content does `text` contain?",
    levels: [
      "No specific claims; opinion, mood, or a generic statement with nothing that could be checked",
      "One concrete detail such as a number, name, date, or link; the rest is general",
      "Several specific, checkable details: numbers, named sources, dates, or steps",
      "Dense with specifics; most sentences carry a checkable fact or a concrete instruction",
    ],
    threshold: 2.5,
    direction: "above",
    enabled: true,
  },
  {
    id: "engagement_bait",
    label: "engagement bait",
    type: "noul",
    instructions:
      "Does `text` end by asking or prompting readers to reply, repost, like, follow, bookmark, or otherwise interact?",
    criteria: {
      true: "The closing lines request or nudge interaction, e.g. 'RT if you agree', 'drop a comment', 'follow for more', 'bookmark this', or a question posed only to draw replies",
      false: "No request or nudge for interaction; the post simply ends",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "promotion",
    label: "promo",
    type: "noul",
    instructions: "Is `text` promoting a product, course, newsletter, community, service, or paid offer?",
    criteria: {
      true: "Names or links to something the reader is meant to buy, sign up for, join, or subscribe to, including the author's own product",
      false: "No product, course, service, or offer is being pushed",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "secondhand",
    label: "secondhand",
    type: "noul",
    instructions:
      "Does `text` only relay or summarize someone else's view, without adding the author's own argument, evidence, or new information?",
    criteria: {
      true: "The post restates what another person, article, or account said, and the author adds nothing of their own beyond agreement or a short reaction",
      false: "The author states their own position, adds their own reasoning or evidence, or the post is original content",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
  },
  {
    id: "padding",
    label: "filler",
    type: "score",
    instructions: "How much of `text` is filler relative to the information it carries?",
    levels: [
      "Tight; every sentence adds something",
      "Some repetition, throat-clearing, or filler, but the point still comes through",
      "Mostly filler; the actual content could be said in one sentence",
    ],
    threshold: 1.5,
    direction: "above",
    enabled: true,
  },
  {
    id: "about_jev",
    label: "jevpilled",
    type: "noul",
    instructions: "Is `text` about Jev, the System One model from TypeSafe AI, or about TypeSafe AI itself?",
    criteria: {
      true: "Mentions or discusses Jev the AI model, TypeSafe, typesafe.ai, or System One models: using it, benchmarking it, its pricing, its launch, or reactions to it",
      false: "Does not mention Jev the model or TypeSafe. A person or anything else named Jev, other AI models, or unrelated topics",
    },
    threshold: 0.75,
    direction: "above",
    enabled: true,
    color: "#f4212e",
  },
];

/** Dimensions added after the first release, appended to stored settings on upgrade. Keyed by the settings version that introduced them. */
export const ADDED_IN_VERSION: Record<number, string[]> = { 4: ["about_jev"] };

/** Turn enabled dimensions into the `questions` map Jev expects. */
export function buildQuestions(dimensions: Dimension[]): Record<string, JevQuestion> {
  const out: Record<string, JevQuestion> = {};
  for (const d of dimensions) {
    if (!d.enabled) continue;
    if (d.type === "score") {
      out[d.id] = { type: "score", instructions: d.instructions, criteria: d.levels ?? [] };
    } else if (d.type === "choice") {
      // Jev's choice criteria is an option name to criterion map, and that name is what comes back in
      // `choice`. The option id is the wire form; the human label stays display policy.
      const criteria: Record<string, string> = {};
      for (const o of d.options ?? []) criteria[o.id] = o.description;
      out[d.id] = { type: "choice", instructions: d.instructions, criteria };
    } else {
      out[d.id] = { type: "noul", instructions: d.instructions, criteria: d.criteria };
    }
  }
  return out;
}

/**
 * Hash of everything that changes what Jev is asked. Thresholds, labels and direction are
 * display policy and deliberately excluded: changing them must not invalidate the cache.
 */
export function questionsHash(dimensions: Dimension[], model: string): string {
  const q = buildQuestions(dimensions);
  const keys = Object.keys(q).sort();
  return fnv1a(model + "|" + JSON.stringify(keys.map((k) => [k, q[k]])));
}

/** Highest value a dimension can take: 1 for noul and choice, levels-1 for score. */
export function maxValue(d: Dimension): number {
  if (d.type === "choice") return 1;
  return d.type === "noul" ? 1 : Math.max(1, (d.levels?.length ?? 2) - 1);
}

/** Basic validation for the options page. Returns a list of problems, empty when fine. */
export function validateDimension(d: Dimension): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9_]*$/.test(d.id)) problems.push("id must be snake_case (a-z, 0-9, _)");
  if (!d.label.trim()) problems.push("label is empty");
  if (!d.instructions.trim()) problems.push("instructions are empty");
  if (d.type === "choice") {
    const options = d.options ?? [];
    if (options.length < 2) problems.push("choice needs at least 2 options");
    const seen = new Set<string>();
    for (const o of options) {
      if (!/^[a-z][a-z0-9_]*$/.test(o.id)) problems.push(`option id "${o.id}" must be snake_case`);
      else if (seen.has(o.id)) problems.push(`duplicate option id "${o.id}"`);
      seen.add(o.id);
      if (!o.label.trim()) problems.push(`option "${o.id}" has no label`);
    }
  } else if (d.type === "score") {
    const n = d.levels?.filter((l) => l.trim()).length ?? 0;
    if (n < 2 || n > 10) problems.push("score needs 2 to 10 levels");
    if (d.threshold < 0 || d.threshold > Math.max(0, n - 1)) problems.push(`threshold must be within 0 and ${n - 1}`);
  } else {
    if (d.threshold < 0 || d.threshold > 1) problems.push("threshold must be within 0 and 1");
  }
  return problems;
}
