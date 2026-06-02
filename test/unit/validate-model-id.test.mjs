import { test } from "node:test";
import assert from "node:assert/strict";

const { validateModelId } = await import("../../dist/tools/management.js");

test("validateModelId — accepts owner/name", () => {
  assert.doesNotThrow(() => validateModelId("black-forest-labs/flux-schnell"));
});

test("validateModelId — accepts owner/name:version", () => {
  assert.doesNotThrow(() =>
    validateModelId("black-forest-labs/flux-schnell:abc123def456"),
  );
});

test("validateModelId — rejects missing slash", () => {
  assert.throws(() => validateModelId("flux-schnell"), /Invalid model id/);
});

test("validateModelId — rejects empty", () => {
  assert.throws(() => validateModelId(""), /Invalid model id/);
});

test("validateModelId — rejects spaces", () => {
  assert.throws(() => validateModelId("owner/na me"), /Invalid model id/);
});

test("validateModelId — rejects extra slashes", () => {
  assert.throws(() => validateModelId("a/b/c"), /Invalid model id/);
});

test("validateModelId — rejects colon in owner", () => {
  assert.throws(() => validateModelId("ow:ner/name"), /Invalid model id/);
});
