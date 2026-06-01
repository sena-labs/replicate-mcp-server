import { homedir } from "node:os";
import { join } from "node:path";

/** Maximum characters in a single tool response before truncation. */
export const CHARACTER_LIMIT = 25_000;

/** Default directory for downloaded files (overridable via env). */
export const DEFAULT_DOWNLOAD_DIR =
  process.env.REPLICATE_DOWNLOAD_DIR ??
  join(homedir(), "Downloads", "replicate-mcp");

/** Polling configuration for async predictions. The poll interval starts
 *  small for fast models (Flux Schnell ~0.5s) and backs off exponentially
 *  toward POLL_INTERVAL_MS for long-running predictions. */
export const INITIAL_POLL_INTERVAL_MS = 250;
export const POLL_INTERVAL_MS = 2_000;

/** Default upper bound on how long we wait for a prediction to finish.
 *  Beyond this we return the prediction ID for later checking via
 *  `replicate_get_prediction`. */
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes hard cap

/** Hard cap on a single downloaded file size to avoid disk-fill from a
 *  rogue / oversized upstream response. */
export const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

/** Maximum size of a single image inlined as base64 in a tool response.
 *  Larger images skip the inline preview but still surface via local_paths /
 *  URL embed (which render the image inline anyway).
 *
 *  Sized for Claude Desktop's hard 1 MB tool-result limit: base64 inflates raw
 *  bytes by ~37%, so 600 KB raw ≈ 820 KB base64 — leaving headroom for the
 *  structuredContent JSON + caption text under 1 MB. */
export const MAX_INLINE_IMAGE_BYTES = 600 * 1024; // 600 KB raw (~820 KB base64)

/** Aggregate cap across all inline images in one tool response (measured on
 *  the base64 length). Must be ≥ the per-image base64 size so a single image
 *  at the per-image cap still inlines. Keeps the whole tool result under the
 *  Claude Desktop 1 MB ceiling; multi-output predictions inline what fits and
 *  surface the rest via URL embeds. */
export const MAX_INLINE_IMAGES_TOTAL_BYTES = 850_000; // ~0.81 MB of base64

/** Cap on parallel download workers per prediction to avoid EMFILE /
 *  network saturation when a model returns many outputs. */
export const DOWNLOAD_CONCURRENCY_LIMIT = 4;

/** Allowlist of hosts the download path is permitted to fetch from.
 *  Prevents SSRF via redirect to internal services if a Replicate response
 *  is ever spoofed or compromised. */
export const REPLICATE_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "replicate.delivery",
  "pbxt.replicate.delivery",
  "tjzk.replicate.delivery",
  "replicate.com",
  "api.replicate.com",
]);

/** Replicate `extra_input` / `input` keys that allow data exfiltration or
 *  side-effects. We refuse to forward them so a caller can't aim webhooks
 *  at attacker-controlled URLs through an MCP tool call. */
export const EXTRA_INPUT_DENYLIST: ReadonlySet<string> = new Set([
  "webhook",
  "webhook_url",
  "webhook_completed",
  "webhook_events_filter",
  "webhook_filter",
]);

/** Minimum length enforced for the HTTP API key (--api-key / HTTP_API_KEY).
 *  Short keys are trivially guessable; 16 chars gives ≥128-bit entropy when
 *  drawn from a random hex source. */
export const MIN_HTTP_API_KEY_LENGTH = 16;

/** Hard cap on a webhook POST body. Replicate prediction payloads are small
 *  JSON (well under 1 MB); anything larger is rejected with 413 so an
 *  authenticated-but-malicious caller can't exhaust memory via an unbounded
 *  body read. */
export const MAX_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

/** Optional per-prediction spend cap (USD). When > 0 the server estimates
 *  cost before launching a prediction and aborts if it would exceed the cap.
 *  Set via REPLICATE_MAX_COST_USD environment variable. 0 = disabled. */
export const REPLICATE_MAX_COST_USD =
  parseFloat(process.env["REPLICATE_MAX_COST_USD"] ?? "0") || 0;

/** Maximum poll interval per model category (ms). Image models back off to
 *  1 s; slow video models can wait up to 10 s between polls. */
export const POLL_INTERVAL_BY_CATEGORY: Readonly<Record<string, number>> = {
  image: 1_000,
  video: 10_000,
  audio: 5_000,
  tts: 3_000,
  llm: 3_000,
  vision: 2_000,
  upscale: 2_000,
  bg: 2_000,
  stt: 3_000,
  inpaint: 3_000,
  segment: 2_000,
  embed: 1_000,
  voiceclone: 3_000,
  threed: 15_000,
  lipsync: 10_000,
};

/** Server identity. */
export const SERVER_NAME = "replicate-mcp-server";
export const SERVER_VERSION = "3.1.0";

/** Schema cache TTL — replicate_get_model_schema results are memoised
 *  for this many milliseconds to avoid re-hitting the Replicate API
 *  when a caller looks up the same model repeatedly in one session. */
export const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Max models returned from `replicate_search_models`. */
export const MAX_SEARCH_RESULTS = 25;

/** Number of trailing log lines surfaced in PredictionResult.logs_excerpt. */
export const LOG_TAIL_LINES = 10;

/** Max length of a URL pathname extension considered for filename inference. */
export const MAX_FILENAME_EXT_LEN = 6;

/** Max length of a sanitised model-label segment used as a download subdir. */
export const MAX_SANITISED_LABEL_LEN = 60;
