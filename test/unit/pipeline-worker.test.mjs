import { test } from "node:test";
import assert from "node:assert/strict";

const { createPipeline, getPipeline } = await import("../../dist/pipeline.js");

function ok(model, urls, over = {}) {
  return {
    status: "succeeded",
    prediction_id: `pred-${model}`,
    model,
    urls,
    local_paths: [],
    ...over,
  };
}

async function waitDone(id, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = getPipeline(id);
    if (p && p.overall_status !== "running") return p;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("pipeline did not finish in time");
}

function step(steps) {
  return Object.fromEntries(steps.map((s) => [s.id, s]));
}

test("pipeline worker — linear chain resolves template + completes", async () => {
  const seen = {};
  const predict = async ({ model, input }) => {
    seen[model] = input;
    if (model === "gen-model") return ok("gen-model", ["https://cdn/gen.webp"]);
    return ok("up-model", ["https://cdn/up.webp"]);
  };

  const p = createPipeline({
    steps: [
      { id: "gen", model: "gen-model", input: { prompt: "fox" } },
      { id: "up", model: "up-model", input: { image: "$gen.urls[0]", scale: 4 } },
    ],
    concurrency: 2,
    download: false,
    timeoutMsPerStep: 5000,
    ttlHours: 1,
    _predict: predict,
  });

  const done = await waitDone(p.pipeline_id);
  assert.equal(done.overall_status, "completed");
  assert.equal(done.succeeded, 2);
  // The upscale step's $gen.urls[0] template was resolved to gen's real URL.
  assert.equal(seen["up-model"].image, "https://cdn/gen.webp");
  assert.equal(seen["up-model"].scale, 4);
});

test("pipeline worker — failed step skips its transitive dependents", async () => {
  const ran = new Set();
  const predict = async ({ model }) => {
    ran.add(model);
    if (model === "a-model") throw new Error("a failed");
    return ok(model, ["https://cdn/x.webp"]);
  };

  const p = createPipeline({
    steps: [
      { id: "a", model: "a-model", input: {} },
      { id: "b", model: "b-model", input: { x: "$a.urls[0]" } },
      { id: "c", model: "c-model", input: { x: "$b.urls[0]" } }, // transitive
      { id: "d", model: "d-model", input: {} }, // independent — should run
    ],
    concurrency: 2,
    download: false,
    timeoutMsPerStep: 5000,
    ttlHours: 1,
    _predict: predict,
  });

  const done = await waitDone(p.pipeline_id);
  assert.equal(done.overall_status, "partial");
  assert.equal(done.failed, 1);
  assert.equal(done.skipped, 2);
  const byId = step(done.steps);
  assert.equal(byId.a.status, "failed");
  assert.equal(byId.b.status, "skipped");
  assert.equal(byId.c.status, "skipped");
  assert.equal(byId.d.status, "succeeded");
  assert.match(byId.b.skip_reason, /dependency 'a' failed/);
  // b and c never executed
  assert.ok(!ran.has("b-model"));
  assert.ok(!ran.has("c-model"));
  // counters sum
  assert.equal(done.succeeded + done.failed + done.skipped, done.total);
});

test("pipeline worker — timed-out step fails and skips dependents (H1)", async () => {
  const predict = async ({ model }) => {
    if (model === "slow-model") {
      return ok("slow-model", [], { status: "processing", pending: true });
    }
    return ok(model, ["https://cdn/x.webp"]);
  };

  const p = createPipeline({
    steps: [
      { id: "slow", model: "slow-model", input: {} },
      { id: "after", model: "after-model", input: { x: "$slow.urls[0]" } },
    ],
    concurrency: 1,
    download: false,
    timeoutMsPerStep: 5000,
    ttlHours: 1,
    _predict: predict,
  });

  const done = await waitDone(p.pipeline_id);
  assert.equal(done.overall_status, "partial");
  const byId = step(done.steps);
  assert.equal(byId.slow.status, "failed");
  assert.match(byId.slow.error, /timed out/);
  assert.equal(byId.after.status, "skipped");
});

test("pipeline worker — diamond DAG (A→B, A→C, B+C→D) completes correctly", async () => {
  const order = [];
  const predict = async ({ model }) => {
    order.push(model);
    return ok(model, [`https://cdn/${model}.webp`]);
  };

  const p = createPipeline({
    steps: [
      { id: "A", model: "A", input: {} },
      { id: "B", model: "B", input: { x: "$A.urls[0]" } },
      { id: "C", model: "C", input: { x: "$A.urls[0]" } },
      { id: "D", model: "D", input: { b: "$B.urls[0]", c: "$C.urls[0]" } },
    ],
    concurrency: 3,
    download: false,
    timeoutMsPerStep: 5000,
    ttlHours: 1,
    _predict: predict,
  });

  const done = await waitDone(p.pipeline_id);
  assert.equal(done.overall_status, "completed");
  assert.equal(done.succeeded, 4);
  // A must run before B and C; D must run last.
  assert.equal(order[0], "A");
  assert.equal(order[order.length - 1], "D");
  assert.ok(order.indexOf("B") < order.indexOf("D"));
  assert.ok(order.indexOf("C") < order.indexOf("D"));
});
