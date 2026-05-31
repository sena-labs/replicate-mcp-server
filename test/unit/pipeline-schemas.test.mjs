import { test } from "node:test";
import assert from "node:assert/strict";

const { PipelineStartInputSchema, PipelineStatusInputSchema } =
  await import("../../dist/schemas.js");

test("PipelineStartInputSchema — defaults applied when only steps given", () => {
  const result = PipelineStartInputSchema.parse({
    steps: [{ id: "s", model: "o/m", input: { prompt: "hi" } }],
  });
  assert.equal(result.concurrency, 3);
  assert.equal(result.download, true);
  assert.equal(result.timeout_ms_per_step, 300_000);
  assert.equal(result.ttl_hours, 1);
});

test("PipelineStartInputSchema — accepts full valid input", () => {
  const result = PipelineStartInputSchema.parse({
    steps: [
      { id: "gen", model: "black-forest-labs/flux-schnell", input: { prompt: "cat" } },
      { id: "upscale", model: "nightmareai/real-esrgan", input: { image: "$gen.urls[0]" }, depends_on: ["gen"] },
    ],
    concurrency: 2,
    download: false,
    timeout_ms_per_step: 120_000,
    ttl_hours: 24,
  });
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].depends_on?.[0], "gen");
  assert.equal(result.concurrency, 2);
  assert.equal(result.download, false);
});

test("PipelineStartInputSchema — rejects empty steps array", () => {
  assert.throws(
    () => PipelineStartInputSchema.parse({ steps: [] }),
    /at least 1/,
  );
});

test("PipelineStartInputSchema — rejects steps array > 20", () => {
  const steps = Array.from({ length: 21 }, (_, i) => ({
    id: `s${i}`,
    model: "o/m",
    input: {},
  }));
  assert.throws(
    () => PipelineStartInputSchema.parse({ steps }),
    /at most 20/,
  );
});

test("PipelineStartInputSchema — rejects concurrency = 0", () => {
  assert.throws(
    () =>
      PipelineStartInputSchema.parse({
        steps: [{ id: "s", model: "o/m", input: {} }],
        concurrency: 0,
      }),
    /greater than or equal to 1/,
  );
});

test("PipelineStartInputSchema — rejects concurrency > 5", () => {
  assert.throws(
    () =>
      PipelineStartInputSchema.parse({
        steps: [{ id: "s", model: "o/m", input: {} }],
        concurrency: 6,
      }),
    /less than or equal to 5/,
  );
});

test("PipelineStartInputSchema — rejects ttl_hours > 72", () => {
  assert.throws(
    () =>
      PipelineStartInputSchema.parse({
        steps: [{ id: "s", model: "o/m", input: {} }],
        ttl_hours: 73,
      }),
    /less than or equal to 72/,
  );
});

test("PipelineStatusInputSchema — defaults applied", () => {
  const result = PipelineStatusInputSchema.parse({ pipeline_id: "pipe-123" });
  assert.equal(result.pipeline_id, "pipe-123");
  assert.equal(result.include_outputs, true);
});

test("PipelineStatusInputSchema — rejects empty pipeline_id", () => {
  assert.throws(
    () => PipelineStatusInputSchema.parse({ pipeline_id: "" }),
    /at least 1/,
  );
});
