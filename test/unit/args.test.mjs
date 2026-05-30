import { test } from "node:test";
import assert from "node:assert/strict";
import { parseServerArgs } from "../../dist/args.js";

test("parseServerArgs: defaults to stdio", () => {
  const a = parseServerArgs([]);
  assert.equal(a.transport, "stdio");
  assert.equal(a.httpPort, 8088);
  assert.equal(a.httpHost, "127.0.0.1");
});

test("parseServerArgs: --http flips to http", () => {
  const a = parseServerArgs(["--http"]);
  assert.equal(a.transport, "http");
});

test("parseServerArgs: --port overrides default", () => {
  const a = parseServerArgs(["--http", "--port", "9000"]);
  assert.equal(a.httpPort, 9000);
});

test("parseServerArgs: --host overrides default", () => {
  const a = parseServerArgs(["--http", "--host", "0.0.0.0"]);
  assert.equal(a.httpHost, "0.0.0.0");
});

test("parseServerArgs: --api-key captured", () => {
  const a = parseServerArgs(["--http", "--api-key", "secret-key"]);
  assert.equal(a.httpApiKey, "secret-key");
});

test("parseServerArgs: --webhook-port + --webhook-host", () => {
  const a = parseServerArgs([
    "--webhook-port",
    "8089",
    "--webhook-host",
    "0.0.0.0",
  ]);
  assert.equal(a.webhookPort, 8089);
  assert.equal(a.webhookHost, "0.0.0.0");
});

test("parseServerArgs: rejects non-numeric port", () => {
  assert.throws(() => parseServerArgs(["--port", "abc"]), /integer port/);
});

test("parseServerArgs: rejects out-of-range port", () => {
  assert.throws(() => parseServerArgs(["--port", "70000"]), /integer port/);
  assert.throws(() => parseServerArgs(["--port", "0"]), /integer port/);
});

test("parseServerArgs: rejects missing value", () => {
  assert.throws(() => parseServerArgs(["--port"]), /requires a value/);
});

test("parseServerArgs: unknown args silently ignored", () => {
  const a = parseServerArgs(["--unknown-flag", "value", "extra-positional"]);
  assert.equal(a.transport, "stdio");
});
