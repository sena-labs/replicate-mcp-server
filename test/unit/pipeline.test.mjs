import { test } from "node:test";
import assert from "node:assert/strict";

const {
  inferDeps,
  resolveInput,
  hasCycle,
  createPipeline,
  getPipeline,
} = await import("../../dist/pipeline.js");

// ── inferDeps ──────────────────────────────────────────────────────────────

test("inferDeps — extracts step ID from $ref string", () => {
  const deps = inferDeps({ image: "$gen.urls[0]", scale: 4 });
  assert.deepEqual(deps.sort(), ["gen"]);
});

test("inferDeps — extracts multiple unique IDs, deduplicates", () => {
  const deps = inferDeps({
    image: "$step1.urls[0]",
    mask: "$step2.urls[0]",
    extra: "$step1.local_paths[0]",
  });
  assert.deepEqual(deps.sort(), ["step1", "step2"]);
});

test("inferDeps — returns empty array for inputs with no refs", () => {
  const deps = inferDeps({ prompt: "a fox", scale: 4 });
  assert.deepEqual(deps, []);
});

test("inferDeps — ignores plain $-prefixed strings that are not refs", () => {
  const deps = inferDeps({ price: "$5 bill", note: "$100", prompt: "cost is $$$" });
  assert.deepEqual(deps, []);
});

test("inferDeps — scans nested objects and arrays recursively", () => {
  const deps = inferDeps({
    nested: { url: "$gen.urls[0]" },
    list: ["$upscale.urls[0]"],
  });
  assert.deepEqual(deps.sort(), ["gen", "upscale"]);
});

// ── resolveInput ───────────────────────────────────────────────────────────

const mockResult = {
  status: "succeeded",
  prediction_id: "pred-1",
  model: "owner/model",
  urls: ["https://cdn.example.com/out.webp"],
  local_paths: ["/tmp/out.webp"],
  text_output: ["hello world"],
  metrics: undefined,
  error: undefined,
  pending: undefined,
  logs_excerpt: undefined,
};

test("resolveInput — resolves $step.urls[0] to first URL", () => {
  const results = new Map([["gen", mockResult]]);
  const resolved = resolveInput({ image: "$gen.urls[0]" }, results);
  assert.equal(resolved.image, "https://cdn.example.com/out.webp");
});

test("resolveInput — throws on out-of-bounds index instead of forwarding undefined", () => {
  const results = new Map([["gen", mockResult]]); // urls has 1 element
  assert.throws(
    () => resolveInput({ image: "$gen.urls[5]" }, results),
    /out of bounds/,
  );
});

test("resolveInput — throws when referenced field is missing on the output", () => {
  const results = new Map([["gen", mockResult]]);
  assert.throws(
    () => resolveInput({ x: "$gen.nonexistent" }, results),
    /not found/,
  );
});

test("resolveInput — resolves $step.urls (full array)", () => {
  const results = new Map([["gen", mockResult]]);
  const resolved = resolveInput({ images: "$gen.urls" }, results);
  assert.deepEqual(resolved.images, ["https://cdn.example.com/out.webp"]);
});

test("resolveInput — resolves $step.text_output[0]", () => {
  const results = new Map([["llm", mockResult]]);
  const resolved = resolveInput({ prompt: "$llm.text_output[0]" }, results);
  assert.equal(resolved.prompt, "hello world");
});

test("resolveInput — leaves non-ref strings and numbers unchanged", () => {
  const results = new Map();
  const resolved = resolveInput({ prompt: "a red fox", scale: 4 }, results);
  assert.equal(resolved.prompt, "a red fox");
  assert.equal(resolved.scale, 4);
});

test("resolveInput — resolves refs inside nested objects", () => {
  const results = new Map([["gen", mockResult]]);
  const resolved = resolveInput({ extra: { image: "$gen.urls[0]" } }, results);
  assert.deepEqual(resolved.extra, { image: "https://cdn.example.com/out.webp" });
});

// ── hasCycle ───────────────────────────────────────────────────────────────

test("hasCycle — returns false for valid linear chain", () => {
  const steps = [
    { id: "a", depends_on: [] },
    { id: "b", depends_on: ["a"] },
    { id: "c", depends_on: ["b"] },
  ];
  assert.equal(hasCycle(steps), false);
});

test("hasCycle — returns false for parallel DAG", () => {
  const steps = [
    { id: "gen", depends_on: [] },
    { id: "upscale", depends_on: ["gen"] },
    { id: "no_bg", depends_on: ["gen"] },
  ];
  assert.equal(hasCycle(steps), false);
});

test("hasCycle — returns true for direct 2-node cycle", () => {
  const steps = [
    { id: "a", depends_on: ["b"] },
    { id: "b", depends_on: ["a"] },
  ];
  assert.equal(hasCycle(steps), true);
});

test("hasCycle — returns true for 3-node cycle", () => {
  const steps = [
    { id: "a", depends_on: ["c"] },
    { id: "b", depends_on: ["a"] },
    { id: "c", depends_on: ["b"] },
  ];
  assert.equal(hasCycle(steps), true);
});

// ── createPipeline ─────────────────────────────────────────────────────────

test("createPipeline — valid 2-step chain, correct initial state and inferred deps", () => {
  const p = createPipeline({
    steps: [
      { id: "gen", model: "owner/model-a", input: { prompt: "hello" } },
      { id: "upscale", model: "owner/model-b", input: { image: "$gen.urls[0]" } },
    ],
    concurrency: 3,
    download: true,
    timeoutMsPerStep: 60_000,
    ttlHours: 1,
  });

  assert.ok(!("error" in p), `Expected pipeline, got error: ${"error" in p ? p.error : ""}`);
  const pipeline = p;
  assert.equal(pipeline.total, 2);
  assert.equal(pipeline.pending, 2);
  assert.equal(pipeline.running, 0);
  assert.equal(pipeline.succeeded, 0);
  assert.equal(pipeline.failed, 0);
  assert.equal(pipeline.skipped, 0);
  assert.equal(pipeline.overall_status, "running");
  assert.ok(typeof pipeline.pipeline_id === "string" && pipeline.pipeline_id.length > 0);
  assert.deepEqual(pipeline.steps[0].depends_on, []);
  assert.deepEqual(pipeline.steps[1].depends_on, ["gen"]);
});

test("createPipeline — detects cycle, returns error object", () => {
  const result = createPipeline({
    steps: [
      { id: "a", model: "o/m", input: {}, depends_on: ["b"] },
      { id: "b", model: "o/m", input: {}, depends_on: ["a"] },
    ],
    concurrency: 1,
    download: false,
    timeoutMsPerStep: 5_000,
    ttlHours: 1,
  });
  assert.ok("error" in result);
  assert.ok(result.error.includes("Cycle"), `Expected cycle error, got: ${result.error}`);
});

test("createPipeline — rejects unknown step in depends_on", () => {
  const result = createPipeline({
    steps: [{ id: "a", model: "o/m", input: {}, depends_on: ["nonexistent"] }],
    concurrency: 1,
    download: false,
    timeoutMsPerStep: 5_000,
    ttlHours: 1,
  });
  assert.ok("error" in result);
  assert.ok(result.error.includes("nonexistent"), `Expected unknown-dep error, got: ${result.error}`);
});

test("createPipeline — rejects duplicate step IDs", () => {
  const result = createPipeline({
    steps: [
      { id: "dup", model: "o/m", input: {} },
      { id: "dup", model: "o/m", input: {} },
    ],
    concurrency: 1,
    download: false,
    timeoutMsPerStep: 5_000,
    ttlHours: 1,
  });
  assert.ok("error" in result);
  assert.ok(result.error.includes("Duplicate"), `got: ${result.error}`);
});

test("createPipeline — inferred $-literal (e.g. price) is not treated as a dependency", () => {
  // "$5.99" looks ref-shaped but no step "5" exists. With no explicit
  // depends_on, it must be ignored (treated as a literal), not rejected.
  const p = createPipeline({
    steps: [{ id: "a", model: "o/m", input: { label: "$5.99 total", n: 1 } }],
    concurrency: 1,
    download: false,
    timeoutMsPerStep: 5_000,
    ttlHours: 1,
  });
  assert.ok(!("error" in p), `Expected pipeline, got error: ${"error" in p ? p.error : ""}`);
  assert.deepEqual(p.steps[0].depends_on, []);
});

test("createPipeline — inferred real ref still becomes a dependency", () => {
  const p = createPipeline({
    steps: [
      { id: "gen", model: "o/m", input: { prompt: "x" } },
      { id: "use", model: "o/m", input: { image: "$gen.urls[0]", price: "$9.99" } },
    ],
    concurrency: 1,
    download: false,
    timeoutMsPerStep: 5_000,
    ttlHours: 1,
  });
  assert.ok(!("error" in p));
  assert.deepEqual(p.steps[1].depends_on, ["gen"]);
});

test("createPipeline — expires_at is ttlHours after created_at", () => {
  const before = Date.now();
  const p = createPipeline({
    steps: [{ id: "s", model: "o/m", input: {} }],
    concurrency: 1,
    download: false,
    timeoutMsPerStep: 5_000,
    ttlHours: 2,
  });
  const after = Date.now();
  assert.ok(!("error" in p));
  const created = new Date(p.created_at).getTime();
  const expires = new Date(p.expires_at).getTime();
  assert.ok(created >= before && created <= after);
  assert.ok(Math.abs(expires - created - 2 * 60 * 60 * 1000) < 100);
});

// ── getPipeline ────────────────────────────────────────────────────────────

test("getPipeline — returns undefined for unknown id", () => {
  assert.equal(getPipeline("nonexistent-pipeline-id-xyz-abc"), undefined);
});

test("getPipeline — returns pipeline for valid id", () => {
  const p = createPipeline({
    steps: [{ id: "s", model: "o/m", input: {} }],
    concurrency: 1,
    download: false,
    timeoutMsPerStep: 5_000,
    ttlHours: 1,
  });
  assert.ok(!("error" in p));
  const found = getPipeline(p.pipeline_id);
  assert.ok(found !== undefined);
  assert.equal(found.pipeline_id, p.pipeline_id);
});

test("getPipeline — returns undefined and removes expired pipeline", () => {
  const p = createPipeline({
    steps: [{ id: "s", model: "o/m", input: {} }],
    concurrency: 1,
    download: false,
    timeoutMsPerStep: 5_000,
    ttlHours: 1,
  });
  assert.ok(!("error" in p));
  p.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal(getPipeline(p.pipeline_id), undefined);
  assert.equal(getPipeline(p.pipeline_id), undefined);
});
