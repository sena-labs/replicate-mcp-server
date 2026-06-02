#!/usr/bin/env node
/**
 * Fire a metered call through the SMITHERY GATEWAY (not the VPS origin) so it
 * registers on the Smithery "Calls" counter. Picks a free read-only tool (no
 * Replicate API spend) via tools/list.
 *
 *   node scripts/smithery-call.mjs
 *
 * Reads from .env (gitignored):
 *   SMITHERY_API_KEY   - gateway auth (who is calling)
 *   REPLICATE_API_TOKEN - forwarded as server config (what executes)
 */
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const RTOK = process.env.REPLICATE_API_TOKEN;
const SKEY = process.env.SMITHERY_API_KEY;
if (!SKEY) { console.error("SMITHERY_API_KEY missing (.env)"); process.exit(1); }
if (!RTOK) { console.error("REPLICATE_API_TOKEN missing (.env)"); process.exit(1); }

const QN = process.env.SMITHERY_QN || "sena-labs/replicate-mcp-server";
const ACCEPT = "application/json, text/event-stream";

function parseBody(ct, text) {
  if ((ct || "").includes("text/event-stream")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:"));
    return data.length ? JSON.parse(data[data.length - 1].slice(5).trim()) : null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

// 1. Registry lookup: exact gateway URL + config schema property names.
let base = `https://server.smithery.ai/${QN}/mcp`;
let cfgProps = [];
try {
  const reg = await fetch(`https://registry.smithery.ai/servers/${QN}`, {
    headers: { Authorization: `Bearer ${SKEY}`, accept: "application/json" },
  });
  console.log("registry:", reg.status);
  if (reg.ok) {
    const j = await reg.json();
    const conns = j.connections || [];
    const http = conns.find((c) => c.deploymentUrl) || conns[0] || {};
    if (http.deploymentUrl) base = http.deploymentUrl;
    cfgProps = Object.keys(http.configSchema?.properties || {});
    console.log("deploymentUrl:", base);
    console.log("configSchema props:", cfgProps.join(", ") || "(none)");
  } else {
    console.log("registry body:", (await reg.text()).slice(0, 200));
  }
} catch (e) { console.log("registry lookup failed:", e.message); }

// 2. Build client->gateway config (base64). Set token-like props to RTOK.
const cfg = {};
const tokenProps = cfgProps.filter((p) => /token|key|replicate/i.test(p));
if (tokenProps.length) for (const p of tokenProps) cfg[p] = RTOK;
else { cfg.replicate_api_token = RTOK; cfg.replicateApiToken = RTOK; }
const cfgB64 = Buffer.from(JSON.stringify(cfg)).toString("base64");
const params = new URLSearchParams();
params.set("api_key", SKEY);
for (const [k, v] of Object.entries(cfg)) params.set(k, v); // dot-notation (parseSessionConfig reads these)
params.set("config", cfgB64);                               // base64 fallback (Smithery client format)
const URL_ = `${base}?${params.toString()}`;
console.log("gateway:", base, "| config keys:", Object.keys(cfg).join(","), "| api_key:", `${SKEY.slice(0, 6)}…(${SKEY.length})`);

async function rpc(method, params, sid) {
  const headers = { "content-type": "application/json", accept: ACCEPT };
  if (sid) headers["mcp-session-id"] = sid;
  const res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  const text = await res.text();
  return { status: res.status, sid: res.headers.get("mcp-session-id"), json: parseBody(res.headers.get("content-type"), text), raw: text };
}

// 3. Handshake.
const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smithery-call", version: "0" } });
console.log("initialize:", init.status, "| session:", init.sid ? "yes" : "no");
if (init.status !== 200) { console.log("init body:", init.raw.slice(0, 300)); process.exit(1); }
const sid = init.sid;
if (sid) await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", accept: ACCEPT, "mcp-session-id": sid }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });

// 4. tools/list -> pick a free read-only tool with no required args.
const list = await rpc("tools/list", {}, sid);
const tools = list.json?.result?.tools || [];
console.log("tools/list:", list.status, "| count:", tools.length);
const noReq = (t) => !(t.inputSchema?.required?.length);
const pick =
  tools.find((t) => noReq(t) && /list_models|capabilit|catalog/i.test(t.name)) ||
  tools.find((t) => noReq(t) && /recommend|search/i.test(t.name)) ||
  tools.find((t) => noReq(t) && t.annotations?.readOnlyHint) ||
  tools.find((t) => noReq(t));
if (!pick) { console.log("no zero-arg tool found; names:", tools.map((t) => t.name).join(", ")); process.exit(1); }
console.log("picked tool:", pick.name);

// 5. tools/call -> this is the metered invocation.
const call = await rpc("tools/call", { name: pick.name, arguments: {} }, sid);
const err = call.json?.error || (call.json?.result?.isError ? call.json.result.content?.[0]?.text : null);
console.log("tools/call:", call.status, err ? `| ERROR: ${JSON.stringify(err).slice(0, 200)}` : "| OK");
const out = call.json?.result?.content?.map((c) => c.text).filter(Boolean).join("\n") ?? "";
console.log("result preview:", out.slice(0, 200).replace(/\s+/g, " "));
console.log(err ? "\n✗ call not executed" : "\n✓ metered call sent through Smithery gateway — Calls should increment (may lag).");
