/**
 * Generic / discovery / file tools (no curated category).
 *
 * run_model (arbitrary model escape hatch), search_models, get_model_schema,
 * get_prediction (poll), upload_file (path or base64), recommend_model
 * (advisor). Plus validateModelId used by run_model.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  runPrediction,
  getPredictionResult,
  searchModels,
  getModelSchema,
  uploadFile,
  uploadBase64,
} from "../replicate.js";
import { recommendModels } from "../router.js";
import {
  formatError,
  formatPrediction,
  truncate,
  type ToolResponse,
} from "../responses.js";
import {
  RunModelInputSchema,
  SearchModelsInputSchema,
  GetModelSchemaInputSchema,
  GetPredictionInputSchema,
  UploadFileInputSchema,
  RecommendModelInputSchema,
  type RunModelInput,
  type SearchModelsInput,
  type GetModelSchemaInput,
  type GetPredictionInput,
  type UploadFileInput,
  type RecommendModelInput,
} from "../schemas.js";

/** Reject obviously malformed Replicate model identifiers up-front so the
 *  caller gets a clear error instead of a downstream 422 from Replicate.
 *  Module-scoped (not nested) so it can be unit-tested. */
export function validateModelId(id: string): void {
  // "owner/name" with optional ":version" — same shape parseOwnerName accepts.
  if (!/^[^/:\s]+\/[^/:\s]+(:[^/\s]+)?$/.test(id)) {
    throw new Error(
      `Invalid model id "${id}". Expected "owner/name" or "owner/name:version_hash". For curated shortcuts use one of the specialised tools (e.g. replicate_chat) instead.`,
    );
  }
}

export function registerManagementTools(server: McpServer): void {
/* ---------- Tool: run_model (generic) ---------- */

server.registerTool(
  "replicate_run_model",
  {
    title: "Run Any Replicate Model",
    description: `Generic escape hatch: run ANY model in the Replicate catalog by its "owner/name" identifier. This tool gives Claude access to the entire Replicate model catalog — anything not covered by the curated specialised tools (image, video, audio, speech, chat, vision, upscale, remove-bg) can be reached from here.

DISPLAY REQUIREMENT — if the result includes image URLs, paste ONE of the embed blocks the tool prints (iframe / <img> / markdown — try in order) verbatim in your reply so the image renders inline in the chat.

Use this for any category WITHOUT a curated specialised tool, including but not limited to:
  - Embeddings (sentence-transformers, BGE, Jina)
  - Segmentation (SAM, Segment Anything)
  - Depth estimation (MiDaS, ZoeDepth, Marigold)
  - Inpainting / outpainting (LaMa, Stable Diffusion Inpaint, controlnet-inpaint)
  - ControlNet variants (canny, depth, openpose, normal-map)
  - Face / pose / hand detection (insightface, mediapipe, etc.)
  - 3D generation (TripoSR, Wonder3D, InstantMesh)
  - Audio-to-text / speech recognition (whisper, Distil-Whisper)
  - Audio separation / stem splitting (Demucs, MDX)
  - Style transfer, colourisation, deblurring, denoising
  - Code completion / instruction-tuned code models (CodeLlama, DeepSeek-Coder)
  - Music continuation / source separation
  - ANY newly released model not yet in the curated registries

Workflow:
  1. (Optional) Call replicate_search_models to discover models by keyword (e.g. "image segmentation", "speech to text").
  2. (Recommended) Call replicate_get_model_schema with "owner/name" to inspect required inputs.
  3. Call this tool with the model id and an input object matching that schema.

Args:
  - model (string): "owner/name" (latest official version) or "owner/name:version_hash" (pinned).
  - input (object): Model-specific input parameters.
  - download (boolean, default true): Download outputs locally.
  - timeout_ms: Default 300000.

Returns: PredictionResult.

Examples:
  - Upscale an image:
      model="nightmareai/real-esrgan",
      input={"image": "https://example.com/in.png", "scale": 4}
  - Remove background:
      model="lucataco/remove-bg",
      input={"image": "<url>"}
  - Run an LLM (output is text, not a file, so local_paths will be empty):
      model="meta/meta-llama-3-70b-instruct",
      input={"prompt": "Explain quantum entanglement in two sentences."}`,
    inputSchema: RunModelInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params: RunModelInput) => {
    try {
      validateModelId(params.model);
      const result = await runPrediction({
        model: params.model,
        input: params.input,
        download: params.download,
        timeoutMs: params.timeout_ms,
      });
      return formatPrediction(result);
    } catch (err) {
      return formatError(
        err,
        'Use replicate_get_model_schema first to verify the input shape, or replicate_search_models to find the right model.',
      );
    }
  },
);


/* ---------- Tool: search_models ---------- */

server.registerTool(
  "replicate_search_models",
  {
    title: "Search Replicate Model Catalog",
    description: `Search the Replicate catalog by free-text query. Returns up to 25 matching models with names, descriptions, and URLs.

Args:
  - query (string, 1-200 chars): Free-text search. Examples: "image upscaler", "voice cloning", "depth estimation", "code generation".

Returns structuredContent:
  {
    "count": number,
    "models": [
      {
        "owner": string,
        "name": string,
        "description": string | undefined,
        "url": string,
        "run_count": number | undefined,
        "cover_image_url": string | undefined
      }
    ]
  }

Tip: Once you find a promising model, call replicate_get_model_schema with "owner/name" to see its inputs before calling replicate_run_model.`,
    inputSchema: SearchModelsInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params: SearchModelsInput) => {
    try {
      const models = await searchModels(params.query);
      const summary =
        models.length === 0
          ? `No models found for "${params.query}".`
          : `Found ${models.length} models for "${params.query}":\n\n` +
            models
              .map(
                (m, i) =>
                  `${i + 1}. ${m.owner}/${m.name}\n   ${m.description ?? "(no description)"}\n   ${m.url}`,
              )
              .join("\n\n");
      return {
        content: [{ type: "text", text: truncate(summary) }],
        structuredContent: { count: models.length, models },
      };
    } catch (err) {
      return formatError(err);
    }
  },
);

/* ---------- Tool: get_model_schema ---------- */

server.registerTool(
  "replicate_get_model_schema",
  {
    title: "Get Replicate Model Input Schema",
    description: `Retrieve metadata and the OpenAPI input/output schema for a specific Replicate model. Use this before replicate_run_model to know which fields the model accepts and what they mean.

Args:
  - model (string): "owner/name" or "owner/name:version".

Returns structuredContent:
  {
    "model": string,
    "description": string | undefined,
    "visibility": string | undefined,
    "latest_version_id": string | undefined,
    "input_schema": object | undefined,   // OpenAPI schema for inputs
    "output_schema": object | undefined,  // OpenAPI schema for outputs
    "example_url": string | undefined     // Replicate page with examples
  }`,
    inputSchema: GetModelSchemaInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params: GetModelSchemaInput) => {
    try {
      const schema = await getModelSchema(params.model);
      const text =
        `Model: ${schema.model}\n` +
        (schema.description ? `Description: ${schema.description}\n` : "") +
        (schema.visibility ? `Visibility: ${schema.visibility}\n` : "") +
        (schema.latest_version_id
          ? `Latest version: ${schema.latest_version_id}\n`
          : "") +
        (schema.example_url ? `Page: ${schema.example_url}\n` : "") +
        `\nInput schema:\n${JSON.stringify(schema.input_schema, null, 2)}`;
      return {
        content: [{ type: "text", text: truncate(text) }],
        structuredContent: schema as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return formatError(err);
    }
  },
);

/* ---------- Tool: get_prediction ---------- */

server.registerTool(
  "replicate_get_prediction",
  {
    title: "Get Replicate Prediction Status",
    description: `Retrieve the current status and (if available) outputs of a Replicate prediction by its ID. Use this when a previous generate_* or run_model call returned pending=true (timed out before completion).

Args:
  - prediction_id (string): The ID returned by a previous call.
  - download (boolean, default true): If the prediction has succeeded, download its outputs locally.

Returns: PredictionResult — same shape as replicate_generate_image. If still running, status will be "processing" or "starting" and pending will be true.

Typical flow:
  1. Call replicate_generate_video → returns pending=true with prediction_id=abc123.
  2. Wait ~1 minute.
  3. Call replicate_get_prediction with prediction_id=abc123 → returns succeeded + URLs + local_paths.`,
    inputSchema: GetPredictionInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params: GetPredictionInput) => {
    try {
      const result = await getPredictionResult({
        predictionId: params.prediction_id,
        download: params.download,
      });
      return formatPrediction(result);
    } catch (err) {
      return formatError(err);
    }
  },
);

/* ---------- Tool: upload_file ---------- */

server.registerTool(
  "replicate_upload_file",
  {
    title: "Upload a file (path or base64) to Replicate",
    description: `Upload a file to Replicate's file storage and get back a URL valid for ~24 hours. Pass the returned URL as a model input (e.g. image for upscale/inpaint/vision, image_url for video, reference_audio_url for voice clone).

Two input modes — provide EXACTLY ONE:
  - file_path: absolute local path of a file on the machine running the server.
  - base64_data: the file's bytes as base64 (a bare base64 string OR a full "data:<mime>;base64,..." URI). Use this when you hold bytes in memory but have no local path — e.g. an image a user dropped into the chat that a code container can read and base64-encode. NOTE: an MCP client (Claude Desktop) generally cannot reproduce a large dragged-in image's exact bytes as a tool argument — base64 mode is for callers that genuinely have the bytes (web container, programmatic clients).

Args:
  - file_path (string, optional): Absolute local path. Provide this OR base64_data.
  - base64_data (string, optional): base64 contents or data: URI. Provide this OR file_path.
  - mime_type (string, optional): MIME override (e.g. 'image/png'). Auto-detected from the path extension or a data: URI; defaults to application/octet-stream for raw base64.
  - file_name (string, optional): Name for a base64 upload.

Returns structuredContent: { url, file_id, name }
  - url: Replicate-hosted URL (~24h expiry) — pass this as a model input.

Examples:
  - file_path="C:/Users/me/photo.png"
  - base64_data="data:image/png;base64,iVBORw0KG...", → uploads, returns URL`,
    inputSchema: UploadFileInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params: UploadFileInput) => {
    try {
      if (
        (params.file_path == null) === (params.base64_data == null)
      ) {
        throw new Error(
          "Provide exactly one of file_path or base64_data.",
        );
      }
      const result = params.base64_data
        ? await uploadBase64({
            data: params.base64_data,
            mimeType: params.mime_type,
            fileName: params.file_name,
          })
        : await uploadFile(params.file_path!, params.mime_type);
      return {
        content: [
          {
            type: "text",
            text: `Uploaded: ${result.url}\nFile ID: ${result.file_id}\nName: ${result.name}`,
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return formatError(
        err,
        "Provide exactly one of file_path (absolute, readable) or base64_data (valid base64 / data: URI).",
      );
    }
  },
);

/* ---------- Tool: recommend_model ---------- */

server.registerTool(
  "replicate_recommend_model",
  {
    title: "Recommend the Best Model for a Task",
    description: `Rank the curated models in a category by a priority (speed, cost, quality, or balanced) and return recommendations with cost estimates and reasoning. This does NOT run anything — it advises which model to use.

Workflow: call this to pick a model, then call the matching generate tool (e.g. replicate_generate_image) with model set to the recommended key.

Args:
  - category (required): One of image, video, audio, tts, llm, vision, upscale, bg, stt, inpaint, segment, embed, voiceclone, threed, lipsync.
  - priority (default "balanced"): "speed" (fastest), "cost" (cheapest), "quality" (best), or "balanced" (weighted).
  - task_description (optional): Free text. Keyword hints like "quick draft" or "professional logo" nudge balanced ranking.
  - max_cost_usd (optional): Exclude models estimated above this cost.
  - duration_seconds (optional, 1–600): For per-second-priced categories (video, audio), used in cost estimation.

Returns structuredContent:
  {
    category, priority,
    recommendations: [{ key, model_id, speed, est_cost_usd, score, reason }],  // top 5
    count
  }

Examples:
  - category="image", priority="speed" → flux-schnell first
  - category="image", priority="quality" → highest-fidelity model first
  - category="video", priority="cost", duration_seconds=5 → cheapest per-5s clip`,
    inputSchema: RecommendModelInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: RecommendModelInput): Promise<ToolResponse> => {
    try {
      const recommendations = recommendModels({
        category: params.category,
        priority: params.priority ?? "balanced",
        taskDescription: params.task_description,
        maxCostUsd: params.max_cost_usd,
        durationSeconds: params.duration_seconds,
      });

      const summary =
        recommendations.length === 0
          ? `No models found for category "${params.category}".`
          : `Top ${recommendations.length} ${params.category} models for priority "${params.priority ?? "balanced"}":\n\n` +
            recommendations
              .map(
                (r, i) =>
                  `${i + 1}. ${r.key} (${r.model_id})\n   ${r.reason} · score ${r.score}`,
              )
              .join("\n");

      return {
        content: [{ type: "text", text: truncate(summary) }],
        structuredContent: {
          category: params.category,
          priority: params.priority ?? "balanced",
          recommendations,
          count: recommendations.length,
        },
      };
    } catch (err) {
      return formatError(err);
    }
  },
);
}
