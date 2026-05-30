// Boot the HTTP transport and verify it accepts an initialize request.
// Spawns dist/index.js with --http on an ephemeral port and confirms the
// health endpoint responds + an initialize POST round-trips a valid
// JSON-RPC initialize result.

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const serverPath = resolve(__dirname, "..", "dist", "index.js");
const PORT = 18088 + Math.floor(Math.random() * 1000);
const API_KEY = "test-key-" + Math.random().toString(36).slice(2);

const child = spawn(
  process.execPath,
  [serverPath, "--http", "--port", String(PORT), "--host", "127.0.0.1", "--api-key", API_KEY],
  {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, REPLICATE_API_TOKEN: "r8_test_dummy" },
  },
);

const stderrBuf = [];
child.stderr.on("data", (c) => stderrBuf.push(c.toString("utf8")));

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  let pass = true;
  const fail = (m) => { pass = false; console.error("FAIL:", m); };
  const ok = (m) => console.log("PASS:", m);

  // Wait for server to start listening. The boot banner appears on stderr
  // when http_transport_listening fires.
  let attempts = 0;
  while (attempts++ < 30) {
    const joined = stderrBuf.join("");
    if (joined.includes("HTTP transport on")) break;
    await wait(100);
  }
  if (attempts >= 30) {
    fail("server did not start within 3s");
    console.error(stderrBuf.join(""));
    child.kill();
    process.exit(1);
  }
  ok(`server started on port ${PORT}`);

  // Health endpoint — no auth required.
  const health = await fetch(`http://127.0.0.1:${PORT}/health`);
  if (health.status !== 200) fail(`/health returned ${health.status}`);
  else ok("/health -> 200");

  // Unauthenticated MCP request → 401.
  const unauth = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "POST" });
  if (unauth.status !== 401) fail(`unauthenticated POST should be 401, got ${unauth.status}`);
  else ok("unauthenticated -> 401");

  // Authenticated initialize. Streamable HTTP requires Accept include
  // both application/json AND text/event-stream.
  const init = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "http-boot-test", version: "1.0" },
      },
    }),
  });

  if (init.status !== 200) fail(`initialize POST returned ${init.status}`);
  else {
    // Body may be JSON or SSE depending on the SDK transport mode. Just
    // read the first chunk and assert it mentions serverInfo / result.
    const ct = init.headers.get("content-type") ?? "";
    const text = await init.text();
    if (text.includes("serverInfo") || text.includes("\"result\"")) {
      ok(`initialize -> 200 (${ct.split(";")[0]})`);
    } else {
      fail(`initialize body did not contain result: ${text.slice(0, 200)}`);
    }
  }

  child.kill("SIGTERM");
  console.log("\n--- summary ---");
  console.log(pass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
  process.exit(pass ? 0 : 1);
}

run().catch((e) => {
  console.error("test crashed:", e);
  child.kill();
  process.exit(2);
});
