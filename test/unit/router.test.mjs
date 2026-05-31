import { test } from "node:test";
import assert from "node:assert/strict";

const { recommendModels } = await import("../../dist/router.js");

test("recommendModels — speed priority ranks a fast model first (image)", () => {
  const recs = recommendModels({ category: "image", priority: "speed" });
  assert.ok(recs.length > 0);
  assert.equal(recs[0].speed, "fast");
  assert.equal(recs[0].key, "flux-schnell");
});

test("recommendModels — cost priority ranks cheapest known-cost model first (image)", () => {
  const recs = recommendModels({ category: "image", priority: "cost" });
  assert.ok(recs.length > 0);
  const first = recs[0];
  assert.ok(first.est_cost_usd !== null);
  for (const r of recs) {
    if (r.est_cost_usd !== null) {
      assert.ok(r.est_cost_usd >= first.est_cost_usd, `${r.key} cheaper than top`);
    }
  }
});

test("recommendModels — returns at most 5 recommendations", () => {
  const recs = recommendModels({ category: "image", priority: "balanced" });
  assert.ok(recs.length <= 5);
});

test("recommendModels — each rec has key, model_id, speed, score, reason", () => {
  const recs = recommendModels({ category: "tts", priority: "balanced" });
  for (const r of recs) {
    assert.ok(typeof r.key === "string" && r.key.length > 0);
    assert.ok(typeof r.model_id === "string" && r.model_id.includes("/"));
    assert.ok(["fast", "medium", "slow"].includes(r.speed));
    assert.ok(typeof r.score === "number");
    assert.ok(typeof r.reason === "string" && r.reason.length > 0);
    assert.ok(r.est_cost_usd === null || typeof r.est_cost_usd === "number");
  }
});

test("recommendModels — maxCostUsd filters out expensive known-cost models", () => {
  const all = recommendModels({ category: "image", priority: "cost" });
  const capped = recommendModels({ category: "image", priority: "cost", maxCostUsd: 0.01 });
  for (const r of capped) {
    if (r.est_cost_usd !== null) assert.ok(r.est_cost_usd <= 0.01);
  }
  assert.ok(capped.length <= all.length);
});

test("recommendModels — quality priority ranks a non-fast model at or near top (image)", () => {
  const recs = recommendModels({ category: "image", priority: "quality" });
  assert.ok(recs.length > 0);
  assert.notEqual(recs[0].key, "flux-schnell");
});

test("recommendModels — speed keyword bias favors faster models in balanced mode", () => {
  const plain = recommendModels({ category: "image", priority: "balanced" });
  const draft = recommendModels({
    category: "image",
    priority: "balanced",
    taskDescription: "just a quick draft preview",
  });
  const speedRank = { fast: 0, medium: 1, slow: 2 };
  assert.ok(speedRank[draft[0].speed] <= speedRank[plain[0].speed]);
});

test("recommendModels — unknown category-free model keeps null cost without crashing", () => {
  const recs = recommendModels({ category: "segment", priority: "balanced" });
  assert.ok(Array.isArray(recs));
  assert.ok(recs.length > 0);
});
