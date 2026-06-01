#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseServerArgs } from "./args.js";
import { startHttpTransport } from "./http-server.js";
import { startWebhookReceiver } from "./webhook.js";
import { mkdir, access, constants as fsConstants } from "node:fs/promises";
import {
  SERVER_NAME,
  SERVER_VERSION,
  DEFAULT_DOWNLOAD_DIR,
  MIN_HTTP_API_KEY_LENGTH,
} from "./constants.js";
import {
  toCuratedKey,
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
import {
  ListPredictionsInputSchema,
  CancelPredictionInputSchema,
  EstimateCostInputSchema,
  RunModelInputSchema,
  SearchModelsInputSchema,
  GetModelSchemaInputSchema,
  GetPredictionInputSchema,
  UploadFileInputSchema,
  CloneVoiceInputSchema,
  Generate3DInputSchema,
  LipsyncInputSchema,
  RefreshModelsInputSchema,
  RecommendModelInputSchema,
  type RecommendModelInput,
  type RefreshModelsInput,
  type ListPredictionsInput,
  type CancelPredictionInput,
  type EstimateCostInput,
  type RunModelInput,
  type SearchModelsInput,
  type GetModelSchemaInput,
  type GetPredictionInput,
  type UploadFileInput,
  type CloneVoiceInput,
  type Generate3DInput,
  type LipsyncInput,
} from "./schemas.js";
import {
  runPrediction,
  getPredictionResult,
  searchModels,
  getModelSchema,
  listPredictions,
  cancelPrediction,
  uploadFile,
  uploadBase64,
  getPoolSize,
} from "./replicate.js";
import { estimateCost } from "./cost.js";
import { webhookEnabled } from "./webhook.js";
import { logger } from "./logger.js";
import { startGC } from "./batch.js";
import { startPipelineGC } from "./pipeline.js";
import { recommendModels } from "./router.js";
import { registerGenerationTools } from "./tools/generation.js";
import { registerOrchestrationTools } from "./tools/orchestration.js";
import {
  formatError,
  formatPrediction,
  truncate,
  type ToolResponse,
} from "./responses.js";
import { makeGenerationHandler } from "./handler-factory.js";
import {
  VOICE_CLONE_REF_FIELD,
  VOICE_CLONE_TEXT_FIELD,
  THREED_IMAGE_FIELD,
  LIPSYNC_IMAGE_FIELD,
  LIPSYNC_TEXT_FIELD,
  LIPSYNC_AUDIO_FIELD,
  LIPSYNC_NO_TEXT,
  REFRESH_CATEGORY_KEYWORDS,
} from "./field-maps.js";

/* ---------- Server setup ---------- */

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

/* ---------- Tools: curated single-prediction generation ---------- */

registerGenerationTools(server);

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
      idempotentHint: false,
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

/* ---------- Tool: clone_voice ---------- */


server.registerTool(
  "replicate_clone_voice",
  {
    title: "Clone a voice with Replicate",
    description: `Synthesize speech in a cloned voice. Provide a short reference audio sample (~5-30 s) and the text to speak; the model reproduces the voice characteristics.

DISPLAY REQUIREMENT — after this tool returns successfully, include the URL printed in the tool's text content as a markdown link \`[Audio](URL)\` so the user can play it. URLs expire in ~24h.

Args:
  - text (string, 1-5000): Text to synthesize in the cloned voice.
  - reference_audio_url (URL): URL of the voice sample to clone from. Use replicate_upload_file to upload a local file first.
  - language (string, optional): ISO-639 code (e.g. "en", "es", "it"). Default "en".
  - model (string, default "xtts-v2"): Curated key (${Object.keys(VOICE_CLONE_MODELS).join(", ")}) or "owner/name[:version]".
  - extra_input (object, optional): Model-specific extras.
  - download (boolean, default true).
  - timeout_ms: Default 300000.

Returns: PredictionResult. local_paths contain WAV/MP3 files.

Examples:
  - text="Hello world, this is my cloned voice.", reference_audio_url="<url-to-your-voice-sample.wav>"
  - text="Buongiorno a tutti!", reference_audio_url="<url>", language="it"`,
    inputSchema: CloneVoiceInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<CloneVoiceInput>({
    category: "voiceclone",
    buildPromptInput: (p) => {
      const key = toCuratedKey("voiceclone", p.model);
      const textField = VOICE_CLONE_TEXT_FIELD[key] ?? "text";
      const refField = VOICE_CLONE_REF_FIELD[key] ?? "speaker_wav";
      const input: Record<string, unknown> = {
        [textField]: p.text,
        [refField]: p.reference_audio_url,
      };
      if (p.language) input["language"] = p.language;
      return input;
    },
  }),
);

/* ---------- Tool: generate_3d ---------- */


server.registerTool(
  "replicate_generate_3d",
  {
    title: "Generate a 3D model with Replicate",
    description: `Generate a 3D mesh (GLB/OBJ) from a text prompt or a reference image. 3D generation is slow — typically 1-5 minutes.

DISPLAY REQUIREMENT — after this tool returns successfully, include the download URL(s) so the user can open the 3D file. URLs expire in ~24h.

Args:
  - prompt (string, optional): Text description of the 3D object. Provide at least one of prompt or image_url.
  - image_url (URL, optional): Reference image to convert to 3D. Provide at least one of prompt or image_url. Use replicate_upload_file for local files.
  - model (string, default "hunyuan-3d"): Curated key (${Object.keys(THREED_MODELS).join(", ")}) or "owner/name[:version]".
  - extra_input (object, optional): Model-specific extras (e.g. {num_inference_steps: 50}).
  - download (boolean, default true): Download the GLB/OBJ locally.
  - timeout_ms: Default 300000. For complex objects, increase or use the pending+poll flow.

Returns: PredictionResult. local_paths will contain .glb or .obj files.

Examples:
  - prompt="A red ceramic teapot" → hunyuan-3d
  - image_url="<product-photo>", model="triposr" → fast single-image 3D
  - image_url="<photo>", model="rodin" → high-quality 3D`,
    inputSchema: Generate3DInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<Generate3DInput>({
    category: "threed",
    buildPromptInput: (p) => {
      if (!p.prompt && !p.image_url) {
        throw new Error("Provide at least one of prompt or image_url.");
      }
      const key = toCuratedKey("threed", p.model);
      const imageField = THREED_IMAGE_FIELD[key] ?? "image";
      const input: Record<string, unknown> = {};
      if (p.prompt) input["prompt"] = p.prompt;
      if (p.image_url) input[imageField] = p.image_url;
      return input;
    },
  }),
);

/* ---------- Tool: lipsync ---------- */


server.registerTool(
  "replicate_lipsync",
  {
    title: "Lipsync / talking avatar with Replicate",
    description: `Animate a portrait image to speak — either from a text script (model does TTS + lipsync) or from a driving audio file. Produces an MP4 video.

DISPLAY REQUIREMENT — after this tool returns successfully, include the URL(s) so the user can open the video. URLs expire in ~24h.

Args:
  - image_url (URL): Portrait or face image to animate. Use replicate_upload_file for local files.
  - text (string, optional): Script for the avatar to speak. Used by video-avatar (maps to voice_script). At least one of text or audio_url is required.
  - audio_url (URL, optional): Driving audio for lipsync. Required for sadtalker; optional override for video-avatar. At least one of text or audio_url is required.
  - model (string, default "video-avatar"): Curated key (${Object.keys(LIPSYNC_MODELS).join(", ")}) or "owner/name[:version]".
  - extra_input (object, optional): Model-specific extras (e.g. {voice_prompt: "speak slowly"} for video-avatar).
  - download (boolean, default true): Download the MP4 locally.
  - timeout_ms: Default 300000.

Returns: PredictionResult. local_paths contain .mp4 files.

Examples:
  - image_url="<portrait.jpg>", text="Hello! Welcome to our product demo." → video-avatar (TTS + lipsync)
  - image_url="<face.jpg>", audio_url="<speech.wav>", model="sadtalker" → audio-driven lipsync`,
    inputSchema: LipsyncInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<LipsyncInput>({
    category: "lipsync",
    buildPromptInput: (p) => {
      if (!p.text && !p.audio_url) {
        throw new Error("Provide at least one of text or audio_url.");
      }
      const key = toCuratedKey("lipsync", p.model);
      const imageField = LIPSYNC_IMAGE_FIELD[key] ?? "image";
      const input: Record<string, unknown> = { [imageField]: p.image_url };
      if (p.text && !LIPSYNC_NO_TEXT.has(key)) {
        const textField = LIPSYNC_TEXT_FIELD[key] ?? "text";
        input[textField] = p.text;
      }
      if (p.audio_url) {
        const audioField = LIPSYNC_AUDIO_FIELD[key] ?? "audio";
        input[audioField] = p.audio_url;
      }
      return input;
    },
  }),
);

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

/** Reject obviously malformed Replicate model identifiers up-front so the
 *  caller gets a clear error instead of a downstream 422 from Replicate. */
function validateModelId(id: string): void {
  // "owner/name" with optional ":version" — same shape parseOwnerName accepts.
  if (!/^[^/:\s]+\/[^/:\s]+(:[^/\s]+)?$/.test(id)) {
    throw new Error(
      `Invalid model id "${id}". Expected "owner/name" or "owner/name:version_hash". For curated shortcuts use one of the specialised tools (e.g. replicate_chat) instead.`,
    );
  }
}

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

/* ---------- Tools: batch + pipeline orchestration ---------- */

registerOrchestrationTools(server);

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

      // Build flat set of all curated model IDs for O(1) diff lookup.
      const allRegistries = [
        IMAGE_MODELS, VIDEO_MODELS, AUDIO_MUSIC_MODELS, TTS_MODELS,
        LLM_MODELS, VISION_MODELS, UPSCALE_MODELS, BG_REMOVAL_MODELS,
        STT_MODELS, INPAINT_MODELS, SEGMENT_MODELS, EMBED_MODELS,
        VOICE_CLONE_MODELS, THREED_MODELS, LIPSYNC_MODELS,
      ];
      const curatedIds = new Set(
        allRegistries.flatMap((r) => Object.values(r).map((m) => m.id)),
      );

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

/* ---------- Run ---------- */

async function main(): Promise<void> {
  const args = parseServerArgs();

  // --list-models: print curated registry and exit (no server needed).
  if (args.listModels) {
    const categories: Array<[string, Record<string, { id: string; description: string; speed: string }>]> = [
      ["image", IMAGE_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["video", VIDEO_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["audio", AUDIO_MUSIC_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["tts", TTS_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["llm", LLM_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["vision", VISION_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["upscale", UPSCALE_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["bg", BG_REMOVAL_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["stt", STT_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["inpaint", INPAINT_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["segment", SEGMENT_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["embed", EMBED_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["voiceclone", VOICE_CLONE_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["threed", THREED_MODELS as Record<string, { id: string; description: string; speed: string }>],
      ["lipsync", LIPSYNC_MODELS as Record<string, { id: string; description: string; speed: string }>],
    ];
    for (const [cat, models] of categories) {
      console.log(`\n=== ${cat} ===`);
      for (const [key, m] of Object.entries(models)) {
        console.log(
          `  ${key.padEnd(22)}  ${m.id.padEnd(48)}  [${m.speed}]  ${m.description}`,
        );
      }
    }
    process.exit(0);
  }

  const tokenPresent = Boolean(
    process.env["REPLICATE_API_TOKEN"] ||
      process.env["REPLICATE_API_TOKEN_POOL"],
  );

  // Pre-create the download directory and verify it's writable so users get
  // a clear error at startup rather than a confusing failure mid-prediction.
  try {
    await mkdir(DEFAULT_DOWNLOAD_DIR, { recursive: true });
    await access(DEFAULT_DOWNLOAD_DIR, fsConstants.W_OK);
  } catch (err) {
    logger.warn("download_dir_not_writable", {
      dir: DEFAULT_DOWNLOAD_DIR,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  startGC();
  startPipelineGC();

  // Optional webhook receiver — when REPLICATE_WEBHOOK_PUBLIC_URL is set
  // we run a small HTTP listener so Replicate can POST completed
  // predictions instead of us polling.
  const webhookPublicUrl = process.env["REPLICATE_WEBHOOK_PUBLIC_URL"];
  const webhookPort = args.webhookPort ?? Number(process.env["REPLICATE_WEBHOOK_PORT"] ?? 0);
  if (webhookPublicUrl && webhookPort > 0) {
    await startWebhookReceiver(args.webhookHost, webhookPort, webhookPublicUrl);
  }

  if (args.transport === "http") {
    const rawApiKey =
      args.httpApiKey ??
      (process.env["HTTP_API_KEY"] && process.env["HTTP_API_KEY"].length > 0
        ? process.env["HTTP_API_KEY"]
        : undefined);
    // Enforce min-length on the env-var path (CLI path is already validated
    // by parseServerArgs).
    if (
      rawApiKey !== undefined &&
      rawApiKey.length < MIN_HTTP_API_KEY_LENGTH
    ) {
      throw new Error(
        `HTTP API key is too short (minimum ${MIN_HTTP_API_KEY_LENGTH} characters). Set a stronger HTTP_API_KEY.`,
      );
    }
    await startHttpTransport({
      server,
      port: args.httpPort,
      host: args.httpHost,
      apiKey: rawApiKey,
      statusCallback: () => ({
        webhook_enabled: webhookEnabled(),
        token_pool_size: getPoolSize(),
      }),
    });
    logger.info("server_ready", {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      transport: "http",
      token_present: tokenPresent,
    });
    // Graceful shutdown — drain in-flight requests then exit cleanly.
    process.once("SIGTERM", () => {
      logger.info("sigterm_received");
      process.exit(0);
    });
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Boot banner stays human-readable on stderr alongside structured logs.
  console.error(
    `${SERVER_NAME} v${SERVER_VERSION} ready (stdio). ${
      tokenPresent
        ? "API token detected."
        : "WARNING: no Replicate token configured — calls will fail."
    }`,
  );
  logger.info("server_ready", {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    transport: "stdio",
    token_present: tokenPresent,
  });
}

main().catch((err) => {
  logger.error("fatal_server_error", {
    message: err instanceof Error ? err.message : String(err),
  });
  console.error("Fatal server error:", err);
  process.exit(1);
});
