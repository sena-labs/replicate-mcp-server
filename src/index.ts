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
import { getPoolSize } from "./replicate.js";
import { webhookEnabled } from "./webhook.js";
import { logger } from "./logger.js";
import { startGC } from "./batch.js";
import { startPipelineGC } from "./pipeline.js";
import { registerGenerationTools } from "./tools/generation.js";
import { registerMediaTools } from "./tools/media.js";
import { registerManagementTools } from "./tools/management.js";
import { registerOrchestrationTools } from "./tools/orchestration.js";
import { registerAccountTools } from "./tools/account.js";

/* ---------- Server setup ---------- */

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

/* ---------- Tools: curated single-prediction generation ---------- */

registerGenerationTools(server);

/* ---------- Tools: voice clone / 3D / lipsync ---------- */

registerMediaTools(server);

/* ---------- Tools: run_model / search / schema / get_prediction / upload / recommend ---------- */

registerManagementTools(server);

/* ---------- Tools: batch + pipeline orchestration ---------- */

registerOrchestrationTools(server);

/* ---------- Tools: list / cancel / estimate / refresh ---------- */

registerAccountTools(server);

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
