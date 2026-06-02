#!/usr/bin/env node
/**
 * Generate banner candidates through the REAL deployed MCP server (not the SDK).
 * Exercises the full hosted flow: StreamableHTTP + per-session token via the
 * x-replicate-api-token header + the replicate_generate_image tool.
 *
 *   MCP_URL=https://replicate-mcp.sena-labs.dev/mcp node scripts/gen-banner-via-mcp.mjs
 *
 * Token read from REPLICATE_API_TOKEN (.env) and sent as the per-user header.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const TOKEN = process.env.REPLICATE_API_TOKEN;
const BASE = process.env.MCP_URL || "https://replicate-mcp.sena-labs.dev/mcp";
if (!TOKEN) { console.error("REPLICATE_API_TOKEN missing (.env)"); process.exit(1); }

const ACCEPT = "application/json, text/event-stream";
function parseBody(ct, text) {
  if (ct.includes("text/event-stream")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:"));
    return data.length ? JSON.parse(data[data.length - 1].slice(5).trim()) : null;
  }
  try { return JSON.parse(text); } catch { return null; }
}
async function rpc(method, params, sid) {
  const headers = {
    "content-type": "application/json",
    accept: ACCEPT,
    "x-replicate-api-token": TOKEN, // per-user token, the hosted multi-tenant path
  };
  if (sid) headers["mcp-session-id"] = sid;
  const res = await fetch(BASE, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  const text = await res.text();
  return { status: res.status, sid: res.headers.get("mcp-session-id"), json: parseBody(res.headers.get("content-type") || "", text) };
}

const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "banner", version: "0" } });
const sid = init.sid;
console.log("initialize:", init.status, "session:", sid ? "yes" : "no");
if (sid) await fetch(BASE, { method: "POST", headers: { "content-type": "application/json", accept: ACCEPT, "x-replicate-api-token": TOKEN, "mcp-session-id": sid }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });

const candidates = [
  { id: "mcp_flow", prompt: "Ultra-wide hero banner, deep dark charcoal-navy background, a luminous gradient sweeping from indigo to vivid magenta, abstract generative motifs suggesting image, video and audio synthesis (soft light particles, flowing waveform ribbons, faint frame shapes), premium cinematic modern tech aesthetic, generous dark negative space, no text no letters." },
  { id: "mcp_pipeline", prompt: "Wide tech hero banner, near-black background, an elegant glowing node-graph pipeline of connected nodes flowing left to right with an indigo-to-magenta gradient and thin clean connectors, AI orchestration toolbox, minimal premium, dark negative space, no text." },
  { id: "mcp_burst", prompt: "Wide premium banner, dark charcoal background, a glowing indigo-to-magenta orb on the left emitting a burst of fine multicolor particles spreading rightward into the dark, cinematic depth, generative AI feel, no text no letters." },
];

const dir = "assets/banner-candidates";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

for (const c of candidates) {
  process.stdout.write(`[${c.id}] replicate_generate_image … `);
  const call = await rpc("tools/call", {
    name: "replicate_generate_image",
    arguments: { prompt: c.prompt, model: "black-forest-labs/flux-1.1-pro-ultra", aspect_ratio: "21:9", download: false },
  }, sid);
  if (call.json?.error || call.json?.result?.isError) {
    console.log("ERROR:", JSON.stringify(call.json?.error ?? call.json?.result?.content?.[0]?.text).slice(0, 180));
    continue;
  }
  const text = call.json?.result?.content?.map((c) => c.text).filter(Boolean).join("\n") ?? "";
  const url = (text.match(/https?:\/\/\S+?\.(?:png|webp|jpg|jpeg)/i) || text.match(/https?:\/\/replicate\.delivery\/\S+/i) || [])[0];
  if (!url) { console.log("no url in response:", text.slice(0, 160)); continue; }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(`${dir}/${c.id}.png`, buf);
  console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
}
console.log(`\nReview: ${dir}/`);
