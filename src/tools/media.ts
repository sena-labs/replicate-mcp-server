/**
 * Voice / 3D / avatar generation tools.
 *
 * replicate_clone_voice, replicate_generate_3d, replicate_lipsync — these
 * share the makeGenerationHandler pipeline but use category-specific
 * per-model field maps to place their inputs.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  toCuratedKey,
  VOICE_CLONE_MODELS,
  THREED_MODELS,
  LIPSYNC_MODELS,
} from "../models.js";
import { makeGenerationHandler } from "../handler-factory.js";
import {
  VOICE_CLONE_REF_FIELD,
  VOICE_CLONE_TEXT_FIELD,
  THREED_IMAGE_FIELD,
  LIPSYNC_IMAGE_FIELD,
  LIPSYNC_TEXT_FIELD,
  LIPSYNC_AUDIO_FIELD,
  LIPSYNC_NO_TEXT,
} from "../field-maps.js";
import {
  CloneVoiceInputSchema,
  Generate3DInputSchema,
  LipsyncInputSchema,
  type CloneVoiceInput,
  type Generate3DInput,
  type LipsyncInput,
} from "../schemas.js";

export function registerMediaTools(server: McpServer): void {
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

}
