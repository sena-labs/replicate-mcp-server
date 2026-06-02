/**
 * MCP resources — readable context a client can pull without calling a tool.
 *
 *   replicate://models        the full curated model catalog (all categories)
 *   replicate://capabilities  a summary of what this server exposes
 *
 * These give hosts useful, no-side-effect context (and complete the server's
 * capability set: tools + prompts + resources).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  type CuratedModel,
} from "./models.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";

const CATALOG: Record<string, Record<string, CuratedModel>> = {
  image: IMAGE_MODELS,
  video: VIDEO_MODELS,
  audio_music: AUDIO_MUSIC_MODELS,
  tts: TTS_MODELS,
  llm: LLM_MODELS,
  vision: VISION_MODELS,
  upscale: UPSCALE_MODELS,
  background_removal: BG_REMOVAL_MODELS,
  stt: STT_MODELS,
  inpaint: INPAINT_MODELS,
  segment: SEGMENT_MODELS,
  embed: EMBED_MODELS,
  voice_clone: VOICE_CLONE_MODELS,
  threed: THREED_MODELS,
  lipsync: LIPSYNC_MODELS,
};

function modelCount(): number {
  return Object.values(CATALOG).reduce((n, reg) => n + Object.keys(reg).length, 0);
}

export function registerResources(server: McpServer): void {
  server.registerResource(
    "model-catalog",
    "replicate://models",
    {
      title: "Curated model catalog",
      description:
        "Every curated model this server knows, grouped by category, with the Replicate id, a one-line description, and a speed tier. Pass any key (or an 'owner/name[:version]') as a tool's `model` argument.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ categories: CATALOG, total_models: modelCount() }, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "capabilities",
    "replicate://capabilities",
    {
      title: "Server capabilities",
      description:
        "A summary of this server: categories covered, model count, transports, and the orchestration features (async batch, DAG pipelines, model recommender, cost estimator).",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              name: SERVER_NAME,
              version: SERVER_VERSION,
              categories: Object.keys(CATALOG),
              total_models: modelCount(),
              transports: ["stdio", "http-sse"],
              features: [
                "async batch jobs",
                "DAG pipelines",
                "model recommender",
                "pre-call cost estimator",
                "prediction history / cancel",
                "multi-token round-robin",
                "per-session token (multi-tenant)",
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}
