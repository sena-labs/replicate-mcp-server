import { test } from "node:test";
import assert from "node:assert/strict";

const { BatchStartInputSchema, BatchStatusInputSchema } =
  await import("../../dist/schemas.js");

test("BatchStartInputSchema — defaults applied", () => {
  const result = BatchStartInputSchema.parse({
    items: [{ model: "owner/model", input: { prompt: "hi" } }],
  });
  assert.equal(result.concurrency, 3);
  assert.equal(result.download, true);
  assert.equal(result.timeout_ms_per_item, 300_000);
  assert.equal(result.ttl_hours, 1);
});

test("BatchStartInputSchema — accepts full valid input", () => {
  const result = BatchStartInputSchema.parse({
    items: [
      { model: "black-forest-labs/flux-schnell", input: { prompt: "a cat" } },
      { model: "black-forest-labs/flux-dev", input: { prompt: "a dog" } },
    ],
    concurrency: 5,
    download: false,
    timeout_ms_per_item: 60_000,
    ttl_hours: 24,
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.concurrency, 5);
  assert.equal(result.download, false);
  assert.equal(result.timeout_ms_per_item, 60_000);
  assert.equal(result.ttl_hours, 24);
});

test("BatchStartInputSchema — rejects empty items array", () => {
  assert.throws(() => BatchStartInputSchema.parse({ items: [] }), /at least 1/);
});

test("BatchStartInputSchema — rejects items array > 50", () => {
  const items = Array.from({ length: 51 }, (_, i) => ({
    model: "owner/model",
    input: { i },
  }));
  assert.throws(() => BatchStartInputSchema.parse({ items }), /at most 50/);
});

test("BatchStartInputSchema — rejects concurrency = 0", () => {
  assert.throws(
    () =>
      BatchStartInputSchema.parse({
        items: [{ model: "owner/model", input: {} }],
        concurrency: 0,
      }),
    /greater than or equal to 1/,
  );
});

test("BatchStartInputSchema — rejects concurrency > 10", () => {
  assert.throws(
    () =>
      BatchStartInputSchema.parse({
        items: [{ model: "owner/model", input: {} }],
        concurrency: 11,
      }),
    /less than or equal to 10/,
  );
});

test("BatchStartInputSchema — rejects ttl_hours > 72", () => {
  assert.throws(
    () =>
      BatchStartInputSchema.parse({
        items: [{ model: "owner/model", input: {} }],
        ttl_hours: 73,
      }),
    /less than or equal to 72/,
  );
});

test("BatchStatusInputSchema — defaults applied", () => {
  const result = BatchStatusInputSchema.parse({ job_id: "abc-123" });
  assert.equal(result.job_id, "abc-123");
  assert.equal(result.include_results, true);
});

test("BatchStatusInputSchema — rejects empty job_id", () => {
  assert.throws(() => BatchStatusInputSchema.parse({ job_id: "" }), /at least 1/);
});
