/**
 * Account / cost / model-discovery tools.
 *
 * list_predictions, cancel_prediction, estimate_cost, refresh_models —
 * operations on the Replicate account and curated registry that don't run a
 * generation prediction.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listPredictions,
  cancelPrediction,
  searchModels,
} from "../replicate.js";
import { estimateCost } from "../cost.js";
import { formatError, truncate, type ToolResponse } from "../responses.js";
import { REFRESH_CATEGORY_KEYWORDS } from "../field-maps.js";
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
} from "../models.js";
import {
  ListPredictionsInputSchema,
  CancelPredictionInputSchema,
  EstimateCostInputSchema,
  RefreshModelsInputSchema,
  type ListPredictionsInput,
  type CancelPredictionInput,
  type EstimateCostInput,
  type RefreshModelsInput,
} from "../schemas.js";

const _ALL_REGISTRIES = [
  IMAGE_MODELS, VIDEO_MODELS, AUDIO_MUSIC_MODELS, TTS_MODELS,
  LLM_MODELS, VISION_MODELS, UPSCALE_MODELS, BG_REMOVAL_MODELS,
  STT_MODELS, INPAINT_MODELS, SEGMENT_MODELS, EMBED_MODELS,
  VOICE_CLONE_MODELS, THREED_MODELS, LIPSYNC_MODELS,
];
const CURATED_MODEL_IDS = new Set(
  _ALL_REGISTRIES.flatMap((r) => Object.values(r).map((m) => m.id)),
);

export function registerAccountTools(server: McpServer): void {
/* ---------- Tool: list_predictions ---------- */

server.registerTool(
  "replicate_list_predictions",
  {
    title: "List recent Replicate predictions",
    description: `Return the most recent predictions on the authenticated Replicate account. Useful to recover a prediction ID, audit recent calls, or check what's still running.

Args:
  - limit (1-100, default 10): How many predictions to return.

Returns structuredContent: { count: number, predictions: PredictionSummary[] }
Each PredictionSummary has id, model, status, created_at, completed_at, url.`,
    inputSchema: ListPredictionsInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params: ListPredictionsInput) => {
    try {
      const items = await listPredictions(params.limit);
      const summary =
        items.length === 0
          ? "No predictions found."
          : items
              .map(
                (p, i) =>
                  `${i + 1}. ${p.id}  [${p.status}]  ${p.model ?? "?"}  ${p.created_at ?? ""}`,
              )
              .join("\n");
      return {
        content: [{ type: "text", text: truncate(summary) }],
        structuredContent: { count: items.length, predictions: items },
      };
    } catch (err) {
      return formatError(err);
    }
  },
);

/* ---------- Tool: cancel_prediction ---------- */

server.registerTool(
  "replicate_cancel_prediction",
  {
    title: "Cancel a Replicate prediction",
    description: `Cancel an in-progress prediction by its ID. Useful for long-running async jobs (video, large LLM) when the user no longer needs the result.

Args:
  - prediction_id (string): ID of the prediction to cancel (returned by an earlier generate_* call).

Returns: PredictionSummary with updated status (typically "canceled").`,
    inputSchema: CancelPredictionInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params: CancelPredictionInput) => {
    try {
      const result = await cancelPrediction(params.prediction_id);
      return {
        content: [
          {
            type: "text",
            text: `Prediction ${result.id} → ${result.status}`,
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return formatError(err);
    }
  },
);

/* ---------- Tool: estimate_cost ---------- */

server.registerTool(
  "replicate_estimate_cost",
  {
    title: "Estimate the USD cost of a Replicate prediction",
    description: `Return an approximate dollar-cost estimate for a planned prediction BEFORE running it. Prices are a hand-curated snapshot — actual billing comes from Replicate. Call this when the user asks "how much would X cost" or before launching a costly model.

Args:
  - model: Replicate "owner/name" id or a curated short key (e.g. "flux-schnell", "kling-pro").
  - num_outputs (1-20, optional): How many outputs to estimate. Default 1.
  - duration_seconds (1-600, optional): Required for per-second models (video, music, transcription, LLM).

Returns structuredContent: { resolved_model_id, num_outputs, duration_seconds, estimated_usd, pricing_basis, note }.

Examples:
  - model="flux-schnell", num_outputs=4  → ~$0.012 (4 × $0.003 per_run)
  - model="kling-pro", duration_seconds=5 → ~$0.45 (5 × $0.09 per_second)
  - model="meta/meta-llama-3-70b-instruct", duration_seconds=10 → ~$0.024 (10 × $0.0024 per_second)`,
    inputSchema: EstimateCostInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: EstimateCostInput) => {
    try {
      const estimate = estimateCost(
        params.model,
        params.num_outputs ?? 1,
        params.duration_seconds,
      );
      const lines: string[] = [];
      lines.push(`Model: ${estimate.resolved_model_id}`);
      lines.push(`Outputs: ${estimate.num_outputs}`);
      if (estimate.duration_seconds != null) {
        lines.push(`Duration: ${estimate.duration_seconds}s`);
      }
      lines.push(
        `Estimated cost: $${estimate.estimated_usd.toFixed(4)} (${estimate.pricing_basis})`,
      );
      lines.push("");
      lines.push(estimate.note);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: estimate as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return formatError(err);
    }
  },
);


/* ---------- Tool: refresh_models ---------- */


server.registerTool(
  "replicate_refresh_models",
  {
    title: "Discover New Popular Replicate Models",
    description: `Search Replicate for popular models NOT yet in the curated registry. Returns suggestions only — does not modify code.

Use this to find new models worth adding. Then ask Claude to edit src/models.ts with the ones you want.

Args:
  - categories (string[], optional): Which categories to check. Default: all 15 (image, video, audio, tts, llm, vision, upscale, bg, stt, inpaint, segment, embed, voiceclone, threed, lipsync).
  - min_run_count (integer, optional): Minimum run_count threshold. Default: 1000.
  - limit_per_category (integer, optional): Max suggestions per category (1-20). Default: 5.

Returns structuredContent:
  {
    "checked_at": string,
    "categories_checked": string[],
    "suggestions": [{ category, owner, name, model_id, run_count, description, replicate_url }],
    "already_curated": number,
    "total_suggestions": number
  }

Examples:
  - "Check for new popular models" → all categories, min 1000 runs
  - categories=["image","video"], min_run_count=10000 → only top-tier image/video models`,
    inputSchema: RefreshModelsInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params: RefreshModelsInput): Promise<ToolResponse> => {
    try {
      const targetCategories =
        params.categories ?? Object.keys(REFRESH_CATEGORY_KEYWORDS);
      const minRunCount = params.min_run_count ?? 1000;
      const limitPerCategory = params.limit_per_category ?? 5;

      const curatedIds = CURATED_MODEL_IDS;

      const suggestions: Array<{
        category: string;
        owner: string;
        name: string;
        model_id: string;
        run_count: number;
        description: string;
        replicate_url: string;
      }> = [];
      let alreadyCurated = 0;

      // Fetch phase — run the per-category catalog searches in parallel
      // (bounded) instead of 15 sequential round-trips. Errors per category
      // degrade gracefully to null (skipped below).
      type SearchModels = Awaited<ReturnType<typeof searchModels>>;
      const fetched = new Map<string, SearchModels | null>();
      const cats = targetCategories.filter((c) => REFRESH_CATEGORY_KEYWORDS[c]);
      const FETCH_CONCURRENCY = 5;
      for (let i = 0; i < cats.length; i += FETCH_CONCURRENCY) {
        const slice = cats.slice(i, i + FETCH_CONCURRENCY);
        const settled = await Promise.all(
          slice.map(async (cat) => {
            try {
              return [cat, await searchModels(REFRESH_CATEGORY_KEYWORDS[cat]!)] as const;
            } catch {
              return [cat, null] as const;
            }
          }),
        );
        for (const [cat, models] of settled) fetched.set(cat, models);
      }

      // Diff phase — sequential over the requested order for deterministic output.
      for (const cat of targetCategories) {
        const models = fetched.get(cat);
        if (!models) continue;

        let added = 0;
        for (const m of models) {
          const modelId = `${m.owner}/${m.name}`;
          if (curatedIds.has(modelId)) {
            alreadyCurated++;
            continue;
          }
          const runCount = m.run_count ?? 0;
          if (runCount < minRunCount) continue;
          if (added >= limitPerCategory) break;

          suggestions.push({
            category: cat,
            owner: m.owner,
            name: m.name,
            model_id: modelId,
            run_count: runCount,
            description: m.description ?? "",
            replicate_url: m.url,
          });
          added++;
        }
      }

      const summary =
        suggestions.length === 0
          ? `No new popular models found (min_run_count=${minRunCount}, checked: ${targetCategories.join(", ")}).`
          : `Found ${suggestions.length} suggestion(s) not in registry (${alreadyCurated} already curated):\n\n` +
            suggestions
              .map(
                (s) =>
                  `  ${s.category}: ${s.model_id} — ${s.run_count.toLocaleString()} runs\n    ${s.description}`,
              )
              .join("\n\n");

      const result = {
        checked_at: new Date().toISOString(),
        categories_checked: targetCategories,
        suggestions,
        already_curated: alreadyCurated,
        total_suggestions: suggestions.length,
      };

      return {
        content: [{ type: "text", text: truncate(summary) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return formatError(err);
    }
  },
);
}
