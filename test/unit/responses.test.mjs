import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { formatError, formatPrediction, truncate, buildInlineImageContent } =
  await import("../../dist/responses.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal succeeded PredictionResult factory. */
function makeResult(over = {}) {
  return {
    status: "succeeded",
    prediction_id: "p1",
    model: "owner/model",
    urls: [],
    local_paths: [],
    ...over,
  };
}

// 1x1 transparent PNG (standard base64).
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------

test("formatError — structure: content array with text item", () => {
  const res = formatError(new Error("oops"));
  assert.ok(Array.isArray(res.content));
  assert.equal(res.content.length, 1);
  assert.equal(res.content[0].type, "text");
});

test("formatError — text starts with 'Error:'", () => {
  const res = formatError(new Error("oops"));
  assert.ok(res.content[0].text.startsWith("Error:"));
});

test("formatError — isError is true", () => {
  const res = formatError(new Error("oops"));
  assert.equal(res.isError, true);
});

test("formatError — structuredContent has error key", () => {
  const res = formatError(new Error("oops"));
  assert.ok("error" in res.structuredContent);
});

test("formatError — plain Error: message equals err.message", () => {
  const err = new Error("something went wrong");
  const res = formatError(err);
  assert.ok(res.content[0].text.includes("something went wrong"));
  assert.equal(res.structuredContent.error, "something went wrong");
});

test("formatError — string argument: uses String(err)", () => {
  const res = formatError("raw string error");
  assert.ok(res.content[0].text.includes("raw string error"));
  assert.equal(res.structuredContent.error, "raw string error");
});

test("formatError — with hint: message contains 'Hint:'", () => {
  const res = formatError(new Error("base error"), "try this instead");
  assert.ok(res.content[0].text.includes("Hint:"));
  assert.ok(res.content[0].text.includes("try this instead"));
});

test("formatError — with hint: structuredContent.error also contains hint", () => {
  const res = formatError(new Error("base"), "do something");
  assert.ok(res.structuredContent.error.includes("Hint:"));
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

test("truncate — short string returned unchanged", () => {
  const short = "hello world";
  assert.equal(truncate(short), short);
});

test("truncate — string at exactly CHARACTER_LIMIT (25000) returned unchanged", () => {
  const atLimit = "x".repeat(25_000);
  assert.equal(truncate(atLimit), atLimit);
});

test("truncate — string of 25001 chars gets truncated notice appended", () => {
  const long = "y".repeat(25_001);
  const result = truncate(long);
  assert.ok(result.includes("[Response truncated"));
});

test("truncate — truncated result starts with the first 25000 chars", () => {
  const long = "z".repeat(25_001);
  const result = truncate(long);
  assert.ok(result.startsWith("z".repeat(25_000)));
});

// ---------------------------------------------------------------------------
// formatPrediction — TEXT-ONLY branch
// ---------------------------------------------------------------------------

test("formatPrediction text-only — content[0].type is 'text'", async () => {
  const res = await formatPrediction(
    makeResult({ text_output: ["hello from model"] }),
  );
  assert.equal(res.content[0].type, "text");
});

test("formatPrediction text-only — text includes the model output", async () => {
  const res = await formatPrediction(
    makeResult({ text_output: ["hello from model"] }),
  );
  assert.ok(res.content[0].text.includes("hello from model"));
});

test("formatPrediction text-only — isError is false", async () => {
  const res = await formatPrediction(
    makeResult({ text_output: ["hello"] }),
  );
  assert.equal(res.isError, false);
});

test("formatPrediction text-only — structuredContent is present", async () => {
  const res = await formatPrediction(
    makeResult({ text_output: ["hello"] }),
  );
  assert.ok(res.structuredContent != null);
});

// ---------------------------------------------------------------------------
// formatPrediction — FAILED branch
// ---------------------------------------------------------------------------

test("formatPrediction failed — isError is true", async () => {
  const res = await formatPrediction(
    makeResult({ status: "failed", error: "boom" }),
  );
  assert.equal(res.isError, true);
});

test("formatPrediction failed — content contains failure information", async () => {
  const res = await formatPrediction(
    makeResult({ status: "failed", error: "boom" }),
  );
  const text = res.content[0].text;
  assert.ok(text.includes("boom") || text.includes("failed"));
});

// ---------------------------------------------------------------------------
// formatPrediction — URL fallback (no local files, no text_output)
// ---------------------------------------------------------------------------

test("formatPrediction URL fallback — content[0].type is 'text'", async () => {
  const res = await formatPrediction(
    makeResult({ urls: ["https://replicate.delivery/x.webp"] }),
  );
  assert.equal(res.content[0].type, "text");
});

test("formatPrediction URL fallback — text includes the URL", async () => {
  const url = "https://replicate.delivery/x.webp";
  const res = await formatPrediction(makeResult({ urls: [url] }));
  assert.ok(res.content[0].text.includes(url));
});

// ---------------------------------------------------------------------------
// buildInlineImageContent
// ---------------------------------------------------------------------------

test("buildInlineImageContent — returns one image content item for a valid PNG", async () => {
  const tmpPath = join(tmpdir(), `responses-test-${Date.now()}.png`);
  writeFileSync(tmpPath, Buffer.from(TINY_PNG_B64, "base64"));
  try {
    const items = await buildInlineImageContent([tmpPath]);
    assert.equal(items.length, 1);
  } finally {
    unlinkSync(tmpPath);
  }
});

test("buildInlineImageContent — item type is 'image'", async () => {
  const tmpPath = join(tmpdir(), `responses-test-${Date.now()}.png`);
  writeFileSync(tmpPath, Buffer.from(TINY_PNG_B64, "base64"));
  try {
    const items = await buildInlineImageContent([tmpPath]);
    assert.equal(items[0].type, "image");
  } finally {
    unlinkSync(tmpPath);
  }
});

test("buildInlineImageContent — mimeType is 'image/png'", async () => {
  const tmpPath = join(tmpdir(), `responses-test-${Date.now()}.png`);
  writeFileSync(tmpPath, Buffer.from(TINY_PNG_B64, "base64"));
  try {
    const items = await buildInlineImageContent([tmpPath]);
    assert.equal(items[0].mimeType, "image/png");
  } finally {
    unlinkSync(tmpPath);
  }
});

test("buildInlineImageContent — data is a non-empty base64 string", async () => {
  const tmpPath = join(tmpdir(), `responses-test-${Date.now()}.png`);
  writeFileSync(tmpPath, Buffer.from(TINY_PNG_B64, "base64"));
  try {
    const items = await buildInlineImageContent([tmpPath]);
    assert.ok(typeof items[0].data === "string");
    assert.ok(items[0].data.length > 0);
  } finally {
    unlinkSync(tmpPath);
  }
});

test("buildInlineImageContent — returns empty array for non-existent file", async () => {
  const items = await buildInlineImageContent(["/no/such/file.png"]);
  assert.equal(items.length, 0);
});

test("buildInlineImageContent — returns empty array for unsupported extension", async () => {
  const tmpPath = join(tmpdir(), `responses-test-${Date.now()}.txt`);
  writeFileSync(tmpPath, "not an image");
  try {
    const items = await buildInlineImageContent([tmpPath]);
    assert.equal(items.length, 0);
  } finally {
    unlinkSync(tmpPath);
  }
});
