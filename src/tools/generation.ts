/**
 * Curated single-prediction generation tools.
 *
 * The twelve text/image/audio/video tools that share the makeGenerationHandler
 * pipeline: image, video, audio, speech, chat, vision, upscale,
 * remove_background, transcribe_audio, inpaint, segment, embed_text.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toCuratedKey } from "../models.js";
import { makeGenerationHandler } from "../handler-factory.js";
import {
  AUDIO_PROMPT_FIELD,
  AUDIO_NO_DURATION,
  VIDEO_IMAGE_INPUT_FIELD,
} from "../field-maps.js";
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
} from "../schemas.js";

export function registerGenerationTools(server: McpServer): void {
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
}
