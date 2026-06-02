/**
 * Multi-tenant (hosted) path: per-request Replicate token from session config.
 *
 * Covers parseSessionConfig (URL -> RequestContext) and the AsyncLocalStorage
 * seam in replicate.getClient(): a per-request token must override the env
 * pool, and its absence must fall back to the pool (or throw if none).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSessionConfig } from "../../dist/http-server.js";
import { requestContext } from "../../dist/request-context.js";
import { getClient, _resetClientForTests } from "../../dist/replicate.js";

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");
const u = (qs) => new URL(`http://localhost/mcp${qs}`);

test("parseSessionConfig: base64 config JSON (snake_case)", () => {
  const ctx = parseSessionConfig(u(`?config=${b64({ replicate_api_token: "r8_snake" })}`));
  assert.equal(ctx.replicateToken, "r8_snake");
});

test("parseSessionConfig: base64 config JSON (camelCase)", () => {
  const ctx = parseSessionConfig(u(`?config=${b64({ replicateApiToken: "r8_camel" })}`));
  assert.equal(ctx.replicateToken, "r8_camel");
});

test("parseSessionConfig: direct query param", () => {
  const ctx = parseSessionConfig(u(`?replicate_api_token=r8_direct`));
  assert.equal(ctx.replicateToken, "r8_direct");
});

test("parseSessionConfig: nothing -> empty context", () => {
  assert.deepEqual(parseSessionConfig(u("")), {});
});

test("parseSessionConfig: malformed base64 -> empty (no throw)", () => {
  assert.deepEqual(parseSessionConfig(u("?config=%%%notb64%%%")), {});
});

test("getClient: session token works with no env pool", () => {
  const savedToken = process.env.REPLICATE_API_TOKEN;
  const savedPool = process.env.REPLICATE_API_TOKEN_POOL;
  delete process.env.REPLICATE_API_TOKEN;
  delete process.env.REPLICATE_API_TOKEN_POOL;
  _resetClientForTests();
  try {
    // No token at all -> throws (no pool, no session).
    assert.throws(() => getClient(), /No Replicate API tokens/);
    // Session token present -> resolves a client without touching the pool.
    requestContext.run({ replicateToken: "r8_session_only" }, () => {
      assert.ok(getClient());
    });
  } finally {
    if (savedToken !== undefined) process.env.REPLICATE_API_TOKEN = savedToken;
    if (savedPool !== undefined) process.env.REPLICATE_API_TOKEN_POOL = savedPool;
    _resetClientForTests();
  }
});
