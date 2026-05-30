// Real MCP stdio handshake test.
// Spawns server, sends initialize + tools/list + tools/call, validates response.
//
// Uses request-id → promise correlation so each round-trip awaits its own
// response instead of relying on fixed timers (avoids flakiness on slow CPU).

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const serverPath = resolve(__dirname, "..", "dist", "index.js");

const REQUEST_TIMEOUT_MS = 15_000;

const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    REPLICATE_API_TOKEN: "r8_test_dummy_for_stdio_test_only",
  },
});

const pending = new Map(); // id -> { resolve, reject, timer }
let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line.length === 0) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("[non-JSON stdout]:", line);
      continue;
    }
    const id = msg.id;
    if (id !== undefined && pending.has(id)) {
      const { resolve: rs, timer } = pending.get(id);
      clearTimeout(timer);
      pending.delete(id);
      rs(msg);
    }
  }
});

const stderrLines = [];
child.stderr.on("data", (chunk) => stderrLines.push(chunk.toString("utf8")));

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
  return new Promise((resolveFn, rejectFn) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectFn(new Error(`request ${id} (${method}) timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve: resolveFn, reject: rejectFn, timer });
    child.stdin.write(JSON.stringify(payload) + "\n");
  });
}

function notify(method, params) {
  const payload = { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) };
  child.stdin.write(JSON.stringify(payload) + "\n");
}

async function run() {
  let pass = true;
  const fail = (msg) => { pass = false; console.error("FAIL:", msg); };
  const ok = (msg) => console.log("PASS:", msg);

  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "stdio-test", version: "1.0" },
  });
  if (init.error) fail("initialize error: " + JSON.stringify(init.error));
  else if (!init.result?.serverInfo) fail("initialize missing serverInfo");
  else ok(`initialize -> ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

  notify("notifications/initialized");

  const list = await request("tools/list");
  if (!Array.isArray(list.result?.tools)) fail("tools missing");
  else {
    const names = list.result.tools.map((t) => t.name).sort();
    const expected = [
      "replicate_cancel_prediction",
      "replicate_chat",
      "replicate_clone_voice",
      "replicate_embed_text",
      "replicate_estimate_cost",
      "replicate_generate_3d",
      "replicate_generate_audio",
      "replicate_generate_image",
      "replicate_generate_speech",
      "replicate_generate_video",
      "replicate_get_model_schema",
      "replicate_get_prediction",
      "replicate_inpaint",
      "replicate_lipsync",
      "replicate_list_predictions",
      "replicate_refresh_models",
      "replicate_remove_background",
      "replicate_run_model",
      "replicate_search_models",
      "replicate_segment",
      "replicate_transcribe_audio",
      "replicate_upload_file",
      "replicate_upscale_image",
      "replicate_vision",
    ];
    const missing = expected.filter((n) => !names.includes(n));
    const extra = names.filter((n) => !expected.includes(n));
    if (missing.length) fail("missing tools: " + missing.join(","));
    if (extra.length) fail("unexpected tools: " + extra.join(","));
    if (!missing.length && !extra.length) ok(`tools/list -> 24 tools registered`);

    for (const t of list.result.tools) {
      if (!t.inputSchema) fail(`${t.name}: no inputSchema`);
      if (!t.description) fail(`${t.name}: no description`);
    }
    ok("all tools have inputSchema + description");
  }

  const callInvalid = await request("tools/call", {
    name: "replicate_generate_image",
    arguments: { prompt: "" },
  });
  {
    const isError = callInvalid.result?.isError === true;
    const txt = callInvalid.result?.content?.[0]?.text ?? "";
    if (isError && (txt.includes("Prompt cannot be empty") || txt.includes("empty"))) {
      ok("invalid input -> ZodError surfaced correctly");
    } else if (callInvalid.error) {
      ok(`invalid input -> MCP error code ${callInvalid.error.code}: ${callInvalid.error.message}`);
    } else if (isError) {
      ok(`invalid input -> isError true: ${txt.slice(0, 120)}`);
    } else {
      fail("invalid input did not produce error. Got: " + JSON.stringify(callInvalid).slice(0, 300));
    }
  }

  const callBogus = await request("tools/call", {
    name: "replicate_get_prediction",
    arguments: { prediction_id: "bogus_id_no_such_prediction", download: false },
  });
  {
    const txt = callBogus.result?.content?.[0]?.text ?? "";
    const isErr = callBogus.result?.isError === true;
    if (isErr) ok(`bogus prediction -> error path hit: ${txt.slice(0, 120)}`);
    else fail("bogus prediction did not produce error. Got: " + JSON.stringify(callBogus).slice(0, 300));
  }

  child.stdin.end();
  child.kill("SIGTERM");

  console.log("\n--- stderr ---");
  console.log(stderrLines.join(""));
  console.log("\n--- summary ---");
  console.log(pass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
  process.exit(pass ? 0 : 1);
}

run().catch((e) => {
  console.error("test crashed:", e);
  child.kill();
  process.exit(2);
});
