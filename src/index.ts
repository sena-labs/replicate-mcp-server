#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseServerArgs } from "./args.js";
import { startHttpTransport } from "./http-server.js";
import { startWebhookReceiver } from "./webhook.js";
import { readFile, mkdir, access, constants as fsConstants } from "node:fs/promises";
import { extname } from "node:path";
import {
  SERVER_NAME,
  SERVER_VERSION,
  CHARACTER_LIMIT,
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_IMAGES_TOTAL_BYTES,
  DEFAULT_DOWNLOAD_DIR,
  POLL_INTERVAL_BY_CATEGORY,
  MIN_HTTP_API_KEY_LENGTH,
} from "./constants.js";
import {
  buildIframeEmbed,
  buildImgEmbed,
  buildMarkdownEmbed,
  IMAGE_MIME_BY_EXT,
} from "./embed.js";
import {
  resolveModel,
  getDefaultInput,
  toCuratedKey,
  type ModelCategory,
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
  GenerateImageInputSchema,
  GenerateVideoInputSchema,
  GenerateAudioInputSchema,
  GenerateSpeechInputSchema,
  ChatInputSchema,
  VisionInputSchema,
  UpscaleInputSchema,
  RemoveBgInputSchema,
  TranscribeAudioInputSchema,
  InpaintInputSchema,
  SegmentInputSchema,
  EmbedTextInputSchema,
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
  BatchStartInputSchema,
  BatchStatusInputSchema,
  PipelineStartInputSchema,
  PipelineStatusInputSchema,
  RecommendModelInputSchema,
  type BatchStartInput,
  type BatchStatusInput,
  type PipelineStartInput,
  type PipelineStatusInput,
  type RecommendModelInput,
  type RefreshModelsInput,
  type GenerateImageInput,
  type GenerateVideoInput,
  type GenerateAudioInput,
  type GenerateSpeechInput,
  type ChatInput,
  type VisionInput,
  type UpscaleInput,
  type RemoveBgInput,
  type TranscribeAudioInput,
  type InpaintInput,
  type SegmentInput,
  type EmbedTextInput,
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
  type PredictionResult,
} from "./replicate.js";
import { estimateCost, checkBudget } from "./cost.js";
import { webhookEnabled } from "./webhook.js";
import { logger } from "./logger.js";
import { createBatchJob, getBatchJob, startGC } from "./batch.js";
import { createPipeline, getPipeline, startPipelineGC } from "./pipeline.js";
import { recommendModels } from "./router.js";

/* ---------- Server setup ---------- */

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

/* ---------- Shared helpers ---------- */

type McpTextContent = { type: "text"; text: string };
type McpImageContent = { type: "image"; data: string; mimeType: string };
type McpContent = McpTextContent | McpImageContent;
type ToolResponse = {
  content: McpContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function buildInlineImageContent(
  localPaths: string[],
): Promise<McpImageContent[]> {
  // Read all files in parallel; multi-output generations (num_outputs > 1)
  // would otherwise serialise disk I/O on what is naturally an async I/O
  // bound batch.
  const settled = await Promise.all(
    localPaths.map((p) => readOneInlineImage(p)),
  );
  const candidates = settled.filter((x): x is McpImageContent => x !== null);
  // Enforce an aggregate cap so multi-output predictions can't push
  // tens of MB of base64 over a single stdio frame. Inline what fits;
  // surplus images still surface via local_paths + URL embed.
  const accepted: McpImageContent[] = [];
  let total = 0;
  for (const img of candidates) {
    const size = img.data.length;
    if (total + size > MAX_INLINE_IMAGES_TOTAL_BYTES) break;
    accepted.push(img);
    total += size;
  }
  return accepted;
}

async function readOneInlineImage(
  path: string,
): Promise<McpImageContent | null> {
  const mimeType = IMAGE_MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mimeType) return null;
  try {
    const buf = await readFile(path);
    if (buf.length === 0 || buf.length > MAX_INLINE_IMAGE_BYTES) return null;
    return { type: "image", data: buf.toString("base64"), mimeType };
  } catch {
    // Unreadable file (deleted, permission denied, etc.) — URL still
    // surfaces via the caption text, so failure here is non-fatal.
    return null;
  }
}

async function formatPrediction(result: PredictionResult): Promise<ToolResponse> {
  const structured = result as unknown as Record<string, unknown>;
  const images =
    result.status === "succeeded" && result.local_paths.length > 0
      ? await buildInlineImageContent(result.local_paths)
      : [];

  const content: McpContent[] = [];

  // Text-only predictions (LLM, vision, classifier) — surface the model's
  // reply as the primary content; no inline image and no embed scaffolding.
  if (
    images.length === 0 &&
    result.urls.length === 0 &&
    result.text_output &&
    result.text_output.length > 0
  ) {
    content.push({
      type: "text",
      text: truncate(renderTextOutput(result)),
    });
  } else if (images.length > 0) {
    // Visual prediction with an inline image — lead with the image, follow
    // with the embed caption. Full details remain in structuredContent.
    content.push(...images);
    content.push({ type: "text", text: renderSuccessCaption(result) });
  } else {
    content.push({ type: "text", text: truncate(renderFullSummary(result)) });
  }

  return {
    content,
    structuredContent: structured,
    isError: result.status === "failed",
  };
}

/** For LLM / vision / classifier predictions: show the model's reply as the
 *  main payload, with a one-line meta footer. */
function renderTextOutput(r: PredictionResult): string {
  const lines: string[] = [];
  const texts = r.text_output ?? [];
  // First element of text_output is the joined whole when streaming was
  // detected (multiple short segments). Prefer it when present.
  const primary = texts[0] ?? "";
  lines.push(primary);
  lines.push("");
  lines.push("---");
  const meta: string[] = [r.model];
  if (r.metrics?.predict_time_seconds != null) {
    meta.push(`${r.metrics.predict_time_seconds.toFixed(2)}s`);
  }
  lines.push(`Model: ${meta.join(" · ")}`);
  return lines.join("\n");
}

function renderSuccessCaption(r: PredictionResult): string {
  const meta: string[] = [r.model];
  if (r.metrics?.predict_time_seconds != null) {
    meta.push(`${r.metrics.predict_time_seconds.toFixed(2)}s`);
  }
  if (r.local_paths.length > 1) {
    meta.push(`${r.local_paths.length} outputs`);
  }
  const lines: string[] = [];
  lines.push(`Generated — ${meta.join(" · ")}`);
  // Surface Replicate-hosted URLs (expire ~24h) so the assistant can echo
  // them back in the chat. Three formats are provided so the chat UI can
  // pick the most powerful one it supports:
  //   1. HTML <iframe srcdoc=...> — sizes the image to the chat column
  //      width with the image's native aspect ratio (best UX when allowed).
  //   2. HTML <img> with responsive CSS — fallback when iframe is blocked.
  //   3. Markdown image — guaranteed to render in any markdown chat UI.
  if (r.urls.length > 0) {
    lines.push("");
    lines.push(
      r.urls.length === 1
        ? `Image URL: ${r.urls[0]}`
        : "Image URLs:\n" + r.urls.map((u) => `  - ${u}`).join("\n"),
    );
    lines.push("");
    lines.push(
      "To display the image inline in your reply, paste ONE of the following blocks verbatim (try them in order — use the first that renders in the chat UI):",
    );
    lines.push("");
    lines.push("--- Option 1: HTML iframe (responsive, native aspect ratio) ---");
    for (const u of r.urls) lines.push(buildIframeEmbed(u));
    lines.push("");
    lines.push("--- Option 2: HTML <img> (responsive fallback) ---");
    for (const u of r.urls) lines.push(buildImgEmbed(u));
    lines.push("");
    lines.push("--- Option 3: Markdown image (universal fallback) ---");
    for (const u of r.urls) lines.push(buildMarkdownEmbed(u));
  }
  return lines.join("\n");
}

function renderFullSummary(r: PredictionResult): string {
  const lines: string[] = [];
  lines.push(`Status: ${r.status}`);
  lines.push(`Prediction ID: ${r.prediction_id}`);
  lines.push(`Model: ${r.model}`);
  if (r.metrics?.predict_time_seconds != null) {
    lines.push(`Predict time: ${r.metrics.predict_time_seconds.toFixed(2)}s`);
  }
  if (r.pending) {
    lines.push(
      "Prediction did not finish within the timeout. Use replicate_get_prediction with the prediction ID above to retrieve the result later.",
    );
  }
  if (r.error) {
    lines.push(`Error: ${r.error}`);
  }
  if (r.urls.length > 0) {
    lines.push("");
    lines.push("Output URLs (expire ~24h):");
    for (const u of r.urls) lines.push(`  - ${u}`);
  }
  if (r.local_paths.length > 0) {
    lines.push("");
    lines.push("Downloaded files:");
    for (const p of r.local_paths) lines.push(`  - ${p}`);
  }
  if (r.logs_excerpt) {
    lines.push("");
    lines.push("Logs (tail):");
    lines.push(r.logs_excerpt);
  }
  return lines.join("\n");
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n[Response truncated at ${CHARACTER_LIMIT} chars. Full output available in structuredContent.]`
  );
}

function formatError(err: unknown, hint?: string): ToolResponse {
  let message: string;
  if (err instanceof z.ZodError) {
    message =
      "Invalid input:\n" +
      err.errors.map((e) => `  - ${e.path.join(".")}: ${e.message}`).join("\n");
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  if (hint) message += `\n\nHint: ${hint}`;
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/** Merge user-provided extras over our defaults for a curated model.
 *  User keys always win. */
function mergeInput(
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
type GenerationHandlerInput = {
  model: string;
  download: boolean;
  timeout_ms?: number | undefined;
  extra_input?: Record<string, unknown> | undefined;
};

/** Build a tool handler for a curated category. Encapsulates the shared
 *  resolve→merge→run→format pipeline, leaving each category to declare only
 *  how it maps its category-specific input fields into the Replicate
 *  request body. */
/** Extract num_outputs from params if present (image tool only). */
function getNumOutputs(params: unknown): number {
  if (typeof params === "object" && params !== null && "num_outputs" in params) {
    const n = (params as { num_outputs?: unknown }).num_outputs;
    if (typeof n === "number" && n > 0) return n;
  }
  return 1;
}

/** Extract duration_seconds from params if present (video / audio tools).
 *  Needed so the pre-flight budget check estimates per-second-priced models
 *  at their real duration instead of a 1-second floor. */
function getDurationSeconds(params: unknown): number | undefined {
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

function makeGenerationHandler<TInput extends GenerationHandlerInput>(opts: {
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

/* ---------- Tool: generate_image ---------- */

server.registerTool(
  "replicate_generate_image",
  {
    title: "Generate Image with Replicate",
    description: `Generate one or more images from a text prompt using a Replicate image model.

Use this for any "draw / create / generate an image of …" request. By default it uses Flux Schnell (fast, ~2 seconds per image).

DISPLAY REQUIREMENT — after this tool returns successfully, you MUST embed the image inline in your reply by pasting ONE of the three embed blocks the tool prints verbatim (Option 1 iframe, Option 2 <img>, or Option 3 markdown — try them in that order; pick the first one your chat client renders). The iframe variant scales to the chat column width with the image's native aspect ratio; the <img> variant is a responsive fallback; markdown is the universal last resort. Place the chosen embed BEFORE any descriptive prose. Do NOT paraphrase the URL or omit the embed — the user wants the image to appear in the main chat flow, not only inside the collapsed tool widget. URLs expire in ~24h.

Args:
  - prompt (string): Text description of the image to generate.
  - model (string, default "flux-schnell"): Either a curated key (flux-schnell, flux-dev, flux-pro, flux-2-max, sd-3.5-large, recraft-v3, recraft-v4.1, ideogram-v2, imagen-3, seedream) or a full Replicate identifier "owner/name[:version]".
  - aspect_ratio ("1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9" | "3:2" | "2:3", optional): Aspect ratio. Default 1:1.
  - num_outputs (1-4, optional): How many images to generate.
  - seed (integer, optional): Random seed for reproducible output.
  - extra_input (object, optional): Model-specific extra inputs (e.g. {guidance: 3.5, num_inference_steps: 28}). Use replicate_get_model_schema if unsure.
  - download (boolean, default true): Download files locally to ~/Downloads/replicate-mcp/.
  - timeout_ms (5000-1800000, optional): Max wait. Default 300000 (5min).

Returns structuredContent matching PredictionResult:
  {
    "status": "starting" | "processing" | "succeeded" | "failed" | "canceled",
    "prediction_id": string,
    "model": string,
    "urls": string[],          // Replicate URLs (expire ~24h)
    "local_paths": string[],   // Absolute paths on disk when download=true
    "metrics": { "predict_time_seconds": number } | undefined,
    "error": string | undefined,
    "pending": boolean | undefined  // true if timed out — poll via replicate_get_prediction
  }

Examples:
  - "An origami fox in a misty forest" → uses flux-schnell, 1:1
  - prompt="logo for a coffee shop called Crema", model="recraft-v3" → for text-in-image
  - prompt="cinematic shot of a lighthouse", model="flux-pro", aspect_ratio="21:9", seed=42

Error handling:
  - If REPLICATE_API_TOKEN is missing, returns an actionable error telling the user how to set it.
  - Invalid model IDs return Replicate's error message verbatim.`,
    inputSchema: GenerateImageInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<GenerateImageInput>({
    category: "image",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = { prompt: p.prompt };
      if (p.aspect_ratio) input["aspect_ratio"] = p.aspect_ratio;
      if (p.num_outputs) input["num_outputs"] = p.num_outputs;
      if (p.seed != null) input["seed"] = p.seed;
      return input;
    },
    errorHint: "Verify REPLICATE_API_TOKEN is set and the model ID is correct.",
  }),
);

/** Per-model prompt field name for audio generation.
 *  musicgen uses "prompt"; ace-step uses "tags"; riffusion uses "prompt_a". */
const AUDIO_PROMPT_FIELD: Record<string, string> = {
  "ace-step": "tags",
  "riffusion": "prompt_a",
};

/** Models whose API has no duration parameter — don't send it. */
const AUDIO_NO_DURATION = new Set(["riffusion"]);

/** Per-model field name for the starting image in image-to-video requests.
 *  Models use different field names — a single "start_image" default breaks
 *  models that expect "image" or "first_frame_image". */
const VIDEO_IMAGE_INPUT_FIELD: Record<string, string> = {
  "kling-pro": "start_image",
  "minimax-video": "first_frame_image",
  "luma-ray": "image",
  "wan-2.2": "image",
  "grok-video": "image",
  "seedance": "image",
};

/* ---------- Tool: generate_video ---------- */

server.registerTool(
  "replicate_generate_video",
  {
    title: "Generate Video with Replicate",
    description: `Generate a video clip from a text prompt (and optionally a starting image). Video generation is slow — typically 1-5 minutes per clip.

DISPLAY REQUIREMENT — after this tool returns successfully, include the URL(s) printed in the tool's text content so the user can open the video. URLs expire in ~24h.

Args:
  - prompt (string): Text description of the video.
  - model (string, default "kling-pro"): Curated key (kling-pro, minimax-video, hunyuan-video, luma-ray, wan-2.2, grok-video, seedance) or "owner/name[:version]".
  - image_url (string, optional): Starting frame for image-to-video. Not all models support this.
  - duration_seconds (1-60, optional): Desired duration. Model-dependent.
  - aspect_ratio ("16:9" | "9:16" | "1:1", optional): Aspect ratio.
  - extra_input (object, optional): Additional model-specific inputs.
  - download (boolean, default true): Download the MP4 locally.
  - timeout_ms: Max wait. Default 300000 (5min). For very long videos, increase or rely on the pending+poll flow.

Returns: PredictionResult (see replicate_generate_image for shape). The local_paths will contain .mp4 files when downloaded.

Tip: If timeout_ms is exceeded, the result will have pending=true and a prediction_id. Wait a minute, then call replicate_get_prediction.`,
    inputSchema: GenerateVideoInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<GenerateVideoInput>({
    category: "video",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = { prompt: p.prompt };
      if (p.image_url) {
        // Different video models use different field names for the start frame.
        const key = toCuratedKey("video", p.model);
        const field = VIDEO_IMAGE_INPUT_FIELD[key] ?? "start_image";
        input[field] = p.image_url;
      }
      if (p.duration_seconds) input["duration"] = p.duration_seconds;
      if (p.aspect_ratio) input["aspect_ratio"] = p.aspect_ratio;
      return input;
    },
  }),
);

/* ---------- Tool: generate_audio ---------- */

server.registerTool(
  "replicate_generate_audio",
  {
    title: "Generate Music or Audio with Replicate",
    description: `Generate music, ambient audio, or full songs from a text prompt.

DISPLAY REQUIREMENT — after this tool returns successfully, include the URL(s) printed in the tool's text content as a markdown link \`[Audio](URL)\` in your reply so the user can play it. URLs expire in ~24h.

Models:
  - "musicgen" (default): Meta MusicGen. Instrumental music up to 30s. prompt → "prompt" field.
  - "ace-step": Full songs with lyrics. prompt → "tags" field (style/genre tags). Pass lyrics separately via extra_input.lyrics. ~3-4 minutes runtime.
  - "riffusion": Loop-friendly ambient/electronic. prompt → "prompt_a" field. No duration control.
  - "minimax-music": MiniMax Music 2.6. Full songs up to 6min. prompt=style description; pass lyrics via extra_input.lyrics.

Args:
  - prompt (string): Description of the music. For ace-step this maps to the "tags" field (style tags like "rock, guitar, upbeat"). For riffusion this maps to "prompt_a".
  - model (string, default "musicgen"): Curated key or "owner/name[:version]".
  - duration_seconds (1-300, optional): Duration in seconds. Supported by musicgen and ace-step. Ignored for riffusion.
  - extra_input (object, optional): Additional inputs. Examples: {temperature: 1.0, top_k: 250} for MusicGen; {lyrics: "verse lyrics here"} for ace-step.
  - download (boolean, default true): Download as MP3/WAV.
  - timeout_ms: Default 300000 (5min).

Returns: PredictionResult. local_paths contain audio files.

Examples:
  - prompt="upbeat synthwave with driving bassline", duration_seconds=15 → musicgen
  - prompt="indie folk, acoustic guitar, female vocals", model="ace-step", extra_input={lyrics: "Leaving home on a rainy day..."}
  - prompt="ambient lo-fi chill", model="riffusion"`,
    inputSchema: GenerateAudioInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<GenerateAudioInput>({
    category: "audio",
    buildPromptInput: (p) => {
      // Normalise to the curated key so field maps work even when the caller
      // passes a full "owner/name" id instead of the short key.
      const key = toCuratedKey("audio", p.model);
      const promptField = AUDIO_PROMPT_FIELD[key] ?? "prompt";
      const input: Record<string, unknown> = { [promptField]: p.prompt };
      if (p.duration_seconds != null && !AUDIO_NO_DURATION.has(key)) {
        input["duration"] = p.duration_seconds;
      }
      return input;
    },
  }),
);

/* ---------- Tool: generate_speech ---------- */

server.registerTool(
  "replicate_generate_speech",
  {
    title: "Generate Speech (TTS) with Replicate",
    description: `Convert text to natural-sounding speech.

DISPLAY REQUIREMENT — after this tool returns successfully, include the URL printed in the tool's text content as a markdown link \`[Speech](URL)\` in your reply so the user can play it. URLs expire in ~24h.

Args:
  - text (string, 1-5000): Text to synthesize.
  - model (string, default "kokoro"): Curated key (kokoro, minimax-speech, chatterbox, gemini-tts, grok-tts) or "owner/name[:version]".
  - voice (string, optional): Voice ID. For Kokoro: af_bella, af_sarah, am_adam, am_michael, bf_emma, bf_isabella, etc. (a-f = American female, b-f = British female, a-m = American male, b-m = British male).
  - speed (0.5-2.0, optional): Speech rate.
  - extra_input (object, optional): Model-specific extras (e.g. {audio_prompt: "<url>"} for voice cloning with Chatterbox).
  - download (boolean, default true).
  - timeout_ms: Default 300000.

Returns: PredictionResult. local_paths contain WAV/MP3 files.`,
    inputSchema: GenerateSpeechInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<GenerateSpeechInput>({
    category: "tts",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = { text: p.text };
      if (p.voice) input["voice"] = p.voice;
      if (p.speed != null) input["speed"] = p.speed;
      return input;
    },
  }),
);

/* ---------- Tool: chat (LLM) ---------- */

server.registerTool(
  "replicate_chat",
  {
    title: "Chat with an LLM via Replicate",
    description: `Run a large language model hosted on Replicate. Use this for free-form text generation, Q&A, code writing, summarisation, translation — anything where the input is text and the output is text.

Args:
  - prompt (string): User message.
  - model (string, default "llama-3-70b"): Curated key (llama-3.1-405b, llama-3-70b, llama-3-8b, mistral-7b, mixtral-8x7b, deepseek-r1) or "owner/name".
  - system_prompt (string, optional): Persona / instructions.
  - max_tokens (1-8192, optional): Generation limit.
  - temperature (0-2, optional): Sampling temperature.
  - extra_input (object, optional): Model-specific extras (top_p, top_k, frequency_penalty, etc.).
  - download (boolean, default false): No file outputs; leave false.
  - timeout_ms (5000-1800000, optional): Default 300000.

Returns: PredictionResult with text_output[0] containing the model's reply (later entries are raw streamed segments if applicable).

Examples:
  - prompt="Explain quantum entanglement in two sentences.", model="llama-3-70b"
  - prompt="Write a Python function to compute Levenshtein distance.", model="mistral-large", system_prompt="You are an expert software engineer."`,
    inputSchema: ChatInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<ChatInput>({
    category: "llm",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = { prompt: p.prompt };
      if (p.system_prompt) input["system_prompt"] = p.system_prompt;
      if (p.max_tokens != null) input["max_tokens"] = p.max_tokens;
      if (p.temperature != null) input["temperature"] = p.temperature;
      return input;
    },
  }),
);

/* ---------- Tool: vision (image understanding) ---------- */

server.registerTool(
  "replicate_vision",
  {
    title: "Analyse / caption an image with a vision model",
    description: `Run a vision-language model to describe, caption, or answer questions about an image.

Args:
  - image (string URL): URL of the image to analyse.
  - prompt (string, optional): Question or instruction (e.g. "describe this image", "count the people"). Default is a generic caption.
  - model (string, default "llava-13b"): Curated key (llava-13b, llava-v1.6-34b, blip-2, qwen-vl) or "owner/name".
  - max_tokens (1-4096, optional): Response length.
  - extra_input (object, optional): Model-specific extras.

Returns: PredictionResult with text_output containing the model's textual answer.

Examples:
  - image="https://example.com/photo.jpg", prompt="What objects are visible?"
  - image="<chart-url>", prompt="Read the values off this chart and list them.", model="llava-v1.6-34b"`,
    inputSchema: VisionInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<VisionInput>({
    category: "vision",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = { image: p.image };
      if (p.prompt) input["prompt"] = p.prompt;
      if (p.max_tokens != null) input["max_tokens"] = p.max_tokens;
      return input;
    },
  }),
);

/* ---------- Tool: upscale_image ---------- */

server.registerTool(
  "replicate_upscale_image",
  {
    title: "Upscale / restore an image with Replicate",
    description: `Upscale an image to higher resolution. Optional face restoration for photos.

DISPLAY REQUIREMENT — after this tool returns successfully, embed the upscaled image inline using one of the three blocks (iframe / <img> / markdown) printed by the tool. Place it BEFORE descriptive prose. URLs expire ~24h.

Args:
  - image (string URL): URL of the source image.
  - model (string, default "real-esrgan"): Curated key (real-esrgan, clarity-upscaler, swinir, gfpgan) or "owner/name".
  - scale (1-10, optional): Upscale factor. Default 4 for real-esrgan; 2 for gfpgan; 2 for clarity-upscaler.
  - extra_input (object, optional): Model-specific extras (e.g. {face_enhance: true} for real-esrgan).
  - download (boolean, default true): Download upscaled file locally.

Returns: PredictionResult with urls + local_paths to the upscaled image.

Examples:
  - image="<low-res-photo>", scale=4 → real-esrgan
  - image="<face-photo>", model="gfpgan", scale=2 → restoration
  - image="<artwork>", model="clarity-upscaler", scale=2`,
    inputSchema: UpscaleInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<UpscaleInput>({
    category: "upscale",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = { image: p.image };
      if (p.scale != null) input["scale"] = p.scale;
      return input;
    },
  }),
);

/* ---------- Tool: remove_background ---------- */

server.registerTool(
  "replicate_remove_background",
  {
    title: "Remove the background from an image",
    description: `Produce a transparent-background version (PNG) of an image.

DISPLAY REQUIREMENT — after this tool returns successfully, embed the cut-out image inline using one of the three blocks (iframe / <img> / markdown) printed by the tool.

Args:
  - image (string URL): URL of the source image.
  - model (string, default "rembg"): Curated key (rembg, birefnet, briaai-rmbg) or "owner/name".
  - extra_input (object, optional): Model-specific extras.
  - download (boolean, default true): Download the cut-out PNG locally.

Returns: PredictionResult with urls + local_paths to a transparent PNG.

Examples:
  - image="<product-photo>" → rembg quick cut
  - image="<portrait>", model="birefnet" → sharper edge for hair`,
    inputSchema: RemoveBgInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<RemoveBgInput>({
    category: "bg",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = { image: p.image };
      return input;
    },
  }),
);

/* ---------- Tool: transcribe_audio (speech-to-text) ---------- */

server.registerTool(
  "replicate_transcribe_audio",
  {
    title: "Transcribe Audio / Video with Whisper",
    description: `Transcribe an audio or video file to text using Whisper-family models on Replicate.

Args:
  - audio (URL): URL of the audio (or video) to transcribe.
  - model (default "incredibly-fast-whisper"): Curated key (whisper, incredibly-fast-whisper, whisperx, scribe) or "owner/name".
  - language (string, optional): ISO-639 hint (e.g. "en", "it"). Default: auto-detect.
  - translate_to_english (bool, optional): Translate the transcript to English instead of preserving source language.
  - extra_input (object, optional): Model-specific extras (e.g. {batch_size: 24} for incredibly-fast-whisper).

Returns: PredictionResult with text_output containing the transcript.`,
    inputSchema: TranscribeAudioInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<TranscribeAudioInput>({
    category: "stt",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = { audio: p.audio };
      if (p.language) input["language"] = p.language;
      if (p.translate_to_english) input["translate"] = true;
      return input;
    },
  }),
);

/* ---------- Tool: inpaint ---------- */

server.registerTool(
  "replicate_inpaint",
  {
    title: "Inpaint / outpaint an image with a mask",
    description: `Fill masked regions of an image based on a text prompt. Works for both inpainting (replace inside) and outpainting (extend canvas) when the mask covers the target area.

DISPLAY REQUIREMENT — embed the result inline using one of the three blocks (iframe / <img> / markdown) printed by the tool.

Args:
  - image (URL): Source image.
  - mask (URL): Mask image. White = keep, black/transparent = repaint.
  - prompt: Describes what should appear in the masked region.
  - model (default "flux-fill-pro"): Curated (flux-fill-pro, sd-inpaint, ideogram-v2-edit) or "owner/name".
  - extra_input (object, optional): Model-specific extras (e.g. {guidance: 30} for flux-fill-pro).`,
    inputSchema: InpaintInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<InpaintInput>({
    category: "inpaint",
    buildPromptInput: (p) => ({
      image: p.image,
      mask: p.mask,
      prompt: p.prompt,
    }),
  }),
);

/* ---------- Tool: segment ---------- */

server.registerTool(
  "replicate_segment",
  {
    title: "Segment an image (SAM 2 / Grounded-SAM)",
    description: `Produce a segmentation mask of an image. Use SAM 2 for point/box-prompt masks (auto-mask everything when no prompt given) or Grounded-SAM for text-prompt masking like "the red car".

DISPLAY REQUIREMENT — embed the mask result inline using one of the three blocks printed by the tool.

Args:
  - image (URL): Source image.
  - prompt (string, optional): Text prompt for grounded segmentation. Required for grounded-sam.
  - model (default "sam-2"): Curated (sam-2, grounded-sam) or "owner/name".
  - extra_input (object, optional): SAM-specific tuning (e.g. {points_per_side: 32}).`,
    inputSchema: SegmentInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<SegmentInput>({
    category: "segment",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = { image: p.image };
      if (p.prompt) input["prompt"] = p.prompt;
      return input;
    },
  }),
);

/* ---------- Tool: embed_text ---------- */

server.registerTool(
  "replicate_embed_text",
  {
    title: "Compute text embeddings",
    description: `Convert text(s) into numeric embedding vectors. Useful for RAG, semantic search, clustering, similarity scoring.

Args:
  - texts: A single string or an array of strings (max 256). Each text is embedded independently.
  - model (default "bge-large"): Curated (bge-large, jina-embeddings-v3, all-minilm) or "owner/name".
  - extra_input (object, optional): Model-specific extras (e.g. {task: "retrieval.query"} for jina v3).

Returns: PredictionResult — the embedding vectors are in structuredContent.output (model-specific shape).`,
    inputSchema: EmbedTextInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  makeGenerationHandler<EmbedTextInput>({
    category: "embed",
    buildPromptInput: (p) => {
      const input: Record<string, unknown> = {};
      // BGE / jina accept "texts" (array) or "text" (single string).
      input[Array.isArray(p.texts) ? "texts" : "text"] = p.texts;
      return input;
    },
  }),
);

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

/** Per-model field name for the reference audio URL in voice cloning. */
const VOICE_CLONE_REF_FIELD: Record<string, string> = {
  "xtts-v2": "speaker_wav",
  "openvoice-v2": "reference_speaker",
};

/** Per-model field name for the text input in voice cloning. */
const VOICE_CLONE_TEXT_FIELD: Record<string, string> = {
  "openvoice-v2": "input_text",
};

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

/** Per-model field name for the image input in 3D generation. */
const THREED_IMAGE_FIELD: Record<string, string> = {
  "rodin": "input_image_url",
};

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

/** Per-model field name for the portrait image in lipsync. */
const LIPSYNC_IMAGE_FIELD: Record<string, string> = {
  "sadtalker": "source_image",
};

/** Per-model field name for the text script in lipsync. */
const LIPSYNC_TEXT_FIELD: Record<string, string> = {
  "video-avatar": "voice_script",
};

/** Per-model field name for the driving audio in lipsync. */
const LIPSYNC_AUDIO_FIELD: Record<string, string> = {
  "sadtalker": "driven_audio",
};

/** Models that do not support text input (audio-only lipsync). */
const LIPSYNC_NO_TEXT = new Set(["sadtalker"]);

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

/* ---------- Tool: pipeline_start ---------- */

server.registerTool(
  "replicate_pipeline_start",
  {
    title: "Start Async Pipeline (DAG of predictions)",
    description: `Run a directed acyclic graph (DAG) of Replicate predictions as a background job. Returns a pipeline_id immediately. Poll replicate_pipeline_status for per-step progress and results.

Independent steps run concurrently. Downstream steps auto-start when their dependencies complete. Use "$stepId.field[n]" template strings to pass one step's output as another step's input.

IMPORTANT: model must be a full Replicate identifier ("owner/name" or "owner/name:version"). Curated shortcuts (e.g. "flux-schnell") are not supported — look up the full id via replicate_get_model_schema.

Template reference syntax:
  "$gen.urls[0]"          → first URL output of step "gen"
  "$gen.urls"             → full URLs array
  "$gen.local_paths[0]"   → first downloaded local path
  "$gen.text_output[0]"   → first text output (for LLMs)

Args:
  - steps (array, 1–20): Pipeline steps. Each: { id, model, input, depends_on? }.
    depends_on is inferred from $ref patterns in input when omitted.
  - concurrency (1–5, default 3): Max simultaneous steps.
  - download (boolean, default true): Download step outputs locally.
  - timeout_ms_per_step (default 300000): Per-step timeout.
  - ttl_hours (1–72, default 1): How long to keep results in memory. Lost on server restart.

Returns: { pipeline_id, total, message }

Example — generate + upscale + remove background in parallel:
  steps=[
    { "id": "gen", "model": "black-forest-labs/flux-schnell", "input": { "prompt": "a fox" } },
    { "id": "upscale", "model": "nightmareai/real-esrgan", "input": { "image": "$gen.urls[0]", "scale": 4 } },
    { "id": "no_bg", "model": "lucataco/remove-bg", "input": { "image": "$gen.urls[0]" } }
  ]
  upscale and no_bg both depend on gen, run in parallel after gen completes.`,
    inputSchema: PipelineStartInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params: PipelineStartInput): Promise<ToolResponse> => {
    try {
      const result = createPipeline({
        steps: params.steps,
        concurrency: params.concurrency ?? 3,
        download: params.download,
        timeoutMsPerStep: params.timeout_ms_per_step ?? 300_000,
        ttlHours: params.ttl_hours ?? 1,
      });

      if ("error" in result) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          structuredContent: { error: result.error },
          isError: true,
        };
      }

      const msg = `Pipeline of ${result.total} steps started (pipeline_id: ${result.pipeline_id}). Poll replicate_pipeline_status to check progress.`;
      return {
        content: [{ type: "text", text: msg }],
        structuredContent: {
          pipeline_id: result.pipeline_id,
          total: result.total,
          message: msg,
        },
      };
    } catch (err) {
      return formatError(err);
    }
  },
);

/* ---------- Tool: pipeline_status ---------- */

server.registerTool(
  "replicate_pipeline_status",
  {
    title: "Get Pipeline Status",
    description: `Poll the status of a pipeline started with replicate_pipeline_start.

Args:
  - pipeline_id (string): Pipeline ID returned by replicate_pipeline_start.
  - include_outputs (boolean, default true): Include full PredictionResult per step. Set false for a counts-only summary while the pipeline is running.

Returns structuredContent:
  {
    pipeline_id, overall_status, total, succeeded, failed, skipped, running, pending,
    created_at, expires_at,
    steps: [{ id, model, status, prediction_id, result?, error?, skip_reason?, started_at, completed_at }]
  }

overall_status:
  "running"   — steps still executing
  "completed" — all steps succeeded
  "partial"   — all done, at least one failed or was skipped (failed dependency or budget error)

Note: pipeline-level errors (cycle detected, unknown depends_on) are rejected at replicate_pipeline_start with an error response — they never produce a pollable pipeline.

Tip: Poll every 10–30 seconds until overall_status is "completed" or "partial".`,
    inputSchema: PipelineStatusInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: PipelineStatusInput): Promise<ToolResponse> => {
    const pipeline = getPipeline(params.pipeline_id);
    if (!pipeline) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Pipeline "${params.pipeline_id}" not found or expired. State is in-memory — it may have been lost if the server restarted, or the TTL elapsed.`,
          },
        ],
        structuredContent: { error: "Pipeline not found or expired", pipeline_id: params.pipeline_id },
        isError: true,
      };
    }

    const includeOutputs = params.include_outputs ?? true;
    const steps = includeOutputs
      ? pipeline.steps
      : pipeline.steps.map((s) => ({
          id: s.id,
          model: s.model,
          status: s.status,
          prediction_id: s.prediction_id,
          error: s.error,
          skip_reason: s.skip_reason,
          started_at: s.started_at,
          completed_at: s.completed_at,
        }));

    const summary =
      `Pipeline ${pipeline.pipeline_id} — ${pipeline.overall_status}\n` +
      `${pipeline.succeeded}/${pipeline.total} succeeded, ${pipeline.failed} failed, ` +
      `${pipeline.skipped} skipped, ${pipeline.running} running, ${pipeline.pending} pending`;

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: {
        pipeline_id: pipeline.pipeline_id,
        overall_status: pipeline.overall_status,
        total: pipeline.total,
        succeeded: pipeline.succeeded,
        failed: pipeline.failed,
        skipped: pipeline.skipped,
        running: pipeline.running,
        pending: pipeline.pending,
        created_at: pipeline.created_at,
        expires_at: pipeline.expires_at,
        steps,
      },
    };
  },
);

/* ---------- Tool: batch_start ---------- */

server.registerTool(
  "replicate_batch_start",
  {
    title: "Start Async Batch Predictions",
    description: `Run multiple Replicate predictions in parallel as a background job. Returns a job_id immediately — the predictions run in the background. Poll replicate_batch_status for progress and results.

Use this when you have 2–50 predictions to run and don't want to block. Each item specifies its own model and input, so you can mix models in one batch.

IMPORTANT: model must be a full Replicate identifier ("owner/name" or "owner/name:version"), not a curated shortcut like "flux-schnell". Use replicate_get_model_schema to look up the correct identifier.

Args:
  - items (array, 1–50): Predictions to run. Each: { model: "owner/name[:version]", input: {...} }.
  - concurrency (1–10, default 3): Max simultaneous predictions. Raise with caution — Replicate rate-limits free accounts.
  - download (boolean, default true): Download output files locally.
  - timeout_ms_per_item (default 300000): Per-prediction timeout. Timed-out items have pending=true in their result.
  - ttl_hours (1–72, default 1): How long to keep results in memory. Job state is lost if the MCP server restarts.

Returns: { job_id, total, message }

Example:
  items=[
    { model: "black-forest-labs/flux-schnell", input: { prompt: "a red fox" } },
    { model: "black-forest-labs/flux-schnell", input: { prompt: "a blue whale" } },
  ]
  → Returns { job_id: "abc-123", total: 2, message: "..." }
  → Then poll: replicate_batch_status({ job_id: "abc-123" })`,
    inputSchema: BatchStartInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params: BatchStartInput): Promise<ToolResponse> => {
    try {
      const job = createBatchJob({
        items: params.items,
        concurrency: params.concurrency ?? 3,
        download: params.download,
        timeoutMsPerItem: params.timeout_ms_per_item ?? 300_000,
        ttlHours: params.ttl_hours ?? 1,
      });
      const msg = `Batch of ${job.total} started (job_id: ${job.job_id}). Poll replicate_batch_status to check progress and retrieve results.`;
      return {
        content: [{ type: "text", text: msg }],
        structuredContent: {
          job_id: job.job_id,
          total: job.total,
          message: msg,
        },
      };
    } catch (err) {
      return formatError(err);
    }
  },
);

/* ---------- Tool: batch_status ---------- */

server.registerTool(
  "replicate_batch_status",
  {
    title: "Get Batch Job Status",
    description: `Poll the status of an async batch job started with replicate_batch_start.

Args:
  - job_id (string): Job ID returned by replicate_batch_start.
  - include_results (boolean, default true): Include full PredictionResult per item. Set false for a counts-only summary while the job is still running.

Returns structuredContent:
  {
    job_id, overall_status, total, succeeded, failed, running, pending,
    created_at, expires_at,
    items: [{ index, model, status, prediction_id, result?, error?, started_at, completed_at }]
  }

overall_status:
  "running"   — predictions still in progress
  "completed" — all items succeeded
  "partial"   — all done, at least one failed

Tip: Poll every 10–30 seconds until overall_status is "completed" or "partial".`,
    inputSchema: BatchStatusInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: BatchStatusInput): Promise<ToolResponse> => {
    const job = getBatchJob(params.job_id);
    if (!job) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Job "${params.job_id}" not found or expired. Job state is in-memory — it may have been lost if the server restarted, or the TTL elapsed.`,
          },
        ],
        structuredContent: { error: "Job not found or expired", job_id: params.job_id },
        isError: true,
      };
    }

    const includeResults = params.include_results ?? true;
    const items = includeResults
      ? job.items
      : job.items.map((item) => ({
          index: item.index,
          model: item.model,
          status: item.status,
          prediction_id: item.prediction_id,
          error: item.error,
          started_at: item.started_at,
          completed_at: item.completed_at,
        }));

    const summary =
      `Job ${job.job_id} — ${job.overall_status}\n` +
      `${job.succeeded}/${job.total} succeeded, ${job.failed} failed, ` +
      `${job.running} running, ${job.pending} pending`;

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: {
        job_id: job.job_id,
        overall_status: job.overall_status,
        total: job.total,
        succeeded: job.succeeded,
        failed: job.failed,
        running: job.running,
        pending: job.pending,
        created_at: job.created_at,
        expires_at: job.expires_at,
        items,
      },
    };
  },
);

/* ---------- Tool: refresh_models ---------- */

/** Maps each curated category to a Replicate search keyword. */
const REFRESH_CATEGORY_KEYWORDS: Record<string, string> = {
  image: "image generation",
  video: "video generation",
  audio: "music generation",
  tts: "text to speech",
  llm: "language model",
  vision: "image captioning",
  upscale: "image upscaling",
  bg: "background removal",
  stt: "speech recognition",
  inpaint: "inpainting",
  segment: "image segmentation",
  embed: "text embeddings",
  voiceclone: "voice cloning",
  threed: "3d generation",
  lipsync: "lip sync",
};

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
