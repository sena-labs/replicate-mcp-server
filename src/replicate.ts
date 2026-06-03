import Replicate from "replicate";
import type { Prediction, Training, Deployment } from "replicate";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import {
  DEFAULT_DOWNLOAD_DIR,
  DEFAULT_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  INITIAL_POLL_INTERVAL_MS,
  MAX_SEARCH_RESULTS,
  LOG_TAIL_LINES,
  MAX_FILENAME_EXT_LEN,
  MAX_SANITISED_LABEL_LEN,
  MAX_DOWNLOAD_BYTES,
  REPLICATE_ALLOWED_HOSTS,
  EXTRA_INPUT_DENYLIST,
  DOWNLOAD_CONCURRENCY_LIMIT,
  SCHEMA_CACHE_TTL_MS,
} from "./constants.js";
import { logger } from "./logger.js";
import {
  parseRetryAfter,
  isRateLimitedResponse,
} from "./rate-limit.js";

/* ---------- Client ---------- */

import { loadTokenPoolFromEnv, type TokenPool } from "./token-pool.js";
import { getRequestToken } from "./request-context.js";
import {
  webhookEnabled,
  buildCallbackUrl,
  awaitWebhook,
  cancelPendingWebhook,
} from "./webhook.js";

let _pool: TokenPool | null = null;
/** Per-token Replicate client cache so we don't re-instantiate on every
 *  call (saves the SDK setup cost without sharing state between tokens).
 *  Capped + FIFO-evicted so a multi-tenant host serving many distinct user
 *  tokens can't grow this map without bound. */
const MAX_CACHED_CLIENTS = 256;
const _clientByToken = new Map<string, Replicate>();

function ensurePool(): NonNullable<typeof _pool> {
  if (!_pool) {
    _pool = loadTokenPoolFromEnv();
    if (!_pool) {
      throw new Error(
        "No Replicate API tokens configured. Set REPLICATE_API_TOKEN " +
          "(single account) or REPLICATE_API_TOKEN_POOL (comma-separated " +
          "for round-robin). Get tokens at https://replicate.com/account/api-tokens.",
      );
    }
  }
  return _pool;
}

function clientForToken(token: string): Replicate {
  let client = _clientByToken.get(token);
  if (!client) {
    if (_clientByToken.size >= MAX_CACHED_CLIENTS) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = _clientByToken.keys().next().value;
      if (oldest !== undefined) _clientByToken.delete(oldest);
    }
    client = new Replicate({ auth: token });
    _clientByToken.set(token, client);
  }
  return client;
}

/** Returns a client + the token it's authenticated with.
 *
 *  Multi-tenant (hosted): if the current request carries its own Replicate
 *  token (set by the HTTP layer from the per-user session config), use that —
 *  the caller pays for their own usage and the env pool is bypassed.
 *
 *  Otherwise (stdio / single-account): pick the next non-rate-limited token
 *  from the env pool so callers can mark it on 429. */
function getClientAndToken(): { client: Replicate; token: string } {
  const sessionToken = getRequestToken();
  if (sessionToken) {
    return { client: clientForToken(sessionToken), token: sessionToken };
  }
  const pool = ensurePool();
  const token = pool.nextAvailable();
  return { client: clientForToken(token), token };
}

export function getClient(): Replicate {
  return getClientAndToken().client;
}

/** Number of tokens currently in the pool (0 if pool not yet initialised).
 *  Safe to call before any prediction — won't trigger token validation. */
export function getPoolSize(): number {
  return _pool?.size ?? 0;
}

/** Test seam: reset cached pool + clients so tests can rebuild from a
 *  modified environment. Production code never calls this. */
export function _resetClientForTests(): void {
  _pool = null;
  _clientByToken.clear();
}

/* ---------- Public API ---------- */

export type PredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  "succeeded",
  "failed",
  "canceled",
]);

/** Statuses Replicate is known to use while a prediction is still in
 *  progress. Anything *outside* this set AND outside TERMINAL_STATUSES is
 *  unknown — we stop polling rather than busy-wait until the deadline. */
const KNOWN_NON_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  "starting",
  "processing",
]);

export interface PredictionResult {
  status: PredictionStatus;
  prediction_id: string;
  model: string;
  urls: string[];
  local_paths: string[];
  /** Non-URL string outputs (LLM completions, vision captions, classifier
   *  labels, etc.). Populated when the prediction returned plain text rather
   *  than file URLs. */
  text_output?: string[];
  metrics?: {
    predict_time_seconds?: number;
  };
  error?: string;
  logs_excerpt?: string;
  /** Set when we timed out waiting. Use replicate_get_prediction with the id to keep polling. */
  pending?: boolean;
}

/** True only for a genuinely finished, successful prediction. A timed-out
 *  result (status "starting"/"processing" with `pending: true`) or a
 *  "canceled" result is NOT a success — callers (batch/pipeline workers) must
 *  not treat those as completed, or they'd feed empty outputs downstream and
 *  miscount results. Whitelist the success status rather than blacklisting
 *  "failed". */
export function predictionSucceeded(r: PredictionResult): boolean {
  return r.status === "succeeded" && r.pending !== true;
}

/**
 * Create a prediction and wait up to `timeoutMs` for it to finish.
 *
 * On success, normalises outputs into a list of URLs and (optionally)
 * downloads them locally. If the timeout is hit, returns a `pending`
 * result with the prediction ID for the caller to poll later.
 *
 * When `REPLICATE_WEBHOOK_PUBLIC_URL` + `REPLICATE_WEBHOOK_PORT` are set,
 * uses push-notification (webhook) instead of polling: Replicate POSTs the
 * completed prediction back to the receiver, eliminating busy-polling for
 * slow models (video, long LLM runs).
 */
export async function runPrediction(args: {
  model: string;
  input: Record<string, unknown>;
  download: boolean;
  timeoutMs?: number;
  /** Maximum polling back-off interval (ms). Defaults to POLL_INTERVAL_MS.
   *  Pass a category-specific cap from POLL_INTERVAL_BY_CATEGORY for
   *  slower model categories (video, audio) to avoid unnecessary HTTP traffic. */
  maxPollIntervalMs?: number;
}): Promise<PredictionResult> {
  const { model, input, download } = args;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPollIntervalMs = args.maxPollIntervalMs ?? POLL_INTERVAL_MS;
  const modelLabel = normaliseModelLabel(model);

  if (webhookEnabled()) {
    // Webhook path: register the pending entry BEFORE creating the prediction
    // so there is no race between Replicate firing the callback and the
    // promise being installed.
    const correlationId = randomUUID();
    const { url: webhookUrl, token } = buildCallbackUrl(correlationId);
    const webhookPromise = awaitWebhook(correlationId, token, timeoutMs);

    let prediction: Prediction;
    let usedClient: Replicate;
    try {
      ({ prediction, client: usedClient } = await createPredictionWithRetry(
        model,
        input,
        webhookUrl,
      ));
    } catch (err) {
      // Prediction creation failed — clean up the pending entry immediately
      // so GC doesn't have to wait for expiry.
      cancelPendingWebhook(correlationId);
      throw err;
    }

    try {
      const completed = (await webhookPromise) as Prediction;
      return materializeResult(completed, modelLabel, download);
    } catch {
      // Webhook timed out (GC rejected the promise). Retrieve current state
      // via the REST API and return as pending so the caller can poll.
      const current = await usedClient.predictions.get(prediction.id);
      return materializeResult(current, modelLabel, download);
    }
  }

  // Polling path (default when webhook is not configured).
  const { prediction: initial, client: usedClient } =
    await createPredictionWithRetry(model, input);
  return finishPrediction(usedClient, initial, {
    download,
    timeoutMs,
    maxPollIntervalMs,
    modelLabel,
  });
}

/**
 * Poll an already-created prediction to completion (or timeout) and
 * materialize the result — the shared "finish" half of runPrediction's
 * polling path. Exported so callers that create a prediction by a route
 * other than predictions.create (e.g. deployments.predictions.create) can
 * reuse the exact same wait + SSRF-guarded download + result-shaping logic.
 */
export async function finishPrediction(
  client: Replicate,
  prediction: Prediction,
  opts: {
    download: boolean;
    timeoutMs?: number;
    maxPollIntervalMs?: number;
    /** Override the download/label folder. Defaults to the prediction's
     *  own model id (version-suffix stripped). */
    modelLabel?: string;
  },
): Promise<PredictionResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPollIntervalMs = opts.maxPollIntervalMs ?? POLL_INTERVAL_MS;
  const modelLabel = opts.modelLabel ?? normaliseModelLabel(predictionModelLabel(prediction));
  const final = await pollUntilDone(client, prediction, timeoutMs, maxPollIntervalMs);
  return materializeResult(final, modelLabel, opts.download);
}

/** Best-effort model label for a prediction record. Deployment predictions
 *  may not carry a `model` string, so fall back to the version (or a stable
 *  placeholder) for the download folder name. */
function predictionModelLabel(prediction: Prediction): string {
  if (typeof prediction.model === "string" && prediction.model.length > 0) {
    return prediction.model;
  }
  if (typeof prediction.version === "string" && prediction.version.length > 0) {
    return `version:${prediction.version}`;
  }
  return "deployment";
}

/** Drop the version suffix from a model identifier so different forms of
 *  the same model produce the same download directory. */
function normaliseModelLabel(model: string): string {
  const colon = model.indexOf(":");
  return colon >= 0 ? model.slice(0, colon) : model;
}

/**
 * Re-check an existing prediction by ID. Used when a previous call
 * timed out and the caller wants to retrieve the final result.
 */
export async function getPredictionResult(args: {
  predictionId: string;
  download: boolean;
}): Promise<PredictionResult> {
  const client = getClient();
  const prediction = await client.predictions.get(args.predictionId);
  const model =
    prediction.model ??
    (prediction.version ? `version:${prediction.version}` : "unknown");
  return materializeResult(prediction, model, args.download);
}

/* ---------- Internals ---------- */

/** Detect a 429 / rate-limit error from the Replicate SDK. The SDK wraps
 *  API errors as generic Error objects whose message includes the status. */
function isApiRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  );
}

/** Extract a millisecond delay from a Replicate API error's Retry-After
 *  header, falling back to 60 s when the header is absent or unparseable. */
function extractApiRateLimitDelay(err: unknown): number {
  const retryAfter = (
    err as {
      response?: { headers?: { get?: (name: string) => string | null } };
    }
  ).response?.headers?.get?.("retry-after");
  return parseRetryAfter(retryAfter ?? null, 60_000);
}

/** Create a prediction, retrying with a fresh token on 429. Returns the
 *  prediction plus the client that owns it (so the caller can use the same
 *  account's auth for subsequent `predictions.get` calls). */
async function createPredictionWithRetry(
  model: string,
  input: Record<string, unknown>,
  webhookUrl?: string,
): Promise<{ prediction: Prediction; client: Replicate }> {
  // A per-request session token isn't part of the env pool — don't rotate.
  const maxAttempts = getRequestToken() ? 1 : (_pool?.size ?? 1);
  let ct = getClientAndToken();
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const prediction = await createPrediction(ct.client, model, input, webhookUrl);
      return { prediction, client: ct.client };
    } catch (err) {
      if (isApiRateLimitError(err) && _pool && _pool.size > 1) {
        const delay = extractApiRateLimitDelay(err);
        _pool.markRateLimited(ct.token, delay);
        ct = getClientAndToken();
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("All Replicate API tokens are rate-limited");
}

async function createPrediction(
  client: Replicate,
  model: string,
  input: Record<string, unknown>,
  webhookUrl?: string,
): Promise<Prediction> {
  const safeInput = stripDenylistedKeys(input);
  // Replicate accepts either "owner/name" (uses latest official version)
  // or "owner/name:version_hash" (pins a specific version). Hashes can
  // theoretically contain `:` so we slice on the first colon rather than
  // String.split with limit (which silently drops the remainder).
  const colon = model.indexOf(":");
  // Only request the "completed" event — we don't need start/output events.
  const webhookOpts = webhookUrl
    ? ({ webhook: webhookUrl, webhook_events_filter: ["completed"] } as {
        webhook: string;
        webhook_events_filter: string[];
      })
    : {};
  if (colon >= 0) {
    const version = model.slice(colon + 1);
    return client.predictions.create({ version, input: safeInput, ...webhookOpts });
  }
  return client.predictions.create({
    model: model as `${string}/${string}`,
    input: safeInput,
    ...webhookOpts,
  });
}

/** Strip Replicate request keys that allow server-side side-effects or
 *  data exfiltration (webhooks). Mutating a defensive copy keeps the
 *  caller's structuredContent intact. */
function stripDenylistedKeys(
  input: Record<string, unknown>,
): Record<string, unknown> {
  let dirty = false;
  for (const k of Object.keys(input)) {
    if (EXTRA_INPUT_DENYLIST.has(k.toLowerCase())) {
      dirty = true;
      break;
    }
  }
  if (!dirty) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!EXTRA_INPUT_DENYLIST.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

async function pollUntilDone(
  client: Replicate,
  initial: Prediction,
  timeoutMs: number,
  maxIntervalMs: number = POLL_INTERVAL_MS,
): Promise<Prediction> {
  const deadline = Date.now() + timeoutMs;
  let current = initial;
  let intervalMs = INITIAL_POLL_INTERVAL_MS;

  while (!TERMINAL_STATUSES.has(current.status)) {
    if (!KNOWN_NON_TERMINAL_STATUSES.has(current.status)) {
      // Status outside both terminal and known-in-progress sets — Replicate
      // may have introduced a new state (e.g. "queued"). Surface what we have
      // rather than busy-polling until the deadline. Caller's pending logic
      // will still flag it for follow-up via replicate_get_prediction.
      logger.warn("unknown_prediction_status", {
        status: current.status,
        prediction_id: current.id,
      });
      return current;
    }
    if (Date.now() >= deadline) {
      return current; // Caller will see pending=true
    }
    await sleep(intervalMs);
    intervalMs = Math.min(intervalMs * 2, maxIntervalMs);
    current = await client.predictions.get(current.id);
  }
  return current;
}

async function materializeResult(
  prediction: Prediction,
  modelLabel: string,
  download: boolean,
): Promise<PredictionResult> {
  const { urls, texts } = extractOutputData(prediction.output);
  const status = prediction.status as PredictionStatus;

  const predictTime = prediction.metrics?.predict_time;
  const base: PredictionResult = {
    status,
    prediction_id: prediction.id,
    model: modelLabel,
    urls,
    local_paths: [],
    text_output: texts.length > 0 ? texts : undefined,
    metrics:
      typeof predictTime === "number"
        ? { predict_time_seconds: predictTime }
        : undefined,
    error: prediction.error ? String(prediction.error) : undefined,
    logs_excerpt: tailLogs(prediction.logs),
  };

  if (status === "succeeded" && download && urls.length > 0) {
    try {
      base.local_paths = await downloadAll(urls, prediction.id, modelLabel);
    } catch (err) {
      // Preserve the prediction record even when local download fails —
      // the user still gets the prediction_id (so they can retry via
      // replicate_get_prediction) and the original Replicate URLs.
      const msg = err instanceof Error ? err.message : String(err);
      base.error = base.error
        ? `${base.error} | download failed: ${msg}`
        : `Download failed: ${msg}`;
    }
  }

  if (!TERMINAL_STATUSES.has(status)) {
    base.pending = true;
  }

  return base;
}

/**
 * Replicate model outputs are heterogeneous:
 *   - string URL
 *   - array of string URLs
 *   - object with {audio: url, video: url, image: url}
 *   - nested arrays
 *   - non-URL strings (e.g. text models) — those are returned as-is, not downloadable
 *
 * This function recursively walks the output and returns every string
 * that looks like a URL.
 */
export function extractOutputUrls(output: unknown): string[] {
  return extractOutputData(output).urls;
}

/** Export the denylist helper for direct testing. */
export { stripDenylistedKeys, assertAllowedDownloadHost };

/** Collect plain (non-URL) string outputs. LLMs and vision models return
 *  text here; classifier-style models return label strings. Streaming
 *  text models return an array of short token strings — those get joined
 *  by the caller. We return [joined, ...rawSegments] when the chunks look
 *  like a stream; for chunks that look like full sentences we join with
 *  a newline to avoid concatenating words ("hello"+"world" → "helloworld"). */
export function extractOutputTexts(output: unknown): string[] {
  return extractOutputData(output).texts;
}

/** Single-pass walker partitioning string leaves into URL and text buckets.
 *  Used by both extractOutputUrls and extractOutputTexts so we visit the
 *  prediction output structure only once per call. */
/** Maximum recursion depth for extractOutputData. Prevents stack overflow
 *  on pathological deeply-nested model outputs. */
const MAX_OUTPUT_DEPTH = 10;

export function extractOutputData(output: unknown): {
  urls: string[];
  texts: string[];
} {
  const urls: string[] = [];
  const rawTexts: string[] = [];
  const visit = (value: unknown, depth: number = 0): void => {
    if (depth > MAX_OUTPUT_DEPTH) return;
    if (value == null) return;
    if (typeof value === "string") {
      if (isHttpUrl(value)) urls.push(value);
      else if (value.length > 0) rawTexts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) {
        visit(v, depth + 1);
      }
    }
  };
  visit(output);

  let texts: string[];
  if (rawTexts.length === 0) {
    texts = [];
  } else if (rawTexts.length === 1) {
    texts = rawTexts;
  } else {
    // Heuristic: if the average chunk is short (≤ STREAMING_CHUNK_THRESHOLD)
    // treat it as a token stream and join with no separator. Otherwise the
    // chunks are full lines or sentences — join with newlines so words
    // don't collide ("Hello" + "world" → "Hello\nworld").
    const total = rawTexts.reduce((sum, s) => sum + s.length, 0);
    const avg = total / rawTexts.length;
    const joiner = avg <= STREAMING_CHUNK_THRESHOLD ? "" : "\n";
    texts = [rawTexts.join(joiner), ...rawTexts];
  }
  return { urls, texts };
}

/** Average chunk length (chars) below which we treat an array of strings
 *  as a streamed token sequence. Picked to cover whole-word streaming
 *  (~5–8 chars) but exclude sentence-level chunks. */
const STREAMING_CHUNK_THRESHOLD = 32;

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//.test(s);
}

function tailLogs(logs: string | null | undefined): string | undefined {
  if (!logs) return undefined;
  // Walk backwards from the end finding LOG_TAIL_LINES newlines so we don't
  // pay the cost of splitting a multi-MB log buffer just to drop the head.
  const trimmed = logs.trimEnd();
  if (trimmed.length === 0) return undefined;
  let cut = trimmed.length;
  for (let i = 0; i < LOG_TAIL_LINES; i++) {
    const next = trimmed.lastIndexOf("\n", cut - 1);
    if (next < 0) {
      cut = 0;
      break;
    }
    cut = next;
  }
  // `cut` is the index of the newline before the tail. Slice past it.
  const tail = trimmed.slice(cut === 0 ? 0 : cut + 1);
  return tail || undefined;
}

/** Also export for tests so the slicing behaviour can be verified directly. */
export { tailLogs };

/* ---------- File download ---------- */

async function downloadAll(
  urls: string[],
  predictionId: string,
  modelLabel: string,
): Promise<string[]> {
  // Both segments come from the Replicate API response and are alphanumeric
  // in practice, but treat them as untrusted to keep downloads strictly
  // inside DEFAULT_DOWNLOAD_DIR (defence-in-depth against path traversal).
  const dir = join(
    DEFAULT_DOWNLOAD_DIR,
    sanitize(modelLabel),
    sanitize(predictionId),
  );
  await mkdir(dir, { recursive: true });

  // Bound concurrency so a model returning many outputs can't open dozens
  // of sockets / file descriptors at once (EMFILE on Windows, throttle on
  // upstream CDN).
  return runWithConcurrency(
    urls,
    DOWNLOAD_CONCURRENCY_LIMIT,
    (url, i) => downloadOne(url, dir, i),
  );
}

/** Process items with at most `limit` workers active concurrently.
 *  Preserves input order in the result array. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Download attempts: 1 initial + DOWNLOAD_RETRY_DELAYS_MS.length retries. */
const DOWNLOAD_RETRY_DELAYS_MS = [500, 1500] as const;

async function downloadOne(
  url: string,
  dir: string,
  index: number,
): Promise<string> {
  let lastErr: unknown = new Error(`Download of ${url} failed without an error`);
  for (let attempt = 0; attempt <= DOWNLOAD_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await downloadOnce(url, dir, index);
    } catch (err) {
      lastErr = err;
      if (!isTransientDownloadError(err)) throw err;
      const delay = DOWNLOAD_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function downloadOnce(
  url: string,
  dir: string,
  index: number,
): Promise<string> {
  assertAllowedDownloadHost(url);
  // `redirect: "manual"` would block legitimate Replicate CDN redirects;
  // instead we follow redirects but re-validate the FINAL response URL
  // against the allowlist (Replicate.delivery may issue 30x to a sibling
  // hostname in the same trust boundary, which is acceptable).
  const response = await fetch(url, { redirect: "follow" });

  // Honour upstream back-pressure: if Replicate's CDN tells us to slow
  // down, respect Retry-After and surface as a transient error so the
  // outer retry loop sleeps the right amount before the next attempt.
  if (isRateLimitedResponse(response.status)) {
    const wait = parseRetryAfter(response.headers.get("retry-after"));
    await sleep(wait);
    throw new HttpDownloadError(url, response.status, response.statusText);
  }

  if (!response.ok || !response.body) {
    throw new HttpDownloadError(url, response.status, response.statusText);
  }
  assertAllowedDownloadHost(response.url || url);

  const filename = inferFilename(url, response.headers.get("content-type"), index);
  const filepath = join(dir, filename);

  // Use Node stream pipeline for memory-safe download of large files (videos).
  // A pass-through transform tracks bytes seen and aborts the pipeline if
  // an upstream response exceeds MAX_DOWNLOAD_BYTES (disk-fill defence).
  const nodeStream = Readable.fromWeb(
    response.body as unknown as import("stream/web").ReadableStream,
  );
  const sizeGuard = makeSizeLimitTransform(MAX_DOWNLOAD_BYTES, url);
  await pipeline(nodeStream, sizeGuard, createWriteStream(filepath));
  return filepath;
}

/** Reject URLs whose host is not on the Replicate allowlist. Guards
 *  against SSRF if a prediction response is ever spoofed to redirect
 *  the download path at an internal service. */
function assertAllowedDownloadHost(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`Refusing to download from invalid URL: ${url}`);
  }
  if (!REPLICATE_ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `Refusing to download from unexpected host "${host}". Allowed: ${[
        ...REPLICATE_ALLOWED_HOSTS,
      ].join(", ")}.`,
    );
  }
}

/** PassThrough that counts bytes and aborts when the cap is exceeded.
 *  Used by downloadOnce so a malicious or runaway upstream can't fill
 *  the user's disk. */
function makeSizeLimitTransform(limit: number, url: string) {
  let seen = 0;
  return new PassThrough({
    transform(chunk, _enc, cb) {
      seen += (chunk as Buffer).length;
      if (seen > limit) {
        cb(
          new Error(
            `Download from ${url} exceeded the ${limit}-byte cap (saw ${seen} bytes).`,
          ),
        );
        return;
      }
      cb(null, chunk);
    },
  });
}

export class HttpDownloadError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly statusText: string,
  ) {
    super(`Failed to download ${url}: HTTP ${status} ${statusText}`);
    this.name = "HttpDownloadError";
  }
}

/** Retry only on transient failures: network errors, 429 rate-limit, 5xx.
 *  4xx (other than 429) is a client/auth/URL problem — retrying won't help. */
export function isTransientDownloadError(err: unknown): boolean {
  if (err instanceof HttpDownloadError) {
    if (err.status === 429) return true;
    return err.status >= 500;
  }
  // fetch() throws TypeError on connection-level failure (DNS, reset).
  if (err instanceof Error && err.name === "TypeError") return true;
  // Node's undici may surface lower-level details via `cause.code`.
  const code = (err as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  if (typeof code === "string" && TRANSIENT_CAUSE_CODES.has(code)) return true;
  // AbortError is treated as transient unless the caller specifically
  // aborted; in our retry loop we never abort, so fetch's internal
  // timeout/abort behaves like a connection drop.
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

/** Lower-level error codes that map to "retry it" — DNS hiccups, server
 *  resets, idle-connection drops. 4xx-equivalents like ENOTFOUND for a
 *  truly bad hostname are deliberately omitted. */
const TRANSIENT_CAUSE_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

export function inferFilename(
  url: string,
  contentType: string | null,
  index: number,
): string {
  // Try URL extension first.
  try {
    const pathname = new URL(url).pathname;
    const ext = extname(pathname);
    if (ext && ext.length <= MAX_FILENAME_EXT_LEN) {
      const base = `output-${index}${ext}`;
      return base;
    }
  } catch {
    // Fall through to content-type based naming.
  }

  // Fall back to content-type.
  const ext = contentTypeToExt(contentType);
  return `output-${index}${ext}`;
}

export function contentTypeToExt(contentType: string | null): string {
  if (!contentType) return ".bin";
  const ct = contentType.split(";")[0]!.trim().toLowerCase();
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "application/json": ".json",
    "text/plain": ".txt",
  };
  return map[ct] ?? ".bin";
}

export function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, MAX_SANITISED_LABEL_LEN);
}

/* ---------- Discovery: search & schema ---------- */

export interface ModelSummary {
  owner: string;
  name: string;
  description?: string;
  url: string;
  run_count?: number;
  cover_image_url?: string;
}

interface ReplicateModelSummary {
  owner: string;
  name: string;
  description?: string;
  url?: string;
  run_count?: number;
  cover_image_url?: string;
}

function asModelSummary(value: unknown): ReplicateModelSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  if (typeof m["owner"] !== "string" || typeof m["name"] !== "string") return null;
  return {
    owner: m["owner"],
    name: m["name"],
    description: nonEmptyString(m["description"]),
    url: nonEmptyString(m["url"]),
    run_count: typeof m["run_count"] === "number" ? m["run_count"] : undefined,
    cover_image_url: nonEmptyString(m["cover_image_url"]),
  };
}

/** Treat empty / non-string values as missing so `??` fallbacks behave
 *  intuitively when the upstream payload contains `""` instead of omitting
 *  the field. */
function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function searchModels(query: string): Promise<ModelSummary[]> {
  const client = getClient();
  // The Node SDK exposes search via models.search() returning a Page<Model>.
  const page = await client.models.search(query);
  const rawItems = Array.isArray(page.results) ? page.results : [];
  const summaries: ModelSummary[] = [];
  for (const raw of rawItems.slice(0, MAX_SEARCH_RESULTS)) {
    const m = asModelSummary(raw);
    if (!m) continue;
    summaries.push({
      owner: m.owner,
      name: m.name,
      description: m.description,
      url: m.url ?? `https://replicate.com/${m.owner}/${m.name}`,
      run_count: m.run_count,
      cover_image_url: m.cover_image_url,
    });
  }
  return summaries;
}

export interface ModelSchema {
  model: string;
  description?: string;
  visibility?: string;
  latest_version_id?: string;
  input_schema?: unknown;
  output_schema?: unknown;
  example_url?: string;
}

/** In-memory cache for getModelSchema results — Replicate model metadata
 *  rarely changes within a single session and re-fetching every lookup
 *  wastes a round-trip. */
const schemaCache = new Map<string, { value: ModelSchema; expiresAt: number }>();

export function clearSchemaCache(): void {
  schemaCache.clear();
}

export async function getModelSchema(modelId: string): Promise<ModelSchema> {
  // Normalise the cache key by stripping any version hash so that
  // "owner/name:abc123" and "owner/name" share the same cache entry —
  // both resolve to the same model metadata via client.models.get().
  const colon = modelId.indexOf(":");
  const cacheKey = colon >= 0 ? modelId.slice(0, colon) : modelId;
  const cached = schemaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug("schema_cache_hit", { model: modelId });
    return cached.value;
  }
  const client = getClient();
  const { owner, name } = parseOwnerName(modelId);
  const model = await client.models.get(owner, name);

  const latest = model.latest_version;
  const openapi =
    (latest?.openapi_schema as
      | {
          components?: {
            schemas?: {
              Input?: unknown;
              Output?: unknown;
            };
          };
        }
      | undefined) ?? undefined;

  const result: ModelSchema = {
    model: `${model.owner}/${model.name}`,
    description: model.description,
    visibility: model.visibility,
    latest_version_id: latest?.id,
    input_schema: openapi?.components?.schemas?.Input,
    output_schema: openapi?.components?.schemas?.Output,
    example_url: model.url,
  };
  schemaCache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS,
  });
  return result;
}

/* ---------- Prediction management ---------- */

export interface PredictionSummary {
  id: string;
  model?: string;
  status: string;
  created_at?: string;
  completed_at?: string;
  url?: string;
}

/** List the most recent predictions from the authenticated account. */
export async function listPredictions(
  limit: number,
): Promise<PredictionSummary[]> {
  const client = getClient();
  const page = await client.predictions.list();
  const items = (page.results ?? []) as unknown as Array<Record<string, unknown>>;
  return items.slice(0, limit).map((p) => ({
    id: String(p["id"] ?? ""),
    model: typeof p["model"] === "string" ? (p["model"] as string) : undefined,
    status: String(p["status"] ?? "unknown"),
    created_at:
      typeof p["created_at"] === "string" ? (p["created_at"] as string) : undefined,
    completed_at:
      typeof p["completed_at"] === "string"
        ? (p["completed_at"] as string)
        : undefined,
    url:
      typeof p["urls"] === "object" && p["urls"] !== null
        ? ((p["urls"] as Record<string, unknown>)["get"] as string | undefined)
        : undefined,
  }));
}

/** Cancel an in-progress prediction. Replicate returns the updated record. */
export async function cancelPrediction(
  predictionId: string,
): Promise<PredictionSummary> {
  const client = getClient();
  const p = (await client.predictions.cancel(predictionId)) as unknown as Record<
    string,
    unknown
  >;
  return {
    id: String(p["id"] ?? predictionId),
    model: typeof p["model"] === "string" ? (p["model"] as string) : undefined,
    status: String(p["status"] ?? "canceled"),
    created_at:
      typeof p["created_at"] === "string" ? (p["created_at"] as string) : undefined,
    completed_at:
      typeof p["completed_at"] === "string"
        ? (p["completed_at"] as string)
        : undefined,
  };
}

function parseOwnerName(modelId: string): { owner: string; name: string } {
  const [ownerName] = modelId.split(":", 1);
  const parts = ownerName!.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid model id "${modelId}". Expected format "owner/name" or "owner/name:version".`,
    );
  }
  return { owner: parts[0], name: parts[1] };
}

/* ---------- Trainings (fine-tuning) ---------- */

/** Compact view of a Replicate training record — the fields useful for
 *  status reporting without dumping the full input/logs payload. */
export interface TrainingSummary {
  id: string;
  status: string;
  model?: string;
  version?: string;
  destination?: string;
  created_at?: string;
  completed_at?: string;
  url?: string;
  /** Trained model version id, present once the training succeeds. */
  output_version?: string;
  error?: string;
}

/** Defensively map a raw training record (SDK type or plain object) into a
 *  TrainingSummary. Mirrors the asModelSummary / PredictionSummary mappers:
 *  never trusts a field's presence/type. */
function asTrainingSummary(value: unknown): TrainingSummary {
  const t = (typeof value === "object" && value !== null
    ? value
    : {}) as Record<string, unknown>;
  const urls =
    typeof t["urls"] === "object" && t["urls"] !== null
      ? (t["urls"] as Record<string, unknown>)
      : undefined;
  const output =
    typeof t["output"] === "object" && t["output"] !== null
      ? (t["output"] as Record<string, unknown>)
      : undefined;
  return {
    id: String(t["id"] ?? ""),
    status: String(t["status"] ?? "unknown"),
    model: nonEmptyString(t["model"]),
    version: nonEmptyString(t["version"]),
    destination: nonEmptyString(t["destination"]),
    created_at: nonEmptyString(t["created_at"]),
    completed_at: nonEmptyString(t["completed_at"]),
    url: urls ? nonEmptyString(urls["get"]) : undefined,
    output_version: output ? nonEmptyString(output["version"]) : undefined,
    error: t["error"] != null ? String(t["error"]) : undefined,
  };
}

/** Start a fine-tuning run. `model` is the BASE trainer "owner/name"
 *  (optionally ":version" — when present that version pin wins over the
 *  separate `version` arg); `destination` is the "owner/name" the trained
 *  weights are pushed to. */
export async function createTraining(args: {
  model: string;
  version: string;
  destination: string;
  input: Record<string, unknown>;
}): Promise<TrainingSummary> {
  const client = getClient();
  const { owner, name } = parseOwnerName(args.model);
  // Allow callers to pin the trainer version inline as "owner/name:version".
  const colon = args.model.indexOf(":");
  const versionId = colon >= 0 ? args.model.slice(colon + 1) : args.version;
  if (!versionId) {
    throw new Error(
      "A trainer version id is required. Pass it via `version` or inline as \"owner/name:version\".",
    );
  }
  // Validate the destination shape up-front so the caller gets a clear
  // message instead of a 422 from the API.
  parseOwnerName(args.destination);
  const training = (await client.trainings.create(
    owner,
    name,
    versionId,
    {
      destination: args.destination as `${string}/${string}`,
      input: stripDenylistedKeys(args.input),
    },
  )) as unknown as Training;
  return asTrainingSummary(training);
}

/** Retrieve a single training by id. */
export async function getTraining(trainingId: string): Promise<TrainingSummary> {
  const client = getClient();
  const training = await client.trainings.get(trainingId);
  return asTrainingSummary(training);
}

/** List the most recent trainings on the authenticated account. */
export async function listTrainings(limit: number): Promise<TrainingSummary[]> {
  const client = getClient();
  const page = await client.trainings.list();
  const items = (page.results ?? []) as unknown[];
  return items.slice(0, limit).map(asTrainingSummary);
}

/** Cancel an in-progress training. Replicate returns the updated record. */
export async function cancelTraining(
  trainingId: string,
): Promise<TrainingSummary> {
  const client = getClient();
  const training = await client.trainings.cancel(trainingId);
  return asTrainingSummary(training);
}

/* ---------- Deployments ---------- */

/** Compact view of a Replicate deployment — owner/name plus the current
 *  release's model/version/hardware when the API surfaces them. */
export interface DeploymentSummary {
  owner: string;
  name: string;
  current_release?: {
    number?: number;
    model?: string;
    version?: string;
    hardware?: string;
    min_instances?: number;
    max_instances?: number;
  };
}

/** Defensively map a raw deployment record into a DeploymentSummary. The
 *  current_release block is optional and its configuration may be partial. */
function asDeploymentSummary(value: unknown): DeploymentSummary {
  const d = (typeof value === "object" && value !== null
    ? value
    : {}) as Record<string, unknown>;
  const release =
    typeof d["current_release"] === "object" && d["current_release"] !== null
      ? (d["current_release"] as Record<string, unknown>)
      : undefined;
  const config =
    release &&
    typeof release["configuration"] === "object" &&
    release["configuration"] !== null
      ? (release["configuration"] as Record<string, unknown>)
      : undefined;
  const summary: DeploymentSummary = {
    owner: String(d["owner"] ?? ""),
    name: String(d["name"] ?? ""),
  };
  if (release) {
    summary.current_release = {
      number:
        typeof release["number"] === "number" ? release["number"] : undefined,
      model: nonEmptyString(release["model"]),
      version: nonEmptyString(release["version"]),
      hardware: config ? nonEmptyString(config["hardware"]) : undefined,
      min_instances:
        config && typeof config["min_instances"] === "number"
          ? (config["min_instances"] as number)
          : undefined,
      max_instances:
        config && typeof config["max_instances"] === "number"
          ? (config["max_instances"] as number)
          : undefined,
    };
  }
  return summary;
}

/** List the deployments on the authenticated account. */
export async function listDeployments(
  limit: number,
): Promise<DeploymentSummary[]> {
  const client = getClient();
  const page = await client.deployments.list();
  const items = (page.results ?? []) as unknown[];
  return items.slice(0, limit).map(asDeploymentSummary);
}

/** Retrieve a single deployment by owner + name. */
export async function getDeployment(
  owner: string,
  name: string,
): Promise<DeploymentSummary> {
  const client = getClient();
  const deployment = (await client.deployments.get(
    owner,
    name,
  )) as unknown as Deployment;
  return asDeploymentSummary(deployment);
}

/**
 * Run a deployment: create a prediction against the deployment's current
 * release, then WAIT + DOWNLOAD using the same machinery as the generate_*
 * tools (finishPrediction → pollUntilDone + SSRF-guarded materializeResult).
 * This wait-and-download behaviour is the differentiator vs the official MCP.
 */
export async function runDeployment(args: {
  owner: string;
  name: string;
  input: Record<string, unknown>;
  download: boolean;
  timeoutMs?: number;
}): Promise<PredictionResult> {
  const client = getClient();
  const prediction = await client.deployments.predictions.create(
    args.owner,
    args.name,
    { input: stripDenylistedKeys(args.input) },
  );
  return finishPrediction(client, prediction, {
    download: args.download,
    timeoutMs: args.timeoutMs,
    modelLabel: `${args.owner}/${args.name}`,
  });
}

/* ---------- File upload ---------- */

/** Upload a local file to Replicate's file storage. Returns a URL valid for
 *  ~24 hours that can be used as an input to other Replicate models. */
/** Core upload: push a Buffer to Replicate file storage and return its URL. */
async function uploadBuffer(
  buf: Buffer,
  name: string,
  mimeType: string,
): Promise<{ url: string; file_id: string; name: string }> {
  if (buf.length === 0) {
    throw new Error("Refusing to upload an empty file.");
  }
  if (buf.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `File is ${buf.length} bytes, exceeds the ${MAX_DOWNLOAD_BYTES}-byte upload cap.`,
    );
  }
  const client = getClient();
  // Wrap in a fresh Uint8Array so the BlobPart is backed by a plain
  // ArrayBuffer (Buffer's generic ArrayBufferLike isn't a valid BlobPart
  // under strict types).
  const blob = new Blob([new Uint8Array(buf)], { type: mimeType });
  // The Replicate SDK exposes client.files.create(blob, { filename }).
  type FilesApi = {
    create: (
      file: Blob,
      meta?: { filename?: string },
    ) => Promise<{ id: string; name: string; urls: { get: string } }>;
  };
  const file = await (client as unknown as { files: FilesApi }).files.create(
    blob,
    { filename: name },
  );
  logger.info("file_uploaded", { name, size: buf.length, mime: mimeType });
  return { url: file.urls.get, file_id: file.id, name: file.name };
}

export async function uploadFile(
  filePath: string,
  mimeType?: string,
): Promise<{ url: string; file_id: string; name: string }> {
  const buf = await readFile(filePath);
  const resolvedMime = mimeType ?? guessUploadMimeType(filePath);
  return uploadBuffer(buf, basename(filePath), resolvedMime);
}

/** Upload an image/file supplied as base64 (optionally a `data:` URI).
 *  Lets clients that hold bytes in memory (e.g. a code container that read a
 *  chat-uploaded image) push them to Replicate without a local file path. */
export async function uploadBase64(args: {
  data: string;
  mimeType?: string;
  fileName?: string;
}): Promise<{ url: string; file_id: string; name: string }> {
  let raw = args.data.trim();
  let mime = args.mimeType;
  // Accept a full data URI of the form data:<mediatype>;base64,<payload>.
  // <mediatype> may carry parameters (e.g. image/png;charset=binary;base64),
  // so split on the FIRST comma rather than assuming a fixed prefix shape.
  if (raw.startsWith("data:")) {
    const comma = raw.indexOf(",");
    if (comma === -1) {
      throw new Error("Malformed data URI: missing comma before the payload.");
    }
    const mediatype = raw.slice(5, comma); // between "data:" and ","
    if (!/;base64/i.test(mediatype)) {
      throw new Error(
        "Only base64 data URIs are supported (data:<mime>;base64,...).",
      );
    }
    // MIME is the part before the first ';' (parameters stripped).
    const mimePart = mediatype.split(";")[0]!.trim();
    if (!mime && mimePart) mime = mimePart;
    raw = raw.slice(comma + 1);
  }
  raw = raw.replace(/\s/g, "");
  if (raw.length === 0) {
    throw new Error("base64 data is empty.");
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new Error("Invalid base64 data.");
  }
  if (buf.length === 0) {
    throw new Error("base64 data decoded to zero bytes — not valid base64.");
  }
  const resolvedMime = mime ?? "application/octet-stream";
  const name = args.fileName ?? `upload-${randomUUID()}${extForMime(resolvedMime)}`;
  return uploadBuffer(buf, name, resolvedMime);
}

/** Minimal MIME → extension map for naming base64 uploads. */
function extForMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
  };
  return map[mime] ?? "";
}

function guessUploadMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".json": "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}

/* ---------- Util ---------- */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
