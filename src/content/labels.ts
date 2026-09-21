import type { AnalysisResult, Answer, ChoiceVerdict, Dimension, Verdict } from "../shared/types.ts";
import { maxValue } from "../shared/questions.ts";

export function answerValue(a: Answer): number {
  if (a.type === "noul") return a.noul;
  if (a.type === "score") return a.score;
  return a.confidence;
}

/**
 * Resolve a choice answer against the dimension's own options. An id the dimension does not declare
 * is kept as its own label rather than dropped: a surprise answer is evidence, not a crash.
 */
function resolveChoice(d: Dimension, a: Answer): ChoiceVerdict | null {
  if (a.type !== "choice") return null;
  const options = d.options ?? [];
  const label = options.find((o) => o.id === a.choice)?.label ?? String(a.choice ?? "");
  const candidates = options
    .map((o) => ({ id: o.id, label: o.label, p: Number(a.probabilities?.[o.id] ?? 0) }))
    .filter((c) => Number.isFinite(c.p) && c.p > 0)
    .sort((x, y) => y.p - x.p);
  return { id: String(a.choice ?? ""), label, candidates };
}

/** Apply each dimension's threshold and direction. Pure display policy, no inference. */
export function verdicts(dimensions: Dimension[], answers: Record<string, Answer>): Verdict[] {
  const out: Verdict[] = [];
  for (const d of dimensions) {
    if (!d.enabled) continue;
    const a = answers[d.id];
    if (!a) continue;
    const short = d.short ?? d.label;
    if (d.type === "choice") {
      // Descriptive, never a quality judgment: a topic does not cross a threshold and never flags.
      const choice = resolveChoice(d, a);
      if (!choice) continue;
      out.push({ id: d.id, label: d.label, short, type: "choice", value: 0, max: maxValue(d), threshold: d.threshold, direction: d.direction, show: false, color: d.color, choice });
      continue;
    }
    const value = answerValue(a);
    const show = d.direction === "above" ? value >= d.threshold : value <= d.threshold;
    out.push({ id: d.id, label: d.label, short, type: d.type, value, max: maxValue(d), threshold: d.threshold, direction: d.direction, show, color: d.color });
  }
  return out;
}

/** Noul as a percentage, Score as position over the top level. */
export function formatValue(v: Verdict): string {
  if (v.type === "choice") return v.choice?.label ?? "";
  return v.type === "noul" ? `${Math.round(v.value * 100)}%` : `${v.value.toFixed(1)}/${v.max}`;
}

/**
 * The shared 0..100 display range, used only by presets that opt into it (Signal v2). A score is
 * scaled by its own rubric maximum; a noul is already a probability. The two share a range but not
 * a meaning, which is why the raw semantics stay visible in the detail card.
 */
export function normalized(v: Verdict): number {
  if (v.type === "choice" || v.max <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, v.value / v.max)) * 100);
}

/** Raw semantics under a normalized value: the rubric level for a score, the probability for a noul. */
export function rawDetail(v: Verdict): string {
  return v.type === "score" ? `Raw score: ${v.value.toFixed(1)} / ${v.max}` : `Probability true: ${Math.round(v.value * 100)}%`;
}

/** Hover text on the label slot: every raw value plus what the call cost. */
export function tooltip(vs: Verdict[], r: Pick<AnalysisResult, "inputTokens" | "costUsd" | "latencyMs" | "model">): string {
  const parts = vs.map((v) => `${v.label} ${formatValue(v)}`);
  parts.push(`${r.inputTokens} tok`, `$${r.costUsd.toFixed(6)}`, `${r.latencyMs} ms`, r.model);
  return parts.join(" · ");
}
