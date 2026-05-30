import { strict as assert } from "node:assert";
import { test } from "node:test";

// Import from built dist (tests run after tsc)
const { RefreshModelsInputSchema } = await import("../../dist/schemas.js");

test("RefreshModelsInputSchema — defaults applied when fields omitted", () => {
  const result = RefreshModelsInputSchema.parse({});
  assert.equal(result.min_run_count, 1000);
  assert.equal(result.limit_per_category, 5);
  assert.equal(result.categories, undefined);
});

test("RefreshModelsInputSchema — accepts valid full input", () => {
  const result = RefreshModelsInputSchema.parse({
    categories: ["image", "video"],
    min_run_count: 500,
    limit_per_category: 3,
  });
  assert.deepEqual(result.categories, ["image", "video"]);
  assert.equal(result.min_run_count, 500);
  assert.equal(result.limit_per_category, 3);
});

test("RefreshModelsInputSchema — rejects limit_per_category = 0", () => {
  assert.throws(
    () => RefreshModelsInputSchema.parse({ limit_per_category: 0 }),
    /greater than or equal to 1/,
  );
});

test("RefreshModelsInputSchema — rejects limit_per_category > 20", () => {
  assert.throws(
    () => RefreshModelsInputSchema.parse({ limit_per_category: 21 }),
    /less than or equal to 20/,
  );
});

test("RefreshModelsInputSchema — rejects negative min_run_count", () => {
  assert.throws(
    () => RefreshModelsInputSchema.parse({ min_run_count: -1 }),
    /greater than or equal to 0/,
  );
});
