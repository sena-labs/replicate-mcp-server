/**
 * Shared generation-handler factory.
 *
 * The curated generation tools (image, video, audio, speech, chat, vision,
 * upscale, bg, stt, inpaint, segment, embed, voiceclone, threed, lipsync) all
 * follow the same resolve→budget→merge→run→format pipeline. `makeGenerationHandler`
 * encapsulates it; each tool only declares how its category-specific input
 * fields map onto the Replicate request body.
 */

import { resolveModel, getDefaultInput, type ModelCategory } from "./models.js";
import { runPrediction } from "./replicate.js";
import { checkBudget } from "./cost.js";
import { POLL_INTERVAL_BY_CATEGORY } from "./constants.js";
import { formatPrediction, formatError, type ToolResponse } from "./responses.js";

/** Merge user-provided extras over our defaults for a curated model.
 *  User keys always win. */
export function mergeInput(
  category: ModelCategory,
  modelKey: string,
  prompt: Record<string, unknown>,
  extras: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...getDefaultInput(category, modelKey),
    ...prompt,
    ...(extras ?? {}),
  };
}

/** Common shape every specialised generation handler input must satisfy. */
export type GenerationHandlerInput = {
  model: string;
  download: boolean;
  timeout_ms?: number | undefined;
  extra_input?: Record<string, unknown> | undefined;
};

/** Extract num_outputs from params if present (image tool only). */
export function getNumOutputs(params: unknown): number {
  if (typeof params === "object" && params !== null && "num_outputs" in params) {
    const n = (params as { num_outputs?: unknown }).num_outputs;
    if (typeof n === "number" && n > 0) return n;
  }
  return 1;
}

/** Extract duration_seconds from params if present (video / audio tools).
 *  Needed so the pre-flight budget check estimates per-second-priced models
 *  at their real duration instead of a 1-second floor. */
export function getDurationSeconds(params: unknown): number | undefined {
  if (
    typeof params === "object" &&
    params !== null &&
    "duration_seconds" in params
  ) {
    const n = (params as { duration_seconds?: unknown }).duration_seconds;
    if (typeof n === "number" && n > 0) return n;
  }
  return undefined;
}

/** Build a tool handler for a curated category. Encapsulates the shared
 *  resolve→merge→run→format pipeline. */
export function makeGenerationHandler<TInput extends GenerationHandlerInput>(opts: {
  category: ModelCategory;
  buildPromptInput: (params: TInput) => Record<string, unknown>;
  errorHint?: string;
}) {
  const maxPollIntervalMs = POLL_INTERVAL_BY_CATEGORY[opts.category];
  return async (params: TInput): Promise<ToolResponse> => {
    try {
      const modelKey = params.model;
      const modelId = resolveModel(opts.category, modelKey);
      // Pre-flight cost check — throws if estimated cost > configured cap.
      try {
        checkBudget(modelId, getNumOutputs(params), getDurationSeconds(params));
      } catch (budgetErr) {
        return formatError(budgetErr);
      }
      const promptInput = opts.buildPromptInput(params);
      const input = mergeInput(
        opts.category,
        modelKey,
        promptInput,
        params.extra_input,
      );
      const result = await runPrediction({
        model: modelId,
        input,
        download: params.download,
        timeoutMs: params.timeout_ms,
        maxPollIntervalMs,
      });
      return formatPrediction(result);
    } catch (err) {
      return formatError(err, opts.errorHint);
    }
  };
}
