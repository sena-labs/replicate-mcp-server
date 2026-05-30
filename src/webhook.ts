/**
 * Optional webhook-based prediction completion.
 *
 * When `REPLICATE_WEBHOOK_PUBLIC_URL` is set, the server starts a small
 * HTTP listener on `REPLICATE_WEBHOOK_PORT` (default 8089) and tells
 * Replicate to POST completed predictions back to it. This replaces the
 * polling loop for those predictions with an event-driven flow:
 *
 *   1. createPrediction(... webhook: PUBLIC_URL + "/webhook/{id}?token=X")
 *   2. Caller awaits the pending registration
 *   3. Replicate finishes → POSTs final state → server resolves the promise
 *
 * Trade-off: Replicate must be able to reach the PUBLIC_URL from the
 * internet. If you can't expose a public endpoint (NAT, firewall),
 * leave the env vars unset and the server falls back to polling.
 *
 * Security:
 *   - Each webhook URL embeds a per-prediction shared token (random
 *     32-char hex) so a third party can't forge completion callbacks.
 *   - The server only accepts POST /webhook/{id}?token=X for predictions
 *     it is actively waiting on.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { logger } from "./logger.js";

interface PendingWebhook {
  token: string;
  resolve: (prediction: unknown) => void;
  reject: (err: Error) => void;
  expiresAt: number;
}

const pending = new Map<string, PendingWebhook>();
let publicBase: string | null = null;
let started = false;

/** Returns true if webhook mode is enabled — caller should request a
 *  callback URL instead of polling. */
export function webhookEnabled(): boolean {
  return publicBase !== null;
}

/** Start the webhook receiver. Idempotent. */
export async function startWebhookReceiver(
  host: string,
  port: number,
  publicUrl: string,
): Promise<void> {
  if (started) return;
  publicBase = publicUrl.replace(/\/$/, "");

  const http = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => {
      http.off("error", reject);
      resolve();
    });
  });
  started = true;
  logger.info("webhook_receiver_listening", {
    host,
    port,
    public_url: publicBase,
  });
  console.error(
    `replicate-mcp-server webhook receiver on http://${host}:${port}/webhook/* (public: ${publicBase})`,
  );

  // Garbage-collect stuck pending entries every minute. Stale entries
  // accumulate if predictions never complete and the awaiting tool call
  // already timed out on the MCP side.
  setInterval(() => {
    const now = Date.now();
    for (const [id, p] of pending) {
      if (p.expiresAt <= now) {
        pending.delete(id);
        p.reject(new Error(`webhook timeout for ${id}`));
      }
    }
  }, 60_000).unref();
}

/** Build the callback URL Replicate should POST to when a prediction completes.
 *  `correlationId` is a caller-controlled UUID embedded in the path so the
 *  receiver can match the callback to a pending `awaitWebhook` call without
 *  knowing the Replicate prediction id in advance.
 *  Caller passes the returned `url` as the `webhook` field in createPrediction. */
export function buildCallbackUrl(correlationId: string): {
  url: string;
  token: string;
} {
  if (!publicBase) {
    throw new Error("Webhook receiver is not enabled");
  }
  const token = randomBytes(16).toString("hex");
  const url = `${publicBase}/webhook/${encodeURIComponent(correlationId)}?token=${token}`;
  return { url, token };
}

/** Register interest in a correlation id. The returned promise resolves
 *  when Replicate POSTs to the webhook URL, or rejects on timeout.
 *  Call BEFORE `createPrediction` to eliminate the race between Replicate
 *  firing the callback and the promise being registered. */
export function awaitWebhook(
  correlationId: string,
  token: string,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pending.set(correlationId, {
      token,
      resolve,
      reject,
      expiresAt: Date.now() + timeoutMs,
    });
  });
}

/** Remove a pending webhook entry — call when prediction creation fails so
 *  the map doesn't accumulate stale entries waiting for the GC interval. */
export function cancelPendingWebhook(correlationId: string): void {
  pending.delete(correlationId);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Health endpoint for liveness probes.
  if (req.method === "GET" && req.url === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok", pending: pending.size }));
    return;
  }

  if (req.method !== "POST" || !req.url) {
    res.statusCode = 405;
    res.end();
    return;
  }

  const m = req.url.match(/^\/webhook\/([^?]+)(?:\?(.*))?$/);
  if (!m) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const predictionId = decodeURIComponent(m[1]!);
  const query = new URLSearchParams(m[2] ?? "");
  const token = query.get("token") ?? "";

  const entry = pending.get(predictionId);
  if (!entry) {
    // Either we already resolved or this is a forged callback. Either
    // way: not our problem.
    res.statusCode = 404;
    res.end();
    return;
  }

  if (!constantTimeEq(entry.token, token)) {
    logger.warn("webhook_bad_token", { prediction_id: predictionId });
    res.statusCode = 401;
    res.end();
    return;
  }

  // Read body, parse JSON, resolve promise.
  const chunks: Buffer[] = [];
  try {
    for await (const c of req) chunks.push(c as Buffer);
  } catch (err) {
    res.statusCode = 400;
    res.end();
    entry.reject(err as Error);
    pending.delete(predictionId);
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.statusCode = 400;
    res.end();
    return;
  }

  pending.delete(predictionId);
  entry.resolve(body);
  res.statusCode = 204;
  res.end();
  logger.info("webhook_resolved", { prediction_id: predictionId });
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
