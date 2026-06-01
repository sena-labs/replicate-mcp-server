import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const { startHttpTransport } = await import("../../dist/http-server.js");

const PORT = 39518;
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;
const API_KEY = "test-api-key-1234567"; // ≥ 16 chars

let httpServer;

before(async () => {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  httpServer = await startHttpTransport({
    server: mcp,
    port: PORT,
    host: HOST,
    apiKey: API_KEY,
    statusCallback: () => ({ webhook_enabled: false, token_pool_size: 2 }),
  });
});

after(async () => {
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(() => resolve()));
  }
});

test("GET /health → 200 with status ok and statusCallback fields", async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.webhook_enabled, false);
  assert.equal(body.token_pool_size, 2);
});

test("GET /healthz → 200 (alias)", async () => {
  const res = await fetch(`${BASE}/healthz`);
  assert.equal(res.status, 200);
});

test("GET unknown path → 404 not_found", async () => {
  const res = await fetch(`${BASE}/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "not_found");
});

test("POST /mcp without Authorization → 401 (auth enabled)", async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 401);
});

test("POST /mcp with wrong Bearer → 401", async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer wrong-key-000000",
    },
    body: "{}",
  });
  assert.equal(res.status, 401);
});

test("POST /mcp with correct Bearer → passes auth (not 401)", async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  // We don't assert a specific success code (depends on the MCP handshake);
  // the point is the request got PAST the auth gate.
  assert.notEqual(res.status, 401);
  assert.notEqual(res.status, 404);
});
