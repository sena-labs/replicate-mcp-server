import { z } from "zod";
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
import { MAX_TIMEOUT_MS } from "./constants.js";

const imageKeys = Object.keys(IMAGE_MODELS) as [string, ...string[]];
const videoKeys = Object.keys(VIDEO_MODELS) as [string, ...string[]];
const audioKeys = Object.keys(AUDIO_MUSIC_MODELS) as [string, ...string[]];
const ttsKeys = Object.keys(TTS_MODELS) as [string, ...string[]];
const llmKeys = Object.keys(LLM_MODELS) as [string, ...string[]];
const visionKeys = Object.keys(VISION_MODELS) as [string, ...string[]];
const upscaleKeys = Object.keys(UPSCALE_MODELS) as [string, ...string[]];
const bgKeys = Object.keys(BG_REMOVAL_MODELS) as [string, ...string[]];
const sttKeys = Object.keys(STT_MODELS) as [string, ...string[]];
const inpaintKeys = Object.keys(INPAINT_MODELS) as [string, ...string[]];
const segmentKeys = Object.keys(SEGMENT_MODELS) as [string, ...string[]];
const embedKeys = Object.keys(EMBED_MODELS) as [string, ...string[]];
const voicecloneKeys = Object.keys(VOICE_CLONE_MODELS) as [string, ...string[]];
const threedKeys = Object.keys(THREED_MODELS) as [string, ...string[]];
const lipsyncKeys = Object.keys(LIPSYNC_MODELS) as [string, ...string[]];

/** Common shape for the timeout knob across async-capable tools. */
const timeoutMs = z
  .number()
  .int()
  .min(5_000)
  .max(MAX_TIMEOUT_MS)
  .optional()
  .describe(
    "Max ms to wait for the prediction. If exceeded, returns the prediction ID so you can poll via replicate_get_prediction. Default: 300000 (5min).",
  );

const download = z
  .boolean()
  .default(true)
  .describe(
    "Whether to download the generated files locally. Default true. When false, only Replicate URLs are returned (URLs expire after ~24h).",
  );

/* ---------- Specialized: image ---------- */

export const GenerateImageInputSchema = z
  .object({
    prompt: z
      .string()
      .min(1, "Prompt cannot be empty")
      .max(2000)
      .describe("Text prompt describing the image to generate."),
    model: z
      .union([z.enum(imageKeys), z.string()])
      .default("flux-schnell")
      .describe(
        `Either a curated key (${imageKeys.join(", ")}) or a Replicate identifier like "owner/name" or "owner/name:version".`,
      ),
    aspect_ratio: z
      .enum(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "3:2", "2:3"])
      .optional()
      .describe("Aspect ratio. Supported by Flux models. Default 1:1."),
    num_outputs: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe("Number of images to generate (1-4)."),
    seed: z
      .number()
      .int()
      .optional()
      .describe("Random seed for reproducible outputs."),
    extra_input: z
      .record(z.unknown())
      .optional()
      .describe(
        "Additional model-specific inputs merged into the request (e.g. {guidance: 3.5}). Use replicate_get_model_schema to see what a model accepts.",
      ),
    download,
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Specialized: video ---------- */

export const GenerateVideoInputSchema = z
  .object({
    prompt: z
      .string()
      .min(1)
      .max(2000)
      .describe("Text prompt describing the video."),
    model: z
      .union([z.enum(videoKeys), z.string()])
      .default("kling-pro")
      .describe(
        `Either a curated key (${videoKeys.join(", ")}) or a Replicate identifier.`,
      ),
    image_url: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional starting image URL for image-to-video. Not all models support this — check model schema.",
      ),
    duration_seconds: z
      .number()
      .min(1)
      .max(60)
      .optional()
      .describe("Desired duration in seconds. Model-dependent."),
    aspect_ratio: z
      .enum(["16:9", "9:16", "1:1"])
      .optional()
      .describe("Aspect ratio."),
    extra_input: z
      .record(z.unknown())
      .optional()
      .describe("Additional model-specific inputs."),
    download,
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Specialized: audio/music ---------- */

export const GenerateAudioInputSchema = z
  .object({
    prompt: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        "Description of the music/audio. For songs with lyrics (ace-step), include the lyrics here.",
      ),
    model: z
      .union([z.enum(audioKeys), z.string()])
      .default("musicgen")
      .describe(
        `Either a curated key (${audioKeys.join(", ")}) or a Replicate identifier.`,
      ),
    duration_seconds: z
      .number()
      .min(1)
      .max(300)
      .optional()
      .describe("Duration in seconds. Model-dependent."),
    extra_input: z
      .record(z.unknown())
      .optional()
      .describe("Additional model-specific inputs."),
    download,
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Specialized: TTS ---------- */

export const GenerateSpeechInputSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(5000)
      .describe("Text to synthesize."),
    model: z
      .union([z.enum(ttsKeys), z.string()])
      .default("kokoro")
      .describe(
        `Either a curated key (${ttsKeys.join(", ")}) or a Replicate identifier.`,
      ),
    voice: z
      .string()
      .optional()
      .describe(
        "Voice identifier. Kokoro examples: af_bella, am_adam, bf_emma. Check model docs for full list.",
      ),
    speed: z
      .number()
      .min(0.5)
      .max(2.0)
      .optional()
      .describe("Speech speed multiplier (0.5-2.0)."),
    extra_input: z
      .record(z.unknown())
      .optional()
      .describe("Additional model-specific inputs."),
    download,
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- LLM / chat ---------- */

export const ChatInputSchema = z
  .object({
    prompt: z
      .string()
      .min(1)
      .max(50_000)
      .describe("User message / prompt for the LLM."),
    model: z
      .union([z.enum(llmKeys), z.string()])
      .default("llama-3-70b")
      .describe(
        `LLM identifier. Curated keys: ${llmKeys.join(", ")}. Or full Replicate "owner/name[:version]".`,
      ),
    system_prompt: z
      .string()
      .max(10_000)
      .optional()
      .describe("Optional system prompt to set persona / instructions."),
    max_tokens: z
      .number()
      .int()
      .min(1)
      .max(8192)
      .optional()
      .describe("Max tokens to generate. Default model-dependent."),
    temperature: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe("Sampling temperature 0.0–2.0. Lower = more deterministic."),
    extra_input: z
      .record(z.unknown())
      .optional()
      .describe("Additional model-specific inputs."),
    download: z
      .boolean()
      .default(false)
      .describe("LLM output is text — default false (no file to download)."),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Vision / image understanding ---------- */

export const VisionInputSchema = z
  .object({
    image: z
      .string()
      .url()
      .describe("URL of the image to analyse / caption."),
    prompt: z
      .string()
      .min(1)
      .max(10_000)
      .optional()
      .describe(
        "Optional question or instruction (e.g. 'describe this image', 'count the people'). Default is a generic caption.",
      ),
    model: z
      .union([z.enum(visionKeys), z.string()])
      .default("llava-13b")
      .describe(
        `Vision model. Curated: ${visionKeys.join(", ")}. Or "owner/name".`,
      ),
    max_tokens: z.number().int().min(1).max(4096).optional(),
    extra_input: z.record(z.unknown()).optional(),
    download: z.boolean().default(false),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Upscale image ---------- */

export const UpscaleInputSchema = z
  .object({
    image: z
      .string()
      .url()
      .describe("URL of the image to upscale."),
    model: z
      .union([z.enum(upscaleKeys), z.string()])
      .default("real-esrgan")
      .describe(
        `Upscaler. Curated: ${upscaleKeys.join(", ")}. Or "owner/name".`,
      ),
    scale: z
      .number()
      .min(1)
      .max(10)
      .optional()
      .describe("Upscale factor (1–10). Model-dependent; default 4 for real-esrgan."),
    extra_input: z.record(z.unknown()).optional(),
    download: z.boolean().default(true),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Remove background ---------- */

export const RemoveBgInputSchema = z
  .object({
    image: z
      .string()
      .url()
      .describe("URL of the image whose background to remove."),
    model: z
      .union([z.enum(bgKeys), z.string()])
      .default("rembg")
      .describe(
        `Background remover. Curated: ${bgKeys.join(", ")}. Or "owner/name".`,
      ),
    extra_input: z.record(z.unknown()).optional(),
    download: z.boolean().default(true),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Speech-to-text / transcription ---------- */

export const TranscribeAudioInputSchema = z
  .object({
    audio: z
      .string()
      .url()
      .describe("URL of the audio (or video) file to transcribe."),
    model: z
      .union([z.enum(sttKeys), z.string()])
      .default("incredibly-fast-whisper")
      .describe(
        `Speech-to-text model. Curated: ${sttKeys.join(", ")}. Or "owner/name".`,
      ),
    language: z
      .string()
      .max(20)
      .optional()
      .describe(
        "ISO-639 language hint (e.g. 'en', 'it'). Default: auto-detect.",
      ),
    translate_to_english: z
      .boolean()
      .optional()
      .describe("If true, translate the transcript to English."),
    extra_input: z.record(z.unknown()).optional(),
    download: z
      .boolean()
      .default(false)
      .describe("Output is text — default false."),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Inpaint / outpaint ---------- */

export const InpaintInputSchema = z
  .object({
    image: z.string().url().describe("URL of the source image."),
    mask: z
      .string()
      .url()
      .describe(
        "URL of the mask. White areas are kept; black/transparent areas are inpainted.",
      ),
    prompt: z
      .string()
      .min(1)
      .max(4000)
      .describe("Text describing what to paint in the masked area."),
    model: z
      .union([z.enum(inpaintKeys), z.string()])
      .default("flux-fill-pro")
      .describe(
        `Inpaint model. Curated: ${inpaintKeys.join(", ")}. Or "owner/name".`,
      ),
    extra_input: z.record(z.unknown()).optional(),
    download: z.boolean().default(true),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Segmentation ---------- */

export const SegmentInputSchema = z
  .object({
    image: z.string().url().describe("URL of the image to segment."),
    prompt: z
      .string()
      .max(2000)
      .optional()
      .describe(
        "Text-prompt for grounded segmentation (e.g. 'the red car'). Required for grounded-sam.",
      ),
    model: z
      .union([z.enum(segmentKeys), z.string()])
      .default("sam-2")
      .describe(
        `Segmentation model. Curated: ${segmentKeys.join(", ")}. Or "owner/name".`,
      ),
    extra_input: z
      .record(z.unknown())
      .optional()
      .describe(
        "Model-specific extras (e.g. {points_per_side: 32} for SAM 2 auto-mask).",
      ),
    download: z.boolean().default(true),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Text embeddings ---------- */

export const EmbedTextInputSchema = z
  .object({
    texts: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(256)])
      .describe("A single text or an array of texts to embed."),
    model: z
      .union([z.enum(embedKeys), z.string()])
      .default("bge-large")
      .describe(
        `Embedding model. Curated: ${embedKeys.join(", ")}. Or "owner/name".`,
      ),
    extra_input: z.record(z.unknown()).optional(),
    download: z
      .boolean()
      .default(false)
      .describe("Output is a numeric vector — default false."),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Voice cloning ---------- */

export const CloneVoiceInputSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(5000)
      .describe("Text to synthesize in the cloned voice."),
    reference_audio_url: z
      .string()
      .url()
      .describe(
        "URL of a short voice sample (~5-30s) to clone. Use replicate_upload_file if you only have a local file.",
      ),
    language: z
      .string()
      .max(10)
      .optional()
      .describe("ISO-639 language code (e.g. 'en', 'es', 'it'). Default: 'en'."),
    model: z
      .union([z.enum(voicecloneKeys), z.string()])
      .default("xtts-v2")
      .describe(
        `Voice cloning model. Curated: ${voicecloneKeys.join(", ")}. Or "owner/name".`,
      ),
    extra_input: z
      .record(z.unknown())
      .optional()
      .describe("Additional model-specific inputs."),
    download: z.boolean().default(true),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- 3D generation ---------- */

export const Generate3DInputSchema = z
  .object({
    prompt: z
      .string()
      .max(2000)
      .optional()
      .describe(
        "Text description of the 3D object to generate. Provide either this or image_url (or both).",
      ),
    image_url: z
      .string()
      .url()
      .optional()
      .describe(
        "URL of a reference image to convert to 3D. Provide either this or prompt (or both). Use replicate_upload_file for local images.",
      ),
    model: z
      .union([z.enum(threedKeys), z.string()])
      .default("hunyuan-3d")
      .describe(
        `3D generation model. Curated: ${threedKeys.join(", ")}. Or "owner/name".`,
      ),
    extra_input: z
      .record(z.unknown())
      .optional()
      .describe("Additional model-specific inputs (e.g. {num_inference_steps: 50})."),
    download: z.boolean().default(true),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Lipsync / talking avatar ---------- */

export const LipsyncInputSchema = z
  .object({
    image_url: z
      .string()
      .url()
      .describe(
        "URL of the portrait or face image to animate. Use replicate_upload_file for local files.",
      ),
    text: z
      .string()
      .max(5000)
      .optional()
      .describe(
        "Text script for the avatar to speak. Required for models that do TTS+lipsync (video-avatar). Ignored when audio_url is provided.",
      ),
    audio_url: z
      .string()
      .url()
      .optional()
      .describe(
        "URL of the driving audio. Required for audio-only lipsync models (sadtalker). Optional override when model can do TTS.",
      ),
    model: z
      .union([z.enum(lipsyncKeys), z.string()])
      .default("video-avatar")
      .describe(
        `Lipsync model. Curated: ${lipsyncKeys.join(", ")}. Or "owner/name".`,
      ),
    extra_input: z
      .record(z.unknown())
      .optional()
      .describe("Additional model-specific inputs."),
    download: z.boolean().default(true),
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Prediction management ---------- */

export const ListPredictionsInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe("Number of recent predictions to return (1–100). Default 10."),
  })
  .strict();

export const CancelPredictionInputSchema = z
  .object({
    prediction_id: z
      .string()
      .min(1)
      .describe("ID of the prediction to cancel."),
  })
  .strict();

/* ---------- Cost estimator ---------- */

export const EstimateCostInputSchema = z
  .object({
    model: z
      .string()
      .min(1)
      .describe(
        'Replicate model id ("owner/name") or a curated key (e.g. "flux-schnell").',
      ),
    num_outputs: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("How many outputs to estimate for. Default 1."),
    duration_seconds: z
      .number()
      .min(1)
      .max(600)
      .optional()
      .describe(
        "For models priced per second (video, audio, LLM), the expected duration / token-equivalent.",
      ),
  })
  .strict();

/* ---------- Generic: run any model ---------- */

export const RunModelInputSchema = z
  .object({
    model: z
      .string()
      .min(1)
      .describe(
        'Replicate model identifier. Either "owner/name" (uses latest official version) or "owner/name:version_hash" (pins a specific version). Examples: "black-forest-labs/flux-schnell", "meta/meta-llama-3-70b-instruct".',
      ),
    input: z
      .record(z.unknown())
      .describe(
        "Model input parameters as a JSON object. Use replicate_get_model_schema first if unsure what a model accepts.",
      ),
    download,
    timeout_ms: timeoutMs,
  })
  .strict();

/* ---------- Discovery: search & schema ---------- */

export const SearchModelsInputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'Free-text search across the Replicate model catalog. Examples: "image upscaler", "voice cloning", "background removal".',
      ),
  })
  .strict();

export const GetModelSchemaInputSchema = z
  .object({
    model: z
      .string()
      .min(1)
      .describe(
        'Model identifier in "owner/name" or "owner/name:version" form.',
      ),
  })
  .strict();

/* ---------- Prediction status ---------- */

export const GetPredictionInputSchema = z
  .object({
    prediction_id: z
      .string()
      .min(1)
      .describe(
        "Prediction ID returned by a generate_* or run_model call that timed out.",
      ),
    download: z
      .boolean()
      .default(true)
      .describe(
        "If the prediction has succeeded, whether to download outputs locally.",
      ),
  })
  .strict();

/* ---------- File upload ---------- */

export const UploadFileInputSchema = z
  .object({
    file_path: z
      .string()
      .min(1)
      .describe(
        "Absolute local path of the file to upload to Replicate file storage.",
      ),
    mime_type: z
      .string()
      .optional()
      .describe(
        "MIME type override (e.g. 'image/png'). Auto-detected from file extension when absent.",
      ),
  })
  .strict();

/* ---------- Model refresh / discovery ---------- */

export const RefreshModelsInputSchema = z
  .object({
    categories: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "Categories to check. Default: all 15 (image, video, audio, tts, llm, vision, upscale, bg, stt, inpaint, segment, embed, voiceclone, threed, lipsync).",
      ),
    min_run_count: z
      .number()
      .int()
      .min(0)
      .default(1000)
      .describe("Minimum run_count to surface a model. Default: 1000."),
    limit_per_category: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Max suggestions per category (1–20). Default: 5."),
  })
  .strict();

/* ---------- Inferred types ---------- */

export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;
export type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;
export type GenerateAudioInput = z.infer<typeof GenerateAudioInputSchema>;
export type GenerateSpeechInput = z.infer<typeof GenerateSpeechInputSchema>;
export type ChatInput = z.infer<typeof ChatInputSchema>;
export type VisionInput = z.infer<typeof VisionInputSchema>;
export type UpscaleInput = z.infer<typeof UpscaleInputSchema>;
export type RemoveBgInput = z.infer<typeof RemoveBgInputSchema>;
export type TranscribeAudioInput = z.infer<typeof TranscribeAudioInputSchema>;
export type InpaintInput = z.infer<typeof InpaintInputSchema>;
export type SegmentInput = z.infer<typeof SegmentInputSchema>;
export type EmbedTextInput = z.infer<typeof EmbedTextInputSchema>;
export type ListPredictionsInput = z.infer<typeof ListPredictionsInputSchema>;
export type CancelPredictionInput = z.infer<typeof CancelPredictionInputSchema>;
export type EstimateCostInput = z.infer<typeof EstimateCostInputSchema>;
export type RunModelInput = z.infer<typeof RunModelInputSchema>;
export type SearchModelsInput = z.infer<typeof SearchModelsInputSchema>;
export type GetModelSchemaInput = z.infer<typeof GetModelSchemaInputSchema>;
export type GetPredictionInput = z.infer<typeof GetPredictionInputSchema>;
export type UploadFileInput = z.infer<typeof UploadFileInputSchema>;
export type CloneVoiceInput = z.infer<typeof CloneVoiceInputSchema>;
export type Generate3DInput = z.infer<typeof Generate3DInputSchema>;
export type LipsyncInput = z.infer<typeof LipsyncInputSchema>;
export type RefreshModelsInput = z.infer<typeof RefreshModelsInputSchema>;
