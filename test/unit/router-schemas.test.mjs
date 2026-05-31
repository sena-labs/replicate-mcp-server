import { test } from "node:test";
import assert from "node:assert/strict";

const { RecommendModelInputSchema } = await import("../../dist/schemas.js");

test("RecommendModelInputSchema — defaults priority to balanced", () => {
  const result = RecommendModelInputSchema.parse({ category: "image" });
  assert.equal(result.category, "image");
  assert.equal(result.priority, "balanced");
});

test("RecommendModelInputSchema — accepts full valid input", () => {
  const result = RecommendModelInputSchema.parse({
    category: "video",
    priority: "quality",
    task_description: "cinematic hero shot",
    max_cost_usd: 0.5,
    duration_seconds: 6,
  });
  assert.equal(result.category, "video");
  assert.equal(result.priority, "quality");
  assert.equal(result.task_description, "cinematic hero shot");
  assert.equal(result.max_cost_usd, 0.5);
  assert.equal(result.duration_seconds, 6);
});

test("RecommendModelInputSchema — rejects unknown category", () => {
  assert.throws(() => RecommendModelInputSchema.parse({ category: "hologram" }));
});

test("RecommendModelInputSchema — rejects unknown priority", () => {
  assert.throws(
    () => RecommendModelInputSchema.parse({ category: "image", priority: "cheapest" }),
  );
});

test("RecommendModelInputSchema — rejects max_cost_usd <= 0", () => {
  assert.throws(
    () => RecommendModelInputSchema.parse({ category: "image", max_cost_usd: 0 }),
    /greater than 0/,
  );
});

test("RecommendModelInputSchema — rejects duration_seconds > 600", () => {
  assert.throws(
    () => RecommendModelInputSchema.parse({ category: "video", duration_seconds: 601 }),
    /less than or equal to 600/,
  );
});
