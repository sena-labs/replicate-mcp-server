/**
 * HTTP/SSE transport runner for the MCP server.
 *
 * Hosts the MCP server on a configurable port (default 8088) using the
 * official `StreamableHTTPServerTransport`. Supports both:
 *   - Stateful sessions (one transport per Mcp-Session-Id header), and
 *   - Stateless mode (transport per request, no session)
 *
 * Optional Bearer-token auth via `--api-key` / `HTTP_API_KEY` env var.
 * When the api key is absent the server runs unauthenticated and must
 * be put behind a private network or reverse proxy with its own auth.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "./logger.js";
import { requestContext, type RequestContext } from "./request-context.js";

export interface HttpServerOptions {
  /** Factory that builds a fresh McpServer. Called once per session — a single
   *  McpServer can only be connected to one transport at a time. */
  createServer: () => McpServer;
  port: number;
  host: string;
  apiKey?: string;
  /** Optional callback that returns extra fields merged into the /health
   *  response. Called on every health check — keep it cheap. */
  statusCallback?: () => Record<string, unknown>;
}

export async function startHttpTransport(
  opts: HttpServerOptions,
): Promise<import("node:http").Server> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const http = createServer(async (req, res) => {
    try {
      // Health endpoint — useful for load balancers / liveness probes.
      if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
        const extra = opts.statusCallback?.() ?? {};
        respondJson(res, 200, { status: "ok", ...extra });
        return;
      }

      // All MCP traffic flows through /mcp.
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname !== "/mcp") {
        respondJson(res, 404, { error: "not_found", path: url.pathname });
        return;
      }

      if (!authorise(req, opts.apiKey)) {
        respondJson(res, 401, { error: "unauthorized" });
        return;
      }

      const body = await readJsonBody(req);
      const sessionId = pickSessionId(req);
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        // New session — generate an id, build a dedicated server, and stand up
        // a fresh transport. Each session gets its OWN McpServer because one
        // server can only be connected to a single transport at a time.
        const newId = sessionId ?? randomUUID();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newId,
        });
        const sessionServer = opts.createServer();
        // Remove from map + close the per-session server when the session ends,
        // so neither the map nor server instances grow without bound.
        transport.onclose = () => {
          transports.delete(newId);
          void sessionServer.close();
        };
        await sessionServer.connect(transport);
        transports.set(newId, transport);
        // The SDK transport sets the Mcp-Session-Id response header on the
        // initialize response automatically; subsequent calls reuse it.
      }

      // Multi-tenant: carry the caller's own Replicate token (from the
      // gateway/Smithery per-user session config) for this request only.
      const ctx = parseSessionConfig(url, req.headers);
      await requestContext.run(ctx, () => transport!.handleRequest(req, res, body));
    } catch (err) {
      logger.error("http_request_failed", {
        message: err instanceof Error ? err.message : String(err),
        url: req.url,
        method: req.method,
      });
      if (!res.headersSent) {
        respondJson(res, 500, { error: "internal_error" });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, opts.host, () => {
      http.off("error", reject);
      resolve();
    });
  });

  logger.info("http_transport_listening", {
    host: opts.host,
    port: opts.port,
    auth: opts.apiKey ? "bearer" : "none",
  });
  // Visible boot banner so operators see it in the terminal.
  console.error(
    `replicate-mcp-server HTTP transport on http://${opts.host}:${opts.port}/mcp ` +
      (opts.apiKey ? "(Bearer auth enabled)" : "(UNAUTHENTICATED — bind to localhost or put behind a reverse proxy)"),
  );
  // Returned so callers (and tests) can close the listener for clean shutdown.
  return http;
}

function authorise(req: IncomingMessage, apiKey?: string): boolean {
  if (!apiKey) return true; // unauthenticated mode
  const header = req.headers["authorization"];
  if (typeof header !== "string") return false;
  const expected = `Bearer ${apiKey}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function pickSessionId(req: IncomingMessage): string | undefined {
  const v = req.headers["mcp-session-id"];
  if (typeof v === "string" && v.length > 0) return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return undefined;
}

/** Parse the per-user session config a hosting gateway (e.g. Smithery) attaches
 *  to each request, returning the caller's Replicate token (if any).
 *
 *  Smithery forwards each config-schema field to the upstream server per its
 *  `x-from`: by default a query param named exactly after the property, or — if
 *  the schema declares `x-from: { header: "x-replicate-api-token" }` — an HTTP
 *  header. We PREFER the header (keeps the secret out of access logs / URLs) and
 *  fall back to the query param. Returns {} for plain stdio/local use, so the
 *  env token pool is used unchanged.
 *
 *  Note: the base64 `?config=` blob is a client-side deep-link install detail
 *  and never reaches the server on the wire, so we don't look for it here. */
export function parseSessionConfig(
  url: URL,
  headers: IncomingMessage["headers"] = {},
): RequestContext {
  // Preferred: token as a header (set via x-from header on the config schema).
  const h = headers["x-replicate-api-token"];
  const headerTok = Array.isArray(h) ? h[0] : h;
  if (typeof headerTok === "string" && headerTok.length > 0) {
    return { replicateToken: headerTok };
  }
  // Default Smithery transport: a query param named after the schema property.
  const q = url.searchParams;
  const direct = q.get("replicate_api_token") ?? q.get("replicateApiToken");
  if (direct) return { replicateToken: direct };
  return {};
}

/** 10 MB hard cap — guards against OOM via oversized POST bodies. */
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      req.destroy();
      return undefined;
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
