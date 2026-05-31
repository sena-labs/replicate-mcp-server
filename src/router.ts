/**
 * Model recommendation engine.
 *
 * Pure scoring over the curated registry — no I/O, no model execution.
 * Ranks the models in a category by a stated priority (speed / cost /
 * quality / balanced) using speed tiers and `estimateCost`, returning the
 * top picks with cost estimates and human-readable reasons. The caller runs
 * the chosen model via the existing specialized generate tools.
 */
import { estimateCost } from "./cost.js";
import {
  getCategoryModels,
  type ModelCategory,
  type CuratedModel,
} from "./models.js";

export type Priority = "speed" | "cost" | "quality" | "balanced";

export interface Recommendation {
  key: string;
  model_id: string;
  speed: "fast" | "medium" | "slow";
  est_cost_usd: number | null;
  score: number;
  reason: string;
}

const SPEED_SCORE: Record<"fast" | "medium" | "slow", number> = {
  fast: 1.0,
  medium: 0.6,
  slow: 0.3,
};

const SPEED_WORDS = ["draft", "quick", "fast", "preview", "rapid", "iterate"];
const QUALITY_WORDS = [
  "professional",
  "best",
  "high-res",
  "hi-res",
  "print",
  "logo",
  "polished",
  "final",
];

interface Row {
  key: string;
  model: CuratedModel;
  speedScore: number;
  estCost: number | null;
}

export function recommendModels(opts: {
  category: ModelCategory;
  priority: Priority;
  taskDescription?: string;
  maxCostUsd?: number;
  durationSeconds?: number;
}): Recommendation[] {
  const models = getCategoryModels(opts.category);

  const rows: Row[] = Object.entries(models).map(([key, model]) => {
    const est = estimateCost(model.id, 1, opts.durationSeconds);
    const estCost = est.pricing_basis === "unknown" ? null : est.estimated_usd;
    return { key, model, speedScore: SPEED_SCORE[model.speed], estCost };
  });

  const knownCosts = rows
    .map((r) => r.estCost)
    .filter((c): c is number => c !== null);
  const maxCost = knownCosts.length > 0 ? Math.max(...knownCosts) : 0;

  function costNorm(c: number | null): number {
    if (c === null) return 0.5;
    if (maxCost <= 0) return 0;
    return c / maxCost;
  }

  const desc = (opts.taskDescription ?? "").toLowerCase();
  const speedBias = SPEED_WORDS.some((w) => desc.includes(w)) ? 0.15 : 0;
  const qualityBias = QUALITY_WORDS.some((w) => desc.includes(w)) ? 0.15 : 0;

  interface Scored extends Row {
    costScore: number;
    qualityScore: number;
    score: number;
  }

  let scored: Scored[] = rows.map((r) => {
    const cn = costNorm(r.estCost);
    const costScore = 1 - cn;
    const qualityScore = 0.5 * (1 - r.speedScore) + 0.5 * cn;
    let score: number;
    switch (opts.priority) {
      case "speed":
        score = r.speedScore;
        break;
      case "cost":
        score = costScore;
        break;
      case "quality":
        score = qualityScore;
        break;
      case "balanced":
      default: {
        const wSpeed = 0.4 + speedBias;
        const wQuality = 0.3 + qualityBias;
        const wCost = 0.3;
        const total = wSpeed + wQuality + wCost;
        score =
          (wSpeed * r.speedScore + wCost * costScore + wQuality * qualityScore) /
          total;
        break;
      }
    }
    return { ...r, costScore, qualityScore, score };
  });

  if (opts.maxCostUsd !== undefined) {
    const cap = opts.maxCostUsd;
    scored = scored.filter((s) => s.estCost === null || s.estCost <= cap);
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    let tie: number;
    switch (opts.priority) {
      case "speed":
        // Cheaper wins the tie. Guard the both-null case — Infinity - Infinity
        // is NaN, which would corrupt the comparator and the sort order.
        tie =
          a.estCost === null && b.estCost === null
            ? 0
            : (a.estCost ?? Infinity) - (b.estCost ?? Infinity);
        break;
      case "cost":
        tie = b.speedScore - a.speedScore;
        break;
      case "quality":
        tie = (b.estCost ?? 0) - (a.estCost ?? 0);
        break;
      default:
        tie = b.speedScore - a.speedScore;
        break;
    }
    // Final tiebreak on key keeps ranking deterministic regardless of
    // registry iteration order.
    return tie !== 0 ? tie : a.key.localeCompare(b.key);
  });

  return scored.slice(0, 5).map((s) => ({
    key: s.key,
    model_id: s.model.id,
    speed: s.model.speed,
    est_cost_usd: s.estCost,
    score: Number(s.score.toFixed(3)),
    reason: buildReason(s.model.speed, s.estCost, opts.priority),
  }));
}

function buildReason(
  speed: "fast" | "medium" | "slow",
  estCost: number | null,
  priority: Priority,
): string {
  const costStr =
    estCost === null ? "price unknown" : `~$${estCost.toFixed(4)}/run`;
  switch (priority) {
    case "speed":
      return `${speed} speed (${costStr})`;
    case "cost":
      return estCost === null
        ? `Price unknown (${speed})`
        : `Low cost ${costStr} (${speed})`;
    case "quality":
      return `Quality pick (${speed}, ${costStr})`;
    case "balanced":
    default:
      return `Balanced choice (${speed}, ${costStr})`;
  }
}
