/**
 * Scan-path probe: initialize + tools/list + prompts/list against a running
 * HTTP MCP server, with NO token — exactly what Smithery's scanner does.
 * Prints the discovered tool/prompt counts so we can confirm the server is
 * scannable before registering the URL.
 *
 *   MCP_URL=http://replicate-mcp:8088/mcp node deploy/probe.mjs
 */
const BASE = process.env.MCP_URL || "http://127.0.0.1:8088/mcp";
const ACCEPT = "application/json, text/event-stream";

function parseBody(ct, text) {
  if (ct.includes("text/event-stream")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:"));
    return data.length ? JSON.parse(data[data.length - 1].slice(5).trim()) : null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

async function rpc(method, params, sid) {
  const headers = { "content-type": "application/json", accept: ACCEPT };
  if (sid) headers["mcp-session-id"] = sid;
  const res = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const text = await res.text();
  return {
    status: res.status,
    sid: res.headers.get("mcp-session-id"),
    json: parseBody(res.headers.get("content-type") || "", text),
  };
}

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "scan-probe", version: "0" },
});
const sid = init.sid;
if (sid) {
  await fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT, "mcp-session-id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
}
const tools = await rpc("tools/list", {}, sid);
const prompts = await rpc("prompts/list", {}, sid);

console.log("initialize:", init.status, "session:", sid ? "yes" : "no");
console.log("tools:", tools.json?.result?.tools?.length ?? "ERR");
console.log("prompts:", prompts.json?.result?.prompts?.length ?? "ERR");
const ok = init.status === 200 && (tools.json?.result?.tools?.length ?? 0) > 0;
console.log(ok ? "SCAN-OK (server lists tools without a token)" : "SCAN-FAIL");
process.exit(ok ? 0 : 1);
