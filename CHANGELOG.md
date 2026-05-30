# Changelog

All notable changes to `replicate-mcp-server`. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/) with [Semantic Versioning](https://semver.org/).

## [3.0.0] — 2026-05-19

### Added — platform features

- **HTTP/SSE transport** — `node dist/index.js --http --port 8088 [--host 0.0.0.0] [--api-key K]`. Hosts the MCP server on a TCP port via the official `StreamableHTTPServerTransport` so any HTTP-capable MCP client (claude.ai web Connectors, remote VS Code extensions, custom apps) can use it. Stateful sessions via `Mcp-Session-Id` header; constant-time Bearer auth when `--api-key` is set.
- **Multi-token round-robin pool** — `REPLICATE_API_TOKEN_POOL` env (comma-separated). Each Replicate API call rotates through the pool to spread rate-limit headroom across multiple accounts. Pool combines with single `REPLICATE_API_TOKEN` and deduplicates.
- **Rate-limit awareness** — `Retry-After` header on 429 / 503 is parsed (both seconds and HTTP date forms) and honoured before the next retry. Clamped to 60s ceiling.
- **Webhook receiver mode** — `REPLICATE_WEBHOOK_PUBLIC_URL` + `REPLICATE_WEBHOOK_PORT` / `--webhook-port` start a small HTTP listener so Replicate can POST completed predictions back to the server (event-driven instead of polling). Each callback URL embeds a per-prediction random token; constant-time comparison; stale entries garbage-collected every minute.
- **npm publish ready** — `bin` entry, `prepublishOnly` runs build + full test suite, `.npmignore` ships only `dist/`, `package.json` keywords + metadata aligned for discovery. `npx replicate-mcp-server` zero-install once published.
- **Dockerfile** — multi-stage Node 20 Alpine image, defaults to HTTP transport on 0.0.0.0:8088. `docker run -e REPLICATE_API_TOKEN=r8_... -p 8088:8088 replicate-mcp-server`.
- **Smithery manifest** — `smithery.yaml` with config schema (token, optional pool, log level, download dir), tool list, and stdio commandFunction for one-click install via smithery.ai.

### Added — modules

- `src/args.ts` — CLI flag parser (`--http`, `--port`, `--host`, `--api-key`, `--webhook-port`, `--webhook-host`).
- `src/http-server.ts` — Streamable HTTP transport runner with `/health` endpoint, Bearer auth, stateful session management.
- `src/token-pool.ts` — round-robin token dispenser (`loadTokenPoolFromEnv`, `makeTokenPool`).
- `src/rate-limit.ts` — `Retry-After` parser + `isRateLimitedResponse` helper.
- `src/webhook.ts` — webhook receiver with prediction-id → promise registry.

### Changed

- `getClient()` now reads from the token pool and caches one Replicate SDK client per token (rebuilt lazily); `_resetClientForTests()` test seam exposed.
- `downloadOne` honours `Retry-After` on 429 / 503 before allowing the retry loop to back off further.
- `isTransientDownloadError` now retries on HTTP 429 in addition to 5xx + connection errors.
- `main()` dispatches stdio vs HTTP transport based on `--http` flag; logs include `transport: "stdio" | "http"`.
- `package.json` adds `start:http`, `test`, `test:unit`, `test:stdio` scripts and `prepublishOnly` now runs full test suite.

### Tests

- New: `token-pool.test.mjs` (10 tests), `rate-limit.test.mjs` (8 tests), `args.test.mjs` (10 tests), `http-boot-test.mjs` (4 integration assertions on real spawned HTTP server: health endpoint, 401 unauthorised, authenticated initialize).
- Total unit tests: **104 → 132**. Total integration tests: 1 → 2 (stdio + HTTP boot).

### Deployment

- README gains a "Deploy as platform" section covering: `npx` install, Docker, HTTP transport behind reverse proxy, Smithery submission, claude.ai web Connector registration (manual via Anthropic console).

## [2.0.0] — 2026-05-19

### Added — 7 new MCP tools (19 total)

- **`replicate_transcribe_audio`** — Whisper / Distil-Whisper / WhisperX speech-to-text.
- **`replicate_inpaint`** — mask-based inpainting & outpainting (Flux Fill Pro, SD inpaint, Ideogram v2 edit).
- **`replicate_segment`** — SAM 2 / Grounded-SAM segmentation.
- **`replicate_embed_text`** — BGE / Jina / MPNet text embeddings.
- **`replicate_list_predictions`** — recent prediction history.
- **`replicate_cancel_prediction`** — cancel an in-progress async job.
- **`replicate_estimate_cost`** — pre-call USD estimate from a curated price table.

### Added — infrastructure

- **`src/logger.ts`** — structured JSON logger, `LOG_LEVEL=debug|info|warn|error` env-controlled, stderr-only (stdio framing safe).
- **`src/cost.ts`** — hand-curated USD pricing table for the estimator.
- **`src/embed.ts`** — HTML embed builders extracted from index.ts (testable in isolation).
- **Schema cache** — `getModelSchema` now memoises results for 5 minutes (`SCHEMA_CACHE_TTL_MS`).
- **4 new test suites** — `cost.test.mjs`, `logger.test.mjs`, `embed.test.mjs`, `transient-error.test.mjs`, `denylist.test.mjs`, `ssrf-allowlist.test.mjs`, `tail-logs.test.mjs`.

### Changed

- `PredictionStatus` widened with `KNOWN_NON_TERMINAL_STATUSES` set — unknown statuses now break the poll loop instead of busy-waiting until the timeout deadline.
- `pollUntilDone` uses exponential backoff (250 ms → 2 s) instead of fixed 2 s ticks. Fast models (Flux Schnell) no longer pay a flat 2 s tax.
- `createPrediction` preserves multi-colon version hashes (uses `indexOf` + `slice`, not `split(":", 2)`).
- `extractOutputTexts` joins long sentence-style chunks with `\n` and short streaming tokens with `""`, avoiding the "Hello"+"world" → "Helloworld" collision.
- Download failures inside `materializeResult` are caught — the caller still receives `prediction_id` and Replicate URLs so they can retry via `replicate_get_prediction`.
- `modelLabel` is normalised (version stripped) before being passed to the downloader, so the same prediction yields the same download directory regardless of which entry path was used.
- `runPrediction` strips Replicate webhook fields (`webhook`, `webhook_completed`, `webhook_events_filter`, `webhook_filter`) from `extra_input` to close the exfiltration vector.
- `downloadOne` enforces a Replicate host allowlist (SSRF guard), a 500 MB per-file size cap, and bounded concurrency (max 4 parallel downloads).
- `isTransientDownloadError` now also retries on `cause.code` of `ECONNRESET` / `ETIMEDOUT` / `EAI_AGAIN` / `UND_ERR_*` / `AbortError` (was: 5xx + `TypeError` only).
- HTML embed: full HTML entity encoding (`&`, `<`, `>`, `"`, `'`) for any URL interpolated into HTML; inline `onclick` handler replaced with a CSS-only `:target` zoom toggle.
- `tailLogs` walks newlines from the end instead of splitting the entire string — efficient on multi-MB logs.
- `asModelSummary` treats empty strings as missing so the `https://replicate.com/owner/name` URL fallback actually triggers.
- Inline images now respect both a per-image cap (`MAX_INLINE_IMAGE_BYTES`, 8 MB) and an aggregate cap (`MAX_INLINE_IMAGES_TOTAL_BYTES`, 12 MB) so multi-output predictions can't push 32 MB+ of base64 over a single stdio frame.
- `replicate_run_model` now validates the model id matches `owner/name[:version]` up-front and surfaces a friendly error.
- Tool descriptions: `"running"` → `"processing"` (matches actual Replicate API), duplicate `Workflow:` block removed, DISPLAY REQUIREMENT added to audio / speech / upscale / inpaint / segment / vision tools.

### Security

- SSRF allowlist for downloads (`replicate.delivery`, `pbxt.replicate.delivery`, `tjzk.replicate.delivery`, `replicate.com`).
- Webhook field denylist on `extra_input`.
- Download size cap (500 MB per file).
- Full HTML entity encoding on URL embeds.
- No inline JavaScript in the embedded image viewer (`onclick` replaced with CSS `:target`).
- Path traversal defence: both `modelLabel` and `predictionId` go through `sanitize()` before being joined into the download path.

### Tests

- Total unit tests: **44 → 89+ (and counting)** across 11 suites.
- New: `cost.test.mjs`, `logger.test.mjs` (subprocess-based level testing), `embed.test.mjs`, `transient-error.test.mjs`, `denylist.test.mjs`, `ssrf-allowlist.test.mjs`, `tail-logs.test.mjs`.
- Stdio integration test now uses request-id → promise correlation instead of fixed `wait(ms)` sleeps — no longer flaky on slow CPU.

## [1.0.0] — initial release

- 8 MCP tools: `generate_image`, `generate_video`, `generate_audio`, `generate_speech`, `run_model`, `search_models`, `get_model_schema`, `get_prediction`.
- 4 curated registries: image (Flux family, SD 3.5, Recraft, Ideogram, Imagen 3), video (Kling, Minimax, Hunyuan, Luma Ray, Wan 2.2), audio/music (MusicGen, ACE-Step, Riffusion), TTS (Kokoro, Minimax Speech, Chatterbox).
- Stream-based file download, polling-based async result handling, structured tool responses.
