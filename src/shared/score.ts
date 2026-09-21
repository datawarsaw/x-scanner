import type { Answer, Dimension, PresetId } from "./types.ts";

/**
 * Deterministic 0..1 score used only for session ranking. Not sent to Jev.
 * Positive weights sum to 1 so a perfect item scores 1; penalties then subtract, clamped at 0.
 */
export function signalScore(preset: PresetId, dimensions: Dimension[], answers: Record<string, Answer>): number {
  const val = (id: string): number | null => {
    const d = dimensions.find((x) => x.id === id);
    const a = answers[id];
    if (!d || !a) return null;
    const v = a.type === "noul" ? a.noul : a.type === "score" ? a.score : a.confidence;
    const max = d.type === "noul" ? 1 : Math.max(1, (d.levels?.length ?? 2) - 1);
    return Math.min(1, Math.max(0, v / max));
  };
  const take = (id: string, fallback = 0) => val(id) ?? fallback;

  if (preset === "signal_v2") {
    // Signal v2 deliberately has no aggregate: its components stay separate and nothing is weighted.
    // Session ranking uses one named component instead of inventing a composite quality score.
    return clamp01(take("information_density"));
  }
  if (preset === "signal") {
    return clamp01(0.3 * take("info_density") + 0.25 * take("actionable") + 0.25 * take("originality") + 0.2 * take("evidence") - 0.1 * take("promotion") - 0.15 * take("engagement_bait"));
  }
  if (preset === "ai_tech") {
    return clamp01(0.3 * take("technical_depth") + 0.25 * take("evidence_benchmark") + 0.25 * take("genuinely_new") + 0.2 * take("implementation_relevance") - 0.15 * take("speculation") - 0.15 * take("hype"));
  }
  if (preset === "article") {
    return clamp01(0.2 * take("info_density") + 0.2 * take("evidence_quality") + 0.2 * take("sourcing") + 0.2 * take("originality") + 0.2 * take("actionable_insight") - 0.1 * take("promotional_intent") - 0.1 * take("speculative"));
  }
  return clamp01(take("info_density") - 0.5 * take("padding") - take("engagement_bait") - take("promotion"));
}

export function isHighSignal(score: number): boolean {
  return score >= 0.5;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
