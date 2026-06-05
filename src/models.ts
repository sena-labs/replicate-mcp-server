/**
 * Curated registry of high-quality models on Replicate.
 *
 * These are smart defaults for each category. Users can always specify
 * a different model via the `model` parameter — these are just the
 * "if you don't care, use this" picks.
 *
 * Model identifiers follow Replicate's format:
 *   - "owner/name"          → uses latest official version
 *   - "owner/name:version"  → pins a specific version hash
 */

export interface CuratedModel {
  id: string;
  description: string;
  speed: "fast" | "medium" | "slow";
  defaultInput?: Record<string, unknown>;
}

export const IMAGE_MODELS: Record<string, CuratedModel> = {
  "flux-schnell": {
    id: "black-forest-labs/flux-schnell",
    description: "Fastest Flux model. ~2s per image. Best for iteration.",
    speed: "fast",
    defaultInput: {
      num_outputs: 1,
      aspect_ratio: "1:1",
      output_format: "webp",
      output_quality: 90,
    },
  },
  "flux-dev": {
    id: "black-forest-labs/flux-dev",
    description: "Higher quality than schnell. ~10s per image.",
    speed: "medium",
    defaultInput: {
      num_outputs: 1,
      aspect_ratio: "1:1",
      output_format: "webp",
      output_quality: 90,
    },
  },
  "flux-pro": {
    id: "black-forest-labs/flux-1.1-pro",
    description: "Best quality Flux. Photorealism and prompt adherence.",
    speed: "medium",
    defaultInput: {
      aspect_ratio: "1:1",
      output_format: "webp",
      output_quality: 90,
      safety_tolerance: 2,
    },
  },
  "sd-3.5-large": {
    id: "stability-ai/stable-diffusion-3.5-large",
    description: "Stable Diffusion 3.5 Large. Strong text rendering.",
    speed: "medium",
  },
  "recraft-v3": {
    id: "recraft-ai/recraft-v3",
    description: "Recraft v3. Best-in-class for text in images, logos, and SVG output.",
    speed: "medium",
  },
  "recraft-v4.1": {
    id: "recraft-ai/recraft-v4.1",
    description: "Recraft v4.1. Latest Recraft — superior prompt accuracy, art direction, text rendering.",
    speed: "medium",
  },
  "flux-2-max": {
    id: "black-forest-labs/flux-2-max",
    description: "FLUX.2 Max. Highest-fidelity BFL model. Multi-reference (up to 8 images), strongest prompt following.",
    speed: "medium",
    defaultInput: {
      aspect_ratio: "1:1",
      output_format: "webp",
      output_quality: 90,
      safety_tolerance: 2,
    },
  },
  "seedream": {
    id: "bytedance/seedream-5-lite",
    description: "ByteDance Seedream 5 Lite. Built-in reasoning, 3K resolution, multi-reference (up to 14 images).",
    speed: "medium",
    defaultInput: {
      aspect_ratio: "1:1",
      output_format: "webp",
    },
  },
  "ideogram-v2": {
    id: "ideogram-ai/ideogram-v2",
    description: "Excellent typography and graphic design.",
    speed: "medium",
  },
  "imagen-3": {
    id: "google/imagen-3",
    description: "Google's Imagen 3. Photorealistic, high prompt fidelity.",
    speed: "medium",
  },
};

export const VIDEO_MODELS: Record<string, CuratedModel> = {
  "kling-pro": {
    id: "kwaivgi/kling-v1.6-pro",
    description: "Kling 1.6 Pro. Strong motion and prompt adherence.",
    speed: "slow",
  },
  "minimax-video": {
    id: "minimax/video-01",
    description: "Minimax Hailuo. Cinematic, 6-second clips.",
    speed: "slow",
  },
  "hunyuan-video": {
    id: "tencent/hunyuan-video",
    description: "Tencent Hunyuan. Open-source, high quality.",
    speed: "slow",
  },
  "luma-ray": {
    id: "luma/ray",
    description: "Luma Dream Machine Ray. Smooth motion.",
    speed: "slow",
  },
  "wan-2.2": {
    id: "wan-video/wan-2.2-t2v-fast",
    description: "Alibaba Wan 2.2 text-to-video. Fast variant.",
    speed: "medium",
  },
  "grok-video": {
    id: "xai/grok-imagine-video",
    description: "xAI Grok Video. Text/image-to-video with native audio. Up to 15s, 480p-720p.",
    speed: "medium",
  },
  "seedance": {
    id: "bytedance/seedance-2.0",
    description: "ByteDance Seedance 2.0. Multimodal video with native audio. Text, image, video, and audio reference inputs.",
    speed: "slow",
  },
};

export const AUDIO_MUSIC_MODELS: Record<string, CuratedModel> = {
  "musicgen": {
    id: "meta/musicgen",
    description: "Meta MusicGen. Melody and continuation. Up to 30s.",
    speed: "medium",
    defaultInput: {
      model_version: "stereo-large",
      output_format: "mp3",
      duration: 8,
      normalization_strategy: "peak",
    },
  },
  "ace-step": {
    // Version-pinned: the bare "lucataco/ace-step" model route 404s on
    // predictions.create({model}); only the versioned predictions.create({version})
    // path works. Refresh this hash if the model publishes a new version.
    id: "lucataco/ace-step:280fc4f9ee507577f880a167f639c02622421d8fecf492454320311217b688f1",
    description: "Generate full songs with lyrics. ~3-4 minutes.",
    speed: "slow",
  },
  "riffusion": {
    id: "riffusion/riffusion",
    description: "Spectrogram-based music generation. Loops and ambient.",
    speed: "fast",
  },
  "minimax-music": {
    id: "minimax/music-2.6",
    description: "MiniMax Music 2.6. Full songs up to 6min. prompt=style tags; pass lyrics via extra_input.lyrics.",
    speed: "slow",
  },
};

export const TTS_MODELS: Record<string, CuratedModel> = {
  "kokoro": {
    id: "jaaari/kokoro-82m",
    description: "Kokoro 82M. Fast, high-quality TTS. Many voices.",
    speed: "fast",
    defaultInput: {
      voice: "af_bella",
      speed: 1.0,
    },
  },
  "minimax-speech": {
    id: "minimax/speech-02-hd",
    description: "Minimax Speech 02 HD. Multi-language, very natural.",
    speed: "fast",
  },
  "chatterbox": {
    id: "resemble-ai/chatterbox",
    description: "Resemble Chatterbox. Voice cloning from a sample.",
    speed: "medium",
  },
  "gemini-tts": {
    id: "google/gemini-3.1-flash-tts",
    description: "Google Gemini Flash TTS. 30 voices, 70+ languages, emotion/style control via prompt.",
    speed: "fast",
  },
  "grok-tts": {
    id: "xai/grok-text-to-speech",
    description: "xAI Grok TTS. Natural prosody, 5 voices, 20 languages.",
    speed: "fast",
  },
};

/* ---------- LLM / text-generation ---------- */

export const LLM_MODELS: Record<string, CuratedModel> = {
  "llama-3.1-405b": {
    id: "meta/meta-llama-3.1-405b-instruct",
    description: "Meta Llama 3.1 405B Instruct. Top-tier reasoning, slowest.",
    speed: "slow",
    defaultInput: { max_tokens: 1024, temperature: 0.7 },
  },
  "llama-3-70b": {
    id: "meta/meta-llama-3-70b-instruct",
    description: "Meta Llama 3 70B Instruct. Balanced quality / speed.",
    speed: "medium",
    defaultInput: { max_tokens: 1024, temperature: 0.7 },
  },
  "llama-3-8b": {
    id: "meta/meta-llama-3-8b-instruct",
    description: "Meta Llama 3 8B Instruct. Fast, good for simple chat.",
    speed: "fast",
    defaultInput: { max_tokens: 1024, temperature: 0.7 },
  },
  "mistral-7b": {
    id: "mistralai/mistral-7b-instruct-v0.2",
    description: "Mistral 7B v0.2 Instruct. Fast, strong for its size, multilingual.",
    speed: "fast",
    defaultInput: { max_tokens: 1024, temperature: 0.7 },
  },
  "mixtral-8x7b": {
    id: "mistralai/mixtral-8x7b-instruct-v0.1",
    description: "Mixtral 8x7B Instruct. MoE, fast.",
    speed: "fast",
    defaultInput: { max_tokens: 1024, temperature: 0.7 },
  },
  "deepseek-r1": {
    id: "deepseek-ai/deepseek-r1",
    description: "DeepSeek-R1 reasoning model. Strong at math and code.",
    speed: "medium",
  },
};

/* ---------- Vision / image-understanding ---------- */

export const VISION_MODELS: Record<string, CuratedModel> = {
  "llava-13b": {
    id: "yorickvp/llava-13b",
    description: "LLaVA 13B. Visual question answering and image captioning.",
    speed: "fast",
  },
  "llava-v1.6-34b": {
    id: "yorickvp/llava-v1.6-34b",
    description: "LLaVA 1.6 34B. Higher-quality visual reasoning.",
    speed: "medium",
  },
  "blip-2": {
    id: "andreasjansson/blip-2",
    description: "BLIP-2. Image captioning + visual QA. Light and fast.",
    speed: "fast",
  },
  "qwen-vl": {
    id: "lucataco/qwen2-vl-7b-instruct",
    description: "Qwen2-VL 7B. Multilingual vision-language understanding.",
    speed: "fast",
  },
};

/* ---------- Image upscale / restoration ---------- */

export const UPSCALE_MODELS: Record<string, CuratedModel> = {
  "real-esrgan": {
    id: "nightmareai/real-esrgan",
    description: "Real-ESRGAN. Classic 4x upscaler, sharp on most images.",
    speed: "fast",
    defaultInput: { scale: 4 },
  },
  "clarity-upscaler": {
    id: "philz1337x/clarity-upscaler",
    description: "Clarity Upscaler. Detail-preserving, photographic upscale.",
    speed: "medium",
    defaultInput: { scale_factor: 2 },
  },
  "swinir": {
    id: "jingyunliang/swinir",
    description: "SwinIR. Restoration + 4x upscale, good on faces.",
    speed: "medium",
  },
  "gfpgan": {
    id: "tencentarc/gfpgan",
    description: "GFPGAN. Face restoration. Pair with upscaler for photos.",
    speed: "fast",
    defaultInput: { version: "v1.4", scale: 2 },
  },
  "clarity-pro": {
    id: "philz1337x/clarity-pro-upscaler",
    description: "Clarity Pro Upscaler. Identity-preserving creative upscale. Use extra_input.scale_factor (default 2).",
    speed: "medium",
    defaultInput: { scale_factor: 2 },
  },
};

/* ---------- Background removal ---------- */

export const BG_REMOVAL_MODELS: Record<string, CuratedModel> = {
  "rembg": {
    id: "lucataco/remove-bg",
    description: "Standard rembg. Fast, general-purpose background removal.",
    speed: "fast",
  },
  "birefnet": {
    id: "men1scus/birefnet",
    description: "BiRefNet. State-of-the-art bg removal, sharper edges.",
    speed: "medium",
  },
  "briaai-rmbg": {
    id: "briaai/rmbg-v2.0",
    description: "BRIA RMBG 2.0. Commercial-grade bg removal.",
    speed: "fast",
  },
};

/* ---------- Speech-to-text / transcription ---------- */

export const STT_MODELS: Record<string, CuratedModel> = {
  "whisper": {
    id: "openai/whisper",
    description: "OpenAI Whisper. Robust speech-to-text across 99 languages.",
    speed: "medium",
  },
  "incredibly-fast-whisper": {
    id: "vaibhavs10/incredibly-fast-whisper",
    description:
      "Distil-Whisper variant. Up to 10x faster than openai/whisper on GPU.",
    speed: "fast",
  },
  "whisperx": {
    id: "victor-upmeet/whisperx",
    description: "WhisperX with word-level timestamps and speaker diarization.",
    speed: "medium",
  },
  "scribe": {
    id: "elevenlabs/scribe-v2",
    description: "ElevenLabs Scribe v2. 90+ languages, 32-speaker diarization, word timestamps. Use language via extra_input.language_code.",
    speed: "medium",
  },
};

/* ---------- Image inpainting / outpainting ---------- */

export const INPAINT_MODELS: Record<string, CuratedModel> = {
  "flux-fill-pro": {
    id: "black-forest-labs/flux-fill-pro",
    description: "Flux Fill Pro. High-quality mask-based inpaint and outpaint.",
    speed: "medium",
  },
  "sd-inpaint": {
    id: "stability-ai/stable-diffusion-inpainting",
    description: "SD inpainting baseline. Free-tier friendly.",
    speed: "fast",
  },
  "ideogram-v2-edit": {
    id: "ideogram-ai/ideogram-v2-edit",
    description: "Ideogram v2 inpaint — excellent for text-in-image edits.",
    speed: "medium",
  },
};

/* ---------- Segmentation ---------- */

export const SEGMENT_MODELS: Record<string, CuratedModel> = {
  "sam-2": {
    id: "meta/sam-2",
    description: "Segment Anything 2. Point/box-prompt object segmentation.",
    speed: "fast",
  },
  "grounded-sam": {
    id: "schananas/grounded_sam",
    description:
      "Grounded-SAM. Text-prompt segmentation (e.g. 'segment the cat').",
    speed: "medium",
  },
};

/* ---------- Text embeddings ---------- */

export const EMBED_MODELS: Record<string, CuratedModel> = {
  "bge-large": {
    id: "nateraw/bge-large-en-v1.5",
    description: "BGE Large v1.5. 1024-dim English embeddings.",
    speed: "fast",
  },
  "jina-embeddings-v3": {
    id: "jina-ai/jina-embeddings-v3",
    description: "Jina v3. Multilingual, 1024-dim, task-tuned.",
    speed: "fast",
  },
  "all-minilm": {
    id: "replicate/all-mpnet-base-v2",
    description: "Sentence-transformers MPNet. 768-dim, lightweight.",
    speed: "fast",
  },
};

/* ---------- Voice cloning ---------- */

export const VOICE_CLONE_MODELS: Record<string, CuratedModel> = {
  "xtts-v2": {
    id: "lucataco/xtts-v2",
    description: "XTTS v2. Multilingual voice cloning TTS. Clone any voice from ~5s sample.",
    speed: "medium",
    defaultInput: { language: "en" },
  },
  "openvoice-v2": {
    id: "myshell-ai/openvoice-v2",
    description: "OpenVoice v2. Zero-shot cross-lingual voice cloning. Tone and style transfer.",
    speed: "fast",
  },
};

/* ---------- 3D generation ---------- */

export const THREED_MODELS: Record<string, CuratedModel> = {
  "hunyuan-3d": {
    id: "tencent/hunyuan-3d-3.1",
    description: "Tencent Hunyuan 3D 3.1. Text or image → 3D mesh with textures (GLB).",
    speed: "slow",
  },
  "rodin": {
    id: "hyper3d/rodin",
    description: "Hyper3D Rodin. Single or multi-view image(s) → high-quality 3D model (GLB).",
    speed: "slow",
  },
  "triposr": {
    id: "camenduru/triposr",
    description: "TripoSR. Fast single-image → 3D mesh. ~0.5s on GPU.",
    speed: "fast",
  },
};

/* ---------- Lipsync / talking avatar ---------- */

export const LIPSYNC_MODELS: Record<string, CuratedModel> = {
  "video-avatar": {
    id: "prunaai/p-video-avatar",
    description: "P-Video Avatar. Portrait image + text or audio → lip-synced talking video.",
    speed: "slow",
  },
  "sadtalker": {
    id: "cjwbw/sadtalker",
    description: "SadTalker. Portrait image + audio → realistic talking head video.",
    speed: "medium",
  },
};

export type ModelCategory =
  | "image"
  | "video"
  | "audio"
  | "tts"
  | "llm"
  | "vision"
  | "upscale"
  | "bg"
  | "stt"
  | "inpaint"
  | "segment"
  | "embed"
  | "voiceclone"
  | "threed"
  | "lipsync";

const REGISTRY: Record<ModelCategory, Record<string, CuratedModel>> = {
  image: IMAGE_MODELS,
  video: VIDEO_MODELS,
  audio: AUDIO_MUSIC_MODELS,
  tts: TTS_MODELS,
  llm: LLM_MODELS,
  vision: VISION_MODELS,
  upscale: UPSCALE_MODELS,
  bg: BG_REMOVAL_MODELS,
  stt: STT_MODELS,
  inpaint: INPAINT_MODELS,
  segment: SEGMENT_MODELS,
  embed: EMBED_MODELS,
  voiceclone: VOICE_CLONE_MODELS,
  threed: THREED_MODELS,
  lipsync: LIPSYNC_MODELS,
};

export function resolveModel(
  category: ModelCategory,
  modelKeyOrId: string,
): string {
  const registry = REGISTRY[category];
  // If it's a known shortcut, expand it. Otherwise, assume it's a full
  // "owner/name" or "owner/name:version" identifier.
  if (modelKeyOrId in registry) {
    return registry[modelKeyOrId]!.id;
  }
  return modelKeyOrId;
}

export function getDefaultInput(
  category: ModelCategory,
  modelKey: string,
): Record<string, unknown> {
  return REGISTRY[category][modelKey]?.defaultInput ?? {};
}

/** Accessor for the curated models in a category. Used by the router
 *  to score/rank without exposing the whole REGISTRY object. */
export function getCategoryModels(
  category: ModelCategory,
): Record<string, CuratedModel> {
  return REGISTRY[category];
}

/** Normalise a model reference to its curated short key when possible.
 *
 *  Per-model field maps (e.g. AUDIO_PROMPT_FIELD, VIDEO_IMAGE_INPUT_FIELD) are
 *  keyed on short keys like "riffusion". When a caller passes the full id
 *  ("riffusion/riffusion") instead, a raw map lookup misses and the wrong
 *  field name is used. This resolves either form back to the curated key:
 *   - already a known short key → returned unchanged
 *   - a full "owner/name[:version]" matching a curated model → that model's key
 *   - otherwise → returned unchanged (unknown model; caller uses defaults)
 */
export function toCuratedKey(
  category: ModelCategory,
  modelKeyOrId: string,
): string {
  const registry = REGISTRY[category];
  if (modelKeyOrId in registry) return modelKeyOrId;
  // Strip an optional ":version" suffix before matching ids.
  const colon = modelKeyOrId.indexOf(":");
  const bareId = colon >= 0 ? modelKeyOrId.slice(0, colon) : modelKeyOrId;
  for (const [key, m] of Object.entries(registry)) {
    if (m.id === bareId) return key;
  }
  return modelKeyOrId;
}
