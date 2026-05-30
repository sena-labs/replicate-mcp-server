import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost } from "../../dist/cost.js";

test("estimateCost: curated key resolves to model id (per-run)", () => {
  const e = estimateCost("flux-schnell", 1);
  assert.equal(e.resolved_model_id, "black-forest-labs/flux-schnell");
  assert.equal(e.pricing_basis, "per_run");
  assert.ok(e.estimated_usd > 0);
});

test("estimateCost: num_outputs multiplies per-run cost", () => {
  const e = estimateCost("flux-schnell", 4);
  // Single run is 0.003; 4 outputs → 0.012
  assert.ok(e.estimated_usd >= 0.011 && e.estimated_usd <= 0.013);
});

test("estimateCost: per-second model uses duration", () => {
  const e = estimateCost("kling-pro", 1, 5);
  // 5s × $0.09/s = $0.45
  assert.equal(e.pricing_basis, "per_second");
  assert.ok(e.estimated_usd >= 0.44 && e.estimated_usd <= 0.46);
  assert.equal(e.duration_seconds, 5);
});

test("estimateCost: per-second falls back to 1s when no duration given", () => {
  const e = estimateCost("kling-pro", 1);
  assert.equal(e.duration_seconds, 1);
  assert.equal(e.pricing_basis, "per_second");
});

test("estimateCost: full owner/name id accepted", () => {
  const e = estimateCost("meta/meta-llama-3-70b-instruct", 1, 10);
  assert.equal(e.resolved_model_id, "meta/meta-llama-3-70b-instruct");
  assert.equal(e.pricing_basis, "per_second");
});

test("estimateCost: version suffix stripped before lookup", () => {
  const e = estimateCost("black-forest-labs/flux-schnell:abc123hash", 1);
  assert.equal(e.resolved_model_id, "black-forest-labs/flux-schnell");
  assert.equal(e.pricing_basis, "per_run");
});

test("estimateCost: unknown model returns unknown basis with zero cost", () => {
  const e = estimateCost("someone/unknown-model", 1);
  assert.equal(e.pricing_basis, "unknown");
  assert.equal(e.estimated_usd, 0);
  assert.ok(e.note.includes("No public price"));
});

test("estimateCost: LLM curated key resolves and uses per-second", () => {
  const e = estimateCost("llama-3-8b", 1, 5);
  assert.equal(e.resolved_model_id, "meta/meta-llama-3-8b-instruct");
  assert.equal(e.pricing_basis, "per_second");
  assert.ok(e.estimated_usd > 0);
});

test("estimateCost: transcription per-second pricing", () => {
  const e = estimateCost("incredibly-fast-whisper", 1, 60);
  assert.equal(
    e.resolved_model_id,
    "vaibhavs10/incredibly-fast-whisper",
  );
  assert.equal(e.pricing_basis, "per_second");
});

test("estimateCost: embedding per-run pricing", () => {
  const e = estimateCost("bge-large", 5);
  assert.equal(e.resolved_model_id, "nateraw/bge-large-en-v1.5");
  assert.equal(e.pricing_basis, "per_run");
});
