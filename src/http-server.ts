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
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "./logger.js";

export interface HttpServerOptions {
  server: McpServer;
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
        // New session — generate an id and stand up a fresh transport.
        const newId = sessionId ?? randomUUID();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newId,
        });
        // Remove from map when the session closes so the map doesn't grow
        // without bound in long-running servers.
        transport.onclose = () => transports.delete(newId);
        await opts.server.connect(transport);
        transports.set(newId, transport);
        // The SDK transport sets the Mcp-Session-Id response header on the
        // initialize response automatically; subsequent calls reuse it.
      }

      await transport.handleRequest(req, res, body);
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
  // Constant-time-ish comparison: same length, char-by-char OR (avoid
  // the easy timing leak when the header is much shorter than expected).
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function pickSessionId(req: IncomingMessage): string | undefined {
  const v = req.headers["mcp-session-id"];
  if (typeof v === "string" && v.length > 0) return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return undefined;
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
