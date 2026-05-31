/**
 * Best-effort cost estimation for Replicate predictions.
 *
 * Replicate does not expose pricing through its API, so this table is
 * a hand-curated snapshot of public per-run / per-second rates as of the
 * server release. The estimator clearly flags numbers as approximate.
 * For up-to-the-minute pricing the user should consult
 * https://replicate.com/pricing.
 */

import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  AUDIO_MUSIC_MODELS,
  TTS_MODELS,
  LLM_MODELS,
  VISION_MODELS,
  UPSCALE_MODELS,
  BG_REMOVAL_MODELS,
  STT_MODELS,
  INPAINT_MODELS,
  SEGMENT_MODELS,
  EMBED_MODELS,
  VOICE_CLONE_MODELS,
  THREED_MODELS,
  LIPSYNC_MODELS,
} from "./models.js";
import { REPLICATE_MAX_COST_USD } from "./constants.js";
import { logger } from "./logger.js";

interface PriceEntry {
  /** Flat USD per run, regardless of duration. */
  perRun?: number;
  /** USD per output second (video, music, transcription). */
  perSecond?: number;
  /** Free-form note shown in the estimator output (e.g. "GPU L40S"). */
  note?: string;
}

/** Pricing keyed by Replicate "owner/name" model id. Approximate USD. */
const COST_BY_MODEL_ID: Record<string, PriceEntry> = {
  // Image
  "black-forest-labs/flux-schnell": { perRun: 0.003 },
  "black-forest-labs/flux-dev": { perRun: 0.025 },
  "black-forest-labs/flux-1.1-pro": { perRun: 0.04 },
  "stability-ai/stable-diffusion-3.5-large": { perRun: 0.065 },
  "recraft-ai/recraft-v3": { perRun: 0.04 },
  "recraft-ai/recraft-v4.1": { perRun: 0.04 },
  "ideogram-ai/ideogram-v2": { perRun: 0.08 },
  "google/imagen-3": { perRun: 0.04 },
  // Video — per output second
  "kwaivgi/kling-v1.6-pro": { perSecond: 0.09 },
  "minimax/video-01": { perRun: 0.5 },
  "tencent/hunyuan-video": { perRun: 0.25 },
  "luma/ray": { perSecond: 0.08 },
  // wan-2.2 owner must match the registry (wan-video, not wavespeedai),
  // otherwise the estimate/budget lookup silently misses.
  "wan-video/wan-2.2-t2v-fast": { perSecond: 0.05 },
  // Audio / music
  "meta/musicgen": { perSecond: 0.0017 },
  "lucataco/ace-step": { perRun: 0.15 },
  "riffusion/riffusion": { perRun: 0.01 },
  // TTS
  "jaaari/kokoro-82m": { perRun: 0.001 },
  "minimax/speech-02-hd": { perRun: 0.02 },
  "resemble-ai/chatterbox": { perRun: 0.01 },
  // LLM — per second of GPU time (very rough)
  "meta/meta-llama-3.1-405b-instruct": { perSecond: 0.0095, note: "GPU 8xA100" },
  "meta/meta-llama-3-70b-instruct": { perSecond: 0.0024, note: "GPU 4xA100" },
  "meta/meta-llama-3-8b-instruct": { perSecond: 0.0004, note: "GPU A100" },
  "mistralai/mistral-7b-instruct-v0.2": { perSecond: 0.0005 },
  "mistralai/mixtral-8x7b-instruct-v0.1": { perSecond: 0.0009 },
  "deepseek-ai/deepseek-r1": { perSecond: 0.0095 },
  // Vision
  "yorickvp/llava-13b": { perRun: 0.0023 },
  "yorickvp/llava-v1.6-34b": { perRun: 0.0035 },
  "andreasjansson/blip-2": { perRun: 0.0009 },
  "lucataco/qwen2-vl-7b-instruct": { perRun: 0.0017 },
  // Upscale
  "nightmareai/real-esrgan": { perRun: 0.003 },
  "philz1337x/clarity-upscaler": { perRun: 0.04 },
  "philz1337x/clarity-pro-upscaler": { perRun: 0.04 },
  "jingyunliang/swinir": { perRun: 0.0046 },
  "tencentarc/gfpgan": { perRun: 0.0023 },
  // Background removal
  "lucataco/remove-bg": { perRun: 0.002 },
  "men1scus/birefnet": { perRun: 0.003 },
  "briaai/rmbg-v2.0": { perRun: 0.004 },
  // STT — per second of audio
  "openai/whisper": { perSecond: 0.00065 },
  "vaibhavs10/incredibly-fast-whisper": { perSecond: 0.0002 },
  "victor-upmeet/whisperx": { perSecond: 0.0008 },
  // Inpaint
  "black-forest-labs/flux-fill-pro": { perRun: 0.05 },
  "stability-ai/stable-diffusion-inpainting": { perRun: 0.0023 },
  "ideogram-ai/ideogram-v2-edit": { perRun: 0.08 },
  // Segmentation
  "meta/sam-2": { perRun: 0.003 },
  "schananas/grounded_sam": { perRun: 0.005 },
  // Embeddings — per run (vectoriser is fast)
  "nateraw/bge-large-en-v1.5": { perRun: 0.00023 },
  "jina-ai/jina-embeddings-v3": { perRun: 0.00023 },
  "replicate/all-mpnet-base-v2": { perRun: 0.00018 },
  // NOTE: several newer curated models have no public price entry yet and
  // resolve to pricing_basis "unknown" (flux-2-max, seedream, grok-video,
  // seedance, minimax-music, gemini-tts, grok-tts, scribe, and all
  // voiceclone/threed/lipsync models). checkBudget no-ops for those and emits
  // a one-time warning per model when a cap is configured (see below).
};

/** Curated short keys → Replicate model id. Built once from the model
 *  registry so the estimator accepts both forms. */
const KEY_TO_MODEL_ID: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const registries = [
    IMAGE_MODELS,
    VIDEO_MODELS,
    AUDIO_MUSIC_MODELS,
    TTS_MODELS,
    LLM_MODELS,
    VISION_MODELS,
    UPSCALE_MODELS,
    BG_REMOVAL_MODELS,
    STT_MODELS,
    INPAINT_MODELS,
    SEGMENT_MODELS,
    EMBED_MODELS,
    VOICE_CLONE_MODELS,
    THREED_MODELS,
    LIPSYNC_MODELS,
  ];
  for (const reg of registries) {
    for (const [key, m] of Object.entries(reg)) {
      map[key] = m.id;
    }
  }
  return map;
})();

export interface CostEstimate {
  resolved_model_id: string;
  num_outputs: number;
  duration_seconds?: number;
  estimated_usd: number;
  pricing_basis: "per_run" | "per_second" | "unknown";
  note: string;
}

/** Best-effort dollar estimate for a planned prediction. Returns `unknown`
 *  basis with `estimated_usd: 0` when the model is not in the price table. */
export function estimateCost(
  model: string,
  numOutputs: number = 1,
  durationSeconds?: number,
): CostEstimate {
  // Strip any ":version" suffix so price lookups work on either form.
  const colon = model.indexOf(":");
  const bareModel = colon >= 0 ? model.slice(0, colon) : model;
  const resolved = KEY_TO_MODEL_ID[bareModel] ?? bareModel;
  const price = COST_BY_MODEL_ID[resolved];

  if (!price) {
    return {
      resolved_model_id: resolved,
      num_outputs: numOutputs,
      duration_seconds: durationSeconds,
      estimated_usd: 0,
      pricing_basis: "unknown",
      note: `No public price on file for ${resolved}. Check https://replicate.com/${resolved} for current pricing.`,
    };
  }

  if (price.perSecond !== undefined) {
    const secs = durationSeconds ?? 1;
    const usd = price.perSecond * secs * numOutputs;
    return {
      resolved_model_id: resolved,
      num_outputs: numOutputs,
      duration_seconds: secs,
      estimated_usd: Number(usd.toFixed(6)),
      pricing_basis: "per_second",
      note:
        (price.note ? `${price.note}. ` : "") +
        `Approximate — actual cost varies with GPU + queue time.`,
    };
  }

  // perRun fallback
  const usd = (price.perRun ?? 0) * numOutputs;
  return {
    resolved_model_id: resolved,
    num_outputs: numOutputs,
    duration_seconds: durationSeconds,
    estimated_usd: Number(usd.toFixed(6)),
    pricing_basis: "per_run",
    note:
      (price.note ? `${price.note}. ` : "") +
      `Approximate — actual cost varies with model parameters.`,
  };
}

/** Tracks models we've already warned about so the unknown-pricing notice
 *  fires at most once per model per process. */
const warnedUnpricedModels = new Set<string>();

/** Throw if the estimated cost of a prediction exceeds the configured cap.
 *  No-op when REPLICATE_MAX_COST_USD is 0 (disabled) or the model is not in
 *  the pricing table (unknown basis means no reliable estimate to enforce).
 *  When a cap IS set but the model has no price, emit a one-time warning so the
 *  silent bypass is visible to operators. */
export function checkBudget(
  model: string,
  numOutputs: number = 1,
  durationSeconds?: number,
): void {
  if (REPLICATE_MAX_COST_USD <= 0) return;
  const estimate = estimateCost(model, numOutputs, durationSeconds);
  if (estimate.pricing_basis === "unknown") {
    if (!warnedUnpricedModels.has(estimate.resolved_model_id)) {
      warnedUnpricedModels.add(estimate.resolved_model_id);
      logger.warn("budget_cap_unenforced_unknown_price", {
        model: estimate.resolved_model_id,
        cap_usd: REPLICATE_MAX_COST_USD,
      });
    }
    return;
  }
  if (estimate.estimated_usd > REPLICATE_MAX_COST_USD) {
    throw new Error(
      `Estimated cost $${estimate.estimated_usd.toFixed(4)} exceeds budget cap ` +
        `$${REPLICATE_MAX_COST_USD.toFixed(4)}. ` +
        `Increase REPLICATE_MAX_COST_USD or set it to 0 to disable the cap.`,
    );
  }
}
