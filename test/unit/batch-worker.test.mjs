import { test } from "node:test";
import assert from "node:assert/strict";

const { createBatchJob, getBatchJob } = await import("../../dist/batch.js");

/** Build a fake predictor from a map of model -> result-or-throw. */
function fakePredictor(byModel) {
  return async ({ model }) => {
    const spec = byModel[model];
    if (typeof spec === "function") return spec();
    if (spec instanceof Error) throw spec;
    return spec;
  };
}

function ok(model, over = {}) {
  return {
    status: "succeeded",
    prediction_id: `pred-${model}`,
    model,
    urls: [`https://cdn/${model}.webp`],
    local_paths: [],
    ...over,
  };
}

/** Poll until the job leaves "running" (workers are deferred via setImmediate). */
async function waitDone(jobId, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = getBatchJob(jobId);
    if (job && job.overall_status !== "running") return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("batch did not finish in time");
}

test("batch worker — all succeed → completed, counters consistent", async () => {
  const job = createBatchJob({
    items: [
      { model: "a", input: {} },
      { model: "b", input: {} },
      { model: "c", input: {} },
    ],
    concurrency: 2,
    download: false,
    timeoutMsPerItem: 5000,
    ttlHours: 1,
    _predict: fakePredictor({ a: ok("a"), b: ok("b"), c: ok("c") }),
  });

  const done = await waitDone(job.job_id);
  assert.equal(done.overall_status, "completed");
  assert.equal(done.succeeded, 3);
  assert.equal(done.failed, 0);
  assert.equal(done.running, 0);
  assert.equal(done.pending, 0);
  assert.equal(done.succeeded + done.failed, done.total);
  for (const it of done.items) assert.equal(it.status, "succeeded");
});

test("batch worker — mixed success/failure → partial", async () => {
  const job = createBatchJob({
    items: [
      { model: "good", input: {} },
      { model: "bad", input: {} },
    ],
    concurrency: 2,
    download: false,
    timeoutMsPerItem: 5000,
    ttlHours: 1,
    _predict: fakePredictor({
      good: ok("good"),
      bad: new Error("model exploded"),
    }),
  });

  const done = await waitDone(job.job_id);
  assert.equal(done.overall_status, "partial");
  assert.equal(done.succeeded, 1);
  assert.equal(done.failed, 1);
  assert.equal(done.running, 0);
  assert.equal(done.pending, 0);
  const bad = done.items.find((i) => i.model === "bad");
  assert.equal(bad.status, "failed");
  assert.match(bad.error, /exploded/);
});

test("batch worker — timed-out (pending) result counts as FAILED, not succeeded", async () => {
  // Regression for H1: a prediction that hit its timeout returns pending=true
  // with a non-terminal status — must NOT be stamped succeeded.
  const job = createBatchJob({
    items: [{ model: "slow", input: {} }],
    concurrency: 1,
    download: false,
    timeoutMsPerItem: 5000,
    ttlHours: 1,
    _predict: fakePredictor({
      slow: ok("slow", { status: "processing", pending: true, urls: [] }),
    }),
  });

  const done = await waitDone(job.job_id);
  assert.equal(done.overall_status, "partial");
  assert.equal(done.succeeded, 0);
  assert.equal(done.failed, 1);
  assert.equal(done.items[0].status, "failed");
  assert.match(done.items[0].error, /timed out/);
});

test("batch worker — canceled result counts as FAILED", async () => {
  const job = createBatchJob({
    items: [{ model: "x", input: {} }],
    concurrency: 1,
    download: false,
    timeoutMsPerItem: 5000,
    ttlHours: 1,
    _predict: fakePredictor({ x: ok("x", { status: "canceled" }) }),
  });

  const done = await waitDone(job.job_id);
  assert.equal(done.overall_status, "partial");
  assert.equal(done.failed, 1);
  assert.equal(done.items[0].status, "failed");
});

test("batch worker — concurrency cap respected (never more than N running)", async () => {
  let active = 0;
  let maxActive = 0;
  const slow = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return ok("s");
  };
  const job = createBatchJob({
    items: Array.from({ length: 6 }, (_, i) => ({ model: `m${i}`, input: {} })),
    concurrency: 2,
    download: false,
    timeoutMsPerItem: 5000,
    ttlHours: 1,
    _predict: async () => slow(),
  });

  const done = await waitDone(job.job_id);
  assert.equal(done.succeeded, 6);
  assert.ok(maxActive <= 2, `maxActive=${maxActive} exceeded concurrency 2`);
  // Lower bound too: prove work actually ran in parallel, not sequentially.
  assert.ok(maxActive > 1, `maxActive=${maxActive} — work ran sequentially, concurrency not active`);
});
