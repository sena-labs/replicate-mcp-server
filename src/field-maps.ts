/**
 * Per-model field-name maps.
 *
 * Different Replicate models name the same conceptual input differently (the
 * "starting image" of a video model might be `start_image`, `image`, or
 * `first_frame_image`). These maps, keyed by the curated short key, let each
 * generation handler send the right field. Use `toCuratedKey` (models.ts) to
 * normalise a full "owner/name" id back to the short key before lookup.
 */

/** Per-model prompt field name for audio generation.
 *  musicgen uses "prompt"; ace-step uses "tags"; riffusion uses "prompt_a". */
export const AUDIO_PROMPT_FIELD: Record<string, string> = {
  "ace-step": "tags",
  "riffusion": "prompt_a",
};

/** Models whose API has no duration parameter — don't send it. */
export const AUDIO_NO_DURATION = new Set([
  "riffusion",
  "lyria-2",
  "lyria-3",
  "lyria-3-pro",
]);

/** Per-model field name for the starting image in image-to-video requests.
 *  Models use different field names — a single "start_image" default breaks
 *  models that expect "image" or "first_frame_image". */
export const VIDEO_IMAGE_INPUT_FIELD: Record<string, string> = {
  "kling-pro": "start_image",
  "minimax-video": "first_frame_image",
  "luma-ray": "image",
  "wan-2.2": "image",
  "grok-video": "image",
  "seedance": "image",
};

/** Per-model field name for the reference audio URL in voice cloning. */
export const VOICE_CLONE_REF_FIELD: Record<string, string> = {
  "xtts-v2": "speaker_wav",
  "openvoice-v2": "reference_speaker",
};

/** Per-model field name for the text input in voice cloning. */
export const VOICE_CLONE_TEXT_FIELD: Record<string, string> = {
  "openvoice-v2": "input_text",
};

/** Per-model field name for the image input in 3D generation. */
export const THREED_IMAGE_FIELD: Record<string, string> = {
  "rodin": "input_image_url",
};

/** Per-model field name for the portrait image in lipsync. */
export const LIPSYNC_IMAGE_FIELD: Record<string, string> = {
  "sadtalker": "source_image",
};

/** Per-model field name for the text script in lipsync. */
export const LIPSYNC_TEXT_FIELD: Record<string, string> = {
  "video-avatar": "voice_script",
};

/** Per-model field name for the driving audio in lipsync. */
export const LIPSYNC_AUDIO_FIELD: Record<string, string> = {
  "sadtalker": "driven_audio",
};

/** Models that do not support text input (audio-only lipsync). */
export const LIPSYNC_NO_TEXT = new Set(["sadtalker"]);

/** Maps each curated category to a Replicate search keyword (refresh_models). */
export const REFRESH_CATEGORY_KEYWORDS: Record<string, string> = {
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
