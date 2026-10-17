import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startHttpTransport } from "../../dist/http-server.js";

const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: {
  protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "limits-test", version: "1" },
}};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function app(options = {}) {
  const server = await startHttpTransport({ host: "127.0.0.1", port: 0,
    createServer: () => new McpServer({ name: "test", version: "1" }), ...options });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (body, extra = {}) => {
    const res = await fetch(base + "/mcp", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const text = await res.text();
    return { res, text, id: res.headers.get("mcp-session-id") };
  };
  return { server, base, request, close: () => new Promise(resolve => server.close(resolve)) };
}

test("HTTP rejects spoofed-IP quota bypass before allocating servers", async () => {
  let created = 0;
  const a = await app({ limits: { ipBurst: 1, ipPerMinute: 1 }, createServer: () => {
    created++; return new McpServer({ name: "test", version: "1" });
  }});
  try {
    assert.equal((await a.request(init)).res.status, 200);
    const denied = await a.request(init, { "x-real-ip": "192.0.2.2", "x-forwarded-for": "192.0.2.3" });
    assert.equal(denied.res.status, 429);
    assert.match(denied.res.headers.get("retry-after"), /^[1-9]\d*$/);
    assert.equal(denied.res.headers.get("cache-control"), "no-store");
    assert.equal(created, 1);
  } finally { await a.close(); }
});

test("HTTP global quota applies across trusted-proxy client identities", async () => {
  const a = await app({ trustedProxyCidrs: ["127.0.0.1/32"], limits: { globalBurst: 1, globalPerMinute: 1 } });
  try {
    assert.equal((await a.request(init, { "x-real-ip": "192.0.2.1" })).res.status, 200);
    assert.equal((await a.request(init, { "x-real-ip": "192.0.2.2" })).res.status, 429);
  } finally { await a.close(); }
});

test("HTTP enforces per-IP and total session caps; DELETE frees capacity", async () => {
  const a = await app({ trustedProxyCidrs: ["127.0.0.1/32"], limits: { sessionsPerIp: 1, maxSessions: 2 } });
  try {
    const first = await a.request(init, { "x-real-ip": "192.0.2.1" });
    assert.equal(first.res.status, 200);
    assert.equal((await a.request(init, { "x-real-ip": "192.0.2.1" })).res.status, 429);
    assert.equal((await a.request(init, { "x-real-ip": "192.0.2.2" })).res.status, 200);
    assert.equal((await a.request(init, { "x-real-ip": "192.0.2.3" })).res.status, 429);
    const deleted = await fetch(a.base + "/mcp", { method: "DELETE", headers: { ...headers, "mcp-session-id": first.id, "x-real-ip": "192.0.2.1" } });
    assert.equal(deleted.status, 200); await deleted.text();
    assert.equal((await a.request(init, { "x-real-ip": "192.0.2.3" })).res.status, 200);
  } finally { await a.close(); }
});

test("HTTP reserves session capacity before asynchronous initialization", async () => {
  let created = 0;
  const a = await app({ limits: { sessionsPerIp: 1 }, createServer: () => {
    created++;
    const server = new McpServer({ name: "test", version: "1" });
    const connect = server.connect.bind(server);
    server.connect = async transport => { await pause(40); return connect(transport); };
    return server;
  }});
  try {
    const results = await Promise.all(Array.from({ length: 5 }, () => a.request(init)));
    assert.equal(results.filter(x => x.res.status === 200).length, 1);
    assert.equal(results.filter(x => x.res.status === 429).length, 4);
    assert.equal(created, 1);
  } finally { await a.close(); }
});

test("HTTP failed initialization releases its reserved capacity", async () => {
  let created = 0;
  const a = await app({ limits: { sessionsPerIp: 1 }, createServer: () => {
    if (++created === 1) throw new Error("intentional initialization failure");
    return new McpServer({ name: "test", version: "1" });
  }});
  try {
    assert.equal((await a.request(init)).res.status, 500);
    assert.equal((await a.request(init)).res.status, 200);
  } finally { await a.close(); }
});

test("HTTP pending initialization is not expired by the idle sweeper", async () => {
  let unlock, signal;
  const wait = new Promise(resolve => { unlock = resolve; });
  const started = new Promise(resolve => { signal = resolve; });
  const a = await app({ limits: { sessionIdleMs: 40, sessionsPerIp: 1 }, createServer: () => {
    const server = new McpServer({ name: "test", version: "1" });
    const connect = server.connect.bind(server);
    server.connect = async transport => { signal(); await wait; return connect(transport); };
    return server;
  }});
  try {
    const first = a.request(init);
    await started;
    await pause(100);
    assert.equal((await a.request(init)).res.status, 429);
    unlock();
    assert.equal((await first).res.status, 200);
  } finally { unlock(); await a.close(); }
});

test("HTTP idle expiry preserves an in-flight tool then releases the session", async () => {
  let completeTool, startedTool, closed = 0;
  const started = new Promise(resolve => { startedTool = resolve; });
  const work = new Promise(resolve => { completeTool = resolve; });
  const a = await app({ limits: { sessionIdleMs: 80 }, createServer: () => {
    const server = new McpServer({ name: "test", version: "1" });
    server.server.onclose = () => { closed++; };
    server.registerTool("slow", { description: "wait for test", inputSchema: {} }, async () => {
      startedTool(); await work; return { content: [{ type: "text", text: "done" }] };
    });
    return server;
  }});
  try {
    const session = await a.request(init);
    const h = { "mcp-session-id": session.id };
    await a.request({ jsonrpc: "2.0", method: "notifications/initialized" }, h);
    const result = a.request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "slow", arguments: {} } }, h);
    await started;
    await pause(200);
    assert.equal(closed, 0, "idle sweep must not cancel active POST work");
    completeTool();
    assert.match((await result).text, /done/);
    const deadline = Date.now() + 2000;
    while (!closed && Date.now() < deadline) await pause(20);
    assert.equal(closed, 1);
    assert.equal((await a.request({ jsonrpc: "2.0", id: 3, method: "ping" }, h)).res.status, 404);
  } finally { completeTool(); await a.close(); }
});

test("HTTP idle GET notification streams expire instead of pinning sessions forever", async () => {
  let closed = 0;
  const a = await app({ limits: { sessionIdleMs: 80 }, createServer: () => {
    const server = new McpServer({ name: "test", version: "1" });
    server.server.onclose = () => { closed++; };
    return server;
  }});
  try {
    const session = await a.request(init);
    const res = await fetch(a.base + "/mcp", { headers: { ...headers, "mcp-session-id": session.id }, signal: AbortSignal.timeout(2000) });
    assert.equal(res.status, 200);
    await res.text();
    assert.equal(closed, 1);
  } finally { await a.close(); }
});
