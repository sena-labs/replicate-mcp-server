#!/usr/bin/env node
/**
 * Generate banner candidates THROUGH THE SMITHERY GATEWAY so every image
 * generation registers as a metered "Call" on the Smithery server page.
 *
 *   node scripts/gen-banner-via-smithery.mjs <prompts.json> <outDir>
 *
 * prompts.json = [{ "id": "...", "prompt": "...", "model"?: "...", "aspect_ratio"?: "21:9" }]
 * .env (gitignored): SMITHERY_API_KEY (gateway auth) + REPLICATE_API_TOKEN (server config)
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

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

const promptsPath = process.argv[2] || "scripts/prompts.json";
const outDir = process.argv[3] || "assets/banner-candidates/round";
const QN = process.env.SMITHERY_QN || "sena-labs/replicate-mcp-server";
const ACCEPT = "application/json, text/event-stream";

function parseBody(ct, text) {
  if ((ct || "").includes("text/event-stream")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:"));
    return data.length ? JSON.parse(data[data.length - 1].slice(5).trim()) : null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

// Resolve gateway URL from registry.
let base = `https://server.smithery.ai/${QN}/mcp`;
try {
  const reg = await fetch(`https://registry.smithery.ai/servers/${QN}`, { headers: { Authorization: `Bearer ${SKEY}`, accept: "application/json" } });
  if (reg.ok) {
    const j = await reg.json();
    const http = (j.connections || []).find((c) => c.deploymentUrl) || {};
    if (http.deploymentUrl) base = http.deploymentUrl;
  }
} catch {}
const params = new URLSearchParams({ api_key: SKEY, replicate_api_token: RTOK });
const URL_ = `${base}?${params.toString()}`;
console.log("gateway:", base);

async function rpc(method, p, sid) {
  const headers = { "content-type": "application/json", accept: ACCEPT };
  if (sid) headers["mcp-session-id"] = sid;
  const res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: p }) });
  const text = await res.text();
  return { status: res.status, sid: res.headers.get("mcp-session-id"), json: parseBody(res.headers.get("content-type"), text), raw: text };
}

const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "banner-swarm", version: "0" } });
const sid = init.sid;
console.log("initialize:", init.status, "| session:", sid ? "yes" : "no");
if (init.status !== 200) { console.log(init.raw.slice(0, 300)); process.exit(1); }
if (sid) await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", accept: ACCEPT, "mcp-session-id": sid }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });

const prompts = JSON.parse(readFileSync(promptsPath, "utf8"));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let calls = 0, ok = 0;
for (const c of prompts) {
  process.stdout.write(`[${c.id}] generate (CALL via gateway) … `);
  calls++;
  const call = await rpc("tools/call", {
    name: "replicate_generate_image",
    arguments: { prompt: c.prompt, model: c.model || "black-forest-labs/flux-1.1-pro-ultra", aspect_ratio: c.aspect_ratio || "21:9", download: false },
  }, sid);
  const errTxt = call.json?.error ? JSON.stringify(call.json.error) : (call.json?.result?.isError ? call.json.result.content?.[0]?.text : null);
  if (errTxt) { console.log("ERROR:", String(errTxt).slice(0, 160)); continue; }
  const text = call.json?.result?.content?.map((x) => x.text).filter(Boolean).join("\n") ?? "";
  const url = (text.match(/https?:\/\/\S+?\.(?:png|webp|jpg|jpeg)/i) || text.match(/https?:\/\/replicate\.delivery\/\S+/i) || [])[0];
  if (!url) { console.log("no url:", text.slice(0, 140)); continue; }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(`${outDir}/${c.id}.png`, buf);
  ok++;
  console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
}
console.log(`\nMetered gateway Calls fired: ${calls}  |  images saved: ${ok}  ->  ${outDir}/`);
